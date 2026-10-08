import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import { pool, resetDatabase, seedCoach, seedAvailability } from './setup'

import eventsRouter from '../../src/routes/events'
import fixturesRouter from '../../src/routes/fixtures'

const app = express()
app.use(express.json())
app.use('/api/events', eventsRouter)
app.use('/api/fixtures', fixturesRouter)

let squadId
const awayClerkId = 'away_clerk_user'

// Pass Date objects (not ISO strings) for direct SQL inserts: the events/fixtures
// event_date columns are `timestamp without time zone`, and PG silently drops
// the `Z` from an ISO string, storing the UTC wall-clock as local time. In
// timezones ahead of UTC that shifts the stored value backwards. The pg
// driver's Date serialization produces the correct local timestamp.
const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000)

beforeAll(async () => {
  try {
    await pool.query('SELECT 1')
  } catch (err) {
    throw new Error(
      'Could not reach the test database. Create it and run migrations against it first — see the setup instructions.\n' +
        `Original error: ${err.message}`,
      { cause: err }
    )
  }
})

beforeEach(async () => {
  await resetDatabase()
  const seeded = await seedCoach()
  squadId = seeded.squadId
})

afterAll(async () => {
  await pool.end()
})

async function createEvent(overrides = {}) {
  const res = await pool.query(
    `INSERT INTO events (squad_id, opponent, event_type, format, event_date, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, (SELECT id FROM users WHERE clerk_id = 'test_clerk_user'))
     RETURNING *`,
    [
      squadId,
      overrides.opponent ?? 'Riverside FC',
      overrides.event_type ?? 'match',
      overrides.format ?? 'match',
      overrides.event_date ?? oneHourAgo,
      overrides.status ?? 'scheduled',
    ]
  )
  return res.rows[0]
}

async function createLeagueFixture(overrides = {}) {
  const away = await seedCoach(awayClerkId)

  const eventRes = await pool.query(
    `INSERT INTO events (squad_id, title, format, event_type, event_date, status, required_teams, created_by)
     VALUES ($1, 'Test League', 'league', 'league', $2, 'full', 2,
       (SELECT id FROM users WHERE clerk_id = 'test_clerk_user'))
     RETURNING *`,
    [squadId, oneHourFromNow]
  )
  const event = eventRes.rows[0]

  await pool.query(
    `INSERT INTO event_teams (event_id, squad_id, role, seed_order) VALUES ($1, $2, 'participant', 1), ($1, $3, 'participant', 2)`,
    [event.id, squadId, away.squadId]
  )

  const fixtureRes = await pool.query(
    `INSERT INTO fixtures (event_id, home_squad_id, away_squad_id, event_date, status)
     VALUES ($1, $2, $3, $4, 'scheduled') RETURNING *`,
    [event.id, squadId, away.squadId, overrides.event_date ?? oneHourFromNow]
  )
  return fixtureRes.rows[0]
}

async function seedAthlete(targetSquadId, name = 'Matchday Player', squadNumber = 1) {
  const res = await pool.query(
    'INSERT INTO athletes (squad_id, name, squad_number) VALUES ($1, $2, $3) RETURNING *',
    [targetSquadId, name, squadNumber]
  )
  return res.rows[0]
}

