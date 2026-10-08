// Clash detection shared by the event and fixture routes.
//
// A "clash" is another non-cancelled item on this squad's calendar whose
// scheduled window overlaps the window being checked. It is advisory only —
// a coach may genuinely need two things at once (an assistant covering one
// match while they run another), so callers flag clashes without blocking.
//
// Two sources are checked, because a squad's calendar is spread across them:
//   - its own events (matches / training sessions)
//   - fixtures inside leagues/tournaments the squad has joined
// League/tournament containers themselves are deliberately not returned:
// their date is just when the competition opens, and each of their fixtures
// is already reported individually.

async function findClashes(pool, squadId, timestamp, durationMinutes, options = {}) {
  if (!timestamp) return [];
  const duration = Number(durationMinutes) || 90;
  const { excludeEventId = null, excludeFixtureId = null } = options;

  const eventsResult = await pool.query(
    `SELECT id, title, opponent, event_date, duration_minutes, location, format, status
     FROM events
     WHERE squad_id = $1
       AND status <> 'cancelled'
       AND format NOT IN ('league', 'tournament')
       AND ($2::integer IS NULL OR id <> $2)
       AND event_date < ($3::timestamp + ($4 || ' minutes')::interval)
       AND (event_date + (COALESCE(duration_minutes, 90) || ' minutes')::interval) > $3::timestamp
     ORDER BY event_date`,
    [squadId, excludeEventId, timestamp, duration]
  );

  const fixturesResult = await pool.query(
    `SELECT f.id, f.event_id, f.event_date, f.status, e.location,
            COALESCE(e.duration_minutes, 90) AS duration_minutes,
            e.title AS league_title,
            home.name AS home_squad_name,
            away.name AS away_squad_name
     FROM fixtures f
     JOIN events e ON e.id = f.event_id
     JOIN event_teams et ON et.event_id = f.event_id AND et.squad_id = $1
     JOIN squads home ON home.id = f.home_squad_id
     JOIN squads away ON away.id = f.away_squad_id
     WHERE f.status <> 'cancelled'
       AND ($2::integer IS NULL OR f.id <> $2)
       AND f.event_date < ($3::timestamp + ($4 || ' minutes')::interval)
       AND (f.event_date + (COALESCE(e.duration_minutes, 90) || ' minutes')::interval) > $3::timestamp
     ORDER BY f.event_date`,
    [squadId, excludeFixtureId, timestamp, duration]
  );

  const events = eventsResult.rows.map((row) => ({
    kind: 'event',
    id: row.id,
    label: row.opponent ? `vs ${row.opponent}` : (row.title || 'Training session'),
    event_date: row.event_date,
    duration_minutes: row.duration_minutes,
    location: row.location,
    format: row.format,
    status: row.status,
  }));

  const fixtures = fixturesResult.rows.map((row) => ({
    kind: 'fixture',
    id: row.id,
    event_id: row.event_id,
    label: `${row.home_squad_name} vs ${row.away_squad_name}${
      row.league_title ? ` · ${row.league_title}` : ''
    }`,
    event_date: row.event_date,
    duration_minutes: row.duration_minutes,
    location: row.location,
    status: row.status,
  }));

  return [...events, ...fixtures].sort(
    (a, b) => new Date(a.event_date) - new Date(b.event_date)
  );
}

module.exports = { findClashes };
