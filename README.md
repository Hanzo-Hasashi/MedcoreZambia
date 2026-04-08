# MedCore Zambia — Supabase Edition

Medical learning platform for UNZA, CBU & Levy Mwanawasa Medical University students.  
Built with **Supabase** (auth + database) and deployed on **Vercel**.

---

## Architecture Overview

```
medcore-supabase/
├── public/
│   ├── index.html              ← Landing page
│   ├── medcore-v3.html         ← Main app (auth, dashboard, quiz, AI tutor, admin)
│   └── supabase-client.js      ← Supabase wrapper (auth, progress, content, admin)
├── api/
│   ├── ai.js                   ← Vercel serverless: Claude AI proxy (key never reaches browser)
│   └── admin.js                ← Vercel serverless: admin CRUD (service role only)
├── supabase/
│   ├── config.toml             ← Supabase CLI config (local dev)
│   └── migrations/
│       ├── 001_initial_schema.sql  ← Users, profiles, progress, RLS, triggers
│       └── 002_content_tables.sql  ← Subjects, lessons, quiz questions, flashcards + seed data
├── scripts/
│   ├── inject-env.js           ← Build script: injects env vars into HTML at Vercel build time
│   └── dev-server.js           ← Local dev server (no Vercel CLI needed)
├── .env.example                ← Template — copy to .env.local and fill in values
├── .env.local                  ← Your local secrets (git-ignored)
├── vercel.json                 ← Vercel routing + security headers
└── package.json
```

### Data flow

```
Browser  ──→  Supabase Auth (Google OAuth)    ← session management
         ──→  Supabase DB (RLS-protected)     ← user progress, content, profiles
         ──→  /api/ai      (Vercel fn)        ← Claude proxy (ANTHROPIC_API_KEY server-side)
         ──→  /api/admin   (Vercel fn)        ← admin ops (SERVICE_ROLE_KEY server-side)
```

**Secrets that NEVER reach the browser:**
- `ANTHROPIC_API_KEY` — only in `api/ai.js`
- `SUPABASE_SERVICE_ROLE_KEY` — only in `api/admin.js` and `api/ai.js`

**Safe to expose (anon key — RLS enforces all access control):**
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## Quick Start

### 1. Clone & install

```bash
git clone https://github.com/your-org/medcore-zambia.git
cd medcore-zambia/medcore-supabase
npm install
```

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**
2. Note your **Project URL** and **anon/public key** → Settings → API
3. Note your **service_role key** (keep this secret — never commit it)

### 3. Run the database migrations

In the **Supabase Dashboard → SQL Editor**, run both files **in order**:

1. `supabase/migrations/001_initial_schema.sql` — creates users, profiles, progress tables, RLS policies, and the auto-profile trigger
2. `supabase/migrations/002_content_tables.sql` — creates subjects, lessons, quiz questions, flashcards, and seeds starter content

### 4. Enable Google OAuth in Supabase

