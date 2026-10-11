// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
//
// Card realism rules (lib/cardRules.js):
//   - per match: at most one red card and two yellow cards per player, also
//     enforced when an existing log entry is edited;
//   - season totals after a stat correction: red cards <= appearances and
//     yellow cards <= 2 x appearances.
import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import { pool, resetDatabase, seedCoach } from './setup'
import eventsRouter from '../../src/routes/events'
import athletesRouter from '../../src/routes/athletes'
import { cardTotalsError } from '../../src/lib/cardRules'

const app = express()
app.use(express.json())
app.use('/api/events', eventsRouter)
app.use('/api/athletes', athletesRouter)

let squadId
let userId
const as = () => ({
  post: (u, b) => request(app).post(u).set('x-test-clerk-user-id', 'test_clerk_user').send(b),
  patch: (u, b) => request(app).patch(u).set('x-test-clerk-user-id', 'test_clerk_user').send(b),
  put: (u, b) => request(app).put(u).set('x-test-clerk-user-id', 'test_clerk_user').send(b),
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
async function liveMatchWith(players) {
  const ev = (await pool.query(
    `INSERT INTO events (squad_id, title, event_type, format, event_date, status, opponent, created_by)
     VALUES ($1, 'Match', 'match', 'match', now(), 'live', 'Rovers', $2) RETURNING id`,
    [squadId, userId]
  )).rows[0].id
  const lineup = await as().put(`/api/events/${ev}/lineup`, {
    lineups: players.map((id, i) => ({ athlete_id: id, team_side: 'home', is_starter: true, pos_x: 10 + i * 10, pos_y: 50 })),
  })
  expect(lineup.status).toBe(200)
  return ev
}

describe('per-match card limits', () => {
  test('an edit cannot give a player a second red card', async () => {
    const a = await athlete('Alpha')
    const b = await athlete('Bravo')
    const ev = await liveMatchWith([a, b])
    expect((await as().post(`/api/events/${ev}/logs`, { athlete_id: a, action_type: 'red_card', minute: 10 })).status).toBe(201)
    const goal = await as().post(`/api/events/${ev}/logs`, { athlete_id: b, action_type: 'goal', minute: 20 })
    expect(goal.status).toBe(201)

    const edit = await as().patch(`/api/events/${ev}/logs/${goal.body.id}`, { athlete_id: a, action_type: 'red_card' })
    expect(edit.status).toBe(400)
    expect(edit.body.error).toBe('This player has already been shown a red card in this match.')
  })

  test('an edit cannot give a player a third yellow card', async () => {
    const a = await athlete('Alpha')
    const b = await athlete('Bravo')
    const ev = await liveMatchWith([a, b])
    // Two yellows for Alpha go straight into the table, as an earlier
    // (pre-rule) log would have; Bravo has an ordinary yellow.
    await pool.query(
      `INSERT INTO log_entries (event_id, athlete_id, action_type, is_scoring, value, logged_by)
       VALUES ($1, $2, 'yellow_card', false, 1, $3), ($1, $2, 'yellow_card', false, 1, $3)`,
      [ev, a, userId]
    )
    const bravoYellow = (await pool.query(
      `INSERT INTO log_entries (event_id, athlete_id, action_type, is_scoring, value, logged_by)
       VALUES ($1, $2, 'yellow_card', false, 1, $3) RETURNING id`,
      [ev, b, userId]
    )).rows[0].id

    const edit = await as().patch(`/api/events/${ev}/logs/${bravoYellow}`, { athlete_id: a })
    expect(edit.status).toBe(400)
    expect(edit.body.error).toMatch(/at most two/)
  })

  test('re-saving an existing card entry is still allowed', async () => {
    const a = await athlete('Alpha')
    const ev = await liveMatchWith([a])
    const red = await as().post(`/api/events/${ev}/logs`, { athlete_id: a, action_type: 'red_card', minute: 10 })
    const edit = await as().patch(`/api/events/${ev}/logs/${red.body.id}`, { minute: 12 })
    expect(edit.status).toBe(200)
  })
})

describe('stat corrections keep card totals realistic', () => {
  // One appearance: a single logged goal in one match.
  async function playerWithOneAppearance() {
    const a = await athlete('Alpha')
    const ev = (await pool.query(
      `INSERT INTO events (squad_id, title, event_type, format, event_date, status, created_by)
       VALUES ($1, 'Match', 'match', 'match', now() - interval '1 day', 'completed', $2) RETURNING id`,
      [squadId, userId]
    )).rows[0].id
    await pool.query(
      `INSERT INTO log_entries (event_id, athlete_id, action_type, is_scoring, value, logged_by)
       VALUES ($1, $2, 'goal', true, 1, $3)`,
      [ev, a, userId]
    )
    return a
  }
  const correct = (id, stat_key, value) => as().patch(`/api/athletes/${id}/stats/override`, { stat_key, value })

  test('red cards cannot exceed appearances', async () => {
    const a = await playerWithOneAppearance()
    expect((await correct(a, 'redCards', 1)).status).toBe(200)
    const tooMany = await correct(a, 'redCards', 2)
    expect(tooMany.status).toBe(400)
    expect(tooMany.body.error).toMatch(/Red cards \(2\) can't exceed appearances \(1\)/)
  })

  test('yellow cards cannot exceed twice the appearances', async () => {
    const a = await playerWithOneAppearance()
    expect((await correct(a, 'yellowCards', 2)).status).toBe(200)
    const tooMany = await correct(a, 'yellowCards', 3)
    expect(tooMany.status).toBe(400)
    expect(tooMany.body.error).toMatch(/at most 2/)
  })

  test('lowering appearances below the cards already recorded is refused, raising them allows more cards', async () => {
    const a = await playerWithOneAppearance()
    await correct(a, 'redCards', 1)
    expect((await correct(a, 'appearances', 0)).status).toBe(400)
    expect((await correct(a, 'appearances', 3)).status).toBe(200)
    expect((await correct(a, 'redCards', 3)).status).toBe(200)
    expect((await correct(a, 'yellowCards', 6)).status).toBe(200)
  })

  test('other stats are not affected', async () => {
    const a = await playerWithOneAppearance()
    expect((await correct(a, 'goals', 40)).status).toBe(200)
  })
})

describe('cardTotalsError', () => {
  test('describes the first broken rule, or returns null', () => {
    expect(cardTotalsError({ appearances: 2, yellowCards: 4, redCards: 2 })).toBeNull()
    expect(cardTotalsError({ appearances: 0, yellowCards: 0, redCards: 0 })).toBeNull()
    expect(cardTotalsError({ appearances: 1, yellowCards: 0, redCards: 2 })).toMatch(/Red cards/)
    expect(cardTotalsError({ appearances: 1, yellowCards: 3, redCards: 0 })).toMatch(/Yellow cards/)
  })
})
