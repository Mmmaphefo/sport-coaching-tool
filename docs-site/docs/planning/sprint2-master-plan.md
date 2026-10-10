---
sidebar_position: 3
---

# Sprint 2 Master Action Plan

## Kickstat — Sport Coaching Tool (COMS3011A Project 2)

**Course:** COMS3011A — Software Design Project  
**Team:** bug-off  
**Project:** Sport Coaching Tool (Project 2)  
**Sprint 2 Deadline:** 15 September 2026  
**Prepared:** 3 September 2026  

---

## 1. Project Context

### 1.1 Course Requirements (All Projects)

Per the COMS3011A project brief, every project must satisfy:

- Version control (Git)
- Responsiveness and accessibility
- CI/CD for collaboration and deployment
- Non-monolithic front-end and back-end
- Hand-written API (no Firebase/Supabase-generated endpoints)
- Authentication & security (Clerk or equivalent)
- Integration with a relevant external API
- Public documentation website deployed via static hosting

### 1.2 Sport Coaching Tool Features

The brief defines three tiers:

**Basic Tier**
- Coach manages athletes and events (matches/training)
- Events have date, time, location; can be edited or cancelled
- Live event logging (scores, penalties, actions against athletes)
- Edit/undo log entries
- Statistics derived from log with manual override
- Event result and penalty record
- Dashboard with live view, roster summary, per-athlete summary

**Intermediate Tier**
- Multi-user support with roles/permissions (assistants, helpers)
- Fixtures with other platform users
- Athlete availability / RSVPs
- Shared calendar
- Season totals, per-event breakdowns, trend charts
- Athlete vs athlete, athlete vs opponent, season comparisons
- External services (weather, maps)
- Reminders
- Offline-first logging with background sync

**Advanced Tier**
- Collaborative offline logging across multiple assistants
- League / standings view with shared fixtures
- Auto-summaries, performance highlights, selection suggestions
- Public squad page with shareable results and exportable reports
- Season schedule generation with clash detection

### 1.3 Sprint 2 Rubric

| # | Criterion | Weight | Advanced Standard |
|---|-----------|--------|-------------------|
| 1 | Core Features | 25% | Implemented with at most one non-severe bug |
| 2 | Automated Testing | 10% | UI and API testing implemented, useful and extensive |
| 3 | Stakeholder Reviews | 10% | Evidence of regular stakeholder interaction, evaluated and integrated feedback |
| 4 | API | 15% | API available externally with documentation and integrated external API |
| 5 | User Feedback | 10% | Formal feedback collection, evidence of collection and integration |
| 6 | Project Methodology | 10% | Actively following methodology |
| 7 | Bug Tracker | 5% | Extensive and continuous use |
| 8 | Database Documentation | 5% | Full schema documentation, deployment info and motivation |
| 9 | Third-Party Code Documentation | 5% | All third-party code documented and motivated |
| 10 | Testing Documentation | 5% | Extensive documentation on testing, feedback process, automated testing procedure, test policy |

---

## 2. Current Codebase Audit

### 2.1 Architecture

- **Frontend:** React 19, Vite, React Router, Clerk (`@clerk/clerk-react`)
- **Backend:** Node.js, Express, PostgreSQL (`pg`), `node-pg-migrate`
- **Auth:** `@clerk/express` and `@clerk/clerk-react`
- **Testing:** Vitest + Supertest (backend only)
- **CI/CD:** Gitea Actions (`.gitea/workflows/ci.yml`)
- **Docs:** Docusaurus (`docs-site/`)

### 2.2 Currently Implemented Features

#### Authentication & Roles
- Clerk-hosted sign-up, sign-in, password reset, account deletion
- Coach and assistant roles
- Invite-based assistant onboarding via unique token links
- Account deletion webhook cascade
- Self-healing user/squad creation on first API call

**Files:** `backend/src/middleware/auth.js`, `backend/src/routes/invites.js`, `backend/src/routes/webhooks.js`, `backend/src/routes/account.js`, `backend/src/routes/_squad.js`

#### Roster Management
- Add, edit, remove athletes
- Squad ownership validation
- Per-athlete statistics derived from log entries
- Email invite support for athletes (record created, email sent via Resend)

**Files:** `backend/src/routes/athletes.js`, `frontend/src/pages/Roster.jsx`, `frontend/src/pages/AthleteStats.jsx`

