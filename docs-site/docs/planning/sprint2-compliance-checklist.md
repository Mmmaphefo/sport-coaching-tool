---
sidebar_position: 4
---

# Sprint 2 Full Compliance Checklist

## Kickstat — Sport Coaching Tool (COMS3011A Project 2)

**Sprint 2 deadline:** 15 September 2026  
**Prepared:** 3 September 2026  
**Team:** bug-off  

---

## Executive Summary

This document lists every task required to move the project from its **current Sprint 2 state** to **full rubric compliance at the Advanced level** for Milestone 2. The codebase already has strong foundations: authentication, roster management, event scheduling, live logging, leagues/fixtures, weather integration, football-data integration, backend integration tests, and CI/CD. The remaining work is concentrated in **role-permission enforcement, frontend testing, documentation deployment, stakeholder/user feedback evidence, and minor feature completeness**.

---

## 1. Rubric Compliance Matrix

| # | Criterion | Weight | Current Rating | Target | Risk |
|---|-----------|--------|----------------|--------|------|
| 1 | Core Features | 25% | Intermediate | Advanced | Medium |
| 2 | Automated Testing | 10% | Intermediate | Advanced | High |
| 3 | Stakeholder Reviews | 10% | Basic | Advanced | High |
| 4 | API | 15% | Advanced | Advanced | Low |
| 5 | User Feedback | 10% | Basic | Advanced | High |
| 6 | Project Methodology | 10% | Advanced | Advanced | Low |
| 7 | Bug Tracker | 5% | Basic | Advanced | Medium |
| 8 | Database Documentation | 5% | Intermediate | Advanced | Low |
| 9 | Third-Party Code Documentation | 5% | Intermediate | Advanced | Low |
| 10 | Testing Documentation | 5% | Advanced | Advanced | Low |

---

## 2. Criterion 1 — Core Features (25%)

**Advanced standard:** Implemented with at most one non-severe bug.

### 2.1 Bugs to fix (must-fix for Advanced)

| Task | File(s) | Description | Evidence Required |
|------|---------|-------------|-------------------|
| US26 — Fix assistant roster write access | `backend/src/routes/athletes.js` | Add role checks so `POST /api/athletes`, `PATCH /api/athletes/:id`, and `DELETE /api/athletes/:id` reject assistants with 403. Currently any authenticated user can write. | `auth-and-roles.integration.test.js` US26 test passes |
| US6 — Cancelled events should not accept logs | `backend/src/routes/events.js` | `POST /api/events/:id/logs` must reject new logs when parent event status is `cancelled`. | New assertion in `roster-and-events-basic.integration.test.js` |
| US6 — Cancelled fixtures should not accept logs | `backend/src/routes/fixtures.js` | `POST /api/fixtures/:id/logs` must reject new logs when fixture status is `cancelled`. | New assertion in `fixtures.integration.test.js` |

### 2.2 Missing basic/intermediate features to implement

| Task | File(s) | Description | Priority |
|------|---------|-------------|----------|
| US22 — First-login setup flow | `frontend/src/pages/Setup.jsx`, `backend/src/routes/squads.js`, migrations | Enforce onboarding: coaches with zero athletes and/or `onboarded=false` redirect to setup wizard. `squads.onboarded` and `min_roster_size` columns exist but are not enforced. | High |
| US24 — Athlete email invites | `backend/src/routes/athletes.js`, `backend/src/lib/email.js` | When adding an athlete with an email, generate an athlete invite and send an account-creation email. | Medium |
| US25 — Temporary password / forced reset | Clerk dashboard + backend | Configure Clerk to force password reset on first login for athlete invites; document the flow. | Medium |
| Athlete login link after invite | `frontend/src/pages/InviteAccept.jsx` | Athletes accepting an invite should be linked to their existing roster row (`athletes.user_id`). | Medium |
| Offline-first logging | `frontend/src/pages/LiveMatch.jsx`, `frontend/src/lib/` | Queue log entries in IndexedDB/localStorage when offline; sync when connection returns. | Advanced (optional for Sprint 2) |
| Event reminders | Backend scheduler / email, frontend | Notify coaches/assistants of upcoming events (email or in-app). | Medium |
| Athlete availability / RSVPs | `backend/src/routes/events.js`, migrations, frontend | Allow athletes/assistants to mark availability for events. | Medium |

### 2.3 Intermediate/advanced features (already strong; polish only)

| Task | File(s) | Description | Priority |
|------|---------|-------------|----------|
| Season comparisons & charts | `frontend/src/pages/AthleteStats.jsx`, `backend/src/routes/athletes.js` | Add season totals, trend charts, opponent comparisons. | Low |
| Shared calendar view | `frontend/src/pages/Events.jsx` | Display events in a calendar layout (list view already exists). | Low |
| Public squad page | `backend/src/routes/public.js`, frontend | Shareable public page for squad results. | Low |

