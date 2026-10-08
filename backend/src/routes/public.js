const express = require('express');
const pool = require('../db');

const router = express.Router();

// ---------------------------------------------------------------------------
// This router mixes two public-access models on purpose.
//
//   /squads, /squads/:id        -> DIRECTORY model. Any squad with
//                                  is_public = true is browsable by anyone,
//                                  including a landing-page list and
//                                  whatever's live right now.
//
//   /links/:token, /links/:token/export.csv
//                                -> PRIVATE-LINK model. A squad is invisible
//                                  unless you have the exact public_token
//                                  (set via POST /api/squads/mine/public-link).
//                                  No directory, no id-based lookup, plus a
//                                  CSV export a coach can hand out offline.
//
// No requireAuth() anywhere in this file — every route here is genuinely
// public/unauthenticated. Every query is scoped to is_public = true (or a
// matching public_token), so a squad that hasn't opted in is never reachable
// through either model, regardless of id or token guessing.
// ---------------------------------------------------------------------------

// --- shared score helpers (directory model) ---------------------------------

async function computeSimpleResult(eventId) {
  const result = await pool.query(
    `SELECT is_scoring, athlete_id, value FROM log_entries
     WHERE event_id = $1 AND fixture_id IS NULL AND deleted_at IS NULL`,
    [eventId]
  );
  const squadScore = result.rows
    .filter((l) => l.is_scoring && l.athlete_id !== null)
    .reduce((s, l) => s + l.value, 0);
  const opponentScore = result.rows
    .filter((l) => l.is_scoring && l.athlete_id === null)
    .reduce((s, l) => s + l.value, 0);
  return { squadScore, opponentScore };
}

async function computeFixtureResult(fixtureId, homeSquadId, awaySquadId) {
  const result = await pool.query(
    `SELECT l.is_scoring, l.value, a.squad_id AS athlete_squad_id
     FROM log_entries l
     LEFT JOIN athletes a ON a.id = l.athlete_id
     WHERE l.fixture_id = $1 AND l.deleted_at IS NULL`,
    [fixtureId]
  );
  const homeScore = result.rows
    .filter((l) => l.is_scoring && l.athlete_squad_id === homeSquadId)
    .reduce((s, l) => s + l.value, 0);
  const awayScore = result.rows
    .filter((l) => l.is_scoring && l.athlete_squad_id === awaySquadId)
    .reduce((s, l) => s + l.value, 0);
  return { homeScore, awayScore };
}

