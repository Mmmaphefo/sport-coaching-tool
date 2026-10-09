// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import { pool, resetDatabase, seedCoach } from './setup'

import compareRouter from '../../src/routes/compare'

const app = express()
app.use(express.json())
app.use('/api/compare', compareRouter)

let squadId
let userId
let athleteId

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
  userId = seeded.userId
  const athlete = await pool.query(
    "INSERT INTO athletes (squad_id, name, squad_number) VALUES ($1, 'Striker', 9) RETURNING id",
    [squadId]
  )
  athleteId = athlete.rows[0].id
})

afterAll(async () => {
  await pool.end()
})

// A completed regular match. `ours`/`theirs` list the action types logged
// for each side; ours are logged against our athlete, theirs with no athlete
// (the opposition has no roster in a regular match).
async function seedMatch({ date, opponent, ours = [], theirs = [], status = 'completed' }) {
  const ev = await pool.query(
    `INSERT INTO events (squad_id, title, event_type, format, event_date, status, opponent)
     VALUES ($1, $2, 'match', 'match', $3, $4, $5) RETURNING id`,
    [squadId, `vs ${opponent}`, date, status, opponent]
  )
  const eventId = ev.rows[0].id
  const log = (athlete, action) => pool.query(
    `INSERT INTO log_entries (event_id, athlete_id, action_type, is_scoring, value, logged_by)
     VALUES ($1, $2, $3, $4, 1, $5)`,
    [eventId, athlete, action, action === 'goal', userId]
  )
  for (const a of ours) await log(athleteId, a)
  for (const a of theirs) await log(null, a)
  return eventId
}

function getTeam(query) {
  return request(app).get(`/api/compare/team?${query}`).set('x-test-clerk-user-id', 'test_clerk_user')
}

