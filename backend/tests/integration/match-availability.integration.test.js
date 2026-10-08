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

const COACH = 'test_clerk_user'
const awayClerkId = 'away_clerk_user'

// Pass Date objects for direct SQL inserts (see event-start-guards): the
// event_date columns are `timestamp without time zone` and an ISO string
// loses its zone, which shifts the stored value in timezones ahead of UTC.
const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000)

let squadId

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
  const seeded = await seedCoach()
  squadId = seeded.squadId
})

afterAll(async () => {
  await pool.end()
})

async function seedRoster(targetSquadId, count) {
  const athletes = []
  for (let i = 0; i < count; i++) {
    const res = await pool.query(
      'INSERT INTO athletes (squad_id, name, squad_number) VALUES ($1, $2, $3) RETURNING *',
      [targetSquadId, `Squad Player ${i + 1}`, i + 1]
    )
    athletes.push(res.rows[0])
  }
  return athletes
}

async function createMatch(overrides = {}) {
  const res = await pool.query(
    `INSERT INTO events (squad_id, opponent, event_type, format, event_date, status, location, location_lat, location_lng, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, (SELECT id FROM users WHERE clerk_id = $10))
     RETURNING *`,
    [
      squadId,
      overrides.opponent ?? 'Riverside FC',
      overrides.event_type ?? 'match',
      overrides.format ?? 'match',
      overrides.event_date ?? oneHourAgo,
      overrides.status ?? 'scheduled',
      overrides.location ?? null,
      overrides.location_lat ?? null,
      overrides.location_lng ?? null,
      COACH,
    ]
  )
  return res.rows[0]
}

