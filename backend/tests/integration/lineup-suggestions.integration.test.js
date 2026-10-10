import { describe, test, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import { pool, resetDatabase, seedCoach, seedAvailability } from './setup'

import eventsRouter from '../../src/routes/events'
import fixturesRouter from '../../src/routes/fixtures'
import squadsRouter from '../../src/routes/squads'

const app = express()
app.use(express.json())
app.use('/api/events', eventsRouter)
app.use('/api/fixtures', fixturesRouter)
app.use('/api/squads', squadsRouter)

const COACH_HEADER = 'x-test-clerk-user-id'
const COACH_ID = 'test_clerk_user'

let squadId
let originalFetch
let datasetHandler

// Controlled overalls for the players the ordering assertions depend on.
// Every other name falls back to the positional estimate, exactly as in
// production when the dataset does not know a player.
const RATED = {
  'Alice Keeper': 80,
  'Bea Back': 79,
  'Cara Fullback': 76,
  'Dana Defender': 78,
  'Elin Flank': 77,
  'Fay Mid': 77,
  'Gina Playmaker': 82,
  'Hana Holder': 80,
  'Isla Wide': 78,
  'Kit Winger': 84,
  'Ola Hotfoot': 72,
  'Jo Striker': 75,
  'Lara Spare': 70,
  'Mia Injured': 90,
  'Nia Out': 88,
}

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

  // The ratings dataset answers, knowing exactly the players in RATED.
  datasetHandler = (url) => {
    const query = new URL(url).searchParams.get('query')
    const overall = RATED[query]
    if (overall == null) return { rows: [] }
    return {
      rows: [
        {
          row: {
            'player_id;name;nationality;position;overall;age;hits;potential;team':
              `${overall};${query};Nowhere;CM;${overall};25;1;${overall};"Test FC "`,
          },
        },
      ],
    }
  }
  global.fetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () => datasetHandler(String(url)),
  })
})

afterEach(() => {
  global.fetch = originalFetch
})

afterAll(async () => {
  await pool.end()
})

async function addAthlete(name, position, squadNumber) {
  const res = await pool.query(
    'INSERT INTO athletes (squad_id, name, position, squad_number) VALUES ($1, $2, $3, $4) RETURNING id',
    [squadId, name, position, squadNumber]
  )
  return { id: res.rows[0].id, name }
}

async function createMatchEvent() {
  const res = await pool.query(
    `INSERT INTO events (squad_id, opponent, event_type, event_date, created_by)
     VALUES ($1, 'Riverside FC', 'match', now() + interval '2 days',
             (SELECT id FROM users WHERE clerk_id = 'test_clerk_user'))
     RETURNING *`,
    [squadId]
  )
  return res.rows[0]
}

async function injure(athleteId, daysOut = 14) {
  await pool.query(
    `INSERT INTO injuries (athlete_id, description, date_sustained, severity, return_date, logged_by)
     VALUES ($1, 'Rolled ankle in training', CURRENT_DATE - 2, 'moderate', CURRENT_DATE + $2::int,
             (SELECT id FROM users WHERE clerk_id = 'test_clerk_user'))`,
    [athleteId, daysOut]
  )
}

// Recent goal involvement on a completed match inside the form window.
async function seedForm(athleteId, { goals = 0, assists = 0 } = {}) {
  const past = await pool.query(
    `INSERT INTO events (squad_id, opponent, event_type, event_date, status, created_by)
     VALUES ($1, 'Old Rivals', 'match', now() - interval '5 days', 'completed',
             (SELECT id FROM users WHERE clerk_id = 'test_clerk_user'))
     RETURNING *`,
    [squadId]
  )
  const eventId = past.rows[0].id
  if (goals > 0) {
    await pool.query(
      `INSERT INTO log_entries (event_id, athlete_id, action_type, is_scoring, value, logged_by)
       VALUES ($1, $2, 'goal', true, $3, (SELECT id FROM users WHERE clerk_id = 'test_clerk_user'))`,
      [eventId, athleteId, goals]
    )
  }
  if (assists > 0) {
    await pool.query(
      `INSERT INTO log_entries (event_id, athlete_id, action_type, is_scoring, value, logged_by)
       VALUES ($1, $2, 'assist', false, $3, (SELECT id FROM users WHERE clerk_id = 'test_clerk_user'))`,
      [eventId, athleteId, assists]
    )
  }
}

