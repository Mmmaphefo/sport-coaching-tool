import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import { pool, resetDatabase, seedCoach, seedAvailability } from './setup'

import eventsRouter from '../../src/routes/events'
import fixturesRouter from '../../src/routes/fixtures'
import athletesRouter from '../../src/routes/athletes'
import squadsRouter from '../../src/routes/squads'

const app = express()
app.use(express.json())
app.use('/api/events', eventsRouter)
app.use('/api/fixtures', fixturesRouter)
app.use('/api/athletes', athletesRouter)
app.use('/api/squads', squadsRouter)

let squadId

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
  const seeded = await seedCoach()
  squadId = seeded.squadId
})

afterAll(async () => {
  await pool.end()
})

async function seedRoster(targetSquadId, count = 12) {
  const athletes = []
  for (let i = 0; i < count; i++) {
    const res = await pool.query(
      `INSERT INTO athletes (squad_id, name, squad_number) VALUES ($1, $2, $3) RETURNING id`,
      [targetSquadId, `Squad Player ${i + 1}`, i + 1]
    )
    athletes.push({ id: res.rows[0].id, name: `Squad Player ${i + 1}` })
  }
  return athletes
}

async function createLeague() {
  const mySquad = await request(app)
    .get('/api/squads/mine')
    .set('x-test-clerk-user-id', 'test_clerk_user')
  const homeAthletes = await seedRoster(mySquad.body.id)

  const created = await request(app)
    .post('/api/events')
    .set('x-test-clerk-user-id', 'test_clerk_user')
    .send({
      title: 'Lineup Test League',
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

  await request(app)
    .post(`/api/events/${eventId}/join`)
    .set('x-test-clerk-user-id', 'coach_two')

  const detail = await request(app)
    .get(`/api/events/${eventId}`)
    .set('x-test-clerk-user-id', 'test_clerk_user')

  const creatorSquadId = detail.body.teams.find((t) => t.is_mine).squad_id
  const homeFixture = detail.body.fixtures.find((f) => f.home_squad_id === creatorSquadId)

  // The availability gate reads the home squad's RSVPs on the league event;
  // a fully available squad keeps the existing "save the XI, go live" flow.
  await seedAvailability(eventId, homeAthletes)

  return {
    eventId,
    fixtureId: homeFixture.id,
    awaySquadId: squad2.rows[0].id,
    homeAthletes,
    awayAthletes,
  }
}

// Default: first 11 on a simple grid per side, the 12th benched.
async function setFixtureLineup(fixtureId, { homeStarterIds, awayStarterIds } = {}) {
  const detail = await request(app)
    .get(`/api/fixtures/${fixtureId}`)
    .set('x-test-clerk-user-id', 'test_clerk_user')

  const build = (roster, side, starterIds) => roster.map((a, i) => {
    const isStarter = starterIds ? starterIds.includes(a.id) : i < 11
    return {
      athlete_id: a.id,
      team_side: side,
      is_starter: isStarter,
      pos_x: isStarter ? 10 + (i % 4) * 26 : null,
      pos_y: isStarter ? (side === 'home' ? 8 + Math.floor(i / 4) * 24 : 92 - Math.floor(i / 4) * 24) : null,
    }
  })

  const res = await request(app)
    .put(`/api/fixtures/${fixtureId}/lineup`)
    .set('x-test-clerk-user-id', 'test_clerk_user')
    .send({
      lineups: [
        ...build(detail.body.rosters.home, 'home', homeStarterIds),
        ...build(detail.body.rosters.away, 'away', awayStarterIds),
      ],
    })

  expect(res.status).toBe(200)
  return { home: detail.body.rosters.home, away: detail.body.rosters.away }
}

async function createSimpleEvent() {
  const res = await pool.query(
    `INSERT INTO events (squad_id, opponent, event_type, event_date, created_by)
     VALUES ($1, 'Riverside FC', 'match', $2, (SELECT id FROM users WHERE clerk_id = 'test_clerk_user'))
     RETURNING *`,
    [squadId, new Date()]
  )
  return res.rows[0]
}

describe('lineup gate', () => {
  test('logging is blocked until the starting lineups are set', async () => {
    const { fixtureId, homeAthletes } = await createLeague()

    const res = await request(app)
      .post(`/api/fixtures/${fixtureId}/logs`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ athlete_id: homeAthletes[0].id, action_type: 'goal', is_scoring: true })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Set the starting lineups before logging')
  })

  test('home coach sets both XIs and the fixture goes live', async () => {
    const { fixtureId } = await createLeague()

    const res = await request(app)
      .put(`/api/fixtures/${fixtureId}/lineup`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ lineups: [] })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Pick a starting XI for the home team')

    await setFixtureLineup(fixtureId)

    const detail = await request(app)
      .get(`/api/fixtures/${fixtureId}`)
      .set('x-test-clerk-user-id', 'test_clerk_user')

    expect(detail.body.fixture.status).toBe('live')
    expect(detail.body.lineups).toHaveLength(24) // 12 + 12, 11 starters each
    expect(detail.body.lineups.filter((l) => l.is_starter && l.team_side === 'home')).toHaveLength(11)
    expect(detail.body.lineups.filter((l) => l.is_starter && l.team_side === 'away')).toHaveLength(11)
    expect(detail.body.rosters.home.length).toBeGreaterThanOrEqual(11)
  })

  test('away coach cannot set the lineups', async () => {
    const { fixtureId, awayAthletes } = await createLeague()

    const res = await request(app)
      .put(`/api/fixtures/${fixtureId}/lineup`)
      .set('x-test-clerk-user-id', 'coach_two')
      .send({
        lineups: awayAthletes.map((a, i) => ({
          athlete_id: a.id,
          team_side: 'away',
          is_starter: i < 11,
          pos_x: 50,
          pos_y: 50,
        })),
      })

    expect(res.status).toBe(403)
  })

  test('rejects an athlete on the wrong side of the lineup', async () => {
    const { fixtureId, homeAthletes } = await createLeague()

    const res = await request(app)
      .put(`/api/fixtures/${fixtureId}/lineup`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({
        lineups: homeAthletes.map((a, i) => ({
          athlete_id: a.id,
          team_side: i === 0 ? 'away' : 'home',
          is_starter: true,
          pos_x: 50,
          pos_y: 50,
        })),
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Athlete does not belong to the squad on their team side')
  })

  test('starters need pitch positions within 0-100', async () => {
    const { fixtureId, homeAthletes, awayAthletes } = await createLeague()

    const res = await request(app)
      .put(`/api/fixtures/${fixtureId}/lineup`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({
        lineups: [
          ...homeAthletes.slice(0, 11).map((a) => ({ athlete_id: a.id, team_side: 'home', is_starter: true, pos_x: 120, pos_y: 50 })),
          ...awayAthletes.slice(0, 11).map((a) => ({ athlete_id: a.id, team_side: 'away', is_starter: true, pos_x: 50, pos_y: 50 })),
        ],
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Starters need a pitch position between 0 and 100')
  })
})

describe('lineup rules while logging', () => {
  test('a starter goal counts for their own team, an away athlete goal counts away', async () => {
    const { fixtureId, homeAthletes, awayAthletes } = await createLeague()
    await setFixtureLineup(fixtureId)

    const homeGoal = await request(app)
      .post(`/api/fixtures/${fixtureId}/logs`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ athlete_id: homeAthletes[0].id, action_type: 'goal', is_scoring: true, minute: 10 })
    expect(homeGoal.status).toBe(201)

    const awayGoal = await request(app)
      .post(`/api/fixtures/${fixtureId}/logs`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ athlete_id: awayAthletes[0].id, action_type: 'goal', is_scoring: true, minute: 20 })
    expect(awayGoal.status).toBe(201)

    const detail = await request(app)
      .get(`/api/fixtures/${fixtureId}`)
      .set('x-test-clerk-user-id', 'test_clerk_user')

    expect(detail.body.result).toEqual({ home: 1, away: 1 })
  })

  test('bench players cannot receive regular actions but can be booked', async () => {
    const { fixtureId, homeAthletes } = await createLeague()
    await setFixtureLineup(fixtureId)
    const benchPlayer = homeAthletes[11]

    const goal = await request(app)
      .post(`/api/fixtures/${fixtureId}/logs`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ athlete_id: benchPlayer.id, action_type: 'goal', is_scoring: true })
    expect(goal.status).toBe(400)
    expect(goal.body.error).toBe('Substitutes can only receive a yellow or red card')

    const booking = await request(app)
      .post(`/api/fixtures/${fixtureId}/logs`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ athlete_id: benchPlayer.id, action_type: 'yellow_card', minute: 30 })
    expect(booking.status).toBe(201)
  })

  test('players outside the match-day squad are rejected', async () => {
    const { fixtureId } = await createLeague()
    await setFixtureLineup(fixtureId)

    const late = await pool.query(
      `INSERT INTO athletes (squad_id, name) VALUES ($1, 'Late Call-up') RETURNING id`,
      [squadId]
    )

    const res = await request(app)
      .post(`/api/fixtures/${fixtureId}/logs`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ athlete_id: late.rows[0].id, action_type: 'goal' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Player is not in the match-day squad')
  })
})

describe('goal with linked assist', () => {
  test('goal logged with an assist creates a linked assist entry', async () => {
    const { fixtureId, homeAthletes } = await createLeague()
    await setFixtureLineup(fixtureId)

    const res = await request(app)
      .post(`/api/fixtures/${fixtureId}/logs`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({
        athlete_id: homeAthletes[0].id,
        action_type: 'goal',
        is_scoring: true,
        assist_athlete_id: homeAthletes[1].id,
        minute: 20,
      })

    expect(res.status).toBe(201)

    const detail = await request(app)
      .get(`/api/fixtures/${fixtureId}`)
      .set('x-test-clerk-user-id', 'test_clerk_user')

    expect(detail.body.result).toEqual({ home: 1, away: 0 })
    expect(detail.body.timeline).toHaveLength(2)

    const goal = detail.body.timeline.find((e) => e.action_type === 'goal')
    const assist = detail.body.timeline.find((e) => e.action_type === 'assist')
    expect(assist.athlete_id).toBe(homeAthletes[1].id)
    expect(assist.related_log_id).toBe(goal.id)
    expect(assist.is_scoring).toBe(false)
  })

  test('scorer cannot assist their own goal', async () => {
    const { fixtureId, homeAthletes } = await createLeague()
    await setFixtureLineup(fixtureId)

    const res = await request(app)
      .post(`/api/fixtures/${fixtureId}/logs`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({
        athlete_id: homeAthletes[0].id,
        action_type: 'goal',
        assist_athlete_id: homeAthletes[0].id,
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('The scorer cannot assist their own goal')
  })

  test('assist must come from the pitch, not the bench', async () => {
    const { fixtureId, homeAthletes } = await createLeague()
    await setFixtureLineup(fixtureId)

    const res = await request(app)
      .post(`/api/fixtures/${fixtureId}/logs`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({
        athlete_id: homeAthletes[0].id,
        action_type: 'goal',
        assist_athlete_id: homeAthletes[11].id,
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('The assist must come from a player on the pitch')
  })

  test('assist only links to a goal, never a standalone action', async () => {
    const { fixtureId, homeAthletes } = await createLeague()
    await setFixtureLineup(fixtureId)

    const res = await request(app)
      .post(`/api/fixtures/${fixtureId}/logs`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({
        athlete_id: homeAthletes[0].id,
        action_type: 'save',
        assist_athlete_id: homeAthletes[1].id,
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('An assist can only be logged with a goal')
  })

  test('undoing a goal also removes its assist', async () => {
    const { fixtureId, homeAthletes } = await createLeague()
    await setFixtureLineup(fixtureId)

    const goal = await request(app)
      .post(`/api/fixtures/${fixtureId}/logs`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({
        athlete_id: homeAthletes[0].id,
        action_type: 'goal',
        is_scoring: true,
        assist_athlete_id: homeAthletes[1].id,
        minute: 5,
      })
    expect(goal.status).toBe(201)

    const undone = await request(app)
      .delete(`/api/fixtures/${fixtureId}/logs/${goal.body.id}`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
    expect(undone.status).toBe(204)

    const logs = await request(app)
      .get(`/api/fixtures/${fixtureId}/logs`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
    expect(logs.body).toHaveLength(0)
  })
})

describe('substitutions', () => {
  test('logging a substitution swaps the lineup positions', async () => {
    const { fixtureId, homeAthletes } = await createLeague()
    await setFixtureLineup(fixtureId)

    const before = await request(app)
      .get(`/api/fixtures/${fixtureId}`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
    const offRowBefore = before.body.lineups.find((l) => l.athlete_id === homeAthletes[0].id)

    const res = await request(app)
      .post(`/api/fixtures/${fixtureId}/logs`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({
        athlete_id: homeAthletes[0].id,
        action_type: 'substitution',
        substitute_athlete_id: homeAthletes[11].id,
        minute: 60,
      })

    expect(res.status).toBe(201)
    expect(res.body.notes).toBe(`on:${homeAthletes[11].id}`)

    const after = await request(app)
      .get(`/api/fixtures/${fixtureId}`)
      .set('x-test-clerk-user-id', 'test_clerk_user')

    const onRow = after.body.lineups.find((l) => l.athlete_id === homeAthletes[11].id)
    expect(onRow.is_starter).toBe(true)
    expect(onRow.pos_x).toBe(offRowBefore.pos_x)
    expect(onRow.pos_y).toBe(offRowBefore.pos_y)

    const offRow = after.body.lineups.find((l) => l.athlete_id === homeAthletes[0].id)
    expect(offRow.is_starter).toBe(false)
    expect(offRow.pos_x).toBeNull()

    // After the swap the incoming player is a starter and can be logged on.
    const goal = await request(app)
      .post(`/api/fixtures/${fixtureId}/logs`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ athlete_id: homeAthletes[11].id, action_type: 'goal', is_scoring: true })
    expect(goal.status).toBe(201)
  })

  test('substitution must swap a starter for a substitute', async () => {
    const { fixtureId, homeAthletes } = await createLeague()
    await setFixtureLineup(fixtureId)

    const res = await request(app)
      .post(`/api/fixtures/${fixtureId}/logs`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({
        athlete_id: homeAthletes[11].id,
        action_type: 'substitution',
        substitute_athlete_id: homeAthletes[0].id,
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Swap a starting player for a substitute')
  })
})

describe('simple event lineups', () => {
  test('own XI is required before logging, then goals count as usual', async () => {
    const event = await createSimpleEvent()
    const athletes = await seedRoster(squadId, 11)
    await seedAvailability(event.id, athletes)

    const blocked = await request(app)
      .post(`/api/events/${event.id}/logs`)
      .send({ athlete_id: athletes[0].id, action_type: 'goal', is_scoring: true })
    expect(blocked.status).toBe(400)
    expect(blocked.body.error).toBe('Set the starting lineups before logging')

    const lineup = await request(app)
      .put(`/api/events/${event.id}/lineup`)
      .send({
        lineups: athletes.map((a, i) => ({
          athlete_id: a.id,
          team_side: 'home',
          is_starter: true,
          pos_x: 10 + (i % 4) * 26,
          pos_y: 8 + Math.floor(i / 4) * 24,
        })),
      })
    expect(lineup.status).toBe(200)
    expect(lineup.body.lineups).toHaveLength(11)

    const goal = await request(app)
      .post(`/api/events/${event.id}/logs`)
      .send({ athlete_id: athletes[0].id, action_type: 'goal', is_scoring: true, minute: 7 })
    expect(goal.status).toBe(201)

    const detail = await request(app).get(`/api/events/${event.id}`)
    expect(detail.body.result).toEqual({ squad: 1, opponent: 0 })
    expect(detail.body.lineups).toHaveLength(11)
  })

  test('simple events have no away side to line up', async () => {
    const event = await createSimpleEvent()
    const athletes = await seedRoster(squadId, 11)

    const res = await request(app)
      .put(`/api/events/${event.id}/lineup`)
      .send({
        lineups: athletes.map((a, i) => ({
          athlete_id: a.id,
          team_side: i === 0 ? 'away' : 'home',
          is_starter: true,
          pos_x: 50,
          pos_y: 50,
        })),
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('There is no away squad in this match')
  })

  test('simple events keep the bench rule', async () => {
    const event = await createSimpleEvent()
    const athletes = await seedRoster(squadId, 12)
    await seedAvailability(event.id, athletes)

    await request(app)
      .put(`/api/events/${event.id}/lineup`)
      .send({
        lineups: athletes.map((a, i) => ({
          athlete_id: a.id,
          team_side: 'home',
          is_starter: i < 11,
          pos_x: i < 11 ? 10 + (i % 4) * 26 : null,
          pos_y: i < 11 ? 8 + Math.floor(i / 4) * 24 : null,
        })),
      })

    const save = await request(app)
      .post(`/api/events/${event.id}/logs`)
      .send({ athlete_id: athletes[11].id, action_type: 'save' })
    expect(save.status).toBe(400)

    const card = await request(app)
      .post(`/api/events/${event.id}/logs`)
      .send({ athlete_id: athletes[11].id, action_type: 'red_card' })
    expect(card.status).toBe(201)
  })
})
