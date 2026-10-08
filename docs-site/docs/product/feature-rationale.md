---
sidebar_position: 2
---

# Feature Rationale

This page explains why each major feature exists and what user problem it solves. Every feature ties back to a user story in the backlog.

## E1 · Auth & Roles

### Coach self-service sign-up (US21)

**Why:** Coaches are the primary users. Requiring an admin to create accounts would block adoption. Self-service sign-up lets a coach start using the tool immediately, while Clerk handles password security, email verification, and password reset flows so the team does not build a custom auth system.

**What it does:** A visitor signs up via Clerk and is automatically assigned the `coach` role. A squad is created and linked to them on first use.

### First-login setup flow (US22)

**Why:** A coach with no athletes has nothing useful to see on a dashboard. The setup flow turns an empty state into an onboarding action, guiding the coach to name their squad and add the first athlete before they reach the main app.

**What it does:** When a coach has zero athletes, the dashboard redirects to a setup screen prompting for squad name and first athlete details.

### Invited assistant sign-up (US23)

**Why:** Coaches need help on match day but do not want to share their own login. Invited assistants get their own account, linked automatically to the coach's squad, with a restricted role.

**What it does:** The coach enters an assistant's email on the dashboard. An invite token is created and emailed. When the assistant signs up via the invite link, their account is assigned the `assistant` role and linked to the inviting squad.

### Athlete email invites (US24)

**Why:** Athletes benefit from seeing their own stats, but they should not see the full squad or be able to edit data. Linking an athlete's roster row to their login gives them a personalised view without creating duplicate records.

**What it does:** When adding an athlete, the coach can optionally enter an email. An invite is created and, once accepted, the athlete's user row is linked to their roster record.

### Assistant role permission boundary (US26)

**Why:** Trust is a real concern. Coaches must be able to delegate match-day logging without worrying that an assistant can delete athletes or change squad details.

**What it does:** Backend route guards reject any roster write attempt from a user whose role is not `coach`. The frontend also hides add/edit/remove controls for assistants.

### Account deletion (US2)

**Why:** Users have a right to remove their data. Account deletion must clean up local records and the Clerk identity record.

**What it does:** The user confirms deletion in Settings. The backend deletes invites, log entries, user row, and calls Clerk's API to delete the Clerk user.

## E2 · Roster Management

### Add athletes to roster (US3)

**Why:** The roster is the foundation of the app. Without it, there are no athletes to log events against and no stats to derive.

**What it does:** A coach fills in name, position, squad number, date of birth, and contact info. The athlete is stored under the coach's squad.

### Edit or remove athlete (US4)

**Why:** Details change — players switch positions, numbers get reused, contact info is updated. Coaches need full control over their squad data.

**What it does:** Coaches can edit any athlete in their squad or remove them entirely. Backend ownership checks prevent coaches from modifying another squad's athletes.

## E3 · Event Management

### Create match or training event (US5)

**Why:** Match and training schedules are central to a coach's week. Recording them in the app makes them visible to assistants and athletes and provides the context for live logging.

**What it does:** A coach creates an event with title, type, opponent (for matches), date, time, location, and duration.

### Edit or cancel event (US6)

**Why:** Plans change. Coaches need to update times or cancel events without losing historical records.

**What it does:** Events can be edited or marked as cancelled. Cancelled events cannot accept new log entries.

### Live event logging (US13–US16)

**Why:** Memory fades quickly during a match. Logging actions as they happen produces more accurate records and lets assistants and coaches see the state of play in real time.

**What it does:** During a live event, users log actions (goal, yellow card, red card, penalty, save, substitution) against an athlete or the opponent. Entries can be undone via soft delete.

### Ratings-weighted match simulation (Quick Sim & Simulate Match)

**Why:** Logging a match by hand costs the 90 real minutes it takes to play, so a match that was already played can't be reconstructed, and the live view can't be demonstrated or rehearsed without sitting through a full game. Generating a realistic match instead makes that possible, and lets the whole logging pipeline be exercised end-to-end on demand.

**What it does:** Two extra buttons on the live match page generate and play back a full 90 minutes, using the players in the squad's saved lineup (starters and bench). **Quick Sim** posts the whole match at once; **Simulate Match** replays the same script over exactly two real minutes so the logging is visible as it happens. Outcomes are weighted by each player's rating — resolved from an external dataset, or estimated from position for anyone the dataset does not know (details on the [EA FC Player Ratings Dataset](../third-party/player-ratings.md) page) — and the script is replayed through the ordinary log endpoint, so a simulated match is recorded the same way as a hand-logged one. Manual logging is unchanged, and this extends the US13–US16 live logging flow rather than replacing it.

### Venue weather forecast (US18)

**Why:** Outdoor sports depend on weather. Showing the forecast at the venue helps coaches decide whether to proceed, postpone, or change kit.

**What it does:** The app geocodes the venue name and fetches current weather and a short forecast from a public weather API.

## E4 · Infrastructure & Documentation

