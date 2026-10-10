// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import RsvpPanel from './RsvpPanel'

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }))
vi.mock('../lib/api', () => ({ apiRequest: mocks.apiRequest }))

const rsvps = [
  { athlete_id: 1, name: 'Sam Peters', status: 'available' },
  { athlete_id: 2, name: 'Jamie Doe', status: 'pending' },
]
const summary = { available: 1, maybe: 0, unavailable: 0, pending: 1 }

function api({ role = 'coach', athleteId = null, data = { rsvps, summary }, failPut = false } = {}) {
  mocks.apiRequest.mockImplementation(async (path, opts = {}) => {
    if (opts.method === 'PUT') {
      if (failPut) throw new Error('Event has already started')
      return {}
    }
    if (path === '/api/account/me') return { role, athleteId }
    return data
  })
}

const puts = () => mocks.apiRequest.mock.calls.filter(([, o]) => o?.method === 'PUT').map(([p, o]) => [p, o.body])

beforeEach(() => {
  mocks.apiRequest.mockReset()
})

describe('RsvpPanel', () => {
  it('shows a coach the summary and lets them set any athlete', async () => {
    api()
    render(<RsvpPanel eventId={9} getToken={vi.fn()} />)
    expect(await screen.findByText('1 available')).toBeInTheDocument()
    expect(screen.getByText('1 pending')).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Mark Jamie Doe as unavailable'))
    await waitFor(() => expect(puts()).toContainEqual(['/api/events/9/rsvps/2', { status: 'unavailable' }]))
  })

  it('lets an athlete set only their own availability', async () => {
    api({ role: 'athlete', athleteId: 2 })
    render(<RsvpPanel eventId={9} getToken={vi.fn()} />)
    const mine = (await screen.findByText('Your availability:')).parentElement
    expect(screen.queryByTitle(/Mark Sam Peters/)).not.toBeInTheDocument()

    fireEvent.click(within(mine).getByRole('button', { name: 'Available' }))
    await waitFor(() => expect(puts()).toEqual([['/api/events/9/rsvps/mine', { status: 'available' }]]))
  })

  it("shows an athlete without a linked roster row just the summary", async () => {
    api({ role: 'athlete', athleteId: 99 })
    render(<RsvpPanel eventId={9} getToken={vi.fn()} />)
    expect(await screen.findByText('1 available')).toBeInTheDocument()
    expect(screen.queryByText('Your availability:')).not.toBeInTheDocument()
  })

  it('shows why availability could not be loaded', async () => {
    mocks.apiRequest.mockImplementation(async () => { throw new Error('Event not found') })
    render(<RsvpPanel eventId={9} getToken={vi.fn()} />)
    expect(await screen.findByText(/Couldn't load availability: Event not found/)).toBeInTheDocument()
  })

  it('shows the error when saving a response fails', async () => {
    api({ failPut: true })
    render(<RsvpPanel eventId={9} getToken={vi.fn()} />)
    fireEvent.click(await screen.findByTitle('Mark Sam Peters as maybe'))
    expect(await screen.findByText(/Event has already started/)).toBeInTheDocument()
  })

  it('copes with a response that has no rsvps list', async () => {
    api({ data: { summary } })
    render(<RsvpPanel eventId={9} getToken={vi.fn()} />)
    expect(await screen.findByText('1 available')).toBeInTheDocument()
    expect(screen.queryByTitle(/Mark /)).not.toBeInTheDocument()
  })
})
