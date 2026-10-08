import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import LiveMatch from './LiveMatch'

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

describe('LiveMatch lineup gate', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset()
    mocks.getToken.mockResolvedValue('test-token')
  })

  it('shows the lineup wizard instead of the pitch until a lineup exists', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/events/5') return Promise.resolve(eventDetail())
      if (path === '/api/athletes') return Promise.resolve(athletes)
      return Promise.resolve({})
    })

    renderLive('/live/5')

    expect(await screen.findByText('Set the lineups')).toBeInTheDocument()
    expect(screen.queryByText('Timeline')).not.toBeInTheDocument()

    // The wizard auto-fills a starting XI (11) plus the bench (1) and labels
    // the shape it produced.
    expect(screen.getByText('11/11')).toBeInTheDocument()
    expect(screen.getByText('4-4-2')).toBeInTheDocument()
  }, 10000)

  it('saves the auto-filled XI through the lineup endpoint', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/events/5') return Promise.resolve(eventDetail())
      if (path === '/api/athletes') return Promise.resolve(athletes)
      return Promise.resolve({ lineups: lineupRows() })
    })

    renderLive('/live/5')

    fireEvent.click(await screen.findByText('Save lineups & start'))

    await waitFor(() => {
      expect(mocks.apiRequest).toHaveBeenCalledWith(
        '/api/events/5/lineup',
        expect.objectContaining({ method: 'PUT' })
      )
    })

    const putCall = mocks.apiRequest.mock.calls.find(([path]) => path === '/api/events/5/lineup')
    const { body } = putCall[1]
    const starters = body.lineups.filter((l) => l.is_starter)
    const bench = body.lineups.filter((l) => !l.is_starter)
    expect(starters).toHaveLength(11)
    expect(bench).toHaveLength(1)
    expect(starters.every((l) => l.team_side === 'home')).toBe(true)
    expect(starters.every((l) => l.pos_x != null && l.pos_y != null)).toBe(true)
    expect(bench[0].pos_x).toBeNull()
  })

  it('renders the pitch once a lineup exists and drops the Assist quick action', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/events/5') {
        return Promise.resolve(
          eventDetail({
            event: { status: 'live', started_at: new Date().toISOString() },
            lineups: lineupRows(11),
          })
        )
      }
      if (path === '/api/athletes') return Promise.resolve(athletes)
      return Promise.resolve({})
    })

    renderLive('/live/5')

    // Pitch dots carry the starters' names.
    expect(await screen.findByText('1 · Squad Player 1')).toBeInTheDocument()
    expect(screen.getByText('11 · Squad Player 11')).toBeInTheDocument()

    // Bench row shows the non-starter.
    expect(screen.getByText('#12 Squad Player 12')).toBeInTheDocument()

    // Goal is loggable, standalone Assist is not.
    expect(screen.getByRole('button', { name: 'Goal' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Assist' })).not.toBeInTheDocument()
  })
})

// A two-incident script: a squad goal and an opponent goal. The ratings payload
// mixes one dataset hit with one position estimate.
const simScript = {
  mode: 'quick',
  events: [
    { minute: 12, team_side: 'home', action_type: 'goal', is_scoring: true, athlete_id: 1 },
    { minute: 40, team_side: 'away', action_type: 'goal', is_scoring: true, athlete_id: null },
  ],
  summary: {
    homeStrength: 78.5,
    awayStrength: 76,
    homeExpectedGoals: 1.8,
    awayExpectedGoals: 1.1,
    homeGoals: 1,
    awayGoals: 1,
    eventCount: 2,
  },
  ratings: {
    1: { overall: 84, position: 'ST', source: 'dataset' },
    2: { overall: 75, position: 'CM', source: 'estimated' },
  },
}

