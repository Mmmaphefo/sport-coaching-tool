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

beforeAll(async () => {
  // Fail fast with a clear message if the test database isn't set up yet,
  // rather than a confusing connection-refused error deep in the first test.
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
    `INSERT INTO events (squad_id, opponent, event_type, event_date, created_by)
     VALUES ($1, $2, $3, $4, (SELECT id FROM users WHERE clerk_id = 'test_clerk_user'))
     RETURNING *`,
    [
      squadId,
      overrides.opponent ?? 'Riverside FC',
      overrides.event_type ?? 'match',
      overrides.event_date ?? new Date(),
    ]
  )
  return res.rows[0]
}

async function createAthlete(overrides = {}) {
  const res = await pool.query(
    `INSERT INTO athletes (squad_id, name, squad_number) VALUES ($1, $2, $3) RETURNING *`,
    [squadId, overrides.name ?? 'Marcus Hale', overrides.squad_number ?? 9]
  )
  return res.rows[0]
}

// League/tournament creation and joining now require a squad to meet its
// min_roster_size (defaults to 11) before it can field a team — seed enough
// generic athletes onto a squad so those flows are actually reachable in
// tests that don't otherwise care about roster size.
async function seedRoster(targetSquadId, count = 11) {
  for (let i = 0; i < count; i++) {
    await pool.query(
      `INSERT INTO athletes (squad_id, name, squad_number) VALUES ($1, $2, $3)`,
      [targetSquadId, `Squad Player ${i + 1}`, i + 1]
    )
  }
}

async function createOtherSquad(clerkId, { rosterSize = 11 } = {}) {
  const userResult = await pool.query(
    'INSERT INTO users (clerk_id, role) VALUES ($1, $2) RETURNING id',
    [clerkId, 'coach']
  )
  const squadResult = await pool.query(
    'INSERT INTO squads (coach_id, name) VALUES ($1, $2) RETURNING id',
    [userResult.rows[0].id, `${clerkId} Squad`]
  )
  if (rosterSize > 0) {
    await seedRoster(squadResult.rows[0].id, rosterSize)
  }
  return { userId: userResult.rows[0].id, squadId: squadResult.rows[0].id }
}

// Live logging is gated on a lineup existing. For simple events that's the
// coach's own XI; for fixtures both sides are set. Starters go on a simple
// grid, everyone else is benched.
async function setEventLineup(eventId, { starterIds } = {}) {
  const athletes = await pool.query(
    'SELECT id FROM athletes WHERE squad_id = $1 ORDER BY name',
    [squadId]
  )
  // The availability gate reads RSVPs before a match may go live; mark the
  // squad available so the XI save starts the event as it always did.
  await seedAvailability(eventId, athletes.rows)
  const lineups = athletes.rows.map((a, i) => {
    const isStarter = starterIds ? starterIds.includes(a.id) : i < 11
    return {
      athlete_id: a.id,
      team_side: 'home',
      is_starter: isStarter,
      pos_x: isStarter ? 10 + (i % 4) * 26 : null,
      pos_y: isStarter ? 8 + Math.floor(i / 4) * 24 : null,
    }
  })
  const res = await request(app).put(`/api/events/${eventId}/lineup`).send({ lineups })
  expect(res.status).toBe(200)
}

async function setFixtureLineup(fixtureId, { homeStarterIds } = {}) {
  const detail = await request(app)
    .get(`/api/fixtures/${fixtureId}`)
    .set('x-test-clerk-user-id', 'test_clerk_user')

  // The fixture gate reads the home squad's RSVPs on the league event; a
  // fully available home side keeps "save the XIs, go live" working.
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
        ...build(detail.body.rosters.away, 'away'),
      ],
    })

  expect(res.status).toBe(200)
  return { home: detail.body.rosters.home, away: detail.body.rosters.away }
}

