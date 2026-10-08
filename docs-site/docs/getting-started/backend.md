---
sidebar_position: 1
---

# Backend Setup

The backend is a Node/Express API backed by PostgreSQL, with authentication
handled by [Clerk](https://clerk.com).

## Prerequisites

- Node.js (see `package.json` engines / CI workflow for the exact version —
  the CI pipeline currently runs **Node 22**)
- A running PostgreSQL instance (locally installed, or via Docker)
- A Clerk application (for auth keys — see below)

## Install dependencies

```bash
cd backend
npm install
```

## Environment variables

Create a `.env` file in `backend/` (never commit this file). At minimum:

```bash
DATABASE_URL=postgresql://<user>:<password>@localhost:5432/<your_dev_db>
CLERK_WEBHOOK_SECRET=<from your Clerk dashboard — Webhooks section>
FRONTEND_URL=http://localhost:5173
```

:::note
The backend also relies on Clerk's server-side SDK (`@clerk/express`), which
typically expects `CLERK_SECRET_KEY` (and, depending on setup,
`CLERK_PUBLISHABLE_KEY`) as environment variables. Confirm the exact variable
names your Clerk dashboard gives you and add them here — this doc will be
updated with the confirmed list once verified against a working `.env.example`.
:::

**Do not point `DATABASE_URL` at the same database used for automated
tests.** The integration test suite truncates its tables between every test
run — see [Running Tests](#running-tests) below.

### Optional: match simulation player ratings

The match simulator reads EA FC-style player ratings from a public Hugging Face
dataset — **no API key required**. All four variables are optional; the defaults
are compiled into `backend/src/lib/ratings.js`, and a missing or unreachable
dataset only means players the dataset does not know about fall back to a
position-based estimate (70–85 overall):

```bash
PLAYER_RATINGS_API_BASE=https://datasets-server.huggingface.co
PLAYER_RATINGS_DATASET=jason1966/aayushmishra1512_fifa-2021-complete-player-data
PLAYER_RATINGS_DATASET_CONFIG=default
PLAYER_RATINGS_DATASET_SPLIT=train
```

See [EA FC Player Ratings Dataset](../third-party/player-ratings.md) for the
lookup, caching and fallback rules.

## Set up the database

Create your development database (name of your choice), then run migrations
against it:

```bash
npm run migrate up
```

This uses [`node-pg-migrate`](https://salsita.github.io/node-pg-migrate/) and
reads `DATABASE_URL` from your environment/`.env`.

## Run the dev server

```bash
npm run dev
```

This runs `nodemon src/app.js`, restarting automatically on file changes.
The API listens on the port set by `PORT` in your environment, or `5000` by
default.

A background sweep runs every 60 seconds to auto-transition scheduled events
to `live` (once their start time passes) and `live` events to `completed`
(once their scheduled duration elapses) — this happens automatically once
the server is running, no separate process needed.

## Running tests

The integration test suite runs against a **real** PostgreSQL database (not
mocks) to catch schema-level issues that mocked tests would miss. It needs
its own, separate database:

```bash
# create a dedicated test database first, then run its migrations:
DATABASE_URL=postgresql://<user>:<password>@localhost:5432/<your_test_db> \
  npx node-pg-migrate up --no-check-order

# then run the suite (reads TEST_DATABASE_URL, or falls back to DATABASE_URL):
npm test
```

`npm test` runs Vitest against `tests/integration`. `npm run test:coverage`
runs the same suite with a coverage report. See `tests/integration/setup.js`
for exactly how the test database connection is resolved.

## Linting

```bash
npm run lint
```