// A two-squad league with a home fixture for this coach — the same shape the
// lineup gate tests use.
async function createLeagueWithRosters() {
  await pool.query("INSERT INTO users (clerk_id, role) VALUES ('coach_two', 'coach')")
  const awaySquad = await pool.query(
    'INSERT INTO squads (coach_id, name) VALUES ((SELECT id FROM users WHERE clerk_id = $1), $2) RETURNING id',
    ['coach_two', 'Coach Two Squad']
  )

  const homeAthletes = []
  for (let i = 0; i < 12; i++) {
    const res = await pool.query(
      'INSERT INTO athletes (squad_id, name, squad_number) VALUES ($1, $2, $3) RETURNING id',
      [squadId, `Home Player ${i + 1}`, i + 1]
    )
    homeAthletes.push({ id: res.rows[0].id, name: `Home Player ${i + 1}` })
  }
  const awayAthletes = []
  for (let i = 0; i < 12; i++) {
    const res = await pool.query(
      'INSERT INTO athletes (squad_id, name, squad_number) VALUES ($1, $2, $3) RETURNING id',
      [awaySquad.rows[0].id, `Away Player ${i + 1}`, i + 1]
    )
    awayAthletes.push({ id: res.rows[0].id, name: `Away Player ${i + 1}` })
  }

  const created = await request(app)
    .post('/api/events')
    .set(COACH_HEADER, COACH_ID)
    .send({
      title: 'Suggestion League',
      format: 'league',
      required_teams: 2,
      event_date: new Date().toISOString(),
    })
  const eventId = created.body.id

  await request(app)
    .post(`/api/events/${eventId}/join`)
    .set(COACH_HEADER, 'coach_two')

  const detail = await request(app)
    .get(`/api/events/${eventId}`)
    .set(COACH_HEADER, COACH_ID)
  const homeFixture = detail.body.fixtures.find((f) => f.home_squad_id === squadId)

  return { eventId, fixtureId: homeFixture.id, homeAthletes, awayAthletes }
}

