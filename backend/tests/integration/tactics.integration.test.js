// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import { pool, resetDatabase, seedCoach } from './setup'

import tacticsRouter from '../../src/routes/tactics'

const app = express()
app.use(express.json())
app.use('/api/tactics', tacticsRouter)

let squadId
let otherSquadId

const ME = 'test_clerk_user'
const OTHER = 'other_coach'

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

async function seedCoachWithSquad(clerkId, name) {
  const user = await pool.query(
    "INSERT INTO users (clerk_id, role) VALUES ($1, 'coach') RETURNING id",
    [clerkId]
  )
  const squad = await pool.query(
    'INSERT INTO squads (coach_id, name) VALUES ($1, $2) RETURNING id',
    [user.rows[0].id, name]
  )
  return { userId: user.rows[0].id, squadId: squad.rows[0].id }
}

async function seedTactic(squad, { name = 'Corner routine', description = null, frames = [] } = {}) {
  const result = await pool.query(
    'INSERT INTO tactics (squad_id, name, description, frames) VALUES ($1, $2, $3, $4) RETURNING *',
    [squad, name, description, JSON.stringify(frames)]
  )
  return result.rows[0]
}

beforeEach(async () => {
  await resetDatabase()
  const seeded = await seedCoach()
  squadId = seeded.squadId

  const other = await seedCoachWithSquad(OTHER, 'Other Squad')
  otherSquadId = other.squadId
})

afterAll(async () => {
  await pool.end()
})

const get = (path, clerk = ME) => request(app).get(path).set('x-test-clerk-user-id', clerk)
const post = (path, body = {}, clerk = ME) =>
  request(app).post(path).set('x-test-clerk-user-id', clerk).send(body)
const patch = (path, body = {}, clerk = ME) =>
  request(app).patch(path).set('x-test-clerk-user-id', clerk).send(body)
const del = (path, clerk = ME) => request(app).delete(path).set('x-test-clerk-user-id', clerk)

