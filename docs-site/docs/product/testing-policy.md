---
sidebar_position: 6
---

# Testing Policy

## When to write tests

- **Every new API endpoint** must have at least one integration test that exercises the happy path and one that exercises an error or permission-denied path.
- **Every bug fix** must include a regression test that would have caught the original bug.
- **Every frontend component** should have at least one test that verifies it renders correctly and handles its primary interaction.
- **Database migrations** are tested implicitly through the integration suite, which runs all migrations before each test run.

## Coverage targets

| Layer | Target | Current (2026-09-28) |
|-------|--------|---------|
| Backend (statement coverage) | ≥ 75% | ≥ 75% — see the [coverage dashboard](https://kickstat-coverage.netlify.app) / Codecov for the live number |
| Frontend (line coverage) | ≥ 60% | ~63% on the latest local run; both suites run in CI on every push |

Coverage is measured using Vitest's built-in coverage reporter (`@vitest/coverage-v8`).

## Test naming conventions

- **Backend tests:** Named by user story where possible, e.g. `describe('US6 - Edit or cancel an event', ...)`.
- **Frontend tests:** Named by component, e.g. `describe('Roster', ...)`, with individual tests describing behaviour, e.g. `it('deletes an athlete after confirming')`.
- **Test files:** Named `<feature>.integration.test.js` for backend and `<Component>.test.jsx` for frontend.

## Test organisation

```text
backend/tests/integration/   — Backend API tests
frontend/src/pages/          — Frontend component tests (co-located)
frontend/src/components/     — Frontend component tests (co-located)
```