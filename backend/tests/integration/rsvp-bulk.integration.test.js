// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
//
// PUT /api/events/:id/rsvps — mark the whole squad available in one request,
// leaving out players injured on the event's date.
import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import { pool, resetDatabase, seedCoach } from './setup'
import eventsRouter from '../../src/routes/events'
import { getMatchAvailability } from '../../src/lib/availability'

const app = express()
app.use(express.json())
app.use('/api/events', eventsRouter)

let squadId
let userId
const put = (path, body, who = 'test_clerk_user') => request(app).put(path).set('x-test-clerk-user-id', who).send(body)

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
})
afterAll(async () => {
  await pool.end()
})

async function athlete(name) {
  return (await pool.query('INSERT INTO athletes (squad_id, name) VALUES ($1, $2) RETURNING id', [squadId, name])).rows[0].id
}
async function match(daysAhead = 3) {
  return (await pool.query(
    `INSERT INTO events (squad_id, title, event_type, format, event_date, status, created_by)
     VALUES ($1, 'Match', 'match', 'match', now() + ($2 || ' days')::interval, 'scheduled', $3) RETURNING id`,
    [squadId, String(daysAhead), userId]
  )).rows[0].id
}
async function injure(athleteId, { returnInDays = 10, cleared = false } = {}) {
  await pool.query(
    `INSERT INTO injuries (athlete_id, description, date_sustained, severity, return_date, cleared_at, logged_by)
     VALUES ($1, 'Hamstring', current_date - 2, 'moderate', current_date + $2::int, $3, $4)`,
    [athleteId, returnInDays, cleared ? new Date() : null, userId]
  )
}
async function statuses(eventId) {
  const r = await pool.query(
    `SELECT a.name, r.status FROM athletes a
       LEFT JOIN event_rsvps r ON r.athlete_id = a.id AND r.event_id = $1
      WHERE a.squad_id = $2 ORDER BY a.name`,
    [eventId, squadId]
  )
  return Object.fromEntries(r.rows.map((row) => [row.name, row.status]))
}

describe('PUT /api/events/:id/rsvps (mark everyone available)', () => {
  test('marks everyone available, overriding earlier answers, and sets the injured unavailable', async () => {
    await athlete('Alpha')
    const bravo = await athlete('Bravo')
    const injured = await athlete('Charlie')
    await injure(injured)
    const ev = await match()
    await pool.query(`INSERT INTO event_rsvps (event_id, athlete_id, status) VALUES ($1, $2, 'unavailable')`, [ev, bravo])
    // The injured player had answered 'available' before getting injured.
    await pool.query(`INSERT INTO event_rsvps (event_id, athlete_id, status) VALUES ($1, $2, 'available')`, [ev, injured])

    const res = await put(`/api/events/${ev}/rsvps`, { status: 'available' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ updated: 2, skippedInjured: [{ id: injured, name: 'Charlie' }] })
    expect(await statuses(ev)).toEqual({ Alpha: 'available', Bravo: 'available', Charlie: 'unavailable' })
    const note = await pool.query('SELECT note FROM event_rsvps WHERE event_id = $1 AND athlete_id = $2', [ev, injured])
    expect(note.rows[0].note).toBe('Injured')
  })

  test('includes players whose injury is cleared, or who are back by the match date', async () => {
    const cleared = await athlete('Cleared')
    const backInTime = await athlete('Back In Time')
    await injure(cleared, { cleared: true })
    await injure(backInTime, { returnInDays: 1 })
    const ev = await match(5)

    const res = await put(`/api/events/${ev}/rsvps`, { status: 'available' })
    expect(res.body).toEqual({ updated: 2, skippedInjured: [] })
  })

  test('only allows marking everyone available', async () => {
    await athlete('Alpha')
    const ev = await match()
    expect((await put(`/api/events/${ev}/rsvps`, { status: 'unavailable' })).status).toBe(400)
  })

  test("refuses another squad's event", async () => {
    const other = (await seedCoach('other_coach')).squadId
    const theirs = (await pool.query(
      `INSERT INTO events (squad_id, title, event_type, format, event_date, status)
       VALUES ($1, 'Theirs', 'match', 'match', now() + interval '1 day', 'scheduled') RETURNING id`,
      [other]
    )).rows[0].id
    expect((await put(`/api/events/${theirs}/rsvps`, { status: 'available' })).status).toBe(404)
  })

  test('an injured player cannot be marked available one at a time', async () => {
    const injured = await athlete('Charlie')
    await injure(injured)
    const ev = await match()
    const res = await put(`/api/events/${ev}/rsvps/${injured}`, { status: 'available' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/injured on the match date/)
    // Other answers are still fine.
    expect((await put(`/api/events/${ev}/rsvps/${injured}`, { status: 'unavailable' })).status).toBe(200)
  })

  test("an injured player's old 'available' answer does not count towards kickoff", async () => {
    const fit = await athlete('Fit')
    const injured = await athlete('Injured')
    await injure(injured)
    const ev = await match()
    await pool.query(
      `INSERT INTO event_rsvps (event_id, athlete_id, status) VALUES ($1, $2, 'available'), ($1, $3, 'available')`,
      [ev, fit, injured]
    )
    const availability = await getMatchAvailability(pool, { eventId: ev, squadId })
    expect(availability.available).toBe(1)
  })
})

