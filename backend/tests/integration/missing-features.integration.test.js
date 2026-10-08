import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import { pool, resetDatabase, seedAvailability } from './setup'

import eventsRouter from '../../src/routes/events'
import fixturesRouter from '../../src/routes/fixtures'
import athletesRouter from '../../src/routes/athletes'
import squadsRouter from '../../src/routes/squads'
import publicRouter from '../../src/routes/public'
import accountRouter from '../../src/routes/account'

// The five "missing features" from the brief that previously had no test
// coverage at all: RSVP availability, manual stat overrides, clash
// detection, the public squad page, and the offline-replay contract
// (idempotent creates + tolerant undos). Routes are mounted exactly like
// app.js does — /api/public deliberately without auth.
const app = express()
app.use(express.json())
app.use('/api/public', publicRouter)
app.use('/api/events', eventsRouter)
app.use('/api/fixtures', fixturesRouter)
app.use('/api/athletes', athletesRouter)
app.use('/api/squads', squadsRouter)
app.use('/api/account', accountRouter)

const COACH = 'test_clerk_user'

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
})

afterAll(async () => {
  await pool.end()
})

// Resolves (self-healing) the coach's squad, then seeds a small roster.
async function seedSquadWithRoster(count = 2) {
  const squadRes = await request(app)
    .get('/api/squads/mine')
    .set('x-test-clerk-user-id', COACH)
  const squadId = squadRes.body.id

  const athletes = []
  for (let i = 0; i < count; i++) {
    const inserted = await pool.query(
      'INSERT INTO athletes (squad_id, name) VALUES ($1, $2) RETURNING *',
      [squadId, `Player ${i + 1}`]
    )
    athletes.push(inserted.rows[0])
  }

  return { squadId, athletes }
}

// Training sessions skip the roster-minimum gate, which keeps these tests
// focused on the feature under test rather than roster setup.
async function createEvent({ minutesFromNow = 5, duration = 90, format = 'training' } = {}) {
  const res = await request(app)
    .post('/api/events')
    .set('x-test-clerk-user-id', COACH)
    .send({
      format,
      event_type: format === 'training' ? 'training' : 'match',
      event_date: new Date(Date.now() + minutesFromNow * 60000).toISOString(),
      duration_minutes: duration,
      location: 'Main Oval',
    })
  return res.body
}