describe('US13 (integration) — log a scoring moment during a live event', () => {
  test('AC: creates a real row with athlete, action type, and timestamp', async () => {
    const event = await createEvent()
    const athlete = await createAthlete()
    await setEventLineup(event.id)

    const res = await request(app)
      .post(`/api/events/${event.id}/logs`)
      .send({ athlete_id: athlete.id, action_type: 'goal', is_scoring: true, minute: 23 })

    expect(res.status).toBe(201)
    expect(res.body.athlete_id).toBe(athlete.id)

    const stored = await pool.query('SELECT * FROM log_entries WHERE id = $1', [res.body.id])
    expect(stored.rows).toHaveLength(1)
    expect(stored.rows[0].logged_at).not.toBeNull()
  })

  test('rejects logging against an athlete from a different squad', async () => {
    const event = await createEvent()
    // A completely different coach, not the seeded one — squads.coach_id is
    // unique-constrained, so a second squad for the SAME coach would violate it.
    const otherCoach = await pool.query(
      "INSERT INTO users (clerk_id, role) VALUES ('other_coach', 'coach') RETURNING id"
    )
    const otherSquad = await pool.query(
      `INSERT INTO squads (coach_id, name) VALUES ($1, 'Other Squad') RETURNING id`,
      [otherCoach.rows[0].id]
    )
    const otherAthlete = await pool.query(
      `INSERT INTO athletes (squad_id, name) VALUES ($1, 'Intruder') RETURNING id`,
      [otherSquad.rows[0].id]
    )

    // Own squad lineup first, so the squad-ownership check is what fails.
    await createAthlete()
    await setEventLineup(event.id)

    const res = await request(app)
      .post(`/api/events/${event.id}/logs`)
      .send({ athlete_id: otherAthlete.rows[0].id, action_type: 'goal' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Athlete does not belong to this squad')
  })

  test('US6 — a cancelled event no longer accepts new log entries', async () => {
    const event = await createEvent()
    await pool.query("UPDATE events SET status = 'cancelled' WHERE id = $1", [event.id])
    const athlete = await createAthlete()

    const res = await request(app)
      .post(`/api/events/${event.id}/logs`)
      .send({ athlete_id: athlete.id, action_type: 'goal' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Event is cancelled')

    const stored = await pool.query('SELECT * FROM log_entries WHERE event_id = $1', [event.id])
    expect(stored.rows).toHaveLength(0)
  })  
})

describe('US14 (integration) — edit or undo a log entry', () => {
  test('AC: edit persists to the real row', async () => {
    const event = await createEvent()
    const athlete = await createAthlete()
    await setEventLineup(event.id)
    const created = await request(app)
      .post(`/api/events/${event.id}/logs`)
      .send({ athlete_id: athlete.id, action_type: 'goal', minute: 10 })

    const res = await request(app)
      .patch(`/api/events/${event.id}/logs/${created.body.id}`)
      .send({ action_type: 'penalty', minute: 15 })

    expect(res.status).toBe(200)

    const stored = await pool.query('SELECT action_type, minute FROM log_entries WHERE id = $1', [
      created.body.id,
    ])
    expect(stored.rows[0]).toMatchObject({ action_type: 'penalty', minute: 15 })
  })

  test('AC: undo soft-deletes — row still exists but drops out of the live timeline', async () => {
    const event = await createEvent()
    const athlete = await createAthlete()
    await setEventLineup(event.id)
    const created = await request(app)
      .post(`/api/events/${event.id}/logs`)
      .send({ athlete_id: athlete.id, action_type: 'goal' })

    const res = await request(app).delete(`/api/events/${event.id}/logs/${created.body.id}`)
    expect(res.status).toBe(204)

    const stored = await pool.query('SELECT deleted_at FROM log_entries WHERE id = $1', [
      created.body.id,
    ])
    expect(stored.rows[0].deleted_at).not.toBeNull()

    const timeline = await request(app).get(`/api/events/${event.id}/logs`)
    expect(timeline.body).toHaveLength(0)
  })
})

describe('US15 (integration) — final result and penalties', () => {
  test('AC: event detail aggregates real rows into a result + timeline', async () => {
    const event = await createEvent()
    const athlete = await createAthlete()
    await setEventLineup(event.id)

    await request(app)
      .post(`/api/events/${event.id}/logs`)
      .send({ athlete_id: athlete.id, action_type: 'goal', is_scoring: true })
    await request(app)
      .post(`/api/events/${event.id}/logs`)
      .send({ action_type: 'goal', is_scoring: true }) // opponent goal, no athlete_id
    await request(app)
      .post(`/api/events/${event.id}/logs`)
      .send({ athlete_id: athlete.id, action_type: 'yellow_card', is_scoring: false })

    const res = await request(app).get(`/api/events/${event.id}`)

    expect(res.status).toBe(200)
    expect(res.body.result).toEqual({ squad: 1, opponent: 1 })
    expect(res.body.timeline).toHaveLength(3)
    expect(res.body.penalties).toHaveLength(1)
  })
})

describe('US16 (integration) — near-real-time timeline', () => {
  test('AC: a newly logged action shows up immediately on the logs endpoint', async () => {
    const event = await createEvent()
    const athlete = await createAthlete()
    await setEventLineup(event.id)

    await request(app).post(`/api/events/${event.id}/logs`).send({ athlete_id: athlete.id, action_type: 'save' })

    const res = await request(app).get(`/api/events/${event.id}/logs`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].action_type).toBe('save')
  })
})

describe('League / tournament events', () => {
  test('AC: creates a league event and auto-adds the creator as the first team', async () => {
    await seedRoster(squadId)

    const res = await request(app)
      .post('/api/events')
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({
        title: 'Winter League',
        format: 'league',
        required_teams: 3,
        event_date: new Date().toISOString(),
      })

    expect(res.status).toBe(201)
    expect(res.body.format).toBe('league')
    expect(res.body.required_teams).toBe(3)
    expect(res.body.status).toBe('open')

    const detail = await request(app)
      .get(`/api/events/${res.body.id}`)
      .set('x-test-clerk-user-id', 'test_clerk_user')

    expect(detail.body.teams).toHaveLength(1)
    expect(detail.body.teams[0].is_mine).toBe(true)
  })

  test('AC: joining fills the league and auto-generates a round-robin schedule', async () => {
    await seedRoster(squadId)
    await createOtherSquad('coach_two')
    await createOtherSquad('coach_three')

    const created = await request(app)
      .post('/api/events')
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({
        title: 'Round Robin Test',
        format: 'league',
        required_teams: 3,
        event_date: new Date().toISOString(),
      })
    const eventId = created.body.id

    const join1 = await request(app)
      .post(`/api/events/${eventId}/join`)
      .set('x-test-clerk-user-id', 'coach_two')
    expect(join1.status).toBe(200)

    const join2 = await request(app)
      .post(`/api/events/${eventId}/join`)
      .set('x-test-clerk-user-id', 'coach_three')
    expect(join2.status).toBe(200)
    expect(join2.body.team_count).toBe(3)

    const detail = await request(app)
      .get(`/api/events/${eventId}`)
      .set('x-test-clerk-user-id', 'test_clerk_user')

    expect(detail.body.event.status).toBe('scheduled')
    expect(detail.body.fixtures).toHaveLength(6) // 3 teams, home + away for each pair

    const pairs = new Set()
    for (const fixture of detail.body.fixtures) {
      pairs.add(`${fixture.home_squad_id}-${fixture.away_squad_id}`)
    }
    expect(pairs.size).toBe(6)
  })

  test('AC: standings reflect fixture results using standard football rules', async () => {
    await seedRoster(squadId)
    await createOtherSquad('coach_two')
    await createOtherSquad('coach_three')

    const created = await request(app)
      .post('/api/events')
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({
        title: 'Standings Test',
        format: 'league',
        required_teams: 3,
        event_date: new Date().toISOString(),
      })
    const eventId = created.body.id

    await request(app)
      .post(`/api/events/${eventId}/join`)
      .set('x-test-clerk-user-id', 'coach_two')
    await request(app)
      .post(`/api/events/${eventId}/join`)
      .set('x-test-clerk-user-id', 'coach_three')

    const fixturesRes = await request(app)
      .get(`/api/events/${eventId}/fixtures`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
    const homeFixture = fixturesRes.body.find((f) => f.home_squad_id === squadId)

    const athlete = await createAthlete()
    const rosters = await setFixtureLineup(homeFixture.id)
    await setFixtureLineup(homeFixture.id, {
      homeStarterIds: [...rosters.home.slice(0, 10).map((a) => a.id), athlete.id],
    })

    await request(app)
      .post(`/api/fixtures/${homeFixture.id}/logs`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ athlete_id: athlete.id, action_type: 'goal', is_scoring: true, value: 2 })

    await request(app)
      .patch(`/api/fixtures/${homeFixture.id}`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ status: 'completed' })

    const standingsRes = await request(app)
      .get(`/api/events/${eventId}/standings`)
      .set('x-test-clerk-user-id', 'test_clerk_user')

    expect(standingsRes.status).toBe(200)
    const creatorRow = standingsRes.body.find((r) => r.squadId === squadId)
    expect(creatorRow).toMatchObject({ played: 1, wins: 1, draws: 0, losses: 0, gf: 2, ga: 0, gd: 2, points: 3 })
  })

  test('AC: top scorers and assisters aggregate across league fixtures', async () => {
    await seedRoster(squadId)
    await createOtherSquad('coach_two')

    const created = await request(app)
      .post('/api/events')
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({
        title: 'Stats Test',
        format: 'league',
        required_teams: 2,
        event_date: new Date().toISOString(),
      })
    const eventId = created.body.id

    await request(app)
      .post(`/api/events/${eventId}/join`)
      .set('x-test-clerk-user-id', 'coach_two')

    const fixturesRes = await request(app)
      .get(`/api/events/${eventId}/fixtures`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
    const homeFixture = fixturesRes.body.find((f) => f.home_squad_id === squadId)

    const scorer = await createAthlete({ name: 'Prolific Striker' })
    const assister = await createAthlete({ name: 'Creative Playmaker' })

    const rosters = await setFixtureLineup(homeFixture.id)
    await setFixtureLineup(homeFixture.id, {
      homeStarterIds: [...rosters.home.slice(0, 9).map((a) => a.id), scorer.id, assister.id],
    })

    await request(app)
      .post(`/api/fixtures/${homeFixture.id}/logs`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ athlete_id: scorer.id, action_type: 'goal', is_scoring: true, value: 2 })
    await request(app)
      .post(`/api/fixtures/${homeFixture.id}/logs`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ athlete_id: assister.id, action_type: 'assist', is_scoring: false, value: 1 })

    const statsRes = await request(app)
      .get(`/api/events/${eventId}/stats`)
      .set('x-test-clerk-user-id', 'test_clerk_user')

    expect(statsRes.status).toBe(200)
    expect(statsRes.body.topScorers).toHaveLength(1)
    expect(statsRes.body.topScorers[0]).toMatchObject({ athleteName: 'Prolific Striker', goals: 2 })
    expect(statsRes.body.topAssisters).toHaveLength(1)
    expect(statsRes.body.topAssisters[0]).toMatchObject({ athleteName: 'Creative Playmaker', assists: 1 })
  })
})
