// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
//
// The public squad directory and public squad page: only opted-in squads are
// shown, live matches appear with their score, results come from both plain
// matches and league fixtures (from the squad's side), and the public roster
// never exposes private player details.
import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import { pool, resetDatabase, seedCoach } from './setup'
import publicRouter from '../../src/routes/public'

const app = express()
app.use('/api/public', publicRouter)

let squadId
let userId

beforeAll(async () => {
  try {
    await pool.query('SELECT 1')
  } catch (err) {
    throw new Error(`Could not reach the test database.\nOriginal error: ${err.message}`, { cause: err })
  }
})
beforeEach(async () => {
  await resetDatabase()
  const seeded = await seedCoach()
  squadId = seeded.squadId
  userId = seeded.userId
  await pool.query("UPDATE squads SET name = 'Wits FC', is_public = true WHERE id = $1", [squadId])
})
afterAll(async () => {
  await pool.end()
})

async function athlete(squad, name, number) {
  const r = await pool.query(
    `INSERT INTO athletes (squad_id, name, squad_number, position, email)
     VALUES ($1, $2, $3, 'Forward', $4) RETURNING id`,
    [squad, name, number, `${name.replace(/\s/g, '').toLowerCase()}@example.com`]
  )
  return r.rows[0].id
}
async function match(squad, { status = 'completed', opponent = 'Rovers', daysAgo = 1 } = {}) {
  const r = await pool.query(
    `INSERT INTO events (squad_id, title, event_type, format, event_date, status, opponent)
     VALUES ($1, 'Match', 'match', 'match', now() - ($2 || ' days')::interval, $3, $4) RETURNING id`,
    [squad, String(daysAgo), status, opponent]
  )
  return r.rows[0].id
}
async function log(eventId, athleteId, action, { fixtureId = null } = {}) {
  await pool.query(
    `INSERT INTO log_entries (event_id, fixture_id, athlete_id, action_type, is_scoring, value, logged_by)
     VALUES ($1, $2, $3, $4, $5, 1, $6)`,
    [eventId, fixtureId, athleteId, action, action === 'goal', userId]
  )
}

describe('GET /api/public/squads', () => {
  test('lists only opted-in squads, with live matches and their scores', async () => {
    const striker = await athlete(squadId, 'Sam Striker', 9)
    const live = await match(squadId, { status: 'live', opponent: 'City' })
    await log(live, striker, 'goal')
    await log(live, null, 'goal')
    await log(live, striker, 'goal')
    const hidden = (await seedCoach('private_coach')).squadId
    await match(hidden, { status: 'live' })

    const res = await request(app).get('/api/public/squads')
    expect(res.status).toBe(200)
    expect(res.body.squads).toEqual([{ id: squadId, name: 'Wits FC', athlete_count: 1 }])
    expect(res.body.live).toEqual([
      { kind: 'match', id: live, squadName: 'Wits FC', opponent: 'City', squadScore: 2, opponentScore: 1 },
    ])
  })

  test('shows a live league fixture involving a public squad, scored per side', async () => {
    const other = (await seedCoach('away_coach')).squadId
    await pool.query("UPDATE squads SET name = 'Rovers' WHERE id = $1", [other])
    const mine = await athlete(squadId, 'Home Hero', 7)
    const theirs = await athlete(other, 'Away Ace', 10)
    const league = await match(squadId, { status: 'live' })
    await pool.query("UPDATE events SET format = 'league', title = 'Spring League' WHERE id = $1", [league])
    const fx = (await pool.query(
      `INSERT INTO fixtures (event_id, home_squad_id, away_squad_id, event_date, status)
       VALUES ($1, $2, $3, now(), 'live') RETURNING id`,
      [league, squadId, other]
    )).rows[0].id
    await log(league, mine, 'goal', { fixtureId: fx })
    await log(league, theirs, 'goal', { fixtureId: fx })
    await log(league, theirs, 'goal', { fixtureId: fx })

    const res = await request(app).get('/api/public/squads')
    expect(res.body.live).toEqual([
      { kind: 'fixture', id: fx, homeName: 'Wits FC', awayName: 'Rovers', league: 'Spring League', homeScore: 1, awayScore: 2 },
    ])
  })
})

describe('GET /api/public/squads/:id', () => {
  test('shows the roster without private details, recent results and stat leaders', async () => {
    const striker = await athlete(squadId, 'Sam Striker', 9)
    const winger = await athlete(squadId, 'Wes Winger', 7)
    const older = await match(squadId, { opponent: 'United', daysAgo: 10 })
    await log(older, null, 'goal')
    const recent = await match(squadId, { opponent: 'Rovers', daysAgo: 2 })
    await log(recent, striker, 'goal')
    await log(recent, striker, 'goal')
    await log(recent, winger, 'assist')
    await match(squadId, { status: 'scheduled', daysAgo: -3 })

    const res = await request(app).get(`/api/public/squads/${squadId}`)
    expect(res.status).toBe(200)
    expect(res.body.squad).toEqual({ id: squadId, name: 'Wits FC' })

    // Public-safe fields only: no email, no date of birth.
    for (const player of res.body.roster) {
      expect(Object.keys(player).sort()).toEqual(['id', 'name', 'position', 'squad_number'])
    }
    expect(res.body.roster.map((p) => p.name)).toEqual(['Wes Winger', 'Sam Striker'])

    expect(res.body.recentResults).toEqual([
      expect.objectContaining({ kind: 'match', opponent: 'Rovers', squadScore: 2, opponentScore: 0 }),
      expect.objectContaining({ kind: 'match', opponent: 'United', squadScore: 0, opponentScore: 1 }),
    ])
    expect(res.body.leaders).toEqual([
      { athleteId: striker, athleteName: 'Sam Striker', goals: 2, assists: 0 },
      { athleteId: winger, athleteName: 'Wes Winger', goals: 0, assists: 1 },
    ])
  })

  test("includes league fixtures from the squad's own side when it played away", async () => {
    const home = (await seedCoach('home_coach')).squadId
    await pool.query("UPDATE squads SET name = 'City' WHERE id = $1", [home])
    const mine = await athlete(squadId, 'Away Hero', 11)
    const league = await match(home, { status: 'live' })
    await pool.query("UPDATE events SET format = 'league', title = 'Cup' WHERE id = $1", [league])
    const fx = (await pool.query(
      `INSERT INTO fixtures (event_id, home_squad_id, away_squad_id, event_date, status)
       VALUES ($1, $2, $3, now() - interval '1 day', 'completed') RETURNING id`,
      [league, home, squadId]
    )).rows[0].id
    await log(league, mine, 'goal', { fixtureId: fx })

    const res = await request(app).get(`/api/public/squads/${squadId}`)
    expect(res.body.recentResults).toEqual([
      expect.objectContaining({ kind: 'fixture', opponent: 'City', squadScore: 1, opponentScore: 0, league: 'Cup' }),
    ])
  })

  test('404s a squad that has not opted in, or does not exist', async () => {
    const hidden = (await seedCoach('private_coach')).squadId
    expect((await request(app).get(`/api/public/squads/${hidden}`)).status).toBe(404)
    expect((await request(app).get('/api/public/squads/999999')).status).toBe(404)
  })
})
