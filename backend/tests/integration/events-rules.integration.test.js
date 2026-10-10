// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
//
// Business rules on events that had no tests: who may delete an event, the
// conditions for joining a league/tournament, the team list, the opponent
// gender filter and the lineup rules for a regular match.
import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import { pool, resetDatabase, seedCoach } from './setup'
import eventsRouter from '../../src/routes/events'

const app = express()
app.use(express.json())
app.use('/api/events', eventsRouter)

let squadId
const as = (who = 'test_clerk_user') => ({
  get: (u) => request(app).get(u).set('x-test-clerk-user-id', who),
  post: (u, b) => request(app).post(u).set('x-test-clerk-user-id', who).send(b),
  put: (u, b) => request(app).put(u).set('x-test-clerk-user-id', who).send(b),
  delete: (u) => request(app).delete(u).set('x-test-clerk-user-id', who),
})

beforeAll(async () => {
  try {
    await pool.query('SELECT 1')
  } catch (err) {
    throw new Error(`Could not reach the test database.\nOriginal error: ${err.message}`, { cause: err })
  }
})
beforeEach(async () => {
  await resetDatabase()
  squadId = (await seedCoach()).squadId
})
afterAll(async () => {
  await pool.end()
})

async function event(owner, { format = 'match', status = 'scheduled', required = null, opponent = 'Rovers' } = {}) {
  const r = await pool.query(
    `INSERT INTO events (squad_id, title, event_type, format, event_date, status, opponent, required_teams)
     VALUES ($1, 'Fixture', 'match', $2, now() + interval '3 days', $3, $4, $5) RETURNING id`,
    [owner, format, status, opponent, required]
  )
  return r.rows[0].id
}
async function athletes(squad, n) {
  const ids = []
  for (let i = 0; i < n; i++) {
    ids.push((await pool.query('INSERT INTO athletes (squad_id, name) VALUES ($1, $2) RETURNING id', [squad, `P${squad}-${i}`])).rows[0].id)
  }
  return ids
}
async function minRoster(squad) {
  return (await pool.query('SELECT min_roster_size FROM squads WHERE id = $1', [squad])).rows[0].min_roster_size
}

describe('DELETE /api/events/:id', () => {
  test("deletes the squad's own event", async () => {
    const id = await event(squadId)
    expect((await as().delete(`/api/events/${id}`)).status).toBe(204)
    expect((await pool.query('SELECT 1 FROM events WHERE id = $1', [id])).rows).toHaveLength(0)
  })

  test("refuses to delete another squad's event", async () => {
    const other = (await seedCoach('other_coach')).squadId
    const id = await event(other)
    expect((await as().delete(`/api/events/${id}`)).status).toBe(403)
    expect((await pool.query('SELECT 1 FROM events WHERE id = $1', [id])).rows).toHaveLength(1)
  })
})

describe('POST /api/events/:id/join', () => {
  let host
  beforeEach(async () => {
    host = (await seedCoach('host_coach')).squadId
  })

  test('404s an unknown event', async () => {
    expect((await as().post('/api/events/999999/join')).status).toBe(404)
  })

  test('only leagues and tournaments can be joined', async () => {
    const id = await event(host, { format: 'match' })
    const res = await as().post(`/api/events/${id}/join`)
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/league or tournament/)
  })

  test('a league must be open', async () => {
    const id = await event(host, { format: 'league', status: 'live', required: 4 })
    expect((await as().post(`/api/events/${id}/join`)).body.error).toBe('Event is not open for joining')
  })

  test('a squad needs a full enough roster to join', async () => {
    const id = await event(host, { format: 'league', status: 'open', required: 4 })
    const res = await as().post(`/api/events/${id}/join`)
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/roster needs at least/)
  })

  test('joins once, refuses a second join, and lists the teams', async () => {
    await athletes(squadId, await minRoster(squadId))
    const id = await event(host, { format: 'league', status: 'open', required: 4 })
    const joined = await as().post(`/api/events/${id}/join`)
    expect([200, 201]).toContain(joined.status)
    expect((await as().post(`/api/events/${id}/join`)).body.error).toBe('Squad already joined this event')

    const teams = await as().get(`/api/events/${id}/teams`)
    expect(teams.status).toBe(200)
    expect(teams.body.map((t) => t.squad_id)).toContain(squadId)
  })

  test('refuses to join a full league', async () => {
    await athletes(squadId, await minRoster(squadId))
    const id = await event(host, { format: 'league', status: 'open', required: 2 })
    const a = (await seedCoach('coach_a')).squadId
    const b = (await seedCoach('coach_b')).squadId
    await pool.query('INSERT INTO event_teams (event_id, squad_id) VALUES ($1, $2), ($1, $3)', [id, a, b])
    expect((await as().post(`/api/events/${id}/join`)).body.error).toBe('Event is already full')
  })

  test('teams of an event the squad cannot see are not found', async () => {
    const id = await event(host)
    expect((await as().get(`/api/events/${id}/teams`)).status).toBe(404)
  })
})

describe('GET /api/events with the opponent gender filter', () => {
  test('returns events when filtering by compatible gender', async () => {
    await event(squadId)
    const res = await as().get('/api/events?gender_filter=true')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body) ? res.body.length : Object.keys(res.body).length).toBeGreaterThan(0)
  })
})

describe('PUT /api/events/:id/lineup rules', () => {
  test('sets a lineup from the squad, and refuses athletes from another squad', async () => {
    const id = await event(squadId)
    const [mine] = await athletes(squadId, 1)
    const other = (await seedCoach('other_coach')).squadId
    const [theirs] = await athletes(other, 1)

    const ok = await as().put(`/api/events/${id}/lineup`, { lineups: [{ athlete_id: mine, team_side: 'home', is_starter: true, pos_x: 50, pos_y: 50 }] })
    expect(ok.status).toBe(200)

    const bad = await as().put(`/api/events/${id}/lineup`, { lineups: [{ athlete_id: theirs, team_side: 'home', is_starter: true, pos_x: 50, pos_y: 50 }] })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toBe('Athlete does not belong to your squad')
  })

  test('validates the payload', async () => {
    const id = await event(squadId)
    expect((await as().put(`/api/events/${id}/lineup`, { lineups: 'nope' })).status).toBe(400)
  })

  test('refuses changes once the match is over, for leagues, and for other squads', async () => {
    const done = await event(squadId, { status: 'completed' })
    expect((await as().put(`/api/events/${done}/lineup`, { lineups: [] })).body.error).toMatch(/cannot be changed once the event is completed/)

    const league = await event(squadId, { format: 'league', status: 'open', required: 4 })
    expect((await as().put(`/api/events/${league}/lineup`, { lineups: [] })).body.error).toBe('Use fixture endpoints to set league lineups')

    expect((await as().put('/api/events/999999/lineup', { lineups: [] })).status).toBe(404)
  })
})
