// Match kick-off guard — a match may only start once enough of the squad has
// confirmed they are available via RSVP.
//
// The bar is the squad's minimum roster size (11 starters by default) plus
// five substitutes — a match needs a full match-day squad of 16 available
// players. The total stays capped at the roster size itself, so a squad that
// has not yet recruited that many players is held to its size rather than to
// a number it cannot possibly reach.
//
// Used by every path that turns a match live: the Start live buttons (events
// and fixtures), the first-log / lineup auto-start, and the background
// auto-transition sweep in app.js.

const FALLBACK_MIN_AVAILABLE = 11; // starters
const BENCH_SIZE = 5; // substitutes every match-day squad must also field

async function getMatchAvailability(pool, { eventId, squadId }) {
  const result = await pool.query(
    `SELECT s.min_roster_size,
            (SELECT COUNT(*)::int FROM athletes a WHERE a.squad_id = s.id) AS athlete_count,
            (SELECT COUNT(*)::int FROM event_rsvps r
              JOIN athletes a ON a.id = r.athlete_id
             WHERE r.event_id = $2 AND r.status = 'available' AND a.squad_id = s.id) AS available_count
     FROM squads s
     WHERE s.id = $1`,
    [squadId, eventId]
  );

  const row = result.rows[0];
  if (!row) {
    return { required: 0, available: 0, meets: true };
  }

  const starters = row.min_roster_size ?? FALLBACK_MIN_AVAILABLE;
  const required = Math.min(starters + BENCH_SIZE, row.athlete_count);
  return {
    required,
    available: row.available_count,
    meets: row.available_count >= required,
  };
}

// One shared message so every refusal reads the same wherever it comes from.
function availabilityError({ available, required }) {
  return `Cannot start the match: only ${available} of ${required} required players are marked available — a match needs 11 starters plus ${BENCH_SIZE} substitutes. Collect more RSVPs, then try again.`;
}

module.exports = { getMatchAvailability, availabilityError };