describe('RSVP availability', () => {
  test('lists the whole squad as pending and summarises responses', async () => {
    const { athletes } = await seedSquadWithRoster(2)
    const event = await createEvent()

    const res = await request(app)
      .get(`/api/events/${event.id}/rsvps`)
      .set('x-test-clerk-user-id', COACH)

    expect(res.status).toBe(200)
    expect(res.body.rsvps).toHaveLength(2)
    expect(res.body.rsvps.map((r) => r.athlete_id).sort()).toEqual(
      athletes.map((a) => a.id).sort()
    )
    expect(res.body.rsvps.every((r) => r.status === 'pending')).toBe(true)
    expect(res.body.summary).toEqual({ pending: 2, available: 0, unavailable: 0, maybe: 0 })
  })

  test('a coach can record an athlete availability on their behalf', async () => {
    const { athletes } = await seedSquadWithRoster(2)
    const event = await createEvent()

    const put = await request(app)
      .put(`/api/events/${event.id}/rsvps/${athletes[0].id}`)
      .set('x-test-clerk-user-id', COACH)
      .send({ status: 'available', note: 'Confirmed by phone' })

    expect(put.status).toBe(200)
    expect(put.body.status).toBe('available')

    const res = await request(app)
      .get(`/api/events/${event.id}/rsvps`)
      .set('x-test-clerk-user-id', COACH)

    expect(res.body.summary.available).toBe(1)
    const row = res.body.rsvps.find((r) => r.athlete_id === athletes[0].id)
    expect(row.status).toBe('available')
    expect(row.note).toBe('Confirmed by phone')
  })

  test('rejects an invalid availability status', async () => {
    const { athletes } = await seedSquadWithRoster(1)
    const event = await createEvent()

    const res = await request(app)
      .put(`/api/events/${event.id}/rsvps/${athletes[0].id}`)
      .set('x-test-clerk-user-id', COACH)
      .send({ status: 'probably' })

    expect(res.status).toBe(400)
  })

  test('the event list carries an availability tally per event', async () => {
    const { athletes } = await seedSquadWithRoster(2)
    const event = await createEvent()

    await request(app)
      .put(`/api/events/${event.id}/rsvps/${athletes[0].id}`)
      .set('x-test-clerk-user-id', COACH)
      .send({ status: 'available' })
    await request(app)
      .put(`/api/events/${event.id}/rsvps/${athletes[1].id}`)
      .set('x-test-clerk-user-id', COACH)
      .send({ status: 'unavailable' })

    const res = await request(app)
      .get('/api/events')
      .set('x-test-clerk-user-id', COACH)

    expect(res.status).toBe(200)
    const listed = res.body.find((e) => e.id === event.id)
    expect(listed.available_count).toBe(1)
    expect(listed.unavailable_count).toBe(1)
    expect(listed.maybe_count).toBe(0)
  })

  test('an athlete can only answer for themselves via rsvps/mine', async () => {
    const { squadId, athletes } = await seedSquadWithRoster(1)
    const event = await createEvent()

    // Link a Clerk account to the athlete row, the way invite-accept does.
    const userRes = await pool.query(
      "INSERT INTO users (clerk_id, role, squad_id) VALUES ('athlete_one', 'athlete', $1) RETURNING id",
      [squadId]
    )
    await pool.query('UPDATE athletes SET user_id = $1 WHERE id = $2', [
      userRes.rows[0].id,
      athletes[0].id,
    ])

    const mine = await request(app)
      .put(`/api/events/${event.id}/rsvps/mine`)
      .set('x-test-clerk-user-id', 'athlete_one')
      .send({ status: 'maybe' })

    expect(mine.status).toBe(200)
    expect(mine.body.athlete_id).toBe(athletes[0].id)
    expect(mine.body.status).toBe('maybe')

    // The coach's own account has no athlete row — same endpoint must refuse.
    const coachAttempt = await request(app)
      .put(`/api/events/${event.id}/rsvps/mine`)
      .set('x-test-clerk-user-id', COACH)
      .send({ status: 'available' })

    expect(coachAttempt.status).toBe(403)
  })
})

describe('Manual stat overrides', () => {
  test('a coach override replaces the computed value in the stats payload', async () => {
    const { athletes } = await seedSquadWithRoster(1)
    const athleteId = athletes[0].id

    const patch = await request(app)
      .patch(`/api/athletes/${athleteId}/stats/override`)
      .set('x-test-clerk-user-id', COACH)
      .send({ stat_key: 'goals', value: 3, note: 'Scorer sheet mismatch' })

    expect(patch.status).toBe(200)
    expect(patch.body.override_value).toBe(3)

    const res = await request(app)
      .get(`/api/athletes/${athleteId}/stats`)
      .set('x-test-clerk-user-id', COACH)

    expect(res.status).toBe(200)
    expect(res.body.stats.goals).toBe(3)
    expect(res.body.overrides.goals).toEqual(
      expect.objectContaining({ value: 3, computedValue: 0 })
    )
  })

  test('removing the override reverts to the computed value', async () => {
    const { athletes } = await seedSquadWithRoster(1)
    const athleteId = athletes[0].id

    await request(app)
      .patch(`/api/athletes/${athleteId}/stats/override`)
      .set('x-test-clerk-user-id', COACH)
      .send({ stat_key: 'goals', value: 3 })

    const del = await request(app)
      .delete(`/api/athletes/${athleteId}/stats/override/goals`)
      .set('x-test-clerk-user-id', COACH)

    expect(del.status).toBe(204)

    const res = await request(app)
      .get(`/api/athletes/${athleteId}/stats`)
      .set('x-test-clerk-user-id', COACH)

    expect(res.body.stats.goals).toBe(0)
    expect(res.body.overrides.goals).toBeUndefined()
  })

  test('rejects unknown stat keys and negative values', async () => {
    const { athletes } = await seedSquadWithRoster(1)
    const athleteId = athletes[0].id

    const badKey = await request(app)
      .patch(`/api/athletes/${athleteId}/stats/override`)
      .set('x-test-clerk-user-id', COACH)
      .send({ stat_key: 'height', value: 3 })
    expect(badKey.status).toBe(400)

    const badValue = await request(app)
      .patch(`/api/athletes/${athleteId}/stats/override`)
      .set('x-test-clerk-user-id', COACH)
      .send({ stat_key: 'goals', value: -1 })
    expect(badValue.status).toBe(400)
  })

  test('non-coaches cannot override stats', async () => {
    const { squadId, athletes } = await seedSquadWithRoster(1)
    await pool.query(
      "INSERT INTO users (clerk_id, role, squad_id) VALUES ('assistant_one', 'assistant', $1)",
      [squadId]
    )

    const res = await request(app)
      .patch(`/api/athletes/${athletes[0].id}/stats/override`)
      .set('x-test-clerk-user-id', 'assistant_one')
      .send({ stat_key: 'goals', value: 2 })

    expect(res.status).toBe(403)
  })
})

