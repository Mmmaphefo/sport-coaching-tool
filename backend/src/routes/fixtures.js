const express = require('express');
const pool = require('../db');
const { requireAuth, getAuth } = require('../middleware/auth');
const { getOwnedSquadId, getOwnedSquadIdForStaff, getOrCreateUserId } = require('./_squad');
const { buildMatchSummary } = require('../lib/summary');
const {
  getLineup,
  getAthleteSquads,
  validateLineupPayload,
  saveLineup,
  lineupCheckForLog,
  applySubstitution,
} = require('../lib/lineups');
const { ensureRatings, squadFromRows, ratingsPayload } = require('../lib/ratings');
const { simulateMatch } = require('../lib/match-simulation');
const { findClashes } = require('../lib/clashes');
const { getMatchAvailability, availabilityError } = require('../lib/availability');


const router = express.Router();

function startingXiReady(rows) {
  return rows.some((row) => row.is_starter);
}

async function getFixtureWithAccess(pool, fixtureId, squadId) {
  const result = await pool.query(
    `SELECT f.*, e.format AS event_format, e.required_teams,
            e.duration_minutes AS event_duration_minutes,
            home.name AS home_squad_name,
            away.name AS away_squad_name
     FROM fixtures f
     JOIN events e ON e.id = f.event_id
     JOIN event_teams et ON et.event_id = f.event_id AND et.squad_id = $2
     JOIN squads home ON home.id = f.home_squad_id
     JOIN squads away ON away.id = f.away_squad_id
     WHERE f.id = $1`,
    [fixtureId, squadId]
  );
  return result.rows[0] || null;
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

// GET /api/fixtures/:id — fixture detail + live timeline
router.get('/:id', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const fixture = await getFixtureWithAccess(pool, req.params.id, squadId);
    if (!fixture) {
      return res.status(404).json({ error: 'Fixture not found' });
    }

    const logs = await getFixtureLogs(pool, fixture.id);
    // A scoring entry belongs to the away team when it was logged against
    // the away squad's athletes, or against the generic "Opponent" entry
    // (athlete_id null) from before lineups existed.
    const sideOf = (l) =>
      l.athlete_id === null || l.athlete_squad_id === fixture.away_squad_id ? 'away' : 'home';
    const homeScore = logs
      .filter((l) => l.is_scoring && sideOf(l) === 'home')
      .reduce((sum, l) => sum + l.value, 0);
    const awayScore = logs
      .filter((l) => l.is_scoring && sideOf(l) === 'away')
      .reduce((sum, l) => sum + l.value, 0);

    const [lineups, homeRoster, awayRoster] = await Promise.all([
      getLineup(pool, { fixtureId: fixture.id }),
      pool.query(
        'SELECT id, name, squad_number, position, photo FROM athletes WHERE squad_id = $1 ORDER BY squad_number NULLS LAST, name',
        [fixture.home_squad_id]
      ),
      pool.query(
        'SELECT id, name, squad_number, position, photo FROM athletes WHERE squad_id = $1 ORDER BY squad_number NULLS LAST, name',
        [fixture.away_squad_id]
      ),
    ]);

    res.json({
      fixture,
      result: { home: homeScore, away: awayScore },
      timeline: logs,
      canLog: fixture.home_squad_id === squadId,
      lineups,
      rosters: { home: homeRoster.rows, away: awayRoster.rows },
    });
  } catch (err) {
    console.error('Error fetching fixture:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/fixtures/:id/clashes — re-check this fixture's window against the
// squad's calendar (its own events plus fixtures in joined competitions).
router.get('/:id/clashes', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const fixture = await getFixtureWithAccess(pool, req.params.id, squadId);
    if (!fixture) {
      return res.status(404).json({ error: 'Fixture not found' });
    }

    const clashes = await findClashes(
      pool,
      squadId,
      fixture.event_date,
      fixture.event_duration_minutes,
      { excludeFixtureId: fixture.id }
    );
    res.json(clashes);
  } catch (err) {
    console.error('Error checking fixture clashes:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/fixtures/:id — update fixture status or kickoff time (staff)
router.patch('/:id', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForStaff(pool, clerkUserId);

    const fixture = await getFixtureWithAccess(pool, req.params.id, squadId);
    if (!fixture) {
      return res.status(404).json({ error: 'Fixture not found' });
    }

    // Only the home team can drive the fixture status for now.
    if (fixture.home_squad_id !== squadId) {
      return res.status(403).json({ error: 'Only the home team can update this fixture' });
    }

    const { event_date, status } = req.body;

    // A fixture is a match: it can only kick off once enough of the home
    // squad has confirmed availability (see lib/availability).
    if (status === 'live' && fixture.status !== 'live') {
      const availability = await getMatchAvailability(pool, {
        eventId: fixture.event_id,
        squadId: fixture.home_squad_id,
      });
      if (!availability.meets) {
        return res.status(400).json({ error: availabilityError(availability), availability });
      }
    }

    const result = await pool.query(
      `UPDATE fixtures
       SET event_date = COALESCE($1, event_date),
           status = COALESCE($2, status),
           started_at = CASE WHEN $2 = 'live' THEN COALESCE(started_at, now()) ELSE started_at END,
           updated_at = now()
       WHERE id = $3 RETURNING *`,
      [event_date || null, status || null, req.params.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Error updating fixture:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/fixtures/:id/summary — T22 auto post-match summary from the
// home side's recorded timeline. Scores use the same convention as fixture
// logging: athlete goals are home goals, athlete-less goals are away goals.
router.get('/:id/summary', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const fixture = await getFixtureWithAccess(pool, req.params.id, squadId);
    if (!fixture) {
      return res.status(404).json({ error: 'Fixture not found' });
    }

    const logs = classifyFixtureSides(await getFixtureLogs(pool, fixture.id), fixture.home_squad_id === squadId);
    const gf = logs
      .filter((l) => l.is_scoring && l.side === 'us')
      .reduce((sum, l) => sum + l.value, 0);
    const ga = logs
      .filter((l) => l.is_scoring && l.side === 'them')
      .reduce((sum, l) => sum + l.value, 0);

    const summary = buildMatchSummary(logs, {
      squadName: fixture.home_squad_id === squadId ? fixture.home_squad_name : fixture.away_squad_name,
      opponent: fixture.home_squad_id === squadId ? fixture.away_squad_name : fixture.home_squad_name,
      gf,
      ga,
    });

    res.json({ fixture_id: fixture.id, status: fixture.status, ...summary });
  } catch (err) {
    console.error('Error building fixture summary:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/fixtures/:id/lineup — set both teams' starting XI + bench.
// Logging stays locked until a lineup exists. Saving is allowed any time
// before completion; saving once kickoff has passed starts the fixture,
// mirroring the first-log behaviour.
router.put('/:id/lineup', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForStaff(pool, clerkUserId);

    const fixture = await getFixtureWithAccess(pool, req.params.id, squadId);
    if (!fixture) {
      return res.status(404).json({ error: 'Fixture not found' });
    }
    if (fixture.home_squad_id !== squadId) {
      return res.status(403).json({ error: 'Only the home team can set the lineups' });
    }
    if (fixture.status === 'cancelled' || fixture.status === 'completed') {
      return res.status(400).json({ error: `Lineups cannot be changed once the fixture is ${fixture.status}` });
    }

    const squadsBySide = { home: fixture.home_squad_id, away: fixture.away_squad_id };
    const { rows, error } = validateLineupPayload(req.body.lineups, squadsBySide);
    if (error) {
      return res.status(400).json({ error });
    }

    const squadByAthlete = await getAthleteSquads(pool, rows.map((r) => r.athleteId));
    for (const r of rows) {
      if (squadByAthlete.get(r.athleteId) !== squadsBySide[r.side]) {
        return res.status(400).json({ error: 'Athlete does not belong to the squad on their team side' });
      }
    }

    await saveLineup(pool, { fixtureId: fixture.id }, rows);

    // Saving the XIs after kickoff normally starts the fixture — but only
    // when enough of the home squad is available. The lineups themselves
    // still save either way; the client surfaces startBlocked as a hint.
    let startBlocked = null;
    if (fixture.status === 'scheduled' && (!fixture.event_date || new Date(fixture.event_date).getTime() <= Date.now())) {
      const availability = await getMatchAvailability(pool, {
        eventId: fixture.event_id,
        squadId: fixture.home_squad_id,
      });
      if (!availability.meets) {
        startBlocked = availability;
      } else {
        await pool.query(
          "UPDATE fixtures SET status = 'live', started_at = COALESCE(started_at, now()), updated_at = now() WHERE id = $1",
          [fixture.id]
        );
      }
    }

    res.json({ lineups: await getLineup(pool, { fixtureId: fixture.id }), startBlocked });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Error saving fixture lineup:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// athlete_id != NULL goals are the home side's (only the home team logs), so
// "us" vs "them" depends on which side our squad is.
function classifyFixtureSides(logs, weAreHome) {
  return logs.map((l) => {
    const goalIsHome = l.athlete_id != null;
    const ours = weAreHome ? goalIsHome : !goalIsHome;
    return { ...l, side: ours ? 'us' : 'them' };
  });
}

// POST /api/fixtures/:id/simulate — build a full 90-minute script for this
// fixture from the saved lineups plus each player's rating.
//
// Nothing is written here: the client replays the script through
// POST /:id/logs, so a simulated match is recorded exactly like a manually
// logged one. `mode` only tells the client how to pace that replay — 'quick'
// applies every event at once, 'timed' spreads the 90 minutes over two real
// minutes.
router.post('/:id/simulate', requireAuth(), async (req, res) => {
  try {
    const mode = req.body && req.body.mode === 'timed' ? 'timed' : 'quick';
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForStaff(pool, clerkUserId);

    const fixture = await getFixtureWithAccess(pool, req.params.id, squadId);
    if (!fixture) {
      return res.status(404).json({ error: 'Fixture not found' });
    }
    if (fixture.home_squad_id !== squadId) {
      return res.status(403).json({ error: 'Only the home team can simulate this fixture' });
    }
    if (fixture.status === 'cancelled') {
      return res.status(400).json({ error: 'Fixture is cancelled' });
    }
    if (fixture.status === 'completed') {
      return res.status(400).json({ error: 'This fixture has already finished' });
    }

    const lineupRows = await getLineup(pool, { fixtureId: fixture.id });
    if (lineupRows.length === 0) {
      return res.status(400).json({ error: 'Set the starting lineups before simulating' });
    }

    const bySide = { home: [], away: [] };
    for (const row of lineupRows) {
      if (bySide[row.team_side]) bySide[row.team_side].push(row);
    }
    if (!startingXiReady(bySide.home) || !startingXiReady(bySide.away)) {
      return res.status(400).json({ error: 'Both teams need a starting XI before simulating' });
    }

    const ratings = await ensureRatings(
      pool,
      lineupRows.map((row) => ({ id: row.athlete_id, name: row.name, position: row.position }))
    );

    const squadOf = (rows) => squadFromRows(rows, ratings);

    const { events, summary } = simulateMatch({
      home: squadOf(bySide.home),
      away: squadOf(bySide.away),
    });

    // Simulating implies the match is being played now: a fixture still
    // waiting on kickoff goes live first so the replay is accepted — subject
    // to the same availability bar as every other way a match can start.
    if (fixture.status === 'scheduled') {
      const availability = await getMatchAvailability(pool, {
        eventId: fixture.event_id,
        squadId: fixture.home_squad_id,
      });
      if (!availability.meets) {
        return res.status(400).json({ error: availabilityError(availability), availability });
      }
      await pool.query(
        "UPDATE fixtures SET status = 'live', started_at = COALESCE(started_at, now()), updated_at = now() WHERE id = $1",
        [fixture.id]
      );
    }

    res.json({ mode, events, summary, ratings: ratingsPayload(ratings) });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Error simulating fixture:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/fixtures/:id/logs
router.get('/:id/logs', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const fixture = await getFixtureWithAccess(pool, req.params.id, squadId);
    if (!fixture) {
      return res.status(404).json({ error: 'Fixture not found' });
    }

    const logs = await getFixtureLogs(pool, fixture.id);
    res.json(logs);
  } catch (err) {
    console.error('Error fetching fixture logs:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/fixtures/:id/logs — log an action in a league/tournament fixture
router.post('/:id/logs', requireAuth(), async (req, res) => {
  try {
    const { athlete_id, action_type, is_scoring, value, minute, notes } = req.body;

    if (!action_type || !action_type.trim()) {
      return res.status(400).json({ error: 'action_type is required' });
    }

    const { userId: clerkUserId } = getAuth(req);
    const userId = await getOrCreateUserId(pool, clerkUserId);
    const squadId = await getOwnedSquadIdForStaff(pool, clerkUserId);

    const fixture = await getFixtureWithAccess(pool, req.params.id, squadId);
    if (!fixture) {
      return res.status(404).json({ error: 'Fixture not found' });
    }

    // Idempotent replay: an offline-queued log is retried with the same
    // client-generated id, so a create that already landed returns the
    // stored row instead of inserting a duplicate.
    const clientId = req.body.client_id ? String(req.body.client_id).slice(0, 64) : null;
    if (clientId) {
      const existing = await pool.query(
        'SELECT * FROM log_entries WHERE client_id = $1 AND fixture_id = $2 LIMIT 1',
        [clientId, fixture.id]
      );
      if (existing.rows.length > 0) {
        return res.status(200).json(existing.rows[0]);
      }
    }

    if (fixture.status === 'cancelled') {
      return res.status(400).json({ error: 'Fixture is cancelled' });
    }

    // Only the home team logs actions in a fixture.
    if (fixture.home_squad_id !== squadId) {
      return res.status(403).json({ error: 'Only the home team can log actions' });
    }

    // Same rule as events: no logging before the scheduled kickoff; a log
    // after kickoff starts the fixture automatically — provided enough of the
    // home squad is available, so the RSVP bar can't be bypassed by logging.
    if (fixture.status === 'scheduled') {
      if (fixture.event_date && new Date(fixture.event_date).getTime() > Date.now()) {
        return res.status(400).json({ error: 'This fixture has not started yet' });
      }
      const availability = await getMatchAvailability(pool, {
        eventId: fixture.event_id,
        squadId: fixture.home_squad_id,
      });
      if (!availability.meets) {
        return res.status(400).json({ error: availabilityError(availability), availability });
      }
      await pool.query(
        "UPDATE fixtures SET status = 'live', started_at = COALESCE(started_at, now()), updated_at = now() WHERE id = $1",
        [fixture.id]
      );
      fixture.status = 'live';
    }

    const { assist_athlete_id, substitute_athlete_id } = req.body;
    const actionType = action_type.trim();

    // Validation: a player can only receive one red card per match
    if (actionType === 'red_card' && athlete_id) {
      const existingRedCards = await pool.query(
        `SELECT COUNT(*) as count FROM log_entries 
         WHERE fixture_id = $1 AND athlete_id = $2 AND action_type = 'red_card' AND deleted_at IS NULL`,
        [fixture.id, athlete_id]
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

    // Lineups gate live logging: the starting XI for both teams must exist
    // first, and benched players can only be booked.
    const lineupRows = await getLineup(pool, { fixtureId: fixture.id });
    if (lineupRows.length === 0) {
      return res.status(400).json({ error: 'Set the starting lineups before logging' });
    }
    // A swap carries its own validation (starter off, substitute on), so the
    // generic bench check only applies to the off player for plain entries.
    const isSubstitutionSwap = actionType === 'substitution' && Boolean(substitute_athlete_id);
    if (athlete_id && !isSubstitutionSwap) {
      const lineupError = lineupCheckForLog(lineupRows, Number(athlete_id), actionType);
      if (lineupError) {
        return res.status(400).json({ error: lineupError });
      }
    }

    if (isSubstitutionSwap) {
      const substitutionError = await applySubstitution(
        pool, { fixtureId: fixture.id }, Number(athlete_id), Number(substitute_athlete_id)
      );
      if (substitutionError) {
        return res.status(400).json({ error: substitutionError });
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
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO log_entries (event_id, fixture_id, athlete_id, action_type, is_scoring, value, minute, notes, logged_by, client_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          fixture.event_id,
          fixture.id,
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

      if (assistRow) {
        await client.query(
          `INSERT INTO log_entries (event_id, fixture_id, athlete_id, action_type, is_scoring, value, minute, notes, logged_by, related_log_id)
           VALUES ($1, $2, $3, 'assist', false, 1, $4, NULL, $5, $6)`,
          [fixture.event_id, fixture.id, Number(assist_athlete_id), minute ?? null, userId, createdEntry.id]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      // Two replays of the same queued log can race; the unique index makes
      // the loser read back the winner's row instead of failing.
      if (clientId && err.code === '23505') {
        const existing = await pool.query(
          'SELECT * FROM log_entries WHERE client_id = $1 AND fixture_id = $2 LIMIT 1',
          [clientId, fixture.id]
        );
        if (existing.rows.length > 0) {
          return res.status(200).json(existing.rows[0]);
        }
      }
      throw err;
    } finally {
      client.release();
    }

    res.status(201).json(createdEntry);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Error creating fixture log entry:', err);
    res.status(500).json({ error: 'Server error', detail: err.message });
  }
});

// PATCH /api/fixtures/:id/logs/:logId
router.patch('/:id/logs/:logId', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForStaff(pool, clerkUserId);

    const fixture = await getFixtureWithAccess(pool, req.params.id, squadId);
    if (!fixture) {
      return res.status(404).json({ error: 'Fixture not found' });
    }

    if (fixture.home_squad_id !== squadId) {
      return res.status(403).json({ error: 'Only the home team can edit logs' });
    }

    const check = await pool.query(
      `SELECT id FROM log_entries
       WHERE id = $1 AND fixture_id = $2 AND deleted_at IS NULL`,
      [req.params.logId, req.params.id]
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
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Error updating fixture log entry:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/fixtures/:id/logs/:logId
router.delete('/:id/logs/:logId', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForStaff(pool, clerkUserId);

    const fixture = await getFixtureWithAccess(pool, req.params.id, squadId);
    if (!fixture) {
      return res.status(404).json({ error: 'Fixture not found' });
    }

    if (fixture.home_squad_id !== squadId) {
      return res.status(403).json({ error: 'Only the home team can undo logs' });
    }

    const result = await pool.query(
      `UPDATE log_entries
       SET deleted_at = now()
       WHERE id = $1 AND fixture_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [req.params.logId, req.params.id]
    );

    if (result.rows.length === 0) {
      // Idempotent undo: an offline queue may replay a delete that already
      // landed. Already-gone is a success; only a truly unknown entry 404s,
      // so a replayed undo never wedges the queue forever.
      const exists = await pool.query(
        'SELECT id FROM log_entries WHERE id = $1 AND fixture_id = $2',
        [req.params.logId, req.params.id]
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
    console.error('Error undoing fixture log entry:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
