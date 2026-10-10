const express = require('express');
const pool = require('../db');
const { requireAuth, getAuth } = require('../middleware/auth');
const { getOwnedSquadIdForStaff } = require('./_squad');
const { findClashes } = require('../lib/clashes');

const router = express.Router();

// Friendlies (T24): a match proposed to another squad from the public
// directory. The proposing coach picks a kickoff and venue, the challenged
// coach accepts or declines, and acceptance creates the SAME match on both
// calendars — one event per squad, linked back to this row.

const MATCH_DURATION = 90;

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function forbidden(message) {
  const err = new Error(message);
  err.status = 403;
  return err;
}

function conflict(message) {
  const err = new Error(message);
  err.status = 409;
  return err;
}

// Same gate as POST /api/events: a squad can't schedule a match with fewer
// athletes than its configured minimum.
async function getRosterStatus(squadId) {
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

// Loads a friendly only when my squad is one of the two involved — another
// squad's proposal stays invisible (404) rather than leaking its existence.
async function loadFriendly(squadId, id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return null;
  }
  const result = await pool.query(
    `SELECT f.*, ps.name AS proposing_squad, os.name AS opposing_squad,
            ps.coach_id AS proposing_coach_id, os.coach_id AS opposing_coach_id
     FROM friendlies f
     JOIN squads ps ON ps.id = f.proposing_squad_id
     JOIN squads os ON os.id = f.opposing_squad_id
     WHERE f.id = $1 AND (f.proposing_squad_id = $2 OR f.opposing_squad_id = $2)`,
    [numericId, squadId]
  );
  return result.rows[0] || null;
}

// Adds the caller's view: which side they're on, and which calendar event is
// theirs once the friendly has been accepted.
function serialize(row, squadId) {
  const direction = row.proposing_squad_id === squadId ? 'outgoing' : 'incoming';
  return {
    ...row,
    direction,
    event_id: direction === 'outgoing' ? row.proposing_event_id : row.opposing_event_id,
  };
}

