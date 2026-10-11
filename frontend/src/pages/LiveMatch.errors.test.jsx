// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
//
// Errors on the live match page appear beside the action that failed:
// under the Log Event buttons, inside the edit form, or under the header
// buttons, not at the top of the page.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import LiveMatch from './LiveMatch'
import { clearQueue } from '../lib/offlineQueue'

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

const goalEntry = {
  id: 91, minute: 23, action_type: 'goal', is_scoring: true,
  athlete_id: 1, athlete_name: 'Squad Player 1', notes: 'Header',
}

let calls
function setup({ timeline = [], fail } = {}) {
  calls = []
  mocks.getToken.mockResolvedValue('test-token')
  mocks.apiRequest.mockReset()
  mocks.apiRequest.mockImplementation(async (path, opts = {}) => {
    const method = opts.method || 'GET'
    if (method !== 'GET') {
      calls.push({ method, path, body: opts.body })
      if (fail && fail(method, path)) throw fail.error
      return method === 'POST' ? { id: 500 + calls.length, ...opts.body } : {}
    }
    if (path === '/api/events/5') {
      return eventDetail({
        event: { status: 'live', started_at: new Date(Date.now() - 30 * 60 * 1000).toISOString() },
        lineups: lineupRows(11),
        timeline,
      })
    }
    if (path === '/api/athletes') return athletes
    return {}
  })
  renderLive('/live/5')
}

const dot = (n) => screen.getByText(`${n} · Squad Player ${n}`)

beforeEach(() => {
  clearQueue('/api/events/5')
})
afterEach(() => {
  vi.restoreAllMocks()
  clearQueue('/api/events/5')
})

describe('LiveMatch errors appear where the action was made', () => {
  it('shows a refused log entry right under the Log Event buttons', async () => {
    const refused = Object.assign(new Error('This player has already been shown a red card in this match.'), { status: 400, isRetryable: false })
    setup({ fail: Object.assign((m) => m === 'POST', { error: refused }) })
    await screen.findByText('1 · Squad Player 1')
    fireEvent.click(screen.getByRole('button', { name: 'Red Card' }))
    fireEvent.click(dot(4))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('already been shown a red card')
    // Directly after the grid of action buttons.
    expect(alert.previousElementSibling).toHaveClass('live-action-grid')
  })

  it('shows a refused edit inside the edit form, above its buttons', async () => {
    const refused = Object.assign(new Error('Log entry has been deleted'), { status: 410, isRetryable: false })
    setup({ timeline: [goalEntry], fail: Object.assign((m) => m === 'PATCH', { error: refused }) })
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const form = screen.getByRole('button', { name: 'Save changes' }).closest('form')
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))

    const alert = await within(form).findByRole('alert')
    expect(alert).toHaveTextContent('Log entry has been deleted')
    expect(alert.nextElementSibling).toHaveClass('roster-form-actions')
  })

  it('shows a refused End event under the header buttons', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    setup({ fail: Object.assign((m, p) => m === 'PATCH' && p === '/api/events/5', { error: new Error('Event already completed') }) })
    await screen.findByText('1 · Squad Player 1')
    const end = screen.getByRole('button', { name: /^End (event|match)$/i })
    fireEvent.click(end)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Event already completed')
    expect(end.closest('.live-header')).toContainElement(alert)
  })
})
