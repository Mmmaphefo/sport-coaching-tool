import { useParams, Navigate } from 'react-router-dom'
import { SignedIn, SignedOut, SignUpButton, SignInButton, useAuth } from '@clerk/clerk-react'
import { useState, useEffect, useCallback } from 'react'
import Layout from '../components/Layout'
import { apiRequest } from '../lib/api'

function InviteAccept() {
  const { token } = useParams()
  const { getToken, isSignedIn, isLoaded } = useAuth()

  const [status, setStatus] = useState('idle') // idle | accepting | done | error
  const [error, setError] = useState('')

  const acceptInvite = useCallback(async () => {
    setStatus('accepting')
    setError('')
    try {
      await apiRequest(`/api/invites/${token}/accept`, {
        method: 'POST',
        getToken,
      })
      setStatus('done')
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }, [token, getToken])

  useEffect(() => {
    if (isLoaded && isSignedIn && status === 'idle') {
      acceptInvite()
    }
  }, [isLoaded, isSignedIn, status, acceptInvite])

  if (status === 'done') {
    // Everyone lands on the dashboard, players included — it puts the
    // schedule and RSVPs in front of a new athlete straight away.
    return <Navigate to="/dashboard" replace />
  }

  return (
    <Layout>
      <div className="dashboard-header">
        <span className="dashboard-eyebrow">Invite</span>
        <h1>You&apos;ve been invited!</h1>
        <p>Sign up or sign in to join the squad.</p>
      </div>

      <SignedOut>
        <SignUpButton mode="modal">
          <button className="btn btn-gold">Create account</button>
        </SignUpButton>
        <span style={{ margin: '0 1rem' }} />
        <SignInButton mode="modal">
          <button className="btn btn-ghost">Sign in</button>
        </SignInButton>
      </SignedOut>

      <SignedIn>
        {status === 'accepting' && <p>Linking your account…</p>}
        {status === 'error' && (
          <div className="roster-error">
            Couldn&apos;t accept this invite: {error}. It may have already been used or expired.
          </div>
        )}
      </SignedIn>
    </Layout>
  )
}

export default InviteAccept
