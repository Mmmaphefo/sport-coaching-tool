// AI assistance: drafted with Qoder (AI coding assistant); reviewed and tested by the project team.
//
// The soccer realism restrictions end to end, against the real routes:
//   - one played match owns a day (scheduled-only days stay advisory),
//   - no three consecutive match days, at least two recovery days a week,
//   - an injury cannot predate the player's birth or their 15th birthday,
//   - a second yellow becomes an automatic red: the player is ejected,
//     benched with no replacement, and refused any further involvement,
//   - a match needs a full match-day squad available (11 starters + 5 bench,
//     capped at the roster size for squads still recruiting),
//   - dashboard and public payloads carry the upcoming schedule (at most 6)
//     and the live matches of other teams, plus a public squad CSV export.
import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import { pool, resetDatabase, seedCoach, seedAvailability } from './setup'
import eventsRouter from '../../src/routes/events'
import injuriesRouter from '../../src/routes/injuries'
import dashboardRouter from '../../src/routes/dashboard'
import publicRouter from '../../src/routes/public'

const app = express()
app.use(express.json())
app.use('/api/events', eventsRouter)
app.use('/api/injuries', injuriesRouter)
app.use('/api/dashboard', dashboardRouter)
app.use('/api/public', publicRouter)

let squadId
let userId

const as = (who = 'test_clerk_user') => ({
  get: (u) => request(app).get(u).set('x-test-clerk-user-id', who),
  post: (u, b) => request(app).post(u).set('x-test-clerk-user-id', who).send(b),
  patch: (u, b) => request(app).patch(u).set('x-test-clerk-user-id', who).send(b),
  put: (u, b) => request(app).put(u).set('x-test-clerk-user-id', who).send(b),
})

