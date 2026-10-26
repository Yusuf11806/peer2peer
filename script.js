let currentAuthMode = 'login';
let currentUser = null;
let profileSelectedSchedule = [];
let activeChatPeerId = null;

const SUPPORT_EMAIL = 'yusuf.daniel@binus.ac.id';
const homePage = document.getElementById('homePage');
const authPage = document.getElementById('authPage');
const dashboardPage = document.getElementById('dashboardPage');
const authForm = document.getElementById('authForm');
const profileForm = document.getElementById('profileForm');
const buddyList = document.getElementById('buddyList');
const filterSubject = document.getElementById('filterSubject');
const chatWidget = document.getElementById('chatWidget');
const chatWidgetBody = document.getElementById('chatWidgetBody');
const chatWidgetForm = document.getElementById('chatWidgetForm');
const chatWidgetInput = document.getElementById('chatWidgetInput');
const chatWidgetTargetName = document.getElementById('chatWidgetTargetName');
const chatLauncher = document.getElementById('chatLauncher');
const chatBackButton = document.getElementById('chatBackButton');

async function api(path, options = {}) {
    let response;
    try {
        response = await fetch(`/api/${path.replace(/^\//, '')}`, {
            credentials: 'same-origin',
            ...options,
            headers: {
                ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                ...options.headers
            }
        });
    } catch {
        throw new Error('Cannot reach the Peer2Peer API. Check that the Vercel deployment includes the /api functions.');
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        if (response.status === 404) {
            throw new Error('Vercel could not find this API route. Redeploy the project from its root folder with the api directory included.');
        }
        throw new Error(`The API returned a non-JSON response (HTTP ${response.status}). Check the Vercel Function logs.`);
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (response.status >= 500 && !data.error) {
            throw new Error(`The server failed (HTTP ${response.status}). Check DATABASE_URL, SESSION_SECRET, and the Vercel Function logs.`);
        }
        throw new Error(data.error || `The API request failed (HTTP ${response.status}).`);
    }
    return data;
}

function showError(error) {
    alert(error?.message || 'Something went wrong. Please try again.');
}

function updateHeaderUI() {
    const navActions = document.querySelector('.nav-actions');
    if (!navActions) return;

    chatLauncher?.classList.toggle('is-hidden', !currentUser);
    navActions.innerHTML = currentUser
        ? '<button class="nav-login" onclick="showDashboard()">Dashboard</button><button class="logout-btn" onclick="handleLogout()">Sign Out</button>'
        : '<button class="nav-login" onclick="showAuth(\'login\')">Sign In</button><button class="nav-cta" onclick="showAuth(\'register\')">Get Started</button>';
    updateThemeToggle();
}

