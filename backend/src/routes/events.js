const express = require('express');
const { Pool } = require('pg');
const { requireAuth, getAuth } = require('../middleware/auth');
const { getOwnedSquadId, getOrCreateUserId, getOwnedSquadIdForCoach } = require('./_squad');
const { buildMatchSummary } = require('../lib/summary');
const { buildCsv, buildPdf } = require('../lib/reports');

const router = express.Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const LEAGUE_FORMATS = new Set(['league', 'tournament']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getEventTeams(pool, eventId, squadId = null) {
  const result = await pool.query(
    `SELECT et.*, s.name AS squad_name,
            ${squadId ? `CASE WHEN et.squad_id = $2 THEN true ELSE false END AS is_mine` : 'false AS is_mine'}
     FROM event_teams et
     JOIN squads s ON s.id = et.squad_id
     WHERE et.event_id = $1
     ORDER BY et.seed_order NULLS LAST, et.joined_at`,
    squadId ? [eventId, squadId] : [eventId]
  );
  return result.rows;
}

async function getEventFixtures(pool, eventId, squadId = null) {
  const result = await pool.query(
    `SELECT f.*,
            home.name AS home_squad_name,
            away.name AS away_squad_name,
            ${squadId ? `CASE WHEN f.home_squad_id = $2 THEN true ELSE false END AS is_home_mine,
            CASE WHEN f.away_squad_id = $2 THEN true ELSE false END AS is_away_mine` : 'false AS is_home_mine, false AS is_away_mine'}
     FROM fixtures f
     JOIN squads home ON home.id = f.home_squad_id
     JOIN squads away ON away.id = f.away_squad_id
     WHERE f.event_id = $1
     ORDER BY f.event_date NULLS LAST, f.id`,
    squadId ? [eventId, squadId] : [eventId]
  );
  return result.rows;
}

async function getFixtureLogs(pool, fixtureId) {
  const result = await pool.query(
    `SELECT l.*, a.name AS athlete_name
     FROM log_entries l
     LEFT JOIN athletes a ON a.id = l.athlete_id
     WHERE l.fixture_id = $1 AND l.deleted_at IS NULL
     ORDER BY l.minute NULLS LAST, l.logged_at`,
    [fixtureId]
  );
  return result.rows;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

async function generateFixtures(pool, eventId) {
  const teams = await getEventTeams(pool, eventId);
  if (teams.length < 2) {
    throw new Error('At least two teams are required to generate a schedule');
  }

  // Each pair of teams plays twice: once at home, once away.
  const fixtures = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = 0; j < teams.length; j++) {
      if (i === j) continue;
      fixtures.push({
        home_squad_id: teams[i].squad_id,
        away_squad_id: teams[j].squad_id,
      });
    }
  }

  shuffle(fixtures);

  const created = [];
  for (const fixture of fixtures) {
    const result = await pool.query(
      `INSERT INTO fixtures (event_id, home_squad_id, away_squad_id)
       VALUES ($1, $2, $3) RETURNING *`,
      [eventId, fixture.home_squad_id, fixture.away_squad_id]
    );
    created.push(result.rows[0]);
  }

  await pool.query(
    "UPDATE events SET status = 'scheduled', updated_at = now() WHERE id = $1",
    [eventId]
  );

  return created;
}

async function computeStandings(pool, eventId) {
  const fixtures = await getEventFixtures(pool, eventId);
  const teams = await getEventTeams(pool, eventId);
  const teamMap = new Map(teams.map((t) => [t.squad_id, { ...t, played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, gd: 0, points: 0 }]));

  for (const fixture of fixtures) {
    if (fixture.status !== 'completed') continue;

    const logs = await getFixtureLogs(pool, fixture.id);
    const homeGoals = logs
      .filter((l) => l.is_scoring && l.athlete_id !== null)
      .reduce((sum, l) => sum + l.value, 0);
    const awayGoals = logs
      .filter((l) => l.is_scoring && l.athlete_id === null)
      .reduce((sum, l) => sum + l.value, 0);

    const home = teamMap.get(fixture.home_squad_id);
    const away = teamMap.get(fixture.away_squad_id);
    if (!home || !away) continue;

    home.played++;
    away.played++;
    home.gf += homeGoals;
    home.ga += awayGoals;
    away.gf += awayGoals;
    away.ga += homeGoals;

    if (homeGoals > awayGoals) {
      home.wins++;
      home.points += 3;
      away.losses++;
    } else if (awayGoals > homeGoals) {
      away.wins++;
      away.points += 3;
      home.losses++;
    } else {
      home.draws++;
      away.draws++;
      home.points++;
      away.points++;
    }
  }

  const standings = Array.from(teamMap.values()).map((t) => ({
    squadId: t.squad_id,
    squadName: t.squad_name,
    played: t.played,
    wins: t.wins,
    draws: t.draws,
    losses: t.losses,
    gf: t.gf,
    ga: t.ga,
    gd: t.gf - t.ga,
    points: t.points,
  }));

  // Standard football ordering: points, then goal difference, then goals for.
  standings.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.gd !== a.gd) return b.gd - a.gd;
    return b.gf - a.gf;
  });

  return standings;
}

