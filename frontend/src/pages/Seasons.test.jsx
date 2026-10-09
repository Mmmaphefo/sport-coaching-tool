// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Seasons from './Seasons'

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), getToken: vi.fn(), confirm: vi.fn() }))
vi.mock('../lib/api', () => ({ apiRequest: mocks.apiRequest }))
vi.mock('@clerk/clerk-react', () => ({ useAuth: () => ({ getToken: mocks.getToken }) }))
vi.mock('../components/Layout', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../lib/confirm', () => ({ useConfirm: () => mocks.confirm }))

const seasonsList = [
  { id: 2, name: 'Winter League', starts_on: '2026-06-01', ends_on: '2026-09-30', event_count: 2, scheduled_count: 1, completed_count: 1 },
  { id: 1, name: '2026 Season', starts_on: '2026-02-01', ends_on: '2026-11-30', event_count: 0, scheduled_count: 0, completed_count: 0 },
]

const winterDetail = {
  season: seasonsList[0],
  summary: { played: 2, wins: 1, draws: 0, losses: 1, goalsFor: 3, goalsAgainst: 2, cleanSheets: 1 },
  matches: [
    { kind: 'match', id: 11, date: '2026-06-10T15:00:00Z', opponent: 'Rovers', us: { goals: 3 }, them: { goals: 1 }, result: 'W' },
    { kind: 'match', id: 12, date: '2026-07-01T15:00:00Z', opponent: 'United', us: { goals: 0 }, them: { goals: 1 }, result: 'L' },
  ],
  opponents: [],
  schedule: [
    { id: 21, opponent: 'Rovers', event_date: '2026-07-15T15:00:00Z', status: 'scheduled', duration_minutes: 90, location: 'Home Ground', clashes: [] },
    { id: 22, opponent: 'United', event_date: '2026-06-20T15:00:00Z', status: 'completed', duration_minutes: 90, location: null, clashes: [] },
  ],
}

const emptyDetail = {
  season: seasonsList[1],
  summary: { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, cleanSheets: 0 },
  matches: [],
  opponents: [],
  schedule: [],
}

const preview = {
  dry_run: true,
  planned: [
    { opponent: 'Rovers', event_date: '2026-08-05T10:00', clashes: [{ label: 'vs County' }] },
    { opponent: 'United', event_date: '2026-08-12T10:00', clashes: [] },
  ],
  clash_count: 1,
}

// Routes the mocked apiRequest the way the page calls it. Tests can override
// individual arms by mutating the `routes` object first.
function routeCalls(routes = {}) {
  mocks.apiRequest.mockImplementation(async (path, opts = {}) => {
    const arm = routes[path]
    if (typeof arm === 'function') return arm(opts)
    if (arm !== undefined) return arm
    throw new Error(`unexpected apiRequest: ${path}`)
  })
}

beforeEach(() => {
  mocks.apiRequest.mockReset()
  mocks.confirm.mockReset()
  mocks.confirm.mockResolvedValue(true)
})

describe('Seasons', () => {
  it('lists seasons and shows the newest one with its record, breakdown and schedule', async () => {
    routeCalls({
      '/api/seasons': seasonsList,
      '/api/seasons/2': winterDetail,
    })
    render(<MemoryRouter><Seasons /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: 'Winter League' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your seasons' })).toBeInTheDocument()
    expect(screen.getByText('1–0–1')).toBeInTheDocument()
    expect(screen.getByText('3–1')).toBeInTheDocument()
    expect(screen.getAllByRole('rowheader', { name: 'Rovers' })).toHaveLength(2)
    expect(screen.getByText('Scheduled')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.queryByText('Clash')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Printable report' })).toHaveAttribute('href', '/reports?season=2')
  })

  it('creates a season and selects it', async () => {
    let list = seasonsList
    routeCalls({
      '/api/seasons': (opts) => (opts.method === 'POST'
        ? { id: 3, name: 'Spring Cup', starts_on: '2026-03-01', ends_on: '2026-08-31' }
        : list),
      '/api/seasons/2': winterDetail,
      '/api/seasons/3': {
        season: { id: 3, name: 'Spring Cup', starts_on: '2026-03-01', ends_on: '2026-08-31' },
        summary: { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, cleanSheets: 0 },
        matches: [], opponents: [], schedule: [],
      },
    })

    render(<MemoryRouter><Seasons /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Winter League' })

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Spring Cup' } })
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-03-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-31' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create season' }))

    await screen.findByRole('heading', { name: 'Spring Cup' })
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/seasons', {
      method: 'POST',
      body: { name: 'Spring Cup', starts_on: '2026-03-01', ends_on: '2026-08-31' },
      getToken: mocks.getToken,
    })
    expect(screen.getByText(/No finished matches in this season yet/)).toBeInTheDocument()
  })

  it('previews the generated schedule with clash flags', async () => {
    routeCalls({
      '/api/seasons': seasonsList,
      '/api/seasons/2': winterDetail,
      '/api/seasons/2/schedule': (opts) => (opts.body.dry_run ? preview : { created: [] }),
    })
    render(<MemoryRouter><Seasons /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Winter League' })

    fireEvent.change(screen.getByLabelText('Opponents (one per line)'), { target: { value: 'Rovers\nUnited' } })
    fireEvent.change(screen.getByLabelText('First kickoff'), { target: { value: '2026-08-05' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    expect(await screen.findByText('Preview — 2 matches, 1 with clash')).toBeInTheDocument()
    expect(screen.getByText('Clashes with vs County')).toBeInTheDocument()
    expect(screen.getByText('No clash')).toBeInTheDocument()
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/seasons/2/schedule', {
      method: 'POST',
      body: expect.objectContaining({
        opponents: ['Rovers', 'United'],
        first_kickoff: '2026-08-05',
        kickoff_time: '10:00',
        dry_run: true,
      }),
      getToken: mocks.getToken,
    })
  })

  it('creates the schedule and refreshes the season', async () => {
    let scheduled = false
    routeCalls({
      '/api/seasons': seasonsList,
      '/api/seasons/2': () => (scheduled
        ? {
            ...winterDetail,
            schedule: [
              ...winterDetail.schedule,
              { id: 23, opponent: 'Rovers', event_date: '2026-08-05T10:00:00Z', status: 'scheduled', duration_minutes: 90, location: null, clashes: [] },
            ],
          }
        : winterDetail),
      '/api/seasons/2/schedule': (opts) => {
        if (opts.body.dry_run) return preview
        scheduled = true
        return { created: [{ id: 23, opponent: 'Rovers' }] }
      },
    })
    render(<MemoryRouter><Seasons /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Winter League' })

    fireEvent.change(screen.getByLabelText('Opponents (one per line)'), { target: { value: 'Rovers' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }))

    await waitFor(() => {
      expect(mocks.apiRequest).toHaveBeenCalledWith('/api/seasons/2/schedule', {
        method: 'POST',
        body: expect.objectContaining({ opponents: ['Rovers'], dry_run: false }),
        getToken: mocks.getToken,
      })
    })
    await waitFor(() => {
      expect(screen.getAllByRole('rowheader', { name: 'Rovers' })).toHaveLength(3)
    })
  })

  it('deletes a season after confirming and falls back to the next one', async () => {
    let list = seasonsList
    routeCalls({
      '/api/seasons': (opts) => (opts.method === 'DELETE' ? { ok: true } : list),
      '/api/seasons/2': winterDetail,
      '/api/seasons/1': emptyDetail,
    })
    render(<MemoryRouter><Seasons /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Winter League' })

    const buttons = screen.getAllByRole('button', { name: 'Delete' })
    fireEvent.click(buttons[0])
    list = [seasonsList[1]]

    await screen.findByRole('heading', { name: '2026 Season' })
    expect(mocks.confirm).toHaveBeenCalled()
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/seasons/2', {
      method: 'DELETE',
      getToken: mocks.getToken,
    })
    expect(screen.getByText(/Nothing scheduled for this season yet/)).toBeInTheDocument()
  })
})
