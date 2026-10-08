---
sidebar_position: 1
---

# Tech Stack

## Frontend

| Technology | Why |
|---|---|
| **React** | Component-based UI fits the app's structure well — a dashboard, roster, event, and live-match view all share layout and data-fetching patterns that compose naturally as components/hooks. |
| **Vite** | Fast dev-server startup and hot module reloading kept iteration quick; standard, well-documented pairing with React. |
| **Clerk (`@clerk/clerk-react`)** | The course requires established auth libraries rather than a hand-rolled auth system. Clerk handles sign-up/sign-in/password reset/account deletion out of the box, and its React SDK integrates directly with the same Clerk project used server-side, avoiding a second auth system to keep in sync. |
| **React Router** | Client-side routing between the dashboard, roster, events, live-match, and account pages without full page reloads. |

## Backend

| Technology | Why |
|---|---|
| **Node.js + Express** | A lightweight, unopinionated framework that lets us hand-write every API route ourselves (a course requirement) rather than relying on a code-generation layer. |
| **PostgreSQL** | A relational model fits the domain well — squads own athletes and events, events own log entries, and referential integrity (foreign keys, cascades) matters for keeping stats and history consistent as records are edited or removed. |
| **`node-pg-migrate`** | Version-controlled, incremental schema migrations, so the database schema evolves alongside the code in reviewable, revertible steps instead of manual `ALTER TABLE` commands. |
| **`@clerk/express`** | Server-side counterpart to the frontend's Clerk SDK — verifies auth tokens on incoming requests and handles the `user.created`/`user.deleted` webhooks that keep our own `users` table in sync with Clerk's. |
| **`pg`** | Direct, explicit SQL via the official `node-postgres` driver — chosen over an ORM so that queries (and their performance/behaviour) stay visible and easy to reason about, rather than hidden behind generated SQL. |

## Testing & Quality

| Technology | Why |
|---|---|
| **Vitest** | Fast, Vite-native test runner; used for backend integration tests that run against a **real** PostgreSQL database rather than mocks, specifically to catch schema-level bugs (missing columns, broken constraints, bad SQL) that mocked unit tests can't. |
| **Supertest** | Drives the Express app's HTTP routes directly in tests, exercising the full request/response cycle rather than testing route handlers in isolation. |
| **ESLint** (frontend & backend) | Static analysis for both codebases, with project-specific rule overrides documented inline in each `eslint.config.js` where a rule doesn't fit the project's patterns. |

## Infrastructure

| Technology | Why |
|---|---|
| **Gitea Actions (CI)** | Runs on every push/PR: lint and build the frontend, lint and run the full integration suite for the backend against an ephemeral PostgreSQL service container (with migrations applied fresh each run), catching regressions before merge. |
| **Docusaurus** | This documentation site — chosen because it's JS/npm-based like the rest of the stack, so there's no separate toolchain to maintain alongside the app itself. |

## External integration

| Service | Why |
|---|---|
| **[football-data.org](../third-party/football-data)** | Professional fixtures and standings for the Pro Fixtures tab. |
| **Open-Meteo** | Free geocoding and weather forecasts for event venues (no API key required). Implemented in `backend/src/routes/weather.js` and consumed by `WeatherWidget.jsx`. |
| **[EA FC player ratings dataset](../third-party/player-ratings)** | Free, key-less lookup (Hugging Face datasets-server) of an EA FC-style overall rating per player, used to weight the 90-minute match simulation for **Quick Sim** and **Simulate Match**. Implemented in `backend/src/lib/ratings.js`; players the dataset does not know get a position-based estimate instead. |
| **[Resend](../third-party/resend)** | Transactional email delivery for assistant invites and event reminders. Configured via `RESEND_API_KEY` and `EMAIL_FROM`; if absent, emails are skipped gracefully. Free accounts can only send to your own email address unless a domain is verified. |
