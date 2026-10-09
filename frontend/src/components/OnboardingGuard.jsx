// AI assistance: drafted with Claude (Sonnet 5) via claude.ai; reviewed and tested by the project team.
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { apiRequest } from '../lib/api'

// Outer shell: remounts the guard (and thus re-fetches the squad) whenever
// the route changes. Without this key, React preserves the guard instance
// across <Route> swaps — same component type, same tree position — so after
// finishSetup PATCHes onboarded=true and navigates to /dashboard, the guard
// still held the signup-time squad (onboarded=false) and instantly bounced
// the user back to /setup with no request and no visible error: an infinite,
// silent redirect loop that presented as a frozen Finish button. The fetch
// effect only depends on auth state, so it must run inside a remounted
// instance.
function OnboardingGuard({ children }) {
  const location = useLocation()
  return <GuardCheck key={location.pathname}>{children}</GuardCheck>
}

const boxStyle = {
  padding: '2rem',
  textAlign: 'center',
  maxWidth: '32rem',
  margin: '3rem auto',
}

function GuardCheck({ children }) {
  const { getToken, isLoaded, isSignedIn } = useAuth()
  const location = useLocation()
  const [squad, setSquad] = useState(null)
  const [role, setRole] = useState(null)
  const [loading, setLoading] = useState(true)
  const [slow, setSlow] = useState(false)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)

  const retry = useCallback(() => {
    setError(null)
    setLoading(true)
    setAttempt((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return undefined

    let cancelled = false
    // The API sleeps when idle on the free hosting tier; tell the user why
    // the first load is slow instead of showing a bare "Loading...".
    const slowTimer = setTimeout(() => {
      if (!cancelled) setSlow(true)
    }, 4000)

    async function load() {
      try {
        // Role first: only the head coach owns onboarding. Assistants and
        // players must never be sent to /setup (every write there is
        // coach-only and would 403, trapping them).
        const me = await apiRequest('/api/account/me', { getToken })
        if (cancelled) return
        setRole(me?.role || 'coach')

        try {
          const data = await apiRequest('/api/squads/mine', { getToken })
          if (!cancelled) setSquad(data)
        } catch (err) {
          if (cancelled) return
          // 404 means no squad exists yet (new coach) — allow setup to proceed
          if (err.status === 404) {
            setSquad({ onboarded: false })
          } else {
            throw err
          }
        }
      } catch (err) {
        if (!cancelled) setError(err)
      } finally {
        clearTimeout(slowTimer)
        if (!cancelled) {
          setSlow(false)
          setLoading(false)
        }
      }
    }

    load()
    return () => {
      cancelled = true
      clearTimeout(slowTimer)
    }
  }, [isLoaded, isSignedIn, getToken, attempt])

  if (!isLoaded) {
    return <div style={boxStyle}>Loading...</div>
  }

  // Checked before the loading state: a signed-out visitor never triggers the
  // fetch, so waiting on it would leave them on "Loading..." forever.
  if (!isSignedIn) {
    return <Navigate to="/" replace />
  }

  if (loading) {
    return (
      <div style={boxStyle} role="status" aria-live="polite">
        <p>Loading...</p>
        {slow && (
          <p style={{ opacity: 0.75, fontSize: '0.9rem' }}>
            Waking up the server — this can take up to a minute after a quiet period.
          </p>
        )}
      </div>
    )
  }

  if (error) {
    // A non-coach account that hasn't accepted an invite yet.
    const unlinked = error.status === 403
    return (
      <div style={boxStyle} role="alert">
        <h2 style={{ marginBottom: '0.75rem' }}>
          {unlinked ? 'Your account isn’t linked to a squad yet' : 'We couldn’t load your squad'}
        </h2>
        <p style={{ marginBottom: '1.25rem' }}>
          {unlinked
            ? 'Ask your coach for an invite link, then paste it on the role selection page to join their squad.'
            : error.message}
        </p>
        {unlinked ? (
          <Link to="/role-select" className="btn btn-gold">
            Enter invite link
          </Link>
        ) : (
          <button type="button" className="btn btn-gold" onClick={retry}>
            Try again
          </button>
        )}
      </div>
    )
  }

  const onSetupPage = location.pathname === '/setup'
  const isCoach = role === 'coach'
  const needsSetup = isCoach && squad && squad.onboarded === false

  if (needsSetup && !onSetupPage) {
    return <Navigate to="/setup" replace />
  }

  if (!needsSetup && onSetupPage) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}

export default OnboardingGuard
