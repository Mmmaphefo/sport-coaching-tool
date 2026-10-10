import { describe, test, expect, beforeAll, afterEach, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import { pool, resetDatabase } from './setup'

import accountRouter from '../../src/routes/account'
import athletesRouter from '../../src/routes/athletes'
import eventsRouter from '../../src/routes/events'
import fixturesRouter from '../../src/routes/fixtures'
import friendliesRouter from '../../src/routes/friendlies'
import injuriesRouter from '../../src/routes/injuries'
import invitesRouter from '../../src/routes/invites'
import seasonsRouter from '../../src/routes/seasons'
import sessionsRouter from '../../src/routes/sessions'
import squadsRouter from '../../src/routes/squads'
import tacticsRouter from '../../src/routes/tactics'

// T4 — role × route 403 matrix.
//
// The role model lives in routes/_squad.js and has three levels:
//   - open:    any member of the squad (reads, own RSVP)
//   - coach:   getOwnedSquadIdForCoach — head coach only
//   - staff:   getOwnedSquadIdForStaff — coach + assistant, never a player
//
// Every case below replays the same request as coach, assistant and
// athlete and pins the boundary: forbidden roles must receive an exact
// 403 (with the canonical error message), while allowed roles must not
// be blocked by the guard. "Allowed" deliberately tolerates 400/404 —
// those are business answers that the feature suites cover in detail;
// here the concern is only that a legitimate role never gets a 403 and
// never crashes (5xx).

const app = express()
app.use(express.json())
app.use('/api/account', accountRouter)
app.use('/api/athletes', athletesRouter)
app.use('/api/events', eventsRouter)
app.use('/api/fixtures', fixturesRouter)
app.use('/api/friendlies', friendliesRouter)
app.use('/api/injuries', injuriesRouter)
app.use('/api/invites', invitesRouter)
app.use('/api/seasons', seasonsRouter)
app.use('/api/sessions', sessionsRouter)
app.use('/api/squads', squadsRouter)
app.use('/api/tactics', tacticsRouter)

const COACH = 'matrix_coach'
const ASSISTANT = 'matrix_assistant'
const ATHLETE = 'matrix_athlete'
const UNLINKED_ASSISTANT = 'matrix_unlinked_assistant'
const UNLINKED_ATHLETE = 'matrix_unlinked_athlete'

const CLERK_ID = { coach: COACH, assistant: ASSISTANT, athlete: ATHLETE }
// Forbidden roles are replayed first so their guard checks always see the
// pristine seed, no matter what the allowed requests mutate afterwards.
const ROLE_ORDER = ['athlete', 'assistant', 'coach']

const COACH_ONLY_MSG = 'Only coaches can manage the roster'
const STAFF_ONLY_MSG = 'Players cannot perform this action'

let originalFetch

beforeAll(async () => {
  process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'

  try {
    await pool.query('SELECT 1')
  } catch (err) {
    throw new Error(
      'Could not reach the test database. Create it and run migrations against it first.\n' +
        `Original error: ${err.message}`,
      { cause: err }
    )
  }

  originalFetch = global.fetch
})

beforeEach(async () => {
  await resetDatabase()
  // The lineup-suggestion engine resolves unknown players against the public
  // ratings dataset (a real network call with multi-second deadlines). The
  // matrix is not about ratings: answer instantly with "unknown player" so
  // every lookup falls back to the positional estimate.
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ rows: [] }) })
})

afterEach(() => {
  global.fetch = originalFetch
})

afterAll(async () => {
  await pool.end()
})

function isoDaysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

function isoDateFromNow(days) {
  return isoDaysFromNow(days).slice(0, 10)
}

let ctx