#### Event Management
- Create/edit/cancel matches and training sessions
- Date, time, location, duration, opponent
- Auto-transition: scheduled → live → completed via background sweep
- Event detail with timeline and results

**Files:** `backend/src/routes/events.js`, `frontend/src/pages/Events.jsx`, `frontend/src/pages/EventDetail.jsx`, `backend/src/app.js`

#### Live Match Logging
- Log goals, assists, shots, saves, cards, substitutions, penalties
- Attribution to athlete or opponent
- Edit and undo (soft delete) log entries
- Real-time timeline and score aggregation

**Files:** `backend/src/routes/events.js`, `backend/src/routes/fixtures.js`, `frontend/src/pages/LiveMatch.jsx`

#### Leagues & Tournaments
- Create league/tournament with required number of teams
- Other coaches join open events
- Auto-generated round-robin schedule (home and away)
- Live standings sorted by points, goal difference, goals for
- Top scorers and top assisters

**Files:** `backend/src/routes/events.js`, `frontend/src/pages/Events.jsx`

#### External Integrations
- Weather forecast via Open-Meteo (geocoding + 3-day forecast)
- Professional football fixtures/standings via football-data.org
- In-memory caching with TTL

**Files:** `backend/src/routes/weather.js`, `backend/src/routes/external.js`, `frontend/src/components/WeatherWidget.jsx`

#### Testing
- 57+ backend integration tests
- 76.39% statement coverage baseline
- CI pipeline with Postgres service container

**Files:** `backend/tests/integration/*.test.js`, `.gitea/workflows/ci.yml`

#### Documentation
- README with setup and API endpoint list
- Acceptance tests in Given-When-Then format
- Docusaurus scaffold with project plan, architecture, automated testing docs

**Files:** `README.md`, `docs-site/docs/**/*.md`

### 2.3 Known Bugs

| ID | Bug | Location | Impact |
|----|-----|----------|--------|
| US26 | Assistants can write to roster via API | `backend/src/routes/athletes.js` | Severe — role boundary broken |
| US6 | Cancelled events still accept logs | `backend/src/routes/events.js` | Medium |
| US6 | Cancelled fixtures still accept logs | `backend/src/routes/fixtures.js` | Medium |

### 2.4 Missing Features

| Feature | User Story | Priority |
|---------|------------|----------|
| Onboarding/setup flow enforcement | US22 | High |
| Athlete email invite temp-password flow | US24, US25 | Medium |
| Offline-first logging | Intermediate requirement | High for advanced tier |
| Event reminders | Intermediate requirement | Medium |
| Athlete availability / RSVPs | Intermediate requirement | Medium |
| Shared calendar view | Intermediate requirement | Low |
| Season comparisons & charts | Intermediate requirement | Low |
| Public squad page | Advanced requirement | Low |
| Collaborative offline logging | Advanced requirement | Low for Sprint 2 |
| Schedule generation with clash detection | Advanced requirement | Low |

### 2.5 Documentation Gaps

- Docs site is scaffolded but **not deployed**
- No OpenAPI/Swagger API documentation
- No explicit testing policy document
- No formal stakeholder feedback mechanism or log
- No user testing session documentation
- Third-party integrations mentioned but not fully motivated
- No Gitea issue usage visible in codebase

---

## 3. Master Task List

### 3.1 Core Features — Implementation Tasks

#### US26 — Fix Assistant Permission Boundary

**What:** Assistants must be able to log events but must be rejected when trying to add, edit, or delete athletes.

**Files to edit:**
- `backend/src/routes/athletes.js`

**Implementation steps:**
1. Import `getOwnedSquadIdForCoach` helper or add role check inline.
2. In `POST /api/athletes`, verify `req.user.role === 'coach'`; return 403 if not.
3. In `PATCH /api/athletes/:id`, verify `req.user.role === 'coach'`; return 403 if not.
4. In `DELETE /api/athletes/:id`, verify `req.user.role === 'coach'`; return 403 if not.
5. Use the existing `auth-and-roles.integration.test.js` US26 test to confirm the fix.

**Test file:** `backend/tests/integration/auth-and-roles.integration.test.js`

#### US6 — Prevent Logging on Cancelled Events

**What:** Once an event is cancelled, no new log entries should be accepted.

**Files to edit:**
- `backend/src/routes/events.js`

**Implementation steps:**
1. In `POST /api/events/:id/logs`, fetch the parent event status.
2. If status is `cancelled`, return 400 with error `"Event is cancelled"`.

