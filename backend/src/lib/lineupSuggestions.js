// Lineup suggestions — a data-backed head start for the lineup wizard.
//
// The engine reads the four signals the platform already trusts: who RSVP'd
// for this event, who is carrying an injury, recent goal involvement (form)
// and each player's overall rating (the same cache the match simulator
// maintains). It fills a classic 4-4-2 — one keeper, four defenders, four
// midfielders, two forwards — best player first per band, backfills bands
// that run short with out-of-position picks, and names the leftovers as the
// bench.
//
// A suggestion is a starting point, never a verdict: nothing here writes to
// the lineup, and the wizard stays free to override every pick. Injured and
// unavailable players are listed with the reason but can still be picked by
// hand.

const { ensureRatings, positionGroup } = require('./ratings');

const FORM_WINDOW_DAYS = 30;
// A hot streak can lift a player above a better rating, but only so far.
const FORM_BONUS_CAP = 6;
// Nudge for a confirmed RSVP: the coach cares who actually shows up.
const RSVP_AVAILABLE_BONUS = 3;

// Band capacities of the 4-4-2 the wizard lays out by default. The client's
// defaultXiPositions owns the pitch coordinates; this only fixes the counts,
// in defence-first order so the wizard can map the XI onto those slots.
const BAND_CAPACITY = { GK: 1, DEF: 4, MID: 4, FWD: 2 };

// positionGroup's fine-grained groups collapsed into the four bands.
const BAND_OF_GROUP = {
  GK: 'GK',
  CB: 'DEF',
  FB: 'DEF',
  DM: 'MID',
  CM: 'MID',
  AM: 'MID',
  W: 'FWD',
  ST: 'FWD',
};

function bandOf(position) {
  return BAND_OF_GROUP[positionGroup(position)] || 'MID';
}

function formatDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

// One human-readable line per pick, so the wizard never has to explain the
// scoring itself.
function reasonFor({ rating, rsvp, involvements, outOfPosition }) {
  const parts = [];
  if (rating != null) parts.push(`${rating} overall`);
  parts.push(
    rsvp === 'available' ? 'available'
      : rsvp === 'maybe' ? 'a maybe RSVP'
        : rsvp === 'unavailable' ? 'unavailable'
          : 'no RSVP yet'
  );
  if (involvements > 0) {
    parts.push(`${involvements} goal involvement${involvements === 1 ? '' : 's'} in ${FORM_WINDOW_DAYS}d`);
  }
  if (outOfPosition) parts.push('out of position');
  return parts.join(' · ');
}

