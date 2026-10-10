// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
//
// Match-day interactions on the live match page: logging from the pitch and
// the bench (goal + assist, cards, substitutions, the substitute rule),
// editing and undoing timeline entries (online and offline), and ending the
// event. Kept separate from LiveMatch.test.jsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import LiveMatch from './LiveMatch'
import { clearQueue, getQueue } from '../lib/offlineQueue'

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

const posts = () => calls.filter((c) => c.method === 'POST' && c.path === '/api/events/5/logs')
const dot = (n) => screen.getByText(`${n} · Squad Player ${n}`)
const benchChip = () => screen.getAllByText('#12 Squad Player 12')[0]

beforeEach(() => {
  clearQueue('/api/events/5')
})
afterEach(() => {
  vi.restoreAllMocks()
  clearQueue('/api/events/5')
})

describe('LiveMatch logging from the pitch and bench', () => {
  it('logs a goal with an assist: pick Goal, tap the scorer, then the assister', async () => {
    setup()
    await screen.findByText('1 · Squad Player 1')
    fireEvent.click(screen.getByRole('button', { name: 'Goal' }))
    fireEvent.click(dot(1))
    // Tapping the scorer again is ignored while choosing the assist.
    fireEvent.click(dot(1))
    fireEvent.click(dot(2))
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0].body).toMatchObject({ athlete_id: 1, action_type: 'goal', is_scoring: true, assist_athlete_id: 2 })
  })

  it('refuses a bench player as the assister', async () => {
    setup()
    await screen.findByText('1 · Squad Player 1')
    fireEvent.click(screen.getByRole('button', { name: 'Goal' }))
    fireEvent.click(dot(1))
    fireEvent.click(benchChip())
    expect(await screen.findByText('The assist must come from a player on the pitch')).toBeInTheDocument()
    expect(posts()).toHaveLength(0)
  })

  it('logs a card straight onto a player on the pitch', async () => {
    setup()
    await screen.findByText('1 · Squad Player 1')
    fireEvent.click(screen.getByRole('button', { name: 'Yellow Card' }))
    fireEvent.click(dot(4))
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0].body).toMatchObject({ athlete_id: 4, action_type: 'yellow_card', is_scoring: false })
  })

  it('lets a substitute receive a card but nothing else', async () => {
    setup()
    await screen.findByText('1 · Squad Player 1')
    fireEvent.click(screen.getByRole('button', { name: 'Shot on Target' }))
    fireEvent.click(benchChip())
    expect(await screen.findByText('Substitutes can only receive a yellow or red card')).toBeInTheDocument()
    expect(posts()).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Red Card' }))
    fireEvent.click(benchChip())
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0].body).toMatchObject({ athlete_id: 12, action_type: 'red_card' })
  })

  it('makes a substitution: pick the player coming off, then the substitute', async () => {
    setup()
    await screen.findByText('1 · Squad Player 1')
    fireEvent.click(screen.getByRole('button', { name: 'Substitution' }))
    fireEvent.click(dot(3))
    fireEvent.click(benchChip())
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0].body).toMatchObject({ athlete_id: 3, action_type: 'substitution', substitute_athlete_id: 12 })
  })
})

describe('LiveMatch timeline edit and undo', () => {
  it('edits an entry and saves it to the server', async () => {
    setup({ timeline: [goalEntry] })
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const form = screen.getByRole('button', { name: 'Save changes' }).closest('form')
    fireEvent.change(within(form).getByRole('spinbutton'), { target: { value: '27' } })
    fireEvent.change(within(form).getByRole('textbox'), { target: { value: '  Volley  ' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(calls).toContainEqual({
      method: 'PATCH', path: '/api/events/5/logs/91',
      body: { athlete_id: 1, action_type: 'goal', is_scoring: true, minute: 27, notes: 'Volley' },
    }))
  })

  it('switches an entry to the opponent, and Cancel closes the form without saving', async () => {
    setup({ timeline: [goalEntry] })
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    let form = screen.getByRole('button', { name: 'Save changes' }).closest('form')
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    form = screen.getByRole('button', { name: 'Save changes' }).closest('form')
    fireEvent.change(within(form).getAllByRole('combobox')[0], { target: { value: 'opponent' } })
    fireEvent.change(within(form).getByRole('spinbutton'), { target: { value: '' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(calls[0]).toMatchObject({ method: 'PATCH', body: { athlete_id: null, minute: null } }))
  })

  it('queues an edit made without a connection and shows it straight away', async () => {
    const offline = Object.assign(new Error('Could not reach the server'), { isRetryable: true })
    setup({ timeline: [goalEntry], fail: Object.assign((m) => m === 'PATCH', { error: offline }) })
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const form = screen.getByRole('button', { name: 'Save changes' }).closest('form')
    fireEvent.change(within(form).getByRole('spinbutton'), { target: { value: '30' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText(/the edit is shown here and will sync automatically/)).toBeInTheDocument()
    expect(getQueue('/api/events/5')).toEqual([expect.objectContaining({ type: 'edit', method: 'PATCH', path: '/api/events/5/logs/91' })])
  })

  it('undoes an entry only after confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    setup({ timeline: [goalEntry] })
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1))
    expect(calls.filter((c) => c.method === 'DELETE')).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(calls).toContainEqual({ method: 'DELETE', path: '/api/events/5/logs/91', body: undefined }))
  })

  it('queues an undo made without a connection', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const offline = Object.assign(new Error('Could not reach the server'), { isRetryable: true })
    setup({ timeline: [goalEntry], fail: Object.assign((m) => m === 'DELETE', { error: offline }) })
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(await screen.findByText(/the undo will sync automatically/)).toBeInTheDocument()
    expect(getQueue('/api/events/5')).toEqual([expect.objectContaining({ type: 'undo', method: 'DELETE' })])
  })

  it('reloads the match when the server permanently refuses an undo', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const refused = Object.assign(new Error('Not allowed'), { status: 403, isRetryable: false })
    setup({ timeline: [goalEntry], fail: Object.assign((m) => m === 'DELETE', { error: refused }) })
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1))
    expect(getQueue('/api/events/5')).toEqual([])
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })
})

describe('LiveMatch ending the event', () => {
  it('ends a live event after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    setup()
    await screen.findByText('1 · Squad Player 1')
    fireEvent.click(screen.getByRole('button', { name: /^End (event|match)$/i }))
    await waitFor(() => expect(calls).toContainEqual({ method: 'PATCH', path: '/api/events/5', body: { status: 'completed' } }))
  })

  it('shows the error when ending fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    setup({ fail: Object.assign((m, p) => m === 'PATCH' && p === '/api/events/5', { error: new Error('Event already completed') }) })
    await screen.findByText('1 · Squad Player 1')
    fireEvent.click(screen.getByRole('button', { name: /^End (event|match)$/i }))
    expect(await screen.findByText('Event already completed')).toBeInTheDocument()
  })
})
