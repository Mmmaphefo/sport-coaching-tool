// AI assistance: drafted with Qoder (AI coding assistant); reviewed and tested by the project team.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AccountSettings from './AccountSettings'

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  getToken: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  apiRequest: mocks.apiRequest,
}))

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: mocks.getToken, signOut: mocks.signOut }),
  UserProfile: () => <div data-testid="user-profile" />,
}))

vi.mock('../components/Layout', () => ({
  default: ({ children }) => <div>{children}</div>,
}))

function renderSettings() {
  return render(
    <MemoryRouter>
      <AccountSettings />
    </MemoryRouter>
  )
}

function mockSquadLoad(name = 'Golden Lions') {
  mocks.apiRequest.mockImplementation((path) => {
    if (path === '/api/squads/mine') return Promise.resolve({ name, gender: 'male' })
    return Promise.resolve({})
  })
}

describe('AccountSettings', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset()
    mocks.getToken.mockResolvedValue('test-token')
    mocks.signOut.mockReset()
  })

  it('loads the team name into the form', async () => {
    mockSquadLoad('Golden Lions')
    renderSettings()

    expect(screen.getByText(/Loading team details/i)).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByLabelText(/Team name/i)).toHaveValue('Golden Lions')
    })
  })

  it('saves the trimmed team name and confirms the update', async () => {
    mockSquadLoad('Golden Lions')
    renderSettings()

    await waitFor(() => {
      expect(screen.getByLabelText(/Team name/i)).toHaveValue('Golden Lions')
    })

    fireEvent.change(screen.getByLabelText(/Team name/i), {
      target: { value: '  Silver Falcons  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Save team name/i }))

    await waitFor(() => {
      expect(mocks.apiRequest).toHaveBeenCalledWith('/api/squads/mine', {
        method: 'PATCH',
        body: { name: 'Silver Falcons', gender: 'male' },
        getToken: mocks.getToken,
      })
    })
    expect(await screen.findByText(/Team name updated/i)).toBeInTheDocument()
  })

  it('blocks saving an empty team name', async () => {
    mockSquadLoad('Golden Lions')
    renderSettings()

    await waitFor(() => {
      expect(screen.getByLabelText(/Team name/i)).toHaveValue('Golden Lions')
    })

    fireEvent.change(screen.getByLabelText(/Team name/i), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: /Save team name/i }))

    expect(await screen.findByText(/Team name is required/i)).toBeInTheDocument()
    expect(mocks.apiRequest).not.toHaveBeenCalledWith(
      '/api/squads/mine',
      expect.objectContaining({ method: 'PATCH' })
    )
  })

  it('requires typing DELETE before deleting the account', async () => {
    mockSquadLoad()
    renderSettings()

    await waitFor(() => {
      expect(screen.getByLabelText(/Team name/i)).toHaveValue('Golden Lions')
    })

    fireEvent.click(screen.getByRole('button', { name: /Delete account/i }))
    fireEvent.change(screen.getByPlaceholderText('DELETE'), { target: { value: 'delete' } })
    fireEvent.click(screen.getByRole('button', { name: /Permanently delete account/i }))

    expect(await screen.findByText(/Please type DELETE to confirm/i)).toBeInTheDocument()
    expect(mocks.apiRequest).not.toHaveBeenCalledWith(
      '/api/account/me',
      expect.objectContaining({ method: 'DELETE' })
    )

    fireEvent.change(screen.getByPlaceholderText('DELETE'), { target: { value: 'DELETE' } })
    fireEvent.click(screen.getByRole('button', { name: /Permanently delete account/i }))

    await waitFor(() => {
      expect(mocks.apiRequest).toHaveBeenCalledWith('/api/account/me', {
        method: 'DELETE',
        getToken: mocks.getToken,
      })
    })
    expect(mocks.signOut).toHaveBeenCalledWith({ redirectUrl: '/' })
  })

  it('hides squad settings for athletes but keeps the profile and danger zone', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/account/me') return Promise.resolve({ role: 'athlete' })
      return Promise.resolve({})
    })

    renderSettings()

    await waitFor(() => {
      expect(screen.queryByLabelText(/Team name/i)).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: /Public squad page/i })).not.toBeInTheDocument()
    })

    // The Clerk profile (password change) and the danger zone remain.
    expect(screen.getByTestId('user-profile')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Delete account/i })).toBeInTheDocument()
    // Squad management is never even fetched for a player.
    expect(mocks.apiRequest).not.toHaveBeenCalledWith('/api/squads/mine', expect.anything())
  })
})
