// AI assistance: drafted with Claude (Sonnet 5) via claude.ai; reviewed and tested by the project team.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import Events from './Events'

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  getToken: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  apiRequest: mocks.apiRequest,
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

describe('Events', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset()
    mocks.getToken.mockResolvedValue('test-token')
  })

  it('shows a loading state then an empty events message', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/events') return Promise.resolve([])
      return Promise.resolve({})
    })

    renderWithRouter(<Events />)

    expect(screen.getByText(/Loading events/i)).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(/No events yet/i)).toBeInTheDocument()
      expect(screen.getByText(/Schedule your first match/i)).toBeInTheDocument()
    })
  })

  it('renders scheduled events with format and status', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/events') {
        return Promise.resolve([
          {
            id: 1,
            title: 'Friendly vs Riverside FC',
            format: 'match',
            status: 'scheduled',
            event_date: '2026-09-12T10:00:00.000Z',
            location: 'Wits Main Oval',
          },
          {
            id: 2,
            title: 'Winter League 2026',
            format: 'league',
            status: 'open',
            event_date: '2026-10-01T09:00:00.000Z',
            team_count: 3,
            required_teams: 6,
          },
        ])
      }
      return Promise.resolve({})
    })

    renderWithRouter(<Events />)

    await waitFor(() => {
      expect(screen.getByText(/Friendly vs Riverside FC/i)).toBeInTheDocument()
      expect(screen.getByText(/Winter League 2026/i)).toBeInTheDocument()
      expect(screen.getByText(/Wits Main Oval/i)).toBeInTheDocument()
    })

    expect(screen.getByText(/Scheduled/i)).toBeInTheDocument()
    expect(screen.getByText(/Open/i)).toBeInTheDocument()
    expect(screen.getByText(/3 \/ 6 teams joined/i)).toBeInTheDocument()
  })

  it('shows a join button for open events that are not full', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/events') {
        return Promise.resolve([
          { id: 1, title: 'Open League', format: 'league', status: 'open', team_count: 1, required_teams: 4 },
        ])
      }
      return Promise.resolve({})
    })

    renderWithRouter(<Events />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Join' })).toBeInTheDocument()
    })
  })

  it('opens the schedule event form', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/events') return Promise.resolve([])
      return Promise.resolve({})
    })

    renderWithRouter(<Events />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Schedule event/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Schedule event/i }))

    expect(screen.getByRole('heading', { name: /Schedule event/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create event/i })).toBeInTheDocument()
  })

  it('switches between list and calendar view', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/events') return Promise.resolve([])
      return Promise.resolve({})
    })

    renderWithRouter(<Events />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /List view/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Calendar view/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Calendar view/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Calendar view/i }).getAttribute('aria-pressed')).toBe('true')
    })
  })

  it('hides staff actions and shows own RSVP badges for athletes', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/account/me') return Promise.resolve({ role: 'athlete' })
      if (path === '/api/events') {
        return Promise.resolve([
          {
            id: 1,
            title: 'Friendly vs Riverside FC',
            format: 'match',
            status: 'scheduled',
            event_date: '2026-09-12T10:00:00.000Z',
            location: 'Wits Main Oval',
            my_rsvp: 'available',
          },
          {
            id: 2,
            title: 'Open League',
            format: 'league',
            status: 'open',
            team_count: 1,
            required_teams: 4,
          },
        ])
      }
      return Promise.resolve({})
    })

    renderWithRouter(<Events />)

    await waitFor(() => {
      // Own RSVP badge instead of the staff controls.
      expect(screen.getByText(/You\u2019re in/i)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Schedule event/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Join' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Gender filter/i })).not.toBeInTheDocument()
    })
  })

  it('uses player-facing copy in the empty state for athletes', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/account/me') return Promise.resolve({ role: 'athlete' })
      if (path === '/api/events') return Promise.resolve([])
      return Promise.resolve({})
    })

    renderWithRouter(<Events />)

    await waitFor(() => {
      expect(screen.getByText(/No events scheduled yet/i)).toBeInTheDocument()
      expect(screen.getByText(/coach\u2019s fixtures and training sessions/i)).toBeInTheDocument()
    })
  })

  it('sends the map pin with a newly scheduled event', async () => {
    const posts = []
    mocks.apiRequest.mockImplementation((path, options = {}) => {
      if (path === '/api/events' && options.method === 'POST') {
        posts.push(options.body)
        return Promise.resolve({ id: 42 })
      }
      if (path.startsWith('/api/events/clashes')) return Promise.resolve([])
      if (path === '/api/events') return Promise.resolve([])
      if (path === '/api/squads/mine') {
        return Promise.resolve({ id: 7, athlete_count: 15, min_roster_size: 11 })
      }
      return Promise.resolve({})
    })

    renderWithRouter(<Events />)

    await waitFor(() => expect(screen.getByRole('button', { name: /Schedule event/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Schedule event/i }))

    fireEvent.change(screen.getByLabelText(/Date & time/i), { target: { value: '2026-12-01T10:00' } })
    fireEvent.change(screen.getByLabelText(/Opponent/i), { target: { value: 'Riverside FC' } })

    // Drop the pin — with jsdom's zero-size canvas a click at (0, 0) resolves
    // to the map's default Johannesburg centre.
    const map = screen.getByRole('application', { name: /venue map/i })
    fireEvent.pointerDown(map, { pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerUp(map, { pointerId: 1, clientX: 0, clientY: 0 })

    await waitFor(() => expect(screen.getByText(/Pinned at/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Create event/i }))

    await waitFor(() => expect(posts.length).toBe(1))
    expect(posts[0].location_lat).toBe(-26.2041)
    expect(posts[0].location_lng).toBe(28.0473)
    expect(posts[0].location).toBeNull()
  })
})
