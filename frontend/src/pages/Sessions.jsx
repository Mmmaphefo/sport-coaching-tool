import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@clerk/clerk-react'
import Layout from '../components/Layout'
import { apiRequest } from '../lib/api'
import Loader from '../components/Loader'
import './Sessions.css'

const TACTICAL_GOALS = ['Attacking', 'Defending', 'Set Pieces', 'Transition', 'Possession', 'Ball Mastery']
const AGE_GROUPS = ['First Team', 'U15', 'U17', 'U20']
const PHASES = ['Warm-up', 'Main Activity', 'Cool-down']
const DURATION_OPTIONS = [
  { label: 'Any', value: '' },
  { label: '15 min', value: '15' },
  { label: '30 min', value: '30' },
  { label: '45 min', value: '45' },
  { label: '60 min', value: '60' },
  { label: '90 min', value: '90' },
]

const goalColor = (goal) => {
  const map = {
    Attacking: '#2563eb',
    Defending: '#dc2626',
    'Set Pieces': '#7c3aed',
    Transition: '#ea580c',
    Possession: '#059669',
    'Ball Mastery': '#ca8a04',
  }
  return map[goal] || '#6b7280'
}

const phaseColor = (phase) => {
  const map = {
    'Warm-up': '#059669',
    'Main Activity': '#2563eb',
    'Cool-down': '#7c3aed',
  }
  return map[phase] || '#6b7280'
}

const emptyDrillForm = {
  name: '',
  description: '',
  tactical_goal: 'Attacking',
  age_group: 'First Team',
  duration_minutes: '',
  equipment: '',
  instructions: '',
  phase: 'Main Activity',
}

