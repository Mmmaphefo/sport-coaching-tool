import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import { pool, resetDatabase, seedCoach } from './setup'
import publicRouter from '../../src/routes/public'

// The public leaderboard is unauthenticated by design (landing page), so this
// suite mounts the router bare — no auth stubs, no x-test-clerk-user-id.
const app = express()
app.use(express.json())
app.use('/api/public', publicRouter)

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

// seedCoach creates the user plus a default 'Test Squad' row; rename and flag
// it here so each test reads as table setup rather than SQL.
async function seedSquad(clerkId, name, isPublic) {
  const { squadId, userId } = await seedCoach(clerkId)
  await pool.query('UPDATE squads SET name = $1, is_public = $2 WHERE id = $3', [
    name,
    isPublic,
    squadId,
  ])
  return { squadId, userId }
}

async function seedAthlete(squadId, name) {
  const result = await pool.query(
    'INSERT INTO athletes (squad_id, name) VALUES ($1, $2) RETURNING id',
    [squadId, name]
  )
  return result.rows[0].id
}

async function seedSimpleMatch({ squadId, userId, status = 'completed' }) {
  const result = await pool.query(
    `INSERT INTO events (squad_id, opponent, event_type, format, event_date, status, created_by)
     VALUES ($1, 'Riverside FC', 'match', 'match', now() - interval '1 day', $2, $3)
     RETURNING id`,
    [squadId, status, userId]
  )
  return result.rows[0].id
}

// League event + one completed fixture between two squads.
async function seedFixture({ homeSquadId, awaySquadId, userId }) {
  const league = await pool.query(
    `INSERT INTO events (squad_id, title, format, event_type, event_date, status, required_teams, created_by)
     VALUES ($1, 'Board League', 'league', 'league', now() - interval '2 days', 'full', 2, $2)
     RETURNING id`,
    [homeSquadId, userId]
  )
  const fixture = await pool.query(
    `INSERT INTO fixtures (event_id, home_squad_id, away_squad_id, event_date, status)
     VALUES ($1, $2, $3, now() - interval '1 day', 'completed')
     RETURNING id`,
    [league.rows[0].id, homeSquadId, awaySquadId]
  )
  return { leagueEventId: league.rows[0].id, fixtureId: fixture.rows[0].id }
}

