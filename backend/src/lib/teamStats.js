// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
//
// Team-level statistics for one squad over a date range, built from the live
// log (never entered by hand). Used by the team comparison (T19) and the
// printable reports (T20).
//
// Side attribution — the single rule everything below relies on:
//   a log entry is OURS when its athlete belongs to this squad, and THEIRS
//   otherwise. That covers both shapes of match in the schema:
//   - a regular match (events.format = 'match'): the opposition has no roster,
//     so their actions are logged with athlete_id NULL;
//   - a league/tournament fixture: both squads have rosters, so the other
//     squad's actions carry their own athlete ids.

const SIDE_FIELDS = ['goals', 'shotsOnTarget', 'saves', 'penalties', 'yellowCards', 'redCards']

function emptySide() {
  return Object.fromEntries(SIDE_FIELDS.map((f) => [f, 0]))
}

// Fold one log entry into a side's running totals. Goals follow the same rule
// as the dashboard and match result: any entry flagged is_scoring counts its
// value (so a "point" in another sport would too).
function addEntry(side, entry) {
  if (entry.is_scoring) side.goals += Number(entry.value) || 0
  switch (entry.action_type) {
    case 'shot_on_target': side.shotsOnTarget += 1; break
    case 'save': side.saves += 1; break
    case 'penalty': side.penalties += 1; break
    case 'yellow_card': side.yellowCards += 1; break
    case 'red_card': side.redCards += 1; break
    default: break
  }
}

function resultFor(us, them) {
  if (us.goals > them.goals) return 'W'
  if (us.goals < them.goals) return 'L'
  return 'D'
}

// Parse a YYYY-MM-DD query value. Returns a Date at UTC midnight, or null.
function parseDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const d = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

// Validates a { from, to } pair of YYYY-MM-DD strings. `to` is inclusive.
// Returns { from, toExclusive } or throws an Error with status 400.
function parseRange(from, to, label = 'Date range') {
  const start = parseDay(from)
  const end = parseDay(to)
  if (!start || !end) {
    throw Object.assign(new Error(`${label}: use dates in the form YYYY-MM-DD`), { status: 400 })
  }
  if (start > end) {
    throw Object.assign(new Error(`${label}: the start date must be on or before the end date`), { status: 400 })
  }
  return { from: start, toExclusive: new Date(end.getTime() + 24 * 60 * 60 * 1000) }
}

// Every completed match the squad played in the range, with per-side totals,
// oldest first.
async function loadTeamMatches(pool, squadId, { from, toExclusive }) {
  const events = await pool.query(
    `SELECT id, opponent, title, event_date
       FROM events
      WHERE squad_id = $1 AND format = 'match' AND status = 'completed'
        AND event_date >= $2 AND event_date < $3`,
    [squadId, from, toExclusive]
  )
  const fixtures = await pool.query(
    `SELECT f.id, f.event_date, f.home_squad_id, f.away_squad_id,
            home.name AS home_name, away.name AS away_name, e.title AS competition
       FROM fixtures f
       JOIN squads home ON home.id = f.home_squad_id
       JOIN squads away ON away.id = f.away_squad_id
       JOIN events e ON e.id = f.event_id
      WHERE (f.home_squad_id = $1 OR f.away_squad_id = $1) AND f.status = 'completed'
        AND f.event_date >= $2 AND f.event_date < $3`,
    [squadId, from, toExclusive]
  )

  const matches = new Map()
  for (const ev of events.rows) {
    matches.set(`event:${ev.id}`, {
      kind: 'match',
      id: ev.id,
      date: ev.event_date,
      opponent: (ev.opponent || '').trim() || 'Opponent',
      competition: null,
      us: emptySide(),
      them: emptySide(),
    })
  }
  for (const fx of fixtures.rows) {
    const weAreHome = fx.home_squad_id === squadId
    matches.set(`fixture:${fx.id}`, {
      kind: 'fixture',
      id: fx.id,
      date: fx.event_date,
      opponent: weAreHome ? fx.away_name : fx.home_name,
      competition: fx.competition,
      us: emptySide(),
      them: emptySide(),
    })
  }

  const eventIds = events.rows.map((r) => r.id)
  const fixtureIds = fixtures.rows.map((r) => r.id)
  if (eventIds.length || fixtureIds.length) {
    const logs = await pool.query(
      `SELECT l.event_id, l.fixture_id, l.action_type, l.is_scoring, l.value,
              (a.squad_id IS NOT DISTINCT FROM $3::int AND l.athlete_id IS NOT NULL) AS ours
         FROM log_entries l
         LEFT JOIN athletes a ON a.id = l.athlete_id
        WHERE l.deleted_at IS NULL
          AND ((l.fixture_id IS NULL AND l.event_id = ANY($1::int[]))
               OR l.fixture_id = ANY($2::int[]))`,
      [eventIds, fixtureIds, squadId]
    )
    for (const entry of logs.rows) {
      const key = entry.fixture_id ? `fixture:${entry.fixture_id}` : `event:${entry.event_id}`
      const match = matches.get(key)
      if (!match) continue
      addEntry(entry.ours ? match.us : match.them, entry)
    }
  }

  return [...matches.values()]
    .map((m) => ({ ...m, result: resultFor(m.us, m.them) }))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
}

function perMatch(total, played) {
  return played > 0 ? +(total / played).toFixed(2) : 0
}

// Totals and averages over a list of matches, for one comparison column.
function summarise(matches) {
  const us = emptySide()
  const them = emptySide()
  let wins = 0
  let draws = 0
  let losses = 0
  let cleanSheets = 0
  for (const m of matches) {
    for (const f of SIDE_FIELDS) {
      us[f] += m.us[f]
      them[f] += m.them[f]
    }
    if (m.result === 'W') wins += 1
    else if (m.result === 'D') draws += 1
    else losses += 1
    if (m.them.goals === 0) cleanSheets += 1
  }
  const played = matches.length
  return {
    played,
    wins,
    draws,
    losses,
    points: wins * 3 + draws,
    pointsPerMatch: perMatch(wins * 3 + draws, played),
    winRate: played > 0 ? Math.round((wins / played) * 100) : 0,
    goalsFor: us.goals,
    goalsAgainst: them.goals,
    goalDifference: us.goals - them.goals,
    cleanSheets,
    us,
    them,
    perMatch: {
      goalsFor: perMatch(us.goals, played),
      goalsAgainst: perMatch(them.goals, played),
      shotsOnTargetFor: perMatch(us.shotsOnTarget, played),
      shotsOnTargetAgainst: perMatch(them.shotsOnTarget, played),
    },
  }
}

// Record against each opponent, most-played first.
function byOpponent(matches) {
  const table = new Map()
  for (const m of matches) {
    const key = m.opponent.toLowerCase()
    if (!table.has(key)) {
      table.set(key, { opponent: m.opponent, played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 })
    }
    const row = table.get(key)
    row.played += 1
    if (m.result === 'W') row.wins += 1
    else if (m.result === 'D') row.draws += 1
    else row.losses += 1
    row.goalsFor += m.us.goals
    row.goalsAgainst += m.them.goals
  }
  return [...table.values()].sort(
    (a, b) => b.played - a.played || (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst)
  )
}

module.exports = { loadTeamMatches, summarise, byOpponent, parseRange, resultFor }
