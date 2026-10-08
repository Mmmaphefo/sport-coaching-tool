const express = require('express');
const { Pool } = require('pg');

const router = express.Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// GET /api/leaderboard — public, platform-wide table (T25).
//
// Built from every completed match on the platform:
//  - League/tournament fixtures count for BOTH squads (home goals are log
//    entries with an athlete, away goals are entries with athlete_id NULL).
//  - Simple match events count for their owning squad only (own goals have an
//    athlete, opponent goals have athlete_id NULL). Accepted friendlies are
//    normal events, so they flow through here for each squad's mirrored copy.
// Fixture logs carry both event_id and fixture_id, so the events branch filters
// on fixture_id IS NULL to avoid counting them twice.
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `WITH fixture_goals AS (
         SELECT f.id,
                f.home_squad_id,
                f.away_squad_id,
                COALESCE(SUM(CASE WHEN l.athlete_id IS NOT NULL THEN l.value ELSE 0 END), 0) AS home_goals,
                COALESCE(SUM(CASE WHEN l.athlete_id IS NULL THEN l.value ELSE 0 END), 0) AS away_goals
         FROM fixtures f
         LEFT JOIN log_entries l
           ON l.fixture_id = f.id AND l.is_scoring AND l.deleted_at IS NULL
         WHERE f.status = 'completed'
         GROUP BY f.id, f.home_squad_id, f.away_squad_id
       ),
       matches AS (
         SELECT home_squad_id AS squad_id, home_goals AS gf, away_goals AS ga
         FROM fixture_goals
         UNION ALL
         SELECT away_squad_id, away_goals, home_goals
         FROM fixture_goals
         UNION ALL
         SELECT e.squad_id,
                COALESCE(SUM(CASE WHEN l.athlete_id IS NOT NULL THEN l.value ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN l.athlete_id IS NULL THEN l.value ELSE 0 END), 0)
         FROM events e
         LEFT JOIN log_entries l
           ON l.event_id = e.id AND l.fixture_id IS NULL AND l.is_scoring AND l.deleted_at IS NULL
         WHERE e.event_type = 'match' AND e.status = 'completed'
         GROUP BY e.id, e.squad_id
       )
       SELECT s.id AS squad_id,
              s.name,
              COALESCE(COUNT(m.squad_id), 0)::int AS played,
              COALESCE(SUM(CASE WHEN m.gf > m.ga THEN 1 ELSE 0 END), 0)::int AS wins,
              COALESCE(SUM(CASE WHEN m.gf = m.ga THEN 1 ELSE 0 END), 0)::int AS draws,
              COALESCE(SUM(CASE WHEN m.ga > m.gf THEN 1 ELSE 0 END), 0)::int AS losses,
              COALESCE(SUM(m.gf), 0)::int AS gf,
              COALESCE(SUM(m.ga), 0)::int AS ga,
              (SELECT COUNT(*) FROM athletes a WHERE a.squad_id = s.id)::int AS athlete_count
       FROM squads s
       LEFT JOIN matches m ON m.squad_id = s.id
       GROUP BY s.id, s.name
       ORDER BY SUM(CASE WHEN m.gf > m.ga THEN 3 WHEN m.gf = m.ga THEN 1 ELSE 0 END) DESC NULLS LAST,
                (COALESCE(SUM(m.gf), 0) - COALESCE(SUM(m.ga), 0)) DESC,
                COALESCE(SUM(m.gf), 0) DESC,
                COALESCE(COUNT(m.squad_id), 0) DESC,
                s.name ASC`
    );

    const countResult = await pool.query(
      `SELECT (SELECT COUNT(*) FROM fixtures WHERE status = 'completed')
            + (SELECT COUNT(*) FROM events WHERE event_type = 'match' AND status = 'completed')
            ::int AS total_matches`
    );

    const leaderboard = result.rows.map((row, index) => ({
      rank: index + 1,
      ...row,
      gd: row.gf - row.ga,
      points: row.wins * 3 + row.draws,
    }));

    res.json({
      leaderboard,
      total_squads: leaderboard.length,
      total_matches: countResult.rows[0]?.total_matches ?? 0,
    });
  } catch (err) {
    console.error('Error building leaderboard:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