async function seedLog({
  eventId,
  fixtureId = null,
  athleteId,
  actionType = 'goal',
  isScoring = true,
  value = 1,
  deleted = false,
  loggedBy,
}) {
  await pool.query(
    `INSERT INTO log_entries
       (event_id, fixture_id, athlete_id, action_type, is_scoring, value, deleted_at, logged_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      eventId,
      fixtureId,
      athleteId,
      actionType,
      isScoring,
      value,
      deleted ? new Date() : null,
      loggedBy,
    ]
  )
}

describe('GET /api/public/leaderboard', () => {
  test('ranks public squads across completed matches and fixtures; private squads never appear', async () => {
    const rovers = await seedSquad('board_rovers', 'Rovers FC', true)
    const athletic = await seedSquad('board_athletic', 'Athletic United', true)
    const hidden = await seedSquad('board_hidden', 'Secret SC', false)

    const roversStriker = await seedAthlete(rovers.squadId, 'R Striker')
    const hiddenStriker = await seedAthlete(hidden.squadId, 'H Striker')

    // Completed simple match: Rovers win 3-1. The opponent goal is logged
    // with no athlete, exactly how the live logger records it.
    const roversMatch = await seedSimpleMatch({ squadId: rovers.squadId, userId: rovers.userId })
    await seedLog({ eventId: roversMatch, athleteId: roversStriker, value: 2, loggedBy: rovers.userId })
    await seedLog({ eventId: roversMatch, athleteId: roversStriker, value: 1, loggedBy: rovers.userId })
    await seedLog({ eventId: roversMatch, athleteId: null, value: 1, loggedBy: rovers.userId })

    // A completed match for the private squad must never surface.
    const hiddenMatch = await seedSimpleMatch({ squadId: hidden.squadId, userId: hidden.userId })
    await seedLog({ eventId: hiddenMatch, athleteId: hiddenStriker, value: 5, loggedBy: hidden.userId })

    // Completed league fixture: Rovers 2-0 Athletic, home win. The
    // athlete-less scoring entry mirrors opponent-goal logging and must not
    // count for either side.
    const { leagueEventId, fixtureId } = await seedFixture({
      homeSquadId: rovers.squadId,
      awaySquadId: athletic.squadId,
      userId: rovers.userId,
    })
    await seedLog({
      eventId: leagueEventId,
      fixtureId,
      athleteId: roversStriker,
      value: 2,
      loggedBy: rovers.userId,
    })
    await seedLog({ eventId: leagueEventId, fixtureId, athleteId: null, value: 1, loggedBy: rovers.userId })

    const response = await request(app).get('/api/public/leaderboard')

    expect(response.status).toBe(200)
    expect(response.body.leaderboard).toHaveLength(2)

    const [first, second] = response.body.leaderboard
    expect(first.squadName).toBe('Rovers FC')
    expect(first).toMatchObject({
      played: 2,
      won: 2,
      drawn: 0,
      lost: 0,
      goalsFor: 5,
      goalsAgainst: 1,
      goalDifference: 4,
      cleanSheets: 1,
      points: 6,
    })
    expect(second.squadName).toBe('Athletic United')
    expect(second).toMatchObject({
      played: 1,
      won: 0,
      drawn: 0,
      lost: 1,
      goalsFor: 0,
      goalsAgainst: 2,
      goalDifference: -2,
      cleanSheets: 0,
      points: 0,
    })
  })

  test('only completed matches count — scheduled games, soft-deleted and non-scoring entries are ignored', async () => {
    const only = await seedSquad('board_only', 'Phantom FC', true)
    const striker = await seedAthlete(only.squadId, 'P Striker')

    // A scheduled match with a "5-0" logged must not count.
    const scheduled = await seedSimpleMatch({ squadId: only.squadId, userId: only.userId, status: 'scheduled' })
    await seedLog({ eventId: scheduled, athleteId: striker, value: 5, loggedBy: only.userId })

    // A completed match whose only scoring entry was undone (soft delete),
    // plus a book-keeping yellow card that is not a scoring action.
    const completed = await seedSimpleMatch({ squadId: only.squadId, userId: only.userId })
    await seedLog({ eventId: completed, athleteId: striker, value: 1, deleted: true, loggedBy: only.userId })
    await seedLog({
      eventId: completed,
      athleteId: striker,
      actionType: 'yellow_card',
      isScoring: false,
      loggedBy: only.userId,
    })

    const response = await request(app).get('/api/public/leaderboard')

    expect(response.status).toBe(200)
    expect(response.body.leaderboard).toHaveLength(1)
    // The completed match still happened, but with no surviving scoring
    // entries it is a 0-0 draw — same semantics as the dashboard form —
    // never the phantom 5-0 from the scheduled game.
    expect(response.body.leaderboard[0]).toMatchObject({
      squadName: 'Phantom FC',
      played: 1,
      won: 0,
      drawn: 1,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 1,
    })
  })

  test('caps the table at 10 squads and ties break alphabetically', async () => {
    for (let i = 1; i <= 11; i++) {
      const squad = await seedSquad(`board_${i}`, `Board Squad ${i}`, true)
      const striker = await seedAthlete(squad.squadId, `Striker ${i}`)
      const match = await seedSimpleMatch({ squadId: squad.squadId, userId: squad.userId })
      await seedLog({ eventId: match, athleteId: striker, loggedBy: squad.userId })
    }

    const response = await request(app).get('/api/public/leaderboard')

    expect(response.status).toBe(200)
    expect(response.body.leaderboard).toHaveLength(10)
    // Identical 1-0 wins everywhere, so the alphabetical tie-break decides.
    expect(response.body.leaderboard[0].squadName).toBe('Board Squad 1')
    expect(response.body.leaderboard[0].points).toBe(3)
  })
})