describe('LiveMatch simulation', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset()
    mocks.getToken.mockResolvedValue('test-token')
  })

  function mockSimulation() {
    let logId = 100
    mocks.apiRequest.mockImplementation((path, options) => {
      if (path === '/api/athletes') return Promise.resolve(athletes)
      if (path.endsWith('/simulate')) return Promise.resolve(simScript)
      if (path === '/api/events/5/logs') {
        logId += 1
        return Promise.resolve({ id: logId, ...options.body })
      }
      if (path === '/api/events/5') {
        return Promise.resolve(
          eventDetail({
            event: { status: 'live', started_at: new Date().toISOString() },
            lineups: lineupRows(11),
          })
        )
      }
      return Promise.resolve({})
    })
  }

  it('replays a Quick Sim through the normal log endpoint', async () => {
    mockSimulation()

    renderLive('/live/5')

    expect(await screen.findByRole('button', { name: 'Quick Sim' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Simulate Match' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Quick Sim' }))

    await waitFor(() => {
      expect(mocks.apiRequest).toHaveBeenCalledWith(
        '/api/events/5/simulate',
        expect.objectContaining({ method: 'POST', body: { mode: 'quick' } })
      )
    })

    // Every incident is recorded through the same endpoint a coach logs with.
    await waitFor(() => {
      expect(mocks.apiRequest).toHaveBeenCalledWith(
        '/api/events/5/logs',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({ minute: 12, action_type: 'goal', athlete_id: 1 }),
        })
      )
    })
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/api/events/5/logs',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({ minute: 40, action_type: 'goal', athlete_id: null }),
      })
    )

    // Both incidents land on the timeline: the squad player by name, the
    // opponent action as "Opponent".
    expect(await screen.findByText('Simulation complete')).toBeInTheDocument()
    expect(screen.getByText("12'")).toBeInTheDocument()
    expect(screen.getByText("40'")).toBeInTheDocument()
    expect(screen.getByText('Squad Player 1')).toBeInTheDocument()
    expect(screen.getByText('2 logged incidents', { exact: false })).toBeInTheDocument()

    // The ratings footnote is explicit about dataset hits versus estimates.
    expect(
      screen.getByText(/1 from the dataset, 1 estimated by position/i)
    ).toBeInTheDocument()
  })

  it('stops a timed Simulate Match part way through', async () => {
    mockSimulation()

    renderLive('/live/5')

    fireEvent.click(await screen.findByRole('button', { name: 'Simulate Match' }))

    await waitFor(() => {
      expect(mocks.apiRequest).toHaveBeenCalledWith(
        '/api/events/5/simulate',
        expect.objectContaining({ body: { mode: 'timed' } })
      )
    })

    // The replay walks the clock over two real minutes, so it can be stopped.
    const stop = await screen.findByRole('button', { name: 'Stop' })
    fireEvent.click(stop)

    await waitFor(
      () => expect(screen.getByText('Simulation stopped')).toBeInTheDocument(),
      { timeout: 5000 }
    )
  })

  it('offers the simulations only once the starting XI is set', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/events/5') return Promise.resolve(eventDetail())
      if (path === '/api/athletes') return Promise.resolve(athletes)
      return Promise.resolve({})
    })

    renderLive('/live/5')

    expect(await screen.findByText('Set the lineups')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Quick Sim' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Simulate Match' })).not.toBeInTheDocument()
  })
})

describe('LiveMatch player access', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset()
    mocks.getToken.mockResolvedValue('test-token')
  })

  it('redirects players to the dashboard instead of the match centre', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/account/me') return Promise.resolve({ role: 'athlete' })
      if (path === '/api/events/5') {
        return Promise.resolve(
          eventDetail({
            event: { status: 'live', started_at: new Date().toISOString() },
            lineups: lineupRows(11),
          })
        )
      }
      if (path === '/api/athletes') return Promise.resolve(athletes)
      return Promise.resolve({})
    })

    render(
      <MemoryRouter initialEntries={['/live/5']}>
        <Routes>
          <Route path="/live/:id" element={<LiveMatch />} />
          <Route path="/dashboard" element={<p>Dashboard page</p>} />
        </Routes>
      </MemoryRouter>
    )

    // Players never see the logging UI, even on an in-progress match.
    expect(await screen.findByText('Dashboard page')).toBeInTheDocument()
    expect(screen.queryByText('Timeline')).not.toBeInTheDocument()
  })
})
