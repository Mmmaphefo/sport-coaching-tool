// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import { pool, resetDatabase, seedCoach } from './setup'

import friendliesRouter from '../../src/routes/friendlies'

const app = express()
app.use(express.json())
app.use('/api/friendlies', friendliesRouter)

let squadId
let userId
let otherSquadId
let otherUserId

const ME = 'test_clerk_user'
const OTHER = 'other_coach'
const THIRD = 'third_coach'

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

async function seedSquad(clerkId, name, { isPublic = true } = {}) {
  const user = await pool.query(
    'INSERT INTO users (clerk_id, role) VALUES ($1, $2) RETURNING id',
    [clerkId, 'coach']
  )
  const squad = await pool.query(
    'INSERT INTO squads (coach_id, name, is_public) VALUES ($1, $2, $3) RETURNING id',
    [user.rows[0].id, name, isPublic]
  )
  return { userId: user.rows[0].id, squadId: squad.rows[0].id }
}

beforeEach(async () => {
  await resetDatabase()
  const seeded = await seedCoach()
  squadId = seeded.squadId
  userId = seeded.userId
  // Matches carry the same roster gate as POST /api/events. 0 keeps that
  // gate quiet unless a test raises it.
  await pool.query('UPDATE squads SET min_roster_size = 0 WHERE id = $1', [squadId])

  const other = await seedSquad(OTHER, 'Rovers FC')
  otherSquadId = other.squadId
  otherUserId = other.userId
  await pool.query('UPDATE squads SET min_roster_size = 0 WHERE id = $1', [otherSquadId])
})

afterAll(async () => {
  await pool.end()
})

const get = (path, clerk = ME) => request(app).get(path).set('x-test-clerk-user-id', clerk)
const post = (path, body = {}, clerk = ME) =>
  request(app).post(path).set('x-test-clerk-user-id', clerk).send(body)

// Kickoff helpers on UTC days — the route's own date math is relative to
// "today", and proposals must always land in the future.
const ymd = (d) => d.toISOString().slice(0, 10)
const dayAt = (offsetDays) => new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000)

async function propose(overrides = {}, clerk = ME) {
  return post(
    '/api/friendlies',
    { opposing_squad_id: otherSquadId, event_date: ymd(dayAt(7)), event_time: '15:00', ...overrides },
    clerk
  )
}

describe('POST /api/friendlies (propose)', () => {
  test('proposes a friendly to a public squad and lists it from both sides', async () => {
    const created = await propose({ location: 'Riverside Park', message: 'Looking for a warm-up game' })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      status: 'proposed',
      direction: 'outgoing',
      proposing_squad_id: squadId,
      opposing_squad_id: otherSquadId,
    })
    expect(created.body.location).toBe('Riverside Park')

    const mine = await get('/api/friendlies')
    expect(mine.status).toBe(200)
    expect(mine.body).toHaveLength(1)
    expect(mine.body[0]).toMatchObject({ direction: 'outgoing', opposing_squad: 'Rovers FC' })

    const theirs = await get('/api/friendlies', OTHER)
    expect(theirs.body).toHaveLength(1)
    expect(theirs.body[0]).toMatchObject({
      direction: 'incoming',
      proposing_squad: 'Test Squad',
      opposing_squad: 'Rovers FC',
    })
  })

  test('rejects unknown, private and own squads, and bad dates', async () => {
    expect((await propose({ opposing_squad_id: 9999 })).status).toBe(404)

    const privateSquad = await seedSquad(THIRD, 'Hidden FC', { isPublic: false })
    const privateAttempt = await propose({ opposing_squad_id: privateSquad.squadId })
    expect(privateAttempt.status).toBe(400)
    expect(privateAttempt.body.error).toMatch(/not listed publicly/)

    expect((await propose({ opposing_squad_id: squadId })).status).toBe(400)
    expect((await propose({ event_date: undefined })).status).toBe(400)
    expect((await propose({ event_date: 'not-a-date' })).status).toBe(400)
    expect((await propose({ event_date: ymd(dayAt(-2)) })).status).toBe(400)
    expect((await propose({ event_date: ymd(dayAt(95)) })).status).toBe(400)
  })

  test('keeps one open proposal between the two squads, either direction', async () => {
    expect((await propose()).status).toBe(201)
    const again = await propose()
    expect(again.status).toBe(409)
    expect(again.body.error).toMatch(/already an open proposal/)

    // Their proposal back counts as the same open pair — my squad has to
    // list itself publicly for them to be able to send one at all.
    await pool.query('UPDATE squads SET is_public = true WHERE id = $1', [squadId])
    const reverse = await propose({ opposing_squad_id: squadId }, OTHER)
    expect(reverse.status).toBe(409)
  })

  test('enforces the roster minimum, like scheduling a match', async () => {
    await pool.query('UPDATE squads SET min_roster_size = 1 WHERE id = $1', [squadId])
    const attempt = await propose()
    expect(attempt.status).toBe(400)
    expect(attempt.body.error).toMatch(/roster needs at least 1 athletes/)
  })

  test('players cannot propose friendlies', async () => {
    await pool.query(
      "INSERT INTO users (clerk_id, role, squad_id) VALUES ('athlete_user', 'athlete', $1)",
      [squadId]
    )
    const attempt = await propose({}, 'athlete_user')
    expect(attempt.status).toBe(403)
  })
})

