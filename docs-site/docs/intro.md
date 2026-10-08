---
sidebar_position: 1
slug: /
---

# Overview

The **Sport Coaching Tool** is a web platform that helps a coach manage a
sports squad end-to-end: keeping an up-to-date roster, scheduling events
(matches and training sessions), and — its core feature — logging what
happens during an event *as it happens*, rather than re-entering results
after the fact.

## The problem

Coaches (and the assistants helping them) currently rely on a mix of
notebooks, spreadsheets, and messaging apps to track their squad. There's no
single place to see an athlete's history, no live view of what's happening
during a match, and no easy way to bring on an assistant to help without
handing them full control of the roster.

## What the tool does

- **Roster management** — add, edit, and remove athletes, with details like
  position, squad number, and contact info kept in one place.
- **Event scheduling** — create matches and training sessions with a date,
  time, and location; edit or cancel as plans change.
- **Live event logging** — during an event, log scoring moments, penalties,
  and other notable actions against the athlete responsible, in real time.
  Entries can be edited or undone (soft-deleted) if a mistake is made.
- **Match simulation** — Quick Sim and Simulate Match generate a full 90-minute
  match from the squad's saved lineup, weighted by each player's rating
  (external ratings dataset, or a position-based estimate for players it does
  not know), and replay it through the same logging path as a hand-logged
  match.
- **Derived statistics** — per-athlete and per-event stats (goals, cards,
  appearances, and more) are calculated from the logged entries themselves,
  not entered manually.
- **Assistants & invites** — a coach can invite an assistant to help track an
  event without giving them full roster control.

## Project scope

Following the course brief, features are organised into three tiers:

| Tier | Standard |
|---|---|
| **Basic** | Roster and event management, live logging of scoring moments and penalties, derived per-athlete/per-event statistics, a dashboard. |
| **Intermediate** | Multi-user accounts with roles/permissions, fixtures with other users, season-level statistics and comparisons, external service integration (e.g. weather, maps), offline-first logging. |
| **Advanced** | Conflict-free collaborative offline logging across multiple assistants' devices, league/standings views, automatic summarisation and selection suggestions, public squad pages, season scheduling. |

This documentation site tracks the project as it's built — see
[Getting Started](./getting-started/backend.md) to run it locally, or
[Architecture](./architecture/tech-stack.md) for how it's put together.
