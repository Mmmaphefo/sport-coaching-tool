// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
//
// The event page refreshes itself: before kickoff (with a countdown), while a
// match or league fixture is live, and not at all once the event is over.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import EventDetail, { LIVE_POLL_MS, WAITING_POLL_MS } from './EventDetail'

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

// A completed 2-2 draw with goals on both sides: enough log for the
// automatic post-match summary to wrap the match up.

// A finished match with discipline entries: the penalties section mixes
// named cards with opponent penalties (athlete_name null → "Opponent").

function simpleMatch(status, minutesToKickoff = 90) {
  return {
    event: {
      id: 9, event_type: 'match', format: 'match', opponent: 'Harbour FC', status,
      event_date: new Date(Date.now() + minutesToKickoff * 60 * 1000).toISOString(),
      location: 'Wits Stadium', duration_minutes: 90,
    },
    result: { squad: 0, opponent: 0 }, penalties: [], timeline: [],
  }
}

let payload
const reads = (path) => mocks.apiRequest.mock.calls.filter(([p, o]) => p === path && !o?.method).length

function renderLiveAt(path, data) {
  payload = data
  mocks.apiRequest.mockImplementation(async (p) => {
    if (p.startsWith('/api/events/') && !p.includes('/rsvps') && !p.includes('/clashes')) return payload
    if (p === '/api/athletes') return []
    if (p.includes('/rsvps')) return { rsvps: [], summary: null }
    return {}
  })
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/events/:id" element={<EventDetail />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  mocks.apiRequest.mockReset()
  mocks.getToken.mockResolvedValue('test-token')
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('EventDetail live updates', () => {
  it('counts down to kickoff and notices the match going live', async () => {
    renderLiveAt('/events/9', simpleMatch('scheduled'))
    expect(await screen.findByText(/Kicks off in/)).toBeInTheDocument()
    expect(screen.getByText('1h 30m 00s')).toBeInTheDocument()

    payload = simpleMatch('live', -1)
    await act(async () => { await vi.advanceTimersByTimeAsync(WAITING_POLL_MS) })
    expect(await screen.findByRole('button', { name: 'End event' })).toBeInTheDocument()
    expect(screen.queryByText(/Kicks off in/)).not.toBeInTheDocument()
  })

  it('refreshes quickly while the match is live', async () => {
    renderLiveAt('/events/9', simpleMatch('live', -10))
    await screen.findByRole('button', { name: 'End event' })
    const before = reads('/api/events/9')
    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 2) })
    expect(reads('/api/events/9') - before).toBeGreaterThanOrEqual(2)
  })

  it('refreshes a league quickly while one of its fixtures is live', async () => {
    renderLiveAt('/events/5', { ...leaguePayload, fixtures: leaguePayload.fixtures.map((f, i) => (i === 0 ? { ...f, status: 'live' } : f)) })
    await screen.findByText(leaguePayload.event.title)
    const before = reads('/api/events/5')
    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 2) })
    expect(reads('/api/events/5') - before).toBeGreaterThanOrEqual(2)
  })

  it('stops refreshing once the event is over', async () => {
    renderLiveAt('/events/9', simpleMatch('completed', -200))
    await screen.findAllByText('Harbour FC')
    const before = reads('/api/events/9')
    await act(async () => { await vi.advanceTimersByTimeAsync(WAITING_POLL_MS * 3) })
    expect(reads('/api/events/9')).toBe(before)
  })
})