---

## 3. Criterion 2 — Automated Testing (10%)

**Advanced standard:** UI and API testing implemented, useful and extensive.

### 3.1 Backend testing (maintain and extend)

| Task | File(s) | Description | Evidence |
|------|---------|-------------|----------|
| Fix failing tests | `backend/tests/integration/auth-and-roles.integration.test.js` | After fixing US26, confirm all 57+ tests pass. | `npm test` output |
| Add cancelled-event tests | `backend/tests/integration/roster-and-events-basic.integration.test.js` | Assert that POST logs to cancelled events return 400/403. | New passing tests |
| Add cancelled-fixture tests | `backend/tests/integration/fixtures.integration.test.js` | Assert that POST logs to cancelled fixtures return 400/403. | New passing tests |
| Add setup-flow tests | `backend/tests/integration/squad.integration.test.js` | Test `onboarded` flag and minimum roster size enforcement. | New passing tests |
| Maintain 76%+ coverage | All backend files | Add tests for new code to keep coverage from dropping. | Coverage report |

### 3.2 Frontend testing (must add for Advanced)

| Task | File(s) | Description | Evidence |
|------|---------|-------------|----------|
| Add frontend test framework | `frontend/package.json`, `frontend/vitest.config.js` | Install and configure Vitest + React Testing Library + jsdom. | Config file exists |
| Test ProtectedRoute | `frontend/src/components/ProtectedRoute.test.jsx` | Unauthenticated users are redirected; loading state shown. | Passing test |
| Test Layout navigation | `frontend/src/components/Layout.test.jsx` | Navigation links render and route correctly. | Passing test |
| Test Dashboard invite form | `frontend/src/pages/Dashboard.test.jsx` | Form submission calls API with token. | Passing test |
| Test Roster CRUD | `frontend/src/pages/Roster.test.jsx` | Adding/editing/deleting athletes updates UI. | Passing test |
| Test Events list | `frontend/src/pages/Events.test.jsx` | Events render; league selector works. | Passing test |
| Add frontend test script | `frontend/package.json` | `npm test` runs frontend tests in CI. | CI job updated |
| Update CI to run frontend tests | `.gitea/workflows/ci.yml` | Add a frontend test step. | Green CI run |

### 3.3 E2E testing (optional but valuable)

| Task | File(s) | Description | Evidence |
|------|---------|-------------|----------|
| Evaluate Playwright/Cypress | `frontend/package.json` | Add one E2E smoke test for login → dashboard flow. | One passing E2E test |

---

## 4. Criterion 3 — Stakeholder Reviews (10%)

**Advanced standard:** Evidence of regular stakeholder interaction, evaluated and integrated feedback.

| Task | File(s) | Description | Evidence |
|------|---------|-------------|----------|
| Schedule weekly client check-ins | `docs-site/docs/meetings/client-meetings.md` | Book and hold at least one meeting per week with the tutor/client. | Meeting notes dated and signed |
| Document Sprint 1 review outcomes | `docs-site/docs/meetings/sprint1-review.md` | Record what was demoed, what feedback was given, and what changed. | Published notes |
| Document Sprint 2 review outcomes | `docs-site/docs/meetings/sprint2-review.md` | Same as above for Sprint 2. | Published notes |
| Maintain feedback log | `docs-site/docs/planning/stakeholder-feedback.md` | Table of feedback items, decision (accepted/rejected/deferred), and implementation status. | Updated log |
| Link feedback to commits | Git commit messages | Reference issue/feedback IDs when implementing changes. | Git history |

---

## 5. Criterion 4 — API (15%)

**Advanced standard:** API available externally with documentation and integrated external API.

| Task | File(s) | Description | Evidence |
|------|---------|-------------|----------|
| Add OpenAPI/Swagger spec | `backend/openapi.yml` or `backend/src/docs/openapi.json` | Document all `/api/*` endpoints, request/response schemas, auth requirements. | File committed |
| Serve Swagger UI | `backend/src/app.js` | Mount `swagger-ui-express` at `/api/docs` in development. | Working locally |
| Verify external APIs in CI | `.gitea/workflows/ci.yml` | Weather and football-data tests already exist; ensure they run and pass. | Green CI run |
| API versioning strategy | `docs-site/docs/architecture/api-design.md` | Document how API versions will be managed going forward. | Doc page published |

---

## 6. Criterion 5 — User Feedback (10%)

**Advanced standard:** Formal feedback collection, evidence of collection and integration.

