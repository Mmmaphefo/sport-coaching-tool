# Sprint 3 Retrospective

**Project:** KickStat - Sport Coaching Tool
**Sprint Period:** September 15 - September 29, 2026
**Team Members:** Kgethie, Kgotlelelo, Lindokuhle, Mmaphefo, Tasmiya
**Facilitator:** rotating (team self-facilitates)

> Drafted from the Sprint 3 meeting minutes and report ahead of the retrospective
> session on 29 September 2026 — the team reviews and amends it live in that
> meeting before it is considered final.

---

## What went well

- **Bug-fix throughput.** All 10 demo bugs were triaged in the first planning
  meeting and 9 were resolved within two days, each with a regression test.
- **UI redesign landed whole.** The design-system overhaul (navy/blue/volt-lime,
  Barlow Condensed, dark theme) shipped in 9 grouped commits and was validated
  positively in internal testing.
- **Feedback-driven feature.** The gender matchmaking feature went from
  stakeholder comment to implemented (with a database CHECK constraint and join
  filters) within one sprint.
- **Testing stayed green while scope grew.** 268 automated tests (145 backend +
  123 frontend) run on every push with coverage for both codebases; the
  coverage dashboard publishes the results.
- **Advanced features completed.** Tactics board, sessions/drill library,
  match simulation, venue map, offline logging, stat overrides, and public
  pages all reached Done with tests where automated coverage was practical.

## What didn't go so well

- **Email delivery still not working in production.** Invite emails were moved
  to Gmail mid-sprint but the Render environment variables were not configured
  in time, so the feature is code-complete but unverified end-to-end.
- **Documentation lagged the code.** Backlog, user stories, acceptance criteria,
  data model, and the OpenAPI spec were only brought up to date at sprint end —
  several docs contradicted the running app during the sprint.
- **No external user testing session.** Feedback gathered was internal plus one
  stakeholder; a structured session with outside users did not happen and is
  carried into Sprint 4.
- **Offline queue performance.** Functional but slow; optimization deferred.
- **Sprint 3 backlog drift.** Mid-sprint additions (tactics, sessions, gender,
  simulation) were never added to the backlog as stories until the retrospective,
  weakening traceability from story → code → test.

## Actions for Sprint 4

| Action | Owner | Success measure |
|--------|-------|-----------------|
| Configure `GMAIL_USER` / `GMAIL_APP_PASSWORD` on Render and verify an invite email end-to-end | Mmaphefo | Invite received in a real inbox |
| Fix dark-mode text consistency on the remaining pages | Kgotlelelo | No invisible text in dark theme walkthrough |
| Add back buttons to pages (stakeholder request) | Kgethie | Every page reachable in ≤2 clicks from anywhere |
| Run a structured user-testing session with external users and log findings | Kgotlelelo | Written findings + disposition per item |
| Add automated coverage for tactics, sessions, and compare (currently manual) | Lindokuhle | New test suites in CI |
| Keep backlog/docs in sync as stories move (not at sprint end) | All | No stale docs at Sprint 4 review |
| Optimize offline queue replay | Lindo | Replay of 50 queued entries under 5s |
| Final documentation pass (group report, user guide, API docs) + presentation prep | Tasmiya | Docs site complete; demo script rehearsed |

## Metrics

| Metric | Sprint 3 |
|--------|----------|
| Stories committed | 16 |
| Stories done | 15 (email delivery code-complete, env pending) |
| Bug fixes | 9/10 |
| Automated tests | 268 passing (145 backend + 123 frontend) |
| Coverage | Backend >75% statements; frontend ~63% lines |
| Retrospective actions carried | 8 |
