import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import { pool, resetDatabase, seedCoach, seedAvailability } from './setup'


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
})

afterAll(async () => {
  await pool.end()
})

describe('US17 (integration) — per-athlete summary, aggregated across real events', () => {
  test('AC: goals/penalties/cards/appearances aggregate correctly across two matches', async () => {
    const athleteRes = await pool.query(
      `INSERT INTO athletes (squad_id, name, squad_number) VALUES ($1, 'Marcus Hale', 9) RETURNING *`,
      [squadId]
    )
    const athlete = athleteRes.rows[0]

    const event1 = await pool.query(
      `INSERT INTO events (squad_id, opponent, event_date, created_by)
       VALUES ($1, 'Riverside FC', now(), (SELECT id FROM users WHERE clerk_id = 'test_clerk_user'))
       RETURNING *`,
      [squadId]
    )
    const event2 = await pool.query(
      `INSERT INTO events (squad_id, opponent, event_date, created_by)
       VALUES ($1, 'Eastview Rovers', now(), (SELECT id FROM users WHERE clerk_id = 'test_clerk_user'))
       RETURNING *`,
      [squadId]
    )

    // Live logging is lineup-gated: name the starting XI on each event first.
    // The availability gate also needs the squad's only player confirmed.
    for (const event of [event1.rows[0], event2.rows[0]]) {
      await seedAvailability(event.id, [athlete])
      const lineupRes = await request(app)
        .put(`/api/events/${event.id}/lineup`)
        .send({
          lineups: [
            { athlete_id: athlete.id, team_side: 'home', is_starter: true, pos_x: 50, pos_y: 50 },
          ],
        })
      expect(lineupRes.status).toBe(200)
    }

    await request(app)
      .post(`/api/events/${event1.rows[0].id}/logs`)
      .send({ athlete_id: athlete.id, action_type: 'goal', is_scoring: true })
    await request(app)
      .post(`/api/events/${event1.rows[0].id}/logs`)
      .send({ athlete_id: athlete.id, action_type: 'goal', is_scoring: true })
    await request(app)
      .post(`/api/events/${event2.rows[0].id}/logs`)
      .send({ athlete_id: athlete.id, action_type: 'yellow_card' })

    const res = await request(app).get(`/api/athletes/${athlete.id}/stats`)

    expect(res.status).toBe(200)
    expect(res.body.stats).toEqual({ goals: 2, assists: 0, penalties: 0, yellowCards: 1, redCards: 0, appearances: 2 })
  })

  test('404s for an athlete id that does not exist in this squad', async () => {
    const res = await request(app).get('/api/athletes/999999/stats')
    expect(res.status).toBe(404)
  })
})
