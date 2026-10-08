const express = require('express');
const pool = require('../db');
const { requireAuth, getAuth } = require('../middleware/auth');
const { getOwnedSquadId } = require('./_squad');

const router = express.Router();

const PERIOD_DAYS = { '7d': 7, '30d': 30, season: 365 };

// Rough free-text position normaliser. A coach's `position` field is
// free text, not a fixed list, so this is a best-effort grouping, not
// an exact classification. Anything unmatched falls into "Other".
function bucketPosition(position) {
  if (!position) return 'Other';
  const p = position.toLowerCase();
  if (/(goal|keeper|gk)/.test(p)) return 'GK';
  if (/(back|defen|cb|rb|lb|sweeper)/.test(p)) return 'DEF';
  if (/(mid|cm|cdm|cam|winger|wing)/.test(p)) return 'MID';
  if (/(forward|striker|fwd|attack)/.test(p)) return 'FWD';
  return 'Other';
}

router.get('/summary', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const period = PERIOD_DAYS[req.query.period] ? req.query.period : '7d';
    const days = PERIOD_DAYS[period];

    // ---- Roster + availability ----
    const athletesResult = await pool.query(
      `SELECT a.*, EXISTS (
         SELECT 1 FROM injuries i
         WHERE i.athlete_id = a.id
           AND i.cleared_at IS NULL
           AND i.return_date >= CURRENT_DATE
       ) AS is_injured
       FROM athletes a
       WHERE a.squad_id = $1`,
      [squadId]
    );
    const athletes = athletesResult.rows;
    const totalRoster = athletes.length;
    const injuredCount = athletes.filter((a) => a.is_injured).length;
    const managedCount = athletes.filter((a) => a.is_managed && !a.is_injured).length;
    const readyCount = totalRoster - injuredCount - managedCount;
    const readinessPct = totalRoster > 0 ? Math.round((readyCount / totalRoster) * 100) : 0;

    // Readiness trend: for each of the last N days, how many athletes
    // would have been "ready" that day, based on real injury date ranges.
    const trendDays = Math.min(days, 14); // cap the chart at 14 points for legibility
    const trend = [];
    for (let i = trendDays - 1; i >= 0; i--) {
      const dateResult = await pool.query(`SELECT (CURRENT_DATE - $1::int)::date AS d`, [i]);
      const d = dateResult.rows[0].d;
      const injuredOnDay = await pool.query(
        `SELECT COUNT(DISTINCT athlete_id) AS n FROM injuries i
         JOIN athletes a ON a.id = i.athlete_id
         WHERE a.squad_id = $1
           AND i.date_sustained <= $2
           AND (i.cleared_at IS NULL OR i.cleared_at::date > $2)
           AND (i.return_date IS NULL OR i.return_date >= $2)`,
        [squadId, d]
      );
      const injuredThatDay = Number(injuredOnDay.rows[0].n);
      const readyThatDay = totalRoster > 0 ? Math.round(((totalRoster - injuredThatDay) / totalRoster) * 100) : 0;
      trend.push({ date: d, readiness: readyThatDay });
    }

    // ---- Position availability ----
    const positionBuckets = { GK: 0, DEF: 0, MID: 0, FWD: 0, Other: 0 };
    athletes.forEach((a) => {
      positionBuckets[bucketPosition(a.position)] += 1;
    });

    // ---- Match results in period (regular events only, not league fixtures) ----
    const eventsResult = await pool.query(
      `SELECT id, opponent, event_date, status
       FROM events
       WHERE squad_id = $1
         AND status = 'completed'
         AND format = 'match'
         AND event_date >= now() - ($2 || ' days')::interval
       ORDER BY event_date DESC`,
      [squadId, days]
    );
    const events = eventsResult.rows;

    let totalGoalsFor = 0;
    const formResults = [];

    for (const event of events) {
      const logsResult = await pool.query(
        `SELECT athlete_id, is_scoring, value FROM log_entries
         WHERE event_id = $1 AND deleted_at IS NULL`,
        [event.id]
      );
      const logs = logsResult.rows;
      const squadGoals = logs
        .filter((l) => l.is_scoring && l.athlete_id !== null)
        .reduce((sum, l) => sum + l.value, 0);
      const opponentGoals = logs
        .filter((l) => l.is_scoring && l.athlete_id === null)
        .reduce((sum, l) => sum + l.value, 0);

      totalGoalsFor += squadGoals;

      let result = 'D';
      if (squadGoals > opponentGoals) result = 'W';
      else if (squadGoals < opponentGoals) result = 'L';
      formResults.push(result);
    }

    const points = formResults.reduce(
      (sum, r) => sum + (r === 'W' ? 3 : r === 'D' ? 1 : 0),
      0
    );
    const matchesPlayed = events.length;
    const goalsPerMatch = matchesPlayed > 0 ? +(totalGoalsFor / matchesPlayed).toFixed(1) : 0;

    // ---- Attack leaders (top scorers in period, regular events only) ----
    const attackLeadersResult = await pool.query(
      `SELECT a.id, a.name, a.position, SUM(l.value) AS goals
       FROM log_entries l
       JOIN athletes a ON a.id = l.athlete_id
       JOIN events e ON e.id = l.event_id
       WHERE a.squad_id = $1
         AND l.action_type = 'goal'
         AND l.deleted_at IS NULL
         AND e.event_date >= now() - ($2 || ' days')::interval
       GROUP BY a.id, a.name, a.position
       ORDER BY goals DESC
       LIMIT 4`,
      [squadId, days]
    );

    // ---- Live right now: a simple event, or a league fixture the squad is in ----
    const liveEventResult = await pool.query(
      `SELECT * FROM events
       WHERE squad_id = $1 AND status = 'live'
       ORDER BY started_at DESC NULLS LAST, event_date DESC LIMIT 1`,
      [squadId]
    );

    let liveEvent = null;
    if (liveEventResult.rows.length > 0) {
      const ev = liveEventResult.rows[0];
      const liveLogsResult = await pool.query(
        `SELECT athlete_id, is_scoring, value FROM log_entries
         WHERE event_id = $1 AND fixture_id IS NULL AND deleted_at IS NULL`,
        [ev.id]
      );
      const liveLogs = liveLogsResult.rows;
      const mine = liveLogs
        .filter((l) => l.is_scoring && l.athlete_id !== null)
        .reduce((sum, l) => sum + l.value, 0);
      const theirs = liveLogs
        .filter((l) => l.is_scoring && l.athlete_id === null)
        .reduce((sum, l) => sum + l.value, 0);
      liveEvent = {
        kind: 'event',
        id: ev.id,
        title: ev.opponent ? `vs ${ev.opponent}` : (ev.title || 'Training session'),
        homeLabel: 'Your squad',
        awayLabel: ev.opponent || 'Opponent',
        homeScore: mine,
        awayScore: theirs,
        link: `/live/${ev.id}`,
      };
    } else {
      const liveFixtureResult = await pool.query(
        `SELECT f.*, e.title AS event_title,
                home.name AS home_name, away.name AS away_name
         FROM fixtures f
         JOIN events e ON e.id = f.event_id
         JOIN event_teams et ON et.event_id = f.event_id AND et.squad_id = $1
         JOIN squads home ON home.id = f.home_squad_id
         JOIN squads away ON away.id = f.away_squad_id
         WHERE f.status = 'live'
         ORDER BY f.started_at DESC NULLS LAST LIMIT 1`,
        [squadId]
      );
      if (liveFixtureResult.rows.length > 0) {
        const fx = liveFixtureResult.rows[0];
        const fxLogsResult = await pool.query(
          `SELECT athlete_id, is_scoring, value FROM log_entries
           WHERE fixture_id = $1 AND deleted_at IS NULL`,
          [fx.id]
        );
        const fxLogs = fxLogsResult.rows;
        const home = fxLogs
          .filter((l) => l.is_scoring && l.athlete_id !== null)
          .reduce((sum, l) => sum + l.value, 0);
        const away = fxLogs
          .filter((l) => l.is_scoring && l.athlete_id === null)
          .reduce((sum, l) => sum + l.value, 0);
        liveEvent = {
          kind: 'fixture',
          id: fx.id,
          title: fx.event_title || 'League fixture',
          homeLabel: fx.home_name,
          awayLabel: fx.away_name,
          homeScore: home,
          awayScore: away,
          link: `/live/fixture/${fx.id}`,
        };
      }
    }

    // ---- Next upcoming event ----
    const nextEventResult = await pool.query(
      `SELECT * FROM events
       WHERE squad_id = $1 AND status = 'scheduled' AND event_date > now()
       ORDER BY event_date ASC LIMIT 1`,
      [squadId]
    );

    res.json({
      period,
      liveEvent,
      squad: {
        totalRoster,
        readyCount,
        managedCount,
        injuredCount,
        readinessPct,
      },
      readinessTrend: trend,
      positionAvailability: positionBuckets,
      form: {
        results: formResults.slice(0, 5), // most recent first, capped for the W/D/L strip
        points,
        matchesPlayed,
        pointsPossible: matchesPlayed * 3,
      },
      teamGoals: {
        total: totalGoalsFor,
        perMatch: goalsPerMatch,
      },
      attackLeaders: attackLeadersResult.rows.map((r) => ({
        id: r.id,
        name: r.name,
        position: r.position,
        goals: Number(r.goals),
      })),
      nextEvent: nextEventResult.rows[0] || null,
    });
  } catch (err) {
    console.error('Error building dashboard summary:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;