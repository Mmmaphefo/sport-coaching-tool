# Acceptance Tests (Given–When–Then)

Per the course's TDD requirement (1.5), every user story below has one or more
acceptance tests. These are the source of truth for "is this story done?" —
where a test is automated, the file is linked; where it isn't (yet, or can't
be meaningfully automated at this stage), that's noted so it doesn't get
mistaken for coverage that doesn't exist.

---

## E1 · Auth & Roles

### US1 — Coach & Assistant Registration and Login
- Given a new coach visits the site, When they complete sign-up via the auth provider, Then their account is created and they land on an empty squad dashboard.
- Given a registered user is logged out, When they enter valid credentials, Then they are authenticated and land on their dashboard.
- Given an unauthenticated user tries to access a protected page, When they navigate directly via URL, Then they are redirected to the login page.

Automated: registration-on-signup covered in `backend/tests/integration/auth-and-roles.integration.test.js` (`US1`). Route-guard redirect behaviour is frontend routing (`ProtectedRoute.jsx`) — not covered by a backend test; needs a frontend test runner (none set up yet) or manual verification.

### US2 — Password Reset & Account Deletion
- Given a user has forgotten their password, When they request a reset link and follow it, Then they can set a new password and log in with it.
- Given a user opens account settings and clicks Delete Account, When they confirm the action, Then their account and access are permanently removed.

Automated: deletion cascade covered in `auth-and-roles.integration.test.js` (`US2`). Password reset itself is entirely handled by Clerk's hosted flow — nothing in this codebase to unit test; verify manually against Clerk's dashboard config.

### US21 — Coach self-service sign-up
- Given a new visitor lands on the sign-up page, When they complete self-service sign-up, Then they are registered with the "coach" role and no option to select assistant or athlete is shown.
- Given a new coach completes sign-up, When their account is created, Then a squad is automatically created and linked to them.

Automated: covered in `auth-and-roles.integration.test.js` (`US21`, shares the webhook path with `US1`). The "no role picker shown" half is a Clerk sign-up UI config check — verify in Clerk's dashboard/component config, not backend-testable.

### US22 — First-login setup flow for a squad with no roster
- Given a coach who has a squad but zero athletes, When they log in, Then they are redirected to a setup flow prompting them to add their roster.
- Given a configurable minimum squad size is set, When the coach's athlete count is below that minimum, Then the squad's status remains "setup" (not "active") until the minimum is met.

**Not yet implemented or tested.** Under the current webhook (`backend/src/routes/webhooks.js`), a squad is auto-created the moment a coach signs up — there's no "no squad yet" state to redirect from, and there's no `status` column on `squads` or configurable minimum size. Worth a quick team conversation on whether this story still matches the built signup flow before writing tests against it.

### US23 — Invited assistant sign-up
- Given a user opens a valid invite link, When they complete sign-up via that link, Then their account is created with the "assistant" role and linked to the inviting coach's squad, without requiring separate approval.

Automated: covered in `auth-and-roles.integration.test.js` (`US23`).

### US24 — Coach adds an athlete with an email
- Given a coach is adding an athlete to the roster, When they enter the athlete's email and submit, Then an account-creation email with a temporary password is sent to that address.

**Not yet implemented.** `backend/src/routes/athletes.js` accepts a `contact_info` field but there's no email/temp-password issuance logic. Needs building before a test can verify it.

### US25 — Temporary password / forced reset for athletes
- Given an invited athlete receives their temporary password email, When they log in using it, Then they are required to set a new password before accessing the app.
- Given a temporary password has been used once or has existed for more than N days, When it is used again, Then login is rejected and a new temporary password must be issued.

**Not yet implemented.** This is Clerk-managed credential behaviour once US24 exists — likely configured in Clerk's dashboard rather than custom code. Flag for whoever builds US24 to confirm Clerk supports this out of the box before assuming custom backend logic is needed.

### US26 — Assistant role permission boundary
- Given a logged-in user with the "assistant" role, When they attempt to log an event (score/penalty entry), Then the request succeeds.
- Given a logged-in user with the "assistant" role, When they attempt to add, edit, or remove an athlete from the roster via the API, Then the request is rejected with an authorization error, regardless of what the UI shows.

