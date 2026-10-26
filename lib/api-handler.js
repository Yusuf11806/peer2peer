const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { Pool } = require('pg');

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = 'p2p_session';
const SESSION_SECONDS = 60 * 60 * 24 * 7;

let pool;
let schemaReady;

function database() {
    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is not configured. Connect a Postgres database in Vercel.');
    }

    if (!pool) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            max: 1,
            ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
        });
    }

    return pool;
}

async function ensureSchema() {
    if (!schemaReady) {
        schemaReady = database().query(`
            CREATE TABLE IF NOT EXISTS p2p_users (
                id BIGSERIAL PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                nim TEXT UNIQUE,
                password_hash TEXT NOT NULL,
                is_mentor BOOLEAN NOT NULL DEFAULT FALSE,
                is_admin BOOLEAN NOT NULL DEFAULT FALSE,
                has_profile BOOLEAN NOT NULL DEFAULT FALSE,
                profile JSONB,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS p2p_assignments (
                student_id BIGINT PRIMARY KEY REFERENCES p2p_users(id) ON DELETE CASCADE,
                mentor_id BIGINT NOT NULL REFERENCES p2p_users(id) ON DELETE CASCADE,
                assigned_by BIGINT NOT NULL REFERENCES p2p_users(id),
                assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CHECK (student_id <> mentor_id)
            );

            CREATE TABLE IF NOT EXISTS p2p_messages (
                id BIGSERIAL PRIMARY KEY,
                sender_id BIGINT NOT NULL REFERENCES p2p_users(id) ON DELETE CASCADE,
                recipient_id BIGINT NOT NULL REFERENCES p2p_users(id) ON DELETE CASCADE,
                message TEXT NOT NULL CHECK (length(message) <= 3000),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CHECK (sender_id <> recipient_id)
            );

            CREATE INDEX IF NOT EXISTS p2p_messages_pair_time_idx
                ON p2p_messages (sender_id, recipient_id, created_at);
            CREATE INDEX IF NOT EXISTS p2p_users_profile_idx
                ON p2p_users (has_profile, is_mentor);
        `);
    }

    await schemaReady;
}

function send(res, status, data) {
    res.status(status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.json(data);
}

function getBody(req) {
    if (req.body && typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') {
        try { return JSON.parse(req.body); } catch { return {}; }
    }
    return {};
}

function readCookie(req, key) {
    const cookieHeader = req.headers.cookie || '';
    const pair = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith(`${key}=`));
    return pair ? decodeURIComponent(pair.slice(key.length + 1)) : '';
}

function sign(value) {
    const secret = process.env.SESSION_SECRET;
    if (!secret || secret.length < 32) {
        throw new Error('SESSION_SECRET must be set to a random value with at least 32 characters.');
    }
    return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function setSessionCookie(res, userId) {
    const payload = Buffer.from(JSON.stringify({
        userId: Number(userId),
        expires: Math.floor(Date.now() / 1000) + SESSION_SECONDS
    })).toString('base64url');
    const token = `${payload}.${sign(payload)}`;
    const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`);
}

function clearSessionCookie(res) {
    const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`);
}

async function currentUser(req) {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) return null;

    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;

    const expected = sign(payload);
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;

    let claims;
    try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
    if (!Number.isInteger(claims.userId) || claims.expires < Math.floor(Date.now() / 1000)) return null;

    const result = await database().query(
        'SELECT id, email, nim, is_mentor, is_admin, has_profile, profile FROM p2p_users WHERE id = $1',
        [claims.userId]
    );
    return result.rows[0] || null;
}

function publicUser(user) {
    if (!user) return null;
    return {
        id: Number(user.id),
        email: user.email,
        nim: user.nim,
        isMentor: user.is_mentor,
        isAdmin: user.is_admin,
        hasProfile: user.has_profile,
        profile: user.profile || null
    };
}

async function requireUser(req, res) {
    const user = await currentUser(req);
    if (!user) {
        send(res, 401, { error: 'Please sign in to continue.' });
        return null;
    }
    return user;
}

async function requireAdmin(req, res) {
    const user = await requireUser(req, res);
    if (!user) return null;
    if (!user.is_admin) {
        send(res, 403, { error: 'Admin access is required.' });
        return null;
    }
    return user;
}

