const express = require('express');
const pool = require('../db');
const { requireAuth, getAuth } = require('../middleware/auth');
const { getOwnedSquadId } = require('./_squad');
const { loadTeamMatches, summarise, byOpponent, parseRange } = require('../lib/teamStats');

const router = express.Router();

// GET /api/compare/athletes?a=<id>&b=<id>
// Returns side-by-side stats for two athletes from the logged-in coach's squad.
router.get('/athletes', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const { a, b } = req.query;
    if (!a || !b) {
      return res.status(400).json({ error: 'Both athlete IDs (a and b) are required' });
    }
    if (a === b) {
      return res.status(400).json({ error: 'Athlete IDs must be different' });
    }

    // Fetch both athletes — must belong to the coach's squad
    const athletesResult = await pool.query(
      `SELECT * FROM athletes WHERE id IN ($1, $2) AND squad_id = $3`,
      [a, b, squadId]
    );
    if (athletesResult.rows.length !== 2) {
      return res.status(404).json({ error: 'One or both athletes not found in your squad' });
    }

    const [athleteA, athleteB] = athletesResult.rows;

    // Fetch logs for both athletes
    const logsResult = await pool.query(
      `SELECT l.*, e.event_date, e.opponent
       FROM log_entries l
       JOIN events e ON e.id = l.event_id
       WHERE l.athlete_id IN ($1, $2) AND l.deleted_at IS NULL
       ORDER BY e.event_date DESC`,
      [a, b]
    );

    // Aggregate stats per athlete
    function aggregateStats(logs, athleteId) {
      let goals = 0;
      let assists = 0;
      let penalties = 0;
      let yellowCards = 0;
      let redCards = 0;
      const eventIds = new Set();

      for (const l of logs) {
        if (l.athlete_id !== athleteId) continue;
        eventIds.add(l.event_id);
        if (l.action_type === 'goal') goals += l.value || 0;
        if (l.action_type === 'assist') assists += l.value || 0;
        if (l.action_type.includes('penalty')) penalties += 1;
        if (l.action_type === 'yellow_card') yellowCards += 1;
        if (l.action_type === 'red_card') redCards += 1;
      }

      return {
        goals,
        assists,
        penalties,
        yellowCards,
        redCards,
        appearances: eventIds.size,
        involvementsPerMatch: eventIds.size > 0 ? +((goals + assists) / eventIds.size).toFixed(1) : 0,
      };
    }

    const statsA = aggregateStats(logsResult.rows, athleteA.id);
    const statsB = aggregateStats(logsResult.rows, athleteB.id);

    res.json({
      athleteA: { ...athleteA, stats: statsA },
      athleteB: { ...athleteB, stats: statsB },
    });
  } catch (err) {
    console.error('Error fetching comparison:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/compare/team?from=YYYY-MM-DD&to=YYYY-MM-DD[&vs_from=…&vs_to=…]
// The squad against its opponents over a period (T19): record, goals, shots,
// saves, cards and penalties for both sides, plus a per-opponent breakdown.
// With vs_from/vs_to it also returns a second period, so a coach can compare
// e.g. this season against last season. Dates are inclusive.
router.get('/team', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const { from, to, vs_from: vsFrom, vs_to: vsTo } = req.query;
    const range = parseRange(from, to, 'Period');
    const hasVs = vsFrom !== undefined || vsTo !== undefined;
    const vsRange = hasVs ? parseRange(vsFrom, vsTo, 'Comparison period') : null;

    const matches = await loadTeamMatches(pool, squadId, range);
    const body = {
      period: { from, to, summary: summarise(matches), opponents: byOpponent(matches), matches },
      comparePeriod: null,
    };
    if (vsRange) {
      const vsMatches = await loadTeamMatches(pool, squadId, vsRange);
      body.comparePeriod = {
        from: vsFrom,
        to: vsTo,
        summary: summarise(vsMatches),
        opponents: byOpponent(vsMatches),
        matches: vsMatches,
      };
    }
    res.json(body);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Error comparing team:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