Automated: covered in `auth-and-roles.integration.test.js` (`US26`) — **this test currently fails.** `athletes.js` has no role check at all right now; any authenticated user (coach or assistant) can write to the roster. That's expected under TDD: the test documents the required behaviour, and stays red until someone adds the role check.

---

## E2 · Roster Management

### US3 — Add Athletes to Roster
- Given a logged-in coach completes the add-athlete form, When they submit it, Then the athlete appears on the squad roster.
- Given a coach views their roster, When no athletes have been added yet, Then an empty-state prompt to add the first athlete is shown.

Automated: covered in `backend/tests/integration/roster-and-events-basic.integration.test.js` (`US3`). The existing `athletes.integration.test.js` only covers the later per-athlete-stats story (US17), not this one — that gap is now closed. The empty-state *prompt* itself is a frontend rendering concern (backend test only confirms the API returns `[]`, which is what the prompt would key off of) — no frontend test runner is set up yet to check the UI directly.

### US4 — Edit or Remove an Athlete
- Given a coach views one of their own athletes, When they edit and save a detail, Then the roster reflects the change immediately.
- Given a coach who does not own a squad, When they attempt to call the edit endpoint directly, Then the request is denied with an access error.

Automated: covered in `roster-and-events-basic.integration.test.js` (`US4`), including the non-owner-denied case on both edit and delete. Good news while writing these: `athletes.js` already enforces squad ownership correctly on both endpoints — this one's solid, unlike `US26`.

---

## E3 · Event Management

### US5 — Create a Match or Training Event
- Given a coach fills in date, time, location, and type, When they submit the form, Then a new event is created and visible on the squad calendar.
- Given a coach leaves a required field empty, When they click Submit, Then a validation error is shown and the form does not submit.

Automated: covered in `roster-and-events-basic.integration.test.js` (`US5`). The existing `events.integration.test.js` only covers live-logging stories (US13–16), not event creation itself — that gap is now closed. Form-level validation UX is frontend-only; the backend test confirms the API rejects a missing `event_date` with a 400, which the frontend validation would be built against.

### US6 — Edit or Cancel an Event
- Given a coach views an upcoming event, When they change the time and save, Then the event reflects the new time for all squad members.
- Given a coach cancels an event, When the cancellation is confirmed, Then the event is marked Cancelled and no longer loggable.

Automated: covered in `roster-and-events-basic.integration.test.js` (`US6`), including a non-owner-denied case on cancel. "No longer loggable" (the second half of the cancel AC) isn't yet asserted — `events.js`'s log-entry routes (`POST /:id/logs`) don't currently check the event's `status` before accepting a new log, so a cancelled event can still be logged against. Worth a follow-up test once that check exists, similar to the `US26` gap.

### US18 — Venue Weather Forecast
- Given a coach is on an event's creation or detail page, When the event has a venue set, Then the current weather for that venue is shown, pulled from a public weather API.

Automated: covered in `backend/tests/integration/weather.integration.test.js`. Uses Open-Meteo (free, no API key needed) — geocodes the venue's free-text name, then fetches current conditions + a 3-day outlook. Shown both on the event creation form (live preview as the coach types a venue) and on the event detail page (once saved) via a shared `WeatherWidget` component.

---

## E5 · Statistics, Availability & Advanced Coaching (Sprint 3)

### US27 — Athlete & Squad Comparison
- Given two athletes in my squad, When I open the comparison page and pick both, Then their season stats, BMI, and form appear side by side.
- Given an athlete from another squad, When I force the compare API call, Then the request is rejected.

Verified manually during Sprint 3 feature-testing sessions. Automated coverage planned for Sprint 4.

### US28 — Public Squad Page
- Given a squad marked public, When a visitor opens its public link without logging in, Then the roster and results are visible.
- Given a coach on the settings page, When they enable the public page, Then a shareable link (and CSV export) is available.

Automated: `backend/tests/integration/missing-features.integration.test.js` (public pages), `frontend/src/pages/PublicSquad.test.jsx`, `frontend/src/pages/PublicLanding.test.jsx`.

### US29 — Event Notifications
- Given a scheduled event starting within 24 hours, When the hourly reminder sweep runs, Then the coach receives a reminder email.
- Given a coach invites an assistant, When the invite is created, Then an email with the invite link is sent via Gmail.

