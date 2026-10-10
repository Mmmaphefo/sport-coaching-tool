const express = require('express');
const pool = require('../db');
const { requireAuth, getAuth } = require('../middleware/auth');
const { getOwnedSquadId, getOwnedSquadIdForStaff, getOwnedSquadIdForCoach, getOrCreateUserId } = require('./_squad');
const {
  getLineup,
  getAthleteSquads,
  validateLineupPayload,
  saveLineup,
  lineupCheckForLog,
  applySubstitutionInTx,
} = require('../lib/lineups');
const { ensureRatings, squadFromRows, ratingsPayload } = require('../lib/ratings');
const { buildLineupSuggestions } = require('../lib/lineupSuggestions');
const { simulateMatch } = require('../lib/match-simulation');
const { findClashes } = require('../lib/clashes');
const { getMatchAvailability, availabilityError } = require('../lib/availability');
const { applyLogEdit } = require('../lib/logEdit');

const router = express.Router();

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
    `SELECT l.*, a.name AS athlete_name, a.squad_id AS athlete_squad_id
     FROM log_entries l
     LEFT JOIN athletes a ON a.id = l.athlete_id
     WHERE l.fixture_id = $1 AND l.deleted_at IS NULL
     ORDER BY l.minute NULLS LAST, l.logged_at`,
    [fixtureId]
  );
  return result.rows;
}

