// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
//
// Integration tests for routes that previously had none: the drill library
// (/api/sessions), the tactics board (/api/tactics), athlete comparison
// (/api/compare/athletes) and the dashboard summary (/api/dashboard/summary).
import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import { pool, resetDatabase, seedCoach } from './setup'

import sessionsRouter from '../../src/routes/sessions'
import tacticsRouter from '../../src/routes/tactics'
import compareRouter from '../../src/routes/compare'
import dashboardRouter from '../../src/routes/dashboard'

const app = express()
app.use(express.json())
app.use('/api/sessions', sessionsRouter)
app.use('/api/tactics', tacticsRouter)
app.use('/api/compare', compareRouter)
app.use('/api/dashboard', dashboardRouter)

const COACH = 'test_clerk_user'
let squadId
let userId

const as = (clerkId = COACH) => ({
  get: (url) => request(app).get(url).set('x-test-clerk-user-id', clerkId),
  post: (url, body) => request(app).post(url).set('x-test-clerk-user-id', clerkId).send(body),
  patch: (url, body) => request(app).patch(url).set('x-test-clerk-user-id', clerkId).send(body),
  delete: (url) => request(app).delete(url).set('x-test-clerk-user-id', clerkId),
})

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
})

afterAll(async () => {
  await pool.end()
})

// A second, unrelated coach, to prove squads can't see each other's data.
async function seedOtherCoach() {
  return seedCoach('other_coach')
}

