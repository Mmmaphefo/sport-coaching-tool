// Match kick-off guard — a match may only start once enough of the squad has
// confirmed they are available via RSVP.
//
// The bar is MIN_AVAILABLE_PLAYERS (7): a match can go ahead once at least
// seven of the squad's players have confirmed they are available (RSVP
// 'available', and not injured on the match date). This is the same for
// every squad, whatever its roster size.

const MIN_AVAILABLE_PLAYERS = 7;

// SQL: athlete `alias` is injured on the date in query parameter `dateParam`
// (not cleared, already sustained, and not yet past the expected return).
// Shared by the kickoff check and the RSVP routes so all three agree.
function injuredOnDateSql(alias, dateParam) {
  return `EXISTS (
    SELECT 1 FROM injuries i
     WHERE i.athlete_id = ${alias}.id AND i.cleared_at IS NULL
       AND i.date_sustained <= ${dateParam}::date
       AND (i.return_date IS NULL OR i.return_date > ${dateParam}::date))`;
}

// True when the athlete is injured on that date.
async function isInjuredOn(pool, athleteId, date) {
  const result = await pool.query(
    `SELECT 1 FROM athletes a WHERE a.id = $1 AND ${injuredOnDateSql('a', '$2')}`,
    [athleteId, date]
  );
  return result.rows.length > 0;
}

async function getMatchAvailability(pool, { eventId, squadId }) {
  const result = await pool.query(
    `SELECT s.min_roster_size,
            (SELECT COUNT(*)::int FROM athletes a WHERE a.squad_id = s.id) AS athlete_count,
            (SELECT COUNT(*)::int FROM event_rsvps r
              JOIN athletes a ON a.id = r.athlete_id
             WHERE r.event_id = $2 AND r.status = 'available' AND a.squad_id = s.id
               -- An injured player never counts, even with an old 'available' answer.
               AND NOT ${injuredOnDateSql('a', '(SELECT e.event_date FROM events e WHERE e.id = $2)')}) AS available_count
     FROM squads s
     WHERE s.id = $1`,
    [squadId, eventId]
  );

  const row = result.rows[0];
  if (!row) {
    return { required: 0, available: 0, meets: true };
  }

  const required = MIN_AVAILABLE_PLAYERS;
  return {
    required,
    available: row.available_count,
    meets: row.available_count >= required,
  };
}

// One shared message so every refusal reads the same wherever it comes from.
function availabilityError({ available, required }) {
  return `Cannot start the match: only ${available} of the ${required} players needed are marked available — a match needs at least ${required} available players. Collect more RSVPs, then try again.`;
}

module.exports = { getMatchAvailability, availabilityError, injuredOnDateSql, isInjuredOn, MIN_AVAILABLE_PLAYERS };