| Task | File(s) | Description | Evidence |
|------|---------|-------------|----------|
| Create feedback form | `frontend/src/pages/AccountSettings.jsx` or new `Feedback.jsx` | Simple in-app feedback form that stores submissions in the database or sends email. | Working feature |
| Feedback database table | `backend/migrations/`, `backend/src/routes/feedback.js` | Store feedback text, category, user ID, timestamp. | Migration + route |
| Run user testing session | `docs-site/docs/planning/user-feedback.md` | Recruit 3–5 users, give them tasks, record observations. | Session notes + quotes |
| Integrate feedback | Git issues/commits | Show at least 3 pieces of feedback that led to code changes. | Closed issues |
| Analytics (optional) | Frontend + external tool | Add basic page-view analytics (e.g., Plausible, Google Analytics) to understand usage. | Dashboard screenshot |

---

## 7. Criterion 6 — Project Methodology (10%)

**Advanced standard:** Actively following methodology.

| Task | File(s) | Description | Evidence |
|------|---------|-------------|----------|
| Maintain sprint backlog | `docs-site/docs/planning/sprint-backlogs.md` | Update Sprint 2 backlog with tasks, owners, and statuses. | Updated doc |
| Document daily standups | `docs-site/docs/meetings/standups.md` | Summarise async WhatsApp standups 3x per week. | Dated entries |
| Sprint 2 retrospective | `docs-site/docs/meetings/sprint2-retrospective.md` | What went well, what didn't, action items for Sprint 3. | Published notes |
| Definition of Done adherence | Team process | Every merged story must have tests, docs, and review. | PR checklist |

---

## 8. Criterion 7 — Bug Tracker (5%)

**Advanced standard:** Extensive and continuous use.

| Task | File(s) / Tool | Description | Evidence |
|------|----------------|-------------|----------|
| Use Gitea Issues for all bugs/features | Gitea | Create issues for US26, US6 cancelled-event bug, frontend testing, docs deployment. | Issue list screenshot |
| Reference issues in commits | Git history | Commit messages include `Fixes #123` or `Refs #123`. | Git log |
| Maintain bug labels | Gitea | Use labels: `bug`, `feature`, `sprint-2`, `testing`, `docs`. | Labelled issues |
| Close resolved bugs | Gitea | Close issues only after merge and verification. | Closed issues |

---

## 9. Criterion 8 — Database Documentation (5%)

**Advanced standard:** Full schema documentation, deployment info, and motivation.

| Task | File(s) | Description | Evidence |
|------|---------|-------------|----------|
| Update ERD diagram | `docs-site/docs/architecture/data-model.md` | Mermaid ERD is already good; ensure it reflects all 19 migrations. | Published page |
| Add schema design rationale | `docs-site/docs/architecture/data-model.md` | Explain why key tables exist and why specific relationships were chosen. | New section |
| Add deployment info | `docs-site/docs/getting-started/database.md` | How to create DB, run migrations, backup/restore. | New page |
| Generate schema diagram image | `docs-site/static/img/schema.png` | Optional: use dbdiagram.io or similar for a visual schema. | Image committed |

---

## 10. Criterion 9 — Third-Party Code Documentation (5%)

**Advanced standard:** All third-party code documented and motivated.

| Task | File(s) | Description | Evidence |
|------|---------|-------------|----------|
| Document Clerk integration | `docs-site/docs/architecture/authentication.md` | Why Clerk was chosen, how it integrates, webhook flow. | Published page |
| Document Open-Meteo weather API | `docs-site/docs/architecture/external-apis.md` | Why Open-Meteo, endpoints used, caching strategy. | Published page |
| Document football-data.org API | `docs-site/docs/architecture/external-apis.md` | Why football-data.org, free-tier limits, allowed leagues, error handling. | Published page |
| Document core libraries | `docs-site/docs/architecture/tech-stack.md` | Motivation for React, Vite, Express, PostgreSQL, Vitest, node-pg-migrate. | Published page |
| Document Resend email | `docs-site/docs/architecture/external-apis.md` | Why Resend, how invites are sent, fallback behavior. | Published page |

---

## 11. Criterion 10 — Testing Documentation (5%)

**Advanced standard:** Extensive documentation on testing, user feedback process, automated testing procedure, policy around tests.

| Task | File(s) | Description | Evidence |
|------|---------|-------------|----------|
| Add testing policy | `docs-site/docs/product/testing-policy.md` | When to write tests, coverage targets, naming conventions, who reviews tests. | Published page |
| Document frontend test strategy | `docs-site/docs/product/automated-testing.md` | Update the existing page with Vitest + React Testing Library info. | Updated page |
| Document user feedback process | `docs-site/docs/planning/user-feedback.md` | How feedback is collected, triaged, and integrated. | Published page |
| Keep coverage dashboard alive | CI + Netlify | Ensure `kickstat-coverage.netlify.app` continues to deploy. | Live URL |

---

## 12. Cross-Cutting Infrastructure Tasks

