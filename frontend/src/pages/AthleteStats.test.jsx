import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import AthleteStats from './AthleteStats'

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

// useCountUp drives off matchMedia/rAF which jsdom lacks — pin it to identity.
vi.mock('../lib/useCountUp', () => ({
  useCountUp: (value) => value,
}))

const basePayload = {
  athlete: {
    id: 5,
    name: 'Thabo Mokoena',
    position: 'Striker',
    squad_number: 9,
    is_managed: false,
    date_of_birth: '2002-03-14',
  },
  stats: { goals: 4, assists: 2, penalties: 1, yellowCards: 1, redCards: 0, appearances: 6 },
  logs: [
    { id: 1, event_id: 10, action_type: 'goal', value: 2, minute: 23, event_date: '2026-09-10T10:00:00.000Z', opponent: 'City United' },
    { id: 2, event_id: 11, action_type: 'assist', value: 1, minute: 40, event_date: '2026-09-05T10:00:00.000Z', opponent: null },
  ],
  injuries: [],
  currentInjury: null,
}

function renderAt(path = '/roster/5') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/roster/:id" element={<AthleteStats />} />
      </Routes>
    </MemoryRouter>
  )
}

function mockApi(payload) {
  mocks.apiRequest.mockImplementation((path) => {
    // The component appends ?season=… once a season is picked, so match the
    // endpoint rather than the exact string.
    if (path.startsWith('/api/athletes/5/stats')) return Promise.resolve(payload)
    if (path === '/api/account/me') return Promise.resolve({ role: 'coach' })
    return Promise.resolve({})
  })
}