describe('Tactics API', () => {
  test("lists only the squad's own tactics, most recently updated first", async () => {
    await seedTactic(squadId, { name: 'Kick-off shape' })
    await seedTactic(squadId, { name: 'Low block' })
    await seedTactic(otherSquadId, { name: "Someone else's routine" })

    const res = await get('/api/tactics')

    expect(res.status).toBe(200)
    expect(res.body.map((t) => t.name)).toEqual(['Low block', 'Kick-off shape'])
  })

  test('returns a single tactic with its description and frames', async () => {
    const frames = [
      { name: 'Setup', players: [{ id: 4, x: 12.5, y: 30 }] },
      { name: 'Delivery', players: [{ id: 4, x: 80, y: 55 }] },
    ]
    const seeded = await seedTactic(squadId, {
      name: 'Corner routine',
      description: 'Near-post flick',
      frames,
    })

    const res = await get(`/api/tactics/${seeded.id}`)

    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Corner routine')
    expect(res.body.description).toBe('Near-post flick')
    expect(res.body.frames).toEqual(frames)
    expect(res.body.squad_id).toBe(squadId)
  })

  test("hides another squad's tactic and unknown ids behind 404", async () => {
    const theirs = await seedTactic(otherSquadId, { name: 'Theirs' })

    const foreign = await get(`/api/tactics/${theirs.id}`)
    const unknown = await get('/api/tactics/999999')

    expect(foreign.status).toBe(404)
    expect(foreign.body.error).toBe('Tactic not found')
    expect(unknown.status).toBe(404)
  })

  test('creates a tactic with a trimmed name and the given frames', async () => {
    const res = await post('/api/tactics', {
      name: '  High press  ',
      description: 'Trap on the sideline',
      frames: [{ name: 'Trigger', players: [{ id: 9, x: 62, y: 18 }] }],
    })

    expect(res.status).toBe(201)
    expect(res.body.name).toBe('High press')
    expect(res.body.description).toBe('Trap on the sideline')
    expect(res.body.frames).toEqual([{ name: 'Trigger', players: [{ id: 9, x: 62, y: 18 }] }])
    expect(res.body.squad_id).toBe(squadId)

    const list = await get('/api/tactics')
    expect(list.body.map((t) => t.name)).toContain('High press')
  })

  test('defaults frames to an empty list and requires a usable name', async () => {
    const bare = await post('/api/tactics', { name: 'Bare board' })
    expect(bare.status).toBe(201)
    expect(bare.body.frames).toEqual([])

    const missing = await post('/api/tactics', { description: 'no name' })
    expect(missing.status).toBe(400)
    expect(missing.body.error).toBe('Name is required')

    const blank = await post('/api/tactics', { name: '   ' })
    expect(blank.status).toBe(400)
    expect(blank.body.error).toBe('Name is required')
  })

  test('gives athletes the read-only view but refuses writes', async () => {
    await pool.query(
      "INSERT INTO users (clerk_id, role, squad_id) VALUES ('athlete_user', 'athlete', $1)",
      [squadId]
    )
    const seeded = await seedTactic(squadId, { name: 'Shared view' })

    const list = await get('/api/tactics', 'athlete_user')
    expect(list.status).toBe(200)
    expect(list.body.map((t) => t.name)).toEqual(['Shared view'])

    const detail = await get(`/api/tactics/${seeded.id}`, 'athlete_user')
    expect(detail.status).toBe(200)
    expect(detail.body.name).toBe('Shared view')

    const created = await post('/api/tactics', { name: 'Nope' }, 'athlete_user')
    expect(created.status).toBe(403)
    const updated = await patch(`/api/tactics/${seeded.id}`, { name: 'Nope' }, 'athlete_user')
    expect(updated.status).toBe(403)
    const removed = await del(`/api/tactics/${seeded.id}`, 'athlete_user')
    expect(removed.status).toBe(403)
  })

  test('answers 403, not 500, for an account not yet linked to a squad', async () => {
    await pool.query("INSERT INTO users (clerk_id, role) VALUES ('unlinked_user', 'athlete')")

    const res = await get('/api/tactics', 'unlinked_user')

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('This account is not yet linked to a squad')
  })

  test('updates fields selectively without touching the rest', async () => {
    const seeded = await seedTactic(squadId, {
      name: 'Original',
      description: 'Keep me',
      frames: [{ name: 'F1' }],
    })

    const renamed = await patch(`/api/tactics/${seeded.id}`, { name: 'Renamed' })
    expect(renamed.status).toBe(200)
    expect(renamed.body.name).toBe('Renamed')
    expect(renamed.body.description).toBe('Keep me')
    expect(renamed.body.frames).toEqual([{ name: 'F1' }])

    const reframed = await patch(`/api/tactics/${seeded.id}`, { frames: [{ name: 'F2' }] })
    expect(reframed.body.name).toBe('Renamed')
    expect(reframed.body.frames).toEqual([{ name: 'F2' }])

    const redescribed = await patch(`/api/tactics/${seeded.id}`, { description: 'New words' })
    expect(redescribed.body.description).toBe('New words')
    expect(redescribed.body.frames).toEqual([{ name: 'F2' }])
  })

  test('moves a tactic to the front of the list when it is updated', async () => {
    const older = await seedTactic(squadId, { name: 'Older' })
    await seedTactic(squadId, { name: 'Newer' })

    let list = await get('/api/tactics')
    expect(list.body.map((t) => t.name)).toEqual(['Newer', 'Older'])

    await patch(`/api/tactics/${older.id}`, { name: 'Refreshed' })

    list = await get('/api/tactics')
    expect(list.body.map((t) => t.name)).toEqual(['Refreshed', 'Newer'])
  })

  test("refuses to update another squad's tactic", async () => {
    const theirs = await seedTactic(otherSquadId, { name: 'Theirs' })

    const res = await patch(`/api/tactics/${theirs.id}`, { name: 'Hijack' })

    expect(res.status).toBe(404)
    const stillTheirs = await get(`/api/tactics/${theirs.id}`, OTHER)
    expect(stillTheirs.status).toBe(200)
    expect(stillTheirs.body.name).toBe('Theirs')
  })

  test('deletes a tactic and removes it from the list', async () => {
    const seeded = await seedTactic(squadId, { name: 'Disposable' })

    const res = await del(`/api/tactics/${seeded.id}`)

    expect(res.status).toBe(204)
    expect((await get(`/api/tactics/${seeded.id}`)).status).toBe(404)
    const list = await get('/api/tactics')
    expect(list.body).toHaveLength(0)
  })

  test("refuses to delete another squad's tactic", async () => {
    const theirs = await seedTactic(otherSquadId, { name: 'Theirs' })

    const res = await del(`/api/tactics/${theirs.id}`)

    expect(res.status).toBe(404)
    const theirsList = await get('/api/tactics', OTHER)
    expect(theirsList.body.map((t) => t.name)).toEqual(['Theirs'])
  })
})
