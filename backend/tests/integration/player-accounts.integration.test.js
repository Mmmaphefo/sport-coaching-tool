import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import { pool, resetDatabase, seedCoach } from './setup'

import athletesRouter from '../../src/routes/athletes'
import eventsRouter from '../../src/routes/events'
import invitesRouter from '../../src/routes/invites'
import injuriesRouter from '../../src/routes/injuries'

const app = express()
app.use(express.json())
app.use('/api/athletes', athletesRouter)
app.use('/api/events', eventsRouter)
app.use('/api/invites', invitesRouter)
app.use('/api/injuries', injuriesRouter)

let squadId

beforeAll(async () => {
  process.env.FRONTEND_URL = 'http://localhost:5173'

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

// Creates a roster athlete and links a signed-in player account to them by
// accepting the invite — the state a player is in after they've joined.
async function seedJoinedPlayer(clerkId, email, athleteName = 'Marcus Hale') {
  const created = await request(app)
    .post('/api/athletes')
    .send({ name: athleteName, email })
  expect(created.status).toBe(201)

  const token = created.body.invite.inviteLink.split('/invite/')[1]
  const accepted = await request(app)
    .post(`/api/invites/${token}/accept`)
    .set('x-test-clerk-user-id', clerkId)
    .set('x-test-invite-email', email)
  expect(accepted.status).toBe(200)

  return { athleteId: created.body.id, inviteToken: token }
}

describe('Player accounts — account_status transitions', () => {
  test('none → invited → joined as the invite is created and accepted', async () => {
    // No email: no account, no invite.
    const plain = await request(app).post('/api/athletes').send({ name: 'Plain Player' })
    expect(plain.status).toBe(201)
    expect(plain.body.invite).toBeNull()

    const before = await request(app).get('/api/athletes')
    expect(before.body.find((a) => a.id === plain.body.id).account_status).toBe('none')

    // With an email: account pre-created + invite pending.
    const created = await request(app)
      .post('/api/athletes')
      .send({ name: 'Marcus Hale', email: 'player1@example.com' })
    expect(created.status).toBe(201)
    const athleteId = created.body.id

    const mid = await request(app).get('/api/athletes')
    const invitedRow = mid.body.find((a) => a.id === athleteId)
    expect(invitedRow.account_status).toBe('invited')
    expect(invitedRow.invite_email).toBe('player1@example.com')

    // After accepting: linked and joined.
    const token = created.body.invite.inviteLink.split('/invite/')[1]
    const accepted = await request(app)
      .post(`/api/invites/${token}/accept`)
      .set('x-test-clerk-user-id', 'player_clerk_1')
      .set('x-test-invite-email', 'player1@example.com')
    expect(accepted.status).toBe(200)
    expect(accepted.body.role).toBe('athlete')
    expect(accepted.body.athleteId).toBe(athleteId)

    const after = await request(app).get('/api/athletes')
    const row = after.body.find((a) => a.id === athleteId)
    expect(row.account_status).toBe('joined')
    expect(row.invite_email).toBe('player1@example.com')
  })

  test('a re-invite with a different email supersedes the older pending invite', async () => {
    const created = await request(app)
      .post('/api/athletes')
      .send({ name: 'Swap Email', email: 'old@example.com' })
    expect(created.status).toBe(201)
    const athleteId = created.body.id

    const reinvite = await request(app)
      .post(`/api/athletes/${athleteId}/invite`)
      .send({ email: 'new@example.com' })
    expect(reinvite.status).toBe(201)

    // Only the latest invite counts for the card.
    const statuses = await pool.query(
      'SELECT email, status FROM invites WHERE athlete_id = $1 ORDER BY id',
      [athleteId]
    )
    expect(statuses.rows.map((r) => [r.email, r.status])).toEqual([
      ['old@example.com', 'cancelled'],
      ['new@example.com', 'pending'],
    ])

    const list = await request(app).get('/api/athletes')
    const row = list.body.find((a) => a.id === athleteId)
    expect(row.account_status).toBe('invited')
    expect(row.invite_email).toBe('new@example.com')
  })
})

describe('Player accounts — credentials returned to the coach', () => {
  test('POST /api/athletes with an email returns the generated credentials', async () => {
    const res = await request(app)
      .post('/api/athletes')
      .send({ name: 'Cred Player', email: 'player1@example.com' })

    expect(res.status).toBe(201)
    expect(res.body.invite.account.created).toBe(true)
    expect(res.body.invite.account.email).toBe('player1@example.com')
    expect(res.body.invite.credentials).toEqual({
      email: 'player1@example.com',
      password: res.body.invite.account.password,
    })
    // Clerk complexity: upper, lower, digit and symbol in a 14-char password.
    expect(res.body.invite.account.password).toMatch(/^[A-Za-z0-9!@#$%^&*]{14}$/)
    expect(res.body.invite.account.password).toMatch(/[A-Z]/)
    expect(res.body.invite.account.password).toMatch(/[a-z]/)
    expect(res.body.invite.account.password).toMatch(/[0-9]/)
    expect(res.body.invite.account.password).toMatch(/[!@#$%^&*]/)
  })

  test('POST /api/athletes/:id/invite returns credentials and syncs the athlete email', async () => {
    const created = await request(app).post('/api/athletes').send({ name: 'Card Player' })
    expect(created.status).toBe(201)

    const res = await request(app)
      .post(`/api/athletes/${created.body.id}/invite`)
      .send({ email: 'cardplayer@example.com' })

    expect(res.status).toBe(201)
    expect(res.body.account.created).toBe(true)
    expect(res.body.account.password).toMatch(/^[A-Za-z0-9!@#$%^&*]{14}$/)
    expect(res.body.invite.credentials.email).toBe('cardplayer@example.com')
    expect(res.body.invite.inviteLink).toContain('/invite/')

    const list = await request(app).get('/api/athletes')
    const row = list.body.find((a) => a.id === created.body.id)
    expect(row.invite_email).toBe('cardplayer@example.com')
    expect(row.account_status).toBe('invited')
  })

  test('inviting again with the same email resends the link instead of duplicating', async () => {
    const created = await request(app)
      .post('/api/athletes')
      .send({ name: 'Resend Player', email: 'resend@example.com' })
    const athleteId = created.body.id

    const resend = await request(app)
      .post(`/api/athletes/${athleteId}/invite`)
      .send({ email: 'resend@example.com' })

    expect(resend.status).toBe(201)
    expect(resend.body.invite.resent).toBe(true)
    // The password from the first invite cannot be recovered on resend.
    expect(resend.body.invite.credentials).toBeUndefined()

    const count = await pool.query(
      'SELECT COUNT(*)::int AS n FROM invites WHERE athlete_id = $1',
      [athleteId]
    )
    expect(count.rows[0].n).toBe(1)
  })

  test('inviting an athlete who already joined returns 409', async () => {
    const { athleteId } = await seedJoinedPlayer('player_clerk_1', 'joined@example.com')

    const res = await request(app)
      .post(`/api/athletes/${athleteId}/invite`)
      .send({ email: 'joined@example.com' })

    expect(res.status).toBe(409)
    expect(res.body.error).toContain('already joined')
  })
})

describe('Player accounts — role enforcement', () => {
  test('players cannot create events', async () => {
    await seedJoinedPlayer('player_clerk_1', 'player1@example.com')

    const res = await request(app)
      .post('/api/events')
      .set('x-test-clerk-user-id', 'player_clerk_1')
      .send({ title: 'Player event', event_date: '2099-01-01', format: 'match' })

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('Players cannot perform this action')
  })

  test('players cannot log injuries', async () => {
    const { athleteId } = await seedJoinedPlayer('player_clerk_1', 'player1@example.com')

    const res = await request(app)
      .post('/api/injuries')
      .set('x-test-clerk-user-id', 'player_clerk_1')
      .send({
        athlete_id: athleteId,
        description: 'Twisted ankle',
        date_sustained: '2025-01-01',
      })

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('Players cannot perform this action')
  })

  test('assistants keep the ability to log injuries', async () => {
    const athlete = await pool.query(
      `INSERT INTO athletes (squad_id, name) VALUES ($1, 'Assistant Target') RETURNING id`,
      [squadId]
    )

    const invite = await request(app)
      .post('/api/invites')
      .send({ email: 'assistant@example.com' })
    const token = invite.body.inviteLink.split('/invite/')[1]
    const accepted = await request(app)
      .post(`/api/invites/${token}/accept`)
      .set('x-test-clerk-user-id', 'assistant_clerk')
      .set('x-test-invite-email', 'assistant@example.com')
    expect(accepted.status).toBe(200)

    const res = await request(app)
      .post('/api/injuries')
      .set('x-test-clerk-user-id', 'assistant_clerk')
      .send({
        athlete_id: athlete.rows[0].id,
        description: 'Hamstring strain',
        date_sustained: '2025-01-01',
      })

    expect(res.status).toBe(201)
  })
})

describe('Player accounts — my_rsvp on the events list', () => {
  test('a linked player sees their own RSVP status per event', async () => {
    await seedJoinedPlayer('player_clerk_1', 'player1@example.com')

    const event = await pool.query(
      `INSERT INTO events (squad_id, opponent, event_date, created_by)
       VALUES ($1, 'Riverside FC', now(), (SELECT id FROM users WHERE clerk_id = 'test_clerk_user'))
       RETURNING *`,
      [squadId]
    )
    const eventId = event.rows[0].id

    // Players manage their own availability (RSVP self-service).
    const rsvp = await request(app)
      .put(`/api/events/${eventId}/rsvps/mine`)
      .set('x-test-clerk-user-id', 'player_clerk_1')
      .send({ status: 'available' })
    expect(rsvp.status).toBe(200)

    const asPlayer = await request(app)
      .get('/api/events')
      .set('x-test-clerk-user-id', 'player_clerk_1')
    expect(asPlayer.status).toBe(200)
    const row = asPlayer.body.find((e) => e.id === eventId)
    expect(row).toBeDefined()
    expect(row.my_rsvp).toBe('available')
    expect(row.available_count).toBe(1)

    // Staff accounts have no linked athlete row, so my_rsvp stays null.
    const asCoach = await request(app).get('/api/events')
    const coachRow = asCoach.body.find((e) => e.id === eventId)
    expect(coachRow.my_rsvp).toBeNull()

    // The player's own RSVP also updates after they change their answer.
    const changed = await request(app)
      .put(`/api/events/${eventId}/rsvps/mine`)
      .set('x-test-clerk-user-id', 'player_clerk_1')
      .send({ status: 'unavailable' })
    expect(changed.status).toBe(200)

    const after = await request(app)
      .get('/api/events')
      .set('x-test-clerk-user-id', 'player_clerk_1')
    expect(after.body.find((e) => e.id === eventId).my_rsvp).toBe('unavailable')
  })
})