**Test file:** `backend/tests/integration/roster-and-events-basic.integration.test.js`

#### US6 — Prevent Logging on Cancelled Fixtures

**What:** Once a fixture is cancelled, no new log entries should be accepted.

**Files to edit:**
- `backend/src/routes/fixtures.js`

**Implementation steps:**
1. In `POST /api/fixtures/:id/logs`, fetch the parent fixture status.
2. If status is `cancelled`, return 400 with error `"Fixture is cancelled"`.

**Test file:** `backend/tests/integration/fixtures.integration.test.js`

#### US22 — Enforce First-Login Setup Flow

**What:** Coaches with no athletes and/or `onboarded=false` should be redirected to a setup wizard.

**Files to edit:**
- `frontend/src/pages/Setup.jsx`
- `frontend/src/App.jsx`
- `backend/src/routes/squads.js`

**Implementation steps:**
1. Backend: expose `GET /api/squads/mine` returning `onboarded` and athlete count.
2. Frontend: add a route guard or effect that redirects to `/setup` when `onboarded === false` or athlete count is below `min_roster_size`.
3. In `Setup.jsx`, after the coach adds the minimum number of athletes, call `PATCH /api/squads/mine` to set `onboarded = true`.

**Note:** `squads.onboarded` and `squads.min_roster_size` columns already exist in the database.

#### US24 — Athlete Email Invites

**What:** When a coach adds an athlete with an email, send an account-creation email with a temporary access path.

**Files to edit:**
- `backend/src/routes/athletes.js`
- `backend/src/routes/invites.js` (already has `createInvite` for athletes)
- `backend/src/lib/email.js`

**Implementation steps:**
1. When `contact_info` looks like an email in `POST /api/athletes`, call `createInvite` with `role: 'athlete'` and the new athlete's id.
2. The invite email template should explain how to sign up and that the account will be linked to the roster row.

#### US25 — Temporary Password / Forced Reset

**What:** Athletes logging in via invite must set a new password before accessing the app.

**Files to edit:**
- Clerk dashboard configuration
- `frontend/src/pages/InviteAccept.jsx`
- Documentation

**Implementation steps:**
1. Configure Clerk to require email verification.
2. After athlete accepts invite, direct them through Clerk's password-reset/forced-update flow or use Clerk's `resetPassword` API.
3. Document the chosen approach.

#### Offline-First Logging

**What:** Log entries made without a connection must be stored locally and synced when online.

**Files to edit:**
- `frontend/src/pages/LiveMatch.jsx`
- `frontend/src/lib/offline-store.js` (new)
- `frontend/src/lib/api.js`

**Implementation steps:**
1. Create an IndexedDB wrapper for pending log entries.
2. In `LiveMatch.jsx`, on submit, attempt the API call; if it fails due to network, queue in IndexedDB.
3. Add a `window.online` listener that flushes the queue.
4. Show pending/synced status in the UI.

#### Event Reminders

**What:** Notify users of upcoming events.

**Files to edit:**
- Backend scheduler (e.g., `node-cron` or `setInterval`)
- `backend/src/lib/email.js`
- `backend/src/routes/events.js`

**Implementation steps:**
1. Add a periodic job that queries events starting within the next 24 hours.
2. Send email reminders to coaches and assistants (requires `RESEND_API_KEY`).
3. Record that a reminder was sent to avoid duplicates.

#### Athlete Availability / RSVPs

**What:** Athletes/assistants can mark whether they can attend an event.

**Files to edit:**
- Migrations: new `rsvps` table
- `backend/src/routes/events.js`
- `frontend/src/pages/EventDetail.jsx`

**Implementation steps:**
1. Create `rsvps(event_id, athlete_id, status, responded_at)` table.
2. Add endpoints: `POST /api/events/:id/rsvps`, `GET /api/events/:id/rsvps`.
3. Display availability summary on event detail page.

#### Shared Calendar View

**What:** Display events in a calendar instead of only a list.

**Files to edit:**
- `frontend/src/pages/Events.jsx`
- Optional: install a calendar library such as `react-big-calendar` or build a simple grid.

#### Season Comparisons & Charts

**What:** Show trends and comparisons across athletes and opponents.

**Files to edit:**
- `backend/src/routes/athletes.js`
- `frontend/src/pages/AthleteStats.jsx`
- Optional: install chart library such as `recharts`.

---

### 3.2 Automated Testing — Implementation Tasks

#### Backend Tests

