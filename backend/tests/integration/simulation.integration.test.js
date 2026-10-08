import { describe, test, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import { pool, resetDatabase, seedCoach, seedAvailability } from './setup'

import eventsRouter from '../../src/routes/events'
import fixturesRouter from '../../src/routes/fixtures'
import athletesRouter from '../../src/routes/athletes'
import squadsRouter from '../../src/routes/squads'
import ratings from '../../src/lib/ratings'
import simulation from '../../src/lib/match-simulation'

const app = express()
app.use(express.json())
app.use('/api/events', eventsRouter)
app.use('/api/fixtures', fixturesRouter)
app.use('/api/athletes', athletesRouter)
app.use('/api/squads', squadsRouter)

const COACH_HEADER = 'x-test-clerk-user-id'
const COACH = 'test_clerk_user'
const POSITIONS = ['GK', 'CB', 'CB', 'FB', 'FB', 'DM', 'CM', 'AM', 'W', 'W', 'ST', 'ST']

let squadId
let originalFetch
// Every lookup the simulator makes against the ratings dataset, in order.
let fetchCalls
// Per-test stand-in for the ratings dataset response body.
let datasetHandler

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
  originalFetch = global.fetch
})

beforeEach(async () => {
  await resetDatabase()
  const seeded = await seedCoach()
  squadId = seeded.squadId

  fetchCalls = []
  // Default dataset behaviour: the API answers, but knows nobody, so every
  // player falls back to the positional estimate.
  datasetHandler = () => ({ rows: [] })
  global.fetch = async (url) => {
    fetchCalls.push(String(url))
    return { ok: true, status: 200, json: async () => datasetHandler(String(url)) }
  }
})

afterEach(() => {
  global.fetch = originalFetch
})

afterAll(async () => {
  await pool.end()
})

// The datasets-server serialises its single-column datasets as one delimited
// string per row, header and value carrying the same blank.
function datasetRow({ name, position, overall, id = 1 }) {
  return {
    row: {
      'player_id;name;nationality;position;overall;age;hits;potential;team':
        `${id};${name};Nowhere;${position};${overall};25;1;${overall};"Test FC "`,
    },
  }
}

function datasetKnows(name, { position = 'ST', overall = 88 } = {}) {
  datasetHandler = () => ({ rows: [datasetRow({ name, position, overall })] })
}

async function seedRoster(targetSquadId, { count = 12, nameFor } = {}) {
  const athletes = []
  for (let i = 0; i < count; i++) {
    const name = nameFor ? nameFor(i) : `Squad Player ${i + 1}`
    const res = await pool.query(
      `INSERT INTO athletes (squad_id, name, squad_number, position)
       VALUES ($1, $2, $3, $4) RETURNING id, name, position`,
      [targetSquadId, name, i + 1, POSITIONS[i % POSITIONS.length]]
    )
    athletes.push(res.rows[0])
  }
  return athletes
}

// A two-team league with a fixture where the seeded coach is the home side.
async function createLeague({ homeNameFor } = {}) {
  const mySquad = await request(app).get('/api/squads/mine').set(COACH_HEADER, COACH)
  const homeAthletes = await seedRoster(mySquad.body.id, { nameFor: homeNameFor })

  const created = await request(app)
    .post('/api/events')
    .set(COACH_HEADER, COACH)
    .send({
      title: 'Simulation Test League',
      format: 'league',
      required_teams: 2,
      event_date: new Date().toISOString(),
    })
  const eventId = created.body.id

  await pool.query("INSERT INTO users (clerk_id, role) VALUES ('coach_two', 'coach')")
  const squad2 = await pool.query(
    'INSERT INTO squads (coach_id, name) VALUES ((SELECT id FROM users WHERE clerk_id = $1), $2) RETURNING id',
    ['coach_two', 'Coach Two Squad']
  )
  const awayAthletes = await seedRoster(squad2.rows[0].id)

  await request(app).post(`/api/events/${eventId}/join`).set('x-test-clerk-user-id', 'coach_two')

  const detail = await request(app).get(`/api/events/${eventId}`).set(COACH_HEADER, COACH)
  const creatorSquadId = detail.body.teams.find((t) => t.is_mine).squad_id
  const homeFixture = detail.body.fixtures.find((f) => f.home_squad_id === creatorSquadId)

  // The availability gate reads the home squad's RSVPs on the league event;
  // a fully available squad keeps fixtures starting as before.
  await seedAvailability(eventId, homeAthletes)

  return { eventId, fixtureId: homeFixture.id, homeAthletes, awayAthletes }
}