describe('Clash detection', () => {
  test('overlapping own events flag each other, non-overlapping do not', async () => {
    await seedSquadWithRoster(1)
    const first = await createEvent({ minutesFromNow: 30, duration: 90 })
    const overlapping = await createEvent({ minutesFromNow: 60, duration: 90 })
    const later = await createEvent({ minutesFromNow: 300, duration: 60 })

    // The create response already carries the advisory list.
    expect(overlapping.clashes).toHaveLength(1)
    expect(overlapping.clashes[0]).toEqual(
      expect.objectContaining({ kind: 'event', id: first.id })
    )

    const res = await request(app)
      .get(`/api/events/${overlapping.id}/clashes`)
      .set('x-test-clerk-user-id', COACH)

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].event_date).toBe(first.event_date)

    const laterRes = await request(app)
      .get(`/api/events/${later.id}/clashes`)
      .set('x-test-clerk-user-id', COACH)

    expect(laterRes.status).toBe(200)
    expect(laterRes.body).toHaveLength(0)
  })

  test('the pre-check endpoint works before the event exists', async () => {
    await seedSquadWithRoster(1)
    const existing = await createEvent({ minutesFromNow: 45, duration: 90 })

    const hit = await request(app)
      .get('/api/events/clashes')
      .query({
        event_date: new Date(Date.now() + 60 * 60000).toISOString(),
        duration_minutes: 90,
      })
      .set('x-test-clerk-user-id', COACH)

    expect(hit.status).toBe(200)
    expect(hit.body).toHaveLength(1)
    expect(hit.body[0].id).toBe(existing.id)

    const clear = await request(app)
      .get('/api/events/clashes')
      .query({
        event_date: new Date(Date.now() + 24 * 60 * 60000).toISOString(),
        duration_minutes: 90,
      })
      .set('x-test-clerk-user-id', COACH)

    expect(clear.status).toBe(200)
    expect(clear.body).toHaveLength(0)

    const missingDate = await request(app)
      .get('/api/events/clashes')
      .set('x-test-clerk-user-id', COACH)

    expect(missingDate.status).toBe(400)
  })

  test('fixtures in a joined league count as clashes for own events', async () => {
    // Build a 2-team league (roster minimum applies), which generates the
    // fixtures, and move one of the creator's home fixtures to a known time.
    const mySquad = await request(app)
      .get('/api/squads/mine')
      .set('x-test-clerk-user-id', COACH)
    for (let i = 0; i < 11; i++) {
      await pool.query('INSERT INTO athletes (squad_id, name) VALUES ($1, $2)', [
        mySquad.body.id,
        `League Player ${i + 1}`,
      ])
    }

    const league = await request(app)
      .post('/api/events')
      .set('x-test-clerk-user-id', COACH)
      .send({
        title: 'Clash Test League',
        format: 'league',
        required_teams: 2,
        event_date: new Date(Date.now() + 10 * 60000).toISOString(),
      })

    await pool.query("INSERT INTO users (clerk_id, role) VALUES ('coach_two', 'coach')")
    const squad2 = await pool.query(
      "INSERT INTO squads (coach_id, name) VALUES ((SELECT id FROM users WHERE clerk_id = 'coach_two'), 'Coach Two Squad') RETURNING id"
    )
    for (let i = 0; i < 11; i++) {
      await pool.query('INSERT INTO athletes (squad_id, name) VALUES ($1, $2)', [
        squad2.rows[0].id,
        `Rival Player ${i + 1}`,
      ])
    }

    await request(app)
      .post(`/api/events/${league.body.id}/join`)
      .set('x-test-clerk-user-id', 'coach_two')

    const detail = await request(app)
      .get(`/api/events/${league.body.id}`)
      .set('x-test-clerk-user-id', COACH)
    const mySquadId = detail.body.teams.find((t) => t.is_mine).squad_id
    const homeFixture = detail.body.fixtures.find((f) => f.home_squad_id === mySquadId)

    const kickoff = new Date(Date.now() + 2 * 60 * 60 * 1000)
    const patch = await request(app)
      .patch(`/api/fixtures/${homeFixture.id}`)
      .set('x-test-clerk-user-id', COACH)
      .send({ event_date: kickoff.toISOString() })
    expect(patch.status).toBe(200)

    // A training session at the same time now clashes with the fixture...
    const training = await createEvent({ minutesFromNow: 125, duration: 90 })
    expect(training.clashes.some((c) => c.kind === 'fixture' && c.id === homeFixture.id)).toBe(true)

    // ...and the fixture's own endpoint reports the training session back.
    const fixtureClashes = await request(app)
      .get(`/api/fixtures/${homeFixture.id}/clashes`)
      .set('x-test-clerk-user-id', COACH)

    expect(fixtureClashes.status).toBe(200)
    expect(fixtureClashes.body.some((c) => c.kind === 'event' && c.id === training.id)).toBe(true)

    // The league container itself is never listed as a clash.
    expect(fixtureClashes.body.some((c) => c.kind === 'event' && c.id === league.body.id)).toBe(false)
  })
})

