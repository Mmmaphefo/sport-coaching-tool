// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
//
// Exportable reports (T20). Both endpoints return everything a printable
// report page needs in one response; the page offers Print / Save as PDF and
// a CSV download. All figures are derived from the live log, using the same
// side rule as lib/teamStats.js: an entry is OURS when its athlete belongs to
// this squad, THEIRS otherwise.

const express = require('express');
const pool = require('../db');
const { requireAuth, getAuth } = require('../middleware/auth');
const { getOwnedSquadId } = require('./_squad');
const { loadTeamMatches, summarise, byOpponent, parseRange, resultFor } = require('../lib/teamStats');

const router = express.Router();

async function squadName(squadId) {
  const r = await pool.query('SELECT name FROM squads WHERE id = $1', [squadId]);
  return r.rows[0]?.name || 'Your squad';
}

// GET /api/reports/season?from=YYYY-MM-DD&to=YYYY-MM-DD
// Season report: record, every result, record per opponent, and per-player
// totals (appearances = matches the player has a logged action in).
router.get('/season', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);
    const range = parseRange(req.query.from, req.query.to, 'Period');

    const matches = await loadTeamMatches(pool, squadId, range);
    const eventIds = matches.filter((m) => m.kind === 'match').map((m) => m.id);
    const fixtureIds = matches.filter((m) => m.kind === 'fixture').map((m) => m.id);

    let players = [];
    if (eventIds.length || fixtureIds.length) {
      const rows = await pool.query(
        `SELECT a.id, a.name, a.squad_number,
                COUNT(DISTINCT COALESCE('f' || l.fixture_id, 'e' || l.event_id)) AS appearances,
                COALESCE(SUM(l.value) FILTER (WHERE l.is_scoring), 0) AS goals,
                COUNT(*) FILTER (WHERE l.action_type = 'assist') AS assists,
                COUNT(*) FILTER (WHERE l.action_type = 'shot_on_target') AS shots_on_target,
                COUNT(*) FILTER (WHERE l.action_type = 'yellow_card') AS yellow_cards,
                COUNT(*) FILTER (WHERE l.action_type = 'red_card') AS red_cards
           FROM log_entries l
           JOIN athletes a ON a.id = l.athlete_id AND a.squad_id = $3
          WHERE l.deleted_at IS NULL
            AND ((l.fixture_id IS NULL AND l.event_id = ANY($1::int[]))
                 OR l.fixture_id = ANY($2::int[]))
          GROUP BY a.id
          ORDER BY goals DESC, assists DESC, a.name`,
        [eventIds, fixtureIds, squadId]
      );
      players = rows.rows.map((r) => ({
        id: r.id,
        name: r.name,
        squadNumber: r.squad_number,
        appearances: Number(r.appearances),
        goals: Number(r.goals),
        assists: Number(r.assists),
        shotsOnTarget: Number(r.shots_on_target),
        yellowCards: Number(r.yellow_cards),
        redCards: Number(r.red_cards),
      }));
    }

    res.json({
      squadName: await squadName(squadId),
      from: req.query.from,
      to: req.query.to,
      summary: summarise(matches),
      matches,
      opponents: byOpponent(matches),
      players,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Error building season report:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/reports/match/:kind/:id — kind is "event" (a regular match) or
// "fixture" (a league/tournament fixture the squad played in). The shared
// stats library spells a regular match "match", which is accepted as an
// alias so trends and comparisons can link here with their own vocabulary.
router.get('/match/:kind/:id', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);
    // lib/teamStats calls a regular match kind "match"; this route speaks
    // "event". Normalise so both vocabularies reach the same lookup.
    const kind = req.params.kind === 'match' ? 'event' : req.params.kind;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || (kind !== 'event' && kind !== 'fixture')) {
      return res.status(404).json({ error: 'Match not found' });
    }

    let match;
    let logFilter;
    if (kind === 'event') {
      const r = await pool.query(
        `SELECT id, title, opponent, event_date, location, status, format
           FROM events WHERE id = $1 AND squad_id = $2`,
        [id, squadId]
      );
      const ev = r.rows[0];
      if (!ev || ev.format !== 'match') return res.status(404).json({ error: 'Match not found' });
      match = {
        kind,
        id: ev.id,
        date: ev.event_date,
        location: ev.location,
        status: ev.status,
        competition: null,
        opponent: (ev.opponent || '').trim() || 'Opponent',
        home: true,
      };
      logFilter = { sql: 'l.fixture_id IS NULL AND l.event_id = $1', param: id };
    } else {
      const r = await pool.query(
        `SELECT f.id, f.event_date, f.status, f.home_squad_id, f.away_squad_id,
                home.name AS home_name, away.name AS away_name, e.title AS competition, e.location
           FROM fixtures f
           JOIN squads home ON home.id = f.home_squad_id
           JOIN squads away ON away.id = f.away_squad_id
           JOIN events e ON e.id = f.event_id
          WHERE f.id = $1 AND (f.home_squad_id = $2 OR f.away_squad_id = $2)`,
        [id, squadId]
      );
      const fx = r.rows[0];
      if (!fx) return res.status(404).json({ error: 'Match not found' });
      const weAreHome = fx.home_squad_id === squadId;
      match = {
        kind,
        id: fx.id,
        date: fx.event_date,
        location: fx.location,
        status: fx.status,
        competition: fx.competition,
        opponent: weAreHome ? fx.away_name : fx.home_name,
        home: weAreHome,
      };
      logFilter = { sql: 'l.fixture_id = $1', param: id };
    }

    const logs = await pool.query(
      `SELECT l.id, l.minute, l.action_type, l.is_scoring, l.value, l.notes, l.related_log_id,
              l.athlete_id, a.name AS athlete_name,
              (l.athlete_id IS NOT NULL AND a.squad_id = $2) AS ours
         FROM log_entries l
         LEFT JOIN athletes a ON a.id = l.athlete_id
        WHERE ${logFilter.sql} AND l.deleted_at IS NULL
        ORDER BY l.minute NULLS LAST, l.logged_at, l.id`,
      [logFilter.param, squadId]
    );

    // Names for "on:<athlete_id>" substitution notes.
    const onIds = logs.rows
      .map((l) => /^on:(\d+)$/.exec(l.notes || ''))
      .filter(Boolean)
      .map((m) => Number(m[1]));
    const names = new Map();
    if (onIds.length) {
      const r = await pool.query('SELECT id, name FROM athletes WHERE id = ANY($1::int[])', [onIds]);
      for (const row of r.rows) names.set(row.id, row.name);
    }

    const assistsByGoal = new Map(
      logs.rows.filter((l) => l.action_type === 'assist' && l.related_log_id)
        .map((l) => [l.related_log_id, l.athlete_name])
    );

    const totals = { us: { goals: 0 }, them: { goals: 0 } };
    const scorers = [];
    const cards = [];
    const penalties = [];
    const substitutions = [];
    const timeline = [];
    let shotsUs = 0;
    let shotsThem = 0;
    let savesUs = 0;
    let savesThem = 0;

    for (const l of logs.rows) {
      const side = l.ours ? 'us' : 'them';
      const who = l.athlete_name || (l.ours ? 'Unknown player' : match.opponent);
      if (l.is_scoring) {
        totals[side].goals += Number(l.value) || 0;
        scorers.push({ side, name: who, minute: l.minute, assist: assistsByGoal.get(l.id) || null });
      }
      if (l.action_type === 'yellow_card' || l.action_type === 'red_card') {
        cards.push({ side, name: who, minute: l.minute, card: l.action_type === 'red_card' ? 'red' : 'yellow' });
      }
      if (l.action_type === 'penalty') penalties.push({ side, name: who, minute: l.minute });
      if (l.action_type === 'shot_on_target') {
        if (l.ours) shotsUs += 1;
        else shotsThem += 1;
      }
      if (l.action_type === 'save') {
        if (l.ours) savesUs += 1;
        else savesThem += 1;
      }
      let detail = null;
      if (l.action_type === 'substitution') {
        const on = /^on:(\d+)$/.exec(l.notes || '');
        const onName = on ? names.get(Number(on[1])) || 'Substitute' : null;
        substitutions.push({ side, off: who, on: onName, minute: l.minute });
        detail = onName ? `${who} off, ${onName} on` : null;
      } else if (l.notes && !/^on:\d+$/.test(l.notes)) {
        detail = l.notes;
      }
      // Assists appear with their goal rather than as a separate line.
      if (l.action_type === 'assist' && l.related_log_id) continue;
      timeline.push({ minute: l.minute, side, action: l.action_type, name: who, detail });
    }

    res.json({
      squadName: await squadName(squadId),
      match,
      score: { us: totals.us.goals, them: totals.them.goals },
      result: resultFor(totals.us, totals.them),
      stats: {
        us: { shotsOnTarget: shotsUs, saves: savesUs, yellowCards: cards.filter((c) => c.side === 'us' && c.card === 'yellow').length, redCards: cards.filter((c) => c.side === 'us' && c.card === 'red').length, penalties: penalties.filter((p) => p.side === 'us').length },
        them: { shotsOnTarget: shotsThem, saves: savesThem, yellowCards: cards.filter((c) => c.side === 'them' && c.card === 'yellow').length, redCards: cards.filter((c) => c.side === 'them' && c.card === 'red').length, penalties: penalties.filter((p) => p.side === 'them').length },
      },
      scorers,
      cards,
      penalties,
      substitutions,
      timeline,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Error building match report:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
