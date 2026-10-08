import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import Layout from './Layout'

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  getToken: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  apiRequest: mocks.apiRequest,
}))

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: mocks.getToken }),
  UserButton: () => <div data-testid="user-button">UserButton</div>,
}))

// jsdom does not implement matchMedia, which ThemeToggle uses to detect the
// OS colour scheme preference.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
})

function renderLayout() {
  return render(
    <BrowserRouter>
      <Layout>
        <p>Page Content</p>
      </Layout>
    </BrowserRouter>
  )
}

describe('Layout', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset()
    mocks.getToken.mockReset()
    mocks.apiRequest.mockResolvedValue({ role: 'coach' })
  })

  it('renders navigation links', async () => {
    renderLayout()
    expect(screen.getByText('Page Content')).toBeInTheDocument()
    expect(screen.getByText(/Dashboard/i)).toBeInTheDocument()
    expect(screen.getByText(/Roster/i)).toBeInTheDocument()
    expect(screen.getByText(/Events/i)).toBeInTheDocument()
    // Await the role fetch so its state update lands inside the test, then
    // assert the full staff nav — players get "My Stats" plus read-only
    // team pages (covered by the player test below).
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Live' })).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: 'Compare' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Tactics' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sessions' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'My Stats' })).not.toBeInTheDocument()
  })

  it('shows the Live nav item for staff accounts', async () => {
    renderLayout()

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Live' })).toBeInTheDocument()
    })
  })

  it('shows My Stats and the read-only team pages for players', async () => {
    mocks.apiRequest.mockResolvedValue({ role: 'athlete', athleteId: 8 })
    renderLayout()

    await waitFor(() => {
      expect(mocks.apiRequest).toHaveBeenCalledWith('/api/account/me', {
        getToken: mocks.getToken,
      })
    })
    // Give the role state a tick to land before asserting.
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'My Stats' })).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: 'My Stats' })).toHaveAttribute('href', '/roster/8')
    expect(screen.queryByRole('link', { name: 'Roster' })).not.toBeInTheDocument()
    // Team pages stay visible for players but open read-only (see Layout.jsx).
    expect(screen.getByRole('link', { name: 'Compare' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Tactics' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sessions' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Live' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Events' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument()
  })
})