// A one-fixture league where the seeded coach is the home side.
async function createLeagueFixture(overrides = {}) {
  const away = await seedCoach(awayClerkId)

  const eventRes = await pool.query(
    `INSERT INTO events (squad_id, title, format, event_type, event_date, status, required_teams, created_by)
     VALUES ($1, 'Test League', 'league', 'league', $2, 'full', 2,
       (SELECT id FROM users WHERE clerk_id = $3))
     RETURNING *`,
    [squadId, oneHourFromNow, COACH]
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

function startEvent(eventId) {
  return request(app)
    .patch(`/api/events/${eventId}`)
    .set('x-test-clerk-user-id', COACH)
    .send({ status: 'live' })
}

function startFixture(fixtureId, clerkId = COACH) {
  return request(app)
    .patch(`/api/fixtures/${fixtureId}`)
    .set('x-test-clerk-user-id', clerkId)
    .send({ status: 'live' })
}

async function saveEventLineup(eventId, athletes) {
  return request(app)
    .put(`/api/events/${eventId}/lineup`)
    .set('x-test-clerk-user-id', COACH)
    .send({
      lineups: athletes.map((a, i) => ({
        athlete_id: a.id,
        team_side: 'home',
        is_starter: i < 11,
        pos_x: i < 11 ? 10 + (i % 4) * 26 : null,
        pos_y: i < 11 ? 8 + Math.floor(i / 4) * 24 : null,
      })),
    })
}

describe('availability gate — starting a match', () => {
  test('the event detail reports the RSVP shortfall for a scheduled match', async () => {
    const athletes = await seedRoster(squadId, 12)
    const event = await createMatch()
    await seedAvailability(event.id, athletes.slice(0, 4))

    const res = await request(app)
      .get(`/api/events/${event.id}`)
      .set('x-test-clerk-user-id', COACH)

    expect(res.status).toBe(200)
    expect(res.body.availability).toEqual({ required: 11, available: 4, meets: false })
  })

  test('Start live is refused while short and succeeds once enough players reply', async () => {
    const athletes = await seedRoster(squadId, 12)
    const event = await createMatch()
    await seedAvailability(event.id, athletes.slice(0, 10))

    const refused = await startEvent(event.id)

    expect(refused.status).toBe(400)
    expect(refused.body.error).toMatch(/only 10 of 11 required players/i)
    expect(refused.body.availability).toEqual({ required: 11, available: 10, meets: false })

    const afterRefusal = await pool.query('SELECT status FROM events WHERE id = $1', [event.id])
    expect(afterRefusal.rows[0].status).toBe('scheduled')

    await seedAvailability(event.id, athletes.slice(10))

    const started = await startEvent(event.id)
    expect(started.status).toBe(200)
    expect(started.body.status).toBe('live')
  })

  test('a squad smaller than the configured minimum only needs everyone it has', async () => {
    const athletes = await seedRoster(squadId, 3)
    const event = await createMatch()
    await seedAvailability(event.id, athletes.slice(0, 2))

    const refused = await startEvent(event.id)
    expect(refused.status).toBe(400)
    expect(refused.body.availability).toEqual({ required: 3, available: 2, meets: false })

    await seedAvailability(event.id, athletes.slice(2))

    const started = await startEvent(event.id)
    expect(started.status).toBe(200)
  })

  test('unavailable replies do not count towards the bar', async () => {
    const athletes = await seedRoster(squadId, 12)
    const event = await createMatch()
    await seedAvailability(event.id, athletes.slice(0, 11))
    await seedAvailability(event.id, [athletes[11]], 'unavailable')

    const res = await startEvent(event.id)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('live')
  })

  test('training sessions are not gated by availability', async () => {
    const event = await createMatch({ event_type: 'training', format: 'training' })

    const res = await startEvent(event.id)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('live')
  })

  test('saving the XI on a due match keeps it scheduled while the squad is short', async () => {
    const athletes = await seedRoster(squadId, 12)
    const event = await createMatch({ event_date: oneHourAgo })
    await seedAvailability(event.id, athletes.slice(0, 10))

    const blocked = await saveEventLineup(event.id, athletes)

    expect(blocked.status).toBe(200)
    expect(blocked.body.lineups).toHaveLength(12)
    expect(blocked.body.startBlocked).toEqual({ required: 11, available: 10, meets: false })

    const afterBlocked = await pool.query('SELECT status FROM events WHERE id = $1', [event.id])
    expect(afterBlocked.rows[0].status).toBe('scheduled')

    // More replies arrive: saving the XI again now kicks off as it always did.
    await seedAvailability(event.id, athletes.slice(10, 11))
    const started = await saveEventLineup(event.id, athletes)

    expect(started.status).toBe(200)
    expect(started.body.startBlocked).toBeNull()

    const afterStarted = await pool.query('SELECT status FROM events WHERE id = $1', [event.id])
    expect(afterStarted.rows[0].status).toBe('live')
  })
})

describe('availability gate — league fixtures', () => {
  test('the home coach cannot start a fixture while the home squad is short', async () => {
    const fixture = await createLeagueFixture()
    const homeAthletes = await seedRoster(squadId, 12)

    const refused = await startFixture(fixture.id)

    expect(refused.status).toBe(400)
    expect(refused.body.error).toMatch(/only 0 of 11 required players/i)

    const afterRefusal = await pool.query('SELECT status FROM fixtures WHERE id = $1', [fixture.id])
    expect(afterRefusal.rows[0].status).toBe('scheduled')

    await seedAvailability(fixture.event_id, homeAthletes)

    const started = await startFixture(fixture.id)
    expect(started.status).toBe(200)
    expect(started.body.status).toBe('live')
  })

  test('the away squad cannot start the fixture at all', async () => {
    const fixture = await createLeagueFixture()

    const res = await startFixture(fixture.id, awayClerkId)
    expect(res.status).toBe(403)
  })
})

describe('venue pin — editable location on the map', () => {
  test('a match can be created with a pin and the detail returns it', async () => {
    await seedRoster(squadId, 12)

    const created = await request(app)
      .post('/api/events')
      .set('x-test-clerk-user-id', COACH)
      .send({
        opponent: 'Riverside FC',
        format: 'match',
        event_type: 'match',
        event_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        location: 'Main Oval',
        location_lat: -26.2041,
        location_lng: 28.0473,
      })

    expect(created.status).toBe(201)
    expect(Number(created.body.location_lat)).toBeCloseTo(-26.2041, 4)
    expect(Number(created.body.location_lng)).toBeCloseTo(28.0473, 4)

    const detail = await request(app)
      .get(`/api/events/${created.body.id}`)
      .set('x-test-clerk-user-id', COACH)

    expect(detail.status).toBe(200)
    expect(Number(detail.body.event.location_lat)).toBeCloseTo(-26.2041, 4)
    expect(Number(detail.body.event.location_lng)).toBeCloseTo(28.0473, 4)
  })

  test('editing moves the pin, omitting it keeps it, explicit nulls clear it', async () => {
    const event = await createMatch({ location_lat: -26.2041, location_lng: 28.0473 })

    const moved = await request(app)
      .patch(`/api/events/${event.id}`)
      .set('x-test-clerk-user-id', COACH)
      .send({ location: 'Main Oval', location_lat: -25.75, location_lng: 28.19 })

    expect(moved.status).toBe(200)
    expect(Number(moved.body.location_lat)).toBeCloseTo(-25.75, 4)
    expect(Number(moved.body.location_lng)).toBeCloseTo(28.19, 4)

    // A patch that never mentions coordinates (e.g. only the date) leaves
    // the saved pin alone.
    const untouched = await request(app)
      .patch(`/api/events/${event.id}`)
      .set('x-test-clerk-user-id', COACH)
      .send({ location: 'Main Oval' })

    expect(untouched.status).toBe(200)
    expect(Number(untouched.body.location_lat)).toBeCloseTo(-25.75, 4)

    // Clearing the pin in the editor sends explicit nulls.
    const cleared = await request(app)
      .patch(`/api/events/${event.id}`)
      .set('x-test-clerk-user-id', COACH)
      .send({ location_lat: null, location_lng: null })

    expect(cleared.status).toBe(200)
    expect(cleared.body.location_lat).toBeNull()
    expect(cleared.body.location_lng).toBeNull()
  })

  test('coordinates outside the valid range are rejected', async () => {
    await seedRoster(squadId, 12)

    const badLat = await request(app)
      .post('/api/events')
      .set('x-test-clerk-user-id', COACH)
      .send({
        opponent: 'Riverside FC',
        format: 'match',
        event_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        location_lat: 120,
        location_lng: 28,
      })
    expect(badLat.status).toBe(400)
    expect(badLat.body.error).toMatch(/location_lat/)

    const event = await createMatch()
    const badLng = await request(app)
      .patch(`/api/events/${event.id}`)
      .set('x-test-clerk-user-id', COACH)
      .send({ location_lat: -26, location_lng: 300 })
    expect(badLng.status).toBe(400)
    expect(badLng.body.error).toMatch(/location_lng/)
  })
})
