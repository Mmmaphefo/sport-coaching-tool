import { useState } from 'react'
import { apiRequest } from '../lib/api'
import './StatOverrideControl.css'

// Lets a coach directly correct a computed stat (e.g. a goal that was
// logged against the wrong player and can't easily be untangled from the
// event log). Only rendered for coaches, on the full-season view — the
// override is a lifetime correction, not a per-period one.
export default function StatOverrideControl({ athleteId, statKey, override, getToken, onChange }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(override ? String(override.value) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    const value = Number(draft)
    if (!Number.isInteger(value) || value < 0) {
      setError('Enter a whole number, 0 or more')
      return
    }
    setSaving(true)
    setError('')
    try {
      await apiRequest(`/api/athletes/${athleteId}/stats/override`, {
        method: 'PATCH',
        body: { stat_key: statKey, value },
        getToken,
      })
      setEditing(false)
      onChange()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function revert() {
    setSaving(true)
    try {
      await apiRequest(`/api/athletes/${athleteId}/stats/override/${statKey}`, {
        method: 'DELETE',
        getToken,
      })
      onChange()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="stat-override" onClick={(e) => e.stopPropagation()}>
        <input
          type="number"
          min="0"
          className="stat-override-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
        />
        <button type="button" className="stat-override-btn" disabled={saving} onClick={save}>Save</button>
        <button type="button" className="stat-override-btn stat-override-btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
        {error && <span className="stat-override-error">{error}</span>}
      </div>
    )
  }

  return (
    <div className="stat-override">
      {override && (
        <span className="stat-override-badge" title={override.note || 'Manually corrected'}>
          corrected
        </span>
      )}
      <button
        type="button"
        className="stat-override-edit"
        disabled={saving}
        onClick={() => { setDraft(override ? String(override.value) : ''); setEditing(true) }}
      >
        ✎ correct
      </button>
      {override && (
        <button type="button" className="stat-override-edit" disabled={saving} onClick={revert}>
          revert
        </button>
      )}
    </div>
  )
}
