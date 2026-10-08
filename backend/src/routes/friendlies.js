const express = require('express');
const { Pool } = require('pg');
const { requireAuth, getAuth } = require('../middleware/auth');
const { getOwnedSquadId, getOrCreateUserId, getOwnedSquadIdForCoach } = require('./_squad');

const router = express.Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ---------------------------------------------------------------------------
// T24: Arrange friendlies between squads. A coach proposes a date to another
// squad; the receiving coach accepts (creating mirrored match events for both
// squads) or declines; the proposer can cancel while still pending.
// ---------------------------------------------------------------------------

function friendlyView(row, mySquadId) {
  return {
    id: row.id,
    status: row.status,
    proposed_date: row.proposed_date,
    location: row.location,
    message: row.message,
    from_squad: { id: row.from_squad_id, name: row.from_squad_name },
    to_squad: { id: row.to_squad_id, name: row.to_squad_name },
    direction: row.from_squad_id === mySquadId ? 'outgoing' : 'incoming',
    from_event_id: row.from_event_id,
    to_event_id: row.to_event_id,
    created_at: row.created_at,
    responded_at: row.responded_at,
  };
}

const FRIENDLY_SELECT = `
  SELECT fi.*,
         fromsq.name AS from_squad_name,
         tosq.name AS to_squad_name
  FROM friendly_invites fi
  JOIN squads fromsq ON fromsq.id = fi.from_squad_id
  JOIN squads tosq ON tosq.id = fi.to_squad_id`;

