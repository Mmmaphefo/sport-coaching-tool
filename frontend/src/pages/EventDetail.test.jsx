import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import EventDetail from './EventDetail'

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

// StatNumber drives useCountUp via requestAnimationFrame + matchMedia, neither
// of which jsdom supports — return the target value directly.
vi.mock('../lib/useCountUp', () => ({
  useCountUp: (value) => value,
}))

const leaguePayload = {
  event: {
    id: 5,
    title: 'Sunday Pro League',
    format: 'league',
    status: 'scheduled',
    required_teams: 4,
    location: null,
    event_date: null,
  },
  teams: [
    { squad_id: 10, squad_name: 'KickStat FC', is_mine: true },
    { squad_id: 11, squad_name: 'City United', is_mine: false },
    { squad_id: 12, squad_name: 'Rovers', is_mine: false },
    { squad_id: 13, squad_name: 'Athletic 21', is_mine: false },
  ],
  fixtures: [
    {
      id: 21,
      event_id: 5,
      home_squad_id: 10,
      away_squad_id: 11,
      status: 'scheduled',
      event_date: '2026-09-20T17:00:00.000Z',
      home_squad_name: 'KickStat FC',
      away_squad_name: 'City United',
      is_home_mine: true,
      is_away_mine: false,
    },
    {
      id: 22,
      event_id: 5,
      home_squad_id: 12,
      away_squad_id: 13,
      status: 'live',
      event_date: '2026-09-19T15:00:00.000Z',
      home_squad_name: 'Rovers',
      away_squad_name: 'Athletic 21',
      is_home_mine: false,
      is_away_mine: false,
    },
  ],
  standings: [
    { squadId: 10, squadName: 'KickStat FC', played: 2, wins: 2, draws: 0, losses: 0, gf: 6, ga: 1, gd: 5, points: 6 },
    { squadId: 11, squadName: 'City United', played: 2, wins: 1, draws: 0, losses: 1, gf: 3, ga: 3, gd: 0, points: 3 },
    { squadId: 12, squadName: 'Rovers', played: 2, wins: 0, draws: 1, losses: 1, gf: 2, ga: 4, gd: -2, points: 1 },
    { squadId: 13, squadName: 'Athletic 21', played: 2, wins: 0, draws: 1, losses: 1, gf: 1, ga: 4, gd: -3, points: 1 },
  ],
  stats: {
    topScorers: [
      { athleteId: 3, athleteName: 'Sam Peters', squadId: 10, squadName: 'KickStat FC', goals: 4, assists: 1 },
      { athleteId: 7, athleteName: 'Jo Lee', squadId: 11, squadName: 'City United', goals: 2, assists: 0 },
    ],
    topAssisters: [
      { athleteId: 4, athleteName: 'Jamie Doe', squadId: 10, squadName: 'KickStat FC', goals: 0, assists: 3 },
    ],
  },
}

const openLeaguePayload = {
  event: {
    id: 6,
    title: 'Winter Cup',
    format: 'tournament',
    status: 'open',
    required_teams: 4,
    location: null,
    event_date: null,
  },
  teams: [
    { squad_id: 20, squad_name: 'Northern XI', is_mine: false },
    { squad_id: 21, squad_name: 'Harbour Boys', is_mine: false },
  ],
  fixtures: [],
  standings: [
    { squadId: 20, squadName: 'Northern XI', played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, gd: 0, points: 0 },
    { squadId: 21, squadName: 'Harbour Boys', played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, gd: 0, points: 0 },
  ],
  stats: { topScorers: [], topAssisters: [] },
}

const simpleMatchPayload = {
  event: {
    id: 7,
    event_type: 'match',
    format: 'match',
    opponent: 'Rovers FC',
    title: null,
    status: 'completed',
    event_date: '2026-09-10T18:00:00.000Z',
    location: null,
    duration_minutes: 90,
  },
  result: { squad: 3, opponent: 1 },
  penalties: [],
  timeline: [],
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/events/:id" element={<EventDetail />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('EventDetail', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset()
    mocks.getToken.mockResolvedValue('test-token')

    mocks.apiRequest.mockImplementation((path) => {
      if (path.startsWith('/api/events/5')) return Promise.resolve(leaguePayload)
      if (path.startsWith('/api/events/6')) return Promise.resolve(openLeaguePayload)
      if (path.startsWith('/api/events/7')) return Promise.resolve(simpleMatchPayload)
      if (path.startsWith('/api/athletes')) return Promise.resolve([])
      return Promise.resolve({})
    })
  })

  it('renders the league analytics: stat cards, charts, standings, leaders and fixtures', async () => {
    renderAt('/events/5')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Sunday Pro League/i })).toBeInTheDocument()
    }, { timeout: 15000 })

    // League-wide stat cards
    expect(screen.getByText('Teams')).toBeInTheDocument()
    expect(screen.getByText('Matches played')).toBeInTheDocument()
    expect(screen.getByText('Goals scored')).toBeInTheDocument()
    expect(screen.getByText('Top scorer')).toBeInTheDocument()
    expect(screen.getByText(/4 \/ 4 teams joined/i)).toBeInTheDocument()
    // The top scorer shows on the accent stat card AND the scorers leaderboard.
    expect(screen.getAllByText('Sam Peters').length).toBeGreaterThanOrEqual(2)

    // Charts + standings + leaderboards
    expect(screen.getByRole('heading', { name: /Points by team/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Goals for & against/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Standings/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Top scorers/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Top assisters/i })).toBeInTheDocument()
    expect(screen.getByText('Jamie Doe')).toBeInTheDocument()

    // My team appears across chips, charts, table and fixtures
    expect(screen.getAllByText('KickStat FC').length).toBeGreaterThanOrEqual(4)

    // Fixture grid keeps kickoff editing + live entry points
    expect(screen.getByRole('heading', { name: /^Fixtures$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Start live/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save kickoff/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/Fixture kickoff/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Go live/i })).toBeInTheDocument()
  }, 15000)

  it('shows a join button for an open league the squad has not entered', async () => {
    renderAt('/events/6')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Winter Cup/i })).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: /Join league/i })).toBeInTheDocument()
    expect(screen.getByText(/2 \/ 4 teams joined/i)).toBeInTheDocument()
    expect(screen.getByText('Your squad not entered')).toBeInTheDocument()
    expect(screen.getByText(/No goals recorded yet\./i)).toBeInTheDocument()
  })

  it('renders a completed simple match with the result and empty timeline', async () => {
    renderAt('/events/7')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Rovers FC/i })).toBeInTheDocument()
    })

    const result = document.querySelector('.event-result')
    expect(result).not.toBeNull()
    expect(within(result).getByText('3')).toBeInTheDocument()
    expect(within(result).getByText('1')).toBeInTheDocument()
    expect(within(result).getByText(/Your Squad/i)).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: /Timeline/i })).toBeInTheDocument()
    expect(screen.getByText(/No actions logged yet\./i)).toBeInTheDocument()
  })
})
