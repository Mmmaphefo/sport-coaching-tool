---
sidebar_position: 2
---

# Sprint Backlogs

This page contains the sprint backlogs for Kickstat. Story points follow the scale: 1 trivial, 2 small, 3 standard, 5 large, 8 very large.

## Sprint 0 — Project Setup & Foundation

**Dates:** 24 March 2026 – 30 March 2026  
**Goal:** Establish repository, CI/CD, tech stack, and initial schema.

| Story ID | Story | Task | Assignee | SP |
|---|---|---|---|---|
| INF-01 | Repository setup | Create Gitea repo and branch protection | Kgethego | 1 |
| INF-02 | CI/CD runner | Set up act_runner on Oracle Linux 9 | Tasmiya | 5 |
| INF-03 | Frontend skeleton | Initialise Vite React app with routing | Lindokuhle | 2 |
| INF-04 | Backend skeleton | Initialise Express app with health route | Mmaphefo | 2 |
| INF-05 | Initial schema | Create users, squads, athletes migrations | Mmaphefo | 3 |
| INF-06 | README | Write getting-started guide | Kgotlelelo | 2 |
|  |  | **Total** |  | **15** |

## Sprint 1 — Authentication, Squad Setup & Roster Management

**Dates:** 06 April 2026 – 13 April 2026  
**Goal:** Deliver core onboarding and squad management features.

| Story ID | Story | Task | Assignee | SP |
|---|---|---|---|---|
| US1 | Coach & assistant login | Clerk auth middleware (backend + frontend) | Tasmiya | 3 |
| US21 | Coach self-service sign-up | Auto-create squad on first API call | Tasmiya | 2 |
| US22 | First-login setup flow | Build setup UI and redirect logic | Lindokuhle | 3 |
| US23 | Assistant invite | Create invite token + email + accept flow | Tasmiya | 3 |
| US24 | Athlete email invite | Add email to athlete + athlete invite flow | Tasmiya | 3 |
| US26 | Assistant permission boundary | Backend role checks + hide UI controls | Mmaphefo | 3 |
| US3 | Add athletes | Roster add form + backend route | Lindokuhle | 2 |
| US4 | Edit/remove athlete | Edit/delete form + ownership checks | Mmaphefo | 2 |
| US2 | Account deletion | Danger-zone UI + backend cleanup | Kgotlelelo | 3 |
| US-I1 | CI/CD pipeline | Configure `.gitea/workflows/ci.yml` | Kgethego | 3 |
| US-I2 | Documentation site | Scaffold Docusaurus and initial pages | Kgotlelelo | 3 |
|  |  | **Total** |  | **30** |

## Sprint 2 — Events, Fixtures & Live Match Logging

**Dates:** 26 August 2026 – 15 September 2026
**Goal:** Enable coaches to schedule events, generate fixtures, log live match actions, and meet all Milestone 2 rubric criteria.

| Story ID | Story | Task | Assignee | SP | Status |
|---|---|---|---|---|---|
| US5 | Create event | Event form + backend route | Lindokuhle | 3 | Done |
| US6 | Edit/cancel event | Update/cancel endpoints + UI | Mmaphefo | 2 | Done |
| US6-B | Cancelled event logging block | Reject logs on cancelled events | Lindokuhle | 1 | Done |
| US13 | Start live event | Event status transition to live | Mmaphefo | 2 | Done |
| US14 | Log scoring actions | Goals, penalties, saves endpoints | Lindokuhle | 3 | Done |
| US15 | Log disciplinary actions | Yellow/red card endpoints | Lindokuhle | 2 | Done |
| US16 | Undo log entry | Soft-delete log entry | Mmaphefo | 2 | Done |
| US18 | Weather forecast | Venue geocoding + Open-Meteo integration | Kgethego | 3 | Done |
| US19 | League/tournament fixtures | Round-robin fixture generation | Mmaphefo | 5 | Done |
| US20 | Event team join | Other squads join open events | Kgethego | 3 | Done |
| US26 | Assistant permission boundary | Backend role checks + hide UI controls | Kgethego | 3 | Done |
| T-01 | Frontend test framework | Vitest + React Testing Library setup + CI execution | Mmaphefo | 3 | Done |
| T-02 | API documentation | OpenAPI spec + Swagger UI | Lindokuhle | 2 | Done |
| D-01 | Deploy docs site | Docusaurus to Netlify/Cloudflare | Tasmiya | 2 | Done |
| US29 | Log athlete injury | Injury form, estimator + POST /api/injuries | Kgotlelelo | 3 | Done |
| US30 | Return-to-play estimate | Recovery-range estimator + coach override | Kgotlelelo | 2 | Done |
| US31 | Injury flag on roster | is_injured flag with auto/manual clearance | Kgotlelelo | 2 | Done |
| F-01 | User testing session | Recruit 3-5 users, document feedback | Kgotlelelo | 3 | done |
|  |  | **Total** |  | **47** |  |