// Builds the suggested XI and bench for the coach's own side of an event.
// `eventId` is where the RSVPs live (a simple event, or the league event a
// fixture belongs to).
async function buildLineupSuggestions(pool, { eventId, squadId }) {
  // Roster with each player's current injury and their RSVP for this event.
  const roster = await pool.query(
    `SELECT a.id, a.name, a.squad_number, a.position,
            (inj.return_date IS NOT NULL) AS is_injured,
            inj.return_date AS injury_return,
            r.status AS rsvp_status
     FROM athletes a
     LEFT JOIN LATERAL (
       SELECT i.return_date
       FROM injuries i
       WHERE i.athlete_id = a.id
         AND i.cleared_at IS NULL
         AND i.return_date >= CURRENT_DATE
       ORDER BY i.return_date ASC
       LIMIT 1
     ) inj ON true
     LEFT JOIN event_rsvps r ON r.athlete_id = a.id AND r.event_id = $2
     WHERE a.squad_id = $1
     ORDER BY a.squad_number NULLS LAST, a.name`,
    [squadId, eventId]
  );

  // Form: goals and assists from matches played in the form window — the
  // same counting the player stats page uses (`value` carries multi-goal
  // entries), dated by the match itself, not by when it was logged.
  const form = await pool.query(
    `SELECT le.athlete_id,
            COALESCE(SUM(le.value) FILTER (WHERE le.action_type IN ('goal', 'penalty')), 0)::int AS goals,
            COALESCE(SUM(le.value) FILTER (WHERE le.action_type = 'assist'), 0)::int AS assists
     FROM log_entries le
     JOIN athletes a ON a.id = le.athlete_id AND a.squad_id = $1
     LEFT JOIN events e ON e.id = le.event_id
     LEFT JOIN fixtures f ON f.id = le.fixture_id
     WHERE le.action_type IN ('goal', 'penalty', 'assist')
       AND COALESCE(e.event_date, f.event_date) >= now() - ($2 || ' days')::interval
     GROUP BY le.athlete_id`,
    [squadId, FORM_WINDOW_DAYS]
  );
  const formByAthlete = new Map(form.rows.map((row) => [row.athlete_id, row]));

  // Ratings come from the simulator's cache — dataset hits, or positional
  // estimates when the provider is unreachable. A provider outage degrades
  // the ordering, never the response.
  const ratings = await ensureRatings(
    pool,
    roster.rows.map((row) => ({ id: row.id, name: row.name, position: row.position }))
  );

  const excluded = [];
  const eligible = [];
  for (const row of roster.rows) {
    const f = formByAthlete.get(row.id) || { goals: 0, assists: 0 };
    const goals = Number(f.goals);
    const assists = Number(f.assists);
    const involvements = goals + assists;
    const rating = ratings.get(row.id)?.overall ?? null;

    if (row.is_injured) {
      const until = formatDate(row.injury_return);
      excluded.push({
        athlete_id: row.id,
        name: row.name,
        reason: until ? `injured — expected back ${until}` : 'injured',
      });
      continue;
    }
    if (row.rsvp_status === 'unavailable') {
      excluded.push({
        athlete_id: row.id,
        name: row.name,
        reason: 'marked unavailable for this match',
      });
      continue;
    }

    const score =
      (rating ?? 75) +
      Math.min(FORM_BONUS_CAP, involvements) +
      (row.rsvp_status === 'available' ? RSVP_AVAILABLE_BONUS : 0);

    eligible.push({
      athlete_id: row.id,
      name: row.name,
      squad_number: row.squad_number,
      band: bandOf(row.position),
      rating,
      rsvp: row.rsvp_status || null,
      goals,
      assists,
      score,
    });
  }

  // Deterministic order: score first, then name, so identical inputs always
  // produce the identical suggestion.
  const byScore = (a, b) => b.score - a.score || a.name.localeCompare(b.name);
  const byBand = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const player of eligible) byBand[player.band].push(player);
  for (const list of Object.values(byBand)) list.sort(byScore);

  const taken = new Set();
  const chosen = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const [band, capacity] of Object.entries(BAND_CAPACITY)) {
    for (const player of byBand[band]) {
      if (chosen[band].length >= capacity) break;
      chosen[band].push(player);
      taken.add(player.athlete_id);
    }
  }

  // Bands that ran short are backfilled from the best remaining players —
  // flagged, so the wizard can say the coach is fielding someone out of
  // position instead of pretending the fit was natural.
  const leftover = eligible
    .filter((player) => !taken.has(player.athlete_id))
    .sort(byScore);
  for (const [band, capacity] of Object.entries(BAND_CAPACITY)) {
    while (chosen[band].length < capacity && leftover.length > 0) {
      const player = leftover.shift();
      chosen[band].push({ ...player, outOfPosition: player.band !== band });
    }
  }

  const xi = [];
  for (const [band, players] of Object.entries(chosen)) {
    for (const player of players) {
      const outOfPosition = player.outOfPosition || false;
      xi.push({
        athlete_id: player.athlete_id,
        name: player.name,
        squad_number: player.squad_number,
        band,
        naturalBand: player.band,
        outOfPosition,
        rating: player.rating,
        rsvp: player.rsvp,
        goals: player.goals,
        assists: player.assists,
        score: player.score,
        reason: reasonFor({
          rating: player.rating,
          rsvp: player.rsvp,
          involvements: player.goals + player.assists,
          outOfPosition,
        }),
      });
    }
  }

  const bench = leftover.map((player) => ({
    athlete_id: player.athlete_id,
    name: player.name,
    squad_number: player.squad_number,
    band: player.band,
    rating: player.rating,
    rsvp: player.rsvp,
    goals: player.goals,
    assists: player.assists,
    score: player.score,
    reason: reasonFor({
      rating: player.rating,
      rsvp: player.rsvp,
      involvements: player.goals + player.assists,
      outOfPosition: false,
    }),
  }));

  return {
    formation: '4-4-2',
    xi,
    bench,
    excluded,
    basis: {
      formWindowDays: FORM_WINDOW_DAYS,
      considered: roster.rows.length,
      suggested: xi.length,
    },
  };
}

module.exports = {
  FORM_WINDOW_DAYS,
  buildLineupSuggestions,
};
