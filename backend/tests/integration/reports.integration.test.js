// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import { pool, resetDatabase, seedCoach } from './setup'

import reportsRouter from '../../src/routes/reports'

const app = express()
app.use(express.json())
app.use('/api/reports', reportsRouter)

let squadId
let userId
let striker
let winger
let sub

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
  const add = async (name, n) => (await pool.query(
    'INSERT INTO athletes (squad_id, name, squad_number) VALUES ($1, $2, $3) RETURNING id',
    [squadId, name, n]
  )).rows[0].id
  striker = await add('Sam Striker', 9)
  winger = await add('Wes Winger', 7)
  sub = await add('Ben Bench', 14)
})

afterAll(async () => {
  await pool.end()
})

async function seedEvent({ date = '2026-03-01T15:00:00Z', opponent = 'Rovers', status = 'completed' } = {}) {
  const r = await pool.query(
    `INSERT INTO events (squad_id, title, event_type, format, event_date, status, opponent, location)
     VALUES ($1, $2, 'match', 'match', $3, $4, $5, 'Home Ground') RETURNING id`,
    [squadId, `vs ${opponent}`, date, status, opponent]
  )
  return r.rows[0].id
}

async function log(eventId, { athlete = null, action, minute = null, scoring = false, related = null, notes = null }) {
  const r = await pool.query(
    `INSERT INTO log_entries (event_id, athlete_id, action_type, is_scoring, value, minute, notes, logged_by, related_log_id)
     VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8) RETURNING id`,
    [eventId, athlete, action, scoring, minute, notes, userId, related]
  )
  return r.rows[0].id
}

const get = (path) => request(app).get(path).set('x-test-clerk-user-id', 'test_clerk_user')

describe('GET /api/reports/match/:kind/:id', () => {
  test('builds the match report from the log', async () => {
    const eventId = await seedEvent()
    const goal = await log(eventId, { athlete: striker, action: 'goal', minute: 12, scoring: true })
    await log(eventId, { athlete: winger, action: 'assist', minute: 12, related: goal })
    await log(eventId, { action: 'goal', minute: 30, scoring: true })
    await log(eventId, { athlete: winger, action: 'yellow_card', minute: 40 })
    await log(eventId, { action: 'red_card', minute: 70 })
    await log(eventId, { athlete: striker, action: 'substitution', minute: 75, notes: `on:${sub}` })
    await log(eventId, { athlete: sub, action: 'goal', minute: 88, scoring: true })
    await log(eventId, { athlete: striker, action: 'shot_on_target', minute: 5 })
    const undone = await log(eventId, { athlete: winger, action: 'goal', minute: 89, scoring: true })
    await pool.query('UPDATE log_entries SET deleted_at = now() WHERE id = $1', [undone])

    const res = await get(`/api/reports/match/event/${eventId}`)
    expect(res.status).toBe(200)
    expect(res.body.score).toEqual({ us: 2, them: 1 })
    expect(res.body.result).toBe('W')
    expect(res.body.match).toMatchObject({ opponent: 'Rovers', location: 'Home Ground' })
    expect(res.body.scorers).toEqual([
      { side: 'us', name: 'Sam Striker', minute: 12, assist: 'Wes Winger' },
      { side: 'them', name: 'Rovers', minute: 30, assist: null },
      { side: 'us', name: 'Ben Bench', minute: 88, assist: null },
    ])
    expect(res.body.cards).toEqual([
      { side: 'us', name: 'Wes Winger', minute: 40, card: 'yellow' },
      { side: 'them', name: 'Rovers', minute: 70, card: 'red' },
    ])
    expect(res.body.substitutions).toEqual([{ side: 'us', off: 'Sam Striker', on: 'Ben Bench', minute: 75 }])
    expect(res.body.stats.us.shotsOnTarget).toBe(1)
    // The assist is folded into its goal, so it is not a separate timeline line.
    expect(res.body.timeline.some((t) => t.action === 'assist')).toBe(false)
    expect(res.body.timeline.find((t) => t.action === 'substitution').detail).toBe('Sam Striker off, Ben Bench on')
  })

  test("refuses another squad's match and unknown kinds", async () => {
    await pool.query("INSERT INTO users (clerk_id, role) VALUES ('other', 'coach')")
    const other = await pool.query(
      "INSERT INTO squads (coach_id, name) VALUES ((SELECT id FROM users WHERE clerk_id = 'other'), 'Other') RETURNING id"
    )
    const theirs = await pool.query(
      `INSERT INTO events (squad_id, title, event_type, format, event_date, status)
       VALUES ($1, 'x', 'match', 'match', now(), 'completed') RETURNING id`,
      [other.rows[0].id]
    )
    expect((await get(`/api/reports/match/event/${theirs.rows[0].id}`)).status).toBe(404)
    expect((await get('/api/reports/match/training/1')).status).toBe(404)
  })

  test('accepts the shared stats library\'s "match" spelling for regular matches', async () => {
    const eventId = await seedEvent()
    await log(eventId, { athlete: striker, action: 'goal', minute: 5, scoring: true })

    const res = await get(`/api/reports/match/match/${eventId}`)

    expect(res.status).toBe(200)
    expect(res.body.score).toEqual({ us: 1, them: 0 })
    expect(res.body.match.kind).toBe('event')
  })
})

describe('GET /api/reports/season', () => {
  test('summarises the season with per-player totals', async () => {
    const first = await seedEvent({ date: '2026-03-01T15:00:00Z', opponent: 'Rovers' })
    const g1 = await log(first, { athlete: striker, action: 'goal', minute: 10, scoring: true })
    await log(first, { athlete: winger, action: 'assist', minute: 10, related: g1 })
    await log(first, { athlete: striker, action: 'goal', minute: 50, scoring: true })
    const second = await seedEvent({ date: '2026-04-01T15:00:00Z', opponent: 'United' })
    await log(second, { action: 'goal', minute: 20, scoring: true })
    await log(second, { athlete: winger, action: 'yellow_card', minute: 30 })
    // Outside the range and not completed: both ignored.
    const later = await seedEvent({ date: '2027-01-05T15:00:00Z' })
    await log(later, { athlete: striker, action: 'goal', scoring: true })
    const live = await seedEvent({ date: '2026-05-01T15:00:00Z', status: 'live' })
    await log(live, { athlete: striker, action: 'goal', scoring: true })

    const res = await get('/api/reports/season?from=2026-01-01&to=2026-12-31')
    expect(res.status).toBe(200)
    expect(res.body.summary).toMatchObject({ played: 2, wins: 1, losses: 1, goalsFor: 2, goalsAgainst: 1 })
    expect(res.body.matches.map((m) => m.opponent)).toEqual(['Rovers', 'United'])
    expect(res.body.players[0]).toMatchObject({ name: 'Sam Striker', goals: 2, appearances: 1 })
    expect(res.body.players.find((p) => p.name === 'Wes Winger')).toMatchObject({
      goals: 0, assists: 1, yellowCards: 1, appearances: 2,
    })
  })

  test('requires a valid date range', async () => {
    expect((await get('/api/reports/season')).status).toBe(400)
  })
})