// One complete world per case: coach + assistant + linked athlete on one
// squad, a rival squad, an event (also carrying the fixture's event_teams
// membership), a fixture, log entries, and one of every coach/staff-owned
// resource a write route can target. Destructive staff verbs get TWO
// targets (one per allowed role) so both requests can assert success
// without stomping each other.
async function seedMatrixWorld() {
  const coach = await pool.query("INSERT INTO users (clerk_id, role) VALUES ($1, 'coach') RETURNING id", [COACH])
  const squad = await pool.query('INSERT INTO squads (coach_id, name) VALUES ($1, $2) RETURNING id', [
    coach.rows[0].id,
    'Matrix Squad',
  ])

  const assistant = await pool.query(
    "INSERT INTO users (clerk_id, role, squad_id) VALUES ($1, 'assistant', $2) RETURNING id",
    [ASSISTANT, squad.rows[0].id]
  )
  const athleteUser = await pool.query(
    "INSERT INTO users (clerk_id, role, squad_id) VALUES ($1, 'athlete', $2) RETURNING id",
    [ATHLETE, squad.rows[0].id]
  )
  // Accounts that exist but were never linked to a squad — a distinct 403
  // branch in _squad.js ("This account is not yet linked to a squad").
  await pool.query("INSERT INTO users (clerk_id, role) VALUES ($1, 'assistant')", [UNLINKED_ASSISTANT])
  await pool.query("INSERT INTO users (clerk_id, role) VALUES ($1, 'athlete')", [UNLINKED_ATHLETE])

  const athlete = await pool.query(
    "INSERT INTO athletes (squad_id, name, user_id, squad_number) VALUES ($1, 'Matrix Athlete', $2, 7) RETURNING id",
    [squad.rows[0].id, athleteUser.rows[0].id]
  )
  const spareAthlete = await pool.query(
    "INSERT INTO athletes (squad_id, name, squad_number) VALUES ($1, 'Spare Athlete', 8) RETURNING id",
    [squad.rows[0].id]
  )

  const otherCoach = await pool.query("INSERT INTO users (clerk_id, role) VALUES ('matrix_other_coach', 'coach') RETURNING id")
  const otherSquad = await pool.query('INSERT INTO squads (coach_id, name) VALUES ($1, $2) RETURNING id', [
    otherCoach.rows[0].id,
    'Rival Squad',
  ])

  const event = await pool.query(
    `INSERT INTO events (squad_id, opponent, event_type, event_date, created_by)
     VALUES ($1, 'Rovers', 'match', $2, $3) RETURNING id`,
    [squad.rows[0].id, isoDaysFromNow(2), coach.rows[0].id]
  )
  // getFixtureWithAccess joins event_teams for the viewer's squad, so the
  // fixture's event must list the matrix squad as a participant.
  await pool.query(
    "INSERT INTO event_teams (event_id, squad_id, role, seed_order) VALUES ($1, $2, 'participant', 1)",
    [event.rows[0].id, squad.rows[0].id]
  )
  const fixture = await pool.query(
    `INSERT INTO fixtures (event_id, home_squad_id, away_squad_id, event_date, status)
     VALUES ($1, $2, $3, $4, 'scheduled') RETURNING id`,
    [event.rows[0].id, squad.rows[0].id, otherSquad.rows[0].id, isoDaysFromNow(2)]
  )

  const eventLogIds = []
  const fixtureLogIds = []
  for (const loggedBy of [coach.rows[0].id, assistant.rows[0].id]) {
    const eventLog = await pool.query(
      "INSERT INTO log_entries (event_id, athlete_id, action_type, logged_by) VALUES ($1, $2, 'goal', $3) RETURNING id",
      [event.rows[0].id, athlete.rows[0].id, loggedBy]
    )
    eventLogIds.push(eventLog.rows[0].id)
    const fixtureLog = await pool.query(
      "INSERT INTO log_entries (event_id, fixture_id, athlete_id, action_type, logged_by) VALUES ($1, $2, $3, 'goal', $4) RETURNING id",
      [event.rows[0].id, fixture.rows[0].id, athlete.rows[0].id, loggedBy]
    )
    fixtureLogIds.push(fixtureLog.rows[0].id)
  }

  const tactic = await pool.query("INSERT INTO tactics (squad_id, name) VALUES ($1, 'Matrix Tactic') RETURNING id", [
    squad.rows[0].id,
  ])

  const drillIds = []
  for (const name of ['Matrix Drill 1', 'Matrix Drill 2']) {
    const drill = await pool.query("INSERT INTO drills (squad_id, name, tactical_goal) VALUES ($1, $2, 'pressing') RETURNING id", [
      squad.rows[0].id,
      name,
    ])
    drillIds.push(drill.rows[0].id)
  }

  const seasonIds = []
  for (const name of ['Matrix Season 1', 'Matrix Season 2']) {
    const season = await pool.query('INSERT INTO seasons (squad_id, name, starts_on, ends_on) VALUES ($1, $2, $3, $4) RETURNING id', [
      squad.rows[0].id,
      name,
      isoDateFromNow(0),
      isoDateFromNow(90),
    ])
    seasonIds.push(season.rows[0].id)
  }

  const injury = await pool.query("INSERT INTO injuries (athlete_id, description, date_sustained, logged_by) VALUES ($1, 'Hamstring strain', $2, $3) RETURNING id", [
    athlete.rows[0].id,
    isoDateFromNow(-3),
    coach.rows[0].id,
  ])

  // One proposal aimed at us (accept/decline are the challenged side's
  // calls) and one we made (cancel is the proposing side's call).
  const friendlyIncoming = await pool.query(
    'INSERT INTO friendlies (proposing_squad_id, opposing_squad_id, event_date) VALUES ($1, $2, $3) RETURNING id',
    [otherSquad.rows[0].id, squad.rows[0].id, isoDaysFromNow(5)]
  )
  const friendlyOutgoing = await pool.query(
    'INSERT INTO friendlies (proposing_squad_id, opposing_squad_id, event_date) VALUES ($1, $2, $3) RETURNING id',
    [squad.rows[0].id, otherSquad.rows[0].id, isoDaysFromNow(5)]
  )

  return {
    coachId: coach.rows[0].id,
    assistantId: assistant.rows[0].id,
    squadId: squad.rows[0].id,
    athleteId: athlete.rows[0].id,
    spareAthleteId: spareAthlete.rows[0].id,
    otherSquadId: otherSquad.rows[0].id,
    eventId: event.rows[0].id,
    fixtureId: fixture.rows[0].id,
    eventLogIds,
    fixtureLogIds,
    tacticId: tactic.rows[0].id,
    drillIds,
    seasonIds,
    injuryId: injury.rows[0].id,
    friendlyIncomingId: friendlyIncoming.rows[0].id,
    friendlyOutgoingId: friendlyOutgoing.rows[0].id,
  }
}

