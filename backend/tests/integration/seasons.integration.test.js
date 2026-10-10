// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import { pool, resetDatabase, seedCoach } from './setup'

import seasonsRouter from '../../src/routes/seasons'

const app = express()
app.use(express.json())
app.use('/api/seasons', seasonsRouter)

let squadId
let userId

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
  // The generator schedules matches, and matches carry the same roster gate
  // as POST /api/events. 0 keeps that gate quiet unless a test raises it.
  await pool.query('UPDATE squads SET min_roster_size = 0 WHERE id = $1', [squadId])
})

afterAll(async () => {
  await pool.end()
})

// Day helpers on UTC days, matching the route's own date math. The generator
// only ever creates future events, so its dates are relative to "today".
const ymd = (d) => d.toISOString().slice(0, 10)
const dayAt = (offsetDays) => new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000)

async function createSeason({ name = 'Test Season', from = '2026-01-01', to = '2026-12-31' } = {}) {
  const r = await pool.query(
    'INSERT INTO seasons (squad_id, name, starts_on, ends_on) VALUES ($1, $2, $3, $4) RETURNING *',
    [squadId, name, from, to]
  )
  return r.rows[0]
}

async function seedEvent({ date, opponent = 'United', status = 'scheduled', seasonId = null }) {
  const r = await pool.query(
    `INSERT INTO events (squad_id, title, event_type, format, event_date, status, opponent, created_by, season_id)
     VALUES ($1, $2, 'match', 'match', $3, $4, $5, $6, $7) RETURNING *`,
    [squadId, `vs ${opponent}`, date, status, opponent, userId, seasonId]
  )
  return r.rows[0]
}

async function log(eventId, { athlete = null, action, minute = null, scoring = false }) {
  await pool.query(
    `INSERT INTO log_entries (event_id, athlete_id, action_type, is_scoring, value, minute, logged_by)
     VALUES ($1, $2, $3, $4, 1, $5, $6)`,
    [eventId, athlete, action, scoring, minute, userId]
  )
}

const get = (path) => request(app).get(path).set('x-test-clerk-user-id', 'test_clerk_user')
const post = (path, body) =>
  request(app).post(path).set('x-test-clerk-user-id', 'test_clerk_user').send(body)
const patch = (path, body) =>
  request(app).patch(path).set('x-test-clerk-user-id', 'test_clerk_user').send(body)
const del = (path) => request(app).delete(path).set('x-test-clerk-user-id', 'test_clerk_user')

describe('POST / GET /api/seasons', () => {
  test('creates a season and lists it with calendar counts', async () => {
    const created = await post('/api/seasons', { name: '2026 Season', starts_on: '2026-02-01', ends_on: '2026-11-30' })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ name: '2026 Season', starts_on: '2026-02-01', ends_on: '2026-11-30' })

    const seasonId = created.body.id
    await seedEvent({ date: `${ymd(dayAt(30))}T15:00:00`, opponent: 'Rovers', seasonId })
    await seedEvent({ date: '2026-03-01T15:00:00Z', opponent: 'United', status: 'completed', seasonId })

    const list = await get('/api/seasons')
    expect(list.status).toBe(200)
    expect(list.body).toHaveLength(1)
    expect(list.body[0]).toMatchObject({
      name: '2026 Season',
      event_count: 2,
      scheduled_count: 1,
      completed_count: 1,
    })
  })

  test('rejects invalid seasons and duplicate names', async () => {
    expect((await post('/api/seasons', { starts_on: '2026-01-01', ends_on: '2026-12-31' })).status).toBe(400)
    expect((await post('/api/seasons', { name: 'Bad', starts_on: '01-02-2026', ends_on: '2026-12-31' })).status).toBe(400)
    expect((await post('/api/seasons', { name: 'Bad', starts_on: '2026-12-31', ends_on: '2026-01-01' })).status).toBe(400)
    expect((await post('/api/seasons', { name: 'Bad', starts_on: '2020-01-01', ends_on: '2026-12-31' })).status).toBe(400)

    await createSeason({ name: 'Winter League' })
    const dup = await post('/api/seasons', { name: 'winter league', starts_on: '2026-01-01', ends_on: '2026-12-31' })
    expect(dup.status).toBe(409)
    expect(dup.body.error).toMatch(/already have a season called/)
  })

  test("renames a season and refuses another squad's season", async () => {
    const season = await createSeason()
    const renamed = await patch(`/api/seasons/${season.id}`, { name: 'Renamed', ends_on: '2026-11-30' })
    expect(renamed.status).toBe(200)
    expect(renamed.body).toMatchObject({ name: 'Renamed', ends_on: '2026-11-30', starts_on: '2026-01-01' })

    await pool.query("INSERT INTO users (clerk_id, role) VALUES ('other', 'coach')")
    const other = await pool.query(
      "INSERT INTO squads (coach_id, name) VALUES ((SELECT id FROM users WHERE clerk_id = 'other'), 'Other') RETURNING id"
    )
    await pool.query('INSERT INTO seasons (squad_id, name, starts_on, ends_on) VALUES ($1, $2, $3, $4)', [
      other.rows[0].id, 'Theirs', '2026-01-01', '2026-12-31',
    ])
    const stolen = await request(app)
      .patch('/api/seasons/2')
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ name: 'Mine now' })
    expect(stolen.status).toBe(404)
  })
})

