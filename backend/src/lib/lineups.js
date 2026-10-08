// Shared helpers for match lineups: the starting XI + bench captured before
// live logging opens, with drag-and-drop pitch coordinates for starters.
// An "owner" is either { fixtureId } or { eventId } — simple events only
// ever carry the coach's own (home) side since their opponent is a free-text
// name with no roster.

const SIDES = ['home', 'away'];

// The only actions a benched player may receive — everything else requires
// being on the pitch.
const BENCH_ALLOWED_ACTIONS = new Set(['yellow_card', 'red_card']);

async function getLineup(pool, owner) {
  const clause = owner.fixtureId ? 'ml.fixture_id = $1' : 'ml.event_id = $1';
  const id = owner.fixtureId || owner.eventId;
  const result = await pool.query(
    `SELECT ml.athlete_id, ml.team_side, ml.pos_x, ml.pos_y, ml.is_starter,
            a.name, a.squad_number, a.position, a.photo
     FROM match_lineups ml
     JOIN athletes a ON a.id = ml.athlete_id
     WHERE ${clause}
     ORDER BY ml.team_side, ml.is_starter DESC, a.squad_number NULLS LAST, a.name`,
    [id]
  );
  return result.rows;
}

// Returns a Map of athleteId -> squadId for the given ids.
async function getAthleteSquads(pool, athleteIds) {
  if (athleteIds.length === 0) return new Map();
  const result = await pool.query(
    'SELECT id, squad_id FROM athletes WHERE id = ANY($1)',
    [athleteIds]
  );
  return new Map(result.rows.map((r) => [r.id, r.squad_id]));
}

// Validates the PUT /lineup body. squadsBySide maps each side to its squad
// id, or null when that side has no squad in this match. Returns
// { rows } on success or { error } on the first problem found.
function validateLineupPayload(lineups, squadsBySide) {
  if (!Array.isArray(lineups)) {
    return { error: 'lineups must be an array' };
  }

  const seen = new Set();
  const rows = [];
  for (const raw of lineups) {
    const athleteId = Number(raw && raw.athlete_id);
    const side = raw && raw.team_side;
    const isStarter = Boolean(raw && raw.is_starter);

    if (!Number.isInteger(athleteId) || athleteId <= 0) {
      return { error: 'Each lineup entry needs an athlete_id' };
    }
    if (!SIDES.includes(side)) {
      return { error: "team_side must be 'home' or 'away'" };
    }
    if (!squadsBySide[side]) {
      return { error: `There is no ${side} squad in this match` };
    }
    if (seen.has(athleteId)) {
      return { error: 'The same athlete appears more than once in the lineup' };
    }
    seen.add(athleteId);

    let posX = null;
    let posY = null;
    if (isStarter) {
      posX = Number(raw.pos_x);
      posY = Number(raw.pos_y);
      if (
        !Number.isFinite(posX) || !Number.isFinite(posY) ||
        posX < 0 || posX > 100 || posY < 0 || posY > 100
      ) {
        return { error: 'Starters need a pitch position between 0 and 100' };
      }
      posX = Math.round(posX);
      posY = Math.round(posY);
    }

    rows.push({ athleteId, side, isStarter, posX, posY });
  }

  for (const side of SIDES) {
    if (!squadsBySide[side]) continue;
    const starters = rows.filter((r) => r.side === side && r.isStarter);
    if (starters.length === 0) {
      return { error: `Pick a starting XI for the ${side} team` };
    }
    if (starters.length > 11) {
      return { error: `The ${side} starting XI cannot have more than 11 players` };
    }
  }

  return { rows };
}

// Replaces the whole lineup in a transaction (upsert-by-replace keeps the
// drag-and-drop saves simple: the client always sends the full picture).
async function saveLineup(pool, owner, rows) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (owner.fixtureId) {
      await client.query('DELETE FROM match_lineups WHERE fixture_id = $1', [owner.fixtureId]);
    } else {
      await client.query('DELETE FROM match_lineups WHERE event_id = $1', [owner.eventId]);
    }
    for (const r of rows) {
      await client.query(
        `INSERT INTO match_lineups (fixture_id, event_id, athlete_id, team_side, pos_x, pos_y, is_starter)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [owner.fixtureId || null, owner.eventId || null, r.athleteId, r.side, r.posX, r.posY, r.isStarter]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Enforces the lineup gate and the bench rule for a logging request.
// Returns an error message or null when the athlete may receive the action.
function lineupCheckForLog(lineupRows, athleteId, actionType) {
  const row = lineupRows.find((r) => r.athlete_id === athleteId);
  if (!row) {
    return 'Player is not in the match-day squad';
  }
  if (!row.is_starter && !BENCH_ALLOWED_ACTIONS.has(actionType)) {
    return 'Substitutes can only receive a yellow or red card';
  }
  return null;
}

// Swaps two athletes in the lineup: the starter comes off (benched, position
// cleared) and the substitute takes their exact place on the pitch.
async function applySubstitution(pool, owner, offId, onId) {
  const clause = owner.fixtureId ? 'fixture_id = $1' : 'event_id = $1';
  const id = owner.fixtureId || owner.eventId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rows = await client.query(
      `SELECT athlete_id, team_side, pos_x, pos_y, is_starter
       FROM match_lineups WHERE ${clause} AND athlete_id = ANY($2) FOR UPDATE`,
      [id, [offId, onId]]
    );
    const off = rows.rows.find((r) => r.athlete_id === offId);
    const on = rows.rows.find((r) => r.athlete_id === onId);
    if (!off || !on) {
      await client.query('ROLLBACK');
      return 'Both players must be in the match-day squad';
    }
    if (off.team_side !== on.team_side) {
      await client.query('ROLLBACK');
      return 'A substitution must keep the player on the same team';
    }
    if (!off.is_starter || on.is_starter) {
      await client.query('ROLLBACK');
      return 'Swap a starting player for a substitute';
    }
    await client.query(
      `UPDATE match_lineups SET is_starter = false, pos_x = NULL, pos_y = NULL, updated_at = now()
       WHERE ${clause} AND athlete_id = $2`,
      [id, offId]
    );
    await client.query(
      `UPDATE match_lineups SET is_starter = true, pos_x = $3, pos_y = $4, updated_at = now()
       WHERE ${clause} AND athlete_id = $2`,
      [id, onId, off.pos_x, off.pos_y]
    );
    await client.query('COMMIT');
    return null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  BENCH_ALLOWED_ACTIONS,
  getLineup,
  getAthleteSquads,
  validateLineupPayload,
  saveLineup,
  lineupCheckForLog,
  applySubstitution,
};
