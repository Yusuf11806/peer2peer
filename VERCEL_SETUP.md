# Deploy Peer2Peer to Vercel

The project is a static HTML/CSS frontend with Vercel Node.js Functions under `api/`. User accounts, profiles, mentor assignments, and chat messages are stored in PostgreSQL instead of browser storage.

## 1. Create a PostgreSQL database

In the Vercel project, add a PostgreSQL provider from the Marketplace (for example, Neon). Copy its pooled connection string into the project environment variable `DATABASE_URL`. Vercel's former first-party Postgres product has been replaced by Marketplace database integrations. [Vercel Postgres docs](https://vercel.com/docs/postgres)

## 2. Set environment variables

Add these variables in Vercel Project Settings → Environment Variables for Production and Preview:

- `DATABASE_URL`: pooled PostgreSQL connection string.
- `SESSION_SECRET`: a random secret with at least 32 characters.
- `ADMIN_EMAIL`: `yusuf.daniel@binus.ac.id`.
- `ADMIN_PASSWORD`: a unique, strong password for the admin account.

Keep secrets out of source control. Environment variable changes apply to new deployments, so redeploy after changing them. [Vercel environment variables](https://vercel.com/docs/environment-variables)

The database tables are created automatically when the API receives its first request. The admin account is initialized from `ADMIN_EMAIL` and `ADMIN_PASSWORD`; admin access is not available through public registration.

After deployment, open `/api/health` on the deployed site. A healthy response reports `database: "connected"` and confirms the admin and session variables are configured. If it returns an error, use that message and the Vercel Function logs to correct the project settings.

## 3. Deploy

Import this repository as a Vercel project with the repository root as the project root. The selected root must contain `index.html`, `package.json`, `vercel.json`, `api/`, and `lib/`. Keep the Root Directory setting at the repository root; setting it to a nested folder prevents Vercel from seeing the API functions. Vercel detects the `api/` functions and serves `index.html`, `script.js`, and `style.css` as static assets. No frontend build step or custom route rewrite is required. [Vercel Functions](https://vercel.com/docs/functions)

If a deployed `/api/...` URL says the route cannot be found, open **Project Settings → Build and Deployment** and check that **Root Directory** points to the folder containing `api/` (the repository root). Then deploy the latest commit that includes the `api/` and `lib/` folders. After deployment, visit `/api/health`; a JSON response means Vercel found the function. A JSON error about environment variables or the database means routing works and the corresponding project settings still need attention.

For local development, copy `.env.example` to `.env`, fill in real values, install packages with `npm install`, then run `npm run dev`.

## Admin workflow

Sign in with the configured admin email and password. Use **Student mentor list** to designate a student account as a mentor, then use **Assign a mentor** to connect that mentor to a student. Students see their assignment in the BINUS mentor panel. All student accounts remain eligible to find study friends.

## Current scope

- Accounts, assignments, and chats are shared through PostgreSQL across deployments and devices.
- Existing accounts in the previous browser `localStorage` prototype are not migrated; users must register again.
- The app does not verify email ownership or BINUS NIMs with BINUS. Add institutional identity verification before using it for real student records.
- Support requests open a prefilled email to the configured support address in the user's email application.