1. Supabase Dashboard → **Authentication → Providers → Google**
2. Enable Google, enter your OAuth **Client ID** and **Client Secret**
3. Copy the **Callback URL** shown (e.g. `https://xxxx.supabase.co/auth/v1/callback`)
4. In [Google Cloud Console](https://console.cloud.google.com):
   - APIs & Services → Credentials → OAuth 2.0 Client
   - Add your domain to **Authorised JavaScript Origins**
   - Add the Supabase callback URL to **Authorised redirect URIs**

### 5. Set up environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` with your real values:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
ANTHROPIC_API_KEY=sk-ant-api03-...
ADMIN_EMAILS=youremail@gmail.com
APP_DOMAIN=
```

> **`ADMIN_EMAILS`** — comma-separated list of Google email addresses that get admin access.  
> Must exactly match the email you sign in with via Google OAuth.  
> Example: `ADMIN_EMAILS=alice@gmail.com,bob@gmail.com`

### 6. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The dev server automatically injects your Supabase URL and anon key into the HTML on every request, so you never need to run the build script locally.

---

## Deploy to Vercel

### Option A — CLI (quickest)

```bash
npx vercel
```

Follow the prompts, then add environment variables in **Vercel Project → Settings → Environment Variables**.

### Option B — GitHub (recommended for teams)

1. Push this repo to GitHub
2. In Vercel → **Import Project** → select your repo, set **Root Directory** to `medcore-supabase`
3. Add all environment variables (see table below)
4. Deploy — `scripts/inject-env.js` runs automatically as the build command

### Environment variables to add in Vercel

| Variable | Value | Expose to browser? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxx.supabase.co` | ✅ Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGci...` | ✅ Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGci...` | ❌ Never |
| `ANTHROPIC_API_KEY` | `sk-ant-api03-...` | ❌ Never |
| `ADMIN_EMAILS` | `you@gmail.com` | ❌ Never |
| `APP_DOMAIN` | `your-app.vercel.app` | ❌ Never |

### After deploying

Add your Vercel domain to:
- **Google Cloud Console → OAuth Credentials → Authorised JavaScript Origins**
- **Supabase Dashboard → Authentication → URL Configuration → Site URL**
- **Supabase Dashboard → Authentication → URL Configuration → Redirect URLs**  
  Add: `https://your-app.vercel.app/**`

---

## Database Schema

### Tables

| Table | Purpose | RLS |
|---|---|---|
| `profiles` | User roles (`admin`/`student`) and status (`pending`/`active`/`free`) | Users read own; admins read all |
| `user_progress` | XP, streaks, quiz history, flashcards, subject progress | Users read/write own; admins read all |
| `completed_lessons` | Which lesson IDs a user has finished | Users own only |
| `materials` | Admin-uploaded study materials (PDFs, past papers) | Free/premium split enforced by RLS |
| `recommendations` | Admin messages/announcements | Read by all authenticated users |
| `subjects` | Subject catalogue (anatomy, physiology, etc.) | Public read (active only) |
| `lessons` | Lesson content (HTML body) per subject | Free/premium split by RLS |
| `quiz_questions` | MCQ bank per subject | Free/premium split by RLS |
| `flashcards` | Spaced-repetition cards per subject | Free/premium split by RLS |

### Granting premium access to a student

**Via Admin Panel (recommended):**  
Sign in as admin → navigate to Admin → Users → click Activate next to the student.

**Via Supabase SQL Editor:**
```sql
UPDATE public.profiles
SET status = 'active'
WHERE email = 'student@example.com';
```

---

## Access Control

| Status | Access |
|---|---|
| `pending` | Free content only (sample questions, basic lessons, 5 AI questions/day) |
| `active` | Full premium access (all questions, past papers, unlimited AI tutor) |
| `free` | Explicitly free tier — same as pending |
| `admin` | Full access + admin panel |

Access is enforced at **two levels**:
1. **Database (RLS)** — Supabase blocks premium content at the query level for non-active users
2. **UI** — Premium sections show a paywall modal before the DB query is even made

---

## Making Changes

### Adding admin users

Set `ADMIN_EMAILS` in your `.env.local` (local) or Vercel environment variables (production):
```env
ADMIN_EMAILS=alice@gmail.com,bob@gmail.com
```

> The SQL trigger `handle_new_user` also has a hardcoded admin list for the DB role.  
> Update that list in `001_initial_schema.sql` and re-run the `CREATE OR REPLACE FUNCTION` block in the Supabase SQL Editor to keep both in sync.

### Adding content (lessons, questions, flashcards)

All content is stored in Supabase and loaded dynamically. Use the **Admin Panel** in the app:
- Sign in as admin → Admin → Content tab
- Add/edit/delete subjects, lessons, quiz questions, and flashcards

### Changing the AI model

Edit `api/ai.js`:
```js
model: 'claude-sonnet-4-6',
```

### AI rate limiting

The server enforces **60 AI questions per hour per user** via an in-memory rate limiter in `api/ai.js`. This resets on Vercel cold-starts. For persistent rate limiting across cold-starts, add a `ai_requests` table to Supabase and query it in `api/ai.js`.

### Adjusting the K50/month price

Edit the pricing section in `public/index.html` — search for `K50`.

---

## Security Model

- **No secrets in the browser** — `ANTHROPIC_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` only exist server-side in Vercel Functions
- **RLS everywhere** — every table has Row Level Security; the anon key can only do what policies allow
- **Admin verification is double-checked** — `api/admin.js` verifies the caller's JWT email against `ADMIN_EMAILS` on every request, independent of the DB role
- **XSS prevention** — user-sourced content is displayed via `esc()` helper or DOM API, never raw `innerHTML`
- **CORS** — API routes only allow your domain (`APP_DOMAIN`) and Vercel preview URLs
- **Security headers** — `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, CSP, etc. set in `vercel.json`

---

## Stack

| Layer | Technology |
|---|---|
| Auth | Supabase Auth (Google OAuth 2.0) |
| Database | Supabase (PostgreSQL + Row Level Security) |
| AI Proxy | Vercel Serverless → Anthropic Claude Sonnet |
| Admin API | Vercel Serverless → Supabase service role |
| Frontend | Vanilla HTML/CSS/JS (no framework, no build step) |
| Deployment | Vercel |
| Spaced repetition | SM-2 algorithm (flashcards) |

---

## Contact

hello@medcore.app  
© 2025 MedCore Zambia · Built for Zambian medical students 🇿🇲
