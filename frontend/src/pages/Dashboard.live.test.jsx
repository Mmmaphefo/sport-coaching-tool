// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
//
// Dashboard live cards: a running match clock on "My live" and on every
// "Opponent live" row, and live matches appear without a page refresh.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Dashboard, { DASH_LIVE_POLL_MS, DASH_IDLE_POLL_MS } from './Dashboard'

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


const minutesAgo = (m, s = 0) => new Date(Date.now() - (m * 60 + s) * 1000).toISOString()

let summary
function serve() {
  mocks.getToken.mockResolvedValue('test-token')
  mocks.apiRequest.mockImplementation(async (path) => {
    if (path.startsWith('/api/dashboard/summary')) return summary
    if (path === '/api/account/me') return { role: 'coach' }
    return {}
  })
}
const summaryReads = () => mocks.apiRequest.mock.calls.filter(([p]) => p.startsWith('/api/dashboard/summary')).length
const renderDashboard = () => render(<MemoryRouter><Dashboard /></MemoryRouter>)

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  mocks.apiRequest.mockReset()
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('Dashboard live cards', () => {
  it("shows a running clock on My live that ticks over without a refresh", async () => {
    summary = {
      ...summaryPayload,
      liveEvent: {
        kind: 'event', id: 7, title: 'vs City United', homeLabel: 'Your squad', awayLabel: 'City United',
        homeScore: 2, awayScore: 1, link: '/live/7', startedAt: minutesAgo(23, 58),
      },
    }
    serve()
    renderDashboard()
    const card = await screen.findByTestId('dash-live-card')
    expect(within(card).getByLabelText('Minute 23')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(within(card).getByLabelText('Minute 24')).toBeInTheDocument()
  })

  it('shows each opponent live match with its own clock', async () => {
    summary = {
      ...summaryPayload,
      otherLive: [
        { kind: 'match', id: 8, squadName: 'Apex FC', opponent: 'Rovers', squadScore: 1, opponentScore: 0, startedAt: minutesAgo(10) },
        { kind: 'fixture', id: 9, homeName: 'Soweto Boys', awayName: 'Banyana', league: 'Summer', homeScore: 0, awayScore: 2, startedAt: minutesAgo(61) },
      ],
    }
    serve()
    renderDashboard()
    const others = await screen.findByTestId('dash-other-live')
    expect(within(others).getByLabelText('Minute 10')).toBeInTheDocument()
    expect(within(others).getByLabelText('Minute 61')).toBeInTheDocument()
  })

  it('picks up a match that goes live while the dashboard is open', async () => {
    summary = { ...summaryPayload }
    serve()
    renderDashboard()
    await screen.findByText(/Squad Readiness/i)
    expect(screen.queryByTestId('dash-live-card')).not.toBeInTheDocument()

    summary = {
      ...summaryPayload,
      liveEvent: {
        kind: 'event', id: 7, title: 'vs City United', homeLabel: 'Your squad', awayLabel: 'City United',
        homeScore: 0, awayScore: 0, link: '/live/7', startedAt: minutesAgo(1),
      },
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(DASH_IDLE_POLL_MS) })
    expect(await screen.findByTestId('dash-live-card')).toBeInTheDocument()
  })

  it('refreshes faster while something is live', async () => {
    summary = {
      ...summaryPayload,
      liveEvent: {
        kind: 'event', id: 7, title: 'vs City United', homeLabel: 'Your squad', awayLabel: 'City United',
        homeScore: 0, awayScore: 0, link: '/live/7', startedAt: minutesAgo(5),
      },
    }
    serve()
    renderDashboard()
    await screen.findByTestId('dash-live-card')
    const before = summaryReads()
    await act(async () => { await vi.advanceTimersByTimeAsync(DASH_LIVE_POLL_MS * 2) })
    expect(summaryReads() - before).toBeGreaterThanOrEqual(2)
  })
})