// The matrix. `expect` maps each role to either 'allow' (must not be 403 or
// 5xx) or the exact status code that role must receive. `message`, when set,
// is the canonical error the forbidden roles must see. `path`/`body` may be
// functions of (ctx, role) when a case needs per-role targets.
const COACH_ALLOW = { coach: 'allow', assistant: 403, athlete: 403 }
const STAFF_ALLOW = { coach: 'allow', assistant: 'allow', athlete: 403 }

const MATRIX = [
  // ---- open reads: any squad member ----
  { name: 'GET /api/account/me', method: 'get', path: () => '/api/account/me', expect: { coach: 'allow', assistant: 'allow', athlete: 'allow' } },
  { name: 'GET /api/squads/mine', method: 'get', path: () => '/api/squads/mine', expect: { coach: 'allow', assistant: 'allow', athlete: 'allow' } },
  { name: 'GET /api/athletes', method: 'get', path: () => '/api/athletes', expect: { coach: 'allow', assistant: 'allow', athlete: 'allow' } },
  { name: 'GET /api/events', method: 'get', path: () => '/api/events', expect: { coach: 'allow', assistant: 'allow', athlete: 'allow' } },
  { name: 'GET /api/events/:id', method: 'get', path: () => `/api/events/${ctx.eventId}`, expect: { coach: 'allow', assistant: 'allow', athlete: 'allow' } },
  { name: 'GET /api/tactics', method: 'get', path: () => '/api/tactics', expect: { coach: 'allow', assistant: 'allow', athlete: 'allow' } },
  { name: 'GET /api/sessions', method: 'get', path: () => '/api/sessions', expect: { coach: 'allow', assistant: 'allow', athlete: 'allow' } },
  { name: 'GET /api/fixtures/:id', method: 'get', path: () => `/api/fixtures/${ctx.fixtureId}`, expect: { coach: 'allow', assistant: 'allow', athlete: 'allow' } },
  { name: 'GET /api/fixtures/:id/logs', method: 'get', path: () => `/api/fixtures/${ctx.fixtureId}/logs`, expect: { coach: 'allow', assistant: 'allow', athlete: 'allow' } },

  // ---- staff reads: athlete blocked ----
  { name: 'GET /api/seasons', method: 'get', path: () => '/api/seasons', expect: STAFF_ALLOW, message: STAFF_ONLY_MSG },
  { name: 'GET /api/friendlies', method: 'get', path: () => '/api/friendlies', expect: STAFF_ALLOW, message: STAFF_ONLY_MSG },
  {
    name: 'GET /api/events/:id/lineup/suggestions',
    method: 'get',
    path: () => `/api/events/${ctx.eventId}/lineup/suggestions`,
    expect: STAFF_ALLOW,
    message: STAFF_ONLY_MSG,
  },
  {
    name: 'GET /api/fixtures/:id/lineup/suggestions',
    method: 'get',
    path: () => `/api/fixtures/${ctx.fixtureId}/lineup/suggestions`,
    expect: STAFF_ALLOW,
    message: STAFF_ONLY_MSG,
  },

  // ---- coach-only writes ----
  {
    name: 'POST /api/events',
    method: 'post',
    path: () => '/api/events',
    body: () => ({ title: 'Matrix Training', event_date: isoDaysFromNow(1), format: 'training' }),
    expect: COACH_ALLOW,
    message: COACH_ONLY_MSG,
  },
  {
    name: 'PATCH /api/events/:id',
    method: 'patch',
    path: () => `/api/events/${ctx.eventId}`,
    body: () => ({ title: 'Matrix Event Updated' }),
    expect: COACH_ALLOW,
    message: COACH_ONLY_MSG,
  },
  {
    name: 'PATCH /api/events/:id/cancel',
    method: 'patch',
    path: () => `/api/events/${ctx.eventId}/cancel`,
    expect: COACH_ALLOW,
    message: COACH_ONLY_MSG,
  },
  {
    name: 'DELETE /api/events/:id',
    method: 'delete',
    path: () => `/api/events/${ctx.eventId}`,
    expect: COACH_ALLOW,
    message: COACH_ONLY_MSG,
  },
  {
    name: 'POST /api/events/:id/join',
    method: 'post',
    path: () => `/api/events/${ctx.eventId}/join`,
    expect: COACH_ALLOW,
    message: COACH_ONLY_MSG,
  },
  {
    name: 'PUT /api/events/:id/lineup',
    method: 'put',
    path: () => `/api/events/${ctx.eventId}/lineup`,
    body: () => ({ lineups: [] }),
    expect: COACH_ALLOW,
    message: COACH_ONLY_MSG,
  },
  {
    name: 'PATCH /api/squads/mine',
    method: 'patch',
    path: () => '/api/squads/mine',
    body: () => ({ name: 'Matrix Squad' }),
    expect: COACH_ALLOW,
    message: COACH_ONLY_MSG,
  },
  {
    name: 'POST /api/tactics',
    method: 'post',
    path: () => '/api/tactics',
    body: () => ({ name: 'Fresh Tactic' }),
    expect: COACH_ALLOW,
    message: COACH_ONLY_MSG,
  },
  {
    name: 'PATCH /api/tactics/:id',
    method: 'patch',
    path: () => `/api/tactics/${ctx.tacticId}`,
    body: () => ({ name: 'Renamed Tactic' }),
    expect: COACH_ALLOW,
    message: COACH_ONLY_MSG,
  },
  {
    name: 'DELETE /api/tactics/:id',
    method: 'delete',
    path: () => `/api/tactics/${ctx.tacticId}`,
    expect: COACH_ALLOW,
    message: COACH_ONLY_MSG,
  },
  {
    name: 'POST /api/athletes',
    method: 'post',
    path: () => '/api/athletes',
    body: () => ({ name: 'Fresh Athlete', squad_number: 12 }),
    expect: COACH_ALLOW,
    message: COACH_ONLY_MSG,
  },
  {
    name: 'POST /api/athletes/:id/invite',
    method: 'post',
    path: () => `/api/athletes/${ctx.spareAthleteId}/invite`,
    body: () => ({ email: 'freshplayer@example.com' }),
    expect: COACH_ALLOW,
    message: COACH_ONLY_MSG,
  },
  {
    name: 'PATCH /api/athletes/:id',
    method: 'patch',
    path: () => `/api/athletes/${ctx.athleteId}`,
    body: () => ({ name: 'Renamed Athlete' }),
    expect: COACH_ALLOW,
    message: COACH_ONLY_MSG,
  },
  {
    name: 'DELETE /api/athletes/:id',
    method: 'delete',
    path: () => `/api/athletes/${ctx.spareAthleteId}`,
    expect: COACH_ALLOW,
    message: COACH_ONLY_MSG,
  },
  {
    name: 'PATCH /api/athletes/:id/stats/override',
    method: 'patch',
    path: () => `/api/athletes/${ctx.athleteId}/stats/override`,
    body: () => ({ stat_key: 'goals', value: 3 }),
    expect: COACH_ALLOW,
    message: COACH_ONLY_MSG,
  },
  {
    name: 'DELETE /api/athletes/:id/stats/override/:statKey',
    method: 'delete',
    path: () => `/api/athletes/${ctx.athleteId}/stats/override/goals`,
    expect: COACH_ALLOW,
    message: COACH_ONLY_MSG,
  },
  {
    name: 'PATCH /api/injuries/:id',
    method: 'patch',
    path: () => `/api/injuries/${ctx.injuryId}`,
    body: () => ({ severity: 'severe' }),
    expect: COACH_ALLOW,
    message: COACH_ONLY_MSG,
  },
  {
    name: 'DELETE /api/injuries/:id',
    method: 'delete',
    path: () => `/api/injuries/${ctx.injuryId}`,
    expect: COACH_ALLOW,
    message: COACH_ONLY_MSG,
  },
  {
    name: 'POST /api/invites',
    method: 'post',
    path: () => '/api/invites',
    body: () => ({ email: 'assistant2@example.com' }),
    expect: COACH_ALLOW,
    message: 'Only coaches can invite assistants',
  },

  // ---- staff writes: athlete blocked, assistant allowed ----
  {
    name: 'POST /api/events/:id/logs',
    method: 'post',
    path: () => `/api/events/${ctx.eventId}/logs`,
    body: () => ({ athlete_id: ctx.athleteId, action_type: 'goal', minute: 10 }),
    expect: STAFF_ALLOW,
    message: STAFF_ONLY_MSG,
  },
  {
    name: 'PATCH /api/events/:id/logs/:logId',
    method: 'patch',
    path: (_ctx, role) => `/api/events/${ctx.eventId}/logs/${ctx.eventLogIds[role === 'assistant' ? 1 : 0]}`,
    body: () => ({ minute: 30 }),
    expect: STAFF_ALLOW,
    message: STAFF_ONLY_MSG,
  },
  {
    name: 'DELETE /api/events/:id/logs/:logId',
    method: 'delete',
    path: (_ctx, role) => `/api/events/${ctx.eventId}/logs/${ctx.eventLogIds[role === 'assistant' ? 1 : 0]}`,
    expect: STAFF_ALLOW,
    message: STAFF_ONLY_MSG,
  },
  {
    name: 'POST /api/events/:id/simulate',
    method: 'post',
    path: () => `/api/events/${ctx.eventId}/simulate`,
    expect: STAFF_ALLOW,
    message: STAFF_ONLY_MSG,
  },
  {
    name: 'PUT /api/events/:id/rsvps/:athleteId',
    method: 'put',
    path: () => `/api/events/${ctx.eventId}/rsvps/${ctx.athleteId}`,
    body: () => ({ status: 'available' }),
    expect: STAFF_ALLOW,
    message: STAFF_ONLY_MSG,
  },
  {
    name: 'PATCH /api/fixtures/:id',
    method: 'patch',
    path: () => `/api/fixtures/${ctx.fixtureId}`,
    body: () => ({}),
    expect: STAFF_ALLOW,
    message: STAFF_ONLY_MSG,
  },
  {
    name: 'PUT /api/fixtures/:id/lineup',
    method: 'put',
    path: () => `/api/fixtures/${ctx.fixtureId}/lineup`,
    body: () => ({ lineups: [] }),
    expect: STAFF_ALLOW,
    message: STAFF_ONLY_MSG,
  },
  {
    name: 'POST /api/fixtures/:id/simulate',
    method: 'post',
    path: () => `/api/fixtures/${ctx.fixtureId}/simulate`,
    expect: STAFF_ALLOW,
    message: STAFF_ONLY_MSG,
  },
  {
    name: 'POST /api/fixtures/:id/logs',
    method: 'post',
    path: () => `/api/fixtures/${ctx.fixtureId}/logs`,
    body: () => ({ athlete_id: ctx.athleteId, action_type: 'goal', minute: 10 }),
    expect: STAFF_ALLOW,
    message: STAFF_ONLY_MSG,
  },
  {
    name: 'PATCH /api/fixtures/:id/logs/:logId',
    method: 'patch',
    path: (_ctx, role) => `/api/fixtures/${ctx.fixtureId}/logs/${ctx.fixtureLogIds[role === 'assistant' ? 1 : 0]}`,
    body: () => ({ minute: 30 }),
    expect: STAFF_ALLOW,
    message: STAFF_ONLY_MSG,
  },
  {
    name: 'DELETE /api/fixtures/:id/logs/:logId',
    method: 'delete',
    path: (_ctx, role) => `/api/fixtures/${ctx.fixtureId}/logs/${ctx.fixtureLogIds[role === 'assistant' ? 1 : 0]}`,
    expect: STAFF_ALLOW,
    message: STAFF_ONLY_MSG,
  },
  {
    name: 'POST /api/injuries',
    method: 'post',
    path: () => '/api/injuries',
    body: () => ({ athlete_id: ctx.athleteId, description: 'Twisted ankle', date_sustained: isoDateFromNow(-2) }),
    expect: STAFF_ALLOW,
    message: STAFF_ONLY_MSG,
  },
  {
    name: 'POST /api/seasons',
    method: 'post',
    path: () => '/api/seasons',
    body: () => ({ name: 'Fresh Season', starts_on: isoDateFromNow(0), ends_on: isoDateFromNow(90) }),
    expect: STAFF_ALLOW,
    message: STAFF_ONLY_MSG,
  },
  {
    name: 'PATCH /api/seasons/:id',
    method: 'patch',
    path: () => `/api/seasons/${ctx.seasonIds[0]}`,
    body: () => ({ name: 'Renamed Season' }),
    expect: STAFF_ALLOW,
    message: STAFF_ONLY_MSG,
  },
  {
    name: 'DELETE /api/seasons/:id',
    method: 'delete',
    path: (_ctx, role) => `/api/seasons/${ctx.seasonIds[role === 'assistant' ? 1 : 0]}`,
    expect: STAFF_ALLOW,
    message: STAFF_ONLY_MSG,
  },
  {
    name: 'POST /api/seasons/:id/schedule',
    method: 'post',
    path: () => `/api/seasons/${ctx.seasonIds[0]}/schedule`,
    body: () => ({ opponents: ['Alpha FC', 'Beta FC'] }),
    expect: STAFF_ALLOW,
    message: STAFF_ONLY_MSG,
  },
  {
    name: 'POST /api/sessions',
    method: 'post',
    path: () => '/api/sessions',
    body: () => ({ name: 'Fresh Drill', tactical_goal: 'passing' }),
    expect: STAFF_ALLOW,
    message: STAFF_ONLY_MSG,
  },
  {
    name: 'PATCH /api/sessions/:id',
    method: 'patch',
    path: () => `/api/sessions/${ctx.drillIds[0]}`,
    body: () => ({ name: 'Renamed Drill' }),
    expect: STAFF_ALLOW,
    message: STAFF_ONLY_MSG,
  },
  {
    name: 'DELETE /api/sessions/:id',
    method: 'delete',
    path: (_ctx, role) => `/api/sessions/${ctx.drillIds[role === 'assistant' ? 1 : 0]}`,
    expect: STAFF_ALLOW,
    message: STAFF_ONLY_MSG,
  },
  {
    name: 'POST /api/friendlies',
    method: 'post',
    path: () => '/api/friendlies',
    body: () => ({ opposing_squad_id: ctx.otherSquadId, event_date: isoDaysFromNow(6) }),
    expect: STAFF_ALLOW,
    message: STAFF_ONLY_MSG,
  },
  {
    name: 'POST /api/friendlies/:id/accept',
    method: 'post',
    path: () => `/api/friendlies/${ctx.friendlyIncomingId}/accept`,
    expect: STAFF_ALLOW,
    message: STAFF_ONLY_MSG,
  },
  {
    name: 'POST /api/friendlies/:id/decline',
    method: 'post',
    path: () => `/api/friendlies/${ctx.friendlyIncomingId}/decline`,
    expect: STAFF_ALLOW,
    message: STAFF_ONLY_MSG,
  },
  {
    name: 'POST /api/friendlies/:id/cancel',
    method: 'post',
    path: () => `/api/friendlies/${ctx.friendlyOutgoingId}/cancel`,
    expect: STAFF_ALLOW,
    message: STAFF_ONLY_MSG,
  },

  // ---- athlete-only: own RSVP ----
  {
    name: 'PUT /api/events/:id/rsvps/mine',
    method: 'put',
    path: () => `/api/events/${ctx.eventId}/rsvps/mine`,
    body: () => ({ status: 'available' }),
    expect: { coach: 403, assistant: 403, athlete: 'allow' },
    message: 'Your account is not linked to an athlete on this roster',
  },
]