describe('Public squad page', () => {
  test('the link serves the roster unauthenticated and can be switched off', async () => {
    const { athletes } = await seedSquadWithRoster(2)

    // Sharing is toggled through the squad PATCH now, not a dedicated
    // public-link endpoint. The token is generated the first time it's
    // switched on and kept afterwards.
    const enabled = await request(app)
      .patch('/api/squads/mine')
      .set('x-test-clerk-user-id', COACH)
      .send({ is_public: true })

    expect(enabled.status).toBe(200)
    expect(enabled.body.public_token).toMatch(/^[0-9a-f]{48}$/)
    expect(enabled.body.is_public).toBe(true)

    const token = enabled.body.public_token

    // No auth header at all — this is what the shared public page does.
    const page = await request(app).get(`/api/public/links/${token}`)

    expect(page.status).toBe(200)
    expect(page.body.squadName).toBe('My Squad')
    expect(page.body.roster).toHaveLength(2)
    expect(page.body.roster.map((r) => r.name).sort()).toEqual(
      athletes.map((a) => a.name).sort()
    )
    expect(page.body.roster[0]).toEqual(
      expect.objectContaining({ appearances: 0, goals: 0, assists: 0 })
    )

    const csv = await request(app).get(`/api/public/links/${token}/export.csv`)
    expect(csv.status).toBe(200)
    expect(csv.headers['content-type']).toContain('text/csv')
    expect(csv.text).toContain('Player 1')

    const disabled = await request(app)
      .patch('/api/squads/mine')
      .set('x-test-clerk-user-id', COACH)
      .send({ is_public: false })
    expect(disabled.status).toBe(200)
    expect(disabled.body.is_public).toBe(false)
    // Switching off keeps the token, so the same link works again if the
    // coach turns sharing back on.
    expect(disabled.body.public_token).toBe(token)

    const afterDisable = await request(app).get(`/api/public/links/${token}`)
    expect(afterDisable.status).toBe(404)
  })

  test('an unknown token 404s', async () => {
    const res = await request(app).get('/api/public/links/does-not-exist')
    expect(res.status).toBe(404)
  })
})