Automated: `backend/tests/integration/reminders.integration.test.js` (reminder sweep). Gmail invite delivery verified manually (requires `GMAIL_USER` / `GMAIL_APP_PASSWORD` env config).

### US41 — RSVP Availability
- Given an athlete with an account, When they open an event, Then they can set their own availability (available/unavailable/maybe).
- Given a coach below the minimum available RSVP count, When they try to start the match, Then the start is blocked with an explanation.

Automated: `backend/tests/integration/match-availability.integration.test.js` (RSVP flow, availability gate, auto-start behaviour).

### US42 — Stat Override
- Given a stat shown on an athlete's profile, When the coach corrects it with a note, Then the corrected value displays alongside the computed value.
- Given an assistant, When they attempt to set an override, Then the API rejects the request with 403.

Automated: `backend/tests/integration/athletes.integration.test.js` (override CRUD, permission boundary), `frontend/src/pages/AthleteStats.test.jsx` (corrected display).

### US43 — Clash Detection
- Given a new event overlaps an existing one, When the coach submits the form, Then a conflict warning names the clashing event.
- Given an existing event is edited into a clash, When the update is saved, Then the clash is flagged on the detail page.

Automated: `backend/tests/integration/match-availability.integration.test.js` (clash checks).

### US44 — Venue Map Editor
- Given an event edit form, When the coach drops a pin on the map, Then the coordinates save with the event and the weather widget centres on them.

Automated: `frontend/src/components/VenueMapEditor.test.jsx` (pin placement, drag, geolocate, clear).

### US45 — Offline Logging
- Given the device loses signal mid-match, When actions are logged, Then they queue locally and replay on reconnect.
- Given a replayed entry whose original request actually landed, When it is resent, Then no duplicate row is created.

Automated: `backend/tests/integration/missing-features.integration.test.js` (idempotent `client_id` replay).

### US46 — Tactics Board
- Given a coach draws frames on the tactics board, When they save, Then the tactic persists with its frames and reloads correctly.

Verified manually in Sprint 3. Automated coverage planned for Sprint 4.

### US47 — Sessions / Drill Library
- Given a tactical goal, When the coach auto-generates a session, Then suitable drills are assembled into a training plan.

Verified manually in Sprint 3. Automated coverage planned for Sprint 4.

### US48 — Match Simulation
- Given both teams have saved lineups, When the coach runs Quick Sim, Then a full 90-minute script replays through the normal log endpoints and the result reads like a real match.
- Given a player unknown to the ratings dataset, When the simulation resolves ratings, Then a position-based estimate is used.

Automated: `backend/tests/integration/simulation.integration.test.js`, `frontend/src/lib/simulation.test.js`, `frontend/src/pages/LiveMatch.test.jsx` (Quick Sim, timed run, lineup gate).

### US49 — Squad Gender
- Given a female squad, When the coach browses open leagues, Then only same-gender (or unfiltered) events are joinable.
- Given a coach creating a squad, When they pick male or female, Then the setting drives event matchmaking filters.

Automated: `backend/tests/integration/squad.integration.test.js` (gender on squads), `backend/tests/integration/events.integration.test.js` (gender filter on join/create).

### US50 — Public Landing Page
- Given a visitor with no account, When they open the landing page, Then public squads and their live events are listed.

Automated: `frontend/src/pages/PublicLanding.test.jsx`, `backend/tests/integration/missing-features.integration.test.js`.

---

## E4 · Infrastructure & Documentation

### US-I1 — CI/CD Pipeline
- Given a team member pushes a commit to any branch, When CI runs, Then the pipeline reports a pass/fail status visible on the commit.
- Given a push introduces a failing test or lint error, When CI runs, Then the failure is visible before the change is merged to main.

Verified manually against `.gitea/workflows/ci.yml` — both frontend and backend jobs report pass/fail on every push and PR, confirmed working as of this sprint.

### US-I2 — Public Documentation Site
- Given the docs site is deployed, When a visitor opens the public URL without logging in, Then the documentation is visible and readable.
- Given a team member updates a doc page and pushes, When the deploy step runs, Then the live site reflects the update.

**Not yet built this sprint** — scaffold and deploy step still outstanding.
