import { useEffect, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'
import { apiRequest } from '../lib/api'
import './RoleSelect.css'

function RoleSelect() {
  const { getToken, isSignedIn } = useAuth()
  const navigate = useNavigate()
  const [selected, setSelected] = useState(null)
  const [saving, setSaving] = useState(false)
  const [inviteLink, setInviteLink] = useState('')

  // If user already has a role set, skip to dashboard.
  // This check runs in the background with a timeout so the page stays interactive
  // even if the backend is asleep or Clerk's getToken hangs (Safari).
  useEffect(() => {
    if (!isSignedIn) {
      return
    }
    
    let cancelled = false
    
    async function checkRole() {
      try {
        const tokenPromise = getToken()
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 8000)
        )
        const token = await Promise.race([tokenPromise, timeoutPromise])
        if (cancelled) return
        
        const me = await apiRequest('/api/account/me', { getToken: () => Promise.resolve(token) })
        if (cancelled) return
        if (me.role && me.role !== 'coach') {
          navigate('/dashboard', { replace: true })
        }
      } catch {
        // Ignore errors/timeout, let user choose
      }
    }
    checkRole()
    
    return () => { cancelled = true }
  }, [isSignedIn, getToken, navigate])

  async function handleSelect(role) {
    setSelected(role)
    
    if (role === 'player') {
      // Stay on page to show invite link input
      return
    }
    
    setSaving(true)
    
    // Navigate immediately so the UI never freezes waiting for the backend.
    // The role PATCH runs in the background for coach/player; browsing skips it entirely.
    const savePromise = (isSignedIn && role !== 'browser')
      ? apiRequest('/api/account/role', {
          method: 'PATCH',
          body: { role },
          getToken,
        }).catch((err) => {
          console.error('Failed to set role:', err)
        })
      : Promise.resolve()
    
    if (role === 'coach') {
      if (isSignedIn) {
        navigate('/setup', { replace: true })
      } else {
        navigate('/sign-up?role=coach', { replace: true })
      }
    } else if (role === 'browser') {
      navigate('/public', { replace: true })
    }
    
    await savePromise
    setSaving(false)
  }

  async function handleInviteSubmit(e) {
    e.preventDefault()
    if (!inviteLink.trim()) return
    
    setSaving(true)
    try {
      // Extract token from invite link
      const tokenMatch = inviteLink.match(/\/invite\/([a-zA-Z0-9_-]+)/)
      if (tokenMatch) {
        navigate(`/invite/${tokenMatch[1]}`, { replace: true })
      } else {
        // If no token found, go to sign up as player
        navigate('/sign-up?role=player', { replace: true })
      }
    } catch (err) {
      console.error('Failed to process invite:', err)
      setSaving(false)
    }
  }

  return (
    <div className="role-select">
      <div className="role-select-overlay" />
      <div className="role-select-vignette" />

      <button className="role-select-back" onClick={() => navigate('/')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M19 12H5" />
          <path d="m12 19-7-7 7-7" />
        </svg>
        Back
      </button>

      <main className="role-select-content">
        <p className="role-select-eyebrow">WELCOME TO KICKSTAT</p>
        <h1 className="role-select-title">HOW WILL YOU USE KICKSTAT?</h1>
        <p className="role-select-subtitle">
          Choose your role to get started. You can always change this later.
        </p>

        <div className="role-select-cards">
          <button
            className={`role-card ${selected === 'coach' ? 'role-card-selected' : ''}`}
            onClick={() => handleSelect('coach')}
            disabled={saving}
          >
            <div className="role-card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <h3>I'M A COACH</h3>
            <p>Create a squad, manage your roster, and plan your season.</p>
          </button>

          <button
            className={`role-card ${selected === 'player' ? 'role-card-selected' : ''}`}
            onClick={() => handleSelect('player')}
            disabled={saving}
          >
            <div className="role-card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <h3>I'M A PLAYER OR ASSISTANT</h3>
            <p>Join a squad using an invite link from your coach.</p>
          </button>

          <button
            className={`role-card ${selected === 'browser' ? 'role-card-selected' : ''}`}
            onClick={() => handleSelect('browser')}
            disabled={saving}
          >
            <div className="role-card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </div>
            <h3>JUST BROWSING</h3>
            <p>Explore public squads and live matches without an account.</p>
          </button>
        </div>

        {selected === 'player' && (
          <form className="invite-link-form" onSubmit={handleInviteSubmit}>
            <input
              type="text"
              value={inviteLink}
              onChange={(e) => setInviteLink(e.target.value)}
              placeholder="Paste your invite link here"
              className="invite-link-input"
              required
            />
            <button type="submit" className="btn btn-gold" disabled={saving}>
              {saving ? 'Joining...' : 'Join Squad'}
            </button>
          </form>
        )}
      </main>
    </div>
  )
}

export default RoleSelect