beforeAll(async () => {
  try {
    await pool.query('SELECT 1')
  } catch (err) {
    throw new Error(`Could not reach the test database.
Original error: ${err.message}`, { cause: err })
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

// A local-instant N days from now at the given hour, so every comparison in
// a test happens on the same instant whether it travels through SQL or JS.
function at(offsetDays, hour = 15) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  d.setHours(hour, 0, 0, 0)
  return d
}

// The calendar key of at(offsetDays) — what POST/PATCH bodies send.
function dayKeyOf(offsetDays) {
  const d = at(offsetDays)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

// event_date is compared as a raw wall-clock timestamp everywhere (clash
// detection, day rules), so seeds store local wall time — an ISO string
// would silently shift by the UTC offset and dodge time-overlap checks.
function wallClock(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

async function insertEvent(squad, owner, { status = 'scheduled', format = 'match', when, opponent = 'Rovers', title = null } = {}) {
  const result = await pool.query(
    `INSERT INTO events (squad_id, title, opponent, event_type, format, event_date, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [squad, title, opponent, format, format, when ? wallClock(when) : wallClock(at(2)), status, owner]
  )
  return result.rows[0].id
}

async function insertAthlete(squad, name, extra = {}) {
  const columns = ['squad_id', 'name']
  const values = [squad, name]
  if (extra.dateOfBirth !== undefined) {
    columns.push('date_of_birth')
    values.push(extra.dateOfBirth)
  }
  if (extra.position !== undefined) {
    columns.push('position')
    values.push(extra.position)
  }
  if (extra.squadNumber !== undefined) {
    columns.push('squad_number')
    values.push(extra.squadNumber)
  }
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
  const result = await pool.query(
    `INSERT INTO athletes (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    values
  )
  return result.rows[0]
}

async function bypassRosterMinimum(squad) {
  await pool.query('UPDATE squads SET min_roster_size = 0 WHERE id = $1', [squad])
}

describe('match-day rules on POST /api/events', () => {
  beforeEach(async () => {
    await bypassRosterMinimum(squadId)
  })

  test('refuses to schedule on a day the squad has already played', async () => {
    await insertEvent(squadId, userId, { status: 'completed', when: at(2, 11) })

    const res = await as().post('/api/events', {
      title: 'Second match',
      opponent: 'United FC',
      format: 'match',
      event_type: 'match',
      event_date: dayKeyOf(2),
      event_time: '15:00',
    })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/cannot play twice in one day/i)
  })

  test('still allows a merely-scheduled same-day match, flagged as an advisory clash', async () => {
    await insertEvent(squadId, userId, { status: 'scheduled', when: at(2, 15) })

    const res = await as().post('/api/events', {
      title: 'Same-day cup tie',
      opponent: 'Cup Side',
      format: 'match',
      event_type: 'match',
      event_date: dayKeyOf(2),
      event_time: '15:00',
    })

    expect(res.status).toBe(201)
    expect(res.body.clashes.length).toBeGreaterThan(0)
  })

  test('refuses a third consecutive match day', async () => {
    await insertEvent(squadId, userId, { status: 'scheduled', when: at(3, 11) })
    await insertEvent(squadId, userId, { status: 'scheduled', when: at(4, 11) })

    const res = await as().post('/api/events', {
      title: 'Third day in a row',
      opponent: 'United FC',
      format: 'match',
      event_type: 'match',
      event_date: dayKeyOf(2),
      event_time: '15:00',
    })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/consecutive days/i)
  })

  test('refuses a week with fewer than two recovery days left', async () => {
    for (let offset = -5; offset <= -1; offset++) {
      await insertEvent(squadId, userId, { status: 'scheduled', when: at(offset, 11) })
    }

    const res = await as().post('/api/events', {
      title: 'One match too many',
      opponent: 'United FC',
      format: 'match',
      event_type: 'match',
      event_date: dayKeyOf(1),
      event_time: '15:00',
    })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/recovery days/i)
  })

  test('training sessions are exempt — they are not match days', async () => {
    await insertEvent(squadId, userId, { status: 'completed', when: at(2, 11) })

    const res = await as().post('/api/events', {
      title: 'Recovery session',
      format: 'training',
      event_type: 'training',
      event_date: dayKeyOf(2),
      event_time: '10:00',
    })

    expect(res.status).toBe(201)
  })
})

describe('match-day rules on PATCH /api/events/:id', () => {
  test('refuses moving a match onto a day the squad has already played', async () => {
    await bypassRosterMinimum(squadId)
    await insertEvent(squadId, userId, { status: 'completed', when: at(3, 11) })

    const created = await as().post('/api/events', {
      title: 'Movable match',
      opponent: 'United FC',
      format: 'match',
      event_type: 'match',
      event_date: dayKeyOf(5),
      event_time: '15:00',
    })
    expect(created.status).toBe(201)

    const res = await as().patch(`/api/events/${created.body.id}`, {
      event_date: dayKeyOf(3),
      event_time: '18:00',
    })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/cannot play twice in one day/i)
  })
})

describe('injury dates (POST/PATCH /api/injuries)', () => {
  test('rejects an injury dated before the player was born', async () => {
    const athlete = await insertAthlete(squadId, 'Time Traveller', { dateOfBirth: '2005-05-01' })

    const res = await as().post('/api/injuries', {
      athlete_id: athlete.id,
      description: 'Ankle sprain',
      severity: 'moderate',
      date_sustained: '2004-06-01',
    })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/before the player was born/)
  })

  test('rejects an injury before the player turns 15, accepts the 15th birthday itself', async () => {
    const athlete = await insertAthlete(squadId, 'Young Prospect', { dateOfBirth: '2005-05-01' })

    const early = await as().post('/api/injuries', {
      athlete_id: athlete.id,
      description: 'Ankle sprain',
      severity: 'moderate',
      date_sustained: '2020-04-30',
    })
    expect(early.status).toBe(400)
    expect(early.body.error).toMatch(/15 years old/)

    const onBirthday = await as().post('/api/injuries', {
      athlete_id: athlete.id,
      description: 'Ankle sprain',
      severity: 'moderate',
      date_sustained: '2020-05-01',
    })
    expect(onBirthday.status).toBe(201)
  })

  test('skips the gate when the date of birth is unknown', async () => {
    const athlete = await insertAthlete(squadId, 'No Records')

    const res = await as().post('/api/injuries', {
      athlete_id: athlete.id,
      description: 'Ankle sprain',
      severity: 'moderate',
      date_sustained: '2004-06-01',
    })

    expect(res.status).toBe(201)
  })

  test('rejects a PATCH moving the injury date before the birth or 15th birthday', async () => {
    const athlete = await insertAthlete(squadId, 'Late Bloomer', { dateOfBirth: '2005-05-01' })
    const injury = await as().post('/api/injuries', {
      athlete_id: athlete.id,
      description: 'Ankle sprain',
      severity: 'moderate',
      date_sustained: '2026-09-10',
    })
    expect(injury.status).toBe(201)

    const res = await as().patch(`/api/injuries/${injury.body.id}`, {
      date_sustained: '2004-06-01',
    })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/before the player was born/)
  })
})