describe('POST /api/friendlies/:id/accept', () => {
  test('creates the same match on both calendars in one transaction', async () => {
    const created = await propose({ location: 'Riverside Park' })

    const accepted = await post(`/api/friendlies/${created.body.id}/accept`, {}, OTHER)
    expect(accepted.status).toBe(200)
    expect(accepted.body).toMatchObject({ status: 'accepted', direction: 'incoming' })
    expect(accepted.body.event_id).toBe(accepted.body.opposing_event.id)
    expect(accepted.body.proposing_event.id).toBeGreaterThan(0)
    expect(Array.isArray(accepted.body.proposing_event.clashes)).toBe(true)
    expect(Array.isArray(accepted.body.opposing_event.clashes)).toBe(true)

    const events = await pool.query(
      'SELECT id, squad_id, title, opponent, event_type, format, status, location, created_by, event_date FROM events ORDER BY id'
    )
    expect(events.rows).toHaveLength(2)
    const mine = events.rows.find((e) => e.squad_id === squadId)
    const theirs = events.rows.find((e) => e.squad_id === otherSquadId)
    expect(mine).toMatchObject({
      title: 'Friendly vs Rovers FC',
      opponent: 'Rovers FC',
      event_type: 'match',
      format: 'match',
      status: 'scheduled',
      location: 'Riverside Park',
      created_by: userId,
    })
    expect(theirs).toMatchObject({
      title: 'Friendly vs Test Squad',
      opponent: 'Test Squad',
      status: 'scheduled',
      created_by: otherUserId,
    })
    expect(new Date(mine.event_date).getTime()).toBe(new Date(theirs.event_date).getTime())

    const row = (await pool.query('SELECT * FROM friendlies')).rows[0]
    expect(row.status).toBe('accepted')
    expect(row.decided_at).not.toBeNull()
    expect(row.proposing_event_id).toBe(mine.id)
    expect(row.opposing_event_id).toBe(theirs.id)
  })

  test('flags clashes on both calendars without blocking', async () => {
    // My squad already has something booked at the proposed slot.
    await pool.query(
      `INSERT INTO events (squad_id, title, event_type, format, event_date, status, created_by)
       VALUES ($1, 'League fixture', 'match', 'match', $2, 'scheduled', $3)`,
      [squadId, `${ymd(dayAt(7))}T15:00:00`, userId]
    )
    const created = await propose()

    const accepted = await post(`/api/friendlies/${created.body.id}/accept`, {}, OTHER)
    expect(accepted.status).toBe(200)
    expect(accepted.body.proposing_event.clashes.length).toBe(1)
    expect(accepted.body.proposing_event.clashes[0].label).toContain('League fixture')
    expect(accepted.body.opposing_event.clashes).toHaveLength(0)
  })

  test('only the challenged squad can accept, and only while open', async () => {
    const created = await propose()

    // The proposer cannot accept their own proposal.
    expect((await post(`/api/friendlies/${created.body.id}/accept`)).status).toBe(403)

    // An unrelated squad does not even see it.
    const third = await seedSquad(THIRD, 'County FC')
    expect((await post(`/api/friendlies/${created.body.id}/accept`, {}, THIRD)).status).toBe(404)

    // Declined proposals cannot be accepted afterwards.
    await post(`/api/friendlies/${created.body.id}/decline`, { reason: 'Fully booked' }, OTHER)
    const late = await post(`/api/friendlies/${created.body.id}/accept`, {}, OTHER)
    expect(late.status).toBe(409)
    expect(late.body.error).toMatch(/already been declined/)
    expect(third.squadId).toBeGreaterThan(0)
  })

  test('refuses a kickoff that has already passed, and enforces the roster minimum', async () => {
    // POST blocks past dates, so seed the stale proposal directly.
    const stale = await pool.query(
      `INSERT INTO friendlies (proposing_squad_id, opposing_squad_id, event_date)
       VALUES ($1, $2, $3) RETURNING id`,
      [squadId, otherSquadId, `${ymd(dayAt(-2))}T15:00:00`]
    )
    const lateAccept = await post(`/api/friendlies/${stale.rows[0].id}/accept`, {}, OTHER)
    expect(lateAccept.status).toBe(400)
    expect(lateAccept.body.error).toMatch(/already passed/)

    // Clear the stale pair so the fresh proposal below isn't taken for a
    // duplicate of it.
    await pool.query('DELETE FROM friendlies WHERE id = $1', [stale.rows[0].id])
    await pool.query('UPDATE squads SET min_roster_size = 1 WHERE id = $1', [otherSquadId])
    const created = await propose()
    const gated = await post(`/api/friendlies/${created.body.id}/accept`, {}, OTHER)
    expect(gated.status).toBe(400)
    expect(gated.body.error).toMatch(/roster needs at least 1 athletes/)
  })
})

