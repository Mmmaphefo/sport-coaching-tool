# Sprint 4 Meeting Minutes
**Project:** KickStat - Sport Coaching Tool  
**Sprint Period:** September 29 - October 10, 2026  
**Team Members:** Kgethie, Kgotlelelo, Lindokuhle, Mmaphefo, Tasmiya  

---

## Meeting 1: Sprint 3 Review
**Date:** Monday, 29/09/2026  
**Time:** 17:00 - 18:30  
**Attendees:** All team members  

### Agenda
1. Sprint 3 marks received — marker used wrong rubric
2. Dispute resolution with marker and tutor (Calvin and Austin)
3. Gap review of remaining features

### Discussion Points

**Sprint 3 Mark Dispute:**
- Sprint 3 marks were received and appeared lower than expected
- Team discovered the marker (Calvin) had assessed the project against the **Sport Analytics Tool** brief, not the **Sport Coaching Tool** brief
- The Analytics brief has different requirements (data pipelines, versioned statistics, batch processing) that do not apply to KickStat
- Lindo forwarded the email to Calvin confirming the miscommunication
- Noted some legitimate issues remain: external API insecurity and data validation gaps

**Gap Review:**
- Team reviewed the kickstat-gap-review.pdf document identifying remaining work
- Key gaps identified:
  - Server-side permissions not enforced on most routes (P0-A)
  - Offline queue incomplete — no idempotent replay, entries invisible on timeline (P0-B)
  - Background jobs stop when Render server sleeps (P0-C)
  - Several Advanced-tier features missing: lineup suggestions, auto summaries, season generator
  - README contains claims not backed by code (D1-D9)

### Decisions Made
1. Mark dispute escalated for Feature mark adjustment
2. Team to prioritise P0 items (permissions, offline, server sleep) before Advanced features
3. All members to push work to main and delete feature branches before submission

---

## Meeting 2: Feature Work & CI Fixes
**Date:** Thursaday 8/10/2026  
**Time:** 17:00-18:00
**Attendees:** All team members

### Agenda
1. Self-hosted CI runner setup to speed up deployments
2. Critical bug fixes for production app
3. Feature merges and final testing

### Discussion Points

**CI Runner Setup :**
- Shared Gitea runners (sdp-runner-1/2) were slow due to queue contention across all SDP groups
- Provisioned Oracle Cloud VM (bug-off-runner-new, 145.241.190.111) as self-hosted runner
- Installed act_runner v5.0.0, Docker, Node.js v22, PostgreSQL 13
- CI pipeline now runs in ~8 minutes total (down from 15+ minutes waiting in queue)
- All 4 jobs passing: Frontend Lint & Build, Backend Lint & Test, Coverage Dashboard, Deploy Production

**Critical Bugs Fixed:**

1. **RoleSelect Page Freeze** (HIGH PRIORITY)
   - Root cause: Mount effect awaited `GET /api/account/me` with no timeout; when Render backend was asleep (free tier, 15-min idle sleep), the call hung 30-60s blocking all interaction
   - Secondary cause: `handleSelect` awaited `PATCH /api/account/role` before navigating, freezing UI for up to 20s
   - Fix: Added 8-second timeout on mount check; navigation now fires immediately with role update running in background; "Just Browsing" skips API entirely
   - Files: `frontend/src/pages/RoleSelect.jsx`

2. **OnboardingGuard 404 Error** (HIGH PRIORITY)
   - Root cause: `GET /api/squads/mine` returned 404 (backend asleep or endpoint issue); guard showed red error banner and blocked access to `/setup`
   - Fix: Guard now treats API failures gracefully — on `/setup` page, failures allow wizard to proceed; on other pages, errors are displayed
   - Files: `frontend/src/components/OnboardingGuard.jsx`

3. **Welcome Page Redirect Loop** (MEDIUM PRIORITY)
   - Root cause: `Welcome.jsx` redirected signed-in users to `/role-select`; Back button on RoleSelect navigated to `/` which redirected back, creating infinite loop
   - Fix: Removed auto-redirect from Welcome (all users see landing page); Back button goes to `/dashboard` when signed in, `/` when not
   - Files: `frontend/src/pages/Welcome.jsx`, `frontend/src/pages/RoleSelect.jsx`

**Feature Work:**
- Added team comparison and roster (T10, T19, T20)
- **Mmaphefo:** Worked on medium priority items, pushed to EventsCalendar branch
- **Lindo:** Working on offline syncing and feature verification
- Team coordinated via WhatsApp to merge all branches to main before submission

### Technical Decisions
1. **Self-hosted runner over shared runners:** Justified by deadline pressure and queue wait times
2. **PostgreSQL on runner VM:** Service containers don't work in user-mode; installed Postgres 13 directly on VM
3. **Port 5432 for Postgres:** SELinux blocked non-standard port 5433; reverted to default
4. **Non-blocking navigation:** Role selection navigates immediately; role PATCH runs in background to prevent any UI freeze
5. **Graceful degradation:** OnboardingGuard allows setup wizard to proceed even when backend API fails

### Action Items
| Item | Owner | Status |
|------|-------|--------|
| Verify CI pipeline green on self-hosted runner | Tasmiya | Done |
| Fix frontend test failures on feature branches | Mmaphefo | In progress |
| Verify offline syncing works end-to-end | Lindo | In progress |
| Merge all feature branches to main |Lindo | In progress |
| Set up Cron-Job.org keepalive for Render backend | Tasmiya | Pending |
| Migrate Clerk to production keys (pk_live) | Team | Pending - fixes Safari freeze |
| Final submission testing | All | In progress |

### Risks & Blockers
- **Safari + Clerk dev keys:** `getToken()` hangs indefinitely in Safari due to third-party cookie blocking. Workaround: use Chrome. Permanent fix: migrate to Clerk production instance (free tier available).
- **Render cold start:** Backend sleeps after 15 min idle, causing 30-60s first-request delay. Mitigated by timeouts; permanent fix: external keepalive cron job.
- **PostgreSQL version mismatch:** Runner VM has Postgres 13, CI service container specifies Postgres 16. No issues observed but should be monitored.
- **Server error on team comparison:** reported server error for team comparison feature; needs investigation once credits are available.

### Decisions Made
1. Self-hosted runner approved for production CI (faster than shared runners)
2. Welcome page shows for all users (no auto-redirect based on auth state)
3. Role selection is non-blocking — navigation happens before API confirmation
4. OnboardingGuard degrades gracefully when backend is unreachable
5. All feature branches to be merged to main and deleted before submission

---
## Meeting 3: Final check before submission
**Date:** Thursaday 8/10/2026  
**Time:** 17:00-18:00
**Attendees:** All team members

### Review
- Team ran through the app and made sure all features implemented and working in accordance with project brief and sprint rubrics
- Documentation up to date
- Testing up to date
