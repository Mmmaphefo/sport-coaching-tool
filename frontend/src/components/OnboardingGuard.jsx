// AI assistance: drafted with Claude (Sonnet 5) via claude.ai; reviewed and tested by the project team.
import { useEffect, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Navigate, useLocation } from 'react-router-dom'
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

function GuardCheck({ children }) {
  const { getToken, isLoaded, isSignedIn } = useAuth()
  const location = useLocation()
  const [squad, setSquad] = useState(null)
  const [loading, setLoading] = useState(true)
  const [initialLoadDone, setInitialLoadDone] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return

    async function loadSquad() {
      try {
        const data = await apiRequest('/api/squads/mine', { getToken })
        setSquad(data)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
        setInitialLoadDone(true)
      }
    }

    loadSquad()
  }, [isLoaded, isSignedIn, getToken])

  if (!isLoaded || (loading && !initialLoadDone)) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>
  }

  if (!isSignedIn) {
    return <Navigate to="/" replace />
  }

  if (error) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'red' }}>{error}</div>
  }

  const onSetupPage = location.pathname === '/setup'
  const needsSetup = squad && squad.onboarded === false

  if (needsSetup && !onSetupPage) {
    return <Navigate to="/setup" replace />
  }

  if (!needsSetup && onSetupPage) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}

export default OnboardingGuard
