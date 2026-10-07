import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import { pool, resetDatabase, seedCoach } from './setup'

import athletesRouter from '../../src/routes/athletes'
import eventsRouter from '../../src/routes/events'

const app = express()
app.use(express.json())
app.use('/api/athletes', athletesRouter)
app.use('/api/events', eventsRouter)

let squadId

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
})

afterAll(async () => {
  await pool.end()
})

describe('US3 — add athletes to the roster', () => {
  test('AC: a submitted add-athlete form results in the athlete appearing on the roster', async () => {
    const createRes = await request(app)
      .post('/api/athletes')
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ name: 'Amahle Dlamini', position: 'Midfielder', squad_number: 8 })

    expect(createRes.status).toBe(201)
    expect(createRes.body.name).toBe('Amahle Dlamini')

    const listRes = await request(app)
      .get('/api/athletes')
      .set('x-test-clerk-user-id', 'test_clerk_user')

    expect(listRes.status).toBe(200)
    expect(listRes.body).toHaveLength(1)
    expect(listRes.body[0].name).toBe('Amahle Dlamini')
  })

  test('AC: an empty roster returns an empty list (drives the empty-state prompt on the frontend)', async () => {
    const res = await request(app)
      .get('/api/athletes')
      .set('x-test-clerk-user-id', 'test_clerk_user')

    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  test('rejects an add-athlete submission with no name (required-field validation)', async () => {
    const res = await request(app)
      .post('/api/athletes')
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ position: 'Winger' })

    expect(res.status).toBe(400)
  })
})

describe('US4 — edit or remove an athlete', () => {
  let athleteId

  beforeEach(async () => {
    const inserted = await pool.query(
      `INSERT INTO athletes (squad_id, name, position) VALUES ($1, 'Sipho Nkosi', 'Defender') RETURNING id`,
      [squadId]
    )
    athleteId = inserted.rows[0].id
  })

  test('AC: an edit by the owning coach is reflected immediately', async () => {
    const res = await request(app)
      .patch(`/api/athletes/${athleteId}`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ position: 'Centre-back' })

    expect(res.status).toBe(200)
    expect(res.body.position).toBe('Centre-back')

    const stored = await pool.query('SELECT position FROM athletes WHERE id = $1', [athleteId])
    expect(stored.rows[0].position).toBe('Centre-back')
  })

  test('AC: a coach who does not own the squad is denied with an access error on edit', async () => {
    const res = await request(app)
      .patch(`/api/athletes/${athleteId}`)
      .set('x-test-clerk-user-id', 'a_different_coach')
      .send({ position: 'Striker' })

    expect(res.status).toBe(403)

    const stored = await pool.query('SELECT position FROM athletes WHERE id = $1', [athleteId])
    expect(stored.rows[0].position).toBe('Defender')
  })

  test('AC: a coach who does not own the squad is denied with an access error on delete', async () => {
    const res = await request(app)
      .delete(`/api/athletes/${athleteId}`)
      .set('x-test-clerk-user-id', 'a_different_coach')

    expect(res.status).toBe(403)

    const stillThere = await pool.query('SELECT id FROM athletes WHERE id = $1', [athleteId])
    expect(stillThere.rows).toHaveLength(1)
  })

  test('the owning coach can remove an athlete', async () => {
    const res = await request(app)
      .delete(`/api/athletes/${athleteId}`)
      .set('x-test-clerk-user-id', 'test_clerk_user')

    expect(res.status).toBe(204)

    const stillThere = await pool.query('SELECT id FROM athletes WHERE id = $1', [athleteId])
    expect(stillThere.rows).toHaveLength(0)
  })

  test('AC: the owning coach can attach a profile photo and it is returned by the roster list', async () => {
    const photo = 'data:image/jpeg;base64,ZmFrZQ=='

    const res = await request(app)
      .patch(`/api/athletes/${athleteId}`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ photo })

    expect(res.status).toBe(200)
    expect(res.body.photo).toBe(photo)

    const listRes = await request(app)
      .get('/api/athletes')
      .set('x-test-clerk-user-id', 'test_clerk_user')

    expect(listRes.status).toBe(200)
    expect(listRes.body[0].photo).toBe(photo)
  })

  test('rejects a photo that is not a base64 image data URL', async () => {
    const res = await request(app)
      .patch(`/api/athletes/${athleteId}`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ photo: 'https://example.com/face.jpg' })

    expect(res.status).toBe(400)

    const stored = await pool.query('SELECT photo FROM athletes WHERE id = $1', [athleteId])
    expect(stored.rows[0].photo).toBeNull()
  })

  test('an explicit null clears the stored photo', async () => {
    await pool.query(
      "UPDATE athletes SET photo = 'data:image/jpeg;base64,ZmFrZQ==' WHERE id = $1",
      [athleteId]
    )

    const res = await request(app)
      .patch(`/api/athletes/${athleteId}`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ photo: null })

    expect(res.status).toBe(200)
    expect(res.body.photo).toBeNull()
  })
})

