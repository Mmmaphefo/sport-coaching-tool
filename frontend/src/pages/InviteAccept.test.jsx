// AI assistance: drafted with Qoder (AI coding assistant); reviewed and tested by the project team.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import InviteAccept from './InviteAccept'

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  getToken: vi.fn(),
  signedIn: false,
}))

vi.mock('../lib/api', () => ({
  apiRequest: mocks.apiRequest,
}))

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({
    getToken: mocks.getToken,
    isSignedIn: mocks.signedIn,
    isLoaded: true,
  }),
  SignedIn: ({ children }) => (mocks.signedIn ? children : null),
  SignedOut: ({ children }) => (mocks.signedIn ? null : children),
  SignInButton: ({ children, forceRedirectUrl }) => (
    <span data-testid="sign-in-button" data-redirect={forceRedirectUrl}>{children}</span>
  ),
  SignUpButton: ({ children, forceRedirectUrl }) => (
    <span data-testid="sign-up-button" data-redirect={forceRedirectUrl}>{children}</span>
  ),
}))

vi.mock('../components/Layout', () => ({
  default: ({ children }) => <div>{children}</div>,
}))

function renderInvite(token = 'abc123') {
  return render(
    <MemoryRouter initialEntries={[`/invite/${token}`]}>
      <Routes>
        <Route path="/invite/:token" element={<InviteAccept />} />
        <Route path="/dashboard" element={<p>Dashboard page</p>} />
        <Route path="/roster/:athleteId" element={<p>Roster athlete page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('InviteAccept', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset()
    mocks.getToken.mockResolvedValue('test-token')
    mocks.signedIn = false
  })

  it('shows the invite prompt with sign-up actions for signed-out visitors', () => {
    renderInvite()

    expect(screen.getByRole('heading', { name: /You've been invited/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create account/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Sign in$/i })).toBeInTheDocument()
    expect(mocks.apiRequest).not.toHaveBeenCalled()
  })

  it('accepts the invite and navigates to the dashboard for assistants', async () => {
    mocks.signedIn = true
    mocks.apiRequest.mockResolvedValue({ role: 'assistant' })

    renderInvite()

    await waitFor(() => {
      expect(mocks.apiRequest).toHaveBeenCalledWith('/api/invites/abc123/accept', {
        method: 'POST',
        getToken: mocks.getToken,
      })
    })

    expect(await screen.findByText('Dashboard page')).toBeInTheDocument()
  })

  it('accepts the invite and navigates to the dashboard for athletes', async () => {
    mocks.signedIn = true
    mocks.apiRequest.mockResolvedValue({ role: 'athlete', athleteId: 7 })

    renderInvite()

    await waitFor(() => {
      expect(mocks.apiRequest).toHaveBeenCalledWith('/api/invites/abc123/accept', {
        method: 'POST',
        getToken: mocks.getToken,
      })
    })

    // Players land on the dashboard with their schedule and RSVPs, not on
    // their own profile page.
    expect(await screen.findByText('Dashboard page')).toBeInTheDocument()
    expect(screen.queryByText('Roster athlete page')).not.toBeInTheDocument()
  })

  it('shows an error when the invite cannot be accepted', async () => {
    mocks.signedIn = true
    mocks.apiRequest.mockRejectedValue(new Error('Invite expired'))

    renderInvite()

    expect(
      await screen.findByText(/Couldn't accept this invite: Invite expired/i)
    ).toBeInTheDocument()
    expect(screen.queryByText('Dashboard page')).not.toBeInTheDocument()
  })

  it('returns the user to this invite after signing up or in, so it gets accepted', () => {
    mocks.signedIn = false
    renderInvite('tok_42')

    expect(screen.getByTestId('sign-up-button')).toHaveAttribute('data-redirect', '/invite/tok_42')
    expect(screen.getByTestId('sign-in-button')).toHaveAttribute('data-redirect', '/invite/tok_42')
  })
})
