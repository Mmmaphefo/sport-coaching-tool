// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
//
// Proposing a friendly from Events: format Match, type "Friendly proposal",
// opponent chosen from the registered squads (never your own), sent to
// POST /api/friendlies, with any error shown just above the form's buttons.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Events from './Events'

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), getToken: vi.fn() }))
vi.mock('../lib/api', () => ({ apiRequest: mocks.apiRequest }))
vi.mock('@clerk/clerk-react', () => ({ useAuth: () => ({ getToken: mocks.getToken }) }))
vi.mock('../components/Layout', () => ({ default: ({ children }) => <div>{children}</div> }))
// The venue map and weather are not part of this flow.
vi.mock('../components/VenueMapEditor', () => ({ default: () => null }))
vi.mock('../components/WeatherWidget', () => ({ default: () => null }))

const directory = [
  { id: 1, name: 'My Own FC', athlete_count: 12 },
  { id: 3, name: 'Apex FC', athlete_count: 14 },
  { id: 4, name: 'Soweto Boys', athlete_count: 16 },
]

function serve({ failPropose } = {}) {
  mocks.getToken.mockResolvedValue('test-token')
  mocks.apiRequest.mockReset()
  mocks.apiRequest.mockImplementation(async (path, opts = {}) => {
    if (path === '/api/friendlies' && opts.method === 'POST') {
      if (failPropose) throw new Error(failPropose)
      return { id: 77, status: 'proposed' }
    }
    if (path === '/api/events') return []
    if (path === '/api/squads/mine') return { id: 1, name: 'My Own FC', athlete_count: 12, min_roster_size: 11 }
    if (path === '/api/account/me') return { role: 'coach', squadId: 1 }
    if (path === '/api/public/squads') return { squads: directory, live: [] }
    return []
  })
  render(
    <MemoryRouter initialEntries={['/events']}>
      <Routes>
        <Route path="/events" element={<Events />} />
        <Route path="/friendlies" element={<div>FRIENDLIES PAGE</div>} />
      </Routes>
    </MemoryRouter>
  )
}

async function openForm() {
  fireEvent.click(await screen.findByRole('button', { name: /Schedule event/i }))
  return screen.getByRole('heading', { name: /Schedule event/i }).closest('form')
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('Events: proposing a friendly', () => {
  it('offers Friendly proposal as a type only for Match', async () => {
    serve()
    const form = await openForm()
    const type = within(form).getByLabelText('Type')
    expect(within(type).getByRole('option', { name: 'Friendly proposal' })).toBeInTheDocument()

    fireEvent.change(within(form).getByLabelText('Format'), { target: { value: 'training' } })
    expect(within(within(form).getByLabelText('Type')).queryByRole('option', { name: 'Friendly proposal' })).not.toBeInTheDocument()
  })

  it('lists registered squads, but not your own, and sends the proposal', async () => {
    serve()
    const form = await openForm()
    fireEvent.change(within(form).getByLabelText('Type'), { target: { value: 'friendly_proposal' } })

    const opponent = within(form).getByLabelText(/Opponent \(registered squad\)/)
    await waitFor(() => expect(within(opponent).getByRole('option', { name: 'Apex FC' })).toBeInTheDocument())
    expect(within(opponent).queryByRole('option', { name: 'My Own FC' })).not.toBeInTheDocument()

    fireEvent.change(opponent, { target: { value: '3' } })
    fireEvent.change(within(form).getByLabelText(/Date & time/), { target: { value: '2030-05-20T15:30' } })
    fireEvent.change(within(form).getByLabelText(/Message to their coach/), { target: { value: '  Warm-up game?  ' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Send friendly proposal' }))

    expect(await screen.findByText('FRIENDLIES PAGE')).toBeInTheDocument()
    const post = mocks.apiRequest.mock.calls.find(([p, o]) => p === '/api/friendlies' && o?.method === 'POST')
    expect(post[1].body).toEqual({
      opposing_squad_id: 3, event_date: '2030-05-20', event_time: '15:30', location: null, message: 'Warm-up game?',
    })
    // A proposal is not a match on our calendar until they accept.
    expect(mocks.apiRequest.mock.calls.some(([p, o]) => p === '/api/events' && o?.method === 'POST')).toBe(false)
  })

  it('asks for an opponent before sending', async () => {
    serve()
    const form = await openForm()
    fireEvent.change(within(form).getByLabelText('Type'), { target: { value: 'friendly_proposal' } })
    fireEvent.change(within(form).getByLabelText(/Date & time/), { target: { value: '2030-05-20T15:30' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Send friendly proposal' }))

    expect(await within(form).findByRole('alert')).toHaveTextContent('Choose the registered squad to propose the friendly to')
  })

  it('shows a refused proposal just above the buttons, inside the form', async () => {
    serve({ failPropose: 'Apex FC already has a match that day' })
    const form = await openForm()
    fireEvent.change(within(form).getByLabelText('Type'), { target: { value: 'friendly_proposal' } })
    const opponent = within(form).getByLabelText(/Opponent \(registered squad\)/)
    await waitFor(() => expect(within(opponent).getByRole('option', { name: 'Apex FC' })).toBeInTheDocument())
    fireEvent.change(opponent, { target: { value: '3' } })
    fireEvent.change(within(form).getByLabelText(/Date & time/), { target: { value: '2030-05-20T15:30' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Send friendly proposal' }))

    const alert = await within(form).findByRole('alert')
    expect(alert).toHaveTextContent('Apex FC already has a match that day')
    expect(alert.nextElementSibling).toHaveClass('roster-form-actions')
    expect(screen.queryByText('FRIENDLIES PAGE')).not.toBeInTheDocument()
  })
})