async function passwordHash(password) {
    const salt = crypto.randomBytes(16);
    const derived = await scrypt(password, salt, 64);
    return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

async function passwordMatches(password, storedHash) {
    if (!storedHash) return false;
    const [algorithm, saltText, hashText] = storedHash.split('$');
    if (algorithm !== 'scrypt' || !saltText || !hashText) return false;
    const expected = Buffer.from(hashText, 'base64url');
    const actual = await scrypt(password, Buffer.from(saltText, 'base64url'), expected.length);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function validEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

async function ensureAdminAccount() {
    const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD || '';
    if (!email || !password) return;

    const existing = await database().query('SELECT id FROM p2p_users WHERE email = $1', [email]);
    const hash = await passwordHash(password);
    if (existing.rowCount) {
        await database().query('UPDATE p2p_users SET is_admin = TRUE, password_hash = $2 WHERE id = $1', [existing.rows[0].id, hash]);
    } else {
        await database().query(
            'INSERT INTO p2p_users (email, password_hash, is_admin, has_profile) VALUES ($1, $2, TRUE, FALSE)',
            [email, hash]
        );
    }
}

async function me(user) {
    const assigned = await database().query(`
        SELECT mentor.id, mentor.email, mentor.nim, mentor.is_mentor, mentor.has_profile, mentor.profile
        FROM p2p_assignments assignment
        JOIN p2p_users mentor ON mentor.id = assignment.mentor_id
        WHERE assignment.student_id = $1
    `, [user.id]);

    return {
        ...publicUser(user),
        assignedMentor: publicUser(assigned.rows[0] || null)
    };
}

function publicPeer(row) {
    return {
        id: Number(row.id),
        isMentor: row.is_mentor,
        hasProfile: row.has_profile,
        profile: row.profile || null
    };
}

async function route(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
    const path = parts.join('/');
    const method = req.method.toUpperCase();
    const body = getBody(req);
    const pool = database();

    if (path === 'health' && method === 'GET') {
        await pool.query('SELECT 1');
        return send(res, 200, {
            ok: true,
            database: 'connected',
            adminConfigured: Boolean(process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD),
            sessionConfigured: Boolean(process.env.SESSION_SECRET)
        });
    }

    if (path === 'auth/register' && method === 'POST') {
        const email = String(body.email || '').trim().toLowerCase();
        const nim = String(body.nim || '').trim().toUpperCase();
        const password = String(body.password || '');
        if (!validEmail(email) || nim.length < 3 || nim.length > 32) {
            return send(res, 400, { error: 'Enter a valid email and BINUS NIM.' });
        }
        if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
            return send(res, 400, { error: 'Password must be at least 8 characters and include an uppercase letter and a number.' });
        }

        const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
        if (email === adminEmail) {
            return send(res, 409, { error: 'This email is reserved for the configured admin account. Sign in with the admin password.' });
        }

        const hash = await passwordHash(password);
        const created = await pool.query(
            'INSERT INTO p2p_users (email, nim, password_hash) VALUES ($1, $2, $3) RETURNING id, email, nim, is_mentor, is_admin, has_profile, profile',
            [email, nim, hash]
        );
        const user = created.rows[0];
        setSessionCookie(res, user.id);
        return send(res, 201, { user: await me(user) });
    }

    if (path === 'auth/login' && method === 'POST') {
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');
        await ensureAdminAccount();
        const result = await pool.query(
            'SELECT id, email, nim, password_hash, is_mentor, is_admin, has_profile, profile FROM p2p_users WHERE email = $1',
            [email]
        );
        const user = result.rows[0];
        if (!user || !(await passwordMatches(password, user.password_hash))) {
            return send(res, 401, { error: 'Invalid email or password.' });
        }
        setSessionCookie(res, user.id);
        return send(res, 200, { user: await me(user) });
    }

    if (path === 'auth/logout' && method === 'POST') {
        clearSessionCookie(res);
        return send(res, 200, { ok: true });
    }

    if (path === 'auth/me' && method === 'GET') {
        const user = await requireUser(req, res);
        if (!user) return;
        return send(res, 200, { user: await me(user) });
    }

    if (path === 'profile' && method === 'PUT') {
        const user = await requireUser(req, res);
        if (!user) return;
        const profile = body.profile || body;
        const required = ['name', 'major', 'subject', 'skillHave', 'studyMode', 'bio'];
        if (required.some(key => !String(profile[key] || '').trim())) {
            return send(res, 400, { error: 'Complete all required profile fields.' });
        }
        if (!['Online', 'Onsite'].includes(profile.studyMode)) {
            return send(res, 400, { error: 'Choose a valid study preference.' });
        }
        const cleaned = {
            name: String(profile.name).trim().slice(0, 100),
            major: String(profile.major).trim().slice(0, 120),
            subject: String(profile.subject).trim().slice(0, 100),
            skillHave: String(profile.skillHave).trim().slice(0, 120),
            studyMode: profile.studyMode,
            roomLink: profile.studyMode === 'Online' ? String(profile.roomLink || '').trim().slice(0, 500) : '',
            location: profile.studyMode === 'Onsite' ? String(profile.location || '').trim().slice(0, 200) : '',
            bio: String(profile.bio).trim().slice(0, 2000),
            schedule: Array.isArray(profile.schedule) ? profile.schedule.slice(0, 20).map(String) : []
        };
        const result = await pool.query(
            'UPDATE p2p_users SET profile = $2::jsonb, has_profile = TRUE WHERE id = $1 RETURNING id, email, nim, is_mentor, is_admin, has_profile, profile',
            [user.id, JSON.stringify(cleaned)]
        );
        return send(res, 200, { user: await me(result.rows[0]) });
    }

    if (path === 'students' && method === 'GET') {
        const user = await requireUser(req, res);
        if (!user) return;
        const result = await pool.query(
            'SELECT id, email, nim, is_mentor, has_profile, profile FROM p2p_users WHERE has_profile = TRUE AND id <> $1 ORDER BY profile->>\'name\' ASC',
            [user.id]
        );
        return send(res, 200, { users: result.rows.map(publicPeer) });
    }

    if (path === 'admin/users' && method === 'GET') {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        const result = await pool.query(`
            SELECT user_row.id, user_row.email, user_row.nim, user_row.is_mentor,
                   user_row.has_profile, user_row.profile,
                   assignment.mentor_id AS assigned_mentor_id
            FROM p2p_users user_row
            LEFT JOIN p2p_assignments assignment ON assignment.student_id = user_row.id
            WHERE user_row.is_admin = FALSE
            ORDER BY user_row.email
        `);
        return send(res, 200, { users: result.rows.map(row => ({
            ...publicPeer(row), email: row.email, nim: row.nim,
            assignedMentorId: row.assigned_mentor_id ? Number(row.assigned_mentor_id) : null
        })) });
    }

    if (path === 'admin/mentors' && method === 'POST') {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        const userId = Number(body.userId);
        const isMentor = Boolean(body.isMentor);
        if (!Number.isInteger(userId)) return send(res, 400, { error: 'Choose a valid student account.' });
        const targetResult = await pool.query('SELECT id, nim, is_admin FROM p2p_users WHERE id = $1', [userId]);
        const target = targetResult.rows[0];
        if (!target || target.is_admin) return send(res, 404, { error: 'Student account not found.' });
        if (!isMentor) {
            const assigned = await pool.query('SELECT 1 FROM p2p_assignments WHERE mentor_id = $1 LIMIT 1', [userId]);
            if (assigned.rowCount) return send(res, 409, { error: 'Reassign this mentor’s students before removing mentor status.' });
        }
        await pool.query('UPDATE p2p_users SET is_mentor = $2 WHERE id = $1', [userId, isMentor]);
        return send(res, 200, { ok: true });
    }

    if (path === 'admin/assignments' && method === 'POST') {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        const studentId = Number(body.studentId);
        const mentorId = body.mentorId === null ? null : Number(body.mentorId);
        if (!Number.isInteger(studentId) || (mentorId !== null && !Number.isInteger(mentorId))) {
            return send(res, 400, { error: 'Choose valid student and mentor accounts.' });
        }
        if (mentorId === null) {
            await pool.query('DELETE FROM p2p_assignments WHERE student_id = $1', [studentId]);
            return send(res, 200, { ok: true, unassigned: true });
        }
        if (studentId === mentorId) return send(res, 400, { error: 'A student cannot be assigned as their own mentor.' });
        const mentorResult = await pool.query('SELECT id, nim, is_mentor FROM p2p_users WHERE id = $1', [mentorId]);
        const mentor = mentorResult.rows[0];
        const studentExists = await pool.query('SELECT 1 FROM p2p_users WHERE id = $1 AND is_admin = FALSE', [studentId]);
        if (!mentor || !mentor.is_mentor || !mentor.nim || !studentExists.rowCount) {
            return send(res, 400, { error: 'Choose a registered student and a designated mentor with a NIM.' });
        }
        await pool.query(`
            INSERT INTO p2p_assignments (student_id, mentor_id, assigned_by)
            VALUES ($1, $2, $3)
            ON CONFLICT (student_id) DO UPDATE
            SET mentor_id = EXCLUDED.mentor_id, assigned_by = EXCLUDED.assigned_by, assigned_at = NOW()
        `, [studentId, mentorId, admin.id]);
        return send(res, 200, { ok: true });
    }

    if (path === 'chat/contacts' && method === 'GET') {
        const user = await requireUser(req, res);
        if (!user) return;
        const result = await pool.query(`
            SELECT contact.id, contact.email, contact.nim, contact.is_mentor,
                   contact.has_profile, contact.profile,
                   recent.message AS recent_message,
                   recent.created_at AS recent_at
            FROM p2p_users contact
            LEFT JOIN LATERAL (
                SELECT message, created_at FROM p2p_messages
                WHERE (sender_id = $1 AND recipient_id = contact.id)
                   OR (sender_id = contact.id AND recipient_id = $1)
                ORDER BY created_at DESC LIMIT 1
            ) recent ON TRUE
            WHERE contact.id <> $1
              AND (contact.has_profile = TRUE OR EXISTS (
                  SELECT 1 FROM p2p_assignments
                  WHERE student_id = $1 AND mentor_id = contact.id
              ))
            ORDER BY recent.created_at DESC NULLS LAST, contact.email
        `, [user.id]);
        return send(res, 200, { contacts: result.rows.map(row => ({
            ...publicPeer(row), recentMessage: row.recent_message || '',
            recentAt: row.recent_at ? new Date(row.recent_at).getTime() : 0
        })) });
    }

    if (path === 'chat/messages' && method === 'GET') {
        const user = await requireUser(req, res);
        if (!user) return;
        const peerId = Number(url.searchParams.get('peerId'));
        if (!Number.isInteger(peerId) || peerId === Number(user.id)) return send(res, 400, { error: 'Choose a valid conversation.' });
        const peer = await pool.query('SELECT id FROM p2p_users WHERE id = $1', [peerId]);
        if (!peer.rowCount) return send(res, 404, { error: 'Student not found.' });
        const messages = await pool.query(`
            SELECT message.id, message.message, message.created_at,
                   sender.id AS sender_id, sender.email AS sender_email
            FROM p2p_messages message
            JOIN p2p_users sender ON sender.id = message.sender_id
            WHERE (message.sender_id = $1 AND message.recipient_id = $2)
               OR (message.sender_id = $2 AND message.recipient_id = $1)
            ORDER BY message.created_at ASC, message.id ASC
        `, [user.id, peerId]);
        return send(res, 200, { messages: messages.rows.map(row => ({
            id: Number(row.id), text: row.message, senderId: Number(row.sender_id),
            senderEmail: row.sender_email, timestamp: new Date(row.created_at).getTime()
        })) });
    }

    if (path === 'chat/messages' && method === 'POST') {
        const user = await requireUser(req, res);
        if (!user) return;
        const peerId = Number(body.peerId);
        const message = String(body.message || '').trim();
        if (!Number.isInteger(peerId) || peerId === Number(user.id) || !message || message.length > 3000) {
            return send(res, 400, { error: 'Enter a message of 1 to 3000 characters.' });
        }
        const contact = await pool.query(`
            SELECT id FROM p2p_users WHERE id = $2 AND (
                has_profile = TRUE OR EXISTS (
                    SELECT 1 FROM p2p_assignments
                    WHERE (student_id = $1 AND mentor_id = $2)
                       OR (student_id = $2 AND mentor_id = $1)
                )
            )
        `, [user.id, peerId]);
        if (!contact.rowCount) return send(res, 404, { error: 'This student is not available to message.' });
        const created = await pool.query(
            'INSERT INTO p2p_messages (sender_id, recipient_id, message) VALUES ($1, $2, $3) RETURNING id, created_at',
            [user.id, peerId, message]
        );
        return send(res, 201, { message: {
            id: Number(created.rows[0].id), text: message, senderId: Number(user.id),
            senderEmail: user.email, timestamp: new Date(created.rows[0].created_at).getTime()
        } });
    }

    return send(res, 404, { error: 'API route not found.' });
}

module.exports = async function handler(req, res) {
    try {
        await ensureSchema();
        await route(req, res);
    } catch (error) {
        if (error.code === '23505') return send(res, 409, { error: 'That email or NIM is already registered.' });
        if (error.message?.includes('DATABASE_URL') || error.message?.includes('SESSION_SECRET')) {
            return send(res, 503, { error: error.message });
        }
        console.error('Peer2Peer API error:', error.message);
        if (error.code && /^(08|28|3D|ECONN|ETIMEDOUT|ENOTFOUND|SELF_SIGNED)/.test(error.code)) {
            return send(res, 503, { error: 'Cannot connect to PostgreSQL. Verify DATABASE_URL in Vercel and confirm the database is active.' });
        }
        return send(res, 500, { error: 'The server could not complete this request. Check the Vercel Function logs for the error details.' });
    }
};
