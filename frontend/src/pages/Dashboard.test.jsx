// AI assistance: drafted with Claude (Sonnet 5) via claude.ai; reviewed and tested by the project team.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { BrowserRouter, MemoryRouter, Routes, Route } from 'react-router-dom'
import Dashboard from './Dashboard'

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  getToken: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  apiRequest: mocks.apiRequest,
}))

vi.mock('@clerk/clerk-react', () => ({
  useUser: () => ({
    user: {
      firstName: 'Tasmiya',
      primaryEmailAddress: { emailAddress: 'tasmiya@example.com' },
    },
  }),
  useAuth: () => ({ getToken: mocks.getToken }),
}))

vi.mock('../components/Layout', () => ({
  default: ({ children }) => <div>{children}</div>,
}))

// useCountUp drives StatNumber via requestAnimationFrame + matchMedia, neither
// of which jsdom supports — return the target value directly.
vi.mock('../lib/useCountUp', () => ({
  useCountUp: (value) => value,
}))

const summaryPayload = {
  period: '7d',
  squad: {
    totalRoster: 18,
    readyCount: 12,
    managedCount: 4,
    injuredCount: 2,
    readinessPct: 67,
  },
  readinessTrend: [
    { date: '2026-09-12', readiness: 60 },
    { date: '2026-09-13', readiness: 62 },
    { date: '2026-09-14', readiness: 67 },
  ],
  positionAvailability: { GK: 2, DEF: 6, MID: 6, FWD: 4, Other: 0 },
  form: { results: ['W', 'D'], points: 4, matchesPlayed: 2, pointsPossible: 6 },
  teamGoals: { total: 5, perMatch: 2.5 },
  attackLeaders: [{ id: 3, name: 'Sam Peters', position: 'Striker', goals: 3 }],
  nextEvent: null,
}

// GET /api/dashboard/trends payload: the squad's completed matches, oldest
// first, with the season summary that drives the record row.
const trendsPayload = {
  matches: [
    { kind: 'match', id: 11, date: '2026-10-01T00:00:00.000Z', opponent: 'Riverside FC', competition: null, goalsFor: 2, goalsAgainst: 1, result: 'W' },
    { kind: 'fixture', id: 3, date: '2026-10-05T00:00:00.000Z', opponent: 'Rival United', competition: 'Trend League', goalsFor: 2, goalsAgainst: 0, result: 'W' },
    { kind: 'match', id: 12, date: '2026-10-08T00:00:00.000Z', opponent: 'Marlow Athletic', competition: null, goalsFor: 0, goalsAgainst: 3, result: 'L' },
  ],
  summary: { played: 3, wins: 2, draws: 0, losses: 1, goalsFor: 4, goalsAgainst: 4, points: 6 },
}

// One payload shape from GET /api/athletes/:id/stats, used by the player-view
// tests. Log dates are relative to "now" so the default 7D period includes
// them regardless of when the suite runs.
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString()

const playerPayload = {
  athlete: { id: 8, name: 'Jordan Blake', position: 'Midfielder', squad_number: 10, is_managed: false },
  stats: { goals: 3, assists: 2, penalties: 0, yellowCards: 0, redCards: 0, appearances: 5 },
  logs: [
    { id: 1, event_id: 10, action_type: 'goal', value: 2, minute: 23, event_date: daysAgo(2), opponent: 'City United' },
    { id: 2, event_id: 10, action_type: 'assist', value: 1, minute: 40, event_date: daysAgo(2), opponent: 'City United' },
    { id: 3, event_id: 11, action_type: 'goal', value: 1, minute: 60, event_date: daysAgo(5), opponent: 'Riverside FC' },
  ],
  injuries: [],
  currentInjury: null,
}

// Player-view API: the linked athlete account, their own stats, and the
// squad summary (still loaded for the live score card and Attack leaders).
function mockPlayerApi(extra = {}) {
  mocks.apiRequest.mockImplementation((path) => {
    if (path.startsWith('/api/dashboard/summary')) {
      return Promise.resolve({ ...summaryPayload, ...extra })
    }
    if (path === '/api/account/me') return Promise.resolve({ role: 'athlete', athleteId: 8 })
    if (path === '/api/athletes/8/stats') return Promise.resolve(playerPayload)
    return Promise.resolve({})
  })
}

function renderWithRouter(ui) {
  return render(<BrowserRouter>{ui}</BrowserRouter>)
}

