const { Router } = require('express')
const { requireAuth, getAuth } = require('../middleware/auth')
const pool = require('../db')
const { getOwnedSquadId, getOwnedSquadIdForCoach } = require('./_squad')

const router = Router()

// GET /api/tactics — list all tactics for the coach's squad
router.get('/', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req)
    const squadId = await getOwnedSquadId(pool, clerkUserId)
    if (!squadId) return res.status(404).json({ error: 'Squad not found' })

    const result = await pool.query(
      `SELECT * FROM tactics WHERE squad_id = $1 ORDER BY updated_at DESC`,
      [squadId]
    )
    res.json(result.rows)
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message })
    }
    console.error('GET /api/tactics error:', err)
    res.status(500).json({ error: `Failed to load tactics: ${err.message}` })
  }
})

// GET /api/tactics/:id — get a single tactic
router.get('/:id', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req)
    const squadId = await getOwnedSquadId(pool, clerkUserId)
    if (!squadId) return res.status(404).json({ error: 'Squad not found' })

    const result = await pool.query(
      `SELECT * FROM tactics WHERE id = $1 AND squad_id = $2`,
      [req.params.id, squadId]
    )
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tactic not found' })
    res.json(result.rows[0])
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message })
    }
    console.error('GET /api/tactics/:id error:', err)
    res.status(500).json({ error: 'Failed to load tactic' })
  }
})

// POST /api/tactics — create a new tactic (coach only; players keep the
// read-only GET view)
router.post('/', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req)
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId)
    if (!squadId) return res.status(404).json({ error: 'Squad not found' })

    const { name, description, frames } = req.body
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' })
    }

    const result = await pool.query(
      `INSERT INTO tactics (squad_id, name, description, frames)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [squadId, name.trim(), description || null, JSON.stringify(frames || [])]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message })
    }
    console.error('POST /api/tactics error:', err)
    res.status(500).json({ error: `Failed to create tactic: ${err.message}` })
  }
})

// PATCH /api/tactics/:id — update a tactic (coach only)
router.patch('/:id', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req)
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId)
    if (!squadId) return res.status(404).json({ error: 'Squad not found' })

    const { name, description, frames } = req.body

    const result = await pool.query(
      `UPDATE tactics
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           frames = COALESCE($3, frames),
           updated_at = now()
       WHERE id = $4 AND squad_id = $5 RETURNING *`,
      [name, description, frames ? JSON.stringify(frames) : null, req.params.id, squadId]
    )
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tactic not found' })
    res.json(result.rows[0])
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message })
    }
    console.error('PATCH /api/tactics/:id error:', err)
    res.status(500).json({ error: 'Failed to update tactic' })
  }
})

// DELETE /api/tactics/:id — delete a tactic (coach only)
router.delete('/:id', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req)
    const squadId = await getOwnedSquadIdForCoach(pool, clerkUserId)
    if (!squadId) return res.status(404).json({ error: 'Squad not found' })

    const result = await pool.query(
      `DELETE FROM tactics WHERE id = $1 AND squad_id = $2 RETURNING id`,
      [req.params.id, squadId]
    )
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tactic not found' })
    res.status(204).end()
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message })
    }
    console.error('DELETE /api/tactics/:id error:', err)
    res.status(500).json({ error: 'Failed to delete tactic' })
  }
})

module.exports = router