describe('AthleteStats', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset()
    mocks.getToken.mockResolvedValue('test-token')
  })

  it('shows a loading state then the player header and stat cards', async () => {
    mockApi(basePayload)

    renderAt()

    expect(screen.getByText(/Loading athlete stats/i)).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(/Thabo Mokoena/i)).toBeInTheDocument()
      expect(screen.getByText('Goals')).toBeInTheDocument()
      expect(screen.getByText('Assists')).toBeInTheDocument()
      expect(screen.getByText('Readiness')).toBeInTheDocument()
    })
  })

  it('renders the action timeline with opponents and the empty injury state', async () => {
    mockApi(basePayload)

    renderAt()

    await waitFor(() => {
      expect(screen.getByText(/vs City United/i)).toBeInTheDocument()
      expect(screen.getByText(/No injuries logged for this athlete/i)).toBeInTheDocument()
    })
  })

  it('shows the current injury banner when one is active', async () => {
    mockApi({
      ...basePayload,
      currentInjury: { id: 7, description: 'Grade 2 hamstring strain', return_date: '2026-09-25T00:00:00.000Z' },
    })

    renderAt()

    await waitFor(() => {
      expect(screen.getByText(/Currently injured/i)).toBeInTheDocument()
      expect(screen.getByText(/Grade 2 hamstring strain/i)).toBeInTheDocument()
    })
  })

  it('switches to the goalkeeper view for keepers', async () => {
    mockApi({ ...basePayload, athlete: { ...basePayload.athlete, position: 'Goalkeeper', squad_number: 1 } })

    renderAt()

    await waitFor(() => {
      expect(screen.getByText('Save %')).toBeInTheDocument()
      expect(screen.getByText('Clean sheets')).toBeInTheDocument()
      expect(screen.getByText(/Save map/i)).toBeInTheDocument()
    })
  })

  it('opens the log injury form', async () => {
    mockApi(basePayload)

    renderAt()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Log injury/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Log injury/i }))

    expect(screen.getByRole('button', { name: /Save injury/i })).toBeInTheDocument()
  })

  it('lets assistants log injuries, not just the head coach', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/athletes/5/stats') return Promise.resolve(basePayload)
      if (path === '/api/account/me') return Promise.resolve({ role: 'assistant' })
      return Promise.resolve({})
    })

    renderAt()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Log injury/i })).toBeInTheDocument()
    })
  })

  it('hides the log injury form for athletes', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/athletes/5/stats') return Promise.resolve(basePayload)
      if (path === '/api/account/me') return Promise.resolve({ role: 'athlete', athleteId: 5 })
      return Promise.resolve({})
    })

    renderAt()

    await waitFor(() => {
      expect(screen.getByText(/Thabo Mokoena/i)).toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { name: /Log injury/i })).not.toBeInTheDocument()
  })

  it('renders season cards from the server stats rather than the log totals', async () => {
    // stats.goals is 4 while the log only holds a single 2-goal row —
    // the card must show the server figure, not a client-side recount.
    mockApi(basePayload)

    renderAt()

    await waitFor(() => {
      expect(screen.getByText('Goals')).toBeInTheDocument()
    })

    const goalsCard = screen.getByText('Goals').closest('.ath-stat-card')
    expect(goalsCard.querySelector('.ath-stat-value')).toHaveTextContent('4')
  })

  it('shows the corrected value and the corrected badge when an override exists', async () => {
    mockApi({
      ...basePayload,
      stats: { ...basePayload.stats, goals: 7 },
      overrides: { goals: { value: 7, note: 'Includes cup goals' } },
    })

    renderAt()

    await waitFor(() => {
      expect(screen.getByText('Goals')).toBeInTheDocument()
    })

    const goalsCard = screen.getByText('Goals').closest('.ath-stat-card')
    expect(goalsCard.querySelector('.ath-stat-value')).toHaveTextContent('7')
    const badge = goalsCard.querySelector('.stat-override-badge')
    expect(badge).toHaveTextContent('corrected')
    expect(badge).toHaveAttribute('title', 'Includes cup goals')

    // Stats without an override don't carry the badge.
    const assistsCard = screen.getByText('Assists').closest('.ath-stat-card')
    expect(assistsCard.querySelector('.stat-override-badge')).toBeNull()
  })

  it('renders the season picker and refetches when a season is chosen', async () => {
    mockApi({
      ...basePayload,
      seasons: ['2026/27', '2025/26'],
      seasonBreakdown: [
        { season: '2025/26', appearances: 4, goals: 3, assists: 1, penalties: 0, yellowCards: 0, redCards: 0 },
        { season: '2026/27', appearances: 2, goals: 1, assists: 1, penalties: 1, yellowCards: 1, redCards: 0 },
      ],
    })

    renderAt()

    const picker = await screen.findByRole('combobox', { name: /Season/i })
    expect(picker).toHaveValue('')
    expect(screen.getByRole('option', { name: 'All time' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '2026/27' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '2025/26' })).toBeInTheDocument()
    expect(screen.getByText('Goals by season')).toBeInTheDocument()

    fireEvent.change(picker, { target: { value: '2025/26' } })

    await waitFor(() => {
      expect(mocks.apiRequest).toHaveBeenCalledWith(
        '/api/athletes/5/stats?season=2025%2F26',
        expect.objectContaining({ getToken: mocks.getToken })
      )
    })
  })

  it('still renders when the payload carries no season or opponent breakdowns', async () => {
    // The server derives those from the log, so an athlete with no history omits
    // them entirely. Every field but `athlete` must be optional — a missing one
    // used to throw during render and blank the whole card.
    mockApi({ athlete: basePayload.athlete, logs: basePayload.logs })

    renderAt()

    await waitFor(() => {
      expect(screen.getByText(/Thabo Mokoena/i)).toBeInTheDocument()
    })

    expect(screen.getByText('Goals')).toBeInTheDocument()
    expect(screen.getByText(/No injuries logged for this athlete/i)).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /Season/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Goals by season')).not.toBeInTheDocument()
    expect(screen.queryByText('Opponent comparison')).not.toBeInTheDocument()

    // With no server stats the cards fall back to the client-side log totals.
    const goalsCard = screen.getByText('Goals').closest('.ath-stat-card')
    expect(goalsCard.querySelector('.ath-stat-value')).toHaveTextContent('2')
  })

  it('redirects a player away from another athlete card to their own', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/athletes/9/stats') {
        return Promise.resolve({ ...basePayload, athlete: { ...basePayload.athlete, id: 9 } })
      }
      if (path === '/api/account/me') return Promise.resolve({ role: 'athlete', athleteId: 5 })
      return Promise.resolve({})
    })

    render(
      <MemoryRouter initialEntries={['/roster/9']}>
        <Routes>
          <Route path="/roster/5" element={<div>OWN CARD PAGE</div>} />
          <Route path="/roster/:id" element={<AthleteStats />} />
        </Routes>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('OWN CARD PAGE')).toBeInTheDocument()
    })
  })
})