### CI/CD pipeline (US-I1)

**Why:** With multiple developers contributing, automated lint and test checks catch regressions before they reach `main`.

**What it does:** Every push and PR runs frontend lint/build and backend lint/test against a fresh PostgreSQL service container.

### Public documentation site (US-I2)

**Why:** Stakeholders, tutors, and future team members need a single place to understand the product, architecture, and how to run it.

**What it does:** This Docusaurus site documents the product vision, user stories, acceptance tests, architecture, and development guides.

---

## E5 · Sprint 3 Feature Changes

### Removal of Pro Fixtures (football-data.org integration)

**Why it was removed:**

The Pro Fixtures feature integrated with football-data.org to display professional league fixtures and standings alongside the coach's own events. It was removed in Sprint 3 for the following reasons:

1. **Unreliable external dependency:** The football-data.org free tier allows only 10 requests per minute. During peak usage (e.g., multiple coaches loading the Events page simultaneously), the API would rate-limit or timeout, causing the Pro Fixtures tab to fail silently or display stale data.

2. **Not core to product vision:** KickStat's primary purpose is to help coaches manage *their own* squads, events, and athletes. Displaying Premier League or Champions League fixtures was a nice-to-have comparison, but it did not solve a coaching workflow problem. Coaches reported they rarely used it.

3. **Maintenance burden:** The integration required an API key environment variable, an in-memory cache with a 5-minute TTL, and a custom allow-list of league codes. When the API changed response formats or added new competitions, the integration broke without warning.

4. **Resource reallocation:** Removing Pro Fixtures freed development time to implement features that directly address coaching needs (Tactics, Sessions, Gender) rather than maintaining a fragile third-party dependency.

**Decision rationale:** The team agreed that a reliable, focused product is better than one with a flashy but unstable external integration. The football-data.org documentation page is retained in this docs site for reference, but the route (`backend/src/routes/external.js`) and its frontend tab have been removed.

---

### Addition: Tactics Board (not in original backlog)

**Why it was added:**

The Tactics Board allows coaches to create, save, and edit visual play diagrams on a 2D pitch. It was not in the original product backlog but was identified as a critical gap in the coaching workflow.

**User problem solved:** Coaches currently draw tactics on whiteboards or paper, which cannot be saved, shared, or revisited. Without a digital tactics tool, there is no way to plan a set piece, review it later, or communicate it to assistants remotely.

**What it does:**
- Drag-and-drop player positions on a 2D pitch
- Draw arrows for passing lanes, movement patterns, and pressing triggers
- Save multiple "frames" as a single tactic (e.g., attacking phase → defensive transition)
- Load saved tactics during match preparation

**Why it was prioritised:** The Tactics Board was the most-requested feature during user testing. Coaches indicated they would use external tools (e.g., tactical apps or image editors) if KickStat did not provide this, which would fragment their workflow.

---

### Addition: Sessions / Drill Library (not in original backlog)

**Why it was added:**

The Sessions feature provides a drill library that coaches can browse, filter, and auto-generate based on tactical goals, age groups, and available time. It complements the Tactics Board by translating tactical plans into actionable training sessions.

**User problem solved:** Coaches spend significant time researching and designing drills from scratch. Without guidance, training sessions lack structure and may not address the team's tactical weaknesses.

**What it does:**
- Pre-seeded drill library with tactical goals (possession, pressing, transition, set pieces)
- Filters for age group, duration, and phase of play
- Auto-generate a full training session by selecting a tactical goal and time budget
- Custom drills can be created, edited, and deleted

**Why it was prioritised:** The Sessions feature closes the loop between tactics and training. A coach can plan a tactic on the Tactics Board, then generate a session that drills that specific tactic. This end-to-end workflow was missing from the original backlog.

---

### Addition: Gender Feature (not in original backlog)

**Why it was added:**

The Gender feature allows squads to be tagged as Male or Female, and provides a matchmaking filter so that female squads do not accidentally join leagues or play against male squads. It was added after stakeholder feedback.

**User problem solved:** Without gender tagging, a female squad could join a mixed or male league and face opponents that are physically mismatched. This creates unfair competition and potential safety concerns, particularly in youth football.

**What it does:**
- Squad gender field (Male/Female) in Account Settings and Setup wizard
- Gender filter toggle on the Events page for league matchmaking
- Gender badges on Dashboard and Events for quick identification
- Backend validation ensures only 'male' or 'female' values are accepted

**Why it was prioritised:** This was raised by a team member (Kgethie) who identified that gender-based matchmaking is a fundamental fairness issue in sport. The original backlog did not account for this because the team is predominantly male and had not considered the scenario. After discussion, the team agreed that ignoring gender would make the product unsuitable for women's football — a growing segment of the sport.

**Design decision:** The team deliberately chose not to include a "Mixed" option. Mixed teams exist in practice, but for the purposes of league matchmaking, a squad should compete in a category that reflects its primary composition. A Male/Female binary simplifies filtering and avoids ambiguity.
