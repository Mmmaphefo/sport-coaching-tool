// AI assistance: drafted with Qoder (AI coding assistant); reviewed and tested by the project team.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Welcome from './Welcome'

const clerkState = vi.hoisted(() => ({ signedIn: false }))

vi.mock('@clerk/clerk-react', () => ({
  SignedIn: ({ children }) => (clerkState.signedIn ? children : null),
  SignedOut: ({ children }) => (clerkState.signedIn ? null : children),
}))

describe('Welcome', () => {
  beforeEach(() => {
    clerkState.signedIn = false
  })

  it('shows the landing page with sign-up and sign-in actions for signed-out visitors', () => {
    render(
      <MemoryRouter>
        <Welcome />
      </MemoryRouter>
    )

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/OWN EVERY/)
    expect(screen.getByText(/MOMENT\./i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Get Started/i })).toHaveAttribute('href', '/role-select')
    expect(screen.getByRole('link', { name: /Sign In/i })).toHaveAttribute('href', '/sign-in')
  })

  it('mentions player analytics so athletes know they can view their own stats', () => {
    render(
      <MemoryRouter>
        <Welcome />
      </MemoryRouter>
    )

    expect(screen.getByText(/players view their own analytics/i)).toBeInTheDocument()
  })

  it('shows the PLAN / PLAY / TRACK workflow strip', () => {
    render(
      <MemoryRouter>
        <Welcome />
      </MemoryRouter>
    )

    expect(screen.getByText('PLAN')).toBeInTheDocument()
    expect(screen.getByText('PLAY')).toBeInTheDocument()
    expect(screen.getByText('TRACK')).toBeInTheDocument()
  })

  it('shows the landing page for signed-in users too', () => {
    clerkState.signedIn = true

    render(
      <MemoryRouter>
        <Welcome />
      </MemoryRouter>
    )

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/OWN EVERY/)
    expect(screen.getByRole('link', { name: /Get Started/i })).toHaveAttribute('href', '/role-select')
  })

  it('offers the dashboard instead of "Sign in" to a signed-in user', () => {
    clerkState.signedIn = true

    render(
      <MemoryRouter>
        <Welcome />
      </MemoryRouter>
    )

    expect(screen.getByRole('link', { name: /Open Dashboard/i })).toHaveAttribute('href', '/dashboard')
    expect(screen.queryByRole('link', { name: /^Sign In$/i })).not.toBeInTheDocument()
  })
})