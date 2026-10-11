---
sidebar_position: 7
---

# Match-day Rules

The rules KickStat enforces around a match, and where each one lives in the
code. They are checked on the **server**, so they hold no matter which page,
device or offline replay a request comes from; the pages only display them.

## Availability (RSVPs)

Coaches, assistants and players record whether each player is **available**,
**maybe** or **unavailable** for an event.

- **Mark everyone available.** A coach or assistant can mark the whole squad
  available in one step (`PUT /api/events/:id/rsvps`) instead of player by player.
- **Injured players are never available.** A player injured on the match date
  (injury not cleared, already sustained, and not yet past the expected return
  date) is set to **unavailable** by "Mark everyone available" (noted as
  *Injured*), cannot be marked available individually, and never counts
  towards kick-off, even if they answered "available" before getting injured.
- **Live updates.** The availability panel refreshes itself every 15 seconds,
  so other people's answers appear without reloading the page.

Code: `backend/src/lib/availability.js` (shared injury definition),
`backend/src/routes/events.js` (RSVP routes),
`frontend/src/components/RsvpPanel.jsx`.

## Minimum players to start a match

A match or league fixture can only start once **at least 7 players are
available**. The rule is the same for every squad, whatever its roster size,
so a squad with fewer than 7 players cannot start a match.

Every path that turns a match live uses this one check: the **Start live**
buttons (matches and fixtures), the automatic start when the starting XI is
saved after kick-off, and the background sweep that starts matches at their
scheduled time. If the squad is short, the request is refused with the count,
for example *"only 6 of the 7 players needed are marked available"*. On a
league page the reason is shown **directly under that fixture**.

Code: `MIN_AVAILABLE_PLAYERS` in `backend/src/lib/availability.js`.

:::note Planned: forfeits
A future extension is to record a match where a side has fewer than 7
available players at kick-off as a **3–0 forfeit** (and 3 points to the other
side in a league). It was deliberately left out of the final release because
it changes how results are calculated across standings, reports, the
dashboard and public pages; the 7-player check above is the foundation it
would build on.
:::

## Cards

Following the laws of football, in one match a player can receive at most
**one red card** and **two yellow cards** (a second yellow sends the player
off, and a sent-off player cannot take any further part).

- **Live logging** refuses a second red card or a third yellow card for the
  same player in the same match.
- **Editing a log entry** follows the same rule: an edit cannot turn an entry
  into a card, or move a card onto another player, if that would break the limit.
- **Stat corrections** (a coach overriding a player's season totals) must keep
  the totals realistic:
  - red cards **≤ appearances**
  - yellow cards **≤ 2 × appearances**

  For example, a player with 1 appearance can be corrected to at most 1 red
  card and 2 yellow cards. Lowering appearances below the cards already
  recorded is refused for the same reason.

Code: `backend/src/lib/cardRules.js`, used by `routes/events.js`,
`routes/fixtures.js`, `lib/logEdit.js` and `routes/athletes.js`.

## Friendlies against registered squads

A coach proposes a friendly against another **registered** KickStat squad
from **Events → Schedule event**: keep the format as **Match**, set the
**Type** to **Friendly proposal**, and pick the opponent from the list of
registered squads (your own squad is never listed). An optional message can
be sent to the other coach.

The proposal goes to the other squad (`POST /api/friendlies`). It appears on
the **Friendlies** tab for both sides, where it can be accepted, declined or
cancelled; once accepted, the match is added to both squads' calendars.
The Friendlies tab no longer has its own proposal form, so there is one place
to schedule every match.

Code: `frontend/src/pages/Events.jsx`, `frontend/src/pages/Friendlies.jsx`,
`backend/src/routes/friendlies.js`.

## Live updates without refreshing

Match pages keep themselves current, so nobody has to reload during a match:

| Page | Refreshes | Also shows |
|---|---|---|
| Live match | every 3 s while live; every 10 s before kick-off, switching to live logging by itself at kick-off | match clock that ticks over exactly on the minute |
| Event page | every 5 s while live (or while any league fixture is live); every 15 s before kick-off | countdown to kick-off ("Kicks off in 1h 30m 00s") |
| Dashboard | every 10 s while any match is live; every 30 s otherwise, so a match that kicks off appears by itself | running minute on **My live** and every **Opponent live** match |
| Availability panel | every 15 s | — |

Refreshing pauses while the browser tab is hidden and catches up as soon as
it is shown again, and it stops once an event is finished.

Code: `frontend/src/lib/liveUpdates.js` (`usePolling`, `useNow`, countdown and
minute formatting), `components/KickoffCountdown.jsx`, `components/LiveMinute.jsx`.

## Errors shown where they happen

When an action is refused, the reason is shown next to the thing that was
clicked rather than at the top of the page:

- availability changes: under that player's row, or under **Mark everyone available**;
- league fixtures: **Start live** and **Save kickoff** errors under that fixture;
- the **Schedule event** form: just above its buttons;
- the **Roster** form and the **live match** page: just above the form's
  buttons, or beside the action that failed.

## Tests

Each rule above has automated tests that run in CI:

- `backend/tests/integration/card-rules.integration.test.js`
- `backend/tests/integration/rsvp-bulk.integration.test.js`
- `backend/tests/integration/match-availability.integration.test.js`
- `frontend/src/components/RsvpPanel.bulk.test.jsx`
- `frontend/src/lib/liveUpdates.test.jsx`
- `frontend/src/pages/LiveMatch.live-updates.test.jsx`,
  `EventDetail.live-updates.test.jsx`, `Dashboard.live.test.jsx`
- `frontend/src/pages/Events.friendly.test.jsx`
