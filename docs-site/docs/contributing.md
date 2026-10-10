---
sidebar_position: 4
---

# Git Methodology

## Branching

Work happens on feature branches, one per piece of work (e.g.
`feature/liveEvent`, `feature/roster-management`, `feature/auth-setup`),
branched off `main`. `main` is kept deployable — feature branches merge into
it via pull request, not direct push.

## Pull requests

- Open a PR from your feature branch targeting `main` once the branch is in
  a working, tested state.
- CI (see [CI/CD](#cicd) below) runs automatically on every push to any
  branch and on every PR targeting `main` — lint and tests should be green
  before merging.
- Keep feature branches reasonably current with `main` (merge or rebase
  periodically) to reduce the size and difficulty of the final merge
  conflict, especially on shared files like migrations, `app.js`, or shared
  middleware.

## Migrations and branch merges

Because multiple people may add database migrations on different branches
at once, migration timestamps can end up out of chronological order once
branches are merged (a later-dated migration merged in after an
earlier-dated one has already run elsewhere). `node-pg-migrate`'s default
ordering check will refuse to run in that case — use
`--no-check-order` deliberately when you've confirmed the migrations
involved are genuinely independent of each other (don't depend on tables
the other creates). Prefer renaming a migration's timestamp to sort
correctly, where practical, over reaching for the override.

## CI/CD

Gitea Actions runs two jobs on every push and PR:

- **Frontend**: install, lint, build.
- **Backend**: install, lint, then run the integration test suite against a
  fresh, ephemeral PostgreSQL service container (migrations are applied to
  it before tests run, so each CI run starts from a clean, known schema).

See `.gitea/workflows/ci.yml` in the repo for the exact steps.

## Commit messages

Favor commit messages that describe *why*, not just *what*, especially for
non-obvious fixes (e.g. a merge conflict resolution that restores something,
or a config change that works around a specific tool's behaviour) — future
you (or a teammate, or a marker reading the history) benefits far more from
"why" than from a restatement of the diff.
