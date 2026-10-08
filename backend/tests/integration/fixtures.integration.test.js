import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import { pool, resetDatabase, seedAvailability } from './setup'

import eventsRouter from '../../src/routes/events'
import fixturesRouter from '../../src/routes/fixtures'
import athletesRouter from '../../src/routes/athletes'
import squadsRouter from '../../src/routes/squads'

const app = express()
app.use(express.json())
app.use('/api/events', eventsRouter)
app.use('/api/fixtures', fixturesRouter)
app.use('/api/athletes', athletesRouter)
app.use('/api/squads', squadsRouter)

beforeAll(async () => {
  try {
    await pool.query('SELECT 1')
  } catch (err) {
    throw new Error(
      'Could not reach the test database. Create it and run migrations against it first.\n' +
        `Original error: ${err.message}`,
      { cause: err }
    )
  }
})

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

// League/tournament creation and joining now require a squad to meet its
// min_roster_size (defaults to 11) before it can field a team — seed enough
// generic athletes onto a squad so those flows are actually reachable here.
async function seedRoster(targetSquadId, count = 11) {
  for (let i = 0; i < count; i++) {
    await pool.query(
      `INSERT INTO athletes (squad_id, name, squad_number) VALUES ($1, $2, $3)`,
      [targetSquadId, `Squad Player ${i + 1}`, i + 1]
    )
  }
}

async function createLeague() {
  // Resolve (self-heal) the creator's own squad first via GET /api/squads/mine,
  // so we have a squadId to seed athletes onto *before* creating the league —
  // the league-creation endpoint now requires the roster minimum up front.
  const mySquad = await request(app)
    .get('/api/squads/mine')
    .set('x-test-clerk-user-id', 'test_clerk_user')
  await seedRoster(mySquad.body.id)

  const created = await request(app)
    .post('/api/events')
    .set('x-test-clerk-user-id', 'test_clerk_user')
    .send({
      title: 'Fixture Test League',
      format: 'league',
      required_teams: 2,
      event_date: new Date().toISOString(),
    })

  const eventId = created.body.id

  // Create a second coach+squad and join the league.
  await pool.query("INSERT INTO users (clerk_id, role) VALUES ('coach_two', 'coach') RETURNING id")
  const squad2 = await pool.query(
    'INSERT INTO squads (coach_id, name) VALUES ((SELECT id FROM users WHERE clerk_id = $1), $2) RETURNING id',
    ['coach_two', 'Coach Two Squad']
  )
  await seedRoster(squad2.rows[0].id)

  await request(app)
    .post(`/api/events/${eventId}/join`)
    .set('x-test-clerk-user-id', 'coach_two')

  const detail = await request(app)
    .get(`/api/events/${eventId}`)
    .set('x-test-clerk-user-id', 'test_clerk_user')

  const creatorSquadId = detail.body.teams.find((t) => t.is_mine).squad_id
  const homeFixture = detail.body.fixtures.find((f) => f.home_squad_id === creatorSquadId)

  return { eventId, fixtureId: homeFixture.id, awaySquadId: squad2.rows[0].id }
}

// Logging is gated on the starting lineups existing, so most tests set them
// first: 11 starters per side (or an explicit starter list) on a simple
// grid, everyone else benched.
async function setFixtureLineup(fixtureId, { homeStarterIds, awayStarterIds } = {}) {
  const detail = await request(app)
    .get(`/api/fixtures/${fixtureId}`)
    .set('x-test-clerk-user-id', 'test_clerk_user')

  // The availability gate reads the home squad's RSVPs on the league event
  // before a fixture may go live; mark them all available so the XI save
  // starts it as it always did.
  await seedAvailability(detail.body.fixture.event_id, detail.body.rosters.home)

  const build = (roster, side, starterIds) => roster.map((a, i) => {
    const isStarter = starterIds ? starterIds.includes(a.id) : i < 11
    return {
      athlete_id: a.id,
      team_side: side,
      is_starter: isStarter,
      pos_x: isStarter ? 10 + (i % 4) * 26 : null,
      pos_y: isStarter ? (side === 'home' ? 8 + Math.floor(i / 4) * 24 : 92 - Math.floor(i / 4) * 24) : null,
    }
  })

  const res = await request(app)
    .put(`/api/fixtures/${fixtureId}/lineup`)
    .set('x-test-clerk-user-id', 'test_clerk_user')
    .send({
      lineups: [
        ...build(detail.body.rosters.home, 'home', homeStarterIds),
        ...build(detail.body.rosters.away, 'away', awayStarterIds),
      ],
    })

  expect(res.status).toBe(200)
  return { home: detail.body.rosters.home, away: detail.body.rosters.away }
}