// First 11 in the starting XI per side, the 12th on the bench.
async function setFixtureLineup(fixtureId) {
  const detail = await request(app).get(`/api/fixtures/${fixtureId}`).set(COACH_HEADER, COACH)

  const build = (roster, side) => roster.map((a, i) => ({
    athlete_id: a.id,
    team_side: side,
    is_starter: i < 11,
    pos_x: i < 11 ? 10 + (i % 4) * 26 : null,
    pos_y: i < 11 ? (side === 'home' ? 8 + Math.floor(i / 4) * 24 : 92 - Math.floor(i / 4) * 24) : null,
  }))

  const res = await request(app)
    .put(`/api/fixtures/${fixtureId}/lineup`)
    .set(COACH_HEADER, COACH)
    .send({
      lineups: [...build(detail.body.rosters.home, 'home'), ...build(detail.body.rosters.away, 'away')],
    })

  expect(res.status).toBe(200)
  return { home: detail.body.rosters.home, away: detail.body.rosters.away }
}

async function createSimpleEvent() {
  const res = await pool.query(
    `INSERT INTO events (squad_id, opponent, event_type, event_date, created_by)
     VALUES ($1, 'Riverside FC', 'match', $2, (SELECT id FROM users WHERE clerk_id = $3))
     RETURNING *`,
    [squadId, new Date(), 'test_clerk_user']
  )
  return res.rows[0]
}

async function setEventLineup(eventId, athletes) {
  const res = await request(app)
    .put(`/api/events/${eventId}/lineup`)
    .set(COACH_HEADER, COACH)
    .send({
      lineups: athletes.map((a, i) => ({
        athlete_id: a.id,
        team_side: 'home',
        is_starter: i < 11,
        pos_x: i < 11 ? 10 + (i % 4) * 26 : null,
        pos_y: i < 11 ? 8 + Math.floor(i / 4) * 24 : null,
      })),
    })

  expect(res.status).toBe(200)
}

function simulateFixture(fixtureId, mode = 'quick') {
  return request(app).post(`/api/fixtures/${fixtureId}/simulate`).set(COACH_HEADER, COACH).send({ mode })
}

function simulateEvent(eventId, mode = 'quick') {
  return request(app).post(`/api/events/${eventId}/simulate`).set(COACH_HEADER, COACH).send({ mode })
}

// The script is shaped like the POST /logs body on purpose: replaying it must
// be indistinguishable from a coach logging the same match by hand.
function logBody(event) {
  const body = {
    athlete_id: event.athlete_id,
    action_type: event.action_type,
    is_scoring: event.is_scoring,
    minute: event.minute,
  }
  if (event.assist_athlete_id) body.assist_athlete_id = event.assist_athlete_id
  if (event.substitute_athlete_id) body.substitute_athlete_id = event.substitute_athlete_id
  return body
}

