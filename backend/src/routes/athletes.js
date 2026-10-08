const express = require('express');
const { Pool } = require('pg');
const { requireAuth, getAuth } = require('../middleware/auth');
const { getOwnedSquadId, getOwnedSquadIdForCoach, getOrCreateUserId } = require('./_squad');
const { createInvite } = require('./invites');

const router = express.Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ---------------------------------------------------------------------------
// Season helper — seasons run Aug (month 8) through May, so a match in
// Sep 2024 or Mar 2025 both belong to season "2024/25". A match in Jun 2025
// (off-season) is treated as still belonging to the season that just ended,
// "2024/25", since there's no separate "off-season" bucket for stats.
// ---------------------------------------------------------------------------
function getSeasonLabel(dateInput) {
  const d = new Date(dateInput);
  const month = d.getMonth() + 1; // 1-12
  const year = d.getFullYear();
  const startYear = month >= 8 ? year : year - 1;
  const endYearShort = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}/${endYearShort}`;
}

// Aggregate a list of log rows into the same stat shape used everywhere else.
function summariseLogs(logs) {
  const goals = logs
    .filter((l) => l.action_type === 'goal')
    .reduce((sum, l) => sum + l.value, 0);
  const assists = logs
    .filter((l) => l.action_type === 'assist')
    .reduce((sum, l) => sum + l.value, 0);
  const penalties = logs.filter((l) => l.action_type.includes('penalty')).length;
  const yellowCards = logs.filter((l) => l.action_type === 'yellow_card').length;
  const redCards = logs.filter((l) => l.action_type === 'red_card').length;
  const appearances = new Set(logs.map((l) => l.event_id)).size;

  return { goals, assists, penalties, yellowCards, redCards, appearances };
}

// List the logged-in coach's roster
router.get('/', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const result = await pool.query(
      'SELECT * FROM athletes WHERE squad_id = $1 ORDER BY name',
      [squadId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching athletes:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add an athlete to the logged-in coach's squad. If an email is given, also
// creates an invite (same mechanism as inviting an assistant) tied to this
// specific athlete row, so accepting it links to these exact stats (US24/25).
router.post('/', requireAuth(), async (req, res) => {
  try {
    const { name, position, squad_number, date_of_birth, contact_info, email } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Athlete name is required' });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const { userId: clerkUserId } = getAuth(req);
    const userId = await getOrCreateUserId(pool, clerkUserId);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);

    const result = await pool.query(
      `INSERT INTO athletes (squad_id, name, position, squad_number, date_of_birth, contact_info, email)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [squadId, name.trim(), position || null, squad_number || null, date_of_birth || null, contact_info || null, email || null]
    );
    const athlete = result.rows[0];

    let invite = null;
    if (email && email.trim()) {
      invite = await createInvite(pool, {
        email: email.trim(),
        squadId,
        invitedBy: userId,
        role: 'athlete',
        athleteId: athlete.id,
      });
    }

    res.status(201).json({ ...athlete, invite });
  } catch (err) {
    console.error('Error creating athlete:', err);
    const status = err.status || 500;
    const message = (status === 403 || status === 409) ? err.message : 'Server error';
    res.status(status).json({ error: message });
  }
});

// GET /api/athletes/:id/stats — per-athlete summary derived from logged events (US17)
// Optional ?season=2024/25 filters everything (stats + logs) down to that season.
// Regardless of the filter, the response always includes the full season-by-season
// breakdown and opponent breakdown so the frontend can render trend charts and
// season comparisons without extra round trips.
//
// NOTE: "appearances" here = distinct events this athlete has a logged action in.
// There's no separate roster/lineup-per-event table yet, so an athlete who played
// but never had an action logged against them won't be counted as an appearance.
router.get('/:id/stats', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const athleteResult = await pool.query(
      'SELECT * FROM athletes WHERE id = $1 AND squad_id = $2',
      [req.params.id, squadId]
    );
    if (athleteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Athlete not found' });
    }

    const logsResult = await pool.query(
      `SELECT l.*, e.event_date, e.opponent
       FROM log_entries l
       JOIN events e ON e.id = l.event_id
       WHERE l.athlete_id = $1 AND l.deleted_at IS NULL
       ORDER BY e.event_date DESC`,
      [req.params.id]
    );
    const allLogs = logsResult.rows.map((l) => ({
      ...l,
      season: getSeasonLabel(l.event_date),
    }));

    // --- Season-by-season breakdown (always full history, for trend charts) ---
    const seasonMap = new Map();
    for (const log of allLogs) {
      if (!seasonMap.has(log.season)) seasonMap.set(log.season, []);
      seasonMap.get(log.season).push(log);
    }
    // Sort chronologically ascending (oldest season first) — trend charts read left-to-right
    const seasonBreakdown = Array.from(seasonMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([season, logs]) => ({ season, ...summariseLogs(logs) }));

    const seasons = seasonBreakdown.map((s) => s.season).sort().reverse(); // newest first, for a dropdown

    // --- Apply the season filter (if any) to everything the rest of the response uses ---
    const requestedSeason = (req.query.season || '').trim();
    const logs = requestedSeason
      ? allLogs.filter((l) => l.season === requestedSeason)
      : allLogs;

    const stats = summariseLogs(logs);

    // --- Opponent comparison, scoped to whatever season is currently selected ---
    const opponentMap = new Map();
    for (const log of logs) {
      const opponent = log.opponent || 'Training';
      if (!opponentMap.has(opponent)) opponentMap.set(opponent, []);
      opponentMap.get(opponent).push(log);
    }
    const opponentBreakdown = Array.from(opponentMap.entries())
      .map(([opponent, logs]) => ({ opponent, ...summariseLogs(logs) }))
      .sort((a, b) => b.appearances - a.appearances);

    res.json({
      athlete: athleteResult.rows[0],
      stats,
      logs,
      seasons,
      selectedSeason: requestedSeason || null,
      seasonBreakdown,
      opponentBreakdown,
    });
  } catch (err) {
    console.error('Error fetching athlete stats:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Edit an athlete — only if the coach owns the squad it belongs to
router.patch('/:id', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);

    const athleteCheck = await pool.query(
      'SELECT id FROM athletes WHERE id = $1 AND squad_id = $2',
      [req.params.id, squadId]
    );
    if (athleteCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to edit this athlete' });
    }

    const { name, position, squad_number, date_of_birth, contact_info, email, rating } = req.body;

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    if (rating !== undefined && rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 100)) {
      return res.status(400).json({ error: 'Rating must be an integer between 1 and 100' });
    }

    const result = await pool.query(
      `UPDATE athletes
       SET name = COALESCE($1, name),
           position = COALESCE($2, position),
           squad_number = COALESCE($3, squad_number),
           date_of_birth = COALESCE($4, date_of_birth),
           contact_info = COALESCE($5, contact_info),
           email = COALESCE($6, email),
           rating = COALESCE($7, CASE WHEN $8 THEN NULL ELSE rating END),
           updated_at = now()
       WHERE id = $9 RETURNING *`,
      [name, position, squad_number, date_of_birth, contact_info, email || null, rating ?? null, rating === null, req.params.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating athlete:', err.message);
    const status = err.status || 500;
    const message = (status === 403 || status === 409) ? err.message : 'Server error';
    res.status(status).json({ error: message });
  }
});