describe('US15/US16 — fixture detail and live logging', () => {
  test('AC: GET fixture detail returns result and timeline', async () => {
    const { fixtureId } = await createLeague()

    const res = await request(app)
      .get(`/api/fixtures/${fixtureId}`)
      .set('x-test-clerk-user-id', 'test_clerk_user')

    expect(res.status).toBe(200)
    expect(res.body.fixture).toBeDefined()
    expect(res.body.result).toEqual({ home: 0, away: 0 })
    expect(res.body.timeline).toEqual([])
    expect(res.body.canLog).toBe(true)
  })

  test('AC: away team cannot update the fixture', async () => {
    const { fixtureId } = await createLeague()

    const res = await request(app)
      .patch(`/api/fixtures/${fixtureId}`)
      .set('x-test-clerk-user-id', 'coach_two')
      .send({ status: 'completed' })

    expect(res.status).toBe(403)
  })

  test('AC: home team can log a goal and result updates', async () => {
    const { fixtureId } = await createLeague()
    const { home } = await setFixtureLineup(fixtureId)

    const logRes = await request(app)
      .post(`/api/fixtures/${fixtureId}/logs`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ athlete_id: home[0].id, action_type: 'goal', is_scoring: true, value: 1, minute: 12 })

    expect(logRes.status).toBe(201)

    const detail = await request(app)
      .get(`/api/fixtures/${fixtureId}`)
      .set('x-test-clerk-user-id', 'test_clerk_user')

    expect(detail.body.result).toEqual({ home: 1, away: 0 })
    expect(detail.body.timeline).toHaveLength(1)
  })

  test('rejects logging for an athlete outside the match-day squad', async () => {
    const { fixtureId, awaySquadId } = await createLeague()
    await setFixtureLineup(fixtureId)

    const athleteRes = await pool.query(
      'INSERT INTO athletes (squad_id, name) VALUES ($1, $2) RETURNING id',
      [awaySquadId, 'Away Striker']
    )
    const awayAthleteId = athleteRes.rows[0].id

    const res = await request(app)
      .post(`/api/fixtures/${fixtureId}/logs`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ athlete_id: awayAthleteId, action_type: 'goal' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Player is not in the match-day squad')
  })

  test('US6 — a cancelled fixture no longer accepts new log entries', async () => {
    const { fixtureId } = await createLeague()
    await pool.query("UPDATE fixtures SET status = 'cancelled' WHERE id = $1", [fixtureId])

    const athleteRes = await request(app)
      .post('/api/athletes')
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ name: 'Striker' })

    const res = await request(app)
      .post(`/api/fixtures/${fixtureId}/logs`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ athlete_id: athleteRes.body.id, action_type: 'goal' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Fixture is cancelled')

    const stored = await pool.query('SELECT * FROM log_entries WHERE fixture_id = $1', [fixtureId])
    expect(stored.rows).toHaveLength(0)
  })  

  test('AC: edit and undo a fixture log entry', async () => {
    const { fixtureId } = await createLeague()
    const { home } = await setFixtureLineup(fixtureId)

    const created = await request(app)
      .post(`/api/fixtures/${fixtureId}/logs`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ athlete_id: home[0].id, action_type: 'goal', minute: 5 })

    const logId = created.body.id

    const edited = await request(app)
      .patch(`/api/fixtures/${fixtureId}/logs/${logId}`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ minute: 7 })

    expect(edited.status).toBe(200)
    expect(edited.body.minute).toBe(7)

    const deleted = await request(app)
      .delete(`/api/fixtures/${fixtureId}/logs/${logId}`)
      .set('x-test-clerk-user-id', 'test_clerk_user')

    expect(deleted.status).toBe(204)

    const logs = await request(app)
      .get(`/api/fixtures/${fixtureId}/logs`)
      .set('x-test-clerk-user-id', 'test_clerk_user')

    expect(logs.body).toHaveLength(0)
  })
})
