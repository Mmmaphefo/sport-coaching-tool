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

  it('hides the landing actions for signed-in users so they are redirected to the dashboard', () => {
    clerkState.signedIn = true

    render(
      <MemoryRouter>
        <Welcome />
      </MemoryRouter>
    )

    expect(screen.queryByRole('link', { name: /Get Started/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Sign In/i })).not.toBeInTheDocument()
  })
})