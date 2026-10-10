const { Router } = require('express')
const { requireAuth, getAuth } = require('../middleware/auth')
const pool = require('../db')
const { getOwnedSquadId, getOwnedSquadIdForStaff } = require('./_squad')

const router = Router()

// GET /api/sessions — list drills for the coach's squad, with optional filters
router.get('/', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req)
    const squadId = await getOwnedSquadId(pool, clerkUserId)
    if (!squadId) return res.status(404).json({ error: 'Squad not found' })

    const conditions = ['squad_id = $1']
    const params = [squadId]
    let idx = 2

    if (req.query.tactical_goal) {
      conditions.push(`tactical_goal = $${idx++}`)
      params.push(req.query.tactical_goal)
    }
    if (req.query.age_group) {
      conditions.push(`age_group = $${idx++}`)
      params.push(req.query.age_group)
    }
    if (req.query.max_duration) {
      conditions.push(`duration_minutes <= $${idx++}`)
      params.push(Number(req.query.max_duration))
    }
    if (req.query.phase) {
      conditions.push(`phase = $${idx++}`)
      params.push(req.query.phase)
    }

    const result = await pool.query(
      `SELECT * FROM drills WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC`,
      params
    )
    res.json(result.rows)
  } catch (err) {
    console.error('GET /api/sessions error:', err)
    res.status(500).json({ error: 'Failed to load drills' })
  }
})

// POST /api/sessions — create a new drill (staff only; players keep the
// read-only GET view)
router.post('/', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req)
    const squadId = await getOwnedSquadIdForStaff(pool, clerkUserId)
    if (!squadId) return res.status(404).json({ error: 'Squad not found' })

    const { name, description, tactical_goal, age_group, duration_minutes, equipment, instructions, phase } = req.body
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' })
    }
    if (!tactical_goal) {
      return res.status(400).json({ error: 'Tactical goal is required' })
    }

    const result = await pool.query(
      `INSERT INTO drills (squad_id, name, description, tactical_goal, age_group, duration_minutes, equipment, instructions, phase)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [squadId, name.trim(), description || null, tactical_goal, age_group || 'First Team', duration_minutes || null, equipment || null, instructions || null, phase || 'Main Activity']
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message })
    }
    console.error('POST /api/sessions error:', err)
    res.status(500).json({ error: 'Failed to create drill' })
  }
})

// PATCH /api/sessions/:id — update a drill (staff only)
router.patch('/:id', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req)
    const squadId = await getOwnedSquadIdForStaff(pool, clerkUserId)
    if (!squadId) return res.status(404).json({ error: 'Squad not found' })

    const { name, description, tactical_goal, age_group, duration_minutes, equipment, instructions, phase } = req.body

    const result = await pool.query(
      `UPDATE drills
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           tactical_goal = COALESCE($3, tactical_goal),
           age_group = COALESCE($4, age_group),
           duration_minutes = COALESCE($5, duration_minutes),
           equipment = COALESCE($6, equipment),
           instructions = COALESCE($7, instructions),
           phase = COALESCE($8, phase),
           updated_at = now()
       WHERE id = $9 AND squad_id = $10 RETURNING *`,
      [name, description, tactical_goal, age_group, duration_minutes, equipment, instructions, phase, req.params.id, squadId]
    )
    if (result.rows.length === 0) return res.status(404).json({ error: 'Drill not found' })
    res.json(result.rows[0])
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message })
    }
    console.error('PATCH /api/sessions/:id error:', err)
    res.status(500).json({ error: 'Failed to update drill' })
  }
})

// DELETE /api/sessions/:id — delete a drill (staff only)
router.delete('/:id', requireAuth(), async (req, res) => {
  try {
    const { userId: clerkUserId } = getAuth(req)
    const squadId = await getOwnedSquadIdForStaff(pool, clerkUserId)
    if (!squadId) return res.status(404).json({ error: 'Squad not found' })

    const result = await pool.query(
      `DELETE FROM drills WHERE id = $1 AND squad_id = $2 RETURNING id`,
      [req.params.id, squadId]
    )
    if (result.rows.length === 0) return res.status(404).json({ error: 'Drill not found' })
    res.status(204).end()
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message })
    }
    console.error('DELETE /api/sessions/:id error:', err)
    res.status(500).json({ error: 'Failed to delete drill' })
  }
})

module.exports = router