describe('Offline replay contract (idempotent creates, tolerant undos)', () => {
  async function liveEventWithLineup() {
    const { athletes } = await seedSquadWithRoster(2)

    // POST /api/events refuses past-dated events, and logs on a scheduled
    // event are rejected until kickoff passes — so backdate the row directly
    // to open the logging window (the lineup PUT then flips it live).
    const event = await createEvent({ minutesFromNow: 5, duration: 90 })
    await pool.query(
      "UPDATE events SET event_date = now() - interval '5 minutes' WHERE id = $1",
      [event.id]
    )

    // The lineup PUT auto-starts a scheduled event whose kickoff has passed;
    // the lineup gate still requires a starting XI up front, and the
    // availability gate a full complement of confirmed players.
    await seedAvailability(event.id, athletes)
    const lineup = await request(app)
      .put(`/api/events/${event.id}/lineup`)
      .set('x-test-clerk-user-id', COACH)
      .send({
        lineups: athletes.map((a, i) => ({
          athlete_id: a.id,
          team_side: 'home',
          is_starter: true,
          pos_x: 20 + i * 10,
          pos_y: 40,
        })),
      })
    expect(lineup.status).toBe(200)

    return { event, athletes }
  }

  test('replaying the same client_id create never double-logs', async () => {
    const { event, athletes } = await liveEventWithLineup()

    const body = {
      client_id: 'offline-entry-1',
      athlete_id: athletes[0].id,
      action_type: 'goal',
      is_scoring: true,
    }

    const first = await request(app)
      .post(`/api/events/${event.id}/logs`)
      .set('x-test-clerk-user-id', COACH)
      .send(body)
    expect(first.status).toBe(201)

    const replay = await request(app)
      .post(`/api/events/${event.id}/logs`)
      .set('x-test-clerk-user-id', COACH)
      .send(body)
    expect(replay.status).toBe(200)
    expect(replay.body.id).toBe(first.body.id)

    const count = await pool.query(
      'SELECT COUNT(*) FROM log_entries WHERE event_id = $1 AND client_id = $2',
      [event.id, 'offline-entry-1']
    )
    expect(Number(count.rows[0].count)).toBe(1)

    // Without a client id the same payload still creates two rows — the
    // idempotency key is what makes replay safe, not the endpoint itself.
    const plain = { athlete_id: athletes[1].id, action_type: 'goal', is_scoring: true }
    await request(app)
      .post(`/api/events/${event.id}/logs`)
      .set('x-test-clerk-user-id', COACH)
      .send(plain)
    await request(app)
      .post(`/api/events/${event.id}/logs`)
      .set('x-test-clerk-user-id', COACH)
      .send(plain)

    const all = await pool.query('SELECT COUNT(*) FROM log_entries WHERE event_id = $1', [event.id])
    expect(Number(all.rows[0].count)).toBe(3)
  })

  test('a replayed undo is a no-op (204), an unknown undo is a 404', async () => {
    const { event, athletes } = await liveEventWithLineup()

    const created = await request(app)
      .post(`/api/events/${event.id}/logs`)
      .set('x-test-clerk-user-id', COACH)
      .send({ athlete_id: athletes[0].id, action_type: 'goal', is_scoring: true })

    const firstDelete = await request(app)
      .delete(`/api/events/${event.id}/logs/${created.body.id}`)
      .set('x-test-clerk-user-id', COACH)
    expect(firstDelete.status).toBe(204)

    // The queue replayed the same DELETE (the first response was lost) —
    // that must not wedge the queue with a 403.
    const replay = await request(app)
      .delete(`/api/events/${event.id}/logs/${created.body.id}`)
      .set('x-test-clerk-user-id', COACH)
    expect(replay.status).toBe(204)

    const unknown = await request(app)
      .delete(`/api/events/${event.id}/logs/999999`)
      .set('x-test-clerk-user-id', COACH)
    expect(unknown.status).toBe(404)

    const active = await pool.query(
      'SELECT COUNT(*) FROM log_entries WHERE event_id = $1 AND deleted_at IS NULL',
      [event.id]
    )
    expect(Number(active.rows[0].count)).toBe(0)
  })

  test('an undo queued after a create replays cleanly when the create lands first', async () => {
    // Simulates the out-of-order case the queue protects against: the
    // create is replayed (deduped), then its undo arrives afterwards.
    const { event, athletes } = await liveEventWithLineup()

    const body = {
      client_id: 'offline-entry-2',
      athlete_id: athletes[0].id,
      action_type: 'yellow_card',
      is_scoring: false,
    }

    const created = await request(app)
      .post(`/api/events/${event.id}/logs`)
      .set('x-test-clerk-user-id', COACH)
      .send(body)

    await request(app)
      .post(`/api/events/${event.id}/logs`)
      .set('x-test-clerk-user-id', COACH)
      .send(body)

    const undo = await request(app)
      .delete(`/api/events/${event.id}/logs/${created.body.id}`)
      .set('x-test-clerk-user-id', COACH)
    expect(undo.status).toBe(204)

    const stored = await pool.query('SELECT deleted_at FROM log_entries WHERE id = $1', [
      created.body.id,
    ])
    expect(stored.rows[0].deleted_at).not.toBeNull()
  })
})