describe('player ratings from the external dataset', () => {
  test('a player the dataset knows is rated from it and cached for the next simulation', async () => {
    datasetKnows('Lionel Messi', { position: 'ST|CF|RW', overall: 94 })
    const { fixtureId, homeAthletes } = await createLeague({
      homeNameFor: (i) => (i === 0 ? 'Lionel Messi' : `Squad Player ${i + 1}`),
    })
    await setFixtureLineup(fixtureId)

    const first = await simulateFixture(fixtureId)
    expect(first.status).toBe(200)

    const messiId = homeAthletes[0].id
    expect(first.body.ratings[messiId]).toMatchObject({ overall: 94, source: 'dataset' })
    expect(fetchCalls.filter((url) => url.includes('Lionel'))).toHaveLength(1)

    const cached = await pool.query(
      'SELECT overall, source, position FROM player_ratings WHERE name_normalized = $1',
      ['lionel messi']
    )
    expect(cached.rows[0]).toMatchObject({ overall: 94, source: 'dataset', position: 'ST|CF|RW' })

    // Every name is cached now, so the next simulation costs zero lookups —
    // the external API is only ever asked for a name it was never asked for.
    const callsBefore = fetchCalls.length
    const second = await simulateFixture(fixtureId, 'timed')
    expect(second.status).toBe(200)
    expect(second.body.mode).toBe('timed')
    expect(fetchCalls.length).toBe(callsBefore)
    expect(second.body.ratings[messiId]).toMatchObject({ overall: 94, source: 'dataset' })
  })

  test('names the dataset does not know are estimated from position, between 70 and 85', async () => {
    const { fixtureId, homeAthletes } = await createLeague()
    await setFixtureLineup(fixtureId)

    const res = await simulateFixture(fixtureId)
    expect(res.status).toBe(200)

    const values = Object.values(res.body.ratings)
    expect(values.length).toBeGreaterThanOrEqual(23)
    for (const rating of values) {
      expect(rating.source).toBe('estimated')
      expect(rating.overall).toBeGreaterThanOrEqual(70)
      expect(rating.overall).toBeLessThanOrEqual(85)
    }

    // The estimate is derived from the player, not from the running order:
    // the same name always lands on the same number.
    expect(res.body.ratings[homeAthletes[0].id]).toMatchObject({
      source: 'estimated',
      position: 'GK',
    })
    expect(res.body.ratings[homeAthletes[0].id].overall).toBe(
      ratings.estimateRating(homeAthletes[0].name, homeAthletes[0].position).overall
    )
  })

  test('an unreachable dataset still simulates — on estimates, caching nothing', async () => {
    datasetHandler = () => {
      throw new Error('getaddrinfo ENOTFOUND datasets-server.huggingface.co')
    }
    const { fixtureId } = await createLeague()
    await setFixtureLineup(fixtureId)

    const res = await simulateFixture(fixtureId)
    expect(res.status).toBe(200)
    for (const rating of Object.values(res.body.ratings)) {
      expect(rating.source).toBe('estimated')
    }

    // One outage must not cost one timeout per player: the first failure
    // stops the lookups for the rest of the run.
    expect(fetchCalls.length).toBeLessThanOrEqual(4)

    const cached = await pool.query('SELECT COUNT(*)::int AS count FROM player_ratings')
    expect(cached.rows[0].count).toBe(0)
  })

  test('a lookup that times out is retried once before falling back', async () => {
    // The public dataset server is slow on a cold query: the first request
    // hangs until its own deadline aborts it, the retry answers.
    let calls = 0
    global.fetch = async (url, options) => {
      calls += 1
      if (calls === 1) {
        return new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const error = new Error('This operation was aborted')
            error.name = 'AbortError'
            reject(error)
          })
        })
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ rows: [datasetRow({ name: 'Lionel Messi', position: 'ST', overall: 94 })] }),
      }
    }

    const found = await ratings.ensureRatings(
      pool,
      [{ id: 1, name: 'Lionel Messi', position: 'ST' }],
      { timeoutMs: 20 }
    )

    expect(calls).toBe(2)
    expect(found.get(1)).toMatchObject({ overall: 94, source: 'dataset' })
  })

  test('a hard failure is not retried — the circuit breaker covers it', async () => {
    let calls = 0
    global.fetch = async () => {
      calls += 1
      throw new Error('getaddrinfo ENOTFOUND datasets-server.huggingface.co')
    }

    const unknown = await ratings.ensureRatings(
      pool,
      [{ id: 2, name: 'Nobody At All', position: 'CM' }],
      { timeoutMs: 20 }
    )

    expect(calls).toBe(1)
    expect(unknown.get(2)).toMatchObject({ source: 'estimated' })
  })
})

