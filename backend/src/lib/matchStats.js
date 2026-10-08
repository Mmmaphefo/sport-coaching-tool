// Shared helpers that turn a squad's completed simple events (own matches) and
// fixtures (league/tournament matches) into one unified list of "matches" with
// goals-for / goals-against and a W/D/L result. Used by season summaries (T17),
// squad trends (T18), opponent comparisons (T19), summaries (T22), the schedule
// generator (T23) and the public leaderboard (T25).
//
// Scoring conventions (inherited from the live-logging feature):
// - Simple event: log entries with a non-null athlete_id belong to the owning
//   squad; athlete_id = NULL entries are the opponent's (goals conceded).
// - Fixture: only the home team logs; athlete_id != NULL is a home goal,
//   athlete_id = NULL is an away goal.

function resultOf(gf, ga) {
  if (gf > ga) return 'W';
  if (gf < ga) return 'L';
  return 'D';
}

// Completed own matches for a squad. opts:
//   fromDate / toDate — inclusive date filters on event_date
//   seasonId          — for events: matches events explicitly tagged with the
//                       season, plus untagged events falling inside
//                       fromDate..toDate (fixtures are filtered by date only,
//                       they have no season tag of their own).
async function getSquadEventMatches(pool, squadId, opts = {}) {
  const params = [squadId];
  const where = ["e.squad_id = $1", "e.event_type = 'match'", "e.status = 'completed'"];

  if (opts.seasonId && opts.fromDate && opts.toDate) {
    params.push(opts.seasonId, opts.fromDate, opts.toDate);
    where.push(
      `(e.season_id = $${params.length - 2} OR (e.season_id IS NULL AND e.event_date::date BETWEEN $${params.length - 1} AND $${params.length}))`
    );
  } else if (opts.fromDate && opts.toDate) {
    params.push(opts.fromDate, opts.toDate);
    where.push(`e.event_date::date BETWEEN $${params.length - 1} AND $${params.length}`);
  }

  const result = await pool.query(
    `SELECT e.id, e.event_date, e.opponent, e.status, e.season_id, e.location,
            COALESCE(SUM(CASE WHEN l.is_scoring AND l.athlete_id IS NOT NULL THEN l.value ELSE 0 END), 0) AS gf,
            COALESCE(SUM(CASE WHEN l.is_scoring AND l.athlete_id IS NULL THEN l.value ELSE 0 END), 0) AS ga
     FROM events e
     LEFT JOIN log_entries l ON l.event_id = e.id AND l.deleted_at IS NULL
     WHERE ${where.join(' AND ')}
     GROUP BY e.id
     ORDER BY e.event_date ASC, e.id ASC`,
    params
  );

  return result.rows.map((row) => {
    const gf = Number(row.gf);
    const ga = Number(row.ga);
    return {
      kind: 'event',
      refId: row.id,
      eventId: row.id,
      date: row.event_date,
      opponent: row.opponent || 'Unknown opponent',
      venue: null,
      gf,
      ga,
      result: resultOf(gf, ga),
      location: row.location,
    };
  });
}

// Completed fixtures (league/tournament) involving the squad, from either side.
async function getSquadFixtureMatches(pool, squadId, opts = {}) {
  const params = [squadId];
  let dateFilter = '';
  if (opts.fromDate && opts.toDate) {
    params.push(opts.fromDate, opts.toDate);
    dateFilter = `AND f.event_date::date BETWEEN $${params.length - 1} AND $${params.length}`;
  }

  const result = await pool.query(
    `SELECT f.id, f.event_id, f.event_date, f.home_squad_id, f.away_squad_id,
            home.name AS home_name, away.name AS away_name, e.title AS league_title,
            COALESCE(SUM(CASE WHEN l.is_scoring AND l.athlete_id IS NOT NULL THEN l.value ELSE 0 END), 0) AS home_goals,
            COALESCE(SUM(CASE WHEN l.is_scoring AND l.athlete_id IS NULL THEN l.value ELSE 0 END), 0) AS away_goals
     FROM fixtures f
     JOIN events e ON e.id = f.event_id
     JOIN squads home ON home.id = f.home_squad_id
     JOIN squads away ON away.id = f.away_squad_id
     LEFT JOIN log_entries l ON l.fixture_id = f.id AND l.deleted_at IS NULL
     WHERE (f.home_squad_id = $1 OR f.away_squad_id = $1) AND f.status = 'completed' ${dateFilter}
     GROUP BY f.id, e.title
     ORDER BY f.event_date ASC NULLS LAST, f.id ASC`,
    params
  );

  return result.rows.map((row) => {
    const isHome = row.home_squad_id === squadId;
    const gf = Number(isHome ? row.home_goals : row.away_goals);
    const ga = Number(isHome ? row.away_goals : row.home_goals);
    return {
      kind: 'fixture',
      refId: row.id,
      eventId: row.event_id,
      date: row.event_date,
      opponent: isHome ? row.away_name : row.home_name,
      venue: isHome ? 'H' : 'A',
      gf,
      ga,
      result: resultOf(gf, ga),
      location: row.league_title,
    };
  });
}

// Both sources merged, chronologically.
async function getSquadMatches(pool, squadId, opts = {}) {
  const [eventMatches, fixtureMatches] = await Promise.all([
    getSquadEventMatches(pool, squadId, opts),
    getSquadFixtureMatches(pool, squadId, opts),
  ]);
  return [...eventMatches, ...fixtureMatches].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );
}

function summariseMatches(matches) {
  const summary = { played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, points: 0 };
  for (const m of matches) {
    summary.played++;
    summary.gf += m.gf;
    summary.ga += m.ga;
    if (m.result === 'W') {
      summary.wins++;
      summary.points += 3;
    } else if (m.result === 'D') {
      summary.draws++;
      summary.points += 1;
    } else {
      summary.losses++;
    }
  }
  summary.gd = summary.gf - summary.ga;
  return summary;
}

function groupByOpponent(matches) {
  const map = new Map();
  for (const m of matches) {
    const key = m.opponent;
    if (!map.has(key)) {
      map.set(key, { opponent: key, matches: [] });
    }
    map.get(key).matches.push(m);
  }
  return Array.from(map.values())
    .map(({ opponent, matches: list }) => ({
      opponent,
      played: list.length,
      ...summariseMatches(list),
      matches: list,
    }))
    .sort((a, b) => b.played - a.played || b.points - a.points);
}

module.exports = {
  resultOf,
  getSquadEventMatches,
  getSquadFixtureMatches,
  getSquadMatches,
  summariseMatches,
  groupByOpponent,
};