function Sessions() {
  const { getToken } = useAuth()

  const [drills, setDrills] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [role, setRole] = useState(null)

  // Filters
  const [filterGoal, setFilterGoal] = useState('')
  const [filterAge, setFilterAge] = useState('')
  const [filterDuration, setFilterDuration] = useState('')
  const [filterPhase, setFilterPhase] = useState('')

  // Session builder
  const [sessionPlan, setSessionPlan] = useState([])
  const [builderOpen, setBuilderOpen] = useState(false)

  // Form
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(emptyDrillForm)
  const [editingId, setEditingId] = useState(null)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  // Generate session
  const [generateOpen, setGenerateOpen] = useState(false)
  const [genGoal, setGenGoal] = useState('Attacking')
  const [genAge, setGenAge] = useState('First Team')
  const [genDuration, setGenDuration] = useState('60')
  const [genError, setGenError] = useState('')

  const isAthlete = role === 'athlete'

  const loadDrills = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (filterGoal) params.set('tactical_goal', filterGoal)
      if (filterAge) params.set('age_group', filterAge)
      if (filterDuration) params.set('max_duration', filterDuration)
      if (filterPhase) params.set('phase', filterPhase)
      const qs = params.toString()
      const data = await apiRequest(`/api/sessions${qs ? `?${qs}` : ''}`, { getToken })
      setDrills(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [getToken, filterGoal, filterAge, filterDuration, filterPhase])

  useEffect(() => {
    apiRequest('/api/account/me', { getToken })
      .then((me) => setRole(me.role))
      .catch(() => {})
  }, [getToken])

  useEffect(() => {
    loadDrills()
    apiRequest('/api/account/me', { getToken })
      .then((me) => setRole(me.role))
      .catch(() => {})
  }, [getToken])

  useEffect(() => {
    loadDrills()
  }, [loadDrills])

  function openCreate() {
    setForm(emptyDrillForm)
    setEditingId(null)
    setFormError('')
    setFormOpen(true)
  }

  function openEdit(drill) {
    setForm({
      name: drill.name,
      description: drill.description || '',
      tactical_goal: drill.tactical_goal,
      age_group: drill.age_group,
      duration_minutes: drill.duration_minutes || '',
      equipment: drill.equipment || '',
      instructions: drill.instructions || '',
      phase: drill.phase || 'Main Activity',
    })
    setEditingId(drill.id)
    setFormError('')
    setFormOpen(true)
  }

  async function saveDrill() {
    if (!form.name.trim() || !form.tactical_goal || saving) return
    setFormError('')
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        tactical_goal: form.tactical_goal,
        age_group: form.age_group,
        duration_minutes: form.duration_minutes ? Number(form.duration_minutes) : null,
        equipment: form.equipment.trim() || null,
        instructions: form.instructions.trim() || null,
        phase: form.phase,
      }
      if (editingId) {
        await apiRequest(`/api/sessions/${editingId}`, { getToken, method: 'PATCH', body: payload })
      } else {
        await apiRequest('/api/sessions', { getToken, method: 'POST', body: payload })
      }
      setFormOpen(false)
      await loadDrills()
    } catch (err) {
      setFormError(err.message || 'Failed to save drill.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteDrill(id) {
    if (!window.confirm('Delete this drill?')) return
    try {
      await apiRequest(`/api/sessions/${id}`, { getToken, method: 'DELETE' })
      setSessionPlan((prev) => prev.filter((d) => d.id !== id))
      await loadDrills()
    } catch (err) {
      console.error('Failed to delete drill:', err)
    }
  }

  function generateSession() {
    setGenError('')
    const totalMin = Number(genDuration)
    if (!totalMin || totalMin < 15) {
      setGenError('Session must be at least 15 minutes.')
      return
    }

    // Filter drills by goal and age (ignore phase/duration filters for generation)
    const pool = drills.filter((d) => {
      const goalMatch = !genGoal || d.tactical_goal === genGoal
      const ageMatch = !genAge || d.age_group === genAge
      return goalMatch && ageMatch
    })

    // If no exact goal/age match, fall back to any drill for that age, then any drill
    const fallback1 = drills.filter((d) => (!genAge || d.age_group === genAge))
    const fallback2 = drills

    const pick = (phase, minDur, maxDur, candidates) => {
      const list = candidates.filter((d) => d.phase === phase && d.duration_minutes >= minDur && d.duration_minutes <= maxDur)
      if (list.length > 0) return list[Math.floor(Math.random() * list.length)]
      return null
    }

    const warmupMax = Math.min(15, Math.floor(totalMin * 0.2))
    const cooldownMax = Math.min(10, Math.floor(totalMin * 0.15))
    const mainTarget = totalMin - warmupMax - cooldownMax

    const warmup = pick('Warm-up', 5, warmupMax, pool) || pick('Warm-up', 5, 20, fallback1) || pick('Warm-up', 5, 20, fallback2)
    const cooldown = pick('Cool-down', 5, cooldownMax, pool) || pick('Cool-down', 5, 15, fallback1) || pick('Cool-down', 5, 15, fallback2)

    // Pick 1-2 main activity drills that fit the remaining time
    const mainCandidates = pool.filter((d) => d.phase === 'Main Activity')
    const mainFallback = fallback1.filter((d) => d.phase === 'Main Activity').length > 0 ? fallback1.filter((d) => d.phase === 'Main Activity') : fallback2.filter((d) => d.phase === 'Main Activity')
    const mainList = mainCandidates.length > 0 ? mainCandidates : mainFallback

    const mains = []
    let remaining = mainTarget
    // Try to pick 2 drills that fit
    const shuffled = [...mainList].sort(() => Math.random() - 0.5)
    for (const d of shuffled) {
      if (d.duration_minutes && d.duration_minutes <= remaining && mains.length < 2) {
        mains.push(d)
        remaining -= d.duration_minutes
      }
    }
    // If no mains found, pick any main activity drill
    if (mains.length === 0 && mainList.length > 0) {
      mains.push(mainList[Math.floor(Math.random() * mainList.length)])
    }

    const plan = [warmup, ...mains, cooldown].filter(Boolean)
    if (plan.length === 0) {
      setGenError('No drills available for these filters. Try different options or add more drills.')
      return
    }

    setSessionPlan(plan)
    setBuilderOpen(true)
    setGenerateOpen(false)
  }

  function addToSession(drill) {
    if (sessionPlan.find((d) => d.id === drill.id)) return
    setSessionPlan((prev) => [...prev, drill])
    setBuilderOpen(true)
  }

  function removeFromSession(id) {
    setSessionPlan((prev) => prev.filter((d) => d.id !== id))
  }

  function moveDrillInSession(id, direction) {
    setSessionPlan((prev) => {
      const idx = prev.findIndex((d) => d.id === id)
      if (idx === -1) return prev
      const newIdx = idx + direction
      if (newIdx < 0 || newIdx >= prev.length) return prev
      const next = [...prev]
      ;[next[idx], next[newIdx]] = [next[newIdx], next[idx]]
      return next
    })
  }

  const totalDuration = sessionPlan.reduce((sum, d) => sum + (d.duration_minutes || 0), 0)

  const drillsByPhase = PHASES.reduce((acc, phase) => {
    acc[phase] = drills.filter((d) => d.phase === phase)
    return acc
  }, {})

  const planByPhase = PHASES.reduce((acc, phase) => {
    acc[phase] = sessionPlan.filter((d) => d.phase === phase)
    return acc
  }, {})

  return (
    <Layout>
      <div className="sessions-page">
        <div className="sessions-head">
          <div>
            <div className="sessions-eyebrow">Session Generator</div>
            <h1 className="sessions-title">Drill Library</h1>
          </div>
          {!isAthlete && (
            <div className="sessions-head-actions">
              <button className="sessions-gen-btn" onClick={() => setGenerateOpen(true)}>Generate Session</button>
              <button
                className={`sessions-builder-toggle ${builderOpen ? 'sessions-builder-toggle-active' : ''}`}
                onClick={() => setBuilderOpen(!builderOpen)}
              >
                Session Plan ({sessionPlan.length})
              </button>
              <button className="sessions-add-btn" onClick={openCreate}>+ Add Drill</button>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="sessions-filters">
          <div className="sessions-filter-group">
            <label>Tactical Goal</label>
            <select value={filterGoal} onChange={(e) => setFilterGoal(e.target.value)}>
              <option value="">All</option>
              {TACTICAL_GOALS.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
          <div className="sessions-filter-group">
            <label>Age Group</label>
            <select value={filterAge} onChange={(e) => setFilterAge(e.target.value)}>
              <option value="">All</option>
              {AGE_GROUPS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          <div className="sessions-filter-group">
            <label>Phase</label>
            <select value={filterPhase} onChange={(e) => setFilterPhase(e.target.value)}>
              <option value="">All</option>
              {PHASES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="sessions-filter-group">
            <label>Max Duration</label>
            <select value={filterDuration} onChange={(e) => setFilterDuration(e.target.value)}>
              {DURATION_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>
        </div>

        {error && <div className="sessions-error">{error}</div>}

        <div className={`sessions-body ${builderOpen ? 'sessions-body-with-plan' : ''}`}>
          {/* Drill library */}
          <div className="sessions-library">
            {loading ? (
              <Loader label="Loading drills..." />
            ) : drills.length === 0 ? (
              <div className="sessions-empty">
                <p>No drills match your filters.</p>
                <button className="sessions-add-btn" onClick={openCreate}>+ Add Drill</button>
              </div>
            ) : (
              PHASES.map((phase) => {
                const phaseDrills = drillsByPhase[phase]
                if (phaseDrills.length === 0) return null
                return (
                  <div key={phase} className="sessions-phase-section">
                    <h2 className="sessions-phase-title" style={{ color: phaseColor(phase) }}>
                      {phase}
                      <span className="sessions-phase-count">{phaseDrills.length}</span>
                    </h2>
                    <div className="sessions-grid">
                      {phaseDrills.map((d) => {
                        const inPlan = sessionPlan.find((p) => p.id === d.id)
                        return (
                          <div key={d.id} className={`sessions-card ${inPlan ? 'sessions-card-in-plan' : ''}`}>
                            <div className="sessions-card-header">
                              <span
                                className="sessions-goal-badge"
                                style={{ backgroundColor: goalColor(d.tactical_goal) + '18', color: goalColor(d.tactical_goal), borderColor: goalColor(d.tactical_goal) + '40' }}
                              >
                                {d.tactical_goal}
                              </span>
                              {d.duration_minutes && (
                                <span className="sessions-duration">{d.duration_minutes} min</span>
                              )}
                            </div>
                            <h3 className="sessions-card-name">{d.name}</h3>
                            {d.description && <p className="sessions-card-desc">{d.description}</p>}
                            {d.equipment && (
                              <div className="sessions-card-equipment">
                                <strong>Equipment:</strong> {d.equipment}
                              </div>
                            )}
                            {d.instructions && (
                              <div className="sessions-card-instructions">
                                <strong>Instructions:</strong> {d.instructions}
                              </div>
                            )}
                            <div className="sessions-card-footer">
                              <span className="sessions-card-age">{d.age_group}</span>
                              <div className="sessions-card-actions">
                                {inPlan ? (
                                  <span className="sessions-card-added">Added</span>
                                ) : (
                                  <button className="sessions-card-btn sessions-card-btn-add" onClick={() => addToSession(d)}>+ Session</button>
                                )}
                                <button className="sessions-card-btn" onClick={() => openEdit(d)}>Edit</button>
                                <button className="sessions-card-btn sessions-card-btn-del" onClick={() => deleteDrill(d.id)}>Delete</button>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Session builder panel */}
          {builderOpen && (
            <aside className="sessions-plan-panel">
              <div className="sessions-plan-header">
                <h2>Session Plan</h2>
                <span className="sessions-plan-total">{totalDuration} min total</span>
              </div>

              {sessionPlan.length === 0 ? (
                <div className="sessions-plan-empty">
                  <p>Click <strong>+ Session</strong> on any drill to build your session plan.</p>
                </div>
              ) : (
                <div className="sessions-plan-list">
                  {PHASES.map((phase) => {
                    const phaseDrills = planByPhase[phase]
                    if (phaseDrills.length === 0) return null
                    return (
                      <div key={phase} className="sessions-plan-phase">
                        <div className="sessions-plan-phase-label" style={{ borderColor: phaseColor(phase) }}>
                          {phase}
                        </div>
                        {phaseDrills.map((d) => {
                          const phaseStartIdx = sessionPlan.findIndex((p) => p.phase === phase)
                          const firstInPhase = sessionPlan.indexOf(d) === phaseStartIdx
                          const lastInPhase = phaseDrills[phaseDrills.length - 1].id === d.id
                          return (
                            <div key={d.id} className="sessions-plan-item">
                              <div className="sessions-plan-item-info">
                                <span className="sessions-plan-item-name">{d.name}</span>
                                {d.duration_minutes && <span className="sessions-plan-item-dur">{d.duration_minutes}m</span>}
                              </div>
                              <div className="sessions-plan-item-actions">
                                <button
                                  className="sessions-plan-move"
                                  onClick={() => moveDrillInSession(d.id, -1)}
                                  disabled={firstInPhase}
                                  title="Move up"
                                >
                                  &uarr;
                                </button>
                                <button
                                  className="sessions-plan-move"
                                  onClick={() => moveDrillInSession(d.id, 1)}
                                  disabled={lastInPhase}
                                  title="Move down"
                                >
                                  &darr;
                                </button>
                                <button
                                  className="sessions-plan-remove"
                                  onClick={() => removeFromSession(d.id)}
                                  title="Remove"
                                >
                                  &times;
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              )}

              <button className="sessions-clear-plan" onClick={() => setSessionPlan([])} disabled={sessionPlan.length === 0}>
                Clear Plan
              </button>
            </aside>
          )}
        </div>

        {/* Drill form modal */}
        {formOpen && (
          <div className="sessions-modal-backdrop" onClick={() => setFormOpen(false)}>
            <div className="sessions-modal" onClick={(e) => e.stopPropagation()}>
              <div className="sessions-modal-header">
                <h2>{editingId ? 'Edit Drill' : 'New Drill'}</h2>
                <button className="sessions-modal-close" onClick={() => setFormOpen(false)}>&times;</button>
              </div>

              {formError && <div className="sessions-form-error">{formError}</div>}

              <div className="sessions-form-body">
                <label className="sessions-field">
                  <span>Name *</span>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Rondo 4v2"
                  />
                </label>

                <label className="sessions-field">
                  <span>Phase *</span>
                  <select value={form.phase} onChange={(e) => setForm({ ...form, phase: e.target.value })}>
                    {PHASES.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </label>

                <label className="sessions-field">
                  <span>Tactical Goal *</span>
                  <select value={form.tactical_goal} onChange={(e) => setForm({ ...form, tactical_goal: e.target.value })}>
                    {TACTICAL_GOALS.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </label>

                <label className="sessions-field">
                  <span>Age Group</span>
                  <select value={form.age_group} onChange={(e) => setForm({ ...form, age_group: e.target.value })}>
                    {AGE_GROUPS.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </label>

                <label className="sessions-field">
                  <span>Duration (minutes)</span>
                  <input
                    type="number"
                    min="1"
                    value={form.duration_minutes}
                    onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })}
                    placeholder="30"
                  />
                </label>

                <label className="sessions-field">
                  <span>Equipment</span>
                  <input
                    type="text"
                    value={form.equipment}
                    onChange={(e) => setForm({ ...form, equipment: e.target.value })}
                    placeholder="Cones, bibs, balls"
                  />
                </label>

                <label className="sessions-field sessions-field-full">
                  <span>Description</span>
                  <textarea
                    rows="2"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Brief summary"
                  />
                </label>

                <label className="sessions-field sessions-field-full">
                  <span>Instructions</span>
                  <textarea
                    rows="4"
                    value={form.instructions}
                    onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                    placeholder="Step-by-step instructions"
                  />
                </label>
              </div>

              <div className="sessions-modal-footer">
                <button className="sessions-cancel-btn" onClick={() => setFormOpen(false)}>Cancel</button>
                <button className="sessions-save-btn" onClick={saveDrill} disabled={saving}>
                  {saving ? 'Saving...' : (editingId ? 'Update' : 'Create')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Generate Session modal */}
        {generateOpen && (
          <div className="sessions-modal-backdrop" onClick={() => setGenerateOpen(false)}>
            <div className="sessions-modal sessions-modal-sm" onClick={(e) => e.stopPropagation()}>
              <div className="sessions-modal-header">
                <h2>Generate Session</h2>
                <button className="sessions-modal-close" onClick={() => setGenerateOpen(false)}>&times;</button>
              </div>

              {genError && <div className="sessions-form-error">{genError}</div>}

              <div className="sessions-gen-body">
                <p className="sessions-gen-desc">
                  Auto-pick drills for a complete session: warm-up, main activity, and cool-down.
                </p>

                <label className="sessions-field">
                  <span>Tactical Goal</span>
                  <select value={genGoal} onChange={(e) => setGenGoal(e.target.value)}>
                    {TACTICAL_GOALS.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </label>

                <label className="sessions-field">
                  <span>Age Group</span>
                  <select value={genAge} onChange={(e) => setGenAge(e.target.value)}>
                    {AGE_GROUPS.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </label>

                <label className="sessions-field sessions-field-full">
                  <span>Total Duration (minutes)</span>
                  <select value={genDuration} onChange={(e) => setGenDuration(e.target.value)}>
                    {[30, 45, 60, 75, 90].map((m) => (
                      <option key={m} value={String(m)}>{m} min</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="sessions-modal-footer">
                <button className="sessions-cancel-btn" onClick={() => setGenerateOpen(false)}>Cancel</button>
                <button className="sessions-save-btn" onClick={generateSession}>Generate</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}

export default Sessions