describe('GET /api/events/:id/lineup/suggestions', () => {
  test('builds a 4-4-2 from RSVPs, injuries, form and ratings', async () => {
    const event = await createMatchEvent()

    const alice = await addAthlete('Alice Keeper', 'Goalkeeper', 1)
    const bea = await addAthlete('Bea Back', 'Centre Back', 2)
    const cara = await addAthlete('Cara Fullback', 'Right Back', 3)
    const dana = await addAthlete('Dana Defender', 'Centre Back', 4)
    const elin = await addAthlete('Elin Flank', 'Left Back', 5)
    const fay = await addAthlete('Fay Mid', 'Midfielder', 6)
    const gina = await addAthlete('Gina Playmaker', 'Attacking Midfielder', 7)
    // 'Holding Midfielder' (not 'Defensive Midfielder' — the platform's
    // position mapper reads that as a centre-back) keeps the band maths clean.
    const hana = await addAthlete('Hana Holder', 'Holding Midfielder', 8)
    const isla = await addAthlete('Isla Wide', 'Left Midfielder', 9)
    const kit = await addAthlete('Kit Winger', 'Left Winger', 10)
    const ola = await addAthlete('Ola Hotfoot', 'Striker', 11)
    const jo = await addAthlete('Jo Striker', 'Striker', 12)
    const lara = await addAthlete('Lara Spare', 'Midfielder', 13)
    const mia = await addAthlete('Mia Injured', 'Striker', 14)
    const nia = await addAthlete('Nia Out', 'Midfielder', 15)

    // Everyone confirms except Nia (a no) and Kit (no reply yet).
    await seedAvailability(event.id, [
      alice, bea, cara, dana, elin, fay, gina, hana, isla, ola, jo, lara, mia,
    ])
    await seedAvailability(event.id, [nia], 'unavailable')

    // Mia is the best striker on paper — and on the treatment table.
    await injure(mia.id)

    // Ola's red-hot month: 4 goals + 2 assists on a match played last week.
    await seedForm(ola.id, { goals: 4, assists: 2 })

    const res = await request(app)
      .get(`/api/events/${event.id}/lineup/suggestions`)
      .set(COACH_HEADER, COACH_ID)

    expect(res.status).toBe(200)
    expect(res.body.formation).toBe('4-4-2')
    expect(res.body.xi).toHaveLength(11)

    // Defence-first slot order: one keeper, four defenders, four
    // midfielders, two forwards.
    expect(res.body.xi.map((p) => p.band)).toEqual([
      'GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD',
    ])
    expect(res.body.xi[0].athlete_id).toBe(alice.id)

    // Form outranks rating: Ola (72 overall) takes a forward slot ahead of
    // the higher-rated but cold Jo (75).
    const fwdIds = res.body.xi.filter((p) => p.band === 'FWD').map((p) => p.athlete_id)
    expect(fwdIds).toContain(kit.id)
    expect(fwdIds).toContain(ola.id)
    expect(fwdIds).not.toContain(jo.id)

    // The injured and the unavailable never make the squad…
    const squadIds = new Set([...res.body.xi, ...res.body.bench].map((p) => p.athlete_id))
    expect(squadIds.has(mia.id)).toBe(false)
    expect(squadIds.has(nia.id)).toBe(false)

    // …but they are listed with the reason.
    expect(res.body.excluded.map((p) => p.athlete_id)).toEqual(expect.arrayContaining([mia.id, nia.id]))
    expect(res.body.excluded.find((p) => p.athlete_id === mia.id).reason).toMatch(/injured — expected back/)
    expect(res.body.excluded.find((p) => p.athlete_id === nia.id).reason).toMatch(/unavailable/)

    // The bench keeps the next-best eligible players — never the excluded.
    const benchIds = res.body.bench.map((p) => p.athlete_id)
    expect(benchIds).toEqual(expect.arrayContaining([jo.id, lara.id]))

    // Every pick carries its own explanation.
    const kitEntry = res.body.xi.find((p) => p.athlete_id === kit.id)
    expect(kitEntry.reason).toContain('84 overall')
    expect(kitEntry.reason).toContain('no RSVP yet')
    const olaEntry = res.body.xi.find((p) => p.athlete_id === ola.id)
    expect(olaEntry.reason).toContain('6 goal involvements')
  })

  test('fills short bands out of position and says so', async () => {
    const event = await createMatchEvent()
    const squad = []
    for (let i = 0; i < 12; i++) {
      squad.push(await addAthlete(`Midfield Only ${i + 1}`, 'Midfielder', i + 1))
    }
    await seedAvailability(event.id, squad)

    const res = await request(app)
      .get(`/api/events/${event.id}/lineup/suggestions`)
      .set(COACH_HEADER, COACH_ID)

    expect(res.status).toBe(200)
    expect(res.body.xi).toHaveLength(11)

    // A squad of pure midfielders still gets a full XI: the keeper and
    // defensive slots are backfilled and flagged.
    const keeper = res.body.xi[0]
    expect(keeper.band).toBe('GK')
    expect(keeper.naturalBand).toBe('MID')
    expect(keeper.outOfPosition).toBe(true)
    expect(keeper.reason).toContain('out of position')

    const mids = res.body.xi.filter((p) => p.band === 'MID')
    expect(mids).toHaveLength(4)
    expect(mids.every((p) => p.outOfPosition === false)).toBe(true)
    expect(res.body.bench).toHaveLength(1)
  })

  test('returns an empty suggestion set for a squad with no players', async () => {
    const event = await createMatchEvent()

    const res = await request(app)
      .get(`/api/events/${event.id}/lineup/suggestions`)
      .set(COACH_HEADER, COACH_ID)

    expect(res.status).toBe(200)
    expect(res.body.xi).toEqual([])
    expect(res.body.bench).toEqual([])
    expect(res.body.excluded).toEqual([])
    expect(res.body.basis.considered).toBe(0)
  })

  test('league events are pointed at the fixture endpoint', async () => {
    const league = await pool.query(
      `INSERT INTO events (squad_id, title, format, event_type, event_date, status, required_teams, created_by)
       VALUES ($1, 'Suggestion League', 'league', 'league', now() + interval '7 days', 'full', 2,
               (SELECT id FROM users WHERE clerk_id = 'test_clerk_user'))
       RETURNING *`,
      [squadId]
    )

    const res = await request(app)
      .get(`/api/events/${league.rows[0].id}/lineup/suggestions`)
      .set(COACH_HEADER, COACH_ID)

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/fixture/i)
  })

  test("another squad's event is invisible", async () => {
    const event = await createMatchEvent()
    await pool.query("INSERT INTO users (clerk_id, role) VALUES ('coach_two', 'coach')")
    await pool.query(
      "INSERT INTO squads (coach_id, name) VALUES ((SELECT id FROM users WHERE clerk_id = 'coach_two'), 'Other Squad')"
    )

    const res = await request(app)
      .get(`/api/events/${event.id}/lineup/suggestions`)
      .set(COACH_HEADER, 'coach_two')

    expect(res.status).toBe(404)
  })
})

describe('GET /api/fixtures/:id/lineup/suggestions', () => {
  test('suggests for the home side, reading RSVPs from the league event', async () => {
    const { eventId, fixtureId, homeAthletes } = await createLeagueWithRosters()
    await seedAvailability(eventId, homeAthletes)

    const res = await request(app)
      .get(`/api/fixtures/${fixtureId}/lineup/suggestions`)
      .set(COACH_HEADER, COACH_ID)

    expect(res.status).toBe(200)
    expect(res.body.xi).toHaveLength(11)
    expect(res.body.basis.considered).toBe(12)

    // Only home players can appear — the away roster never leaks in.
    const homeIds = new Set(homeAthletes.map((a) => a.id))
    for (const entry of [...res.body.xi, ...res.body.bench]) {
      expect(homeIds.has(entry.athlete_id)).toBe(true)
    }
  })

  test('the away coach cannot request suggestions for the home side', async () => {
    const { eventId, fixtureId, homeAthletes } = await createLeagueWithRosters()
    await seedAvailability(eventId, homeAthletes)

    const res = await request(app)
      .get(`/api/fixtures/${fixtureId}/lineup/suggestions`)
      .set(COACH_HEADER, 'coach_two')

    expect(res.status).toBe(403)
  })
})
