// AI assistance: drafted with Qoder (AI coding assistant); reviewed and tested by the project team.
import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import { pool, resetDatabase, seedCoach } from './setup'

import athletesRouter from '../../src/routes/athletes'
import injuriesRouter from '../../src/routes/injuries'

const app = express()
app.use(express.json())
app.use('/api/athletes', athletesRouter)
app.use('/api/injuries', injuriesRouter)

let squadId
let coachUserId

// node-postgres parses DATE columns into local-midnight Dates, so JSON
// responses carry a full ISO timestamp depending on the runner's timezone.
// Normalising back to the calendar date keeps assertions stable on any machine.
function asDateString(value) {
  if (typeof value === 'string' && value.length === 10) return value
  const d = new Date(value)
  return (
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  )
}

async function addAthlete(name) {
  const result = await pool.query('INSERT INTO athletes (squad_id, name) VALUES ($1, $2) RETURNING *', [
    squadId,
    name,
  ])
  return result.rows[0]
}

async function seedAssistant() {
  await pool.query(
    "INSERT INTO users (clerk_id, role, squad_id) VALUES ('test_assistant_user', 'assistant', $1)",
    [squadId]
  )
}

beforeAll(async () => {
  try {
    await pool.query('SELECT 1')
  } catch (err) {
    throw new Error(
      'Could not reach the test database. Create it and run migrations against it first — see the setup instructions.\n' +
        `Original error: ${err.message}`,
      { cause: err }
    )
  }
})

beforeEach(async () => {
  await resetDatabase()
  const seeded = await seedCoach()
  squadId = seeded.squadId
  coachUserId = seeded.userId
})

afterAll(async () => {
  await pool.end()
})

describe('US29 (integration) — log an athlete injury', () => {
  test('AC: logging a recognised injury stores a return-to-play estimate with it', async () => {
    const athlete = await addAthlete('Marcus Hale')

    const res = await request(app).post('/api/injuries').send({
      athlete_id: athlete.id,
      description: 'Moderate ankle sprain',
      date_sustained: '2026-09-10',
      severity: 'moderate',
    })

    expect(res.status).toBe(201)
    expect(res.body.athlete_id).toBe(athlete.id)
    expect(res.body.severity).toBe('moderate')
    // Ankle sprain (moderate): 3-6 weeks, midpoint ~4.5 weeks after 2026-09-10
    expect(res.body.estimation_min_weeks).toBe(3)
    expect(res.body.estimation_max_weeks).toBe(6)
    expect(asDateString(res.body.return_date)).toBe('2026-10-12')
    expect(res.body.estimation_basis).toContain('Ankle sprain')
  })

  test('AC: an unmatched description falls back to the severity-tier default', async () => {
    const athlete = await addAthlete('Casey Keller')

    const res = await request(app).post('/api/injuries').send({
      athlete_id: athlete.id,
      description: 'Heavy knock, no clear diagnosis',
      date_sustained: '2026-09-10',
      severity: 'severe',
    })

    expect(res.status).toBe(201)
    // Severe tier default: 10-12 weeks, midpoint 11 weeks after 2026-09-10
    expect(res.body.estimation_min_weeks).toBe(10)
    expect(res.body.estimation_max_weeks).toBe(12)
    expect(asDateString(res.body.return_date)).toBe('2026-11-26')
    expect(res.body.estimation_basis).toContain('severity default')
  })

  test('rejects a missing athlete_id, description, or date_sustained', async () => {
    const athlete = await addAthlete('Sam Lee')

    const noAthlete = await request(app)
      .post('/api/injuries')
      .send({ description: 'Ankle sprain', date_sustained: '2026-09-10' })
    expect(noAthlete.status).toBe(400)

    const noDescription = await request(app)
      .post('/api/injuries')
      .send({ athlete_id: athlete.id, date_sustained: '2026-09-10' })
    expect(noDescription.status).toBe(400)

    const noDate = await request(app)
      .post('/api/injuries')
      .send({ athlete_id: athlete.id, description: 'Ankle sprain' })
    expect(noDate.status).toBe(400)
  })

  test('rejects an invalid severity', async () => {
    const athlete = await addAthlete('Sam Lee')

    const res = await request(app).post('/api/injuries').send({
      athlete_id: athlete.id,
      description: 'Ankle sprain',
      date_sustained: '2026-09-10',
      severity: 'catastrophic',
    })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('severity must be minor, moderate, or severe')
  })

  test('404s for an athlete that belongs to another squad', async () => {
    const otherCoach = await pool.query(
      "INSERT INTO users (clerk_id, role) VALUES ('other_coach', 'coach') RETURNING id"
    )
    const otherSquad = await pool.query(
      "INSERT INTO squads (coach_id, name) VALUES ($1, 'Other Squad') RETURNING id",
      [otherCoach.rows[0].id]
    )
    const otherAthlete = await pool.query(
      'INSERT INTO athletes (squad_id, name) VALUES ($1, $2) RETURNING id',
      [otherSquad.rows[0].id, 'Rival Player']
    )

    const res = await request(app).post('/api/injuries').send({
      athlete_id: otherAthlete.rows[0].id,
      description: 'Ankle sprain',
      date_sustained: '2026-09-10',
    })

    expect(res.status).toBe(404)
  })

  test('assistants can log injuries, matching live-logging access', async () => {
    await seedAssistant()
    const athlete = await addAthlete('Marcus Hale')

    const res = await request(app)
      .post('/api/injuries')
      .set('x-test-clerk-user-id', 'test_assistant_user')
      .send({
        athlete_id: athlete.id,
        description: 'Hamstring strain',
        date_sustained: '2026-09-10',
        severity: 'minor',
      })

    expect(res.status).toBe(201)
  })
})