| Task | File(s) | Description | Evidence |
|------|---------|-------------|----------|
| Deploy docs site | `docs-site/package.json`, CI or Cloudflare Pages | The docs site is scaffolded but not deployed. Build and deploy to `kickstat-docs-v2.netlify.app` or another host. | Live URL |
| Verify README links | `README.md` | Ensure docs-site link and coverage dashboard link are live. | Clickable links |
| Unify environment port guidance | `README.md`, `backend/.env.example`, `frontend/.env.example` | README says port 3000; current `.env` uses 5001. Align documentation and examples. | Consistent files |
| Add `.env.example` files | `backend/.env.example`, `frontend/.env.example` | The zip contained `.env.example` for frontend only; backend is missing. | Both files exist |
| Clean up stale processes in local dev | Team habits | Remind team to kill old `node` processes when ports conflict. | Runbook note |

---

## 13. Sprint 2 Recommended Execution Order

### Week 1 (3 Sep – 8 Sep): Fix and Test
1. Fix US26 role check in `athletes.js`.
2. Fix cancelled-event/fixture logging blocks.
3. Add backend tests for the above.
4. Run full backend test suite; ensure green.

### Week 2 (9 Sep – 15 Sep): Frontend & Docs
5. Add frontend testing framework and first component tests.
6. Implement/enforce US22 onboarding flow.
7. Deploy docs site to Netlify/Cloudflare Pages.
8. Add OpenAPI/Swagger documentation.
9. Conduct stakeholder review and user testing session.
10. Update all documentation pages and gather evidence.

### Final 2 Days (14–15 Sep): Evidence & Polish
11. Create Gitea Issues for all remaining work.
12. Collect CI green run screenshot, coverage report, meeting notes.
13. Ensure README and docs links work.
14. Submit Sprint 2 artifacts.

---

## 14. Evidence Collection Checklist for Sprint 2 Submission

Submit or link the following:

- [ ] Green Gitea Actions CI run screenshot/link
- [ ] Backend coverage report (HTML or summary showing ≥76%)
- [ ] Frontend test runner configured and at least 5 passing component tests
- [ ] US26 test passing
- [ ] Cancelled-event logging tests passing
- [ ] Stakeholder meeting notes (at least 2 meetings)
- [ ] Stakeholder feedback log
- [ ] User testing session notes (at least 3 users)
- [ ] Live docs site URL
- [ ] Live API docs URL (`/api/docs` or OpenAPI file)
- [ ] Gitea Issues list showing bugs/features tracked
- [ ] Updated sprint backlog and retrospective
- [ ] Database ERD and schema documentation page
- [ ] Third-party integration documentation pages

---

## 15. Quick-Reference: Files to Touch

### Backend
- `backend/src/routes/athletes.js`
- `backend/src/routes/events.js`
- `backend/src/routes/fixtures.js`
- `backend/src/routes/squads.js`
- `backend/src/routes/feedback.js` (new)
- `backend/src/routes/public.js` (optional)
- `backend/src/app.js`
- `backend/tests/integration/auth-and-roles.integration.test.js`
- `backend/tests/integration/roster-and-events-basic.integration.test.js`
- `backend/tests/integration/fixtures.integration.test.js`
- `backend/tests/integration/squad.integration.test.js`
- `backend/migrations/` (new migrations for feedback table, if needed)
- `backend/openapi.yml` (new)

### Frontend
- `frontend/package.json`
- `frontend/vitest.config.js` (new)
- `frontend/src/components/ProtectedRoute.test.jsx` (new)
- `frontend/src/components/Layout.test.jsx` (new)
- `frontend/src/pages/Dashboard.test.jsx` (new)
- `frontend/src/pages/Roster.test.jsx` (new)
- `frontend/src/pages/Events.test.jsx` (new)
- `frontend/src/pages/Setup.jsx`
- `frontend/src/pages/AccountSettings.jsx` or new `Feedback.jsx`

### Docs & Process
- `README.md`
- `docs-site/docs/product/acceptance-tests.md`
- `docs-site/docusaurus.config.js`
- `docs-site/docs/planning/sprint-backlogs.md`
- `docs-site/docs/meetings/sprint2-review.md`
- `docs-site/docs/meetings/sprint2-retrospective.md`
- `docs-site/docs/meetings/client-meetings.md`
- `docs-site/docs/planning/stakeholder-feedback.md`
- `docs-site/docs/planning/user-feedback.md`
- `docs-site/docs/architecture/api-design.md`
- `docs-site/docs/architecture/external-apis.md`
- `docs-site/docs/architecture/authentication.md`
- `docs-site/docs/architecture/tech-stack.md`
- `docs-site/docs/product/testing-policy.md`
- `docs-site/docs/getting-started/database.md`
- `.gitea/workflows/ci.yml`

---

*End of checklist.*
