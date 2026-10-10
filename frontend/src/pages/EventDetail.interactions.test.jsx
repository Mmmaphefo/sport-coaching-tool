// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
//
// Interaction tests for the event page (start/end a match, log, edit and undo
// actions, edit details, join a league, set a kickoff, go live). Kept in their
// own file, separate from EventDetail.test.jsx.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
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

beforeEach(() => {
  mocks.apiRequest.mockReset()
  mocks.getToken.mockResolvedValue('test-token')
})

describe('EventDetail interactions', () => {
  const athletes = [{ id: 31, name: 'Sam Peters' }, { id: 32, name: 'Jamie Doe' }]
  const scheduledMatch = (overrides = {}) => ({
    event: {
      id: 9, event_type: 'match', format: 'match', opponent: 'Harbour FC', title: null,
      status: 'scheduled', event_date: '2026-10-20T15:00:00.000Z', location: 'Wits Stadium',
      duration_minutes: 90, ...overrides,
    },
    result: { squad: 1, opponent: 0 },
    penalties: [],
    timeline: [
      { id: 91, minute: 23, action_type: 'goal', is_scoring: true, athlete_id: 31, athlete_name: 'Sam Peters', notes: 'Header' },
    ],
  })

  let calls
  function setup(payload, { failOn } = {}) {
    calls = []
    mocks.apiRequest.mockImplementation((path, opts = {}) => {
      const method = opts.method || 'GET'
      calls.push({ method, path, body: opts.body })
      if (failOn && failOn(method, path)) return Promise.reject(new Error('Server said no'))
      if (method !== 'GET') return Promise.resolve({})
      if (path === '/api/athletes') return Promise.resolve(athletes)
      if (path.startsWith('/api/events/')) return Promise.resolve(payload)
      return Promise.resolve({})
    })
  }
  const writes = () => calls.filter((c) => c.method !== 'GET')

  function renderWithLive(path) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/events/:id" element={<EventDetail />} />
          <Route path="/live/fixture/:id" element={<div>LIVE FIXTURE PAGE</div>} />
        </Routes>
      </MemoryRouter>
    )
  }

  it('starts a scheduled match live', async () => {
    setup(scheduledMatch())
    renderWithLive('/events/9')
    fireEvent.click(await screen.findByRole('button', { name: 'Start live' }))
    await waitFor(() => expect(writes()).toContainEqual({ method: 'PATCH', path: '/api/events/9', body: { status: 'live' } }))
  })

  it('ends a live match', async () => {
    setup(scheduledMatch({ status: 'live' }))
    renderWithLive('/events/9')
    fireEvent.click(await screen.findByRole('button', { name: 'End event' }))
    await waitFor(() => expect(writes()).toContainEqual({ method: 'PATCH', path: '/api/events/9', body: { status: 'completed' } }))
  })

  it('shows the server error when a status change fails', async () => {
    setup(scheduledMatch(), { failOn: (m) => m === 'PATCH' })
    renderWithLive('/events/9')
    fireEvent.click(await screen.findByRole('button', { name: 'Start live' }))
    expect(await screen.findByText('Server said no')).toBeInTheDocument()
  })

  it('logs a new action for an athlete', async () => {
    setup(scheduledMatch())
    renderWithLive('/events/9')
    const form = (await screen.findByRole('heading', { name: 'Log an action' })).closest('form')
    const [forSelect, actionSelect] = within(form).getAllByRole('combobox')
    fireEvent.change(forSelect, { target: { value: '32' } })
    fireEvent.change(actionSelect, { target: { value: 'shot_on_target' } })
    fireEvent.change(within(form).getByRole('spinbutton'), { target: { value: '41' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Log action' }))
    await waitFor(() => expect(writes()[0]).toMatchObject({
      method: 'POST', path: '/api/events/9/logs',
      body: { athlete_id: 32, action_type: 'shot_on_target', minute: 41, notes: null },
    }))
  })

  it('asks who an action is for before logging it', async () => {
    setup(scheduledMatch())
    renderWithLive('/events/9')
    const form = (await screen.findByRole('heading', { name: 'Log an action' })).closest('form')
    fireEvent.click(within(form).getByRole('button', { name: 'Log action' }))
    expect(await within(form).findByText('Select who this action is for')).toBeInTheDocument()
    expect(writes()).toEqual([])
  })

  it('logs an opposition action with no athlete', async () => {
    setup(scheduledMatch())
    renderWithLive('/events/9')
    const form = (await screen.findByRole('heading', { name: 'Log an action' })).closest('form')
    fireEvent.change(within(form).getAllByRole('combobox')[0], { target: { value: 'opponent' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Log action' }))
    await waitFor(() => expect(writes()[0].body).toMatchObject({ athlete_id: null }))
  })

  it('edits a timeline entry, and cancelling an edit resets the form', async () => {
    setup(scheduledMatch())
    renderWithLive('/events/9')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const form = screen.getByRole('heading', { name: 'Edit log entry' }).closest('form')
    expect(within(form).getAllByRole('combobox')[0]).toHaveValue('31')
    fireEvent.change(within(form).getByRole('spinbutton'), { target: { value: '25' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(writes()[0]).toMatchObject({
      method: 'PATCH', path: '/api/events/9/logs/91', body: { athlete_id: 31, minute: 25, notes: 'Header' },
    }))

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel edit' }))
    expect(screen.getByRole('heading', { name: 'Log an action' })).toBeInTheDocument()
  })

  it('shows the error when saving a log entry fails', async () => {
    setup(scheduledMatch(), { failOn: (m, p) => m === 'POST' && p.endsWith('/logs') })
    renderWithLive('/events/9')
    const form = (await screen.findByRole('heading', { name: 'Log an action' })).closest('form')
    fireEvent.change(within(form).getAllByRole('combobox')[0], { target: { value: '31' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Log action' }))
    expect(await within(form).findByText('Server said no')).toBeInTheDocument()
  })

  it('undoes an entry only after confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    setup(scheduledMatch())
    renderWithLive('/events/9')
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1))
    expect(writes()).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(writes()).toContainEqual({ method: 'DELETE', path: '/api/events/9/logs/91', body: undefined }))
    confirmSpy.mockRestore()
  })

  it('edits the event details', async () => {
    setup(scheduledMatch())
    renderWithLive('/events/9')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }))
    const form = screen.getByRole('heading', { name: 'Edit event' }).closest('form')
    const nameInput = within(form).getByDisplayValue('Harbour FC')
    fireEvent.change(nameInput, { target: { value: 'Harbour City FC' } })
    fireEvent.submit(form)
    await waitFor(() => expect(writes()[0]).toMatchObject({
      method: 'PATCH', path: '/api/events/9', body: { opponent: 'Harbour City FC', duration_minutes: 90 },
    }))
  })

  it('joins an open league', async () => {
    setup(openLeaguePayload)
    renderWithLive('/events/6')
    fireEvent.click(await screen.findByRole('button', { name: /Join league/i }))
    await waitFor(() => expect(writes()).toContainEqual({ method: 'POST', path: '/api/events/6/join', body: undefined }))
  })

  it('shows the error when joining a league fails', async () => {
    setup(openLeaguePayload, { failOn: (m) => m === 'POST' })
    renderWithLive('/events/6')
    fireEvent.click(await screen.findByRole('button', { name: /Join league/i }))
    expect(await screen.findByText('Server said no')).toBeInTheDocument()
  })

  it('saves a fixture kickoff and starts a fixture live', async () => {
    setup(leaguePayload)
    renderWithLive('/events/5')
    const kickoff = await screen.findByLabelText(/Fixture kickoff/i, {}, { timeout: 15000 })
    fireEvent.change(kickoff, { target: { value: '2026-10-25T15:00' } })
    fireEvent.click(screen.getByRole('button', { name: /Save kickoff/i }))
    await waitFor(() => expect(writes()).toContainEqual(expect.objectContaining({
      method: 'PATCH', path: expect.stringMatching(/^\/api\/fixtures\/\d+$/), body: { event_date: '2026-10-25T15:00' },
    })))

    fireEvent.click(screen.getByRole('button', { name: /Start live/i }))
    expect(await screen.findByText('LIVE FIXTURE PAGE')).toBeInTheDocument()
    expect(writes()).toContainEqual(expect.objectContaining({ method: 'PATCH', body: { status: 'live' } }))
  }, 20000)
})