describe('GET /api/seasons/:id', () => {
  test('totals and per-match breakdown come from matches inside the window', async () => {
    const season = await createSeason({ from: '2026-01-01', to: '2026-12-31' })
    const striker = (await pool.query(
      'INSERT INTO athletes (squad_id, name, squad_number) VALUES ($1, $2, $3) RETURNING id',
      [squadId, 'Sam Striker', 9]
    )).rows[0].id

    const first = await seedEvent({ date: '2026-03-01T15:00:00Z', opponent: 'Rovers', status: 'completed' })
    await log(first.id, { athlete: striker, action: 'goal', minute: 10, scoring: true })
    await log(first.id, { athlete: striker, action: 'goal', minute: 50, scoring: true })
    const second = await seedEvent({ date: '2026-04-01T15:00:00Z', opponent: 'United', status: 'completed' })
    await log(second.id, { action: 'goal', minute: 20, scoring: true })
    // Outside the window and not completed: both ignored.
    await seedEvent({ date: '2027-01-05T15:00:00Z', opponent: 'Rovers', status: 'completed' })
    await seedEvent({ date: '2026-05-01T15:00:00Z', opponent: 'Rovers', status: 'live' })

    const detail = await get(`/api/seasons/${season.id}`)
    expect(detail.status).toBe(200)
    expect(detail.body.season).toMatchObject({ name: 'Test Season', starts_on: '2026-01-01' })
    expect(detail.body.summary).toMatchObject({ played: 2, wins: 1, losses: 1, goalsFor: 2, goalsAgainst: 1 })
    expect(detail.body.matches.map((m) => m.opponent)).toEqual(['Rovers', 'United'])
    expect(detail.body.opponents).toHaveLength(2)
    expect(detail.body.schedule).toEqual([])
  })

  test('returns the season schedule with clash flags on scheduled matches', async () => {
    const season = await createSeason()
    const future = await seedEvent({ date: `${ymd(dayAt(30))}T15:00:00`, opponent: 'Rovers', seasonId: season.id })
    await seedEvent({ date: '2026-03-01T15:00:00Z', opponent: 'United', status: 'completed', seasonId: season.id })

    const detail = await get(`/api/seasons/${season.id}`)
    expect(detail.status).toBe(200)
    expect(detail.body.schedule.map((e) => e.id)).toEqual([expect.any(Number), future.id])
    const scheduled = detail.body.schedule.find((e) => e.id === future.id)
    expect(scheduled.clashes).toEqual([])
    expect(detail.body.schedule.find((e) => e.status === 'completed').clashes).toEqual([])

    expect((await get('/api/seasons/999')).status).toBe(404)
  })
})

