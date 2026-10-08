import { useState, useEffect } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { apiRequest } from '../lib/api'

// Drop this into your Settings page: <PublicPageToggle />
// Reuses your existing roster-form / roster-error / roster-form-actions
// classes, so it should match the rest of the app with no extra CSS needed.
function PublicPageToggle() {
  const { getToken } = useAuth()
  const [squad, setSquad] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    apiRequest('/api/squads/mine', { getToken }).then(setSquad).catch(() => {})
  }, [getToken])

  async function toggle() {
    if (!squad) return
    setSaving(true)
    setError('')
    try {
      const updated = await apiRequest('/api/squads/mine', {
        method: 'PATCH',
        body: { is_public: !squad.is_public },
        getToken,
      })
      setSquad(updated)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!squad) return null

  const publicUrl = `${window.location.origin}/public/${squad.id}`

  return (
    <div className="roster-form">
      <h3>Public page</h3>
      <p style={{ marginBottom: '1rem', color: 'var(--color-ink-soft)' }}>
        {squad.is_public
          ? 'Anyone with the link can see your roster, recent results, and top performers.'
          : 'Your squad is private — only your team can see its results.'}
      </p>
      {error && <div className="roster-error">{error}</div>}
      <div className="roster-form-actions">
        <button type="button" className="btn btn-gold" onClick={toggle} disabled={saving}>
          {saving ? 'Saving...' : squad.is_public ? 'Make private' : 'Make public'}
        </button>
      </div>
      {squad.is_public && (
        <div className="roster-invite-created" style={{ marginTop: '1rem' }}>
          <p>Your public page:</p>
          <code>{publicUrl}</code>
        </div>
      )}
    </div>
  )
}

export default PublicPageToggle
