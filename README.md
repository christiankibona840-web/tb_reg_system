# TBSS Registration System

This project is a static website (HTML files) plus an optional Node/Express backend (`server.js`).
The backend stores data in **Supabase** and can also send email notifications (SMTP).

## Run locally (optional)

1. Create `.env` from `.env.example` and fill values.
2. Install and start:

```bash
npm install
npm run start
```

Backend runs on `http://localhost:5000`.

## Deploy online (recommended)

### Option A — Deploy backend + frontend (easiest)

- **Backend**: deploy `server.js` to Render/Railway/Fly.io/etc.
  - Set environment variables from `.env.example`
  - Set `FRONTEND_URL` to your deployed frontend origin (for CORS)
- **Frontend**: deploy the HTML files to Netlify/Vercel/GitHub Pages.
  - In `config.js`, set:
    - `window.APP_CONFIG.API_BASE = 'https://YOUR-BACKEND-DOMAIN'`

After this, pages will call:

- `${API_BASE}/api/register`
- `${API_BASE}/api/registration-status`
- `${API_BASE}/api/pdf-layout`
- etc.

### Option B — Same-origin deployment (single host)

Host the static files and the Node backend under the **same domain** (same origin).
In this case `config.js` can keep:

- `window.APP_CONFIG.API_BASE = ''`

and the pages will automatically call `/api/...` on the same domain.

## Notes about Supabase keys

- **Anon key** is public and can be used in the browser.
- **Service role key** must stay secret and should only be used on the server (recommended if you need admin access and to bypass RLS).

# tb_reg_system (Online + Supabase)

This project is designed to run **online** (not `localhost`) and store data in **Supabase**.

## Supabase setup

1. In Supabase, open **SQL Editor** and run:
   - `supabase/schema.sql`
2. In Supabase **Storage**, create a bucket named:
   - `registrations`

## Environment variables

Create `.env` based on `.env.example`.

Required:
- `SUPABASE_URL=https://mfkvwcryiclehbrkqthu.supabase.co`
- **Recommended**: `SUPABASE_SERVICE_ROLE_KEY=...` (server-side only)
  - Or (not recommended): `SUPABASE_ANON_KEY=...`

Optional (email sending):
- `SMTP_USER`, `SMTP_PASS`, `SMTP_SERVICE`, `SCHOOL_EMAIL`

## Run locally (for development only)

```bash
npm install
npm start
```

Open:
- `/shudi.html`
- `/admin.html`

## Deploy online (Render)

1. Push this repo to GitHub.
2. In Render, create a **Web Service** from the repo.
3. Render will use `render.yaml` automatically (or set):
   - Build: `npm install`
   - Start: `npm start`
4. In Render **Environment**, set secrets:
   - `SUPABASE_SERVICE_ROLE_KEY` (recommended)
   - (optional) SMTP variables
5. After deploy, open:
   - `https://<your-domain>/shudi.html`
   - `https://<your-domain>/records.html?id=<studentId>`
   - `https://<your-domain>/admin.html`

## Notes
- Frontend pages call the backend using **same-origin** `/api/...` (works online).
- Do **not** open HTML via `file://` if you want `/api` to work. Use the hosted URLs.
Tabora boys smart registration
