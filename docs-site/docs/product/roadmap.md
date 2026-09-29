---
sidebar_position: 5
---

# Roadmap

The project is delivered in four sprints, each with a clear goal and set of user stories.

## Sprint 0 — Project Setup & Foundation

**Dates:** 26 July 2026 – 1 August 2026

**Goal:** Establish the repository, CI/CD pipeline, tech stack, and initial database schema.

**Deliverables:**
- Gitea repository with branch protection rules
- Self-hosted `act_runner` on Oracle Linux 9
- Initial PostgreSQL schema (users, squads, athletes)
- Hello-world frontend and backend running locally
- README and getting-started guide

## Sprint 1 — Authentication, Squad Setup & Roster Management

**Dates:** 1 August 2026 – 25 August 2026

**Goal:** Deliver core onboarding and squad management features.

**User Stories:**
- US1 — Coach & assistant registration and login
- US2 — Password reset & account deletion
- US21 — Coach self-service sign-up
- US22 — First-login setup flow
- US23 — Invited assistant sign-up
- US24 — Athlete email invites
- US26 — Assistant role permission boundary
- US3 — Add athletes to roster
- US4 — Edit or remove athlete
- US-I1 — CI/CD pipeline
- US-I2 — Public documentation site

**Metrics:**
- 37 backend tests passing
- 65% statement coverage
- Clean lint on frontend and backend
- All Sprint 1 stories merged to `main`

## Sprint 2 — Events, Fixtures & Live Match Logging

**Dates:** 27 August 2026 – 15 September 2026 *(planned)*

**Goal:** Enable coaches to schedule events, generate fixtures, and log live match actions.

**User Stories:**
- US5 — Create match or training event
- US6 — Edit or cancel event
- US13 — Start live event logging
- US14 — Log scoring actions
- US15 — Log disciplinary actions
- US16 — Undo log entry
- US18 — Venue weather forecast
- League/tournament auto-scheduling

**Deliverables:**
- Full event CRUD with status transitions
- Live match logging UI
- Auto-generated fixtures for leagues/tournaments
- Weather widget on event pages

## Sprint 3 — Statistics, Notifications & Advanced Features

**Dates:** 15 September 2026 – 29 September 2026

**Goal:** Close the Sprint 2 rubric gaps, fix the demo bug list, and deliver the advanced coaching feature set.

**User Stories:**
- US27 — Athlete & squad comparison
- US28 — Public squad page (+ CSV export)
- US29 — Event notifications (reminders + invite emails)
- US41 — RSVP availability with start-live gate
- US42 — Coach stat override with audit trail
- US43 — Clash detection
- US44 — Venue map editor
- US45 — Offline logging queue
- US46 — Tactics board
- US47 — Sessions / drill library
- US48 — Ratings-weighted match simulation
- US49 — Squad gender & matchmaking filter
- US50 — Public landing page

**Deliverables:**
- 9/10 demo bugs fixed (email delivery pending Gmail env config on Render)
- Full UI redesign with a unified design system
- Pro Fixtures (football-data.org) removed — justification in Feature Rationale
- 145 backend + 123 frontend automated tests, all running in CI with coverage

**Metrics:**
- 268 automated tests passing across both codebases
- Backend coverage above 75%, frontend coverage above 60% (line coverage)
- Core features 95% complete

## Sprint 4 — Polish, Bug Fixes & Deployment Prep

**Dates:** 29 September 2026 – 11 October 2026 *(planned)*

**Goal:** Fix post-assessment bugs, improve coverage, and prepare for deployment.

**Planned Features:**
- Bug fixes from Sprint 3 demo feedback
- Coverage improvement push
- Production deployment to cloud host
- Final documentation updates