async function addAthlete(name, extra = {}) {
  const r = await pool.query(
    `INSERT INTO athletes (squad_id, name, squad_number, position, height_cm, weight_kg)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [squadId, name, extra.number ?? null, extra.position ?? null, extra.height ?? null, extra.weight ?? null]
  )
  return r.rows[0].id
}

describe('drill library (/api/sessions)', () => {
  const drill = {
    name: 'Rondo 4v2',
    description: 'Keep the ball under pressure',
    tactical_goal: 'possession',
    age_group: 'U19',
    duration_minutes: 15,
    equipment: 'Cones, bibs',
    instructions: 'Two touches maximum',
    phase: 'Warm-up',
  }

  test('creates, lists, updates and deletes a drill', async () => {
    const created = await as().post('/api/sessions', drill)
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ name: 'Rondo 4v2', tactical_goal: 'possession' })

    const list = await as().get('/api/sessions')
    expect(list.status).toBe(200)
    expect(list.body).toHaveLength(1)

    const updated = await as().patch(`/api/sessions/${created.body.id}`, { duration_minutes: 20 })
    expect(updated.status).toBe(200)
    // Fields left out of the PATCH keep their values.
    expect(updated.body).toMatchObject({ duration_minutes: 20, name: 'Rondo 4v2' })

    const removed = await as().delete(`/api/sessions/${created.body.id}`)
    expect([200, 204]).toContain(removed.status)
    expect((await as().get('/api/sessions')).body).toHaveLength(0)
  })

  test('filters by goal, age group, maximum duration and phase', async () => {
    await as().post('/api/sessions', drill)
    await as().post('/api/sessions', {
      ...drill, name: 'Long shooting', tactical_goal: 'finishing', age_group: 'First Team',
      duration_minutes: 40, phase: 'Main Activity',
    })

    const names = async (query) => (await as().get(`/api/sessions?${query}`)).body.map((d) => d.name)
    expect(await names('tactical_goal=finishing')).toEqual(['Long shooting'])
    expect(await names('age_group=U19')).toEqual(['Rondo 4v2'])
    expect(await names('max_duration=20')).toEqual(['Rondo 4v2'])
    expect(await names('phase=Main%20Activity')).toEqual(['Long shooting'])
  })

  test('requires a name and a tactical goal', async () => {
    expect((await as().post('/api/sessions', { ...drill, name: '' })).status).toBe(400)
    expect((await as().post('/api/sessions', { ...drill, tactical_goal: undefined })).status).toBe(400)
  })

  test("returns 404 for another squad's drill", async () => {
    const created = await as().post('/api/sessions', drill)
    await seedOtherCoach()
    expect((await as('other_coach').patch(`/api/sessions/${created.body.id}`, { name: 'x' })).status).toBe(404)
    expect((await as('other_coach').delete(`/api/sessions/${created.body.id}`)).status).toBe(404)
    expect((await as('other_coach').get('/api/sessions')).body).toHaveLength(0)
  })

  test("a brand-new account gets its own empty library, never another squad's drills", async () => {
    await as().post('/api/sessions', drill)
    const res = await as('brand_new_user').get('/api/sessions')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})

describe('tactics board (/api/tactics)', () => {
  const frames = [{ players: [{ id: 1, x: 10, y: 20 }], ball: { x: 50, y: 50 } }]

  test('creates, reads, lists, updates and deletes a tactic', async () => {
    const created = await as().post('/api/tactics', { name: 'High press', description: 'Win it back fast', frames })
    expect(created.status).toBe(201)
    expect(created.body.frames).toEqual(frames)

    const one = await as().get(`/api/tactics/${created.body.id}`)
    expect(one.status).toBe(200)
    expect(one.body.name).toBe('High press')

    expect((await as().get('/api/tactics')).body).toHaveLength(1)

    const updated = await as().patch(`/api/tactics/${created.body.id}`, { name: 'Mid block' })
    expect(updated.status).toBe(200)
    expect(updated.body.name).toBe('Mid block')

    const removed = await as().delete(`/api/tactics/${created.body.id}`)
    expect([200, 204]).toContain(removed.status)
    expect((await as().get(`/api/tactics/${created.body.id}`)).status).toBe(404)
  })

  test('requires a name', async () => {
    expect((await as().post('/api/tactics', { frames })).status).toBe(400)
  })

  test("never exposes another squad's tactic", async () => {
    const created = await as().post('/api/tactics', { name: 'Secret', frames })
    await seedOtherCoach()
    const other = as('other_coach')
    expect((await other.get(`/api/tactics/${created.body.id}`)).status).toBe(404)
    expect((await other.patch(`/api/tactics/${created.body.id}`, { name: 'x' })).status).toBe(404)
    expect((await other.delete(`/api/tactics/${created.body.id}`)).status).toBe(404)
    expect((await other.get('/api/tactics')).body).toHaveLength(0)
  })
})

describe('athlete comparison (/api/compare/athletes)', () => {
  test('compares two athletes side by side with stats from the log', async () => {
    const a = await addAthlete('Sam Striker', { number: 9, position: 'Forward', height: 180, weight: 75 })
    const b = await addAthlete('Dan Defender', { number: 4, position: 'Defender', height: 190, weight: 85 })
    const ev = await pool.query(
      `INSERT INTO events (squad_id, title, event_type, format, event_date, status, opponent)
       VALUES ($1, 'vs Rovers', 'match', 'match', now() - interval '1 day', 'completed', 'Rovers') RETURNING id`,
      [squadId]
    )
    await pool.query(
      `INSERT INTO log_entries (event_id, athlete_id, action_type, is_scoring, value, logged_by)
       VALUES ($1, $2, 'goal', true, 1, $3), ($1, $2, 'goal', true, 1, $3), ($1, $4, 'yellow_card', false, 1, $3)`,
      [ev.rows[0].id, a, userId, b]
    )

    const res = await as().get(`/api/compare/athletes?a=${a}&b=${b}`)
    expect(res.status).toBe(200)
    const body = JSON.stringify(res.body)
    expect(body).toContain('Sam Striker')
    expect(body).toContain('Dan Defender')
  })

  test('validates the two ids', async () => {
    const a = await addAthlete('Solo')
    expect((await as().get('/api/compare/athletes')).status).toBe(400)
    expect((await as().get(`/api/compare/athletes?a=${a}&b=${a}`)).status).toBe(400)
    expect((await as().get(`/api/compare/athletes?a=${a}&b=999999`)).status).toBe(404)
  })
})

describe('dashboard summary (/api/dashboard/summary)', () => {
  async function seedSeason() {
    const a = await addAthlete('Sam Striker', { number: 9 })
    const b = await addAthlete('Wes Winger', { number: 7 })
    const past = await pool.query(
      `INSERT INTO events (squad_id, title, event_type, format, event_date, status, opponent)
       VALUES ($1, 'vs Rovers', 'match', 'match', now() - interval '3 days', 'completed', 'Rovers'),
              ($1, 'vs United', 'match', 'match', now() - interval '20 days', 'completed', 'United')
       RETURNING id`,
      [squadId]
    )
    const [recent, older] = past.rows.map((r) => r.id)
    await pool.query(
      `INSERT INTO log_entries (event_id, athlete_id, action_type, is_scoring, value, logged_by) VALUES
         ($1, $2, 'goal', true, 1, $4), ($1, $3, 'assist', false, 1, $4), ($1, NULL, 'goal', true, 1, $4),
         ($5, $2, 'goal', true, 1, $4), ($5, $3, 'yellow_card', false, 1, $4)`,
      [recent, a, b, userId, older]
    )
    await pool.query(
      `INSERT INTO events (squad_id, title, event_type, format, event_date, status, opponent)
       VALUES ($1, 'vs City', 'match', 'match', now() + interval '2 days', 'scheduled', 'City')`,
      [squadId]
    )
  }

  test.each(['7d', '30d', 'season', 'not-a-period'])('returns a summary for period %s', async (period) => {
    await seedSeason()
    const res = await as().get(`/api/dashboard/summary?period=${period}`)
    expect(res.status).toBe(200)
    expect(res.body).toBeTypeOf('object')
  })

  test('works for a brand-new squad with no data', async () => {
    const res = await as().get('/api/dashboard/summary')
    expect(res.status).toBe(200)
  })
})
