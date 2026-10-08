import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import { pool, resetDatabase, seedCoach } from './setup'

import accountRouter from '../../src/routes/account'
import athletesRouter from '../../src/routes/athletes'
import dashboardRouter from '../../src/routes/dashboard'
import eventsRouter from '../../src/routes/events'
import invitesRouter from '../../src/routes/invites'
import sessionsRouter from '../../src/routes/sessions'
import squadsRouter from '../../src/routes/squads'
import tacticsRouter from '../../src/routes/tactics'
import userLinking from '../../src/lib/userLinking'

const { __testSetClerkEmail, __testClearClerkEmails } = userLinking

const app = express()
app.use(express.json())
app.use('/api/account', accountRouter)
app.use('/api/athletes', athletesRouter)
app.use('/api/dashboard', dashboardRouter)
app.use('/api/events', eventsRouter)
app.use('/api/invites', invitesRouter)
app.use('/api/sessions', sessionsRouter)
app.use('/api/squads', squadsRouter)
app.use('/api/tactics', tacticsRouter)

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
  __testClearClerkEmails()
})

afterAll(async () => {
  await pool.end()
})

// Simulates a real sign-in: the account's Clerk id resolves to an email and
// the first authenticated request arrives. GET /api/account/me is the same
// entry point the frontend uses on load, so this is exactly where the
// production linking runs.
async function signIn(clerkId, email) {
  __testSetClerkEmail(clerkId, email)
  return request(app).get('/api/account/me').set('x-test-clerk-user-id', clerkId)
}

describe('Login-time email linking — the player flow', () => {
  test('a player signing in with generated credentials is linked by email without opening the invite link', async () => {
    const created = await request(app)
      .post('/api/athletes')
      .send({ name: 'Marcus Hale', email: 'player1@example.com' })
    expect(created.status).toBe(201)
    const athleteId = created.body.id

    // The invite exists but is never clicked — the player goes straight to
    // the app with the credentials the coach handed over.
    const me = await signIn('player_clerk_1', 'player1@example.com')
    expect(me.status).toBe(200)
    expect(me.body.role).toBe('athlete')
    expect(me.body.athleteId).toBe(athleteId)
    expect(me.body.squadId).toBe(squadId)

    const user = await pool.query(
      "SELECT id, email, role FROM users WHERE clerk_id = 'player_clerk_1'"
    )
    expect(user.rows[0].role).toBe('athlete')
    expect(user.rows[0].email).toBe('player1@example.com')

    const athlete = await pool.query('SELECT user_id FROM athletes WHERE id = $1', [athleteId])
    expect(athlete.rows[0].user_id).toBe(user.rows[0].id)

    const invite = await pool.query('SELECT status FROM invites WHERE athlete_id = $1', [athleteId])
    expect(invite.rows[0].status).toBe('accepted')
  })

  test('an invited assistant is linked on first sign-in the same way', async () => {
    const invite = await request(app)
      .post('/api/invites')
      .send({ email: 'assistant@example.com' })
    expect(invite.status).toBe(201)

    const me = await signIn('assistant_clerk', 'assistant@example.com')
    expect(me.status).toBe(200)
    expect(me.body.role).toBe('assistant')
    expect(me.body.squadId).toBe(squadId)
  })

  test('a legacy default-coach row is re-linked to its athlete on the next login (the reported bug)', async () => {
    const created = await request(app)
      .post('/api/athletes')
      .send({ name: 'Legacy Player', email: 'legacy@example.com' })
    const athleteId = created.body.id

    // Reproduce the old broken state: the player signed in before linking
    // existed, so their row sits there with the default coach role and no
    // email recorded.
    await pool.query("INSERT INTO users (clerk_id, role) VALUES ('legacy_clerk', 'coach')")

    const me = await signIn('legacy_clerk', 'legacy@example.com')
    expect(me.status).toBe(200)
    expect(me.body.role).toBe('athlete')
    expect(me.body.athleteId).toBe(athleteId)

    const user = await pool.query(
      "SELECT email FROM users WHERE clerk_id = 'legacy_clerk'"
    )
    expect(user.rows[0].email).toBe('legacy@example.com')
  })

  test('a real coach is never re-roled by an invite to their email — only the email is stored', async () => {
    const otherCoach = await seedCoach('coach_two')
    await pool.query("INSERT INTO athletes (squad_id, name) VALUES ($1, 'Their Player')", [
      otherCoach.squadId,
    ])

    // Someone invites this coach's email (e.g. an assistant invite meant
    // for someone else, or a duplicate). The account keeps its role.
    await request(app).post('/api/invites').send({ email: 'coach2@example.com' })

    const me = await signIn('coach_two', 'coach2@example.com')
    expect(me.status).toBe(200)
    expect(me.body.role).toBe('coach')

    const user = await pool.query("SELECT email FROM users WHERE clerk_id = 'coach_two'")
    expect(user.rows[0].email).toBe('coach2@example.com')
  })

  test('a player whose invite was re-sent to a new address still links via the original email', async () => {
    const created = await request(app)
      .post('/api/athletes')
      .send({ name: 'Swap Email', email: 'old@example.com' })
    const athleteId = created.body.id

    const reinvite = await request(app)
      .post(`/api/athletes/${athleteId}/invite`)
      .send({ email: 'new@example.com' })
    expect(reinvite.status).toBe(201)

    // The first invite is now 'cancelled', the new one is 'pending' — but
    // the player kept the credentials from the first handover.
    const me = await signIn('swap_clerk', 'old@example.com')
    expect(me.status).toBe(200)
    expect(me.body.role).toBe('athlete')
    expect(me.body.athleteId).toBe(athleteId)

    const athlete = await pool.query(
      "SELECT user_id FROM athletes WHERE id = $1",
      [athleteId]
    )
    const user = await pool.query("SELECT id FROM users WHERE clerk_id = 'swap_clerk'")
    expect(athlete.rows[0].user_id).toBe(user.rows[0].id)
  })

  test('accepting the invite link still stores the account email', async () => {
    const created = await request(app)
      .post('/api/athletes')
      .send({ name: 'Click Player', email: 'click@example.com' })
    const token = created.body.invite.inviteLink.split('/invite/')[1]

    const accepted = await request(app)
      .post(`/api/invites/${token}/accept`)
      .set('x-test-clerk-user-id', 'click_clerk')
      .set('x-test-invite-email', 'click@example.com')
    expect(accepted.status).toBe(200)
    expect(accepted.body.role).toBe('athlete')

    const user = await pool.query("SELECT email FROM users WHERE clerk_id = 'click_clerk'")
    expect(user.rows[0].email).toBe('click@example.com')
  })
})

