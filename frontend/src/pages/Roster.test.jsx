// AI assistance: drafted with Claude (Sonnet 5) via claude.ai; reviewed and tested by the project team.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { BrowserRouter, MemoryRouter, Routes, Route } from 'react-router-dom'
import Roster from './Roster'
import ConfirmProvider from '../components/ConfirmProvider'

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  getToken: vi.fn(),
  fileToProfilePhoto: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  apiRequest: mocks.apiRequest,
}))

vi.mock('../lib/image', () => ({
  fileToProfilePhoto: mocks.fileToProfilePhoto,
}))

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: mocks.getToken }),
}))

vi.mock('../components/Layout', () => ({
  default: ({ children }) => <div>{children}</div>,
}))

function renderWithRouter(ui) {
  return render(<BrowserRouter>{ui}</BrowserRouter>)
}

describe('Roster', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset()
    mocks.fileToProfilePhoto.mockReset()
    mocks.getToken.mockResolvedValue('test-token')
  })

  it('shows a loading state then the empty roster message for coaches', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/account/me') return Promise.resolve({ role: 'coach' })
      if (path === '/api/athletes') return Promise.resolve([])
      return Promise.resolve({})
    })

    renderWithRouter(<Roster />)

    expect(screen.getByText(/Loading roster/i)).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(/No athletes yet/i)).toBeInTheDocument()
      expect(screen.getByText(/Add your first athlete/i)).toBeInTheDocument()
    })
  })

  it('renders athletes with edit/remove actions for coaches', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/account/me') return Promise.resolve({ role: 'coach' })
      if (path === '/api/athletes') {
        return Promise.resolve([
          { id: 1, name: 'Alex Morgan', position: 'Forward', squad_number: 13 },
          { id: 2, name: 'Casey Keller', position: 'Goalkeeper', squad_number: 1 },
        ])
      }
      return Promise.resolve({})
    })

    renderWithRouter(<Roster />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Alex Morgan' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Casey Keller' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Edit roster/i }))

    expect(screen.getAllByRole('button', { name: /^Edit$/i }).length).toBe(2)
    expect(screen.getAllByRole('button', { name: /Remove/i }).length).toBe(2)
  }, 10000)

  it('opens the add-athlete form when the coach clicks Add athlete', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/account/me') return Promise.resolve({ role: 'coach' })
      if (path === '/api/athletes') return Promise.resolve([])
      return Promise.resolve({})
    })

    renderWithRouter(<Roster />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add athlete/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Add athlete/i }))

    expect(screen.getByRole('heading', { name: /Add athlete/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save athlete/i })).toBeInTheDocument()
  })

  it('shows account status chips and invite buttons for unjoined players', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/account/me') return Promise.resolve({ role: 'coach' })
      if (path === '/api/athletes') {
        return Promise.resolve([
          { id: 1, name: 'Alex Morgan', position: 'Forward', account_status: 'joined' },
          { id: 2, name: 'Casey Keller', position: 'Goalkeeper', account_status: 'invited' },
          { id: 3, name: 'Sam Peters', position: 'Striker' },
        ])
      }
      return Promise.resolve({})
    })

    renderWithRouter(<Roster />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sam Peters' })).toBeInTheDocument()
    })

    expect(screen.getByText('Joined')).toBeInTheDocument()
    expect(screen.getByText('Invite pending')).toBeInTheDocument()
    expect(screen.getByText('No account')).toBeInTheDocument()
    // Only players without an accepted account can be invited.
    expect(screen.getAllByRole('button', { name: /Invite player/i })).toHaveLength(2)
  })

  it('invites a player from the card and shows the generated credentials', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/account/me') return Promise.resolve({ role: 'coach' })
      if (path === '/api/athletes') {
        return Promise.resolve([{ id: 1, name: 'Alex Morgan', position: 'Forward' }])
      }
      if (path === '/api/athletes/1/invite') {
        return Promise.resolve({
          invite: {
            inviteLink: 'http://localhost:5173/invite/tok123',
            credentials: { email: 'alex@example.com', password: 'Kick-Stat-2026!' },
            account: { created: true },
          },
        })
      }
      return Promise.resolve({})
    })

    renderWithRouter(<Roster />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Alex Morgan' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Invite player/i }))

    fireEvent.change(screen.getByLabelText(/Invite email for Alex Morgan/i), {
      target: { value: 'alex@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Send invite/i }))

    await waitFor(() => {
      expect(mocks.apiRequest).toHaveBeenCalledWith('/api/athletes/1/invite', {
        method: 'POST',
        body: { email: 'alex@example.com' },
        getToken: mocks.getToken,
      })
    })

    // The credentials panel surfaces the pre-created login details.
    await waitFor(() => {
      expect(screen.getByText(/Player invite sent/i)).toBeInTheDocument()
    })
    expect(screen.getByText('alex@example.com')).toBeInTheDocument()
    expect(screen.getByText('Kick-Stat-2026!')).toBeInTheDocument()
    expect(screen.getByText(/invite\/tok123/i)).toBeInTheDocument()
    expect(screen.getByText(/Share these details securely/i)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(3)

    // Done dismisses the panel again.
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => {
      expect(screen.queryByText(/Player invite sent/i)).not.toBeInTheDocument()
    })
  })

  it('explains when the player account already exists instead of showing a password', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/account/me') return Promise.resolve({ role: 'coach' })
      if (path === '/api/athletes') {
        return Promise.resolve([{ id: 1, name: 'Alex Morgan', position: 'Forward' }])
      }
      if (path === '/api/athletes/1/invite') {
        return Promise.resolve({
          invite: {
            inviteLink: 'http://localhost:5173/invite/tok123',
            account: { created: false, reason: 'exists' },
          },
        })
      }
      return Promise.resolve({})
    })

    renderWithRouter(<Roster />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Alex Morgan' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Invite player/i }))
    fireEvent.change(screen.getByLabelText(/Invite email for Alex Morgan/i), {
      target: { value: 'alex@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Send invite/i }))

    expect(await screen.findByText(/account with this email already exists/i)).toBeInTheDocument()
    // No password was generated, so only the invite link is copyable.
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(1)
    expect(screen.getByText(/invite\/tok123/i)).toBeInTheDocument()
  })

  it('deletes an athlete after confirming in the dialog', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/account/me') return Promise.resolve({ role: 'coach' })
      if (path === '/api/athletes') {
        return Promise.resolve([{ id: 1, name: 'Alex Morgan', position: 'Forward' }])
      }
      if (path === '/api/athletes/1') return Promise.resolve(null)
      return Promise.resolve({})
    })

    renderWithRouter(
      <ConfirmProvider>
        <Roster />
      </ConfirmProvider>
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Edit roster/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Edit roster/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Remove/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Remove/i }))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/Remove this athlete from the roster/i)).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() => {
      expect(mocks.apiRequest).toHaveBeenCalledWith('/api/athletes/1', {
        method: 'DELETE',
        getToken: mocks.getToken,
      })
    })
  })

  it('keeps the athlete when the confirm dialog is cancelled', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/account/me') return Promise.resolve({ role: 'coach' })
      if (path === '/api/athletes') {
        return Promise.resolve([{ id: 1, name: 'Alex Morgan', position: 'Forward' }])
      }
      return Promise.resolve({})
    })

    renderWithRouter(
      <ConfirmProvider>
        <Roster />
      </ConfirmProvider>
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Edit roster/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Edit roster/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Remove/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Remove/i }))

    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(mocks.apiRequest).not.toHaveBeenCalledWith('/api/athletes/1', {
      method: 'DELETE',
      getToken: mocks.getToken,
    })
  })

  it('shows the stored photo on the card instead of the initials', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/account/me') return Promise.resolve({ role: 'coach' })
      if (path === '/api/athletes') {
        return Promise.resolve([
          {
            id: 1,
            name: 'Alex Morgan',
            position: 'Forward',
            squad_number: 13,
            photo: 'data:image/jpeg;base64,ZmFrZQ==',
          },
        ])
      }
      return Promise.resolve({})
    })

    const { container } = renderWithRouter(<Roster />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Alex Morgan' })).toBeInTheDocument()
    })

    expect(container.querySelector('.ros-card-avatar-img')).toHaveAttribute(
      'src',
      'data:image/jpeg;base64,ZmFrZQ=='
    )
    expect(screen.queryByText('AM')).not.toBeInTheDocument()
  })

  it('lets a coach attach a photo from the card and swaps the initials for it', async () => {
    mocks.fileToProfilePhoto.mockResolvedValue('data:image/jpeg;base64,UElD')

    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/account/me') return Promise.resolve({ role: 'coach' })
      if (path === '/api/athletes') {
        return Promise.resolve([
          { id: 1, name: 'Alex Morgan', position: 'Forward', squad_number: 13 },
        ])
      }
      if (path === '/api/athletes/1') {
        return Promise.resolve({ id: 1, photo: 'data:image/jpeg;base64,UElD' })
      }
      return Promise.resolve({})
    })

    const { container } = renderWithRouter(<Roster />)

    await waitFor(() => {
      expect(screen.getByText('AM')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add photo for Alex Morgan' }))

    const fileInput = container.querySelector('input[type="file"]')
    const file = new File(['face'], 'face.jpg', { type: 'image/jpeg' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => {
      expect(mocks.apiRequest).toHaveBeenCalledWith('/api/athletes/1', {
        method: 'PATCH',
        body: { photo: 'data:image/jpeg;base64,UElD' },
        getToken: mocks.getToken,
      })
    })

    await waitFor(() => {
      expect(container.querySelector('.ros-card-avatar-img')).toHaveAttribute(
        'src',
        'data:image/jpeg;base64,UElD'
      )
    })
    expect(screen.queryByText('AM')).not.toBeInTheDocument()
  })

  it('redirects players to their own profile card instead of the team roster', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/account/me') return Promise.resolve({ role: 'athlete', athleteId: 5 })
      if (path === '/api/athletes') return Promise.resolve([])
      return Promise.resolve({})
    })

    render(
      <MemoryRouter initialEntries={['/roster']}>
        <Routes>
          <Route
            path="/roster"
            element={
              <ConfirmProvider>
                <Roster />
              </ConfirmProvider>
            }
          />
          <Route path="/roster/:id" element={<div>PLAYER CARD PAGE</div>} />
          <Route path="/dashboard" element={<div>DASHBOARD PAGE</div>} />
        </Routes>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('PLAYER CARD PAGE')).toBeInTheDocument()
    })
  })

  it('sends an unlinked player account back to the dashboard', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/account/me') return Promise.resolve({ role: 'athlete' })
      if (path === '/api/athletes') return Promise.resolve([])
      return Promise.resolve({})
    })

    render(
      <MemoryRouter initialEntries={['/roster']}>
        <Routes>
          <Route
            path="/roster"
            element={
              <ConfirmProvider>
                <Roster />
              </ConfirmProvider>
            }
          />
          <Route path="/dashboard" element={<div>DASHBOARD PAGE</div>} />
        </Routes>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('DASHBOARD PAGE')).toBeInTheDocument()
    })
  })
})
