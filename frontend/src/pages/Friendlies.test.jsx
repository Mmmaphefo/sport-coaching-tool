// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Friendlies from './Friendlies'

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), getToken: vi.fn(), confirm: vi.fn() }))
vi.mock('../lib/api', () => ({ apiRequest: mocks.apiRequest }))
vi.mock('@clerk/clerk-react', () => ({ useAuth: () => ({ getToken: mocks.getToken }) }))
vi.mock('../components/Layout', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../lib/confirm', () => ({ useConfirm: () => mocks.confirm }))

const me = { userId: 'test_clerk_user', role: 'coach', squadId: 1, athleteId: null }

// My squad (id 1) is in the directory but must not be challengeable.
const directory = [
  { id: 1, name: 'Test Squad', athlete_count: 16 },
  { id: 2, name: 'Rovers FC', athlete_count: 18 },
  { id: 3, name: 'United FC', athlete_count: 15 },
]

const friendliesList = [
  { id: 5, direction: 'incoming', status: 'proposed', proposing_squad: 'Rovers FC', opposing_squad: 'Test Squad',
    event_date: '2026-10-20T15:00:00Z', location: 'Riverside Park', message: 'Warm-up before the league?', event_id: null },
  { id: 4, direction: 'outgoing', status: 'proposed', proposing_squad: 'Test Squad', opposing_squad: 'County FC',
    event_date: '2026-10-27T15:00:00Z', location: null, message: null, event_id: null },
  { id: 3, direction: 'outgoing', status: 'accepted', proposing_squad: 'Test Squad', opposing_squad: 'United FC',
    event_date: '2026-10-13T15:00:00Z', event_id: 42 },
  { id: 2, direction: 'incoming', status: 'declined', proposing_squad: 'City FC', opposing_squad: 'Test Squad',
    event_date: '2026-10-05T15:00:00Z', decline_reason: 'Fully booked' },
  { id: 1, direction: 'outgoing', status: 'cancelled', proposing_squad: 'Test Squad', opposing_squad: 'Rovers FC',
    event_date: '2026-10-01T15:00:00Z' },
]

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

describe('Friendlies', () => {
  it('shows incoming proposals, the history table and the directory picker without own squad', async () => {
    routeCalls({
      '/api/friendlies': friendliesList,
      '/api/public/squads': directory,
      '/api/account/me': me,
    })
    render(<MemoryRouter><Friendlies /></MemoryRouter>)

    // Incoming card with both answer buttons.
    expect(await screen.findByRole('heading', { name: 'Waiting for your answer' })).toBeInTheDocument()
    expect(screen.getByText('Riverside Park')).toBeInTheDocument()
    expect(screen.getByText('“Warm-up before the league?”')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument()

    // The full list: every proposal (Rovers FC appears twice — one incoming,
    // one cancelled), sides, statuses, a decline reason, and links to the
    // accepted matches.
    expect(screen.getAllByRole('rowheader', { name: /Rovers FC|County FC|United FC|City FC/ })).toHaveLength(5)
    expect(screen.getAllByText('You proposed')).toHaveLength(3)
    expect(screen.getAllByText('They proposed')).toHaveLength(2)
    expect(screen.getAllByText('Proposed')).toHaveLength(2)
    expect(screen.getAllByText('Accepted')).toHaveLength(1)
    expect(screen.getByText('“Fully booked”')).toBeInTheDocument()
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
    const open = screen.getByRole('link', { name: 'Open' })
    expect(open).toHaveAttribute('href', '/events/42')

    // The picker lists the other public squads but never my own.
    const options = screen.getByLabelText('Opponent')
    expect(options.textContent).toContain('Rovers FC · 18 players')
    expect(options.textContent).toContain('United FC · 15 players')
    expect(options.textContent).not.toContain('Test Squad')
  })

  it('proposes a friendly and refreshes the list', async () => {
    let proposals = 0
    routeCalls({
      '/api/friendlies': (opts) => {
        if (opts.method === 'POST') {
          proposals += 1
          return { id: 6, status: 'proposed', direction: 'outgoing' }
        }
        return proposals > 0 ? [...friendliesList] : friendliesList
      },
      '/api/public/squads': directory,
      '/api/account/me': me,
    })
    render(<MemoryRouter><Friendlies /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Waiting for your answer' })

    fireEvent.change(screen.getByLabelText('Opponent'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Kickoff date'), { target: { value: '2026-10-20' } })
    fireEvent.change(screen.getByLabelText('Venue'), { target: { value: 'Home Ground' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send proposal' }))

    await waitFor(() => {
      expect(mocks.apiRequest).toHaveBeenCalledWith('/api/friendlies', {
        method: 'POST',
        body: {
          opposing_squad_id: 2,
          event_date: '2026-10-20',
          event_time: '15:00',
          location: 'Home Ground',
          message: null,
        },
        getToken: mocks.getToken,
      })
    })
    // Initial load, the proposal itself, then the refresh.
    await waitFor(() => {
      expect(mocks.apiRequest.mock.calls.filter((c) => c[0] === '/api/friendlies').length).toBe(3)
    })
  })

  it('accepts an incoming proposal after confirming and links the new match', async () => {
    let accepted = false
    const afterAccept = friendliesList.map((f) => (f.id === 5
      ? { ...f, status: 'accepted', event_id: 12 }
      : f))
    routeCalls({
      '/api/friendlies': (opts) => (opts.method === 'POST' ? { ok: true } : (accepted ? afterAccept : friendliesList)),
      '/api/public/squads': directory,
      '/api/account/me': me,
      '/api/friendlies/5/accept': () => {
        accepted = true
        return { status: 'accepted' }
      },
    })
    render(<MemoryRouter><Friendlies /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Waiting for your answer' })

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))

    await waitFor(() => {
      expect(mocks.apiRequest).toHaveBeenCalledWith('/api/friendlies/5/accept', {
        method: 'POST',
        getToken: mocks.getToken,
      })
    })
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Accept the friendly with Rovers FC?',
    }))
    // The incoming card is gone and both accepted matches are openable.
    await waitFor(() => {
      expect(screen.queryByText('“Warm-up before the league?”')).not.toBeInTheDocument()
    })
    const links = screen.getAllByRole('link', { name: 'Open' }).map((l) => l.getAttribute('href'))
    expect(links).toContain('/events/42')
    expect(links).toContain('/events/12')
  })

  it('surfaces propose errors under the form', async () => {
    routeCalls({
      '/api/friendlies': (opts) => {
        if (opts.method === 'POST') {
          throw new Error('There is already an open proposal between these squads')
        }
        return friendliesList
      },
      '/api/public/squads': directory,
      '/api/account/me': me,
    })
    render(<MemoryRouter><Friendlies /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Waiting for your answer' })

    fireEvent.change(screen.getByLabelText('Opponent'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Kickoff date'), { target: { value: '2026-10-20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send proposal' }))

    expect(await screen.findByText(/already an open proposal/)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