describe('Scheduling guard — events cannot be created in the past', () => {
  test('AC: an event_date in the past is rejected and nothing is created', async () => {
    const res = await request(app)
      .post('/api/events')
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({
        title: 'Backdated Training',
        type: 'training',
        event_date: oneHourAgo,
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/past/i)

    const listRes = await request(app)
      .get('/api/events')
      .set('x-test-clerk-user-id', 'test_clerk_user')
    expect(listRes.body).toHaveLength(0)
  })
})

describe('Start-time guard — an event can only happen once its scheduled time is reached', () => {
  test('AC: logging against a future event is rejected and it stays scheduled', async () => {
    const event = await createEvent({ event_date: oneHourFromNow })

    const res = await request(app)
      .post(`/api/events/${event.id}/logs`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ action_type: 'goal' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/not started yet/i)

    const after = await pool.query('SELECT status FROM events WHERE id = $1', [event.id])
    expect(after.rows[0].status).toBe('scheduled')
  })

  test('AC: naming the starting XI after kickoff starts the event and anchors started_at, then logging works', async () => {
    const event = await createEvent({ event_date: oneHourAgo })
    const athlete = await seedAthlete(squadId)
    // Availability gate: the squad's one player is marked available, so the
    // bar (min(roster minimum, roster size)) is met and the XI save starts it.
    await seedAvailability(event.id, [athlete])

    // Live logging is lineup-gated, so the first live action is the coach
    // naming a starting XI — once kickoff has passed that itself starts the
    // event and anchors started_at.
    const lineup = await request(app)
      .put(`/api/events/${event.id}/lineup`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({
        lineups: [
          { athlete_id: athlete.id, team_side: 'home', is_starter: true, pos_x: 50, pos_y: 50 },
        ],
      })
    expect(lineup.status).toBe(200)

    const after = await pool.query('SELECT status, started_at FROM events WHERE id = $1', [event.id])
    expect(after.rows[0].status).toBe('live')
    expect(after.rows[0].started_at).not.toBeNull()

    const res = await request(app)
      .post(`/api/events/${event.id}/logs`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ action_type: 'goal' })

    expect(res.status).toBe(201)
  })

  test('AC: manually starting an event sets started_at and re-starting does not reset it', async () => {
    const event = await createEvent({ event_date: oneHourFromNow })

    const first = await request(app)
      .patch(`/api/events/${event.id}`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ status: 'live' })

    expect(first.status).toBe(200)
    expect(first.body.status).toBe('live')
    expect(first.body.started_at).not.toBeNull()

    const second = await request(app)
      .patch(`/api/events/${event.id}`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ status: 'live' })

    expect(new Date(second.body.started_at).getTime()).toBe(
      new Date(first.body.started_at).getTime()
    )
  })
})

describe('Start-time guard — fixtures follow the same rules', () => {
  test('AC: logging a fixture before kickoff is rejected', async () => {
    const fixture = await createLeagueFixture({ event_date: oneHourFromNow })

    const res = await request(app)
      .post(`/api/fixtures/${fixture.id}/logs`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ action_type: 'goal' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/not started yet/i)
  })

  test('AC: setting the lineups after kickoff starts the fixture and anchors started_at, then logging works', async () => {
    const fixture = await createLeagueFixture({ event_date: oneHourAgo })
    const homePlayer = await seedAthlete(squadId, 'Home Striker')
    const awayPlayer = await seedAthlete(fixture.away_squad_id, 'Away Striker')
    // The fixture gate reads the home squad's availability on the league
    // event; mark the home player available so the bar is met.
    await seedAvailability(fixture.event_id, [homePlayer])

    // The lineup gate makes naming the XIs the first live action; after
    // kickoff that itself starts the fixture and anchors started_at.
    const lineup = await request(app)
      .put(`/api/fixtures/${fixture.id}/lineup`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({
        lineups: [
          { athlete_id: homePlayer.id, team_side: 'home', is_starter: true, pos_x: 50, pos_y: 20 },
          { athlete_id: awayPlayer.id, team_side: 'away', is_starter: true, pos_x: 50, pos_y: 80 },
        ],
      })
    expect(lineup.status).toBe(200)

    const after = await pool.query('SELECT status, started_at FROM fixtures WHERE id = $1', [fixture.id])
    expect(after.rows[0].status).toBe('live')
    expect(after.rows[0].started_at).not.toBeNull()

    const res = await request(app)
      .post(`/api/fixtures/${fixture.id}/logs`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ action_type: 'goal' })

    expect(res.status).toBe(201)
  })
})
