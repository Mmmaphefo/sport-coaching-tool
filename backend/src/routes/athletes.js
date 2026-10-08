const express = require('express');
const pool = require('../db');
const { requireAuth, getAuth } = require('../middleware/auth');
const { getOwnedSquadId, getOwnedSquadIdForCoach, getOrCreateUserId } = require('./_squad');
const { createInvite } = require('./invites');
const { createPlayerAccount } = require('../lib/playerAccounts');

const router = express.Router();

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

// List the logged-in coach's roster, flagging currently-injured and
// managed/rested athletes, plus each athlete's account/invite status so the
// roster cards can show and drive the player-invite flow:
//   'joined'  — athletes.user_id is linked to an accepted account
//   'invited' — a pending invite exists for this athlete
//   'none'    — no account and no pending invite
// The latest invite wins (ordered by id DESC inside the LATERAL join).
router.get('/', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const result = await pool.query(
      `SELECT a.*, EXISTS (
         SELECT 1 FROM injuries i
         WHERE i.athlete_id = a.id
           AND i.cleared_at IS NULL
           AND i.return_date >= CURRENT_DATE
       ) AS is_injured,
       latest_invite.email AS invite_email,
       CASE
         WHEN a.user_id IS NOT NULL THEN 'joined'
         WHEN latest_invite.id IS NOT NULL AND latest_invite.status = 'pending' THEN 'invited'
         ELSE 'none'
       END AS account_status
       FROM athletes a
       LEFT JOIN LATERAL (
         SELECT id, email, status FROM invites
         WHERE athlete_id = a.id
         ORDER BY id DESC LIMIT 1
       ) latest_invite ON true
       WHERE a.squad_id = $1
       ORDER BY a.name`,
      [squadId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching athletes:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add an athlete to the logged-in coach's squad. If an email is given, also
// pre-creates a Clerk player account and sends an invite (same mechanism as
// inviting an assistant) tied to this specific athlete row, so accepting it
// links to these exact stats (US24/25). The generated password comes back so
// the coach can share the login details with the player.
router.post('/', requireAuth(), async (req, res) => {
  try {
    const { name, position, squad_number, date_of_birth, contact_info, email, height_cm, weight_kg, tactical_tags, coach_notes } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Athlete name is required' });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    if (height_cm != null && (height_cm < 50 || height_cm > 300)) {
      return res.status(400).json({ error: 'Height must be between 50 and 300 cm' });
    }

    if (weight_kg != null && (weight_kg < 10 || weight_kg > 300)) {
      return res.status(400).json({ error: 'Weight must be between 10 and 300 kg' });
    }

    if (tactical_tags != null && typeof tactical_tags !== 'string') {
      return res.status(400).json({ error: 'Tactical tags must be a string' });
    }

    if (coach_notes != null && typeof coach_notes !== 'string') {
      return res.status(400).json({ error: 'Coach notes must be a string' });
    }

    const { userId: clerkUserId } = getAuth(req);
    const userId = await getOrCreateUserId(pool, clerkUserId);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);

    const result = await pool.query(
      `INSERT INTO athletes (squad_id, name, position, squad_number, date_of_birth, contact_info, email, height_cm, weight_kg, tactical_tags, coach_notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [squadId, name.trim(), position || null, squad_number || null, date_of_birth || null, contact_info || null, email || null, height_cm || null, weight_kg || null, tactical_tags || null, coach_notes || null]
    );
    const athlete = result.rows[0];

    let invite = null;
    if (email && email.trim()) {
      const trimmedEmail = email.trim();
      // Account first: the password rides along in the invite email and in
      // the response so the coach can hand over login details. A failure to
      // create the account never blocks the invite itself.
      const account = await createPlayerAccount({ email: trimmedEmail, name: athlete.name });
      const credentials = account.created
        ? { email: trimmedEmail, password: account.password }
        : null;

      try {
        invite = await createInvite(pool, {
          email: trimmedEmail,
          squadId,
          invitedBy: userId,
          role: 'athlete',
          athleteId: athlete.id,
          credentials,
        });
        invite.account = account;
      } catch (inviteErr) {
        // Surface invite-specific errors (e.g. "already joined" 409) but
        // keep the athlete row that was created.
        return res.status(inviteErr.status || 500).json({
          error: inviteErr.status ? inviteErr.message : 'Server error',
          athlete,
        });
      }
    }

    res.status(201).json({ ...athlete, invite });
  } catch (err) {
    console.error('Error creating athlete:', err);
    const status = err.status || 500;
    const message = (status === 403 || status === 409) ? err.message : 'Server error';
    res.status(status).json({ error: message });
  }
});

// POST /api/athletes/:id/invite — invite an existing roster player to create
// their own account, from the card on the roster page (same infrastructure as
// the assistant invite). Pre-creates the Clerk account and returns the
// generated password so the coach can share the login details.
router.post('/:id/invite', requireAuth(), async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Email is required' });
    }
    const trimmedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const { userId: clerkUserId } = getAuth(req);
    const userId = await getOrCreateUserId(pool, clerkUserId);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);

    const athleteResult = await pool.query(
      'SELECT * FROM athletes WHERE id = $1 AND squad_id = $2',
      [req.params.id, squadId]
    );
    if (athleteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Athlete not found in your squad' });
    }
    const athlete = athleteResult.rows[0];

    if (athlete.user_id) {
      return res.status(409).json({ error: `${athlete.name} has already joined the squad` });
    }

    // Keep athletes.email in sync with the latest invite address.
    if (athlete.email !== trimmedEmail) {
      await pool.query('UPDATE athletes SET email = $1, updated_at = now() WHERE id = $2', [
        trimmedEmail,
        athlete.id,
      ]);
    }

    const account = await createPlayerAccount({ email: trimmedEmail, name: athlete.name });
    const credentials = account.created
      ? { email: trimmedEmail, password: account.password }
      : null;

    const invite = await createInvite(pool, {
      email: trimmedEmail,
      squadId,
      invitedBy: userId,
      role: 'athlete',
      athleteId: athlete.id,
      credentials,
    });

    res.status(201).json({ invite, account });
  } catch (err) {
    console.error('Error inviting athlete:', err.message);
    const status = err.status || 500;
    const message = (status === 400 || status === 403 || status === 404 || status === 409)
      ? err.message
      : 'Server error';
    res.status(status).json({ error: message });
  }
});

// GET /api/athletes/:id/stats — per-athlete summary derived from logged events (US17),
// including injury history and current injury status (US29/US30/US31).
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

    const injuriesResult = await pool.query(
      'SELECT * FROM injuries WHERE athlete_id = $1 ORDER BY date_sustained DESC',
      [req.params.id]
    );
    const injuries = injuriesResult.rows;
    const today = new Date().toISOString().slice(0, 10);
    const currentInjury = injuries.find(
      (i) => !i.cleared_at && i.return_date && i.return_date.toISOString().slice(0, 10) >= today
    ) || null;

    // Compute BMI if height and weight are available
    const athlete = athleteResult.rows[0];
    let bmi = null;
    if (athlete.height_cm && athlete.weight_kg && athlete.height_cm > 0) {
      const heightM = athlete.height_cm / 100;
      bmi = +(athlete.weight_kg / (heightM * heightM)).toFixed(1);
    }

    // Manual corrections take precedence over the computed value for any
    // stat a coach has overridden (e.g. a goal that was logged against the
    // wrong player and can't easily be untangled from the log). The
    // computed value is still returned alongside so the UI can show both.
    const overridesResult = await pool.query(
      'SELECT stat_key, override_value, note, updated_at FROM athlete_stat_overrides WHERE athlete_id = $1',
      [req.params.id]
    );
    const overrides = {};
    for (const row of overridesResult.rows) {
      overrides[row.stat_key] = {
        value: row.override_value,
        note: row.note,
        updatedAt: row.updated_at,
        computedValue: stats[row.stat_key] ?? null,
      };
      if (Object.prototype.hasOwnProperty.call(stats, row.stat_key)) {
        stats[row.stat_key] = row.override_value;
      }
    }

    res.json({
      athlete,
      stats,
      overrides,
      logs,
      seasons,
      selectedSeason: requestedSeason || null,
      seasonBreakdown,
      opponentBreakdown,
      injuries,
      currentInjury,
      bmi,
    });
  } catch (err) {
    console.error('Error fetching athlete stats:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Stat keys a coach is allowed to manually correct — matches the keys
// returned in GET /:id/stats above.
const OVERRIDABLE_STAT_KEYS = new Set([
  'goals', 'assists', 'penalties', 'yellowCards', 'redCards', 'appearances',
]);

// PATCH /api/athletes/:id/stats/override — coach-only manual correction of
// a single derived stat, e.g. when a log entry can't be cleanly fixed.
router.patch('/:id/stats/override', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const userId = await getOrCreateUserId(pool, clerkUserId);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);

    const athleteCheck = await pool.query(
      'SELECT id FROM athletes WHERE id = $1 AND squad_id = $2',
      [req.params.id, squadId]
    );
    if (athleteCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to correct this athlete\'s stats' });
    }

    const { stat_key, value, note } = req.body;
    if (!OVERRIDABLE_STAT_KEYS.has(stat_key)) {
      return res.status(400).json({
        error: `stat_key must be one of: ${[...OVERRIDABLE_STAT_KEYS].join(', ')}`,
      });
    }
    const overrideValue = Number(value);
    if (!Number.isInteger(overrideValue) || overrideValue < 0) {
      return res.status(400).json({ error: 'value must be a non-negative whole number' });
    }

    const result = await pool.query(
      `INSERT INTO athlete_stat_overrides (athlete_id, stat_key, override_value, note, set_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (athlete_id, stat_key)
       DO UPDATE SET override_value = $3, note = $4, set_by = $5, updated_at = now()
       RETURNING *`,
      [req.params.id, stat_key, overrideValue, note || null, userId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error setting stat override:', err.message);
    const status = err.status || 500;
    res.status(status).json({ error: status === 403 ? err.message : 'Server error' });
  }
});

// DELETE /api/athletes/:id/stats/override/:statKey — revert a stat back to
// its computed value.
router.delete('/:id/stats/override/:statKey', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);

    const athleteCheck = await pool.query(
      'SELECT id FROM athletes WHERE id = $1 AND squad_id = $2',
      [req.params.id, squadId]
    );
    if (athleteCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to correct this athlete\'s stats' });
    }

    await pool.query(
      'DELETE FROM athlete_stat_overrides WHERE athlete_id = $1 AND stat_key = $2',
      [req.params.id, req.params.statKey]
    );

    res.sendStatus(204);
  } catch (err) {
    console.error('Error clearing stat override:', err.message);
    const status = err.status || 500;
    res.status(status).json({ error: status === 403 ? err.message : 'Server error' });
  }
});

// Edit an athlete — only if the coach owns the squad it belongs to.
// Also handles the managed/rested toggle (is_managed).
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

    const { name, position, squad_number, date_of_birth, contact_info, email, is_managed, height_cm, weight_kg, tactical_tags, coach_notes } = req.body;

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    if (height_cm != null && (height_cm < 50 || height_cm > 300)) {
      return res.status(400).json({ error: 'Height must be between 50 and 300 cm' });
    }

    if (weight_kg != null && (weight_kg < 10 || weight_kg > 300)) {
      return res.status(400).json({ error: 'Weight must be between 10 and 300 kg' });
    }

    if (tactical_tags != null && typeof tactical_tags !== 'string') {
      return res.status(400).json({ error: 'Tactical tags must be a string' });
    }

    if (coach_notes != null && typeof coach_notes !== 'string') {
      return res.status(400).json({ error: 'Coach notes must be a string' });
    }

    // Profile photos arrive as data URLs (downscaled in the browser before
    // upload — see frontend/src/lib/image.js). An explicit null clears the
    // photo, which the COALESCE-only pattern used by the other fields cannot
    // express, so photo is applied via a CASE on the has-update flag.
    const hasPhotoUpdate = Object.prototype.hasOwnProperty.call(req.body, 'photo');
    let photo = null;
    if (hasPhotoUpdate && req.body.photo != null) {
      photo = req.body.photo;
      if (
        typeof photo !== 'string' ||
        !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(photo)
      ) {
        return res.status(400).json({ error: 'Photo must be a JPEG, PNG or WebP image' });
      }
      if (photo.length > 400000) {
        return res.status(400).json({ error: 'Photo is too large' });
      }
    }

    const result = await pool.query(
      `UPDATE athletes
       SET name = COALESCE($1, name),
           position = COALESCE($2, position),
           squad_number = COALESCE($3, squad_number),
           date_of_birth = COALESCE($4, date_of_birth),
           contact_info = COALESCE($5, contact_info),
           email = COALESCE($6, email),
           is_managed = COALESCE($7, is_managed),
           height_cm = COALESCE($11, height_cm),
           weight_kg = COALESCE($12, weight_kg),
           tactical_tags = COALESCE($13, tactical_tags),
           coach_notes = COALESCE($14, coach_notes),
           photo = CASE WHEN $9::boolean THEN $10 ELSE photo END,
           updated_at = now()
       WHERE id = $8 RETURNING *`,
      [name, position, squad_number, date_of_birth, contact_info, email || null, typeof is_managed === 'boolean' ? is_managed : null, req.params.id, hasPhotoUpdate, photo, height_cm || null, weight_kg || null, tactical_tags || null, coach_notes || null]
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

module.exports = router;