| Task | File | Description |
|------|------|-------------|
| Fix failing test | `backend/tests/integration/auth-and-roles.integration.test.js` | US26 must pass after role fix |
| Add cancelled-event test | `backend/tests/integration/roster-and-events-basic.integration.test.js` | POST logs to cancelled event returns 400 |
| Add cancelled-fixture test | `backend/tests/integration/fixtures.integration.test.js` | POST logs to cancelled fixture returns 400 |
| Add onboarding test | `backend/tests/integration/squad.integration.test.js` | Verify `onboarded` flag behavior |
| Add athlete-invite test | `backend/tests/integration/invites.integration.test.js` | Creating athlete with email creates invite |
| Maintain coverage | All new backend code | Add tests so coverage does not drop below 76% |

#### Frontend Test Framework

**What:** Add a frontend test runner and initial component tests.

**Files to create/edit:**
- `frontend/package.json`
- `frontend/vitest.config.js`
- `frontend/src/components/ProtectedRoute.test.jsx`
- `frontend/src/components/Layout.test.jsx`
- `frontend/src/pages/Dashboard.test.jsx`
- `frontend/src/pages/Roster.test.jsx`
- `frontend/src/pages/Events.test.jsx`

**Implementation steps:**
1. Install dev dependencies:
   ```bash
   cd frontend
   npm install --save-dev vitest @testing-library/react @testing-library/jest-dom jsdom @vitejs/plugin-react
   ```
2. Create `frontend/vitest.config.js`:
   ```js
   import { defineConfig } from 'vitest/config'
   import react from '@vitejs/plugin-react'

   export default defineConfig({
     plugins: [react()],
     test: {
       environment: 'jsdom',
       globals: true,
       setupFiles: './src/test-setup.js',
     },
   })
   ```
3. Create `frontend/src/test-setup.js`:
   ```js
   import '@testing-library/jest-dom'
   ```
4. Add test script to `frontend/package.json`:
   ```json
   "test": "vitest run"
   ```
5. Write at least one test per component/page listed above.

#### CI Update

**Files to edit:**
- `.gitea/workflows/ci.yml`

**Implementation steps:**
1. Add a `Run frontend tests` step in the `frontend-ci` job.
2. Ensure the step runs `npm test` in the frontend directory.

---

### 3.3 API Documentation Tasks

#### OpenAPI / Swagger Specification

**Files to create:**
- `backend/openapi.yml`
- `backend/src/docs/swagger.js` (optional helper)

**Implementation steps:**
1. Document every `/api/*` endpoint with:
   - HTTP method and path
   - Request parameters and body schema
   - Response schemas and status codes
   - Authentication requirements
2. Serve Swagger UI from `backend/src/app.js`:
   ```js
   const swaggerUi = require('swagger-ui-express')
   const YAML = require('yamljs')
   const swaggerDocument = YAML.load('./openapi.yml')
   app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument))
   ```
3. Add `swagger-ui-express` and `yamljs` to backend dependencies.

#### API Design Documentation

**Files to create:**
- `docs-site/docs/architecture/api-design.md`

**Content:**
- REST conventions used
- Authentication mechanism (Clerk JWT)
- Error response format
- Versioning strategy

---

### 3.4 Stakeholder Review Tasks

| Task | File / Tool | Description |
|------|-------------|-------------|
| Hold Sprint 1 review | Meeting with tutor/client | Demo Sprint 1 features, collect feedback |
| Hold Sprint 2 review | Meeting with tutor/client | Demo Sprint 2 features, collect feedback |
| Document meetings | `docs-site/docs/meetings/sprint1-review.md` | What was demoed, feedback, actions |
| Document meetings | `docs-site/docs/meetings/sprint2-review.md` | Same for Sprint 2 |
| Maintain feedback log | `docs-site/docs/planning/stakeholder-feedback.md` | Feedback item, decision, status, linked commit |
| Show evidence of integration | Git history | At least 3 feedback items implemented |

---

### 3.5 User Feedback Tasks

| Task | File / Tool | Description |
|------|-------------|-------------|
| In-app feedback form | `frontend/src/pages/AccountSettings.jsx` or new page | Simple form for bug reports / suggestions |
| Feedback backend | `backend/src/routes/feedback.js`, migration | Store feedback in database |
| User testing session | `docs-site/docs/planning/user-feedback.md` | Recruit 3–5 users, run tasks, record observations |
| Feedback integration | Git issues/commits | Show feedback that led to changes |
| Analytics (optional) | External tool or simple events table | Track page views or feature usage |