describe('POST /api/friendlies/:id/decline and /:id/cancel', () => {
  test('declining records a reason the proposer sees', async () => {
    const created = await propose()
    const declined = await post(
      `/api/friendlies/${created.body.id}/decline`,
      { reason: 'Injury crisis that week' },
      OTHER
    )
    expect(declined.status).toBe(200)
    expect(declined.body).toMatchObject({ status: 'declined', direction: 'incoming' })

    const mine = await get('/api/friendlies')
    expect(mine.body[0].decline_reason).toBe('Injury crisis that week')

    // No match events were created.
    const events = await pool.query('SELECT COUNT(*)::int AS n FROM events')
    expect(events.rows[0].n).toBe(0)
  })

  test('the challenged squad cannot cancel, and the proposer cannot decline', async () => {
    const created = await propose()
    expect((await post(`/api/friendlies/${created.body.id}/cancel`, {}, OTHER)).status).toBe(403)
    expect((await post(`/api/friendlies/${created.body.id}/decline`)).status).toBe(403)
  })

  test('cancelling withdraws an open proposal', async () => {
    const created = await propose()
    const cancelled = await post(`/api/friendlies/${created.body.id}/cancel`)
    expect(cancelled.status).toBe(200)
    expect(cancelled.body).toMatchObject({ status: 'cancelled', direction: 'outgoing' })

    const lateAccept = await post(`/api/friendlies/${created.body.id}/accept`, {}, OTHER)
    expect(lateAccept.status).toBe(409)
    expect(lateAccept.body.error).toMatch(/already been cancelled/)
  })
})
