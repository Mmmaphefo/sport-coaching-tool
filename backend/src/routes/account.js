const express = require('express');
const pool = require('../db');
const { requireAuth, getAuth } = require('../middleware/auth');
const { getOrCreateUserId } = require('./_squad');
const { deleteUserByClerkId } = require('../lib/userDeletion');

const router = express.Router();

// GET /api/account/me — role and basic profile info for the logged-in user.
router.get('/me', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkId } = getAuth(req);
    const userId = await getOrCreateUserId(pool, clerkId);

    const userResult = await pool.query(
      'SELECT role, squad_id FROM users WHERE id = $1',
      [userId]
    );

    const row = userResult.rows[0] || { role: 'coach', squad_id: null };
    let athleteId = null;

    if (row.role === 'athlete') {
      const athleteResult = await pool.query(
        'SELECT id FROM athletes WHERE user_id = $1',
        [userId]
      );
      if (athleteResult.rows.length > 0) {
        athleteId = athleteResult.rows[0].id;
      }
    }

    res.json({
      userId: clerkId,
      role: row.role,
      squadId: row.squad_id,
      athleteId,
    });
  } catch (err) {
    console.error('Error fetching account:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/account/role — set the user's role (coach, assistant, athlete).
router.patch('/role', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkId } = getAuth(req);
    const userId = await getOrCreateUserId(pool, clerkId);
    const { role } = req.body;

    if (!['coach', 'assistant', 'athlete'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, userId]);
    res.json({ role });
  } catch (err) {
    console.error('Error updating role:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/account/me — delete the logged-in user and all owned data.
router.delete('/me', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkId } = getAuth(req);
    await deleteUserByClerkId(clerkId);
    res.sendStatus(204);
  } catch (err) {
    console.error('Account deletion error:', err.message);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

module.exports = router;