describe('second yellow card = automatic red, ejection, no replacement', () => {
  test('the second booking sends the player off and refuses any further involvement', async () => {
    const striker = await insertAthlete(squadId, 'Hot Head')
    const partner = await insertAthlete(squadId, 'Steady Eddie')
    const event = await insertEvent(squadId, userId, { status: 'live', when: at(0, 11) })

    const lineup = await as().put(`/api/events/${event}/lineup`, {
      lineups: [
        { athlete_id: striker.id, team_side: 'home', is_starter: true, pos_x: 50, pos_y: 50 },
        { athlete_id: partner.id, team_side: 'home', is_starter: true, pos_x: 40, pos_y: 40 },
      ],
    })
    expect(lineup.status).toBe(200)

    const first = await as().post(`/api/events/${event}/logs`, {
      athlete_id: striker.id,
      action_type: 'yellow_card',
      minute: 10,
    })
    expect(first.status).toBe(201)
    expect(first.body.ejected).toBeUndefined()

    const second = await as().post(`/api/events/${event}/logs`, {
      athlete_id: striker.id,
      action_type: 'yellow_card',
      minute: 35,
    })
    expect(second.status).toBe(201)
    expect(second.body.ejected).toBe(true)
    expect(second.body.auto_red_card.action_type).toBe('red_card')

    // The stats story stays possible: one appearance, two yellows, one red.
    const cards = await pool.query(
      `SELECT action_type, COUNT(*)::int AS n FROM log_entries
       WHERE event_id = $1 AND athlete_id = $2 AND deleted_at IS NULL
       GROUP BY action_type`,
      [event, striker.id]
    )
    const byType = Object.fromEntries(cards.rows.map((r) => [r.action_type, r.n]))
    expect(byType).toMatchObject({ yellow_card: 2, red_card: 1 })

    // The ejection benches the player with no replacement.
    const lineupAfter = await pool.query(
      'SELECT is_starter, pos_x, pos_y FROM match_lineups WHERE event_id = $1 AND athlete_id = $2',
      [event, striker.id]
    )
    expect(lineupAfter.rows[0]).toMatchObject({ is_starter: false, pos_x: null, pos_y: null })

    // Sent-off players cannot log anything else.
    const laterLog = await as().post(`/api/events/${event}/logs`, {
      athlete_id: striker.id,
      action_type: 'goal',
      minute: 50,
    })
    expect(laterLog.status).toBe(400)
    expect(laterLog.body.error).toMatch(/sent off/)

    // And cannot be substituted onto the pitch either.
    const subAttempt = await as().post(`/api/events/${event}/logs`, {
      athlete_id: partner.id,
      action_type: 'substitution',
      substitute_athlete_id: striker.id,
      minute: 60,
    })
    expect(subAttempt.status).toBe(400)
    expect(subAttempt.body.error).toMatch(/sent-off player cannot take part/)
  })

  test('the red card log itself is still accepted exactly once', async () => {
    const player = await insertAthlete(squadId, 'Straight Red')
    const event = await insertEvent(squadId, userId, { status: 'live', when: at(0, 11) })

    await as().put(`/api/events/${event}/lineup`, {
      lineups: [
        { athlete_id: player.id, team_side: 'home', is_starter: true, pos_x: 50, pos_y: 50 },
      ],
    })

    const red = await as().post(`/api/events/${event}/logs`, {
      athlete_id: player.id,
      action_type: 'red_card',
      minute: 25,
    })
    expect(red.status).toBe(201)

    const secondRed = await as().post(`/api/events/${event}/logs`, {
      athlete_id: player.id,
      action_type: 'red_card',
      minute: 40,
    })
    expect(secondRed.status).toBe(400)
    expect(secondRed.body.error).toMatch(/already has a red card/)
  })
})