describe('Dashboard', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset()
    mocks.getToken.mockResolvedValue('test-token')

    mocks.apiRequest.mockImplementation((path) => {
      if (path.startsWith('/api/dashboard/summary')) return Promise.resolve(summaryPayload)
      return Promise.resolve({})
    })
  })

  it('renders the dashboard heading and intro', async () => {
    renderWithRouter(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /The full squad picture/i })).toBeInTheDocument()
    })
    expect(screen.getByRole('heading', { name: /^Dashboard$/i })).toBeInTheDocument()
  }, 10000)

  it('shows the squad stat cards', async () => {
    renderWithRouter(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText(/Squad readiness/i)).toBeInTheDocument()
      expect(screen.getByText(/Available now/i)).toBeInTheDocument()
      expect(screen.getByText(/Team goals/i)).toBeInTheDocument()
      expect(screen.getByText(/Recent form/i)).toBeInTheDocument()
    })
  })

  it('shows the period toggle', async () => {
    renderWithRouter(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '7D' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '30D' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Season' })).toBeInTheDocument()
    })
  })

  it('shows the empty next-fixture state when nothing is scheduled', async () => {
    renderWithRouter(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText(/No upcoming event scheduled/i)).toBeInTheDocument()
    })
  })

  it('lists attack leaders when goals are logged', async () => {
    renderWithRouter(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText('Sam Peters')).toBeInTheDocument()
    })
    expect(screen.getByRole('heading', { name: /Attack leaders/i })).toBeInTheDocument()
  })

  it('shows the invite assistant form', async () => {
    renderWithRouter(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Invite an Assistant/i })).toBeInTheDocument()
    })
    expect(screen.getByPlaceholderText(/assistant@example.com/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Send invite/i })).toBeInTheDocument()
  })

  it('sends an assistant invite and confirms with the fallback link', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path.startsWith('/api/dashboard/summary')) return Promise.resolve(summaryPayload)
      if (path === '/api/invites') {
        return Promise.resolve({
          inviteId: 9,
          inviteLink: 'http://localhost:5173/invite/abc123',
          emailSent: true,
        })
      }
      return Promise.resolve({})
    })

    renderWithRouter(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Invite an Assistant/i })).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText(/assistant@example.com/i), {
      target: { value: 'coach2@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Send invite/i }))

    await waitFor(() => {
      expect(mocks.apiRequest).toHaveBeenCalledWith('/api/invites', {
        method: 'POST',
        body: { email: 'coach2@example.com' },
        getToken: mocks.getToken,
      })
      expect(screen.getByText(/Invitation email sent/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/invite\/abc123/)).toBeInTheDocument()
  })

  it('shows the provider reason when the invite email is rejected', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path.startsWith('/api/dashboard/summary')) return Promise.resolve(summaryPayload)
      if (path === '/api/invites') {
        return Promise.resolve({
          inviteId: 10,
          inviteLink: 'http://localhost:5173/invite/def456',
          emailSent: false,
          emailError: 'You can only send testing emails to your own email address',
        })
      }
      return Promise.resolve({})
    })

    renderWithRouter(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Invite an Assistant/i })).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText(/assistant@example.com/i), {
      target: { value: 'coach2@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Send invite/i }))

    await waitFor(() => {
      expect(screen.getByText(/could not be delivered/i)).toBeInTheDocument()
      expect(screen.getByText(/testing emails to your own email address/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/invite\/def456/)).toBeInTheDocument()
  })

  it('shows the server message when an invite already exists', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path.startsWith('/api/dashboard/summary')) return Promise.resolve(summaryPayload)
      if (path === '/api/invites') {
        return Promise.reject(new Error('An invite has already been sent to this email'))
      }
      return Promise.resolve({})
    })

    renderWithRouter(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Invite an Assistant/i })).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText(/assistant@example.com/i), {
      target: { value: 'coach2@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Send invite/i }))

    expect(
      await screen.findByText(/An invite has already been sent to this email/i)
    ).toBeInTheDocument()
  })

  it('shows the live score card while a match is live', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path.startsWith('/api/dashboard/summary')) {
        return Promise.resolve({
          ...summaryPayload,
          liveEvent: {
            kind: 'event',
            id: 7,
            title: 'vs City United',
            homeLabel: 'Your squad',
            awayLabel: 'City United',
            homeScore: 2,
            awayScore: 1,
            link: '/live/7',
          },
        })
      }
      return Promise.resolve({})
    })

    renderWithRouter(<Dashboard />)

    const card = await screen.findByTestId('dash-live-card')
    expect(within(card).getByText(/Live now/i)).toBeInTheDocument()
    expect(within(card).getByText('vs City United')).toBeInTheDocument()
    expect(within(card).getByText('Your squad')).toBeInTheDocument()
    expect(within(card).getByText('City United')).toBeInTheDocument()
    // StatNumber renders each digit as a bare fragment text node, so read the
    // score element's combined text ("2–1") instead of matching digits.
    const score = card.querySelector('.dash-live-score')
    expect(score.textContent.replace(/\D/g, '')).toBe('21')
    expect(within(card).getByText(/Open live match centre/i)).toBeInTheDocument()
  })

  it('hides the live score card when nothing is live', async () => {
    renderWithRouter(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /The full squad picture/i })).toBeInTheDocument()
    })
    expect(screen.queryByTestId('dash-live-card')).not.toBeInTheDocument()
  })

  it('hides the invite assistant panel for athletes', async () => {
    mockPlayerApi()

    renderWithRouter(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Your game at a glance/i })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: /Invite an Assistant/i })).not.toBeInTheDocument()
      expect(screen.queryByPlaceholderText(/assistant@example.com/i)).not.toBeInTheDocument()
    })
  })

  it('shows personal stat cards, hides the squad panels, and keeps Attack leaders for players', async () => {
    mockPlayerApi()

    renderWithRouter(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Appearances')).toBeInTheDocument()
    })

    // Personal cards replace the squad stat grid (3 goals + 1 assist in 7D).
    const statGrid = document.querySelector('.dash-stat-grid')
    expect(within(statGrid).getByText('Goals')).toBeInTheDocument()
    expect(within(statGrid).getByText('Appearances')).toBeInTheDocument()
    expect(within(statGrid).getByText('Assists')).toBeInTheDocument()
    expect(within(statGrid).getByText('Goal contributions')).toBeInTheDocument()
    expect(screen.getByText('4 goal contributions')).toBeInTheDocument()
    expect(screen.queryByText(/Squad readiness/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Available now/i)).not.toBeInTheDocument()

    // Staff panels are gone; the team's Attack leaders stay.
    expect(screen.queryByRole('heading', { name: /Position availability/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Squad status/i })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Attack leaders/i })).toBeInTheDocument()
    expect(screen.getByText('Sam Peters')).toBeInTheDocument()
  })

  it('plots the matches on an interactive chart that opens the match', async () => {
    mockPlayerApi()

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/events/:id" element={<div>MATCH PAGE</div>} />
        </Routes>
      </MemoryRouter>
    )

    const cityBar = await screen.findByTitle(/vs City United/)
    expect(cityBar).toHaveAttribute('title', 'vs City United — 2 goals, 1 assist')
    expect(screen.getByTitle(/vs Riverside FC/)).toBeInTheDocument()
    expect(screen.getByText(/Tap a bar to open the match/i)).toBeInTheDocument()

    fireEvent.click(cityBar)

    await waitFor(() => {
      expect(screen.getByText('MATCH PAGE')).toBeInTheDocument()
    })
  })

  it('renders the season-form panel from the trends endpoint', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path.startsWith('/api/dashboard/summary')) return Promise.resolve(summaryPayload)
      if (path.startsWith('/api/dashboard/trends')) return Promise.resolve(trendsPayload)
      if (path === '/api/account/me') return Promise.resolve({ role: 'coach', athleteId: null })
      return Promise.resolve({})
    })

    renderWithRouter(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Match results' })).toBeInTheDocument()
    })
    // One result dot per completed match, lettered W/D/L.
    expect(screen.getAllByText('W')).toHaveLength(2)
    expect(screen.getByText('L')).toBeInTheDocument()
    // Goals-for bar heights scale to the busiest scoreline in the run.
    const winBar = screen.getByTitle('vs Riverside FC — 2 for, 1 against')
    const lossBar = screen.getByTitle('vs Marlow Athletic — 0 for, 3 against')
    expect(winBar).toBeInTheDocument()
    expect(lossBar).toBeInTheDocument()
    // Season record row from the trends summary — the numbers render bold
    // inside the spans, so match the row as a whole instead of the split
    // text nodes.
    const recordRow = screen.getByText((_, el) => el.classList.contains('dash-trend-record'))
    expect(recordRow).toHaveTextContent(/3\s*played/)
    expect(recordRow).toHaveTextContent(/6\s*pts/)
    expect(screen.getByText(/Tap a result to open the match report/i)).toBeInTheDocument()
  }, 10000)

  it('keeps the dashboard working when the trends endpoint fails', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path.startsWith('/api/dashboard/summary')) return Promise.resolve(summaryPayload)
      if (path.startsWith('/api/dashboard/trends')) return Promise.reject(new Error('trends down'))
      if (path === '/api/account/me') return Promise.resolve({ role: 'coach', athleteId: null })
      return Promise.resolve({})
    })

    renderWithRouter(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /The full squad picture/i })).toBeInTheDocument()
    })
    expect(screen.getByText(/No completed matches yet/i)).toBeInTheDocument()
    expect(screen.getByText(/Squad readiness/i)).toBeInTheDocument()
  }, 10000)

  it('keeps the live score for athletes but hides the match centre link', async () => {
    mockPlayerApi({
      liveEvent: {
        kind: 'event',
        id: 7,
        title: 'vs City United',
        homeLabel: 'Your squad',
        awayLabel: 'City United',
        homeScore: 2,
        awayScore: 1,
        link: '/live/7',
      },
    })

    renderWithRouter(<Dashboard />)

    const card = await screen.findByTestId('dash-live-card')
    expect(within(card).getByText('vs City United')).toBeInTheDocument()
    // Players watch the score from the outside — no link into the centre.
    await waitFor(() => {
      expect(within(card).queryByText(/Open live match centre/i)).not.toBeInTheDocument()
    })
  })
})