describe('GET /api/compare/team', () => {
  test('compares the squad against its opponents over a period', async () => {
    await seedMatch({
      date: '2026-03-01T15:00:00Z', opponent: 'Rovers',
      ours: ['goal', 'goal', 'shot_on_target', 'yellow_card'], theirs: ['goal', 'save'],
    })
    await seedMatch({ date: '2026-04-01T15:00:00Z', opponent: 'United', ours: [], theirs: ['goal', 'red_card'] })
    await seedMatch({ date: '2026-05-01T15:00:00Z', opponent: 'rovers ', ours: ['goal'], theirs: ['goal'] })

    const res = await getTeam('from=2026-01-01&to=2026-12-31')
    expect(res.status).toBe(200)

    const s = res.body.period.summary
    expect(s).toMatchObject({
      played: 3, wins: 1, draws: 1, losses: 1, points: 4,
      goalsFor: 3, goalsAgainst: 3, goalDifference: 0, cleanSheets: 0,
    })
    expect(s.us).toMatchObject({ shotsOnTarget: 1, yellowCards: 1, redCards: 0 })
    expect(s.them).toMatchObject({ saves: 1, redCards: 1 })

    // Opponent names are grouped case- and whitespace-insensitively.
    const rovers = res.body.period.opponents.find((o) => o.opponent.toLowerCase().trim() === 'rovers')
    expect(rovers).toMatchObject({ played: 2, wins: 1, draws: 1, losses: 0, goalsFor: 3, goalsAgainst: 2 })
    expect(res.body.period.matches.map((m) => m.result)).toEqual(['W', 'L', 'D'])
    expect(res.body.comparePeriod).toBeNull()
  })

  test('compares one season against another', async () => {
    await seedMatch({ date: '2025-06-01T15:00:00Z', opponent: 'Rovers', theirs: ['goal'] })
    await seedMatch({ date: '2026-06-01T15:00:00Z', opponent: 'Rovers', ours: ['goal', 'goal'] })

    const res = await getTeam('from=2026-01-01&to=2026-12-31&vs_from=2025-01-01&vs_to=2025-12-31')
    expect(res.status).toBe(200)
    expect(res.body.period.summary).toMatchObject({ played: 1, wins: 1, goalsFor: 2 })
    expect(res.body.comparePeriod.summary).toMatchObject({ played: 1, losses: 1, goalsAgainst: 1 })
  })

  test('only counts completed matches inside the range, and ignores undone entries', async () => {
    const counted = await seedMatch({ date: '2026-02-01T15:00:00Z', opponent: 'A', ours: ['goal'] })
    await pool.query(
      "UPDATE log_entries SET deleted_at = now() WHERE event_id = $1 AND action_type = 'goal'",
      [counted]
    )
    await seedMatch({ date: '2026-02-02T15:00:00Z', opponent: 'B', ours: ['goal'], status: 'live' })
    await seedMatch({ date: '2027-01-01T15:00:00Z', opponent: 'C', ours: ['goal'] })

    const res = await getTeam('from=2026-01-01&to=2026-12-31')
    expect(res.body.period.summary).toMatchObject({ played: 1, goalsFor: 0, draws: 1 })
  })

  test('the end date is inclusive', async () => {
    await seedMatch({ date: '2026-12-31T20:00:00Z', opponent: 'Late', ours: ['goal'] })
    const res = await getTeam('from=2026-12-31&to=2026-12-31')
    expect(res.body.period.summary.played).toBe(1)
  })

  test('rejects malformed or reversed dates', async () => {
    expect((await getTeam('from=2026-1-1&to=2026-12-31')).status).toBe(400)
    expect((await getTeam('from=2026-12-31&to=2026-01-01')).status).toBe(400)
    expect((await getTeam('from=2026-01-01&to=2026-12-31&vs_from=2025-01-01')).status).toBe(400)
  })

  test("never includes another squad's matches", async () => {
    await pool.query("INSERT INTO users (clerk_id, role) VALUES ('other_coach', 'coach')")
    const other = await pool.query(
      "INSERT INTO squads (coach_id, name) VALUES ((SELECT id FROM users WHERE clerk_id = 'other_coach'), 'Other') RETURNING id"
    )
    await pool.query(
      `INSERT INTO events (squad_id, title, event_type, format, event_date, status, opponent)
       VALUES ($1, 'theirs', 'match', 'match', '2026-03-01', 'completed', 'X')`,
      [other.rows[0].id]
    )
    const res = await getTeam('from=2026-01-01&to=2026-12-31')
    expect(res.body.period.summary.played).toBe(0)
  })

  test("attributes a league fixture's actions by squad, away or home", async () => {
    await pool.query("INSERT INTO users (clerk_id, role) VALUES ('away_coach', 'coach')")
    const away = await pool.query(
      "INSERT INTO squads (coach_id, name) VALUES ((SELECT id FROM users WHERE clerk_id = 'away_coach'), 'City') RETURNING id"
    )
    const awayAthlete = await pool.query(
      "INSERT INTO athletes (squad_id, name) VALUES ($1, 'Their Striker') RETURNING id",
      [away.rows[0].id]
    )
    const league = await pool.query(
      `INSERT INTO events (squad_id, title, event_type, format, event_date, status)
       VALUES ($1, 'Spring League', 'match', 'league', '2026-03-01', 'live') RETURNING id`,
      [squadId]
    )
    // We are the AWAY side in this fixture.
    const fixture = await pool.query(
      `INSERT INTO fixtures (event_id, home_squad_id, away_squad_id, event_date, status)
       VALUES ($1, $2, $3, '2026-03-08T15:00:00Z', 'completed') RETURNING id`,
      [league.rows[0].id, away.rows[0].id, squadId]
    )
    const log = (athlete) => pool.query(
      `INSERT INTO log_entries (event_id, fixture_id, athlete_id, action_type, is_scoring, value, logged_by)
       VALUES ($1, $2, $3, 'goal', true, 1, $4)`,
      [league.rows[0].id, fixture.rows[0].id, athlete, userId]
    )
    await log(awayAthlete.rows[0].id)
    await log(awayAthlete.rows[0].id)
    await log(athleteId)

    const res = await getTeam('from=2026-01-01&to=2026-12-31')
    expect(res.body.period.summary).toMatchObject({ played: 1, losses: 1, goalsFor: 1, goalsAgainst: 2 })
    expect(res.body.period.matches[0]).toMatchObject({ kind: 'fixture', opponent: 'City', competition: 'Spring League' })
  })
})