describe('US5 — create a match or training event', () => {
  test('AC: a submitted event form with date/time/location/type creates a new event on the calendar', async () => {
    const res = await request(app)
      .post('/api/events')
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({
        title: 'Tuesday Training',
        type: 'training',
        format: 'training',
        event_date: '2026-12-01',
        event_time: '17:00',
        location: 'Wits Main Oval',
      })

    if (res.status !== 201) {
      console.log('Error response:', res.body)
    }

    expect(res.status).toBe(201)
    expect(res.body.title).toBe('Tuesday Training')
    expect(res.body.event_type).toBe('training')
    expect(res.body.location).toBe('Wits Main Oval')

    const listRes = await request(app)
      .get('/api/events')
      .set('x-test-clerk-user-id', 'test_clerk_user')

    expect(listRes.body).toHaveLength(1)
  })

  test('AC: submitting with no event_date shows a validation error and creates nothing', async () => {
    const res = await request(app)
      .post('/api/events')
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ title: 'Missing date event', type: 'training' })

    expect(res.status).toBe(400)

    const listRes = await request(app)
      .get('/api/events')
      .set('x-test-clerk-user-id', 'test_clerk_user')

    expect(listRes.body).toHaveLength(0)
  })
})

describe('US6 — edit or cancel an event', () => {
  let eventId

  beforeEach(async () => {
    const inserted = await pool.query(
      `INSERT INTO events (squad_id, title, event_type, event_date, created_by)
       VALUES ($1, 'Saturday Match', 'match', '2027-08-22T10:00:00Z',
         (SELECT id FROM users WHERE clerk_id = 'test_clerk_user'))
       RETURNING id`,
      [squadId]
    )
    eventId = inserted.rows[0].id
  })

  test('AC: changing an event time is reflected for the squad', async () => {
    const before = await pool.query('SELECT event_date FROM events WHERE id = $1', [eventId])

    const res = await request(app)
      .patch(`/api/events/${eventId}`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ event_date: '2027-08-22', event_time: '14:00' })

    expect(res.status).toBe(200)

    const after = await pool.query('SELECT event_date FROM events WHERE id = $1', [eventId])
    // Comparing timestamps rather than a specific hour, since "timestamp
    // without time zone" columns get parsed relative to the test runner's
    // local timezone — asserting an exact hour would be flaky across machines.
    expect(new Date(after.rows[0].event_date).getTime()).not.toBe(
      new Date(before.rows[0].event_date).getTime()
    )
  })

  test('AC: cancelling an event marks it Cancelled', async () => {
    const res = await request(app)
      .patch(`/api/events/${eventId}/cancel`)
      .set('x-test-clerk-user-id', 'test_clerk_user')

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('cancelled')

    const stored = await pool.query('SELECT status FROM events WHERE id = $1', [eventId])
    expect(stored.rows[0].status).toBe('cancelled')
  })

  test('a coach who does not own the squad cannot cancel the event', async () => {
    const res = await request(app)
      .patch(`/api/events/${eventId}/cancel`)
      .set('x-test-clerk-user-id', 'a_different_coach')

    expect(res.status).toBe(403)

    const stored = await pool.query('SELECT status FROM events WHERE id = $1', [eventId])
    expect(stored.rows[0].status).not.toBe('cancelled')
  })
})