describe('simulation engine', () => {
  test('a higher-rated side carries a bigger goal expectancy', () => {
    expect(simulation.expectedGoals(85, 70, 0.12)).toBeGreaterThan(
      simulation.expectedGoals(70, 85, 0)
    )
    expect(simulation.expectedGoals(78, 78, 0)).toBeCloseTo(1.25, 5)
    expect(simulation.expectedGoals(60, 90, 0)).toBeGreaterThanOrEqual(0.15)
  })

  test('every event lands inside 90 minutes on a squad player, in order', () => {
    const squad = (prefix, rating) => ({
      starters: POSITIONS.map((position, i) => ({
        athlete_id: `${prefix}-s${i + 1}`,
        name: `${prefix} Starter ${i + 1}`,
        position,
        rating,
      })),
      bench: ['ST', 'CM', 'CB'].map((position, i) => ({
        athlete_id: `${prefix}-b${i + 1}`,
        name: `${prefix} Bench ${i + 1}`,
        position,
        rating,
      })),
    })

    const ids = new Set([
      ...squad('h', 80).starters, ...squad('h', 80).bench,
      ...squad('a', 76).starters, ...squad('a', 76).bench,
    ].map((player) => player.athlete_id))

    const { events, summary } = simulation.simulateMatch({
      home: squad('h', 80),
      away: squad('a', 76),
    })

    expect(events.length).toBeGreaterThan(6)
    const minutes = events.map((event) => event.minute)
    expect([...minutes].sort((a, b) => a - b)).toEqual(minutes)
    for (const event of events) {
      expect(event.minute).toBeGreaterThanOrEqual(1)
      expect(event.minute).toBeLessThanOrEqual(90)
      if (event.athlete_id !== null) expect(ids.has(event.athlete_id)).toBe(true)
    }

    const goals = events.filter((event) => event.action_type === 'goal')
    expect(summary.homeGoals).toBe(goals.filter((e) => e.team_side === 'home').length)
    expect(summary.awayGoals).toBe(goals.filter((e) => e.team_side === 'away').length)
  })

  test('nothing is seeded — two runs of the same squads differ', () => {
    const squad = (prefix, rating) => ({
      starters: POSITIONS.map((position, i) => ({
        athlete_id: `${prefix}-s${i + 1}`,
        name: `${prefix} Starter ${i + 1}`,
        position,
        rating,
      })),
      bench: ['ST', 'CM', 'CB'].map((position, i) => ({
        athlete_id: `${prefix}-b${i + 1}`,
        name: `${prefix} Bench ${i + 1}`,
        position,
        rating,
      })),
    })

    const home = squad('h', 80)
    const away = squad('a', 76)
    const first = simulation.simulateMatch({ home, away })
    const second = simulation.simulateMatch({ home, away })

    expect(JSON.stringify(second.events)).not.toBe(JSON.stringify(first.events))
  })

  test('an unknown position still lands inside the estimate band', () => {
    const rating = ratings.estimateRating('No Position Guy', null)
    expect(rating.source).toBe('estimated')
    expect(rating.overall).toBeGreaterThanOrEqual(ratings.ESTIMATE_MIN)
    expect(rating.overall).toBeLessThanOrEqual(ratings.ESTIMATE_MAX)
    expect(ratings.positionGroup('goalkeeper')).toBe('GK')
    expect(ratings.positionGroup('Centre-Back')).toBe('CB')
    expect(ratings.positionGroup('Left Wing')).toBe('W')
    expect(ratings.normalizeName('  Kylian  Mbappé ')).toBe('kylian mbappe')
  })
})

