import { useState, useEffect, useCallback } from 'react'
import { useAuth, UserProfile } from '@clerk/clerk-react'
import Layout from '../components/Layout'
import Loader from '../components/Loader'
import { apiRequest } from '../lib/api'
import './AccountSettings.css'

function AccountSettings() {
  const { getToken, signOut } = useAuth()
  const [teamName, setTeamName] = useState('')
  const [gender, setGender] = useState('male')
  const [squad, setSquad] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const [publicLinkSaving, setPublicLinkSaving] = useState(false)
  const [publicLinkCopied, setPublicLinkCopied] = useState(false)

  // Squad settings are staff territory — players see only their Clerk
  // profile and the danger zone here.
  const [role, setRole] = useState(null)

  const loadSquad = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiRequest('/api/squads/mine', { getToken })
      setTeamName(data.name || '')
      setGender(data.gender || 'male')
      setSquad(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [getToken])

  useEffect(() => {
    let cancelled = false
    apiRequest('/api/account/me', { getToken })
      .then((me) => {
        if (cancelled) return
        setRole(me.role)
        if (me.role === 'athlete') {
          setLoading(false)
        } else {
          loadSquad()
        }
      })
      .catch(() => {
        // Fall back to the staff view rather than a dead loader.
        if (cancelled) return
        setRole('coach')
        loadSquad()
      })
    return () => {
      cancelled = true
    }
  }, [getToken, loadSquad])

  const isAthlete = role === 'athlete'

  async function handleSubmit(e) {
    e.preventDefault()
    if (!teamName.trim()) {
      setError('Team name is required')
      return
    }

    setSaving(true)
    setError('')
    setSaved(false)

    try {
      await apiRequest('/api/squads/mine', {
        method: 'PATCH',
        body: { name: teamName.trim(), gender },
        getToken,
      })
      setSaved(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleEnablePublicLink() {
    setPublicLinkSaving(true)
    setError('')
    try {
      const updated = await apiRequest('/api/squads/mine', {
        method: 'PATCH',
        body: { is_public: true },
        getToken,
      })
      setSquad(updated)
    } catch (err) {
      setError(err.message)
    } finally {
      setPublicLinkSaving(false)
    }
  }

  async function handleDisablePublicLink() {
    setPublicLinkSaving(true)
    setError('')
    try {
      const updated = await apiRequest('/api/squads/mine', {
        method: 'PATCH',
        body: { is_public: false },
        getToken,
      })
      setSquad(updated)
    } catch (err) {
      setError(err.message)
    } finally {
      setPublicLinkSaving(false)
    }
  }

  function copyPublicLink() {
    const url = `${window.location.origin}/public/link/${squad.public_token}`
    navigator.clipboard?.writeText(url).then(() => {
      setPublicLinkCopied(true)
      setTimeout(() => setPublicLinkCopied(false), 2000)
    })
  }

  async function handleDeleteAccount(e) {
    e.preventDefault()
    if (deleteConfirmText !== 'DELETE') {
      setDeleteError('Please type DELETE to confirm')
      return
    }

    setDeleting(true)
    setDeleteError('')

    try {
      await apiRequest('/api/account/me', { method: 'DELETE', getToken })
      await signOut({ redirectUrl: '/' })
    } catch (err) {
      setDeleteError(err.message)
      setDeleting(false)
    }
  }

  return (
    <Layout>
      <div className="settings-header">
        <span className="dashboard-eyebrow">Account</span>
        <h1>Account settings</h1>
      </div>

      {!isAthlete && (
        <form className="roster-form" onSubmit={handleSubmit}>
          <h3>Team</h3>
          {loading ? (
            <Loader label="Loading team details..." />
          ) : (
            <>
              <div className="roster-form-grid">
                <label className="roster-form-wide">
                  Team name
                  <input
                    type="text"
                    value={teamName}
                    onChange={(e) => { setTeamName(e.target.value); setSaved(false) }}
                    required
                  />
                </label>
                <label className="roster-form-wide">
                  Squad gender
                  <select value={gender} onChange={(e) => { setGender(e.target.value); setSaved(false) }}>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </label>
              </div>
              <div className="roster-form-actions">
                <button type="submit" className="btn btn-gold" disabled={saving}>
                  {saving ? 'Saving...' : 'Save team name'}
                </button>
              </div>
              {saved && <p className="settings-saved">Team name updated.</p>}
            </>
          )}
          {error && <div className="roster-error">{error}</div>}
        </form>
      )}

      {!isAthlete && squad && (
        <div className="dashboard-card" style={{ marginTop: '1.5rem' }}>
          <h3>Public squad page</h3>
          <p>Share a read-only page of your roster, stats, and recent results with anyone — no login required.</p>

          {squad.is_public && squad.public_token ? (
            <>
              <div className="roster-form-grid" style={{ marginTop: '0.75rem' }}>
                <label className="roster-form-wide">
                  Public link
                  <input
                    type="text"
                    readOnly
                    value={`${window.location.origin}/public/link/${squad.public_token}`}
                    onFocus={(e) => e.target.select()}
                  />
                </label>
              </div>
              <div className="roster-form-actions" style={{ marginTop: '0.75rem' }}>
                <button type="button" className="btn btn-ghost" onClick={copyPublicLink}>
                  {publicLinkCopied ? 'Copied!' : 'Copy link'}
                </button>
                <button type="button" className="btn btn-danger" disabled={publicLinkSaving} onClick={handleDisablePublicLink}>
                  {publicLinkSaving ? 'Saving...' : 'Turn off public page'}
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-gold"
              style={{ marginTop: '0.75rem' }}
              disabled={publicLinkSaving}
              onClick={handleEnablePublicLink}
            >
              {publicLinkSaving ? 'Creating link...' : 'Get shareable link'}
            </button>
          )}
        </div>
      )}

      <div className="settings-panel">
        <UserProfile />
      </div>

      <div className="dashboard-card" style={{ marginTop: '1.5rem', borderColor: '#dc2626' }}>
        <h3 style={{ color: '#dc2626' }}>Danger zone</h3>
        <p>Deleting your account will permanently remove your squad, athletes, events, and all data.</p>

        {!showDeleteConfirm ? (
          <button
            type="button"
            className="btn btn-danger"
            style={{ marginTop: '0.75rem' }}
            onClick={() => setShowDeleteConfirm(true)}
          >
            Delete account
          </button>
        ) : (
          <form onSubmit={handleDeleteAccount} style={{ marginTop: '0.75rem' }}>
            <label className="roster-form-wide">
              Type <strong>DELETE</strong> to confirm
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
                required
              />
            </label>
            <div className="roster-form-actions" style={{ marginTop: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); setDeleteError('') }}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-danger" disabled={deleting}>
                {deleting ? 'Deleting...' : 'Permanently delete account'}
              </button>
            </div>
            {deleteError && <div className="roster-error" style={{ marginTop: '0.75rem' }}>{deleteError}</div>}
          </form>
        )}
      </div>
    </Layout>
  )
}

export default AccountSettings