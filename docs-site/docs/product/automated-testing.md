---
sidebar_position: 5
---

# Automated Testing

Kickstat uses automated tests on both sides of the stack: backend integration
tests verify the API, database behaviour, permissions, and key user journeys,
while frontend component tests verify rendering, routing guards, and the API
helper. This page explains the testing strategy, how to run each suite, and how
to use the CI coverage evidence during each sprint.
## Testing strategy

The backend suite uses:

| Tool | Purpose |
|---|---|
| [Vitest](https://vitest.dev/) | Runs the test suite and produces coverage reports. |
| [Supertest](https://github.com/forwardemail/supertest) | Sends HTTP requests to the Express application without starting a public server. |
| PostgreSQL | Provides a real database for integration tests, so migrations, constraints, SQL queries, and cascades are exercised. |
The frontend suite uses:

| Tool | Purpose |
|---|---|
| [Vitest](https://vitest.dev/) | Same runner and coverage tooling as the backend, configured for the browser environment. |
| [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/) | Renders components and queries them the way a user would (by visible text and roles). |
| [jsdom](https://github.com/jsdom/jsdom) | Provides a lightweight DOM implementation so component tests run without a real browser. |

Tests are deliberately run against a separate PostgreSQL database. The suite
resets its tables before each test, so it must **never** point at the normal
local development database.

## What is covered

The integration suite covers the main backend workflows, including:

- account creation, roles, invite acceptance, and account deletion;
- squad ownership, squad gender, public visibility, and assistant permission boundaries;
- roster creation, editing, removal, athlete statistics, and coach stat overrides (US42);
- event creation, editing, cancellation, live logging, result calculation,
  and undo behaviour;
- event start guards: past-date rejection, lineup-gated starts, and the
  auto-transition sweep (US6, US13);
- league fixtures, standings, and top-scorer aggregation;
- starting-XI and bench management for events and fixtures;
- RSVP availability and the start-live availability gate (US41);
- pre-creation and post-creation clash detection (US43);
- public squad pages, private links, and CSV export (US28/US50);
- offline-queue replay idempotency via `client_id` (US45);
- injury logging, return-to-play estimates, coach overrides, and roster flags (US29–US31);
- cancelled event and fixture logging being rejected (US6);
- ratings-driven match simulation: dataset lookup, caching, positional estimates,
  and the script both simulation endpoints return (US48);
- event reminder email scheduling (US29); and
- venue weather lookup behaviour.

The user-story-to-test mapping is maintained in the
[Acceptance Tests](./acceptance-tests.md) page.

## Test location

Backend integration tests are stored in:

```text
backend/tests/integration/
```

| File | Main coverage area |
|---|---|
| `account.integration.test.js` | Account profile and deletion |
| `athletes.integration.test.js` | Athlete summary statistics and stat overrides (US42) |
| `auth-and-roles.integration.test.js` | Authentication-related roles, invites, and access control |
| `event-start-guards.integration.test.js` | Past-date rejection, lineup-gated starts, anchored `started_at` |
| `events.integration.test.js` | Live event logging, league events, gender filter |
| `fixtures.integration.test.js` | Fixture detail, live logging, simulation, and permissions |
| `injuries.integration.test.js` | Injury logging, estimates, overrides, and roster flags (US29–US31) |
| `invites.integration.test.js` | Assistant and athlete invitations |
| `lineups.integration.test.js` | Starting XI and bench management for events and fixtures |
| `match-availability.integration.test.js` | RSVPs, the start-live availability gate (US41), clash detection (US43) |
| `missing-features.integration.test.js` | Public pages (US28/US50), offline replay idempotency (US45) |
| `reminders.integration.test.js` | Event reminder email scheduling |
| `roster-and-events-basic.integration.test.js` | Roster and basic event management |
| `simulation.integration.test.js` | Player ratings lookup and the match simulation endpoints (US48) |
| `squad.integration.test.js` | Squad creation, gender, public visibility |
| `weather.integration.test.js` | Weather integration |

Plus `backend/tests/migrations.test.js`, which verifies migration integrity. The
Pro Fixtures (football-data.org) integration and its test suite were removed in
Sprint 3 — see [Feature Rationale](./feature-rationale.md).

## Run tests locally

### 1. Create a dedicated test database

Create a separate database once. Replace the connection details if your local
PostgreSQL installation requires a password:

```bash
createdb sportcoach_test
DATABASE_URL=postgresql://<user>:<password>@localhost:5432/sportcoach_test \
  npx node-pg-migrate up --no-check-order
```

### 2. Run the suite

From the backend directory:

```bash
cd backend
npm test
```

For a coverage report:

```bash
npm run test:coverage
```

If your PostgreSQL user or password differs from the local default, provide a
test-only connection explicitly:

```bash
TEST_DATABASE_URL=postgresql://<user>:<password>@localhost:5432/sportcoach_test \
  npm run test:coverage
```

:::warning
The test suite truncates all tables in `sportcoach_test` between tests. Confirm
that `TEST_DATABASE_URL` targets the test database, not the development or
production database, before running it.
:::

## Frontend testing

Frontend component tests live next to the components they test:

```text
frontend/src/**/*.test.jsx and frontend/src/**/*.test.js
```

19 test files cover the pages (Dashboard, Roster, Events, EventDetail, LiveMatch,
AthleteStats, AccountSettings, InviteAccept, PublicLanding, PublicSquad,
Welcome), the shared components (Layout, ProtectedRoute, ConfirmProvider, Pitch,
VenueMapEditor), and the lib modules (`api`, `lineups`, `simulation`). The
suite runs with a raised `testTimeout` in `vitest.config.js` because jsdom
rendering of the data-heavy pages exceeds the 5 s default on slower machines.

The simulation feature is covered on the frontend too:
`frontend/src/lib/simulation.test.js` covers mapping the script onto log bodies
and the two-minute pacing of a timed replay, and the `LiveMatch simulation`
tests in `frontend/src/pages/LiveMatch.test.jsx` cover Quick Sim, stopping a
timed run part way through, and the gate that offers the buttons only once a
starting XI is set.

## View coverage locally

`npm run test:coverage` writes an HTML report to:

```text
backend/coverage/index.html
```

Open this file in a browser to inspect coverage by folder and source file. The
report also prints a summary in the terminal.

The current baseline is **145 backend integration tests** (statement coverage
above 75%) plus **123 frontend component tests** (about 63% line coverage on
the 2026-09-28 local run). Both suites run on every push — the live numbers
are on the coverage dashboard linked below.

## Live coverage dashboard

The latest backend coverage report is published automatically after every
successful CI test run:

[Open the Kickstat coverage dashboard](https://kickstat-coverage.netlify.app)

The dashboard shows the current overall percentage and file-by-file coverage.
It is updated after a push only when the backend tests and coverage generation
succeed.

## Continuous integration evidence

Every push and pull request triggers the workflow in
[`.gitea/workflows/ci.yml`](https://sdp.ms.wits.ac.za/bug-off/sport-coaching-tool/src/branch/main/.gitea/workflows/ci.yml).

The backend CI job:

1. installs dependencies and runs ESLint;
2. starts a disposable PostgreSQL container;
3. applies migrations to the fresh test database;
4. runs `npm run test:coverage`; and
5. uploads `backend/coverage` as the **`backend-coverage`** artifact.

The frontend CI job mirrors it: ESLint, production build,
`npm run test:coverage`, and a Codecov upload for the frontend coverage
report, so both suites must stay green for a pull request to pass.
To review a CI coverage report:

1. Open the relevant Gitea Actions run.
2. Select the completed backend job.
3. Download the **`backend-coverage`** artifact.
4. Extract it and open `index.html` in a browser.

Each artifact is a snapshot of the coverage from that specific CI run. A new
artifact is created whenever CI runs after a push.

## Sprint evidence checklist

For each sprint review, retain the following evidence:

- a link or screenshot of a green Gitea Actions run;
- the coverage summary or downloaded HTML coverage report;
- the tests added or updated for the sprint's user stories;
- the relevant [acceptance-test mapping](./acceptance-tests.md); and
- a short note in the sprint report describing defects found and fixes made.

This evidence demonstrates the automated testing, CI/CD, and testing
documentation required by the project rubric.

## Troubleshooting

| Problem | Resolution |
|---|---|
| `permission denied for table ...` | Run the suite with a `TEST_DATABASE_URL` for a database owned by your local PostgreSQL user, then rerun the migrations for that database. |
| `database does not exist` | Create `sportcoach_test`, then apply the migrations using its connection URL. |
| Tests affect local application data | Stop immediately and check the connection URL. The test database must be separate from the application database. |
| Coverage folder is missing | Run `npm run test:coverage`, not only `npm test`. |
| A CI test fails | Open the failing Gitea Action step, use its error log to reproduce locally, add or correct a test, then push the fix. |