describe('match-day squad gate (11 starters + 5 bench)', () => {
  test('a full 16-player squad needs all 16 available; 15 of 16 is not enough', async () => {
    const athletes = []
    for (let i = 0; i < 16; i++) {
      athletes.push(await insertAthlete(squadId, `Player ${i}`))
    }

    const created = await as().post('/api/events', {
      title: 'Full squad match',
      opponent: 'United FC',
      format: 'match',
      event_type: 'match',
      event_date: dayKeyOf(2),
      event_time: '15:00',
    })
    expect(created.status).toBe(201)

    await seedAvailability(created.body.id, athletes.slice(0, 15))

    const short = await as().get(`/api/events/${created.body.id}`)
    expect(short.body.availability).toMatchObject({ required: 16, available: 15, meets: false })

    await seedAvailability(created.body.id, athletes)

    const full = await as().get(`/api/events/${created.body.id}`)
    expect(full.body.availability).toMatchObject({ required: 16, available: 16, meets: true })
  })

  test('a squad still recruiting is held to its size, not to 16', async () => {
    const small = (await seedCoach('small_coach')).squadId
    const a = await insertAthlete(small, 'One')
    const b = await insertAthlete(small, 'Two')
    const event = await insertEvent(small, userId, { status: 'scheduled', when: at(2) })

    await seedAvailability(event, [a, b])

    const res = await request(app)
      .get(`/api/events/${event}`)
      .set('x-test-clerk-user-id', 'small_coach')

    expect(res.body.availability).toMatchObject({ required: 2, available: 2, meets: true })
  })
})

describe('dashboard payloads: my live, opponent live, upcoming schedule', () => {
  test('summary separates my live match from other teams and lists up to 6 upcoming commitments', async () => {
    const rival = await seedCoach('rival_coach')
    await pool.query("UPDATE squads SET name = 'Rival FC' WHERE id = $1", [rival.squadId])

    // My live match — appears as liveEvent, never in otherLive.
    await insertEvent(squadId, userId, { status: 'live', when: at(0, 11), opponent: 'Alive FC' })

    // Rival's live match with a real scoreline (1-2).
    const rivalMatch = await insertEvent(rival.squadId, rival.userId, { status: 'live', when: at(0, 12), opponent: 'Dash Opponent' })
    const rivalStriker = await insertAthlete(rival.squadId, 'Rival Striker')
    await pool.query(
      `INSERT INTO log_entries (event_id, athlete_id, action_type, is_scoring, value, logged_by)
       VALUES ($1, $2, 'goal', true, 1, $3), ($1, NULL, 'goal', true, 2, $3)`,
      [rivalMatch, rivalStriker.id, rival.userId]
    )

    // Four scheduled commitments plus a league fixture away at the rival.
    for (const offset of [1, 3, 5, 7]) {
      await insertEvent(squadId, userId, { status: 'scheduled', when: at(offset, 15), opponent: `Opponent ${offset}` })
    }
    const league = await insertEvent(rival.squadId, rival.userId, { status: 'full', format: 'league', title: 'Dash League', when: at(0, 9) })
    await pool.query('INSERT INTO event_teams (event_id, squad_id) VALUES ($1, $2)', [league, squadId])
    const fixture = await pool.query(
      `INSERT INTO fixtures (event_id, home_squad_id, away_squad_id, event_date, status)
       VALUES ($1, $2, $3, $4, 'scheduled') RETURNING id`,
      [league, rival.squadId, squadId, wallClock(at(2, 17))]
    )

    const res = await as().get('/api/dashboard/summary?period=7d')

    expect(res.status).toBe(200)
    expect(res.body.liveEvent).toMatchObject({ kind: 'event', homeScore: 0, awayScore: 0 })

    expect(res.body.otherLive).toHaveLength(1)
    expect(res.body.otherLive[0]).toMatchObject({
      kind: 'match',
      squadName: 'Rival FC',
      squadScore: 1,
      opponentScore: 2,
    })

    expect(res.body.upcomingEvents).toHaveLength(5)
    expect(res.body.upcomingEvents[0]).toMatchObject({ kind: 'event', label: 'vs Opponent 1' })
    const fixtureItem = res.body.upcomingEvents.find((item) => item.kind === 'fixture')
    expect(fixtureItem.link).toBe(`/live/fixture/${fixture.rows[0].id}`)
    expect(fixtureItem.league).toBe('Dash League')
  })

  test('upcoming is capped at six items', async () => {
    for (let offset = 1; offset <= 9; offset++) {
      await insertEvent(squadId, userId, { status: 'scheduled', when: at(offset, 11), opponent: `Side ${offset}` })
    }

    const res = await as().get('/api/dashboard/summary?period=7d')

    expect(res.status).toBe(200)
    expect(res.body.upcomingEvents).toHaveLength(6)
    expect(res.body.upcomingEvents[0].label).toBe('vs Side 1')
  })
})

