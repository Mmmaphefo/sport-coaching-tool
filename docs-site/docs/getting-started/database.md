---
sidebar_position: 3
---

# Deployment Architecture

KickStat is deployed across three free-tier services, each chosen for a specific role in the stack. This document explains **why** each platform was selected and how they fit together.

## Hosting Overview

| Layer | Service | Role | URL |
|-------|---------|------|-----|
| Backend API | **Render** | Node.js REST API | `kickstat-api.onrender.com` |
| Database | **Neon** | Managed PostgreSQL | Serverless, auto-suspend |
| Frontend | **Cloudflare Pages** | Static React SPA | `kickstat.pages.dev` |
| Email | **Brevo** | Transactional emails | HTTPS API delivery (replaced Resend) |
| Auth | **Clerk** | User authentication | Hosted sign-in/sign-up |

---

## Why Render for the Backend

**Render** hosts the Node.js Express API (`kickstat-api`).

### Why Render over alternatives

| Criterion | Render | Heroku | Railway | Vercel (API) |
|-----------|--------|--------|---------|--------------|
| Free tier | Permanent, no expiry | Removed (2022) | Trial credits only | Serverless functions only |
| PostgreSQL support | Yes (via external DB) | Add-on (paid) | Built-in (trial) | No |
| Auto-deploy from Git | Yes | Yes | Yes | Yes |
| Custom start command | Yes | Yes | Yes | Limited |
| Health checks | Built-in | Built-in | Built-in | N/A |

### Key reasons

1. **Permanent free tier** — Render's free plan does not expire or require trial credits. Heroku removed its free tier in 2022; Railway and other alternatives use time-limited trial credits that run out. For a university project with an indefinite timeline, permanence was essential.

2. **Git-based auto-deploy** — Every push to `main` triggers an automatic build and deploy. The `render.yaml` Blueprint defines the service declaratively, so the deployment configuration lives in the repo alongside the code.

3. **Custom start command** — Render runs `npx node-pg-migrate up && node src/app.js`, which applies pending database migrations before booting the API. This ensures the schema is always up to date after a deploy, with no separate migration step needed.

4. **Health check support** — Render monitors `/api/health` and restarts the service if it becomes unresponsive, providing basic reliability without extra configuration.

### Trade-offs

- **Cold starts** — Render's free tier spins down after 15 minutes of inactivity. The first request after idle can take 30-50 seconds. This is acceptable for a demo/academic project but would need upgrading for production use.
- **SMTP blocked** — Render's free plan blocks outbound SMTP ports (25, 465, 587). This is why we switched from Gmail SMTP to an HTTP email API: first Resend, then **Brevo**, because Resend cannot send to outside recipients without a verified domain we own. See the [Brevo decision record](../third-party/brevo#why-we-use-brevo-decision-record).

---

## Why Neon for the Database

**Neon** provides the managed PostgreSQL database.

### Why Neon over alternatives

| Criterion | Neon | Supabase | Render DB | ElephantSQL |
|-----------|------|----------|-----------|-------------|
| Free tier | 0.5 GB, no expiry | 0.5 GB, no expiry | $7/mo (no free tier) | Deprecated (shutting down 2025) |
| Serverless | Yes (auto-suspend) | No | No | No |
| Branching | Yes (database branching) | No | No | No |
| Direct connection | Yes | Yes | Yes | Yes |
| PostgreSQL version | 16+ | 15+ | 14+ | 14+ |

### Key reasons

1. **Permanent free tier** — Like Render, Neon's free tier does not expire. The 0.5 GB storage limit is sufficient for KickStat's data (athletes, events, log entries, tactics).

2. **Serverless architecture** — Neon auto-suspends the database after inactivity and resumes on the next connection. This keeps costs at zero while the project is not actively being used.

3. **Direct connection support** — Render's migration tool (`node-pg-migrate`) requires a direct PostgreSQL connection. Neon provides both a pooled connection (for app traffic) and a direct connection (for migrations). The `render.yaml` explicitly uses the direct connection URL for migrations.

4. **Database branching** — Neon supports branching (like Git branches for your database), which is useful for testing schema changes without affecting production data.

### Trade-offs

- **Auto-suspend latency** — After 5 minutes of inactivity, Neon suspends the compute. The first query after suspend takes 1-2 seconds to resume. Combined with Render's cold start, the first request after full idle can take 30+ seconds.
- **Storage limit** — 0.5 GB is generous for text-based sports data but would need monitoring if storing large media files.

---

## Why Cloudflare Pages for the Frontend

**Cloudflare Pages** hosts the React frontend as a static site.

### Why Cloudflare Pages over alternatives

