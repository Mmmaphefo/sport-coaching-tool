// AI assistance: drafted with Qoder (AI coding assistant); reviewed and tested by the project team.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import ProtectedRoute from './ProtectedRoute'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
}))

vi.mock('@clerk/clerk-react', () => ({
  useAuth: mocks.useAuth,
}))

function renderWithRouter(ui) {
  return render(<BrowserRouter>{ui}</BrowserRouter>)
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    mocks.useAuth.mockReset()
  })

  it('renders children when signed in', () => {
    mocks.useAuth.mockReturnValue({ isLoaded: true, isSignedIn: true })

    renderWithRouter(
      <ProtectedRoute>
        <p>Protected Content</p>
      </ProtectedRoute>
    )

    expect(screen.getByText('Protected Content')).toBeInTheDocument()
  })

  it('shows a loading state while auth state is loading', () => {
    mocks.useAuth.mockReturnValue({ isLoaded: false, isSignedIn: false })

    renderWithRouter(
      <ProtectedRoute>
        <p>Protected Content</p>
      </ProtectedRoute>
    )

    expect(screen.getByText('Loading...')).toBeInTheDocument()
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
  })

  it('does not render children when not signed in', () => {
    mocks.useAuth.mockReturnValue({ isLoaded: true, isSignedIn: false })

    renderWithRouter(
      <ProtectedRoute>
        <p>Protected Content</p>
      </ProtectedRoute>
    )

    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
  })
})