// Remove an athlete — only if the coach owns the squad it belongs to
router.delete('/:id', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);

    const result = await pool.query(
      'DELETE FROM athletes WHERE id = $1 AND squad_id = $2 RETURNING id',
      [req.params.id, squadId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to delete this athlete' });
    }

    res.sendStatus(204);
  } catch (err) {
    console.error('Error deleting athlete:', err.message);
    const status = err.status || 500;
    const message = (status === 403 || status === 409) ? err.message : 'Server error';
    res.status(status).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// T21 support: injury records. The lineup suggestion treats an athlete as
// unavailable while today falls between started_on and expected_return
// (or indefinitely, if no return date), until the record is cleared.
// ---------------------------------------------------------------------------

// GET /api/athletes/:id/injuries — injury history
router.get('/:id/injuries', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const athleteCheck = await pool.query(
      'SELECT id FROM athletes WHERE id = $1 AND squad_id = $2',
      [req.params.id, squadId]
    );
    if (athleteCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Athlete not found' });
    }

    const result = await pool.query(
      'SELECT * FROM athlete_injuries WHERE athlete_id = $1 ORDER BY started_on DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching injuries:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/athletes/:id/injuries — record an injury (coach only)
router.post('/:id/injuries', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);

    const athleteCheck = await pool.query(
      'SELECT id FROM athletes WHERE id = $1 AND squad_id = $2',
      [req.params.id, squadId]
    );
    if (athleteCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Athlete not found' });
    }

    const { started_on, expected_return, note } = req.body;
    if (!started_on) {
      return res.status(400).json({ error: 'started_on is required' });
    }
    if (expected_return && new Date(expected_return) < new Date(started_on)) {
      return res.status(400).json({ error: 'expected_return cannot be before started_on' });
    }

    const result = await pool.query(
      `INSERT INTO athlete_injuries (athlete_id, started_on, expected_return, note)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.id, started_on, expected_return || null, note || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error recording injury:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/athletes/:id/injuries/:injuryId — update or clear an injury
router.patch('/:id/injuries/:injuryId', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);

    const check = await pool.query(
      `SELECT i.id FROM athlete_injuries i
       JOIN athletes a ON a.id = i.athlete_id
       WHERE i.id = $1 AND i.athlete_id = $2 AND a.squad_id = $3`,
      [req.params.injuryId, req.params.id, squadId]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Injury record not found' });
    }

    const { expected_return, note, cleared } = req.body;
    const result = await pool.query(
      `UPDATE athlete_injuries
       SET expected_return = COALESCE($1, expected_return),
           note = COALESCE($2, note),
           cleared_at = CASE WHEN $3 THEN CURRENT_DATE ELSE cleared_at END,
           updated_at = now()
       WHERE id = $4 RETURNING *`,
      [expected_return || null, note || null, cleared === true, req.params.injuryId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating injury:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/athletes/:id/injuries/:injuryId — remove an injury record
router.delete('/:id/injuries/:injuryId', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);

    const result = await pool.query(
      `DELETE FROM athlete_injuries i
       USING athletes a
       WHERE i.athlete_id = a.id AND i.id = $1 AND i.athlete_id = $2 AND a.squad_id = $3
       RETURNING i.id`,
      [req.params.injuryId, req.params.id, squadId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Injury record not found' });
    }
    res.sendStatus(204);
  } catch (err) {
    console.error('Error deleting injury:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;