| Criterion | Cloudflare Pages | Vercel | Netlify | GitHub Pages |
|-----------|-----------------|--------|---------|--------------|
| Free tier | Unlimited bandwidth | 100 GB/mo | 100 GB/mo | 1 GB/mo |
| Build minutes | 500/mo | Unlimited | 300/mo | N/A (static only) |
| Custom domains | Yes | Yes | Yes | Yes |
| Edge network | Cloudflare global CDN | Vercel Edge | Netlify Edge | GitHub CDN |
| SPA routing | `_redirects` file | `vercel.json` | `_redirects` | Manual config |
| Git auto-deploy | Yes | Yes | Yes | Yes |

### Key reasons

1. **Unlimited bandwidth on free tier** — Cloudflare Pages does not cap bandwidth, unlike Vercel (100 GB/mo) and Netlify (100 GB/mo). For a public-facing demo that may receive traffic from assessors, unlimited bandwidth removes the risk of overage charges.

2. **Global edge network** — Cloudflare's CDN serves the static assets from edge locations worldwide, providing fast load times regardless of user location.

3. **Git-based deployment** — The `wrangler.jsonc` config defines the project name and build output directory (`frontend/dist`). The CI pipeline runs `npx wrangler pages deploy --branch=main --force` to publish automatically.

4. **SPA fallback routing** — The `frontend/public/_redirects` file (`/* /index.html 200`) ensures all client-side routes (e.g., `/dashboard`, `/live/5`) serve `index.html` so React Router can handle navigation.

### Trade-offs

- **Classic vs. Workers Assets** — Cloudflare has two Pages modes. We use **classic Pages** (configured via `wrangler.jsonc`) rather than the newer Workers Assets mode, because classic Pages is simpler for a pure static SPA and avoids the interactive project selector that blocks CI automation.
- **No server-side rendering** — As a static host, Cloudflare Pages cannot run server-side code. All API calls go to the Render backend. This is fine for KickStat's architecture (decoupled frontend/backend).

---

## How the Pieces Connect

```
┌─────────────────────────────────────────────────────────────┐
│                      User's Browser                         │
│  kickstat.pages.dev (Cloudflare Pages - React SPA)          │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS (API calls)
                           ▼
─────────────────────────────────────────────────────────────┐
│                  Render (Node.js API)                        │
│  kickstat-api.onrender.com (Express + Clerk auth)            │
└──────────────────────────┬──────────────────────────────────┘
                           │ DATABASE_URL (Postgres protocol)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  Neon (PostgreSQL)                           │
│  Serverless, auto-suspend, 0.5 GB free tier                  │
└─────────────────────────────────────────────────────────────┘
```

1. **User loads the app** → Cloudflare serves the React SPA from its edge network
2. **React makes API calls** → Requests go to `kickstat-api.onrender.com` (configured via `VITE_API_URL`)
3. **Render handles auth** → Clerk middleware validates the user's session
4. **Render queries the database** → Direct connection to Neon's PostgreSQL
5. **Email notifications** → Brevo API sends invite/reminder emails (HTTP, not SMTP)

---

## Environment Variables

The deployment requires these environment variables, configured in Render's dashboard:

| Variable | Source | Purpose |
|----------|--------|---------|
| `DATABASE_URL` | Neon dashboard | PostgreSQL connection string (direct, not pooled) |
| `CLERK_SECRET_KEY` | Clerk dashboard | Server-side auth verification |
| `CLERK_PUBLISHABLE_KEY` | Clerk dashboard | Client-side auth (baked into frontend build) |
| `FRONTEND_URL` | Cloudflare Pages URL | CORS allowlist + email links |
| `BREVO_API_KEY` | Brevo dashboard (SMTP & API → API Keys) | Transactional email delivery |
| `EMAIL_FROM` | Verified Brevo sender | Sender address, e.g. `KickStat <kickstat.team@gmail.com>` |
| `RESEND_API_KEY` | Resend dashboard | Optional fallback, used only when `BREVO_API_KEY` is unset |
| `NODE_ENV` | Set to `production` | Enables production mode in Express |

---

## Deployment Commands

### Backend (Render)
Render auto-deploys on every push to `main` using the `render.yaml` Blueprint:
```yaml
buildCommand: npm ci
startCommand: npx node-pg-migrate up --no-check-order && node src/app.js
```

### Frontend (Cloudflare Pages)
The CI pipeline deploys the frontend after tests pass:
```bash
cd frontend && npm ci && npm run build
npx wrangler pages deploy --branch=main --force
```

### Database Migrations
Migrations run automatically on every Render deploy via the start command. To run locally:
```bash
cd backend && npx node-pg-migrate up
```
