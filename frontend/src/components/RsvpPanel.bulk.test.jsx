// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
//
// RSVP panel: "Mark everyone available", errors shown where they happened
// (not replacing the panel), and automatic refresh without a page reload.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import RsvpPanel, { RSVP_REFRESH_MS } from './RsvpPanel'

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }))
vi.mock('../lib/api', () => ({ apiRequest: mocks.apiRequest }))

const rsvps = [
  { athlete_id: 1, name: 'Sam Peters', status: 'pending' },
  { athlete_id: 2, name: 'Jamie Doe', status: 'maybe' },
]
const summary = { available: 0, maybe: 1, unavailable: 0, pending: 1 }

function api({ role = 'coach', bulk, putError } = {}) {
  mocks.apiRequest.mockImplementation(async (path, opts = {}) => {
    if (opts.method === 'PUT') {
      if (putError) throw new Error(putError)
      if (path === '/api/events/9/rsvps') return bulk
      return {}
    }
    if (path === '/api/account/me') return { role, athleteId: null }
    return { rsvps, summary }
  })
}
const rsvpReads = () => mocks.apiRequest.mock.calls.filter(([p, o]) => p === '/api/events/9/rsvps' && !o?.method)

beforeEach(() => {
  mocks.apiRequest.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('RsvpPanel: mark everyone available', () => {
  it('marks the whole squad in one request and sets injured players unavailable and names them', async () => {
    api({ bulk: { updated: 9, skippedInjured: [{ id: 4, name: 'Alex Injured' }] } })
    render(<RsvpPanel eventId={9} getToken={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Mark everyone available' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Marked 9 players available. Set to unavailable (injured): Alex Injured.'
    )
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/events/9/rsvps', expect.objectContaining({
      method: 'PUT', body: { status: 'available' },
    }))
  })

  it('shows a failure right under the button and keeps the list on screen', async () => {
    api({ putError: 'Only coaches and assistants can do that' })
    render(<RsvpPanel eventId={9} getToken={vi.fn()} />)
    const button = await screen.findByRole('button', { name: 'Mark everyone available' })
    fireEvent.click(button)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Only coaches and assistants can do that')
    expect(button.parentElement).toContainElement(alert)
    expect(screen.getByText('Sam Peters')).toBeInTheDocument()
  })

  it('is not offered to athletes', async () => {
    api({ role: 'athlete' })
    render(<RsvpPanel eventId={9} getToken={vi.fn()} />)
    await screen.findByText('1 maybe')
    expect(screen.queryByRole('button', { name: 'Mark everyone available' })).not.toBeInTheDocument()
  })
})

describe('RsvpPanel: errors where they happen', () => {
  it("shows a single player's failed save under that player's row", async () => {
    api({ putError: 'Event has already started' })
    render(<RsvpPanel eventId={9} getToken={vi.fn()} />)
    fireEvent.click(await screen.findByTitle('Mark Jamie Doe as available'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Event has already started')
    const row = screen.getByText('Jamie Doe').closest('li')
    expect(within(row).getByRole('alert')).toBe(alert)
    // The rest of the panel is still usable.
    expect(screen.getByText('Sam Peters')).toBeInTheDocument()
  })
})

describe('RsvpPanel: live updates', () => {
  it('re-reads availability on a timer, without a page refresh', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api()
    render(<RsvpPanel eventId={9} getToken={vi.fn()} />)
    await screen.findByText('Sam Peters')
    const before = rsvpReads().length

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RSVP_REFRESH_MS)
    })
    await waitFor(() => expect(rsvpReads().length).toBeGreaterThan(before))
  })
})