// Returns { athleteCount, minRosterSize, meetsMinimum } for a squad, so
// callers can block match/league creation or joining when the squad doesn't
// have enough players to actually field a team.
async function getRosterStatus(pool, squadId) {
  const result = await pool.query(
    `SELECT s.min_roster_size,
            (SELECT COUNT(*)::int FROM athletes a WHERE a.squad_id = s.id) AS athlete_count
     FROM squads s
     WHERE s.id = $1`,
    [squadId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(`Squad ${squadId} not found while checking roster status`);
  }
  return {
    athleteCount: row.athlete_count,
    minRosterSize: row.min_roster_size,
    meetsMinimum: row.athlete_count >= row.min_roster_size,
  };
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Latitude/longitude come from the venue-map picker (the coach drops a pin on
// the pitch on a map). Out-of-range values are rejected before they reach the
// database; null/'' means "no pin" (or clears a saved one).
function toCoord(value) {
  if (value === undefined || value === null || value === '') return null;
  return Number(value);
}

function coordErrorFor(location_lat, location_lng) {
  const lat = toCoord(location_lat);
  const lng = toCoord(location_lng);
  if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) {
    return 'location_lat must be a number between -90 and 90';
  }
  if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) {
    return 'location_lng must be a number between -180 and 180';
  }
  return null;
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
    const sideOf = (l) =>
      l.athlete_id === null || l.athlete_squad_id === fixture.away_squad_id ? 'away' : 'home';
    const homeGoals = logs
      .filter((l) => l.is_scoring && sideOf(l) === 'home')
      .reduce((sum, l) => sum + l.value, 0);
    const awayGoals = logs
      .filter((l) => l.is_scoring && sideOf(l) === 'away')
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

// Resolves the athlete row linked to the logged-in user's account, if any
// (only athletes accepted via invite have one). Used by the RSVP "mine"
// endpoint so an athlete can only ever respond for themselves.
async function getAthleteIdForUser(pool, userId) {
  const result = await pool.query('SELECT id FROM athletes WHERE user_id = $1', [userId]);
  return result.rows[0]?.id || null;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /api/events — list events the logged-in user's squad participates in.
// For players, each row also carries their own RSVP status (my_rsvp) so the
// events page can show it without a per-event request.
router.get('/', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);
    const { gender_filter } = req.query;

    // The signed-in player's linked roster row, if any — drives my_rsvp.
    const userId = await getOrCreateUserId(pool, clerkUserId);
    const myAthleteId = await getAthleteIdForUser(pool, userId);

    // Fetch the squad's gender for matchmaking filtering
    let genderClause = '';
    let genderParam = null;
    if (gender_filter === 'true') {
      const squadResult = await pool.query('SELECT gender FROM squads WHERE id = $1', [squadId]);
      const squadGender = squadResult.rows[0]?.gender || 'male';
      // Compatible genders: same gender only
      const compatible = [squadGender];
      genderClause = `AND (opp_squad.gender = ANY($2) OR opp_squad.gender IS NULL)`;
      genderParam = compatible;
    }

    // The RSVP tallies ride along with the list so the calendar can show
    // availability at a glance without one request per event. my_rsvp is
    // only meaningful for a linked player; it stays null for staff. The
    // athlete param is $3 when the gender filter is active, $2 otherwise.
    const myRsvpParam = gender_filter === 'true' ? 3 : 2;
    const result = await pool.query(
      `SELECT e.*,
              opp_squad.gender,
              (SELECT COUNT(*) FROM event_teams et WHERE et.event_id = e.id) AS team_count,
              COALESCE(r.available, 0)::int AS available_count,
              COALESCE(r.unavailable, 0)::int AS unavailable_count,
              COALESCE(r.maybe, 0)::int AS maybe_count,
              (SELECT er.status FROM event_rsvps er
                WHERE er.event_id = e.id AND er.athlete_id = $${myRsvpParam} LIMIT 1) AS my_rsvp
       FROM events e
       LEFT JOIN event_teams et ON et.event_id = e.id AND et.squad_id = $1
       LEFT JOIN (
         SELECT event_id,
                COUNT(*) FILTER (WHERE status = 'available') AS available,
                COUNT(*) FILTER (WHERE status = 'unavailable') AS unavailable,
                COUNT(*) FILTER (WHERE status = 'maybe') AS maybe
         FROM event_rsvps
         GROUP BY event_id
       ) r ON r.event_id = e.id
       LEFT JOIN squads opp_squad ON opp_squad.id = e.squad_id
       WHERE e.squad_id = $1
          OR et.squad_id IS NOT NULL
          OR (e.status = 'open' AND e.format IN ('league', 'tournament'))
       ${genderClause}
       ORDER BY e.event_date DESC`,
      gender_filter === 'true' ? [squadId, genderParam, myAthleteId] : [squadId, myAthleteId]
    );
    res.json(result.rows);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Error fetching events:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/events — schedule a new event or create a league/tournament.
// Staff only (players see their scheduled events but never create them).
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
      location_lat,
      location_lng,
      duration_minutes,
      format,
      required_teams,
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

    // Backlog: don't allow scheduling events in the past. The one-minute
    // grace covers a datetime-local value that ticks over while the form
    // is being submitted.
    if (new Date(timestamp).getTime() < Date.now() - 60 * 1000) {
      return res.status(400).json({ error: 'Cannot schedule an event in the past' });
    }

    // Don't allow scheduling more than 3 months in the future
    const threeMonthsFromNow = Date.now() + (3 * 30 * 24 * 60 * 60 * 1000);
    if (new Date(timestamp).getTime() > threeMonthsFromNow) {
      return res.status(400).json({ error: 'Cannot schedule an event more than 3 months in the future' });
    }

    // Optional map pin — the form can pass the coordinates the coach dropped
    // on the venue map.
    const coordError = coordErrorFor(location_lat, location_lng);
    if (coordError) {
      return res.status(400).json({ error: coordError });
    }

    const { userId: clerkUserId } = getAuth(req);
    const userId = await getOrCreateUserId(pool, clerkUserId);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);

    // Training sessions don't need a full squad — but a match, league, or
    // tournament all involve this squad actually fielding a team, so they
    // require the roster to meet the squad's configured minimum size first.
    // "training" can be signalled either via format (new events) or the
    // legacy event_type/type field (older callers that never set format),
    // so both are checked here to avoid misclassifying a training session
    // as a match just because format was left unset.
    const requestedTypeValue = (type || event_type || '').toLowerCase();
    const isTrainingRequest = eventFormat === 'training' || requestedTypeValue === 'training';
    if (!isTrainingRequest) {
      const roster = await getRosterStatus(pool, squadId);
      if (!roster.meetsMinimum) {
        return res.status(400).json({
          error: `Your roster needs at least ${roster.minRosterSize} athletes to schedule a ${eventFormat} (you currently have ${roster.athleteCount}).`,
        });
      }
    }

    const result = await pool.query(
      `INSERT INTO events (squad_id, title, opponent, event_type, format, required_teams, event_date, location, location_lat, location_lng, duration_minutes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        squadId,
        title ? title.trim() : null,
        opponent ? opponent.trim() : null,
        type || event_type || 'match',
        eventFormat,
        isLeague ? Number(required_teams) : null,
        timestamp,
        location ? location.trim() : null,
        toCoord(location_lat),
        toCoord(location_lng),
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

    const clashes = await findClashes(pool, squadId, timestamp, event.duration_minutes, {
      excludeEventId: event.id,
    });

    res.status(201).json({ ...event, clashes });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Error creating event:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/events/clashes — pre-check a proposed time before the event
// exists (the create form warns before saving). Query params: event_date,
// event_time, duration_minutes, exclude_id (set when re-checking an edit).
// Registered before /:id so "clashes" is never parsed as an event id.
router.get('/clashes', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const { event_date, event_time, duration_minutes, exclude_id } = req.query;
    if (!event_date) {
      return res.status(400).json({ error: 'event_date is required' });
    }

    const timestamp = event_time ? `${event_date}T${event_time}` : event_date;
    const clashes = await findClashes(pool, squadId, timestamp, Number(duration_minutes) || 90, {
      excludeEventId: exclude_id ? Number(exclude_id) : null,
    });
    res.json(clashes);
  } catch (err) {
    console.error('Error pre-checking clashes:', err.message);
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

    // Rides along so the page can explain *why* Start live refuses (and how
    // close the squad is to the bar) without a second request. Only matches
    // are gated; trainings and league containers carry null.
    const availability = event.format === 'match'
      ? await getMatchAvailability(pool, { eventId: event.id, squadId: event.squad_id })
      : null;

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
        availability,
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

    const lineups = await getLineup(pool, { eventId: event.id });

    res.json({
      event,
      result: { squad: squadScore, opponent: opponentScore },
      penalties,
      timeline,
      lineups,
      availability,
    });
  } catch (err) {
    console.error('Error fetching event detail:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/events/:id — update event (title, opponent, type, date, location, status).
// Coach only.
router.patch('/:id', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);

    const check = await pool.query(
      'SELECT id, status, format, squad_id FROM events WHERE id = $1 AND squad_id = $2',
      [req.params.id, squadId]
    );
    if (check.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to edit this event' });
    }

    const { title, opponent, event_type, type, event_date, event_time, location, status, duration_minutes, location_lat, location_lng } = req.body;
    const timestamp = event_date ? (event_time ? `${event_date}T${event_time}` : event_date) : null;

    // Validate date if provided - don't allow past dates or dates too far in future
    if (timestamp) {
      if (new Date(timestamp).getTime() < Date.now() - 60 * 1000) {
        return res.status(400).json({ error: 'Cannot schedule an event in the past' });
      }
      const twoYearsFromNow = Date.now() + (2 * 365 * 24 * 60 * 60 * 1000);
      if (new Date(timestamp).getTime() > twoYearsFromNow) {
        return res.status(400).json({ error: 'Cannot schedule an event more than 2 years in the future' });
      }
    }

    // A match can only be turned live once enough players are confirmed
    // available — the Start live button refuses exactly where the auto-start
    // paths do (see lib/availability).
    const current = check.rows[0];
    if (status === 'live' && current.status !== 'live' && current.format === 'match') {
      const availability = await getMatchAvailability(pool, { eventId: current.id, squadId: current.squad_id });
      if (!availability.meets) {
        return res.status(400).json({ error: availabilityError(availability), availability });
      }
    }

    const coordError = coordErrorFor(location_lat, location_lng);
    if (coordError) {
      return res.status(400).json({ error: coordError });
    }
    // The picker always sends lat+lng together (explicit nulls to clear the
    // pin); a request that never mentions them leaves the stored pin alone.
    const hasCoords = Object.prototype.hasOwnProperty.call(req.body, 'location_lat')
      || Object.prototype.hasOwnProperty.call(req.body, 'location_lng');

    // The same contract applies to the clearable text fields: the edit form
    // sends an explicit null when a coach deletes the location text or the
    // opponent/title name. COALESCE can't tell that apart from "field not
    // sent" (it keeps the stored value for both), so the fields behind a
    // has-flag are set — to null when null — and the rest keep their value.
    const hasField = (field) => Object.prototype.hasOwnProperty.call(req.body, field);

    const result = await pool.query(
      `UPDATE events
       SET title = CASE WHEN $1 THEN $2::text ELSE title END,
           opponent = CASE WHEN $3 THEN $4::text ELSE opponent END,
           event_type = COALESCE($5, event_type),
           event_date = COALESCE($6, event_date),
           location = CASE WHEN $7 THEN $8::text ELSE location END,
           status = COALESCE($9, status),
           duration_minutes = COALESCE($10, duration_minutes),
           location_lat = CASE WHEN $12 THEN $13::double precision ELSE location_lat END,
           location_lng = CASE WHEN $12 THEN $14::double precision ELSE location_lng END,
           started_at = CASE WHEN $9 = 'live' THEN COALESCE(started_at, now()) ELSE started_at END,
           updated_at = now()
       WHERE id = $11 RETURNING *`,
      [hasField('title'), title, hasField('opponent'), opponent, type || event_type || null, timestamp, hasField('location'), location, status, duration_minutes ? Number(duration_minutes) : null, req.params.id, hasCoords, toCoord(location_lat), toCoord(location_lng)]
    );

    const updated = result.rows[0];
    const clashes = await findClashes(pool, squadId, updated.event_date, updated.duration_minutes, {
      excludeEventId: updated.id,
    });

    res.json({ ...updated, clashes });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Error updating event:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/events/:id/clashes — re-check clashes for an existing event
// (e.g. after another event on the calendar changes) without editing it.
router.get('/:id/clashes', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const event = await loadEventWithAccess(pool, req.params.id, squadId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const clashes = await findClashes(pool, squadId, event.event_date, event.duration_minutes, {
      excludeEventId: event.id,
    });
    res.json(clashes);
  } catch (err) {
    console.error('Error checking clashes:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/events/:id/cancel — quick shortcut to mark an event cancelled.
// Coach only.
router.patch('/:id/cancel', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);

    const result = await pool.query(
      `UPDATE events SET status = 'cancelled', updated_at = now() WHERE id = $1 AND squad_id = $2 RETURNING *`,
      [req.params.id, squadId]
    );
    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Error cancelling event:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/events/:id — permanently remove an event and its logs/fixtures.
// Coach only.
router.delete('/:id', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);

    const result = await pool.query(
      'DELETE FROM events WHERE id = $1 AND squad_id = $2 RETURNING id',
      [req.params.id, squadId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to delete this event' });
    }

    res.sendStatus(204);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Error deleting event:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/events/:id/join — join an open league/tournament. Coach only.
router.post('/:id/join', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);

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

    const roster = await getRosterStatus(pool, squadId);
    if (!roster.meetsMinimum) {
      return res.status(400).json({
        error: `Your roster needs at least ${roster.minRosterSize} athletes to join this event (you currently have ${roster.athleteCount}).`,
      });
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
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
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

// PUT /api/events/:id/lineup — set the starting XI + bench for a simple
// event (own squad only; the opponent here is a free-text name). Logging
// stays locked until a lineup exists. Coach only.
router.put('/:id/lineup', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);

    const event = await loadEventWithAccess(pool, req.params.id, squadId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if (LEAGUE_FORMATS.has(event.format)) {
      return res.status(400).json({ error: 'Use fixture endpoints to set league lineups' });
    }
    if (event.squad_id !== squadId) {
      return res.status(403).json({ error: 'Only the host squad can set the lineup' });
    }
    if (event.status === 'cancelled' || event.status === 'completed') {
      return res.status(400).json({ error: `Lineups cannot be changed once the event is ${event.status}` });
    }

    const { rows, error } = validateLineupPayload(req.body.lineups, { home: squadId, away: null });
    if (error) {
      return res.status(400).json({ error });
    }

    const squadByAthlete = await getAthleteSquads(pool, rows.map((r) => r.athleteId));
    for (const r of rows) {
      if (squadByAthlete.get(r.athleteId) !== squadId) {
        return res.status(400).json({ error: 'Athlete does not belong to your squad' });
      }
    }

    await saveLineup(pool, { eventId: event.id }, rows);

    // Saving the XI after kickoff normally starts the match — but only when
    // enough players are available. The lineups themselves still save either
    // way; the client surfaces startBlocked as a hint.
    let startBlocked = null;
    if (event.status === 'scheduled' && (!event.event_date || new Date(event.event_date).getTime() <= Date.now())) {
      if (event.format === 'match') {
        const availability = await getMatchAvailability(pool, { eventId: event.id, squadId: event.squad_id });
        if (!availability.meets) {
          startBlocked = availability;
        }
      }
      if (!startBlocked) {
        await pool.query(
          "UPDATE events SET status = 'live', started_at = COALESCE(started_at, now()), updated_at = now() WHERE id = $1",
          [event.id]
        );
      }
    }

    res.json({ lineups: await getLineup(pool, { eventId: event.id }), startBlocked });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Error saving event lineup:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/events/:id/lineup/suggestions — a suggested starting XI and bench
// for the coach's own side, built from RSVPs, current injuries, recent goal
// involvement and the overall ratings the simulator maintains. Read-only:
// nothing is saved until the wizard PUTs the lineup. Staff only.
router.get('/:id/lineup/suggestions', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForStaff(pool, clerkUserId);

    const event = await loadEventWithAccess(pool, req.params.id, squadId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if (LEAGUE_FORMATS.has(event.format)) {
      return res.status(400).json({ error: 'Use the fixture lineup suggestions for league events' });
    }

    const suggestions = await buildLineupSuggestions(pool, { eventId: event.id, squadId });
    res.json(suggestions);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Error building lineup suggestions:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/events/:id/simulate — build a full 90-minute script for a simple
// event from the saved lineup plus each player's rating. The opponent is a
// free-text name with no roster, so it is simulated as a generic side of a
// random standard. Nothing is written here: the client replays the script
// through POST /:id/logs, so a simulated match is recorded exactly like a
// manually logged one. `mode` only tells the client how to pace that replay.
// Staff only.
router.post('/:id/simulate', requireAuth(), async (req, res) => {
  try {
    const mode = req.body && req.body.mode === 'timed' ? 'timed' : 'quick';
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForStaff(pool, clerkUserId);

    const event = await loadEventWithAccess(pool, req.params.id, squadId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if (LEAGUE_FORMATS.has(event.format)) {
      return res.status(400).json({ error: 'Use fixture endpoints to simulate league matches' });
    }
    if (event.squad_id !== squadId) {
      return res.status(403).json({ error: 'Only the host squad can simulate this event' });
    }
    if (event.status === 'cancelled') {
      return res.status(400).json({ error: 'Event is cancelled' });
    }
    if (event.status === 'completed') {
      return res.status(400).json({ error: 'This event has already finished' });
    }

    const lineupRows = await getLineup(pool, { eventId: event.id });
    if (lineupRows.length === 0) {
      return res.status(400).json({ error: 'Set the starting lineup before simulating' });
    }
    const mine = lineupRows.filter((row) => row.team_side === 'home');
    if (!mine.some((row) => row.is_starter)) {
      return res.status(400).json({ error: 'Your squad needs a starting XI before simulating' });
    }

    const ratings = await ensureRatings(
      pool,
      mine.map((row) => ({ id: row.athlete_id, name: row.name, position: row.position }))
    );

    // There is no roster to rate on the other side, so the opponent gets a
    // standard drawn from the middle of the pack — neither a pushover nor a
    // giant, and different from one simulation to the next.
    const opponentRating = 72 + Math.round(Math.random() * 10);

    const { events, summary } = simulateMatch({
      home: squadFromRows(mine, ratings),
      away: null,
      opponentRating,
    });

    // Simulating implies the match is being played now: an event still
    // waiting on kickoff goes live first so the replay is accepted — subject
    // to the same availability bar as every other way a match can start.
    if (event.status === 'scheduled') {
      if (event.format === 'match') {
        const availability = await getMatchAvailability(pool, { eventId: event.id, squadId: event.squad_id });
        if (!availability.meets) {
          return res.status(400).json({ error: availabilityError(availability), availability });
        }
      }
      await pool.query(
        "UPDATE events SET status = 'live', started_at = COALESCE(started_at, now()), updated_at = now() WHERE id = $1",
        [event.id]
      );
    }

    res.json({
      mode,
      events,
      summary: { ...summary, opponentRating },
      ratings: ratingsPayload(ratings),
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Error simulating event:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

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

// POST /api/events/:id/logs — log a scoring moment / action against an athlete (US13).
// Staff only: live logging is a staff activity; players watch live scores
// from the dashboard instead.
router.post('/:id/logs', requireAuth(), async (req, res) => {
  try {
    const { athlete_id, action_type, is_scoring, value, minute, notes } = req.body;

    if (!action_type || !action_type.trim()) {
      return res.status(400).json({ error: 'action_type is required' });
    }

    const { userId: clerkUserId } = getAuth(req);
    const userId = await getOrCreateUserId(pool, clerkUserId);
    const squadId = await getOwnedSquadIdForStaff(pool, clerkUserId);

    const event = await loadEventWithAccess(pool, req.params.id, squadId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Idempotent replay: an offline-queued log is retried with the same
    // client-generated id, so a create that already landed returns the
    // stored row instead of inserting a duplicate.
    const clientId = req.body.client_id ? String(req.body.client_id).slice(0, 64) : null;
    if (clientId) {
      const existing = await pool.query(
        'SELECT * FROM log_entries WHERE client_id = $1 AND event_id = $2 LIMIT 1',
        [clientId, req.params.id]
      );
      if (existing.rows.length > 0) {
        return res.status(200).json(existing.rows[0]);
      }
    }

    if (event.status === 'cancelled') {
      return res.status(400).json({ error: 'Event is cancelled' });
    }

    // Backlog: an event can only "happen" once its scheduled time is reached.
    // A log arriving before kickoff is rejected; one arriving after it starts
    // the event automatically (same as the auto-transition sweep in app.js) —
    // provided enough players are available, so the RSVP bar can't be bypassed
    // by simply logging something.
    if (event.status === 'scheduled') {
      if (event.event_date && new Date(event.event_date).getTime() > Date.now()) {
        return res.status(400).json({ error: 'This event has not started yet' });
      }
      if (event.format === 'match') {
        const availability = await getMatchAvailability(pool, { eventId: event.id, squadId: event.squad_id });
        if (!availability.meets) {
          return res.status(400).json({ error: availabilityError(availability), availability });
        }
      }
      await pool.query(
        "UPDATE events SET status = 'live', started_at = COALESCE(started_at, now()), updated_at = now() WHERE id = $1",
        [event.id]
      );
      event.status = 'live';
    }

    if (LEAGUE_FORMATS.has(event.format)) {
      return res.status(400).json({ error: 'Use fixture endpoints to log league/tournament actions' });
    }

    const { assist_athlete_id, substitute_athlete_id } = req.body;
    const actionType = action_type.trim();

    // Validation: a player can only receive one red card per match
    if (actionType === 'red_card' && athlete_id) {
      const existingRedCards = await pool.query(
        `SELECT COUNT(*) as count FROM log_entries 
         WHERE event_id = $1 AND athlete_id = $2 AND action_type = 'red_card' AND deleted_at IS NULL`,
        [event.id, athlete_id]
      );
      if (Number(existingRedCards.rows[0].count) >= 1) {
        return res.status(400).json({ error: 'Player already has a red card in this match' });
      }
    }

    // Validation: minute must be reasonable (0-120 for extra time)
    if (minute !== undefined && minute !== null) {
      const minuteNum = Number(minute);
      if (!Number.isFinite(minuteNum) || minuteNum < 0 || minuteNum > 120) {
        return res.status(400).json({ error: 'Minute must be between 0 and 120' });
      }
    }

    // Lineups gate live logging: the starting XI must exist first, and
    // benched players can only be booked.
    const lineupRows = await getLineup(pool, { eventId: event.id });
    if (lineupRows.length === 0) {
      return res.status(400).json({ error: 'Set the starting lineups before logging' });
    }
    // A swap carries its own validation (starter off, substitute on), so the
    // generic bench check only applies to the off player for plain entries.
    const isSubstitutionSwap = actionType === 'substitution' && Boolean(substitute_athlete_id);
    if (athlete_id && !isSubstitutionSwap) {
      const athleteCheck = await pool.query(
        'SELECT id FROM athletes WHERE id = $1 AND squad_id = $2',
        [athlete_id, squadId]
      );
      if (athleteCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Athlete does not belong to this squad' });
      }
      const lineupError = lineupCheckForLog(lineupRows, Number(athlete_id), actionType);
      if (lineupError) {
        return res.status(400).json({ error: lineupError });
      }
    }


    // A goal may carry its assist in the same request; the assist becomes a
    // linked log entry so stats and the timeline stay consistent.
    let assistRow = null;
    if (assist_athlete_id) {
      if (actionType !== 'goal') {
        return res.status(400).json({ error: 'An assist can only be logged with a goal' });
      }
      if (!athlete_id) {
        return res.status(400).json({ error: 'Pick the goalscorer before the assist' });
      }
      assistRow = lineupRows.find((r) => r.athlete_id === Number(assist_athlete_id));
      const scorerRow = lineupRows.find((r) => r.athlete_id === Number(athlete_id));
      if (!assistRow || !scorerRow || assistRow.team_side !== scorerRow.team_side) {
        return res.status(400).json({ error: 'The assist must come from the scoring team' });
      }
      if (!assistRow.is_starter) {
        return res.status(400).json({ error: 'The assist must come from a player on the pitch' });
      }
      if (Number(assist_athlete_id) === Number(athlete_id)) {
        return res.status(400).json({ error: 'The scorer cannot assist their own goal' });
      }
    }

    // A substitution records who came on in its notes ("on:<athlete_id>")
    // so the timeline can name both players without a schema change.
    const entryNotes = actionType === 'substitution' && substitute_athlete_id
      ? `on:${Number(substitute_athlete_id)}`
      : (notes || null);

    const client = await pool.connect();
    let createdEntry;
    let substitutionError = null;
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO log_entries (event_id, athlete_id, action_type, is_scoring, value, minute, notes, logged_by, client_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          req.params.id,
          athlete_id || null,
          actionType,
          !!is_scoring,
          value ?? 1,
          minute ?? null,
          entryNotes,
          userId,
          clientId,
        ]
      );
      createdEntry = result.rows[0];

      // The lineup swap happens in the SAME transaction as its log entry
      // (see applySubstitutionInTx), after the insert: a duplicate replay
      // fails the insert on client_id first and never touches the lineup.
      if (isSubstitutionSwap) {
        substitutionError = await applySubstitutionInTx(
          client, { eventId: event.id }, Number(athlete_id), Number(substitute_athlete_id)
        );
      }

      if (substitutionError) {
        await client.query('ROLLBACK');
      } else if (assistRow) {
        await client.query(
          `INSERT INTO log_entries (event_id, athlete_id, action_type, is_scoring, value, minute, notes, logged_by, related_log_id)
           VALUES ($1, $2, 'assist', false, 1, $3, NULL, $4, $5)`,
          [req.params.id, Number(assist_athlete_id), minute ?? null, userId, createdEntry.id]
        );
      }
      if (!substitutionError) await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      // Two replays of the same queued log can race; the unique index makes
      // the loser read back the winner's row instead of failing.
      if (clientId && err.code === '23505') {
        const existing = await pool.query(
          'SELECT * FROM log_entries WHERE client_id = $1 AND event_id = $2 LIMIT 1',
          [clientId, req.params.id]
        );
        if (existing.rows.length > 0) {
          return res.status(200).json(existing.rows[0]);
        }
      }
      throw err;
    } finally {
      client.release();
    }

    if (substitutionError) {
      return res.status(400).json({ error: substitutionError });
    }
    res.status(201).json(createdEntry);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Error creating log entry:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/events/:id/logs/:logId — edit a log entry just made (US14).
// Staff only. Conflict codes (T8): a missing or foreign entry is 404, an
// entry deleted since the client last saw it is 410 Gone. Editing is
// present-flag based and stamps edited_at — see lib/logEdit.js.
router.patch('/:id/logs/:logId', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForStaff(pool, clerkUserId);

    const event = await pool.query('SELECT id, squad_id FROM events WHERE id = $1', [req.params.id]);
    if (event.rows.length === 0 || event.rows[0].squad_id !== squadId) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const found = await pool.query(
      'SELECT * FROM log_entries WHERE id = $1 AND event_id = $2 AND fixture_id IS NULL',
      [req.params.logId, req.params.id]
    );
    if (found.rows.length === 0) {
      return res.status(404).json({ error: 'Log entry not found' });
    }
    if (found.rows[0].deleted_at) {
      return res.status(410).json({ error: 'Log entry has been deleted' });
    }

    const outcome = await applyLogEdit(pool, { row: found.rows[0], body: req.body, squadId });
    if (outcome.error) {
      return res.status(outcome.status).json({ error: outcome.error });
    }
    res.status(outcome.status).json(outcome.entry);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Error updating log entry:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/events/:id/logs/:logId — undo a log entry (soft delete, US14).
// Staff only.
router.delete('/:id/logs/:logId', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForStaff(pool, clerkUserId);

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
      // Idempotent undo: an offline queue may replay a delete that already
      // landed. Already-gone is a success; only a truly unknown entry 404s,
      // so a replayed undo never wedges the queue forever.
      const exists = await pool.query(
        `SELECT l.id FROM log_entries l
         JOIN events e ON e.id = l.event_id
         WHERE l.id = $1 AND l.event_id = $2 AND e.squad_id = $3 AND l.fixture_id IS NULL`,
        [req.params.logId, req.params.id, squadId]
      );
      if (exists.rows.length === 0) {
        return res.status(404).json({ error: 'Log entry not found' });
      }
      return res.sendStatus(204);
    }

    // Undoing a goal also wipes its linked assist entries.
    await pool.query(
      'UPDATE log_entries SET deleted_at = now() WHERE related_log_id = $1 AND deleted_at IS NULL',
      [req.params.logId]
    );

    res.sendStatus(204);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Error undoing log entry:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---- Athlete availability / RSVPs ----

// GET /api/events/:id/rsvps — every athlete in the squad with their current
// response (defaults to 'pending' for anyone who hasn't answered yet).
router.get('/:id/rsvps', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const event = await loadEventWithAccess(pool, req.params.id, squadId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const result = await pool.query(
      `SELECT a.id AS athlete_id, a.name, a.position,
              COALESCE(r.status, 'pending') AS status,
              r.note, r.responded_at
       FROM athletes a
       LEFT JOIN event_rsvps r ON r.athlete_id = a.id AND r.event_id = $1
       WHERE a.squad_id = $2
       ORDER BY a.name`,
      [req.params.id, squadId]
    );

    const summary = result.rows.reduce(
      (acc, row) => {
        acc[row.status] = (acc[row.status] || 0) + 1;
        return acc;
      },
      { pending: 0, available: 0, unavailable: 0, maybe: 0 }
    );

    res.json({ rsvps: result.rows, summary });
  } catch (err) {
    console.error('Error fetching RSVPs:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/events/:id/rsvps/mine — the logged-in athlete sets their own
// availability for this event.
router.put('/:id/rsvps/mine', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const userId = await getOrCreateUserId(pool, clerkUserId);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const athleteId = await getAthleteIdForUser(pool, userId);
    if (!athleteId) {
      return res.status(403).json({ error: 'Your account is not linked to an athlete on this roster' });
    }

    const event = await loadEventWithAccess(pool, req.params.id, squadId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const { status, note } = req.body;
    if (!['available', 'unavailable', 'maybe'].includes(status)) {
      return res.status(400).json({ error: "status must be 'available', 'unavailable', or 'maybe'" });
    }

    const result = await pool.query(
      `INSERT INTO event_rsvps (event_id, athlete_id, status, note, responded_by, responded_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (event_id, athlete_id)
       DO UPDATE SET status = $3, note = $4, responded_by = $5, responded_at = now(), updated_at = now()
       RETURNING *`,
      [req.params.id, athleteId, status, note || null, userId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error setting RSVP:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/events/:id/rsvps/:athleteId — a coach or assistant records an
// athlete's availability on their behalf (e.g. confirmed by phone/WhatsApp).
router.put('/:id/rsvps/:athleteId', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const userId = await getOrCreateUserId(pool, clerkUserId);
    const squadId = await getOwnedSquadIdForStaff(pool, clerkUserId);

    const event = await loadEventWithAccess(pool, req.params.id, squadId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const athleteCheck = await pool.query(
      'SELECT id FROM athletes WHERE id = $1 AND squad_id = $2',
      [req.params.athleteId, squadId]
    );
    if (athleteCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Athlete not found in this squad' });
    }

    const { status, note } = req.body;
    if (!['available', 'unavailable', 'maybe'].includes(status)) {
      return res.status(400).json({ error: "status must be 'available', 'unavailable', or 'maybe'" });
    }

    const result = await pool.query(
      `INSERT INTO event_rsvps (event_id, athlete_id, status, note, responded_by, responded_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (event_id, athlete_id)
       DO UPDATE SET status = $3, note = $4, responded_by = $5, responded_at = now(), updated_at = now()
       RETURNING *`,
      [req.params.id, req.params.athleteId, status, note || null, userId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Error setting RSVP:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