// GET /api/friendlies — my squad's incoming and outgoing friendly proposals
router.get('/', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadId(pool, clerkUserId);

    const result = await pool.query(
      `${FRIENDLY_SELECT}
       WHERE fi.from_squad_id = $1 OR fi.to_squad_id = $1
       ORDER BY fi.created_at DESC`,
      [squadId]
    );
    res.json(result.rows.map((row) => friendlyView(row, squadId)));
  } catch (err) {
    console.error('Error fetching friendlies:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/friendlies — propose a friendly to another squad (coach only)
router.post('/', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);
    const userId = await getOrCreateUserId(pool, clerkUserId);

    const { to_squad_id, proposed_date, location, message } = req.body;
    if (!to_squad_id) {
      return res.status(400).json({ error: 'to_squad_id is required' });
    }
    if (!proposed_date || Number.isNaN(new Date(proposed_date).getTime())) {
      return res.status(400).json({ error: 'A valid proposed_date is required' });
    }
    if (Number(to_squad_id) === squadId) {
      return res.status(400).json({ error: 'You cannot arrange a friendly against your own squad' });
    }

    const target = await pool.query('SELECT id, name FROM squads WHERE id = $1', [to_squad_id]);
    if (target.rows.length === 0) {
      return res.status(404).json({ error: 'Target squad not found' });
    }

    // Don't allow spamming: an existing pending proposal between the same two
    // squads blocks a new one, whichever direction it came from.
    const existing = await pool.query(
      `SELECT id FROM friendly_invites
       WHERE status = 'pending'
         AND ((from_squad_id = $1 AND to_squad_id = $2) OR (from_squad_id = $2 AND to_squad_id = $1))`,
      [squadId, to_squad_id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'There is already a pending friendly between these squads' });
    }

    const result = await pool.query(
      `INSERT INTO friendly_invites (from_squad_id, to_squad_id, proposed_by, proposed_date, location, message)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        squadId,
        to_squad_id,
        userId,
        proposed_date,
        location ? location.trim() : null,
        message ? message.trim() : null,
      ]
    );

    res.status(201).json(friendlyView({ ...result.rows[0], from_squad_name: null, to_squad_name: target.rows[0].name }, squadId));
  } catch (err) {
    console.error('Error proposing friendly:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/friendlies/:id/accept — receiving coach accepts; mirrored match
// events are created so both squads see the fixture on their calendars.
router.post('/:id/accept', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);
    const userId = await getOrCreateUserId(pool, clerkUserId);

    const findResult = await pool.query(`${FRIENDLY_SELECT} WHERE fi.id = $1`, [req.params.id]);
    const friendly = findResult.rows[0];
    if (!friendly) {
      return res.status(404).json({ error: 'Friendly not found' });
    }
    if (friendly.to_squad_id !== squadId) {
      return res.status(403).json({ error: 'Only the invited squad can accept this friendly' });
    }
    if (friendly.status !== 'pending') {
      return res.status(400).json({ error: `This friendly is already ${friendly.status}` });
    }

    // Mirrored events: each squad gets its own event row listing the other as
    // the opponent, sharing date/time and location. tagged as friendly match.
    const fromEvent = await pool.query(
      `INSERT INTO events (squad_id, title, opponent, event_type, format, event_date, location, duration_minutes, created_by)
       VALUES ($1, $2, $3, 'match', 'match', $4, $5, 90, $6) RETURNING id`,
      [friendly.from_squad_id, `Friendly vs ${friendly.to_squad_name}`, friendly.to_squad_name, friendly.proposed_date, friendly.location, userId]
    );
    const toEvent = await pool.query(
      `INSERT INTO events (squad_id, title, opponent, event_type, format, event_date, location, duration_minutes, created_by)
       VALUES ($1, $2, $3, 'match', 'match', $4, $5, 90, $6) RETURNING id`,
      [friendly.to_squad_id, `Friendly vs ${friendly.from_squad_name}`, friendly.from_squad_name, friendly.proposed_date, friendly.location, userId]
    );

    const updated = await pool.query(
      `UPDATE friendly_invites
       SET status = 'accepted', from_event_id = $1, to_event_id = $2, responded_at = now(), updated_at = now()
       WHERE id = $3 RETURNING *`,
      [fromEvent.rows[0].id, toEvent.rows[0].id, friendly.id]
    );

    res.json(friendlyView({ ...updated.rows[0], from_squad_name: friendly.from_squad_name, to_squad_name: friendly.to_squad_name }, squadId));
  } catch (err) {
    console.error('Error accepting friendly:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/friendlies/:id/decline — receiving coach declines
router.post('/:id/decline', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);

    const findResult = await pool.query(`${FRIENDLY_SELECT} WHERE fi.id = $1`, [req.params.id]);
    const friendly = findResult.rows[0];
    if (!friendly) {
      return res.status(404).json({ error: 'Friendly not found' });
    }
    if (friendly.to_squad_id !== squadId) {
      return res.status(403).json({ error: 'Only the invited squad can decline this friendly' });
    }
    if (friendly.status !== 'pending') {
      return res.status(400).json({ error: `This friendly is already ${friendly.status}` });
    }

    const updated = await pool.query(
      `UPDATE friendly_invites SET status = 'declined', responded_at = now(), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [friendly.id]
    );
    res.json(friendlyView({ ...updated.rows[0], from_squad_name: friendly.from_squad_name, to_squad_name: friendly.to_squad_name }, squadId));
  } catch (err) {
    console.error('Error declining friendly:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/friendlies/:id/cancel — proposing coach withdraws while pending
router.post('/:id/cancel', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId);

    const findResult = await pool.query(`${FRIENDLY_SELECT} WHERE fi.id = $1`, [req.params.id]);
    const friendly = findResult.rows[0];
    if (!friendly) {
      return res.status(404).json({ error: 'Friendly not found' });
    }
    if (friendly.from_squad_id !== squadId) {
      return res.status(403).json({ error: 'Only the proposing squad can cancel this friendly' });
    }
    if (friendly.status !== 'pending') {
      return res.status(400).json({ error: `Only pending friendlies can be cancelled (currently ${friendly.status})` });
    }

    const updated = await pool.query(
      `UPDATE friendly_invites SET status = 'cancelled', updated_at = now()
       WHERE id = $1 RETURNING *`,
      [friendly.id]
    );
    res.json(friendlyView({ ...updated.rows[0], from_squad_name: friendly.from_squad_name, to_squad_name: friendly.to_squad_name }, squadId));
  } catch (err) {
    console.error('Error cancelling friendly:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