## Sprint 3 — Statistics, Notifications & Advanced Features

**Dates:** 15 September 2026 – 29 September 2026  
**Goal:** Deliver the remaining rubric gaps from Sprint 2 feedback, fix the top-10 bug list, and ship the advanced coaching features (comparison, tactics, drills, simulation, public pages, availability).

| Story ID | Story | Task | Assignee | SP | Status |
|---|---|---|---|---|---|
| US27 | Athlete & squad comparison | Compare endpoint + side-by-side page with BMI | Tasmiya / Lindokuhle | 5 | Done |
| US28 | Public squad page | Shareable public profile + CSV export | Kgethie | 5 | Done |
| US29 | Event notifications | Hourly reminder sweep (Resend) + Gmail invite emails | Kgethego | 3 | Done |
| US41 | RSVP availability | event_rsvps table, athlete self-serve + coach RSVPs, start-live availability gate | Lindo | 5 | Done |
| US42 | Stat override | Coach-only corrections with audit trail, merged into athlete stats | Lindo | 3 | Done |
| US43 | Clash detection | Pre-creation and post-creation time-conflict checks | Lindo | 3 | Done |
| US44 | Venue map editor | Editable OSM pin on events (lat/lng) + weather pin support | Lindo | 3 | Done |
| US45 | Offline logging | Client-side queue with client_id idempotent replay | Lindo | 5 | Done |
| US46 | Tactics board | Saved 2D tactics with frames (migration + save fix) | Lindo | 5 | Done |
| US47 | Sessions / drill library | drills table, auto-generate sessions from tactical goals | Lindo | 3 | Done |
| US48 | Match simulation | EA FC ratings-weighted 90-minute simulation (events + fixtures) | Lindo | 8 | Done |
| US49 | Squad gender | Male/female squad gender + matchmaking filter | Kgethie / Mmaphefo | 3 | Done |
| US50 | Public landing page | Directory of public squads with live events | Kgethie | 3 | Done |
| UI-01 | Full UI redesign | Navy/blue/volt-lime design system, dark theme, Barlow Condensed | Kgotlelelo | 8 | Done |
| REM-01 | Remove Pro Fixtures | Drop football-data.org integration (justified in Feature Rationale) | Tasmiya | 2 | Done |
| BUG-01..10 | Sprint 3 bug list | 10 demo bugs (scheduling, timer, weather, auto-start, visibility…) | Mmaphefo | 8 | 9 Done|
|  |  | **Total** |  | **72** |  |


## Sprint 4 — Polish, Bug Fixes & Deployment Prep

**Dates:** 29 September 2026 – 13 October 2026 *(planned)*  
**Goal:** Fix post-assessment bugs, improve coverage, and deploy.

| Story ID | Story | Task | Assignee | SP |
|---|---|---|---|---|
| MAP-01 | Venue map upgrade | Replace the OSM venue map with Mapbox: dark navigation basemap, address search with geocoding, high-accuracy GPS pin with accuracy display, reverse geocoded address, coordinates on the create form too | Lindo | 5 |
| PUB-01 | Public leaderboard | Landing-page table ranking every public squad across completed matches and league fixtures (P/W/D/L, goals, clean sheets, points) | Lindo | 3 |
| FIX-01 | Bug fixes | Address demo feedback | All | 5 |
| FIX-02 | Coverage push | Add missing tests to reach 75%+ | Kgotlelelo | 5 |
| DEP-01 | Deploy frontend | Static site deployment | Kgethego | 2 |
| DEP-02 | Deploy backend | Managed Node.js deployment | Mmaphefo | 3 |
| DOC-01 | Final docs | Update all documentation | Tasmiya | 3 |
|  |  | **Total** |  | **26** |
