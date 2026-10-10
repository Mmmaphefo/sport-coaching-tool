const express = require('express');
const pool = require('../db');
const { requireAuth, getAuth } = require('../middleware/auth');
const { getOwnedSquadIdForStaff, getOwnedSquadIdForCoach, getOrCreateUserId } = require('./_squad');
const { estimateReturn } = require('../lib/injury-estimator');
const { injuryDateError } = require('../lib/soccerRules');

const router = express.Router();

async function assertAthleteInSquad(athleteId, squadId) {
  const check = await pool.query(
    'SELECT id FROM athletes WHERE id = $1 AND squad_id = $2',
    [athleteId, squadId]
  );
  if (check.rows.length === 0) {
    const err = new Error('Athlete not found in your squad');
    err.status = 404;
    throw err;
  }
}

// POST /api/injuries — log an injury (US29). Staff only: players cannot log
// injuries themselves, matching the access the live-logging endpoints allow.
router.post('/', requireAuth(), async (req, res) => {
  try {
    const { athlete_id, description, date_sustained, severity } = req.body;

    if (!athlete_id) return res.status(400).json({ error: 'athlete_id is required' });
    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'A description is required' });
    }
    if (!date_sustained) {
      return res.status(400).json({ error: 'date_sustained is required' });
    }
    const sev = (severity || 'moderate').toLowerCase();
    if (!['minor', 'moderate', 'severe'].includes(sev)) {
      return res.status(400).json({ error: 'severity must be minor, moderate, or severe' });
    }

    const { userId: clerkUserId } = getAuth(req);
    const userId = await getOrCreateUserId(pool, clerkUserId);
    const squadId = await getOwnedSquadIdForStaff(pool, clerkUserId);

    await assertAthleteInSquad(athlete_id, squadId);

    // Soccer realism rule (lib/soccerRules): an injury cannot predate the
    // player's birth, nor land before their 15th birthday. A missing date of
    // birth is a data gap, not a violation, so it skips the check.
    const athleteRow = await pool.query(
      'SELECT date_of_birth FROM athletes WHERE id = $1',
      [athlete_id]
    );
    const dob = athleteRow.rows.length > 0 ? athleteRow.rows[0].date_of_birth : null;
    const injuryError = injuryDateError({ dateOfBirth: dob, dateSustained: date_sustained });
    if (injuryError) {
      return res.status(400).json({ error: injuryError });
    }

    const estimate = estimateReturn(description.trim(), date_sustained, sev);

    const result = await pool.query(
      `INSERT INTO injuries
         (athlete_id, description, date_sustained, severity, return_date,
          estimation_basis, estimation_min_weeks, estimation_max_weeks, logged_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        athlete_id,
        description.trim(),
        date_sustained,
        sev,
        estimate.returnDate,
        estimate.basis,
        estimate.minWeeks,
        estimate.maxWeeks,
        userId,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error logging injury:', err.message);
    const status = err.status || 500;
    res.status(status).json({ error: status === 404 || status === 403 ? err.message : 'Server error' });
  }
});

// PATCH /api/injuries/:id — coach-only: override the return date (US30),
// edit details, or manually clear the injury early (US31).
router.patch('/:id', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);

    const check = await pool.query(
      `SELECT i.id FROM injuries i
       JOIN athletes a ON a.id = i.athlete_id
       WHERE i.id = $1 AND a.squad_id = $2`,
      [req.params.id, squadId]
    );
    if (check.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to edit this injury' });
    }

    const { description, date_sustained, severity, return_date, clear } = req.body;

    // Same realism rule on edit: a moved injury date must still sit after
    // the player's 15th birthday.
    if (date_sustained) {
      const athleteRow = await pool.query(
        `SELECT a.date_of_birth FROM injuries i
         JOIN athletes a ON a.id = i.athlete_id
         WHERE i.id = $1`,
        [req.params.id]
      );
      const dob = athleteRow.rows.length > 0 ? athleteRow.rows[0].date_of_birth : null;
      const injuryError = injuryDateError({ dateOfBirth: dob, dateSustained: date_sustained });
      if (injuryError) {
        return res.status(400).json({ error: injuryError });
      }
    }

    const result = await pool.query(
      `UPDATE injuries
       SET description = COALESCE($1, description),
           date_sustained = COALESCE($2, date_sustained),
           severity = COALESCE($3, severity),
           return_date = COALESCE($4, return_date),
           cleared_at = CASE WHEN $5 = true THEN now() ELSE cleared_at END,
           updated_at = now()
       WHERE id = $6 RETURNING *`,
      [description, date_sustained, severity, return_date || null, !!clear, req.params.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating injury:', err.message);
    // Respect role/permission errors (e.g. getOwnedSquadIdForCoach rejecting
    // an assistant) instead of masking them as 500s.
    const status = err.status || 500;
    res.status(status).json({ error: status === 403 ? err.message : 'Server error' });
  }
});

// DELETE /api/injuries/:id — coach-only: remove a mis-logged entry.
router.delete('/:id', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);

    const result = await pool.query(
      `DELETE FROM injuries i
       USING athletes a
       WHERE i.id = $1 AND i.athlete_id = a.id AND a.squad_id = $2
       RETURNING i.id`,
      [req.params.id, squadId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized to delete this injury' });
    }
    res.sendStatus(204);
  } catch (err) {
    console.error('Error deleting injury:', err.message);
    const status = err.status || 500;
    res.status(status).json({ error: status === 403 ? err.message : 'Server error' });
  }
});

module.exports = router;