// GET /api/friendlies — every proposal involving my squad, open ones first.
router.get('/', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForStaff(pool, clerkUserId);
    const result = await pool.query(
      `SELECT f.*, ps.name AS proposing_squad, os.name AS opposing_squad
       FROM friendlies f
       JOIN squads ps ON ps.id = f.proposing_squad_id
       JOIN squads os ON os.id = f.opposing_squad_id
       WHERE f.proposing_squad_id = $1 OR f.opposing_squad_id = $1
       ORDER BY (f.status = 'proposed') DESC, f.event_date DESC`,
      [squadId]
    );
    res.json(result.rows.map((row) => serialize(row, squadId)));
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Error listing friendlies:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/friendlies — propose a match to a squad from the public
// directory.
router.post('/', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForStaff(pool, clerkUserId);

    const { opposing_squad_id, event_date, event_time, location, message } = req.body;

    const opponentId = Number(opposing_squad_id);
    if (!Number.isInteger(opponentId) || opponentId <= 0) {
      throw badRequest('Pick a squad to play against');
    }
    if (opponentId === squadId) {
      throw badRequest('You cannot propose a friendly to your own squad');
    }

    const opponentResult = await pool.query(
      'SELECT id, name, is_public FROM squads WHERE id = $1',
      [opponentId]
    );
    const opponent = opponentResult.rows[0];
    if (!opponent) {
      throw notFound('No such squad');
    }
    // The public directory is the privacy boundary: a squad that never
    // opted in cannot be challenged through it.
    if (!opponent.is_public) {
      throw badRequest(`${opponent.name} is not listed publicly, so it cannot be challenged`);
    }

    if (!event_date || typeof event_date !== 'string') {
      throw badRequest('Pick a kickoff date');
    }
    const timestamp = event_time ? `${event_date}T${event_time}` : event_date;
    const kickoff = new Date(timestamp);
    if (Number.isNaN(kickoff.getTime())) {
      throw badRequest('Pick a valid kickoff date and time');
    }
    // Same window as POST /api/events — a minute of grace for a form that
    // ticks over mid-submit, and nothing beyond three months out.
    if (kickoff.getTime() < Date.now() - 60 * 1000) {
      throw badRequest('Cannot schedule an event in the past');
    }
    if (kickoff.getTime() > Date.now() + 3 * 30 * 24 * 60 * 60 * 1000) {
      throw badRequest('Cannot schedule an event more than 3 months in the future');
    }

    // Proposing a friendly fields a team just like scheduling a match does.
    const roster = await getRosterStatus(squadId);
    if (!roster.meetsMinimum) {
      throw badRequest(
        `Your roster needs at least ${roster.minRosterSize} athletes to schedule a match (you currently have ${roster.athleteCount}).`
      );
    }

    // One open proposal between the two squads at a time, either direction —
    // a second would just queue behind the first.
    const open = await pool.query(
      `SELECT id FROM friendlies
       WHERE status = 'proposed'
         AND ((proposing_squad_id = $1 AND opposing_squad_id = $2)
           OR (proposing_squad_id = $2 AND opposing_squad_id = $1))`,
      [squadId, opponentId]
    );
    if (open.rows.length > 0) {
      throw conflict('There is already an open proposal between these squads');
    }

    const inserted = await pool.query(
      `INSERT INTO friendlies (proposing_squad_id, opposing_squad_id, event_date, location, message)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        squadId,
        opponentId,
        timestamp,
        typeof location === 'string' && location.trim() ? location.trim().slice(0, 255) : null,
        typeof message === 'string' && message.trim() ? message.trim().slice(0, 1000) : null,
      ]
    );
    res.status(201).json(serialize(inserted.rows[0], squadId));
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Error proposing friendly:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/friendlies/:id/accept — the challenged coach accepts. The match
// is created on BOTH calendars in one transaction, so neither side ever sees
// half an arrangement.
router.post('/:id/accept', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForStaff(pool, clerkUserId);
    const friendly = await loadFriendly(squadId, req.params.id);
    if (!friendly) {
      throw notFound('Friendly not found');
    }
    if (friendly.opposing_squad_id !== squadId) {
      throw forbidden('Only the challenged squad can accept this proposal');
    }
    if (friendly.status !== 'proposed') {
      throw conflict(`This proposal has already been ${friendly.status}`);
    }
    if (new Date(friendly.event_date).getTime() < Date.now() - 60 * 1000) {
      throw badRequest('The proposed kickoff has already passed — ask for a fresh proposal');
    }

    // The challenged squad is fielding a team too — same roster gate.
    const roster = await getRosterStatus(squadId);
    if (!roster.meetsMinimum) {
      throw badRequest(
        `Your roster needs at least ${roster.minRosterSize} athletes to schedule a match (you currently have ${roster.athleteCount}).`
      );
    }

    const client = await pool.connect();
    let proposingEventId;
    let opposingEventId;
    try {
      await client.query('BEGIN');
      const proposingEvent = await client.query(
        `INSERT INTO events (squad_id, title, opponent, event_type, format, event_date, location, duration_minutes, created_by)
         VALUES ($1, $2, $3, 'match', 'match', $4, $5, $6, $7) RETURNING id`,
        [
          friendly.proposing_squad_id,
          `Friendly vs ${friendly.opposing_squad.slice(0, 100)}`,
          friendly.opposing_squad.slice(0, 100),
          friendly.event_date,
          friendly.location,
          MATCH_DURATION,
          friendly.proposing_coach_id,
        ]
      );
      proposingEventId = proposingEvent.rows[0].id;
      const opposingEvent = await client.query(
        `INSERT INTO events (squad_id, title, opponent, event_type, format, event_date, location, duration_minutes, created_by)
         VALUES ($1, $2, $3, 'match', 'match', $4, $5, $6, $7) RETURNING id`,
        [
          friendly.opposing_squad_id,
          `Friendly vs ${friendly.proposing_squad.slice(0, 100)}`,
          friendly.proposing_squad.slice(0, 100),
          friendly.event_date,
          friendly.location,
          MATCH_DURATION,
          friendly.opposing_coach_id,
        ]
      );
      opposingEventId = opposingEvent.rows[0].id;
      await client.query(
        `UPDATE friendlies
         SET status = 'accepted', decided_at = now(), updated_at = now(),
             proposing_event_id = $1, opposing_event_id = $2
         WHERE id = $3`,
        [proposingEventId, opposingEventId, friendly.id]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Advisory clash flags for both new events — the same warn-never-block
    // policy as everywhere else on the calendar.
    const [proposingClashes, opposingClashes] = await Promise.all([
      findClashes(pool, friendly.proposing_squad_id, friendly.event_date, MATCH_DURATION, {
        excludeEventId: proposingEventId,
      }),
      findClashes(pool, friendly.opposing_squad_id, friendly.event_date, MATCH_DURATION, {
        excludeEventId: opposingEventId,
      }),
    ]);

    const row = await loadFriendly(squadId, req.params.id);
    res.json({
      ...serialize(row, squadId),
      proposing_event: { id: proposingEventId, clashes: proposingClashes },
      opposing_event: { id: opposingEventId, clashes: opposingClashes },
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Error accepting friendly:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/friendlies/:id/decline — the challenged coach passes, with an
// optional reason the proposer sees.
router.post('/:id/decline', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForStaff(pool, clerkUserId);
    const friendly = await loadFriendly(squadId, req.params.id);
    if (!friendly) {
      throw notFound('Friendly not found');
    }
    if (friendly.opposing_squad_id !== squadId) {
      throw forbidden('Only the challenged squad can decline this proposal');
    }
    if (friendly.status !== 'proposed') {
      throw conflict(`This proposal has already been ${friendly.status}`);
    }
    const reason =
      req.body && typeof req.body.reason === 'string' && req.body.reason.trim()
        ? req.body.reason.trim().slice(0, 500)
        : null;
    await pool.query(
      `UPDATE friendlies
       SET status = 'declined', decline_reason = $1, decided_at = now(), updated_at = now()
       WHERE id = $2`,
      [reason, friendly.id]
    );
    const row = await loadFriendly(squadId, req.params.id);
    res.json(serialize(row, squadId));
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Error declining friendly:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/friendlies/:id/cancel — the proposing coach withdraws an open
// proposal before it is answered.
router.post('/:id/cancel', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req);
    const squadId = await getOwnedSquadIdForStaff(pool, clerkUserId);
    const friendly = await loadFriendly(squadId, req.params.id);
    if (!friendly) {
      throw notFound('Friendly not found');
    }
    if (friendly.proposing_squad_id !== squadId) {
      throw forbidden('Only the proposing squad can cancel this proposal');
    }
    if (friendly.status !== 'proposed') {
      throw conflict(`This proposal has already been ${friendly.status}`);
    }
    await pool.query(
      `UPDATE friendlies
       SET status = 'cancelled', decided_at = now(), updated_at = now()
       WHERE id = $1`,
      [friendly.id]
    );
    const row = await loadFriendly(squadId, req.params.id);
    res.json(serialize(row, squadId));
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Error cancelling friendly:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
