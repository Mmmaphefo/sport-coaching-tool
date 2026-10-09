// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const authState = { isLoaded: true, isSignedIn: true, getToken: vi.fn(), signOut: vi.fn() }
vi.mock('@clerk/clerk-react', () => ({ useAuth: () => authState }))

const apiRequest = vi.fn()
vi.mock('../lib/api', () => ({ apiRequest: (...args) => apiRequest(...args) }))

import OnboardingGuard from './OnboardingGuard'

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div>HOME</div>} />
        <Route path="/role-select" element={<div>ROLE SELECT</div>} />
        <Route path="/setup" element={<OnboardingGuard><div>SETUP PAGE</div></OnboardingGuard>} />
        <Route path="/dashboard" element={<OnboardingGuard><div>DASHBOARD PAGE</div></OnboardingGuard>} />
      </Routes>
    </MemoryRouter>
  )
}

function mockApi({ role = 'coach', squad = { onboarded: true }, squadError } = {}) {
  apiRequest.mockImplementation(async (path) => {
    if (path === '/api/account/me') return { role }
    if (path === '/api/squads/mine') {
      if (squadError) throw squadError
      return squad
    }
    throw new Error(`unexpected ${path}`)
  })
}

describe('OnboardingGuard', () => {
  beforeEach(() => {
    apiRequest.mockReset()
    authState.isLoaded = true
    authState.isSignedIn = true
  })

  it('redirects a signed-out visitor home instead of hanging on Loading', async () => {
    authState.isSignedIn = false
    renderAt('/setup')
    expect(await screen.findByText('HOME')).toBeInTheDocument()
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it('sends a coach who has not onboarded to /setup', async () => {
    mockApi({ squad: { onboarded: false } })
    renderAt('/dashboard')
    expect(await screen.findByText('SETUP PAGE')).toBeInTheDocument()
  })

  it('never traps an assistant on /setup when the coach has not finished onboarding', async () => {
    mockApi({ role: 'assistant', squad: { onboarded: false } })
    renderAt('/setup')
    expect(await screen.findByText('DASHBOARD PAGE')).toBeInTheDocument()
  })

  it('offers the invite flow to an account not linked to a squad', async () => {
    mockApi({ role: 'athlete', squadError: Object.assign(new Error('nope'), { status: 403 }) })
    renderAt('/dashboard')
    expect(await screen.findByText(/isn.t linked to a squad yet/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Enter invite link' })).toHaveAttribute('href', '/role-select')
  })

  it('shows a retry button when the server cannot be reached, and recovers', async () => {
    let fail = true
    apiRequest.mockImplementation(async (path) => {
      if (fail) throw Object.assign(new Error('Could not reach the server.'), { status: 0 })
      return path === '/api/account/me' ? { role: 'coach' } : { onboarded: true }
    })
    renderAt('/dashboard')
    const button = await screen.findByRole('button', { name: 'Try again' })
    fail = false
    fireEvent.click(button)
    expect(await screen.findByText('DASHBOARD PAGE')).toBeInTheDocument()
  })

  it('offers a clean sign-in when the server keeps rejecting the session', async () => {
    apiRequest.mockRejectedValue(Object.assign(new Error('You are not signed in.'), { status: 401 }))
    renderAt('/dashboard')
    const button = await screen.findByRole('button', { name: 'Sign in again' })
    fireEvent.click(button)
    expect(authState.signOut).toHaveBeenCalledWith({ redirectUrl: '/sign-in' })
  })
})
