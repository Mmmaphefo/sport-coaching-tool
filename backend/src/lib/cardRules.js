// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
//
// Card realism rules, shared by live logging, log edits and stat corrections.
//
// In a match a player can be shown at most two yellow cards (the second one
// sends them off) and at most one red card. Enforcing that per match is what
// keeps a player's season totals sensible:
//   - red cards     <= appearances
//   - yellow cards  <= 2 x appearances
// Stat corrections (manual overrides) bypass the match log, so those totals
// are also checked directly when a coach corrects a stat.

const MAX_YELLOWS_PER_MATCH = 2;
const MAX_REDS_PER_MATCH = 1;

// Error message if logging (or editing an entry into) `actionType` for this
// athlete would exceed the per-match card limit, otherwise null.
// `excludeLogId` leaves out the entry being edited, so re-saving it is allowed.
async function matchCardLimitError(db, { eventId, fixtureId = null, athleteId, actionType, excludeLogId = null }) {
  if (!athleteId || (actionType !== 'yellow_card' && actionType !== 'red_card')) return null;
  const where = fixtureId ? 'fixture_id = $1' : 'fixture_id IS NULL AND event_id = $1';
  const result = await db.query(
    `SELECT COUNT(*)::int AS n FROM log_entries
      WHERE ${where} AND athlete_id = $2 AND action_type = $3 AND deleted_at IS NULL
        AND ($4::int IS NULL OR id <> $4)`,
    [fixtureId || eventId, athleteId, actionType, excludeLogId]
  );
  const existing = result.rows[0].n;
  if (actionType === 'red_card' && existing >= MAX_REDS_PER_MATCH) {
    return 'This player has already been shown a red card in this match.';
  }
  if (actionType === 'yellow_card' && existing >= MAX_YELLOWS_PER_MATCH) {
    return 'This player already has two yellow cards in this match — a player can receive at most two.';
  }
  return null;
}

// Error message if a player's season totals break the card rules, otherwise null.
function cardTotalsError({ appearances, yellowCards, redCards }) {
  if (redCards > appearances) {
    return `Red cards (${redCards}) can't exceed appearances (${appearances}) — a player can be sent off at most once per match.`;
  }
  if (yellowCards > MAX_YELLOWS_PER_MATCH * appearances) {
    return `Yellow cards (${yellowCards}) can't exceed twice the appearances (${appearances}, so at most ${MAX_YELLOWS_PER_MATCH * appearances}).`;
  }
  return null;
}

module.exports = { matchCardLimitError, cardTotalsError, MAX_YELLOWS_PER_MATCH, MAX_REDS_PER_MATCH };