---

### 3.6 Project Methodology Tasks

| Task | File | Description |
|------|------|-------------|
| Update Sprint 2 backlog | `docs-site/docs/planning/sprint-backlogs.md` | Tasks, owners, statuses |
| Document standups | `docs-site/docs/meetings/standups.md` | Async WhatsApp standup summaries |
| Sprint 2 retrospective | `docs-site/docs/meetings/sprint2-retrospective.md` | What went well, improvements |
| Enforce Definition of Done | Team process | Tests + docs + review before merge |

---

### 3.7 Bug Tracker Tasks

| Task | Tool | Description |
|------|------|-------------|
| Create issues in Gitea | Gitea Issues | US26, US6 cancelled logs, frontend tests, docs deployment, feedback form |
| Label issues | Gitea | `bug`, `feature`, `sprint-2`, `testing`, `docs` |
| Reference issues in commits | Git | `Fixes #12` or `Refs #15` |
| Close issues only after merge | Gitea | Maintain clean board |

---

### 3.8 Database Documentation Tasks

| Task | File | Description |
|------|------|-------------|
| Verify ERD accuracy | `docs-site/docs/architecture/data-model.md` | Ensure all 19 migrations are represented |
| Add design rationale | `docs-site/docs/architecture/data-model.md` | Why tables and relationships were chosen |
| Add deployment guide | `docs-site/docs/getting-started/database.md` | Create DB, run migrations, backup/restore |
| Generate visual schema | `docs-site/static/img/schema.png` | Optional dbdiagram.io export |

---

### 3.9 Third-Party Code Documentation Tasks

| Task | File | Description |
|------|------|-------------|
| Clerk auth doc | `docs-site/docs/architecture/authentication.md` | Why Clerk, how it integrates, webhook flow |
| External APIs doc | `docs-site/docs/architecture/external-apis.md` | Open-Meteo, football-data.org, Resend |
| Tech stack rationale | `docs-site/docs/architecture/tech-stack.md` | React, Vite, Express, PostgreSQL, Vitest, node-pg-migrate |

---

### 3.10 Testing Documentation Tasks

| Task | File | Description |
|------|------|-------------|
| Add testing policy | `docs-site/docs/product/testing-policy.md` | When to write tests, coverage targets, naming conventions |
| Update frontend test docs | `docs-site/docs/product/automated-testing.md` | Add Vitest + React Testing Library instructions |
| Document feedback process | `docs-site/docs/planning/user-feedback.md` | How feedback is collected, triaged, integrated |
| Maintain coverage dashboard | CI + Netlify | Ensure `kickstat-coverage.netlify.app` deploys |

---

### 3.11 Documentation Site Deployment Tasks

**Files to edit:**
- `docs-site/package.json`
- `.gitea/workflows/ci.yml` (optional deploy step)
- Cloudflare Pages / Netlify configuration

**Implementation steps:**
1. Build the docs site:
   ```bash
   cd docs-site
   npm install
   npm run build
   ```
2. Deploy the `docs-site/build` folder to Netlify or Cloudflare Pages.
3. Update `README.md` with the live URL.
4. Optional: add a CI job that deploys docs on every push to `main`.

---

### 3.12 Environment & README Cleanup Tasks

| Task | File | Description |
|------|------|-------------|
| Add backend `.env.example` | `backend/.env.example` | Currently missing |
| Update frontend `.env.example` | `frontend/.env.example` | Ensure it matches current code |
| Align port guidance | `README.md` | README says 3000; current `.env` uses 5001 |
| Fix CORS for local dev | `backend/src/app.js` | Already done; keep 5173/5174/5175 |
| Add runbook note | `README.md` | Kill stale node processes when ports conflict |

---

## 4. Recommended Sprint 2 Schedule

### Week 1: 3 – 8 September 2026

**Focus:** Fix bugs and harden backend.

- Day 1: Fix US26 role checks; run tests.
- Day 2: Fix cancelled-event/fixture logging; add tests.
- Day 3: Implement US22 onboarding enforcement.
- Day 4: Add backend tests for onboarding and athlete invites.
- Day 5: Gitea Issues cleanup; create issues for all remaining work.
- Day 6: Stakeholder check-in; document feedback.
- Day 7: Code review and merge Week 1 changes.

### Week 2: 9 – 15 September 2026

**Focus:** Frontend tests, docs deployment, and evidence.