describe('US30 (integration) — return-to-play estimate with coach override', () => {
  test("AC: the coach's manual return date overrides the suggested one", async () => {
    const athlete = await addAthlete('Marcus Hale')

    const created = await request(app).post('/api/injuries').send({
      athlete_id: athlete.id,
      description: 'Moderate ankle sprain',
      date_sustained: '2026-09-10',
      severity: 'moderate',
    })
    expect(created.status).toBe(201)
    expect(asDateString(created.body.return_date)).toBe('2026-10-12')

    const res = await request(app)
      .patch(`/api/injuries/${created.body.id}`)
      .send({ return_date: '2026-12-01' })

    expect(res.status).toBe(200)
    expect(asDateString(res.body.return_date)).toBe('2026-12-01')
  })

  test('assistants cannot edit or delete injuries', async () => {
    await seedAssistant()
    const athlete = await addAthlete('Marcus Hale')

    const created = await request(app).post('/api/injuries').send({
      athlete_id: athlete.id,
      description: 'Ankle sprain',
      date_sustained: '2026-09-10',
    })
    expect(created.status).toBe(201)

    const patch = await request(app)
      .patch(`/api/injuries/${created.body.id}`)
      .set('x-test-clerk-user-id', 'test_assistant_user')
      .send({ return_date: '2026-12-01' })
    expect(patch.status).toBe(403)

    const del = await request(app)
      .delete(`/api/injuries/${created.body.id}`)
      .set('x-test-clerk-user-id', 'test_assistant_user')
    expect(del.status).toBe(403)
  })

  test('coach can delete a mis-logged injury', async () => {
    const athlete = await addAthlete('Marcus Hale')

    const created = await request(app).post('/api/injuries').send({
      athlete_id: athlete.id,
      description: 'Ankle sprain',
      date_sustained: '2026-09-10',
    })

    const res = await request(app).delete(`/api/injuries/${created.body.id}`)
    expect(res.status).toBe(204)
  })
})

describe('US31 (integration) — injury flags on the roster', () => {
  test('AC: an active injury flags the athlete on the roster', async () => {
    const injured = await addAthlete('Injured Player')
    const healthy = await addAthlete('Healthy Player')

    await pool.query(
      `INSERT INTO injuries (athlete_id, description, date_sustained, severity, return_date, logged_by)
       VALUES ($1, 'Ankle sprain', CURRENT_DATE, 'moderate', CURRENT_DATE + 21, $2)`,
      [injured.id, coachUserId]
    )

    const res = await request(app).get('/api/athletes')
    expect(res.status).toBe(200)

    const injuredRow = res.body.find((a) => a.id === injured.id)
    const healthyRow = res.body.find((a) => a.id === healthy.id)
    expect(injuredRow.is_injured).toBe(true)
    expect(healthyRow.is_injured).toBe(false)
  })

  test('AC: the flag clears automatically once the return date has passed', async () => {
    const athlete = await addAthlete('Recovered Player')

    await pool.query(
      `INSERT INTO injuries (athlete_id, description, date_sustained, severity, return_date, logged_by)
       VALUES ($1, 'Ankle sprain', CURRENT_DATE - 60, 'moderate', CURRENT_DATE - 10, $2)`,
      [athlete.id, coachUserId]
    )

    const res = await request(app).get('/api/athletes')
    const row = res.body.find((a) => a.id === athlete.id)
    expect(row.is_injured).toBe(false)
  })

  test('AC: manual clearance also clears the flag', async () => {
    const athlete = await addAthlete('Cleared Player')

    const created = await pool.query(
      `INSERT INTO injuries (athlete_id, description, date_sustained, severity, return_date, logged_by)
       VALUES ($1, 'Ankle sprain', CURRENT_DATE, 'moderate', CURRENT_DATE + 90, $2) RETURNING id`,
      [athlete.id, coachUserId]
    )

    const cleared = await request(app)
      .patch(`/api/injuries/${created.rows[0].id}`)
      .send({ clear: true })
    expect(cleared.status).toBe(200)
    expect(cleared.body.cleared_at).toBeTruthy()

    const res = await request(app).get('/api/athletes')
    const row = res.body.find((a) => a.id === athlete.id)
    expect(row.is_injured).toBe(false)
  })
})