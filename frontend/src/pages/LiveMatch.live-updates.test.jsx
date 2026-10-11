// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
//
// The live match page stays current without a refresh: it notices kickoff,
// picks up new scores, and its clock ticks over to the next minute.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import LiveMatch, { LIVE_POLL_MS, PRE_MATCH_POLL_MS } from './LiveMatch'

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  getToken: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  apiRequest: mocks.apiRequest,
  // Same verdict as the real api.js: retry offline/5xx, reject 4xx. The
  // offline tests exercise postLog's catch path, which depends on it.
  isRetryableError: (err) => Boolean(err && err.isRetryable),
}))

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: mocks.getToken }),
}))

vi.mock('../components/Layout', () => ({
  default: ({ children }) => <div>{children}</div>,
}))

const athletes = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  name: `Squad Player ${i + 1}`,
  squad_number: i + 1,
  position: 'Midfielder',
  photo: null,
}))

function eventDetail(overrides = {}) {
  return {
    event: {
      id: 5,
      status: 'scheduled',
      opponent: 'Riverside FC',
      event_type: 'match',
      event_date: new Date(Date.now() - 60 * 1000).toISOString(),
      started_at: null,
      ...overrides.event,
    },
    result: { squad: 0, opponent: 0 },
    penalties: [],
    timeline: overrides.timeline || [],
    lineups: overrides.lineups || [],
  }
}

function lineupRows(starterCount = 11) {
  return athletes.slice(0, starterCount + 1).map((a, i) => ({
    athlete_id: a.id,
    team_side: 'home',
    is_starter: i < starterCount,
    pos_x: i < starterCount ? 10 + (i % 4) * 25 : null,
    pos_y: i < starterCount ? 20 + Math.floor(i / 4) * 25 : null,
    name: a.name,
    squad_number: a.squad_number,
    position: a.position,
    photo: a.photo,
  }))
}

function renderLive(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/live/:id" element={<LiveMatch />} />
        <Route path="/live/fixture/:fixtureId" element={<LiveMatch />} />
      </Routes>
    </MemoryRouter>
  )
}

let current
function serve() {
  mocks.getToken.mockResolvedValue('test-token')
  mocks.apiRequest.mockReset()
  mocks.apiRequest.mockImplementation(async (path) => {
    if (path === '/api/events/5') return current
    if (path === '/api/athletes') return athletes
    return {}
  })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('LiveMatch live updates', () => {
  it('switches from the pre-match view to live logging by itself at kickoff', async () => {
    current = eventDetail({
      event: { status: 'scheduled', event_date: new Date(Date.now() + 60 * 1000).toISOString() },
      lineups: lineupRows(11),
    })
    serve()
    renderLive('/live/5')
    expect(await screen.findByText(/this page switches to live logging by itself/)).toBeInTheDocument()
    expect(screen.getByText(/Kicks off in/)).toBeInTheDocument()

    // The server kicks the match off; the page picks it up on its next read.
    current = eventDetail({
      event: { status: 'live', started_at: new Date().toISOString() },
      lineups: lineupRows(11),
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(PRE_MATCH_POLL_MS) })
    expect(await screen.findByRole('button', { name: 'Goal' })).toBeInTheDocument()
  })

  it('shows a new score without a refresh', async () => {
    const started = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    current = eventDetail({ event: { status: 'live', started_at: started }, lineups: lineupRows(11) })
    serve()
    renderLive('/live/5')
    await screen.findByRole('button', { name: 'Goal' })
    const reads = () => mocks.apiRequest.mock.calls.filter(([p]) => p === '/api/events/5').length
    const before = reads()

    current = {
      ...eventDetail({ event: { status: 'live', started_at: started }, lineups: lineupRows(11) }),
      result: { squad: 2, opponent: 1 },
      timeline: [
        { id: 1, minute: 3, action_type: 'goal', is_scoring: true, athlete_id: 1, athlete_name: 'Squad Player 1' },
        { id: 2, minute: 6, action_type: 'goal', is_scoring: true, athlete_id: null },
        { id: 3, minute: 9, action_type: 'goal', is_scoring: true, athlete_id: 2, athlete_name: 'Squad Player 2' },
      ],
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_POLL_MS) })
    expect(reads()).toBeGreaterThan(before)
    expect(await screen.findByText('Squad Player 2')).toBeInTheDocument()
  })

  it("ticks the match clock over to the next minute without waiting half a minute", async () => {
    // Kicked off 9 minutes 58 seconds ago.
    const started = new Date(Date.now() - (9 * 60 + 58) * 1000).toISOString()
    current = eventDetail({ event: { status: 'live', started_at: started }, lineups: lineupRows(11) })
    serve()
    renderLive('/live/5')
    expect(await screen.findByText("9'")).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(screen.getByText("10'")).toBeInTheDocument()
  })
})