describe('POST /api/seasons/:id/schedule', () => {
  test('spreads opponents across the season at the cadence', async () => {
    const base = ymd(dayAt(30))
    const season = await createSeason({ from: base, to: ymd(dayAt(120)) })

    const res = await post(`/api/seasons/${season.id}/schedule`, {
      opponents: ['Rovers', 'United', 'City'],
      first_kickoff: base,
      kickoff_time: '15:00',
      cadence_days: 7,
      duration_minutes: 120,
      location: 'Home Ground',
    })
    expect(res.status).toBe(201)
    expect(res.body.created).toHaveLength(3)
    expect(res.body.created.map((e) => e.opponent)).toEqual(['Rovers', 'United', 'City'])
    // Kickoff times are asserted as stored text — the driver hands back
    // Date objects whose JSON form shifts with the host timezone.
    const stored = await pool.query(
      'SELECT event_date::text AS event_date FROM events WHERE season_id = $1 ORDER BY event_date',
      [season.id]
    )
    expect(stored.rows.map((r) => r.event_date)).toEqual([
      `${base} 15:00:00`,
      `${ymd(dayAt(37))} 15:00:00`,
      `${ymd(dayAt(44))} 15:00:00`,
    ])
    for (const event of res.body.created) {
      expect(event).toMatchObject({
        season_id: season.id,
        format: 'match',
        status: 'scheduled',
        duration_minutes: 120,
        location: 'Home Ground',
      })
      expect(Array.isArray(event.clashes)).toBe(true)
    }
  })

  test('snaps kickoffs to the requested weekday and dedupes opponents', async () => {
    const base = dayAt(30)
    const season = await createSeason({ from: ymd(base), to: ymd(dayAt(120)) })
    const targetWeekday = (base.getUTCDay() + 2) % 7

    const res = await post(`/api/seasons/${season.id}/schedule`, {
      opponents: ['Rovers', 'rovers ', 'United'],
      first_kickoff: ymd(base),
      weekday: targetWeekday,
      cadence_days: 7,
    })
    expect(res.status).toBe(201)
    expect(res.body.created).toHaveLength(2)
    const stored = await pool.query(
      'SELECT event_date::text AS event_date FROM events WHERE season_id = $1 ORDER BY event_date',
      [season.id]
    )
    expect(stored.rows.map((r) => r.event_date)).toEqual([
      `${ymd(dayAt(32))} 10:00:00`,
      `${ymd(dayAt(39))} 10:00:00`,
    ])
  })

  test('flags clashes against the existing calendar without blocking', async () => {
    const base = ymd(dayAt(30))
    const season = await createSeason({ from: base, to: ymd(dayAt(120)) })
    await seedEvent({ date: `${base}T15:00:00`, opponent: 'County' })

    const res = await post(`/api/seasons/${season.id}/schedule`, {
      opponents: ['Rovers'],
      first_kickoff: base,
      kickoff_time: '15:30',
      cadence_days: 7,
    })
    expect(res.status).toBe(201)
    expect(res.body.created[0].clashes.length).toBeGreaterThan(0)
    expect(res.body.created[0].clashes[0].label).toBe('vs County')
  })

  test('dry run returns the plan with clash flags and inserts nothing', async () => {
    const base = ymd(dayAt(30))
    const season = await createSeason({ from: base, to: ymd(dayAt(120)) })
    await seedEvent({ date: `${base}T15:00:00`, opponent: 'County' })

    const res = await post(`/api/seasons/${season.id}/schedule`, {
      opponents: ['Rovers', 'United'],
      first_kickoff: base,
      kickoff_time: '15:30',
      dry_run: true,
    })
    expect(res.status).toBe(200)
    expect(res.body.dry_run).toBe(true)
    expect(res.body.planned).toHaveLength(2)
    expect(res.body.clash_count).toBe(1)
    expect(res.body.planned[0].clashes[0].label).toBe('vs County')
    expect(res.body.planned[1].clashes).toEqual([])

    const inserted = await pool.query('SELECT COUNT(*)::int AS n FROM events WHERE season_id = $1', [season.id])
    expect(inserted.rows[0].n).toBe(0)
  })

  test('rejects schedules that run past the season end', async () => {
    const base = ymd(dayAt(30))
    const season = await createSeason({ from: base, to: ymd(dayAt(37)) })

    const res = await post(`/api/seasons/${season.id}/schedule`, {
      opponents: ['Rovers', 'United', 'City'],
      first_kickoff: base,
      cadence_days: 7,
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Only 2 of 3 matches fit before the season ends/)
  })

  test('rejects empty lists, past kickoffs, kickoffs before the season start, and thin rosters', async () => {
    const base = ymd(dayAt(30))
    const season = await createSeason({ from: base, to: ymd(dayAt(120)) })

    expect((await post(`/api/seasons/${season.id}/schedule`, { opponents: [] })).status).toBe(400)
    expect((await post(`/api/seasons/${season.id}/schedule`, { opponents: ['  '] })).status).toBe(400)
    expect((await post(`/api/seasons/${season.id}/schedule`, {
      opponents: ['Rovers'],
      first_kickoff: ymd(dayAt(-5)),
    })).status).toBe(400)
    expect((await post(`/api/seasons/${season.id}/schedule`, {
      opponents: ['Rovers'],
      first_kickoff: ymd(dayAt(10)),
    })).status).toBe(400)
    expect((await post(`/api/seasons/${season.id}/schedule`, {
      opponents: ['Rovers'],
      cadence_days: 0,
    })).status).toBe(400)
    expect((await post(`/api/seasons/${season.id}/schedule`, {
      opponents: ['Rovers'],
      kickoff_time: '25:00',
    })).status).toBe(400)

    await pool.query('UPDATE squads SET min_roster_size = 99 WHERE id = $1', [squadId])
    const roster = await post(`/api/seasons/${season.id}/schedule`, { opponents: ['Rovers'] })
    expect(roster.status).toBe(400)
    expect(roster.body.error).toMatch(/roster needs at least 99/)
  })

  test('keeps seasons a staff-only feature', async () => {
    const athlete = await pool.query(
      "INSERT INTO users (clerk_id, role, squad_id) VALUES ('ath', 'athlete', $1) RETURNING id",
      [squadId]
    )
    expect(athlete.rows.length).toBe(1)

    expect((await request(app).get('/api/seasons').set('x-test-clerk-user-id', 'ath')).status).toBe(403)
    expect((await request(app)
      .post('/api/seasons')
      .set('x-test-clerk-user-id', 'ath')
      .send({ name: 'Nope', starts_on: '2026-01-01', ends_on: '2026-12-31' })).status).toBe(403)
  })
})

describe('DELETE /api/seasons/:id', () => {
  test('removes the season and untags its events', async () => {
    const base = ymd(dayAt(30))
    const season = await createSeason({ from: base, to: ymd(dayAt(120)) })
    await post(`/api/seasons/${season.id}/schedule`, {
      opponents: ['Rovers', 'United'],
      first_kickoff: base,
      cadence_days: 7,
    })

    const removed = await del(`/api/seasons/${season.id}`)
    expect(removed.status).toBe(200)
    expect(removed.body).toEqual({ ok: true })

    const tagged = await pool.query('SELECT COUNT(*)::int AS n FROM events WHERE season_id = $1', [season.id])
    expect(tagged.rows[0].n).toBe(0)
    const kept = await pool.query('SELECT COUNT(*)::int AS n FROM events WHERE squad_id = $1', [squadId])
    expect(kept.rows[0].n).toBe(2)
    expect((await get(`/api/seasons/${season.id}`)).status).toBe(404)
  })
})
