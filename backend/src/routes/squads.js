const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const { requireAuth, getAuth } = require('../middleware/auth');
const { getOwnedSquadId, getOwnedSquadIdForStaff, getOwnedSquadIdForCoach } = require('./_squad');
const {
  getSquadMatches,
  summariseMatches,
  groupByOpponent,
} = require('../lib/matchStats');

const router = express.Router();

// GET /api/squads/mine — get the logged-in user's squad, creating one if it doesn't exist yet
router.get('/mine', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const result = await pool.query(
      `SELECT s.*, COUNT(a.id)::int AS athlete_count
       FROM squads s
       LEFT JOIN athletes a ON a.squad_id = s.id
       WHERE s.id = $1
       GROUP BY s.id`,
      [squadId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching/creating squad:', err.message);
    const status = err.status || 500;
    res.status(status).json({ error: status === 403 ? err.message : 'Server error' });
  }
});

// PATCH /api/squads/mine — rename the squad, set gender, mark onboarding
// complete, and/or toggle public page visibility. Coach only — players and
// assistants never manage squad settings.
router.patch('/mine', requireAuth(), async (req, res) => {
  try {
    const { name, gender, onboarded, is_public } = req.body;

    if (name !== undefined && !name.trim()) {
      return res.status(400).json({ error: 'Squad name cannot be empty' });
    }

    if (gender !== undefined && !['male', 'female'].includes(gender)) {
      return res.status(400).json({ error: 'Gender must be male or female' });
    }

    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);

    // Only relevant when turning public ON. If the squad already has a
    // token (e.g. was public before and got turned off), we keep it so the
    // same link keeps working rather than silently breaking a link someone
    // was already given out. The COALESCE below only uses this value when
    // public_token is currently NULL.
    const candidateToken = is_public === true ? crypto.randomBytes(24).toString('hex') : null;

    const result = await pool.query(
      `UPDATE squads
       SET name = COALESCE($1, name),
           gender = COALESCE($2, gender),
           onboarded = COALESCE($3, onboarded),
           is_public = COALESCE($4, is_public),
           public_token = CASE
             WHEN $4 = true THEN COALESCE(public_token, $6)
             ELSE public_token
           END
       WHERE id = $5 RETURNING *`,
      [name ? name.trim() : null, gender || null, onboarded ?? null, is_public ?? null, squadId, candidateToken]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating squad:', err.message);
    const status = err.status || 500;
    res.status(status).json({ error: status === 403 ? err.message : 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// T18: Squad trend series — per-match results over time for charting.
// Optional ?season_id= restricts to a season (tagged events + untagged events
// inside the season range, fixtures by date). Returns the match list plus a
// cumulative running series so the frontend can draw points/goals lines.
// ---------------------------------------------------------------------------
router.get('/mine/trends', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    let opts = {};
    if (req.query.season_id) {
      const season = await pool.query(
        'SELECT * FROM seasons WHERE id = $1 AND squad_id = $2',
        [req.query.season_id, squadId]
      );
      if (season.rows.length === 0) {
        return res.status(404).json({ error: 'Season not found' });
      }
      const s = season.rows[0];
      opts = { seasonId: s.id, fromDate: s.start_date, toDate: s.end_date };
    }

    const matches = await getSquadMatches(pool, squadId, opts);
    const totals = summariseMatches(matches);

    let cumWins = 0;
    let cumDraws = 0;
    let cumLosses = 0;
    let cumGf = 0;
    let cumGa = 0;
    let cumPoints = 0;
    const series = matches.map((m) => {
      cumGf += m.gf;
      cumGa += m.ga;
      cumPoints += m.result === 'W' ? 3 : m.result === 'D' ? 1 : 0;
      if (m.result === 'W') cumWins++;
      else if (m.result === 'D') cumDraws++;
      else cumLosses++;
      return {
        kind: m.kind,
        refId: m.refId,
        eventId: m.eventId,
        date: m.date,
        opponent: m.opponent,
        venue: m.venue,
        gf: m.gf,
        ga: m.ga,
        result: m.result,
        cumulative: {
          wins: cumWins,
          draws: cumDraws,
          losses: cumLosses,
          gf: cumGf,
          ga: cumGa,
          points: cumPoints,
        },
      };
    });

    res.json({ totals, matches: series });
  } catch (err) {
    console.error('Error fetching squad trends:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// T19: Team vs opponent comparison — the team-level equivalent of the
// per-athlete opponent breakdown. Aggregates the squad's completed matches per
// opponent (played, W/D/L, GF/GA, points) plus the individual match list so the
// UI can show a head-to-head detail view.
// ---------------------------------------------------------------------------
router.get('/mine/vs-opponents', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    let opts = {};
    if (req.query.season_id) {
      const season = await pool.query(
        'SELECT * FROM seasons WHERE id = $1 AND squad_id = $2',
        [req.query.season_id, squadId]
      );
      if (season.rows.length === 0) {
        return res.status(404).json({ error: 'Season not found' });
      }
      const s = season.rows[0];
      opts = { seasonId: s.id, fromDate: s.start_date, toDate: s.end_date };
    }

    const matches = await getSquadMatches(pool, squadId, opts);
    const opponents = groupByOpponent(matches).map(({ matches: list, ...rest }) => ({
      ...rest,
      matches: list.map((m) => ({
        kind: m.kind,
        refId: m.refId,
        eventId: m.eventId,
        date: m.date,
        venue: m.venue,
        gf: m.gf,
        ga: m.ga,
        result: m.result,
      })),
    }));

    res.json({ totals: summariseMatches(matches), opponents });
  } catch (err) {
    console.error('Error fetching opponent comparison:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// T24/T25 support: public directory of squads on the platform. No auth — this
// powers the "arrange a friendly" opponent picker and the public leaderboard.
// ---------------------------------------------------------------------------
router.get('/directory', requireAuth(), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.id, s.name, s.created_at,
              u.id AS coach_user_id,
              (SELECT COUNT(*) FROM athletes a WHERE a.squad_id = s.id)::int AS athlete_count
       FROM squads s
       LEFT JOIN users u ON u.id = s.coach_id
       ORDER BY s.name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching squad directory:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