describe('Player restrictions after email linking', () => {
  // The player the coach handed credentials to — linked purely via login.
  async function seedLinkedPlayer(clerkId = 'player_clerk_1', email = 'player1@example.com') {
    const created = await request(app)
      .post('/api/athletes')
      .send({ name: 'Marcus Hale', email })
    expect(created.status).toBe(201)
    const me = await signIn(clerkId, email)
    expect(me.body.role).toBe('athlete')
    return created.body.id
  }

  test('a player cannot create tactics, create drills, rename the squad, or RSVP on behalf of teammates', async () => {
    await seedLinkedPlayer()
    const asPlayer = (req) => req.set('x-test-clerk-user-id', 'player_clerk_1')

    const tactic = await asPlayer(request(app).post('/api/tactics')).send({ name: 'Pressing' })
    expect(tactic.status).toBe(403)
    expect(tactic.body.error).toContain('coach')

    const drill = await asPlayer(request(app).post('/api/sessions')).send({
      name: 'Rondo',
      tactical_goal: 'Possession',
    })
    expect(drill.status).toBe(403)
    expect(drill.body.error).toBe('Players cannot perform this action')

    const squad = await asPlayer(request(app).patch('/api/squads/mine')).send({ name: 'Hacked FC' })
    expect(squad.status).toBe(403)

    const event = await pool.query(
      `INSERT INTO events (squad_id, opponent, event_date, created_by)
       VALUES ($1, 'Riverside FC', now(), (SELECT id FROM users WHERE clerk_id = 'test_clerk_user'))
       RETURNING id`,
      [squadId]
    )
    const other = await pool.query(
      "INSERT INTO athletes (squad_id, name) VALUES ($1, 'Teammate') RETURNING id",
      [squadId]
    )
    const rsvp = await asPlayer(
      request(app).put(`/api/events/${event.rows[0].id}/rsvps/${other.rows[0].id}`)
    ).send({ status: 'available' })
    expect(rsvp.status).toBe(403)
    expect(rsvp.body.error).toBe('Players cannot perform this action')
  })

  test('a player keeps read access: tactics list, dashboard summary, and their own RSVP', async () => {
    await seedLinkedPlayer()
    const asPlayer = (req) => req.set('x-test-clerk-user-id', 'player_clerk_1')

    const tactics = await asPlayer(request(app).get('/api/tactics'))
    expect(tactics.status).toBe(200)

    const summary = await asPlayer(request(app).get('/api/dashboard/summary?period=7d'))
    expect(summary.status).toBe(200)

    const event = await pool.query(
      `INSERT INTO events (squad_id, opponent, event_date, created_by)
       VALUES ($1, 'Riverside FC', now(), (SELECT id FROM users WHERE clerk_id = 'test_clerk_user'))
       RETURNING id`,
      [squadId]
    )
    const own = await asPlayer(
      request(app).put(`/api/events/${event.rows[0].id}/rsvps/mine`)
    ).send({ status: 'available' })
    expect(own.status).toBe(200)
  })

  test('coaches and assistants keep their staff abilities', async () => {
    const invite = await request(app)
      .post('/api/invites')
      .send({ email: 'assistant@example.com' })
    expect(invite.status).toBe(201)
    const asAssistant = await signIn('assistant_clerk', 'assistant@example.com')
    expect(asAssistant.body.role).toBe('assistant')

    const tactic = await request(app)
      .post('/api/tactics')
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ name: 'High press' })
    expect(tactic.status).toBe(201)

    const drill = await request(app)
      .post('/api/sessions')
      .set('x-test-clerk-user-id', 'assistant_clerk')
      .send({ name: 'Rondo', tactical_goal: 'Possession' })
    expect(drill.status).toBe(201)

    const squad = await request(app)
      .patch('/api/squads/mine')
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ name: 'Renamed Squad' })
    expect(squad.status).toBe(200)
    expect(squad.body.name).toBe('Renamed Squad')
  })
})