- Day 1: Set up Vitest + React Testing Library; write first component tests.
- Day 2: Add frontend tests for Dashboard, Roster, Events.
- Day 3: Deploy docs site; verify live URL.
- Day 4: Write OpenAPI spec and serve Swagger UI.
- Day 5: Conduct user testing session; document feedback.
- Day 6: Write missing documentation pages; update README.
- Day 7: Final CI check; collect evidence; submit Sprint 2.

---

## 5. Evidence Checklist for Sprint 2 Submission

Collect the following for the group report and presentation:

- [ ] Screenshot or link to a green Gitea Actions CI run
- [ ] Backend coverage report showing ≥76% statement coverage
- [ ] Frontend test output showing passing component tests
- [ ] Gitea Issues board showing bugs/features tracked
- [ ] Stakeholder meeting notes (at least 2)
- [ ] Stakeholder feedback log with integration evidence
- [ ] User testing session notes (at least 3 users)
- [ ] Live documentation site URL
- [ ] Live API documentation URL (`/api/docs` or OpenAPI file)
- [ ] Live coverage dashboard URL
- [ ] Updated sprint backlog
- [ ] Sprint 2 retrospective notes
- [ ] Database schema/ERD documentation
- [ ] Third-party integration documentation

---

## 6. Quick-Reference File Map

### Backend Routes
- `backend/src/app.js` — Express entry, route mounting, sweep job
- `backend/src/routes/_squad.js` — Shared squad helpers
- `backend/src/routes/squads.js` — Squad CRUD
- `backend/src/routes/athletes.js` — Roster + stats
- `backend/src/routes/events.js` — Events, leagues, live logging
- `backend/src/routes/fixtures.js` — Fixture detail and logging
- `backend/src/routes/invites.js` — Assistant and athlete invites
- `backend/src/routes/external.js` — football-data.org proxy
- `backend/src/routes/weather.js` — Open-Meteo proxy
- `backend/src/routes/account.js` — Profile and deletion
- `backend/src/routes/webhooks.js` — Clerk webhooks

### Frontend Pages
- `frontend/src/App.jsx` — Router
- `frontend/src/pages/Home.jsx` — Landing/sign-in
- `frontend/src/pages/Dashboard.jsx` — Coach overview
- `frontend/src/pages/Roster.jsx` — Athlete management
- `frontend/src/pages/AthleteStats.jsx` — Per-athlete stats
- `frontend/src/pages/Events.jsx` — Events list and creation
- `frontend/src/pages/EventDetail.jsx` — Event detail/timeline
- `frontend/src/pages/LiveMatch.jsx` — Live logging UI
- `frontend/src/pages/Live.jsx` — Live event landing
- `frontend/src/pages/Setup.jsx` — Onboarding wizard
- `frontend/src/pages/InviteAccept.jsx` — Invite acceptance
- `frontend/src/pages/AccountSettings.jsx` — Account management

### Tests
- `backend/tests/integration/auth-and-roles.integration.test.js`
- `backend/tests/integration/roster-and-events-basic.integration.test.js`
- `backend/tests/integration/events.integration.test.js`
- `backend/tests/integration/fixtures.integration.test.js`
- `backend/tests/integration/athletes.integration.test.js`
- `backend/tests/integration/invites.integration.test.js`
- `backend/tests/integration/squad.integration.test.js`
- `backend/tests/integration/weather.integration.test.js`
- `backend/tests/integration/external.integration.test.js`
- `backend/tests/integration/account.integration.test.js`

### Docs
- `docs-site/docs/planning/project-plan.md`
- `docs-site/docs/planning/sprint-backlogs.md`
- `docs-site/docs/meetings/*.md`
- `docs-site/docs/product/automated-testing.md`
- `docs-site/docs/product/acceptance-tests.md`
- `docs-site/docs/architecture/data-model.md`
- `docs-site/docs/architecture/overview.md`
- `docs-site/docusaurus.config.js`

---

## 7. Definition of Done for Sprint 2

A task is considered done when:

1. Code is implemented and manually tested locally.
2. Automated tests are added or updated and pass.
3. Code is linted (`npm run lint` in relevant folder).
4. Frontend production build succeeds (`npm run build` in frontend).
5. Backend CI test suite passes (`npm test` in backend).
6. Relevant documentation is updated.
7. Code is reviewed and merged to `main`.
8. Gitea Issue is closed with a reference to the merge commit.

---

*End of master action plan.*