// GET /api/public/squads — landing page: opted-in squad directory + anything
// live right now involving at least one of them.
router.get('/squads', async (req, res) => {
  try {
    const squads = await pool.query(
      `SELECT s.id, s.name, COUNT(a.id)::int AS athlete_count
       FROM squads s
       LEFT JOIN athletes a ON a.squad_id = s.id
       WHERE s.is_public = true
       GROUP BY s.id
       ORDER BY s.name`
    );

    const liveEvents = await pool.query(
      `SELECT e.id, e.opponent, e.title, s.name AS squad_name
       FROM events e
       JOIN squads s ON s.id = e.squad_id
       WHERE e.status = 'live' AND e.format NOT IN ('league', 'tournament') AND s.is_public = true`
    );

    const liveFixtures = await pool.query(
      `SELECT f.id, f.home_squad_id, f.away_squad_id,
              home.name AS home_name, away.name AS away_name,
              e.title AS league_title
       FROM fixtures f
       JOIN squads home ON home.id = f.home_squad_id
       JOIN squads away ON away.id = f.away_squad_id
       JOIN events e ON e.id = f.event_id
       WHERE f.status = 'live' AND (home.is_public = true OR away.is_public = true)`
    );

    const live = [
      ...(await Promise.all(
        liveEvents.rows.map(async (e) => ({
          kind: 'match',
          id: e.id,
          squadName: e.squad_name,
          opponent: e.opponent || e.title || 'Opponent',
          ...(await computeSimpleResult(e.id)),
        }))
      )),
      ...(await Promise.all(
        liveFixtures.rows.map(async (f) => ({
          kind: 'fixture',
          id: f.id,
          homeName: f.home_name,
          awayName: f.away_name,
          league: f.league_title,
          ...(await computeFixtureResult(f.id, f.home_squad_id, f.away_squad_id)),
        }))
      )),
    ];

    res.json({ squads: squads.rows, live });
  } catch (err) {
    console.error('Error fetching public squads:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/public/squads/:id — one public squad's page: roster, recent
// results, and stat leaders aggregated across every logged action this
// squad's athletes have, whether from a plain match or a league fixture.
router.get('/squads/:id', async (req, res) => {
  try {
    const squadResult = await pool.query(
      'SELECT id, name FROM squads WHERE id = $1 AND is_public = true',
      [req.params.id]
    );
    if (squadResult.rows.length === 0) {
      return res.status(404).json({ error: 'This squad has not made a public page available' });
    }
    const squad = squadResult.rows[0];

    // Public-safe roster fields only — no contact info, no date of birth.
    const roster = await pool.query(
      `SELECT id, name, position, squad_number FROM athletes
       WHERE squad_id = $1 ORDER BY squad_number NULLS LAST, name`,
      [squad.id]
    );

    const simpleEvents = await pool.query(
      `SELECT id, event_date, opponent, title FROM events
       WHERE squad_id = $1 AND status = 'completed' AND format NOT IN ('league', 'tournament')
       ORDER BY event_date DESC LIMIT 10`,
      [squad.id]
    );
    const simpleResults = await Promise.all(
      simpleEvents.rows.map(async (e) => {
        const score = await computeSimpleResult(e.id);
        return {
          kind: 'match',
          date: e.event_date,
          opponent: e.opponent || e.title || 'Opponent',
          squadScore: score.squadScore,
          opponentScore: score.opponentScore,
        };
      })
    );

    const fixtures = await pool.query(
      `SELECT f.id, f.event_date, f.home_squad_id, f.away_squad_id,
              home.name AS home_name, away.name AS away_name, e.title AS league_title
       FROM fixtures f
       JOIN squads home ON home.id = f.home_squad_id
       JOIN squads away ON away.id = f.away_squad_id
       JOIN events e ON e.id = f.event_id
       WHERE f.status = 'completed' AND (f.home_squad_id = $1 OR f.away_squad_id = $1)
       ORDER BY f.event_date DESC LIMIT 10`,
      [squad.id]
    );
    const fixtureResults = await Promise.all(
      fixtures.rows.map(async (f) => {
        const score = await computeFixtureResult(f.id, f.home_squad_id, f.away_squad_id);
        const isHome = f.home_squad_id === Number(squad.id);
        return {
          kind: 'fixture',
          date: f.event_date,
          opponent: isHome ? f.away_name : f.home_name,
          squadScore: isHome ? score.homeScore : score.awayScore,
          opponentScore: isHome ? score.awayScore : score.homeScore,
          league: f.league_title,
        };
      })
    );

    const recentResults = [...simpleResults, ...fixtureResults]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 10);

    const leaders = await pool.query(
      `SELECT a.id AS athlete_id, a.name AS athlete_name,
              SUM(CASE WHEN l.action_type = 'goal' THEN l.value ELSE 0 END) AS goals,
              SUM(CASE WHEN l.action_type = 'assist' THEN l.value ELSE 0 END) AS assists
       FROM log_entries l
       JOIN athletes a ON a.id = l.athlete_id
       WHERE a.squad_id = $1 AND l.deleted_at IS NULL
       GROUP BY a.id, a.name
       HAVING SUM(CASE WHEN l.action_type = 'goal' THEN l.value ELSE 0 END) > 0
           OR SUM(CASE WHEN l.action_type = 'assist' THEN l.value ELSE 0 END) > 0
       ORDER BY goals DESC, assists DESC
       LIMIT 10`,
      [squad.id]
    );

    res.json({
      squad,
      roster: roster.rows,
      recentResults,
      leaders: leaders.rows.map((r) => ({
        athleteId: r.athlete_id,
        athleteName: r.athlete_name,
        goals: Number(r.goals),
        assists: Number(r.assists),
      })),
    });
  } catch (err) {
    console.error('Error fetching public squad page:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// --- private-link model -----------------------------------------------------

async function loadLinkedSquad(token) {
  const squadResult = await pool.query(
    `SELECT id, name, public_token FROM squads WHERE public_token = $1 AND is_public = true`,
    [token]
  );
  return squadResult.rows[0] || null;
}

// Builds the roster + stats payload shared by the private-link JSON page and
// the CSV export, so the two can never drift out of sync with each other.
async function buildRosterReport(squadId) {
  const athletesResult = await pool.query(
    `SELECT id, name, position, squad_number FROM athletes WHERE squad_id = $1 ORDER BY name`,
    [squadId]
  );

  const statsResult = await pool.query(
    `SELECT a.id AS athlete_id,
            COUNT(DISTINCT l.event_id) FILTER (WHERE l.deleted_at IS NULL) AS appearances,
            COALESCE(SUM(l.value) FILTER (WHERE l.action_type = 'goal' AND l.deleted_at IS NULL), 0) AS goals,
            COALESCE(SUM(l.value) FILTER (WHERE l.action_type = 'assist' AND l.deleted_at IS NULL), 0) AS assists,
            COUNT(*) FILTER (WHERE l.action_type = 'yellow_card' AND l.deleted_at IS NULL) AS yellow_cards,
            COUNT(*) FILTER (WHERE l.action_type = 'red_card' AND l.deleted_at IS NULL) AS red_cards
     FROM athletes a
     LEFT JOIN log_entries l ON l.athlete_id = a.id
     WHERE a.squad_id = $1
     GROUP BY a.id`,
    [squadId]
  );
  const statsByAthlete = new Map(statsResult.rows.map((r) => [r.athlete_id, r]));

  const resultsResult = await pool.query(
    `SELECT e.id, e.opponent, e.event_date,
            COALESCE(SUM(l.value) FILTER (WHERE l.is_scoring AND l.athlete_id IS NOT NULL AND l.deleted_at IS NULL), 0) AS squad_score,
            COALESCE(SUM(l.value) FILTER (WHERE l.is_scoring AND l.athlete_id IS NULL AND l.deleted_at IS NULL), 0) AS opponent_score
     FROM events e
     LEFT JOIN log_entries l ON l.event_id = e.id
     WHERE e.squad_id = $1 AND e.status = 'completed' AND e.format = 'match'
     GROUP BY e.id
     ORDER BY e.event_date DESC
     LIMIT 20`,
    [squadId]
  );

  const roster = athletesResult.rows.map((a) => {
    const s = statsByAthlete.get(a.id) || {};
    return {
      name: a.name,
      position: a.position,
      squadNumber: a.squad_number,
      appearances: Number(s.appearances || 0),
      goals: Number(s.goals || 0),
      assists: Number(s.assists || 0),
      yellowCards: Number(s.yellow_cards || 0),
      redCards: Number(s.red_cards || 0),
    };
  });

  const results = resultsResult.rows.map((r) => ({
    opponent: r.opponent,
    date: r.event_date,
    squadScore: Number(r.squad_score),
    opponentScore: Number(r.opponent_score),
  }));

  return { roster, results };
}

// GET /api/public/links/:token — squad name + roster stats + recent results,
// for anyone with the private link.
router.get('/links/:token', async (req, res) => {
  try {
    const squad = await loadLinkedSquad(req.params.token);
    if (!squad) {
      return res.status(404).json({ error: 'This link is not active' });
    }

    const { roster, results } = await buildRosterReport(squad.id);
    res.json({ squadName: squad.name, roster, results });
  } catch (err) {
    console.error('Error loading public squad page:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/public/links/:token/export.csv — downloadable roster + stats
// report. Built by hand (no CSV library needed) since it's a handful of
// flat, already-safe-to-join columns.
router.get('/links/:token/export.csv', async (req, res) => {
  try {
    const squad = await loadLinkedSquad(req.params.token);
    if (!squad) {
      return res.status(404).json({ error: 'This link is not active' });
    }

    const { roster } = await buildRosterReport(squad.id);

    function csvEscape(value) {
      const str = String(value ?? '');
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    }

    const header = ['Name', 'Position', 'Squad #', 'Appearances', 'Goals', 'Assists', 'Yellow cards', 'Red cards'];
    const rows = roster.map((a) => [
      a.name, a.position || '', a.squadNumber ?? '', a.appearances, a.goals, a.assists, a.yellowCards, a.redCards,
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');

    const filename = `${squad.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-roster.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('Error exporting squad CSV:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;