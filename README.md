[![codecov](https://codecov.io/gh/mmmaphefo/sport-coaching-tool/graph/badge.svg?token=jLHQL40tsX)](https://codecov.io/gh/mmmaphefo/sport-coaching-tool)

 # Kickstat — Sport Coaching Tool

A full-stack web application for sports coaches and assistants to manage squads, schedule events, log live match data, and run multi-team leagues and tournaments.

![CI](https://sdpm.ms.wits.ac.za/bug-off/sport-coaching-tool/actions/workflows/ci.yml/badge.svg)

## Features

### Squad Management
- Create and manage your squad with athlete rosters
- Track athlete details: name, position, squad number, date of birth, contact info
- Role-based access: coaches can manage the roster, assistants can view only

### Event Scheduling
- Schedule matches and training sessions
- Set date/time, location, duration, and opponent
- Auto-transition: events automatically go live at the scheduled time and end when the duration expires

### Live Match Logging (US13 / US14 / US15)
- Log live actions during a match: goals, assists, shots on target, saves, yellow/red cards, substitutions, penalties
- Record actions for your squad (select an athlete) or the opposition (no athlete selected)
- **Edit** or **Undo** log entries in real time
- View the final score, goal scorers with minutes, and card history after the match

### Leagues & Tournaments
- Create a league or tournament event with a name and required number of teams
- Other coaches join the event until it's full
- Auto-generates a **round-robin schedule** (home and away — 2 fixtures per pair)
- **Live standings table** sorted by standard football rules: points (3/1/0), goal difference, goals for
- **Top scorers** and **top assisters** charts across all fixtures
- Home team's coach or assistant logs live data for each fixture

### Role-Based Access
- **Coach**: full access to roster management, event creation, live logging, and settings
- **Assistant**: can log live data and view the roster, but cannot add/edit/delete athletes
- Assistants are invited by coaches via unique invite links

### Availability & Scheduling Intelligence (Sprint 3)
- Athletes RSVP to events; matches only start once enough players are available
- Clash detection warns about scheduling conflicts before and after creation
- Auto-transition sweep starts events at kickoff and ends them when the duration expires
- Squad gender (male/female) with matchmaking filters for open leagues

### Coaching Tools (Sprint 3)
- Athlete comparison page with BMI and form
- Team vs opponents comparison over any period, optionally against a second period (e.g. this season against last), with a per-opponent record
- Printable season and match reports (Print / Save as PDF) with CSV export of results, player totals and match timelines
- Tactics board with saved frames and the sessions / drill library (filterable by tactical goals, age group, duration, and phase)
- Ratings-weighted match simulation (Quick Sim / Simulate Match) for events and fixtures
- Coach-only stat overrides with an audit trail, merged over derived stats
- Venue map on Mapbox's dark navigation basemap — search the venue by address,
  drop a high-accuracy GPS pin, fine-tune by dragging, copy the exact
  coordinates, and centre the weather widget on the pin (OpenStreetMap
  fallback when no Mapbox token is set)
- Offline logging queue with basic idempotent replay (client_id deduplication) for weak-signal pitch-side use

### Public Pages (Sprint 3)
- Public squad pages and a public landing directory of squads with live events
- Shareable private links with CSV roster export
- Email reminders before events and invite emails, both sent via Resend

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, Vite, React Router, Clerk (auth UI) |
| **Backend** | Node.js, Express, PostgreSQL, node-pg-migrate |
| **Authentication** | Clerk (sign up, sign in, password reset, account deletion) |
| **Testing** | Vitest, Supertest (integration tests) |
| **CI/CD** | Gitea Actions (lint, build, test on every push) |
| **Linting** | ESLint |

## Project Structure

```
sport-coaching-tool/
├── backend/
│   ├── migrations/          # PostgreSQL schema migrations
│   ├── src/
│   │   ├── middleware/      # Auth middleware (Clerk)
│   │   ├── routes/          # Express route handlers
│   │   └── app.js           # Express app entry
│   └── tests/
│       └── integration/     # Vitest integration tests
├── frontend/
│   ├── src/
│   │   ├── components/      # Shared UI components
│   │   ├── lib/             # API client, action constants
│   │   ├── pages/           # Route-level page components
│   │   ├── App.jsx          # Router configuration
│   │   └── main.jsx         # React entry point
│   └── index.html
├── .gitea/workflows/
│   └── ci.yml               # CI pipeline configuration
└── README.md
```

## Getting Started

### Prerequisites

- **Node.js** 22+
- **PostgreSQL** 16+
- **Clerk** account (free tier works) — [dashboard.clerk.com](https://dashboard.clerk.com)
- **Mapbox** account (optional, free tier works, no credit card) —
  [mapbox.com](https://mapbox.com). The public token unlocks the venue map's
  dark basemap and address search; without it the map falls back to
  OpenStreetMap

### 1. Clone the repository

```sh
git clone <your-repo-url>
cd sport-coaching-tool
```

### 2. Set up the database

```sh
createdb sportcoach
# Or use psql:
# CREATE DATABASE sportcoach;
```

### 3. Configure environment variables

**Backend** (`backend/.env`):
```env
DATABASE_URL=postgresql://<user>@localhost:5432/sportcoach
PORT=3000
NODE_ENV=development
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
FRONTEND_URL=http://localhost:5173
```

**Frontend** (`frontend/.env`):
```env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
VITE_API_URL=http://localhost:3000
# Optional - unlocks the Mapbox venue map (dark basemap + address search).
# Leave unset to use the OpenStreetMap fallback.
VITE_MAPBOX_TOKEN=
```

### 4. Run migrations

```sh
cd backend
npm install
npx node-pg-migrate up
```

### 5. Start the servers

```sh
# Terminal 1: Backend
cd backend
npm run dev

# Terminal 2: Frontend
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### 6. Sign up

- Register with any email via Clerk
- You'll automatically be assigned the **Coach** role and a squad will be created
- To add assistants: use the "Invite an Assistant" section on the Dashboard

## Running Tests

```sh
cd backend
npm test              # Run all integration tests
npm run test:coverage # Integration tests + HTML coverage report (backend/coverage/index.html)
npm run lint          # Lint backend code

cd frontend
npm test              # Run all component tests
npm run test:coverage # Component tests + HTML coverage report (frontend/coverage/index.html)
npm run lint          # Lint frontend code
npm run build         # Production build
```

### Coverage dashboard

Every green CI run publishes the combined backend + frontend coverage reports
to [kickstat-coverage.netlify.app](https://kickstat-coverage.netlify.app). The
landing page shows each suite's line coverage with links to the full HTML
reports. Coverage is also uploaded to Codecov and stored as workflow
artifacts (`backend-coverage`, `frontend-coverage`) on each CI run.

## API Endpoints

Interactive API documentation (Swagger UI) is served by the backend at `/api/docs` in non-test environments, generated from [`backend/openapi.yml`](backend/openapi.yml). The table below is a quick reference; the OpenAPI spec is the full contract.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check (no auth) |
| GET | `/api/me` | Current user ID from JWT |
| GET / DELETE | `/api/account/me` | Profile / delete account |
| GET / PATCH | `/api/squads/mine` | Get or update squad (name, gender, public visibility) |
| GET / POST | `/api/athletes` | List or add athletes |
| GET | `/api/athletes/:id/stats` | Athlete stats with overrides and injuries |
| PATCH / DELETE | `/api/athletes/:id/stats/override[/:statKey]` | Coach stat correction / revert |
| PATCH / DELETE | `/api/athletes/:id` | Update or remove an athlete (coach only) |
| GET | `/api/compare/athletes?a=&b=` | Side-by-side athlete comparison |
| GET | `/api/compare/team?from=&to=[&vs_from=&vs_to=]` | Team vs opponents over a period, optionally against a second period |
| GET | `/api/reports/season?from=&to=` | Season report: record, results, player totals, per-opponent record |
| GET | `/api/reports/match/:kind/:id` | Match report for a regular match (`event`) or league fixture (`fixture`) |
| GET | `/api/dashboard/summary` | Dashboard summary (readiness, form, leaders) |
| GET | `/api/dashboard/trends` | Squad form over time — completed matches, scores, results, season record |
| GET / POST | `/api/events` | List or create events and leagues |
| GET | `/api/events/clashes` | Pre-creation conflict check |
| GET / PATCH / DELETE | `/api/events/:id` | Event detail / update / remove |
| GET | `/api/events/:id/clashes` | Conflict check for an existing event |
| PATCH | `/api/events/:id/cancel` | Quick-cancel an event |
| POST | `/api/events/:id/join` | Join an open league/tournament |
| GET | `/api/events/:id/teams` · `/fixtures` · `/standings` · `/stats` | League views |
| PUT | `/api/events/:id/lineup` | Set starting XI + bench |
| GET | `/api/events/:id/lineup/suggestions` | Suggested XI + bench from RSVPs, injuries, recent form and ratings |
| POST | `/api/events/:id/simulate` | Ratings-weighted 90-minute script (Quick Sim / Simulate Match) |
| GET / POST | `/api/events/:id/logs` | Read or log live actions (idempotent `client_id` replay) |
| PATCH / DELETE | `/api/events/:id/logs/:logId` | Edit / undo a log entry |
| GET | `/api/events/:id/rsvps` | Availability responses |
| PUT | `/api/events/:id/rsvps/mine` · `/rsvps/:athleteId` | Set availability (athlete / coach) |
| GET / PATCH | `/api/fixtures/:id` | Fixture detail / update |
| GET | `/api/fixtures/:id/clashes` | Fixture conflict check |
| PUT | `/api/fixtures/:id/lineup` | Set both teams' lineups |
| GET | `/api/fixtures/:id/lineup/suggestions` | Lineup suggestions for the home side (RSVPs, injuries, form, ratings) |
| POST | `/api/fixtures/:id/simulate` | Fixture simulation (home squad only) |
| GET / POST | `/api/fixtures/:id/logs` | Read or log fixture actions |
| PATCH / DELETE | `/api/fixtures/:id/logs/:logId` | Edit / undo a fixture log |
| POST / PATCH / DELETE | `/api/injuries[/:id]` | Log, update, or remove an injury |
| POST | `/api/invites` | Create an assistant/athlete invite (emailed via Gmail) |
| POST | `/api/invites/:token/accept` | Accept an invite |
| GET | `/api/invites/verify/:token` | Public invite verification |
| GET / POST | `/api/tactics[/:id]` | List/create tactics boards |
| GET / PATCH / DELETE | `/api/tactics/:id` | Read, update, or delete a tactic |
| GET / POST | `/api/sessions[/:id]` | Drill library CRUD |
| GET | `/api/public/squads` · `/api/public/squads/:id` | Public directory and squad pages (no auth) |
| GET | `/api/public/leaderboard` | Cross-platform table of every public squad — completed matches and league fixtures (no auth) |
| GET | `/api/public/links/:token[/export.csv]` | Private share link and CSV export (no auth) |
| GET | `/api/weather?location=` or `?lat=&lng=` | Venue weather forecast |
| POST | `/webhooks/clerk` | Clerk webhook (user lifecycle) |

## Deployment

Production runs on free-tier hosting:

| Service | Host | URL |
|---------|------|-----|
| Frontend | Cloudflare Pages | [kickstat.pages.dev](https://kickstat.pages.dev) |
| Backend | Render | [kickstat-api-i2rc.onrender.com](https://kickstat-api-i2rc.onrender.com) |
| Database | Neon (Frankfurt) | — |

Every push to `main` on Gitea runs CI and, when green, auto-deploys:
the commit is synced to the [GitHub mirror](https://github.com/TasmiyaChoonara/sport-coaching-tool)
(which triggers the Render backend deploy with migrations) and the frontend
is published to Cloudflare Pages via `wrangler`. Manual `wrangler pages deploy`
is only needed for out-of-band fixes.

> The Render free tier sleeps after ~15 min of inactivity; the first request
> afterwards takes about a minute to wake up. The
> [backend keepalive workflow](.gitea/workflows/backend-keepalive.yml) pings
> `/api/health` every 10 minutes from Gitea Actions so the API stays awake —
> scheduled workflows only fire from the default branch (it goes live when the
> file merges to `main`) and only while a runner is online, so if the Actions
> tab shows no keepalive runs, point any external pinger at the same URL
> instead (a free cron-job.org job, or a crontab line like
> `*/10 * * * * curl -fsS https://kickstat-api-i2rc.onrender.com/api/health`).
> A failing ping turns the workflow red — doubling as a visible "API down" alarm.

### Deployment inventory

Third-party services used by the app: **Clerk** (auth), **Resend** (invite and
event-reminder emails), **Mapbox** (venue map basemap, address search and
reverse geocoding - public token baked into the frontend bundle),
**Open-Meteo** (venue weather, no key required) and the
**EA FC player ratings dataset** (Hugging Face datasets-server, no key required —
weights the Quick Sim / Simulate Match simulation, with a position-based estimate
for players it does not know). The football-data.org "Pro Fixtures" integration
was removed in Sprint 3 — the justification is documented in the docs site's
Feature Rationale page.

CI auto-deploy is wired through three secrets stored in Gitea
(Settings → Actions → Secrets — values are never committed to the repo):

| Secret | What it is |
|--------|------------|
| `GH_PAT` | GitHub fine-grained token (Contents: Read and write on the fork) — lets CI push to the GitHub mirror. **Expires Dec 13, 2026 — renew and update before then** |
| `CLOUDFLARE_API_TOKEN` | Cloudflare custom token (Account → Cloudflare Pages → Edit) — lets CI run `wrangler pages deploy` |
| `CLOUDFLARE_ACCOUNT_ID` | 32-char Cloudflare account ID |

Coverage publishing uses two more secrets, separate from auto-deploy and
failing soft when unset: `CODECOV_TOKEN` (Codecov upload) and
`NETLIFY_AUTH_TOKEN` + `NETLIFY_COVERAGE_SITE_ID` (publishing the combined
coverage dashboard).

Environment variables configured on the Render service: `DATABASE_URL` (Neon
direct connection string — pooling **off**, no `-pooler` host, migrations break
on the pooled URL), `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`,
`CLERK_WEBHOOK_SECRET`, `FRONTEND_URL` (= https://kickstat.pages.dev, drives
CORS), `RESEND_API_KEY` and `EMAIL_FROM` (invite and reminder emails — both
channels run through Resend after Gmail SMTP proved unreliable on Render).

Key deployment files in this repo:

| File | Purpose |
|------|---------|
| `render.yaml` | Render Blueprint: service definition, build/start commands (migrations then `node src/app.js`), health check |
| `frontend/.env.production` | `VITE_API_URL` + `VITE_CLERK_PUBLISHABLE_KEY` + `VITE_MAPBOX_TOKEN`, baked into the bundle at build time |
| `frontend/public/_redirects` | SPA fallback (`/* /index.html 200`) |
| `wrangler.jsonc` | Cloudflare Pages config (`pages_build_output_dir: frontend/dist`) |
| `.gitea/workflows/ci.yml` | CI pipeline: lint/tests + coverage for both apps, Postgres address probe, combined coverage dashboard publish, Deploy Production job |
| `.gitea/workflows/backend-keepalive.yml` | Scheduled `/api/health` ping (every 10 min) that keeps the Render free tier from sleeping |

Never push directly to the GitHub mirror — Gitea `main` is the single source of
truth and CI keeps the mirror in sync.

## Documentation

Full project documentation is available in the [docs site](https://kickstat-docs-v2.netlify.app/) (Docusaurus).

## License

This project was developed as part of COMS3011A at the University of the Witwatersrand.
