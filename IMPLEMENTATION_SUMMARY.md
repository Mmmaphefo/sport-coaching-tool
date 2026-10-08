# Missing-feature implementation — summary

This adds code for the six gaps identified against the brief, using only
your existing stack (Postgres/node-pg-migrate, Express, React/Vite) — no
new external accounts or API keys needed. Everything below was built
against your actual `sport-coaching-tool.zip` and both the backend
(`node --check`) and frontend (`npm run build`) were verified to pass.

## 1. Athlete availability / RSVPs
- `backend/migrations/1790100000000_create-event-rsvps-table.js`
- `backend/src/routes/events.js` — added `GET/PUT /:id/rsvps`,
  `PUT /:id/rsvps/mine`, `PUT /:id/rsvps/:athleteId`
- `frontend/src/components/RsvpPanel.jsx` + `.css` — wired into
  `EventDetail.jsx` (match/training events)

## 2. Manual override of a derived stat
- `backend/migrations/1790100000001_create-athlete-stat-overrides-table.js`
- `backend/src/routes/athletes.js` — `GET /:id/stats` now merges any
  override into the returned totals; added
  `PATCH/DELETE /:id/stats/override`
- `frontend/src/components/StatOverrideControl.jsx` + `.css` — wired into
  `AthleteStats.jsx` (coach-only, season view)

## 3. Event/fixture clash detection
- `backend/src/routes/events.js` — `findClashes()` helper, called on
  create/update and exposed via `GET /:id/clashes`. Advisory only — it
  never blocks scheduling, just flags overlaps
- `frontend/src/components/ClashBanner.jsx` + `.css` — wired into
  `EventDetail.jsx` for both regular events and league fixtures

## 4. Public/shareable squad page + CSV export
- `backend/migrations/1790100000002_add-public-token-to-squads.js`
- `backend/src/routes/squads.js` — `POST/DELETE /mine/public-link`
- `backend/src/routes/public.js` (new) — unauthenticated
  `GET /api/public/squads/:token` and `.../export.csv`
- `backend/src/app.js` — registers the public router
- `frontend/src/pages/PublicSquad.jsx` + `.css` — new route `/public/:token`
- `frontend/src/pages/AccountSettings.jsx` — "Get shareable link" panel

## 5. Venue map
- `frontend/src/components/WeatherWidget.jsx` — added a free OpenStreetMap
  embed (no API key), reusing the lat/lon your `/api/weather` call already
  returns, so it adds no new network request

## 6. Offline-first logging
- `frontend/src/lib/offlineQueue.js` (new) — localStorage-backed queue
  with ordered replay on reconnect
- `frontend/src/pages/LiveMatch.jsx` — `postLog`/`handleUndo`/
  `handleEditSubmit` fall back to the queue when the server can't be
  reached, plus an offline/sync status banner

## To apply
1. Copy these files into your repo (they were edited/added directly on
   top of your uploaded zip, so paths match exactly).
2. Run your migrations (`npm run migrate up` or however you invoke
   node-pg-migrate in `backend/`) to create the three new tables/columns.
3. `npm install` in `frontend/` if you don't already have `node_modules`.

## Known limitations, honestly
- **Offline logging** queues and replays actions but does **not**
  optimistically insert them into the on-screen timeline/ratings while
  offline (too risky to splice into `LiveMatch.jsx`'s simulation/rating
  logic blind) — the coach sees a "queued, will sync" banner instead.
  It also has no idempotency key, so a request that actually succeeded
  server-side but whose response got lost on a flaky connection could
  replay as a duplicate on reconnect. This isn't the *collaborative*
  multi-device merge the Advanced tier asks for — that's a materially
  bigger feature (conflict-free merge across simultaneous offline
  devices) that would need its own design pass.
- **Clash detection** is advisory (a banner), not a hard block — matches
  the brief's wording ("flagging clashes") but worth confirming that's
  what you want.
- **Stat override** only covers the season-total view; a 7/30-day window
  is a different number than the override was set against, so it's not
  applied there.
- Fixtures are still only generated *within* one of your own tournament
  events — arranging a fixture with another coach's squad on the
  platform is still not implemented (not attempted here, since it's a
  bigger cross-squad workflow, not a small patch).