describe('T4 — role × route 403 matrix', () => {
  for (const c of MATRIX) {
    // The lineup-suggestion engines run the ratings pipeline, so they are
    // slower than every other route here; give all cases headroom.
    test(c.name, async () => {
      ctx = await seedMatrixWorld()

      for (const role of ROLE_ORDER) {
        const expected = c.expect[role]
        if (expected === undefined) continue

        const path = c.path(ctx, role)
        const body = typeof c.body === 'function' ? c.body(ctx, role) : c.body
        const req = request(app)[c.method](path).set('x-test-clerk-user-id', CLERK_ID[role])
        if (body !== undefined) req.send(body)
        const res = await req

        const label = `${role} ${c.method.toUpperCase()} ${path} → ${res.status} ${JSON.stringify(res.body?.error ?? res.body ?? '')}`

        if (expected === 'allow') {
          expect(res.status, label).not.toBe(403)
          expect(res.status, label).toBeLessThan(500)
        } else {
          expect(res.status, label).toBe(expected)
          if (c.message) {
            expect(res.body.error, label).toBe(c.message)
          } else {
            expect(typeof res.body.error, label).toBe('string')
          }
        }
      }
    }, 30_000)
  }
})

describe('T4 — accounts that are not yet linked to a squad', () => {
  beforeEach(async () => {
    ctx = await seedMatrixWorld()
  })

  test('an unlinked assistant is rejected on squad-scoped reads', async () => {
    const res = await request(app)
      .get('/api/squads/mine')
      .set('x-test-clerk-user-id', UNLINKED_ASSISTANT)

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('This account is not yet linked to a squad')
  })

  test('an unlinked athlete is rejected on squad-scoped reads', async () => {
    const res = await request(app)
      .get('/api/tactics')
      .set('x-test-clerk-user-id', UNLINKED_ATHLETE)

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('This account is not yet linked to a squad')
  })

  test('an unlinked athlete cannot answer RSVPs', async () => {
    const res = await request(app)
      .put(`/api/events/${ctx.eventId}/rsvps/mine`)
      .set('x-test-clerk-user-id', UNLINKED_ATHLETE)
      .send({ status: 'available' })

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('This account is not yet linked to a squad')
  })
})