describe('public payloads: upcoming schedule and squad CSV', () => {
  async function seedPublicSquad(clerkId, name, isPublic) {
    const seeded = await seedCoach(clerkId)
    await pool.query('UPDATE squads SET name = $1, is_public = $2 WHERE id = $3', [name, isPublic, seeded.squadId])
    return seeded
  }

  test('landing payload lists the next six upcoming matches across public squads only', async () => {
    const rovers = await seedPublicSquad('land_rovers', 'Rovers FC', true)
    const secret = await seedPublicSquad('land_secret', 'Secret SC', false)

    await insertEvent(rovers.squadId, rovers.userId, { status: 'scheduled', when: at(2, 15), opponent: 'United FC' })

    // A league fixture involving a public side (away) is listed too.
    const league = await insertEvent(secret.squadId, secret.userId, { status: 'full', format: 'league', title: 'Land League', when: at(0, 9) })
    await pool.query('INSERT INTO event_teams (event_id, squad_id) VALUES ($1, $2)', [league, rovers.squadId])
    await pool.query(
      `INSERT INTO fixtures (event_id, home_squad_id, away_squad_id, event_date, status)
       VALUES ($1, $2, $3, $4, 'scheduled')`,
      [league, secret.squadId, rovers.squadId, wallClock(at(3, 17))]
    )

    // Private squad business never surfaces.
    await insertEvent(secret.squadId, secret.userId, { status: 'scheduled', when: at(4, 15), opponent: 'Hidden Opponent' })

    const res = await request(app).get('/api/public/squads')

    expect(res.status).toBe(200)
    expect(res.body.upcoming).toHaveLength(2)
    expect(res.body.upcoming[0]).toMatchObject({ kind: 'match', squadName: 'Rovers FC', opponent: 'United FC' })
    expect(res.body.upcoming[1]).toMatchObject({ kind: 'fixture', homeName: 'Secret SC', awayName: 'Rovers FC', league: 'Land League' })
  })

  test('directory CSV export downloads the roster; private squads are not exportable', async () => {
    const rovers = await seedPublicSquad('csv_rovers', 'Rovers FC', true)
    const secret = await seedPublicSquad('csv_secret', 'Secret SC', false)
    await insertAthlete(rovers.squadId, 'R Striker', { position: 'Forward', squadNumber: 9 })
    await insertAthlete(secret.squadId, 'H Striker')

    const res = await request(app).get(`/api/public/squads/${rovers.squadId}/export.csv`)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    expect(res.headers['content-disposition']).toMatch(/rovers-fc-roster\.csv/)
    expect(res.text.split('\r\n')[0]).toBe('Name,Position,Squad #,Appearances,Goals,Assists,Yellow cards,Red cards')
    expect(res.text).toContain('R Striker,Forward,9')

    const hidden = await request(app).get(`/api/public/squads/${secret.squadId}/export.csv`)
    expect(hidden.status).toBe(404)
  })
})