async function computeTopStats(pool, eventId) {
  const result = await pool.query(
    `SELECT l.athlete_id, a.name AS athlete_name, s.id AS squad_id, s.name AS squad_name,
            SUM(CASE WHEN l.action_type = 'goal' THEN l.value ELSE 0 END) AS goals,
            SUM(CASE WHEN l.action_type = 'assist' THEN l.value ELSE 0 END) AS assists
     FROM log_entries l
     JOIN fixtures f ON f.id = l.fixture_id
     JOIN athletes a ON a.id = l.athlete_id
     JOIN squads s ON s.id = a.squad_id
     WHERE f.event_id = $1 AND l.deleted_at IS NULL
     GROUP BY l.athlete_id, a.name, s.id, s.name
     ORDER BY goals DESC, assists DESC`,
    [eventId]
  );

  const rows = result.rows.map((r) => ({
    athleteId: r.athlete_id,
    athleteName: r.athlete_name,
    squadId: r.squad_id,
    squadName: r.squad_name,
    goals: Number(r.goals),
    assists: Number(r.assists),
  }));

  return {
    topScorers: rows.filter((r) => r.goals > 0),
    topAssisters: rows.filter((r) => r.assists > 0).sort((a, b) => b.assists - a.assists),
  };
}

async function loadEventWithAccess(pool, eventId, squadId) {
  const eventResult = await pool.query(
    `SELECT e.*
     FROM events e
     LEFT JOIN event_teams et ON et.event_id = e.id AND et.squad_id = $2
     WHERE e.id = $1 AND (e.squad_id = $2 OR et.squad_id IS NOT NULL)`,
    [eventId, squadId]
  );
  return eventResult.rows[0] || null;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /api/events — list events the logged-in coach's squad participates in
router.get('/', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const result = await pool.query(
      `SELECT e.*,
              (SELECT COUNT(*) FROM event_teams et WHERE et.event_id = e.id) AS team_count
       FROM events e
       LEFT JOIN event_teams et ON et.event_id = e.id AND et.squad_id = $1
       WHERE e.squad_id = $1
          OR et.squad_id IS NOT NULL
          OR (e.status = 'open' AND e.format IN ('league', 'tournament'))
       ORDER BY e.event_date DESC`,
      [squadId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching events:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/events — schedule a new event or create a league/tournament
router.post('/', requireAuth(), async (req, res) => {
  try {
    const {
      title,
      opponent,
      event_type,
      type,
      event_date,
      event_time,
      location,
      duration_minutes,
      format,
      required_teams,
      season_id,
    } = req.body;

    if (!event_date) {
      return res.status(400).json({ error: 'event_date is required' });
    }

    const eventFormat = format || 'match';
    if (!['match', 'training', 'league', 'tournament'].includes(eventFormat)) {
      return res.status(400).json({ error: 'Invalid event format' });
    }

    const isLeague = LEAGUE_FORMATS.has(eventFormat);
    if (isLeague) {
      const teamCount = Number(required_teams);
      if (!teamCount || teamCount < 2) {
        return res.status(400).json({ error: 'required_teams must be at least 2 for league/tournament events' });
      }
    }

    const timestamp = event_time ? `${event_date}T${event_time}` : event_date;

    const { userId: clerkUserId } = getAuth(req);
    const userId = await getOrCreateUserId(pool, clerkUserId);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    // Optional season tag (T17) — must belong to this squad.
    let validSeasonId = null;
    if (season_id) {
      const seasonCheck = await pool.query(
        'SELECT id FROM seasons WHERE id = $1 AND squad_id = $2',
        [season_id, squadId]
      );
      if (seasonCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Unknown season for this squad' });
      }
      validSeasonId = season_id;
    }

    const result = await pool.query(
      `INSERT INTO events (squad_id, title, opponent, event_type, format, required_teams, season_id, event_date, location, duration_minutes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        squadId,
        title ? title.trim() : null,
        opponent ? opponent.trim() : null,
        type || event_type || 'match',
        eventFormat,
        isLeague ? Number(required_teams) : null,
        validSeasonId,
        timestamp,
        location ? location.trim() : null,
        duration_minutes ? Number(duration_minutes) : 90,
        userId,
      ]
    );

    const event = result.rows[0];

    if (isLeague) {
      await pool.query(
        `INSERT INTO event_teams (event_id, squad_id, role, seed_order)
         VALUES ($1, $2, 'participant', 1)`,
        [event.id, squadId]
      );
      event.status = 'open';
      await pool.query(
        "UPDATE events SET status = 'open' WHERE id = $1",
        [event.id]
      );
      event.team_count = 1;
    }

    res.status(201).json(event);
  } catch (err) {
    console.error('Error creating event:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// T23 support: clash detection. Returns pairs of the squad's non-cancelled
// events whose time windows overlap. Optional ?from=&to= bounds the scan.
// (Registered before /:id so "clashes" isn't swallowed as an event id.)
// ---------------------------------------------------------------------------
router.get('/clashes', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const params = [squadId];
    let rangeFilter = '';
    if (req.query.from && req.query.to) {
      params.push(req.query.from, req.query.to);
      rangeFilter = `AND event_date::date BETWEEN $${params.length - 1} AND $${params.length}`;
    }

    const result = await pool.query(
      `SELECT id, title, opponent, event_date, duration_minutes, status
       FROM events
       WHERE squad_id = $1 AND status IN ('scheduled', 'live', 'completed') ${rangeFilter}
       ORDER BY event_date`,
      params
    );

    const events = result.rows;
    const clashes = [];
    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        const aStart = new Date(events[i].event_date).getTime();
        const aEnd = aStart + (events[i].duration_minutes || 90) * 60 * 1000;
        const bStart = new Date(events[j].event_date).getTime();
        const bEnd = bStart + (events[j].duration_minutes || 90) * 60 * 1000;
        if (aStart < bEnd && bStart < aEnd) {
          clashes.push({ a: events[i], b: events[j] });
        }
      }
    }

    res.json({ clash_count: clashes.length, clashes });
  } catch (err) {
    console.error('Error detecting clashes:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// T21: RSVPs — coach records each athlete's availability for an event.
// ---------------------------------------------------------------------------

// GET /api/events/:id/rsvps — all recorded RSVPs for the event
router.get('/:id/rsvps', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const event = await loadEventWithAccess(pool, req.params.id, squadId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const result = await pool.query(
      `SELECT r.*, a.name AS athlete_name
       FROM event_rsvps r
       JOIN athletes a ON a.id = r.athlete_id
       WHERE r.event_id = $1
       ORDER BY a.name`,
      [event.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching RSVPs:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/events/:id/rsvps — upsert one RSVP ({ athlete_id, status, note })
// or a batch ({ rsvps: [{ athlete_id, status, note }, ...] }). Coach only.
const RSVP_STATUSES = new Set(['yes', 'no', 'maybe']);

router.put('/:id/rsvps', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);

    const event = await loadEventWithAccess(pool, req.params.id, squadId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const entries = Array.isArray(req.body.rsvps)
      ? req.body.rsvps
      : [{ athlete_id: req.body.athlete_id, status: req.body.status, note: req.body.note }];

    if (entries.length === 0 || entries.some((e) => !e.athlete_id)) {
      return res.status(400).json({ error: 'athlete_id is required for each RSVP' });
    }
    for (const entry of entries) {
      if (!RSVP_STATUSES.has(entry.status)) {
        return res.status(400).json({ error: "status must be 'yes', 'no' or 'maybe'" });
      }
    }

    const athleteIds = entries.map((e) => e.athlete_id);
    const owned = await pool.query(
      `SELECT id FROM athletes WHERE id = ANY($1::int[]) AND squad_id = $2`,
      [athleteIds, squadId]
    );
    if (owned.rows.length !== new Set(athleteIds).size) {
      return res.status(400).json({ error: 'All athletes must belong to this squad' });
    }

    const saved = [];
    for (const entry of entries) {
      const upsert = await pool.query(
        `INSERT INTO event_rsvps (event_id, athlete_id, status, note, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (event_id, athlete_id)
         DO UPDATE SET status = EXCLUDED.status,
                       note = EXCLUDED.note,
                       updated_at = now()
         RETURNING *`,
        [event.id, entry.athlete_id, entry.status, entry.note || null]
      );
      saved.push(upsert.rows[0]);
    }

    res.json(saved);
  } catch (err) {
    console.error('Error saving RSVPs:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// T21: Lineup suggestion — ranks available athletes by coach rating + recent
// form, filters out injured and RSVP'd-out players, and explains every choice.
// ---------------------------------------------------------------------------
router.get('/:id/lineup-suggestion', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const event = await loadEventWithAccess(pool, req.params.id, squadId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const squadSize = Number(req.query.size) || 11;
    if (squadSize < 1 || squadSize > 30) {
      return res.status(400).json({ error: 'size must be between 1 and 30' });
    }

    const athletesResult = await pool.query(
      'SELECT id, name, position, squad_number, rating FROM athletes WHERE squad_id = $1 ORDER BY name',
      [squadId]
    );
    const athletes = athletesResult.rows;
    if (athletes.length === 0) {
      return res.json({
        starters: [],
        bench: [],
        unavailable: [],
        doubtful: [],
        note: 'No athletes in the squad yet.',
      });
    }

    // Injuries overlapping today
    const injuries = await pool.query(
      `SELECT athlete_id, expected_return, note
       FROM athlete_injuries
       WHERE started_on <= CURRENT_DATE
         AND cleared_at IS NULL
         AND (expected_return IS NULL OR expected_return >= CURRENT_DATE)
         AND athlete_id = ANY($1::int[])`,
      [athletes.map((a) => a.id)]
    );
    const injuredMap = new Map(injuries.rows.map((r) => [r.athlete_id, r]));

    // RSVPs
    const rsvps = await pool.query(
      'SELECT athlete_id, status, note FROM event_rsvps WHERE event_id = $1',
      [event.id]
    );
    const rsvpMap = new Map(rsvps.rows.map((r) => [r.athlete_id, r]));

    // Recent form: goals + assists across the athlete's last 5 completed
    // matches (any event type that has completed), most recent first.
    const form = await pool.query(
      `WITH recent AS (
         SELECT DISTINCT l.event_id, e.event_date
         FROM log_entries l
         JOIN events e ON e.id = l.event_id
         WHERE e.squad_id = $1 AND e.status = 'completed' AND l.deleted_at IS NULL
         ORDER BY e.event_date DESC
         LIMIT 5
       )
       SELECT l.athlete_id,
              SUM(CASE WHEN l.action_type = 'goal' THEN l.value ELSE 0 END) AS goals,
              SUM(CASE WHEN l.action_type = 'assist' THEN l.value ELSE 0 END) AS assists
       FROM log_entries l
       JOIN recent ON recent.event_id = l.event_id
       WHERE l.deleted_at IS NULL AND l.athlete_id = ANY($2::int[])
       GROUP BY l.athlete_id`,
      [squadId, athletes.map((a) => a.id)]
    );
    const formMap = new Map(
      form.rows.map((r) => [r.athlete_id, { goals: Number(r.goals), assists: Number(r.assists) }])
    );

    const unavailable = [];
    const doubtful = [];
    const available = [];

    for (const athlete of athletes) {
      const injury = injuredMap.get(athlete.id);
      const rsvp = rsvpMap.get(athlete.id);
      const formStats = formMap.get(athlete.id) || { goals: 0, assists: 0 };

      if (injury) {
        unavailable.push({
          athlete,
          reason: `Injured${injury.expected_return ? ` (expected return ${injury.expected_return})` : ''}${injury.note ? ` — ${injury.note}` : ''}`,
        });
        continue;
      }
      if (rsvp && rsvp.status === 'no') {
        unavailable.push({ athlete, reason: `Marked unavailable${rsvp.note ? ` — ${rsvp.note}` : ''}` });
        continue;
      }

      // score = coach rating (neutral 50 if unrated) + capped form bonus
      const rating = athlete.rating ?? 50;
      const formBonus = Math.min(20, formStats.goals * 3 + formStats.assists * 2);
      const entry = {
        athlete,
        rating,
        form: formStats,
        score: rating + formBonus,
        reason: `Rating ${rating} · form: ${formStats.goals} goal${formStats.goals === 1 ? '' : 's'}, ${formStats.assists} assist${formStats.assists === 1 ? '' : 's'} in last 5`,
      };
      if (rsvp && rsvp.status === 'maybe') {
        doubtful.push({ ...entry, reason: `${entry.reason} · RSVP: maybe${rsvp.note ? ` — ${rsvp.note}` : ''}` });
      }
      available.push(entry);
    }

    available.sort((a, b) => b.score - a.score);
    const starters = available.slice(0, squadSize);
    const bench = available.slice(squadSize);

    res.json({
      starters,
      bench,
      unavailable,
      doubtful,
      generated_for: { event_id: event.id, size: squadSize },
    });
  } catch (err) {
    console.error('Error building lineup suggestion:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// T22: Auto post-match summary & highlights
// ---------------------------------------------------------------------------
router.get('/:id/summary', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const event = await loadEventWithAccess(pool, req.params.id, squadId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (LEAGUE_FORMATS.has(event.format)) {
      return res.status(400).json({ error: 'Use /api/fixtures/:id/summary for league fixtures' });
    }

    const logsResult = await pool.query(
      `SELECT l.*, a.name AS athlete_name
       FROM log_entries l
       LEFT JOIN athletes a ON a.id = l.athlete_id
       WHERE l.event_id = $1 AND l.deleted_at IS NULL
       ORDER BY l.minute NULLS LAST, l.logged_at`,
      [event.id]
    );
    const logs = logsResult.rows.map((l) => ({ ...l, side: l.athlete_id != null ? 'us' : 'them' }));

    const gf = logs
      .filter((l) => l.is_scoring && l.side === 'us')
      .reduce((sum, l) => sum + l.value, 0);
    const ga = logs
      .filter((l) => l.is_scoring && l.side === 'them')
      .reduce((sum, l) => sum + l.value, 0);

    const summary = buildMatchSummary(logs, {
      squadName: 'Squad',
      opponent: event.opponent || 'the opposition',
      gf,
      ga,
    });

    res.json({ event_id: event.id, status: event.status, ...summary });
  } catch (err) {
    console.error('Error building event summary:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// T20: Match report exports (CSV / PDF)
// ---------------------------------------------------------------------------

function matchReportRows(event, gf, ga, timeline) {
  const rows = [
    ['Match Report'],
    ['Opponent', event.opponent || 'Training session'],
    ['Date', event.event_date ? new Date(event.event_date).toISOString() : ''],
    ['Location', event.location || ''],
    ['Status', event.status],
    ['Final Score', `${gf}-${ga}`],
    [],
    ['Minute', 'Action', 'Athlete', 'Side', 'Value', 'Notes'],
  ];
  for (const l of timeline) {
    rows.push([
      l.minute ?? '',
      l.action_type,
      l.athlete_name || (l.side === 'us' ? 'Squad' : 'Opponent'),
      l.side,
      l.value,
      l.notes || '',
    ]);
  }
  return rows;
}

async function loadMatchReportData(pool, eventId, squadId) {
  const event = await loadEventWithAccess(pool, eventId, squadId);
  if (!event || LEAGUE_FORMATS.has(event.format)) return null;

  const logsResult = await pool.query(
    `SELECT l.*, a.name AS athlete_name
     FROM log_entries l
     LEFT JOIN athletes a ON a.id = l.athlete_id
     WHERE l.event_id = $1 AND l.deleted_at IS NULL
     ORDER BY l.minute NULLS LAST, l.logged_at`,
    [event.id]
  );
  const logs = logsResult.rows.map((l) => ({ ...l, side: l.athlete_id != null ? 'us' : 'them' }));

  const gf = logs
    .filter((l) => l.is_scoring && l.side === 'us')
    .reduce((sum, l) => sum + l.value, 0);
  const ga = logs
    .filter((l) => l.is_scoring && l.side === 'them')
    .reduce((sum, l) => sum + l.value, 0);

  return { event, logs, gf, ga };
}

router.get('/:id/report.csv', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const data = await loadMatchReportData(pool, req.params.id, squadId);
    if (!data) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const csv = buildCsv(matchReportRows(data.event, data.gf, data.ga, data.logs));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="match-${data.event.id}-report.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('Error exporting match CSV:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id/report.pdf', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const data = await loadMatchReportData(pool, req.params.id, squadId);
    if (!data) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const summary = buildMatchSummary(data.logs, {
      squadName: 'Squad',
      opponent: data.event.opponent || 'the opposition',
      gf: data.gf,
      ga: data.ga,
    });

    const lines = [
      { text: 'Match Report', size: 18, bold: true, gapAfter: 22 },
      {
        text: `${data.event.opponent || 'Training session'} · ${
          data.event.event_date ? new Date(data.event.event_date).toISOString().slice(0, 16).replace('T', ' ') : ''
        }`,
        size: 10,
        gapAfter: 16,
      },
      { text: summary.headline, size: 14, bold: true, gapAfter: 16 },
      { text: summary.narrative, size: 10, gapAfter: 18 },
      { text: 'Timeline', size: 13, bold: true, gapAfter: 14 },
    ];
    if (data.logs.length === 0) {
      lines.push({ text: 'No actions recorded.', size: 10, gapAfter: 12 });
    }
    for (const l of data.logs) {
      lines.push({
        text: `${l.minute != null ? `${l.minute}'` : '—'}  ${l.action_type}  ${l.athlete_name || (l.side === 'us' ? 'Squad' : 'Opponent')}${l.notes ? ` — ${l.notes}` : ''}`,
        size: 10,
        gapAfter: 13,
      });
    }

    const pdf = buildPdf(lines);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="match-${data.event.id}-report.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error('Error exporting match PDF:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/events/:id — event detail: aggregated result + full timeline (US15)
router.get('/:id', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const event = await loadEventWithAccess(pool, req.params.id, squadId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (LEAGUE_FORMATS.has(event.format)) {
      const teams = await getEventTeams(pool, event.id, squadId);
      const fixtures = await getEventFixtures(pool, event.id, squadId);
      const standings = await computeStandings(pool, event.id);
      const stats = await computeTopStats(pool, event.id);

      return res.json({
        event,
        teams,
        fixtures,
        standings,
        stats,
      });
    }

    const timelineResult = await pool.query(
      `SELECT l.*, a.name AS athlete_name
       FROM log_entries l
       LEFT JOIN athletes a ON a.id = l.athlete_id
       WHERE l.event_id = $1 AND l.deleted_at IS NULL
       ORDER BY l.minute NULLS LAST, l.logged_at`,
      [req.params.id]
    );
    const timeline = timelineResult.rows;

    const squadScore = timeline
      .filter((l) => l.is_scoring && l.athlete_id !== null)
      .reduce((sum, l) => sum + l.value, 0);
    const opponentScore = timeline
      .filter((l) => l.is_scoring && l.athlete_id === null)
      .reduce((sum, l) => sum + l.value, 0);
    const penalties = timeline.filter(
      (l) => l.action_type.includes('penalty') || l.action_type.includes('card')
    );

    res.json({
      event,
      result: { squad: squadScore, opponent: opponentScore },
      penalties,
      timeline,
    });
  } catch (err) {
    console.error('Error fetching event detail:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/events/:id — update event (title, opponent, type, date, location, status)
router.patch('/:id', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const check = await pool.query(
      'SELECT id FROM events WHERE id = $1 AND squad_id = $2',
      [req.params.id, squadId]
    );
    if (check.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to edit this event' });
    }

    const { title, opponent, event_type, type, event_date, event_time, location, status, duration_minutes, season_id } = req.body;
    const timestamp = event_date ? (event_time ? `${event_date}T${event_time}` : event_date) : null;

    // Season tag changes are validated (must belong to this squad); passing
    // season_id: null clears the tag, omitting it leaves it untouched.
    let newSeasonId = null;
    let seasonProvided = false;
    if (season_id !== undefined) {
      seasonProvided = true;
      if (season_id !== null) {
        const seasonCheck = await pool.query(
          'SELECT id FROM seasons WHERE id = $1 AND squad_id = $2',
          [season_id, squadId]
        );
        if (seasonCheck.rows.length === 0) {
          return res.status(400).json({ error: 'Unknown season for this squad' });
        }
        newSeasonId = season_id;
      }
    }

    const result = await pool.query(
      `UPDATE events
       SET title = COALESCE($1, title),
           opponent = COALESCE($2, opponent),
           event_type = COALESCE($3, event_type),
           event_date = COALESCE($4, event_date),
           location = COALESCE($5, location),
           status = COALESCE($6, status),
           duration_minutes = COALESCE($7, duration_minutes),
           season_id = COALESCE($9, CASE WHEN $8 THEN NULL ELSE season_id END),
           updated_at = now()
       WHERE id = $10 RETURNING *`,
      [title, opponent, type || event_type || null, timestamp, location, status, duration_minutes ? Number(duration_minutes) : null, seasonProvided, newSeasonId, req.params.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating event:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/events/:id/cancel — quick shortcut to mark an event cancelled
router.patch('/:id/cancel', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const result = await pool.query(
      `UPDATE events SET status = 'cancelled', updated_at = now() WHERE id = $1 AND squad_id = $2 RETURNING *`,
      [req.params.id, squadId]
    );
    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error cancelling event:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/events/:id — permanently remove an event and its logs/fixtures
router.delete('/:id', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const result = await pool.query(
      'DELETE FROM events WHERE id = $1 AND squad_id = $2 RETURNING id',
      [req.params.id, squadId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to delete this event' });
    }

    res.sendStatus(204);
  } catch (err) {
    console.error('Error deleting event:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/events/:id/join — join an open league/tournament
router.post('/:id/join', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const eventResult = await pool.query('SELECT * FROM events WHERE id = $1', [req.params.id]);
    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const event = eventResult.rows[0];

    if (!LEAGUE_FORMATS.has(event.format)) {
      return res.status(400).json({ error: 'Only league or tournament events can be joined' });
    }
    if (event.status !== 'open') {
      return res.status(400).json({ error: 'Event is not open for joining' });
    }

    const existing = await pool.query(
      'SELECT id FROM event_teams WHERE event_id = $1 AND squad_id = $2',
      [event.id, squadId]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Squad already joined this event' });
    }

    const countResult = await pool.query(
      'SELECT COUNT(*) AS count FROM event_teams WHERE event_id = $1',
      [event.id]
    );
    const currentCount = Number(countResult.rows[0].count);
    if (currentCount >= event.required_teams) {
      return res.status(400).json({ error: 'Event is already full' });
    }

    await pool.query(
      `INSERT INTO event_teams (event_id, squad_id, role, seed_order)
       VALUES ($1, $2, 'participant', $3)`,
      [event.id, squadId, currentCount + 1]
    );

    const newCount = currentCount + 1;
    if (newCount >= event.required_teams) {
      await pool.query(
        "UPDATE events SET status = 'full', updated_at = now() WHERE id = $1",
        [event.id]
      );
      await generateFixtures(pool, event.id);
    }

    res.json({ joined: true, team_count: newCount, required_teams: event.required_teams });
  } catch (err) {
    console.error('Error joining event:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/events/:id/teams
router.get('/:id/teams', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const event = await loadEventWithAccess(pool, req.params.id, squadId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const teams = await getEventTeams(pool, event.id);
    res.json(teams);
  } catch (err) {
    console.error('Error fetching event teams:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/events/:id/fixtures
router.get('/:id/fixtures', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const event = await loadEventWithAccess(pool, req.params.id, squadId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const fixtures = await getEventFixtures(pool, event.id);
    res.json(fixtures);
  } catch (err) {
    console.error('Error fetching fixtures:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/events/:id/standings
router.get('/:id/standings', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const event = await loadEventWithAccess(pool, req.params.id, squadId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (!LEAGUE_FORMATS.has(event.format)) {
      return res.status(400).json({ error: 'Standings are only available for league/tournament events' });
    }

    const standings = await computeStandings(pool, event.id);
    res.json(standings);
  } catch (err) {
    console.error('Error fetching standings:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/events/:id/stats
router.get('/:id/stats', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const event = await loadEventWithAccess(pool, req.params.id, squadId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (!LEAGUE_FORMATS.has(event.format)) {
      return res.status(400).json({ error: 'Stats are only available for league/tournament events' });
    }

    const stats = await computeTopStats(pool, event.id);
    res.json(stats);
  } catch (err) {
    console.error('Error fetching event stats:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---- Log entries, nested under an event — US13, US14, US16 ----

// GET /api/events/:id/logs — active log entries in order (live dashboard timeline)
router.get('/:id/logs', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const event = await loadEventWithAccess(pool, req.params.id, squadId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const result = await pool.query(
      `SELECT l.*, a.name AS athlete_name
       FROM log_entries l
       LEFT JOIN athletes a ON a.id = l.athlete_id
       WHERE l.event_id = $1 AND l.fixture_id IS NULL AND l.deleted_at IS NULL
       ORDER BY l.minute NULLS LAST, l.logged_at`,
      [req.params.id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching log entries:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/events/:id/logs — log a scoring moment / action against an athlete (US13)
router.post('/:id/logs', requireAuth(), async (req, res) => {
  try {
    const { athlete_id, action_type, is_scoring, value, minute, notes } = req.body;

    if (!action_type || !action_type.trim()) {
      return res.status(400).json({ error: 'action_type is required' });
    }

    const { userId: clerkUserId } = getAuth(req);
    const userId = await getOrCreateUserId(pool, clerkUserId);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const event = await loadEventWithAccess(pool, req.params.id, squadId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (LEAGUE_FORMATS.has(event.format)) {
      return res.status(400).json({ error: 'Use fixture endpoints to log league/tournament actions' });
    }

    if (athlete_id) {
      const athleteCheck = await pool.query(
        'SELECT id FROM athletes WHERE id = $1 AND squad_id = $2',
        [athlete_id, squadId]
      );
      if (athleteCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Athlete does not belong to this squad' });
      }
    }

    const result = await pool.query(
      `INSERT INTO log_entries (event_id, athlete_id, action_type, is_scoring, value, minute, notes, logged_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        req.params.id,
        athlete_id || null,
        action_type.trim(),
        !!is_scoring,
        value ?? 1,
        minute ?? null,
        notes || null,
        userId,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating log entry:', err);
    res.status(500).json({ error: 'Server error', detail: err.message });
  }
});

// PATCH /api/events/:id/logs/:logId — edit a log entry just made (US14)
router.patch('/:id/logs/:logId', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const check = await pool.query(
      `SELECT l.id FROM log_entries l
       JOIN events e ON e.id = l.event_id
       WHERE l.id = $1 AND l.event_id = $2 AND e.squad_id = $3 AND l.deleted_at IS NULL AND l.fixture_id IS NULL`,
      [req.params.logId, req.params.id, squadId]
    );
    if (check.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to edit this log entry' });
    }

    const { athlete_id, action_type, is_scoring, value, minute, notes } = req.body;

    const result = await pool.query(
      `UPDATE log_entries
       SET athlete_id = COALESCE($1, athlete_id),
           action_type = COALESCE($2, action_type),
           is_scoring = COALESCE($3, is_scoring),
           value = COALESCE($4, value),
           minute = COALESCE($5, minute),
           notes = COALESCE($6, notes),
           updated_at = now()
       WHERE id = $7 RETURNING *`,
      [athlete_id, action_type, is_scoring, value, minute, notes, req.params.logId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating log entry:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/events/:id/logs/:logId — undo a log entry (soft delete, US14)
router.delete('/:id/logs/:logId', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const result = await pool.query(
      `UPDATE log_entries l
       SET deleted_at = now()
       FROM events e
       WHERE l.id = $1 AND l.event_id = $2 AND l.event_id = e.id
         AND e.squad_id = $3 AND l.deleted_at IS NULL AND l.fixture_id IS NULL
       RETURNING l.id`,
      [req.params.logId, req.params.id, squadId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to undo this log entry' });
    }

    res.sendStatus(204);
  } catch (err) {
    console.error('Error undoing log entry:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