function updateThemeToggle() {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.querySelectorAll('.theme-toggle').forEach(button => {
        button.textContent = dark ? 'Light mode' : 'Dark mode';
        button.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} mode`);
        button.setAttribute('aria-pressed', String(dark));
    });
}

function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('p2p_theme', theme);
    updateThemeToggle();
}

function toggleDarkMode() {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}

function showHome() {
    closeChatWidget();
    homePage.style.display = 'block';
    authPage.style.display = 'none';
    dashboardPage.style.display = 'none';
    updateHeaderUI();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function navigateToSection(sectionId) {
    if (homePage.style.display === 'none') showHome();
    window.setTimeout(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' }), 50);
}

function showAuth(mode = 'login') {
    currentAuthMode = mode;
    homePage.style.display = 'none';
    authPage.style.display = 'block';
    dashboardPage.style.display = 'none';
    switchAuthMode(mode);
    updateHeaderUI();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function switchAuthMode(mode) {
    currentAuthMode = mode;
    const registering = mode === 'register';
    document.getElementById('tabLoginBtn').classList.toggle('active', !registering);
    document.getElementById('tabRegisterBtn').classList.toggle('active', registering);
    document.getElementById('authSubmitBtn').textContent = registering ? 'Create Peer2Peer Account' : 'Access Dashboard';
    document.getElementById('authTitle').textContent = registering ? 'Join Peer2Peer' : 'Welcome back';
    document.getElementById('authSubtitle').textContent = registering
        ? 'Create an account and start finding your peers.'
        : 'Sign in to access your peer network.';
    document.querySelectorAll('.signup-only').forEach(field => field.classList.toggle('is-hidden', !registering));
    document.getElementById('authNim').required = registering;

    const card = document.querySelector('.auth-card');
    if (card) {
        card.classList.remove('mode-switch');
        void card.offsetWidth;
        card.classList.add('mode-switch');
    }
}

async function showDashboard() {
    try {
        if (!currentUser) currentUser = (await api('auth/me')).user;
        homePage.style.display = 'none';
        authPage.style.display = 'none';
        dashboardPage.style.display = 'block';
        updateHeaderUI();
        populateProfile(currentUser);
        renderAssignedMentor();
        updateMatrixUI();
        await refreshStudents();
        await renderAdminPanel();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
        currentUser = null;
        showHome();
        showError(error);
    }
}

function populateProfile(user) {
    if (user?.hasProfile && user.profile) {
        const profile = user.profile;
        document.getElementById('userGreetingName').textContent = profile.name;
        document.getElementById('profName').value = profile.name || '';
        document.getElementById('profMajor').value = profile.major || '';
        document.getElementById('profSubject').value = profile.subject || 'Java Programming';
        document.getElementById('profSkill').value = profile.skillHave || '';
        document.getElementById('profStudyMode').value = profile.studyMode || 'Online';
        document.getElementById('profRoomLink').value = profile.roomLink || '';
        document.getElementById('profLocation').value = profile.location || '';
        document.getElementById('profBio').value = profile.bio || '';
        profileSelectedSchedule = Array.isArray(profile.schedule) ? [...profile.schedule] : [];
    } else {
        document.getElementById('userGreetingName').textContent = 'New Peer';
        profileForm.reset();
        profileSelectedSchedule = [];
    }
    toggleModeFields();
}

async function handleLogout() {
    try { await api('auth/logout', { method: 'POST' }); } catch {  }
    currentUser = null;
    closeChatWidget();
    showHome();
}

function toggleModeFields() {
    const mode = document.getElementById('profStudyMode').value;
    document.getElementById('onlineFieldBlock').style.display = mode === 'Online' ? 'block' : 'none';
    document.getElementById('onsiteFieldBlock').style.display = mode === 'Onsite' ? 'block' : 'none';
}

function updateMatrixUI() {
    document.querySelectorAll('.matrix-cell').forEach(cell => {
        const key = `${cell.dataset.day}-${cell.dataset.slot}`;
        cell.classList.toggle('selected', profileSelectedSchedule.includes(key));
    });
}

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function safeHttpUrl(value) {
    try {
        const url = new URL(value);
        return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
}

async function refreshStudents() {
    const { users } = await api('students');
    renderBuddies(users);
}

function calculateMetrics(current, other) {
    if (!current?.hasProfile || !other?.hasProfile) return { score: 0, overlaps: [] };
    const a = current.profile;
    const b = other.profile;
    let score = 10;
    if (a.subject === b.subject) score += 30;
    if ((a.major || '').trim().toLowerCase() === (b.major || '').trim().toLowerCase()) score += 20;
    if (a.studyMode === b.studyMode) score += 20;
    const overlaps = (a.schedule || []).filter(slot => (b.schedule || []).includes(slot));
    if ((a.schedule || []).length && (b.schedule || []).length) score += Math.min(overlaps.length * 10, 20);
    return { score: Math.min(score, 100), overlaps };
}

function renderBuddies(users) {
    buddyList.replaceChildren();
    const subject = filterSubject.value;
    let students = users.filter(user => subject === 'All' || user.profile?.subject === subject);
    students = students.map(user => ({ ...user, ...calculateMetrics(currentUser, user) }));
    if (currentUser?.hasProfile) students.sort((a, b) => b.score - a.score);

    if (!students.length) {
        buddyList.innerHTML = '<div class="empty-state"><div class="empty-icon">◎</div><h3>No study friends yet</h3><p>Students who complete a profile will appear here. Your BINUS-assigned mentor is shown separately above.</p></div>';
        return;
    }

    students.forEach((peer, index) => {
        const profile = peer.profile || {};
        const online = profile.studyMode !== 'Onsite';
        const roomLink = safeHttpUrl(profile.roomLink || '');
        const schedule = (profile.schedule || []).map(slot =>
            `<span class="sched-tag ${peer.overlaps.includes(slot) ? 'overlap' : ''}">${escapeHTML(slot.replace('-', ' '))}</span>`
        ).join('');
        const card = document.createElement('div');
        card.className = 'buddy-card';
        card.innerHTML = `
            <div class="buddy-profile-block">
                <div class="avatar-placeholder">${escapeHTML((profile.name || 'S').charAt(0).toUpperCase())}</div>
                <div class="buddy-info">
                    <div class="buddy-title-row">
                        <h3>${escapeHTML(profile.name)}</h3>
                        <span class="mode-tag ${online ? 'online' : 'onsite'}">${escapeHTML(profile.studyMode)}</span>
                        <span class="match-badge">${peer.score}% Match</span>
                    </div>
                    ${index === 0 && currentUser?.hasProfile ? '<span class="top-match-label">Top study friend match</span>' : ''}
                    ${peer.isMentor ? '<span class="student-mentor-badge">BINUS student mentor</span>' : ''}
                    <div class="buddy-meta-details"><span class="buddy-major">${escapeHTML(profile.major)}</span><span class="meta-divider"></span><span class="tag">${escapeHTML(profile.subject)}</span></div>
                    <div class="skill-label">Expertise <strong>${escapeHTML(profile.skillHave)}</strong></div>
                    ${schedule ? `<div class="card-schedule-info"><strong>Availability</strong><div class="schedule-tag-container">${schedule}</div></div>` : ''}
                    <p class="buddy-bio">"${escapeHTML(profile.bio)}"</p>
                </div>
            </div>
            <div class="action-block">
                ${online ? (roomLink ? `<a href="${escapeHTML(roomLink)}" target="_blank" rel="noopener noreferrer" class="room-btn">Launch Space →</a>` : '<div class="location-display-box">No room link provided</div>') : `<div class="location-display-box"><strong>Campus</strong><br>${escapeHTML(profile.location || 'Campus')}</div>`}
                <button class="chat-btn" type="button">Message Study Friend</button>
            </div>`;
        card.querySelector('.chat-btn').addEventListener('click', () => openChatWidget(peer.id, profile.name || 'Study friend'));
        buddyList.append(card);
    });
}

function renderAssignedMentor() {
    const panel = document.getElementById('assignedMentorPanel');
    const content = document.getElementById('assignedMentorContent');
    const status = document.getElementById('assignedMentorStatus');
    const mentor = currentUser?.assignedMentor;
    content.replaceChildren();

    if (!mentor) {
        status.textContent = 'Not assigned yet';
        content.textContent = 'Your mentor will appear here after BINUS records an assignment to your account.';
        return;
    }

    status.textContent = 'Assigned by BINUS';
    const identity = document.createElement('div');
    identity.className = 'assigned-mentor-identity';
    const name = document.createElement('strong');
    name.textContent = mentor.profile?.name || 'Student mentor';
    const detail = document.createElement('span');
    detail.textContent = `NIM: ${mentor.nim || 'Not provided'}${mentor.profile?.major ? ` · ${mentor.profile.major}` : ''}`;
    identity.append(name, detail);
    content.append(identity);
    if (mentor.profile?.bio) {
        const bio = document.createElement('p');
        bio.textContent = mentor.profile.bio;
        content.append(bio);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chat-btn';
    button.textContent = 'Message your mentor';
    button.addEventListener('click', () => openChatWidget(mentor.id, mentor.profile?.name || 'Student mentor'));
    content.append(button);
}

function fillAccountSelect(select, users, placeholder) {
    select.replaceChildren();
    const first = document.createElement('option');
    first.value = '';
    first.textContent = placeholder;
    first.disabled = true;
    first.selected = true;
    select.append(first);
    users.forEach(user => {
        const option = document.createElement('option');
        option.value = user.id;
        option.textContent = `${user.profile?.name || 'Profile not completed'} · ${user.nim || 'NIM missing'} · ${user.email}`;
        select.append(option);
    });
    select.disabled = users.length === 0;
}

async function renderAdminPanel() {
    const panel = document.getElementById('adminPanel');
    panel.classList.toggle('is-hidden', !currentUser?.isAdmin);
    if (!currentUser?.isAdmin) return;

    try {
        const { users } = await api('admin/users');
        const studentSelect = document.getElementById('assignmentStudentSelect');
        const mentorSelect = document.getElementById('assignmentMentorSelect');
        const designationSelect = document.getElementById('mentorCandidateSelect');
        const mentors = users.filter(user => user.isMentor);
        fillAccountSelect(studentSelect, users, users.length ? 'Choose a student' : 'No student accounts yet');
        fillAccountSelect(mentorSelect, mentors, mentors.length ? 'Choose a student mentor' : 'Designate a student mentor first');
        fillAccountSelect(designationSelect, users, users.length ? 'Choose a student account' : 'No student accounts yet');
        const syncButton = () => {
            const target = users.find(user => String(user.id) === designationSelect.value);
            const button = document.querySelector('#mentorDesignationForm button[type="submit"]');
            if (button) button.textContent = target?.isMentor ? 'Remove mentor status' : 'Add as student mentor';
        };
        designationSelect.onchange = syncButton;
        syncButton();
    } catch (error) {
        const status = document.getElementById('adminStatus');
        status.textContent = error.message;
    }
}

async function openChatWidget(peerId, peerName) {
    activeChatPeerId = Number(peerId);
    chatWidgetTargetName.textContent = peerName;
    chatBackButton.classList.remove('is-hidden');
    chatWidgetForm.hidden = false;
    chatWidget.style.display = 'flex';
    await loadChatMessages();
}

function closeChatWidget() {
    activeChatPeerId = null;
    chatWidget.style.display = 'none';
}

function toggleChatInbox() {
    if (chatWidget.style.display === 'flex') closeChatWidget();
    else showChatInbox();
}

async function showChatInbox() {
    if (!currentUser) return;
    activeChatPeerId = null;
    chatWidgetTargetName.textContent = 'Your conversations';
    chatBackButton.classList.add('is-hidden');
    chatWidgetForm.hidden = true;
    chatWidget.style.display = 'flex';
    await renderChatInbox();
}

async function renderChatInbox() {
    chatWidgetBody.replaceChildren();
    try {
        const { contacts } = await api('chat/contacts');
        if (!contacts.length) {
            const empty = document.createElement('div');
            empty.className = 'chat-empty';
            empty.textContent = 'Complete a student profile or wait for your mentor assignment to start a conversation.';
            chatWidgetBody.append(empty);
            return;
        }
        contacts.forEach(contact => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'chat-contact';
            const name = document.createElement('strong');
            name.textContent = contact.profile?.name || (contact.isMentor ? 'Student mentor' : 'Student');
            const preview = document.createElement('span');
            preview.textContent = contact.recentMessage || (contact.isMentor ? 'BINUS student mentor' : 'Start a conversation');
            button.append(name, preview);
            button.addEventListener('click', () => openChatWidget(contact.id, name.textContent));
            chatWidgetBody.append(button);
        });
    } catch (error) {
        const empty = document.createElement('div');
        empty.className = 'chat-empty';
        empty.textContent = error.message;
        chatWidgetBody.append(empty);
    }
}

async function loadChatMessages() {
    if (!currentUser || !activeChatPeerId) return;
    chatWidgetBody.replaceChildren();
    try {
        const { messages } = await api(`chat/messages?peerId=${encodeURIComponent(activeChatPeerId)}`);
        if (!messages.length) {
            const empty = document.createElement('div');
            empty.className = 'chat-empty';
            empty.textContent = 'Start the conversation with your peer.';
            chatWidgetBody.append(empty);
        }
        messages.forEach(message => {
            const bubble = document.createElement('div');
            bubble.className = `chat-bubble ${message.senderId === currentUser.id ? 'sent' : 'received'}`;
            bubble.textContent = message.text;
            chatWidgetBody.append(bubble);
        });
        chatWidgetBody.scrollTop = chatWidgetBody.scrollHeight;
    } catch (error) {
        const empty = document.createElement('div');
        empty.className = 'chat-empty';
        empty.textContent = error.message;
        chatWidgetBody.append(empty);
    }
}

async function showSupportForm() {
    const email = document.getElementById('supportEmail');
    if (email && currentUser?.email) email.value = currentUser.email;
    document.getElementById('supportStatus').textContent = '';
    document.getElementById('supportDialog')?.showModal();
}

function closeSupportForm() {
    document.getElementById('supportDialog')?.close();
}

authForm.addEventListener('submit', async event => {
    event.preventDefault();
    const email = document.getElementById('authEmail').value.trim().toLowerCase();
    const password = document.getElementById('authPassword').value;
    const payload = { email, password };
    if (currentAuthMode === 'register') payload.nim = document.getElementById('authNim').value.trim();

    try {
        const { user } = await api(`auth/${currentAuthMode === 'register' ? 'register' : 'login'}`, {
            method: 'POST', body: JSON.stringify(payload)
        });
        currentUser = user;
        await showDashboard();
    } catch (error) {
        showError(error);
    }
});

profileForm.addEventListener('submit', async event => {
    event.preventDefault();
    const studyMode = document.getElementById('profStudyMode').value;
    const profile = {
        name: document.getElementById('profName').value.trim(),
        major: document.getElementById('profMajor').value.trim(),
        subject: document.getElementById('profSubject').value,
        skillHave: document.getElementById('profSkill').value.trim(),
        studyMode,
        roomLink: studyMode === 'Online' ? document.getElementById('profRoomLink').value.trim() : '',
        location: studyMode === 'Onsite' ? document.getElementById('profLocation').value.trim() : '',
        bio: document.getElementById('profBio').value.trim(),
        schedule: [...profileSelectedSchedule]
    };
    try {
        currentUser = (await api('profile', { method: 'PUT', body: JSON.stringify({ profile }) })).user;
        document.getElementById('userGreetingName').textContent = profile.name;
        await refreshStudents();
        alert('Your Peer2Peer profile has been updated.');
    } catch (error) {
        showError(error);
    }
});

document.getElementById('mentorDesignationForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const select = document.getElementById('mentorCandidateSelect');
    const target = select.value;
    const { users } = await api('admin/users').catch(error => { showError(error); return { users: [] }; });
    const account = users.find(user => String(user.id) === target);
    if (!account) return;
    const status = document.getElementById('adminStatus');
    try {
        await api('admin/mentors', {
            method: 'POST',
            body: JSON.stringify({ userId: Number(target), isMentor: !account.isMentor })
        });
        status.textContent = account.isMentor
            ? `${account.profile?.name || account.email} was removed from the student mentor list.`
            : `${account.profile?.name || account.email} is now a student mentor.`;
        await renderAdminPanel();
        await refreshStudents();
    } catch (error) {
        status.textContent = error.message;
    }
});

document.getElementById('mentorAssignmentForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const studentId = Number(document.getElementById('assignmentStudentSelect').value);
    const mentorId = Number(document.getElementById('assignmentMentorSelect').value);
    const status = document.getElementById('adminStatus');
    try {
        await api('admin/assignments', { method: 'POST', body: JSON.stringify({ studentId, mentorId }) });
        status.textContent = 'Mentor assignment saved.';
        await renderAdminPanel();
        if (studentId === currentUser?.id) {
            currentUser = (await api('auth/me')).user;
            renderAssignedMentor();
        }
        await renderChatInboxIfOpen();
    } catch (error) {
        status.textContent = error.message;
    }
});

async function renderChatInboxIfOpen() {
    if (chatWidget.style.display === 'flex' && !activeChatPeerId) await renderChatInbox();
}

document.getElementById('profStudyMode').addEventListener('change', toggleModeFields);
document.querySelectorAll('.matrix-cell').forEach(cell => {
    cell.addEventListener('click', () => {
        const key = `${cell.dataset.day}-${cell.dataset.slot}`;
        profileSelectedSchedule = profileSelectedSchedule.includes(key)
            ? profileSelectedSchedule.filter(item => item !== key)
            : [...profileSelectedSchedule, key];
        updateMatrixUI();
    });
});

filterSubject.addEventListener('change', () => refreshStudents().catch(showError));
chatWidgetForm.addEventListener('submit', async event => {
    event.preventDefault();
    const message = chatWidgetInput.value.trim();
    if (!message || !activeChatPeerId) return;
    try {
        await api('chat/messages', {
            method: 'POST', body: JSON.stringify({ peerId: activeChatPeerId, message })
        });
        chatWidgetInput.value = '';
        await loadChatMessages();
    } catch (error) { showError(error); }
});

document.getElementById('supportForm')?.addEventListener('submit', event => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const subject = `[Peer2Peer Support] ${formData.get('topic')}`;
    const body = [`Reply to: ${formData.get('email')}`, '', formData.get('message')].join('\n');
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    document.getElementById('supportStatus').textContent = 'Your email app should open with your message ready to send.';
});

async function boot() {
    setTheme(localStorage.getItem('p2p_theme') === 'dark' ? 'dark' : 'light');
    try {
        currentUser = (await api('auth/me')).user;
        await showDashboard();
    } catch {
        currentUser = null;
        showHome();
    }
}

boot();