describe('fixture simulation', () => {
  test('needs the lineups first, and only the home coach may ask', async () => {
    const { fixtureId } = await createLeague()

    const noLineup = await simulateFixture(fixtureId)
    expect(noLineup.status).toBe(400)
    expect(noLineup.body.error).toBe('Set the starting lineups before simulating')

    await setFixtureLineup(fixtureId)

    const away = await request(app)
      .post(`/api/fixtures/${fixtureId}/simulate`)
      .set('x-test-clerk-user-id', 'coach_two')
      .send({ mode: 'quick' })

    expect(away.status).toBe(403)
    expect(away.body.error).toBe('Only the home team can simulate this fixture')
  })

  // Replaying a script means one request per log entry, which needs more
  // headroom than the default per-test timeout.
  test('a scripted match replays through the log endpoint and lands on the board', async () => {
    const { fixtureId } = await createLeague()
    await setFixtureLineup(fixtureId)

    const script = await simulateFixture(fixtureId)
    expect(script.status).toBe(200)
    expect(script.body.mode).toBe('quick')
    expect(script.body.events.length).toBeGreaterThan(0)

    for (const event of script.body.events) {
      const res = await request(app)
        .post(`/api/fixtures/${fixtureId}/logs`)
        .set(COACH_HEADER, COACH)
        .send(logBody(event))

      expect(res.status, `${event.minute}' ${event.action_type} was rejected`).toBe(201)
    }

    const detail = await request(app).get(`/api/fixtures/${fixtureId}`).set(COACH_HEADER, COACH)
    expect(detail.status).toBe(200)
    expect(detail.body.fixture.status).toBe('live')
    expect(detail.body.result.home).toBe(script.body.summary.homeGoals)
    expect(detail.body.result.away).toBe(script.body.summary.awayGoals)

    // Simulating starts a waiting fixture, so the coach can still finish it
    // through the same PATCH the manual flow uses.
    const completed = await request(app)
      .patch(`/api/fixtures/${fixtureId}`)
      .set(COACH_HEADER, COACH)
      .send({ status: 'completed' })
    expect(completed.status).toBe(200)
    expect(completed.body.status).toBe('completed')

    const afterFinish = await simulateFixture(fixtureId)
    expect(afterFinish.status).toBe(400)
    expect(afterFinish.body.error).toBe('This fixture has already finished')
  }, 30000)

  test('two simulations of the same fixture are never the same match', async () => {
    const { fixtureId } = await createLeague()
    await setFixtureLineup(fixtureId)

    const first = await simulateFixture(fixtureId)
    const second = await simulateFixture(fixtureId)
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)

    expect(JSON.stringify(second.body.events)).not.toBe(JSON.stringify(first.body.events))
  })
})

describe('simple event simulation', () => {
  test('simulates against a generic opponent and replays with unassigned opponent actions', async () => {
    const athletes = await seedRoster(squadId)
    const event = await createSimpleEvent()
    // Availability gate: enough players marked available for the XI save to
    // start the match, exactly as a real squad would have RSVP'd.
    await seedAvailability(event.id, athletes)
    await setEventLineup(event.id, athletes)

    const script = await simulateEvent(event.id)
    expect(script.status).toBe(200)
    expect(script.body.summary.opponentRating).toBeGreaterThanOrEqual(72)
    expect(script.body.summary.opponentRating).toBeLessThanOrEqual(82)

    for (const entry of script.body.events) {
      const res = await request(app).post(`/api/events/${event.id}/logs`).set(COACH_HEADER, COACH).send(logBody(entry))
      expect(res.status, `${entry.minute}' ${entry.action_type} was rejected`).toBe(201)
    }

    // The opponent has no roster, so their moments are recorded exactly like
    // manual logging records them: no athlete attached.
    const opponentRows = await pool.query(
      'SELECT COUNT(*)::int AS count FROM log_entries WHERE event_id = $1 AND athlete_id IS NULL',
      [event.id]
    )
    const opponentEvents = script.body.events.filter((entry) => entry.team_side === 'away')
    expect(opponentEvents.length).toBeGreaterThan(0)
    expect(opponentRows.rows[0].count).toBe(opponentEvents.length)
  }, 30000)

  test('needs a lineup first', async () => {
    const event = await createSimpleEvent()

    const res = await simulateEvent(event.id)
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Set the starting lineup before simulating')
  })

  test('league events are simulated through their fixtures instead', async () => {
    const { eventId } = await createLeague()

    const res = await simulateEvent(eventId)
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Use fixture endpoints to simulate league matches')
  })
})
