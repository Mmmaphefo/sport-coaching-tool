---
sidebar_position: 5
---

# Sprint 3 Report

**Sprint Period:** 15 September – 29 September 2026  
**Team:** Kgethie, Kgotlelelo, Lindokuhle, Mmaphefo, Tasmiya 

---

## 1. Feature Status

### Completed Features

| Feature | Owner | Status | Notes |
|---------|-------|--------|-------|
| Athlete & Squad Comparison (US27, US28) | Done | Side-by-side stat comparison with BMI display |
| Pro Fixtures removal | Done | football-data.org integration removed (see Feature Rationale) |
| Sessions / Drill Library | Done | Auto-generate training sessions based on tactical goals |
| Tactics Board save fix | Done | Persistent tactics with frame-based board states |
| RSVP through availability | Done | Athletes can set availability per event |
| Clash detection | Done | Pre-creation and post-creation time conflict checks |
| Public squad page | Done | Shareable public profile with roster and results |
| Venue Map editor | Done | Interactive pitch map for event locations |
| Offline logging | Done | Client-side queue for unreliable connections |
| Stats override | Done | Coach-only stat corrections with audit trail |
| UI redesign (full) | Done | Navy/blue/volt-lime design system, dark theme, Barlow Condensed typeface |
| Gender feature | Done | Male/Female squad gender with matchmaking filter |
| Match simulation | Done | EA FC ratings-weighted match simulation |
| Public landing page | Done | Directory of public squads with live events |
|CSV export for public squad | Done | Downloadable roster export |
|Email notification system | Done | Reminders + invite emails implemented; invite delivery moved to Gmail and is pending `GMAIL_USER`/`GMAIL_APP_PASSWORD` env config on Render |

### Bug Fixes Resolved

| Bug | Status |
|-----|--------|
| Cannot schedule match dates within leagues | Fixed |
| Live match timer always shows zero | Fixed |
| Can schedule matches on past dates | Fixed |
| Weather widget not displaying | Fixed |
| Cannot end training session after starting live | Fixed |
| Cannot edit events after creation | Fixed |
| Events can start at wrong times | Fixed |
| Events don't auto-start at scheduled time | Fixed |
| Live matches only visible to creator | Fixed |
| Email notifications not sending | Fixed |

### Features Not Started / Deferred

| Feature | Reason |
|---------|--------|
| Dark mode text consistency | Minor UI polish; deferred to Sprint 4 |

---

## 2. Testing Coverage

### Backend Tests (17 integration test files + 1 migration test)

| Test File | Coverage Area |
|-----------|---------------|
| account.integration.test.js | Account retrieval, deletion, webhook cleanup |
| athletes.integration.test.js | Roster CRUD, stat overrides, injury flags |
| auth-and-roles.integration.test.js | JWT validation, role-based access control |
| event-start-guards.integration.test.js | Auto-transition to live status |
| events.integration.test.js | Event CRUD, league creation, gender filter |
| fixtures.integration.test.js | Fixture lineups, logging, simulation |
| injuries.integration.test.js | Injury logging, return date estimation |
| invites.integration.test.js | Assistant/athlete invite flow |
| lineups.integration.test.js | Starting XI and bench management |
| match-availability.integration.test.js | RSVP availability, clash detection |
| missing-features.integration.test.js | RSVPs, stat overrides, public pages, offline logging |
| reminders.integration.test.js | Event reminder sweep |
| roster-and-events-basic.integration.test.js | Basic roster + event operations |
| simulation.integration.test.js | Match simulation with ratings |
| squad.integration.test.js | Squad creation, gender, public visibility |
| weather.integration.test.js | Weather API integration |
| migrations.test.js | Migration integrity verification |

### Frontend Tests (18+ test files)

| Test File | Coverage Area |
|-----------|---------------|
| AccountSettings.test.jsx | Team name + gender save flow |
| AthleteStats.test.jsx | Athlete stat display and BMI |
| Dashboard.test.jsx | Dashboard summary rendering |
| EventDetail.test.jsx | Event timeline and lineups |
| Events.test.jsx | Event listing with gender filter |
| InviteAccept.test.jsx | Invite acceptance flow |
| LiveMatch.test.jsx | Live match logging interface |
| PublicLanding.test.jsx | Public squad directory |
| PublicSquad.test.jsx | Public squad page |
| Roster.test.jsx | Athlete roster management |
| Welcome.test.jsx | Onboarding redirect |
| ConfirmProvider.test.jsx | Confirmation dialog component |
| Layout.test.jsx | App layout wrapper |
| Pitch.test.jsx | 2D pitch visualization |
| ProtectedRoute.test.jsx | Auth route guard |
| VenueMapEditor.test.jsx | Venue map editor |
| api.test.js | API request utility |
| simulation.test.js | Simulation logic |
| lineups.test.js | Lineup computation |

### Test Results

- **Backend:** 17 integration test suites passing — 145 individual tests, statement coverage above 75%
- **Frontend:** 19 test files passing — 123 individual tests, about 63% line coverage
- **CI:** All tests run on every push via Gitea Actions (lint + build + test + coverage for both codebases), with reports on the coverage dashboard and Codecov

---

## 3. User Feedback

### Feedback from Stakeholder (Austin / Kgethie)

| Feedback | Action Taken |
|----------|--------------|
| "Need our own back buttons on pages" | Identified for Sprint 4 implementation |
| "Should consider gender — female squad can play against males" | Implemented gender feature (Male/Female) with matchmaking filter |
| Improve overall look of the app | UI redesign validated — dark theme and design system well received |
| Dark mode text not visible on some pages | Logged for Sprint 4 fix |

### Internal Testing Feedback

| Area | Finding | Resolution |
|------|---------|------------|
| Mobile responsiveness | Confirmed working on mobile devices | No action needed |
| Live logging | Working correctly with pitch visualization | No action needed |
| Offline logging | Functional but slow performance noted | Deferred optimization to Sprint 4 |
| Render cold start | First request after idle may timeout | Documented — free tier sleeps after 15 min |

### User Testing Sessions

- Live match logging demonstrated and validated end-to-end
- Match simulation tested with full 90-minute generation
- Public squad pages tested for shareability
- Gender filter tested for correct event filtering

---

## 4. Sprint 3 Summary

| Metric | Value |
|--------|-------|
| Core features complete | 95% |
| Bug fixes resolved | 9/10 |
| UI redesign | 100% |
| Tests passing | 268 (145 backend + 123 frontend) |
| Documentation | In progress |

### Key Achievements
1. Complete UI redesign with unified design system
2. Gender-based matchmaking for fair competition
3. Tactics and Sessions features filling coaching workflow gaps
4. Public squad pages for community engagement
5. Offline logging for unreliable connectivity
6. Match simulation for demonstration and testing

### Carry-over to Sprint 4
1. Dark mode text consistency fixes
2. Final documentation (group report, API docs, user guide)
3. Presentation preparation

