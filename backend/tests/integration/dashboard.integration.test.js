import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import { pool, resetDatabase, seedCoach } from './setup'
import dashboardRouter from '../../src/routes/dashboard'

const app = express()
app.use(express.json())
app.use('/api/dashboard', dashboardRouter)

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

async function seedSquad(clerkId, name) {
  const { squadId, userId } = await seedCoach(clerkId)
  await pool.query('UPDATE squads SET name = $1 WHERE id = $2', [name, squadId])
  return { squadId, userId }
}

async function seedAthlete(squadId, name) {
  const result = await pool.query(
    'INSERT INTO athletes (squad_id, name) VALUES ($1, $2) RETURNING id',
    [squadId, name]
  )
  return result.rows[0].id
}

async function seedSimpleMatch({ squadId, userId, opponent, status = 'completed', daysAgo = 10 }) {
  const result = await pool.query(
    `INSERT INTO events (squad_id, opponent, event_type, format, event_date, status, created_by)
     VALUES ($1, $2, 'match', 'match', now() - ($3 || ' days')::interval, $4, $5)
     RETURNING id`,
    [squadId, opponent, daysAgo, status, userId]
  )
  return result.rows[0].id
}

async function seedLog({ eventId, fixtureId = null, athleteId, value, loggedBy }) {
  await pool.query(
    `INSERT INTO log_entries (event_id, fixture_id, athlete_id, action_type, is_scoring, value, logged_by)
     VALUES ($1, $2, $3, 'goal', true, $4, $5)`,
    [eventId, fixtureId, athleteId, value, loggedBy]
  )
}

async function seedCompletedFixture({ homeSquadId, awaySquadId, userId }) {
  const league = await pool.query(
    `INSERT INTO events (squad_id, title, format, event_type, event_date, status, required_teams, created_by)
     VALUES ($1, 'Trend League', 'league', 'league', now() - interval '20 days', 'full', 2, $2)
     RETURNING id`,
    [homeSquadId, userId]
  )
  const fixture = await pool.query(
    `INSERT INTO fixtures (event_id, home_squad_id, away_squad_id, event_date, status)
     VALUES ($1, $2, $3, now() - interval '25 days', 'completed')
     RETURNING id`,
    [league.rows[0].id, homeSquadId, awaySquadId]
  )
  return { leagueEventId: league.rows[0].id, fixtureId: fixture.rows[0].id }
}

describe('GET /api/dashboard/trends', () => {
  test('returns the squad record over time, oldest first, across matches and fixtures', async () => {
    const coach = 'trends_coach'
    const ours = await seedSquad(coach, 'Trend FC')
    const rival = await seedSquad('trends_rival', 'Rival United')
    const striker = await seedAthlete(ours.squadId, 'T Striker')

    // Oldest: a 2-1 win over Riverside.
    const m1 = await seedSimpleMatch({ squadId: ours.squadId, userId: ours.userId, opponent: 'Riverside FC', daysAgo: 30 })
    await seedLog({ eventId: m1, athleteId: striker, value: 2, loggedBy: ours.userId })
    await seedLog({ eventId: m1, athleteId: null, value: 1, loggedBy: ours.userId })

    // Middle: a 1-1 draw with Eastview.
    const m2 = await seedSimpleMatch({ squadId: ours.squadId, userId: ours.userId, opponent: 'Eastview Rovers', daysAgo: 20 })
    await seedLog({ eventId: m2, athleteId: striker, value: 1, loggedBy: ours.userId })
    await seedLog({ eventId: m2, athleteId: null, value: 1, loggedBy: ours.userId })

    // Newest: a 0-3 loss to Marlow.
    const m3 = await seedSimpleMatch({ squadId: ours.squadId, userId: ours.userId, opponent: 'Marlow Athletic', daysAgo: 5 })
    await seedLog({ eventId: m3, athleteId: null, value: 3, loggedBy: ours.userId })

    // A league fixture win (2-0) two weeks ago — older than m2, newer than m1.
    const { leagueEventId, fixtureId } = await seedCompletedFixture({
      homeSquadId: ours.squadId,
      awaySquadId: rival.squadId,
      userId: ours.userId,
    })
    await seedLog({ eventId: leagueEventId, fixtureId, athleteId: striker, value: 2, loggedBy: ours.userId })

    // A scheduled match with a flattering scoreline must not appear.
    const scheduled = await seedSimpleMatch({ squadId: ours.squadId, userId: ours.userId, opponent: 'Future FC', status: 'scheduled', daysAgo: 1 })
    await seedLog({ eventId: scheduled, athleteId: striker, value: 9, loggedBy: ours.userId })

    const response = await request(app)
      .get('/api/dashboard/trends')
      .set('x-test-clerk-user-id', coach)

    expect(response.status).toBe(200)
    expect(response.body.matches).toHaveLength(4)

    // Oldest first: Riverside (W 2-1), league fixture (W 2-0), Eastview (D 1-1), Marlow (L 0-3).
    const [first, second, third, fourth] = response.body.matches
    expect(first).toMatchObject({ kind: 'match', opponent: 'Riverside FC', goalsFor: 2, goalsAgainst: 1, result: 'W' })
    expect(second).toMatchObject({ kind: 'fixture', opponent: 'Rival United', goalsFor: 2, goalsAgainst: 0, result: 'W' })
    expect(third).toMatchObject({ kind: 'match', opponent: 'Eastview Rovers', goalsFor: 1, goalsAgainst: 1, result: 'D' })
    expect(fourth).toMatchObject({ kind: 'match', opponent: 'Marlow Athletic', goalsFor: 0, goalsAgainst: 3, result: 'L' })

    expect(response.body.summary).toMatchObject({ played: 4, wins: 2, draws: 1, losses: 1, goalsFor: 5, goalsAgainst: 5 })
  })

  test('returns an empty record for a squad with no completed matches', async () => {
    const coach = 'trends_empty'
    await seedSquad(coach, 'Empty FC')

    const response = await request(app)
      .get('/api/dashboard/trends')
      .set('x-test-clerk-user-id', coach)

    expect(response.status).toBe(200)
    expect(response.body.matches).toHaveLength(0)
    expect(response.body.summary).toMatchObject({ played: 0, points: 0 })
  })
})

describe('GET /api/dashboard/summary (smoke)', () => {
  test('still responds with the squad availability block', async () => {
    const coach = 'trends_summary'
    const { squadId } = await seedSquad(coach, 'Summary FC')
    await pool.query('INSERT INTO athletes (squad_id, name) VALUES ($1, $2)', [squadId, 'S Player'])

    const response = await request(app)
      .get('/api/dashboard/summary?period=7d')
      .set('x-test-clerk-user-id', coach)

    expect(response.status).toBe(200)
    expect(response.body.period).toBe('7d')
    expect(response.body.squad).toMatchObject({ totalRoster: 1, injuredCount: 0 })
  })
})
