---
sidebar_position: 3
---

# AI Tool Attribution

## Overview

Generative AI tools were used during the development of Kickstat to accelerate implementation, debug errors, and draft documentation. This page records which tools were used, how they contributed, and how the team validated their output.

## Tools used

| Tool | Model | Provider | Purpose |
|---|---|---|---|
| **Claude (claude.ai web interface)** | Sonnet 5 | Anthropic | Code generation, debugging, test writing, refactoring, and documentation drafts. |
| **Claude (claude.ai web interface)** | Opus 5.5 | Anthropic | Pre-submission debugging and fixes, deployment hardening, test coverage, the Brevo email migration, and documentation updates. |

## Where AI assistance was used

Examples of AI-assisted work in the codebase include:

- **Onboarding flow (US22):** guidance on the `OnboardingGuard` component, the `/api/squads/mine` `athlete_count` change, and the `Setup.jsx` form flow.
- **Event reminders:** design of the hourly reminder sweep in `app.js`, the `reminders.js` email logic, and the `reminder_sent` migration.
- **Frontend testing framework:** setup of Vitest + jsdom, the `vitest.config.js` environment mocks, and the initial `Dashboard.test.jsx`, `Roster.test.jsx`, and `Events.test.jsx` tests.
- **Sign-in and deployment fixes (Opus 5.5):** Clerk sign-in/sign-up redirects, the onboarding guard, cold-start retries for the free Render tier, and the CI deploy job (deploy only the newest commit, no force-push, fail loudly on Cloudflare errors).
- **Team comparison and reports (Opus 5.5):** the team-vs-opponents comparison, the season and match reports with CSV export, and substitution replay safety.
- **Test coverage and security fixes (Opus 5.5):** new backend and frontend tests, including a database-outage test that found raw database errors being sent to the browser (fixed).
- **Email migration to Brevo (Opus 5.5):** provider selection in `email.js`, reminders through the shared sender, and the safe user-facing error messages. See [Brevo](brevo).
- **Documentation:** drafts of this page and the third-party service pages.

## How we verified AI output

Every AI-generated suggestion was reviewed by a team member before being committed:

- Code was run through the existing test suites (`npm test` in both `frontend` and `backend`).
- Manual smoke tests were performed against the running dev server.
- Environment variables, API shapes, and SQL migrations were checked against the current schema.
- Documentation was cross-checked against the actual file paths and environment variables used in the project.

## Limits and responsibilities

- AI tools were used as an assistant, not as an author of record. Final design decisions, correctness, and academic integrity remain the responsibility of the project team.
- No AI tool was given access to production credentials, user data, or third-party API keys.
- Generated code was inspected for security issues such as unsafe SQL, exposed secrets, and missing auth checks.

## Academic honesty

This project is submitted for academic assessment. Where AI assistance was used, the team has ensured that the final submitted work reflects our own understanding and has been tested and reviewed by team members. This page is provided for transparency in line with course guidance on third-party and AI attribution.
