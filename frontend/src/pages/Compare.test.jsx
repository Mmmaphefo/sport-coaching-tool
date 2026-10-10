// AI assistance: drafted with Claude (Sonnet 5) via claude.ai; reviewed and tested by the project team.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import Compare from './Compare'

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

const athletes = [
  { id: 1, name: 'Sam Peters', squad_number: 9, position: 'Forward' },
  { id: 2, name: 'Jo Lee', squad_number: 7, position: 'Midfielder' },
  { id: 3, name: 'Alex Kim', squad_number: null, position: 'Defender' },
]

const comparison = {
  athleteA: {
    name: 'Sam Peters',
    squad_number: 9,
    position: 'Forward',
    stats: { appearances: 5, goals: 4, assists: 1, involvementsPerMatch: 1, penalties: 0, yellowCards: 1, redCards: 0 },
  },
  athleteB: {
    name: 'Jo Lee',
    squad_number: 7,
    position: 'Midfielder',
    stats: { appearances: 5, goals: 2, assists: 3, involvementsPerMatch: 1, penalties: 1, yellowCards: 0, redCards: 1 },
  },
}

function renderCompare() {
  return render(<BrowserRouter><Compare /></BrowserRouter>)
}

describe('Compare', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset()
    mocks.getToken.mockResolvedValue('test-token')
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/athletes') return Promise.resolve(athletes)
      return Promise.resolve({})
    })
  })

  it('loads the roster into both selectors', async () => {
    renderCompare()

    const selectorA = await screen.findByLabelText(/Athlete A/i)
    const selectorB = screen.getByLabelText(/Athlete B/i)

    // Squad numbers prefix the names; a missing number falls back to the name.
    expect(within(selectorA).getByRole('option', { name: '#9 Sam Peters' })).toBeInTheDocument()
    expect(within(selectorA).getByRole('option', { name: '#7 Jo Lee' })).toBeInTheDocument()
    expect(within(selectorA).getByRole('option', { name: 'Alex Kim' })).toBeInTheDocument()
    expect(within(selectorB).getAllByRole('option')).toHaveLength(4) // placeholder + 3 athletes
  })

  it('keeps Compare disabled until two athletes are chosen and refuses a self-comparison', async () => {
    renderCompare()
    await screen.findByLabelText(/Athlete A/i)

    const submit = screen.getByRole('button', { name: 'Compare' })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/Athlete A/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/Athlete B/i), { target: { value: '1' } })

    await waitFor(() => expect(submit).toBeEnabled())
    fireEvent.click(submit)

    expect(await screen.findByText('Please select two different athletes')).toBeInTheDocument()
    expect(mocks.apiRequest.mock.calls.some(([path]) => path.startsWith('/api/compare'))).toBe(false)
  })

  it('fetches the head-to-head and renders the stat grid', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/athletes') return Promise.resolve(athletes)
      if (path === '/api/compare/athletes?a=1&b=2') return Promise.resolve(comparison)
      return Promise.resolve({})
    })

    renderCompare()
    await screen.findByLabelText(/Athlete A/i)

    fireEvent.change(screen.getByLabelText(/Athlete A/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/Athlete B/i), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }))

    await waitFor(() => {
      expect(mocks.apiRequest).toHaveBeenCalledWith('/api/compare/athletes?a=1&b=2', expect.anything())
    })

    // Both athlete headers carry their number and position.
    expect(await screen.findByRole('heading', { name: 'Sam Peters' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Jo Lee' })).toBeInTheDocument()
    expect(screen.getByText('#9')).toBeInTheDocument()
    expect(screen.getByText('Forward')).toBeInTheDocument()

    // Every stat box renders, with the values side by side.
    for (const label of ['Appearances', 'Goals', 'Assists', 'G+A per match', 'Penalties', 'Yellow cards', 'Red cards']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    const goalsBox = screen.getByText('Goals').closest('.cmp-stat')
    expect(within(goalsBox).getByText('4')).toBeInTheDocument()
    expect(within(goalsBox).getByText('2')).toBeInTheDocument()
    // The leading value is the highlighted one.
    expect(within(goalsBox).getByText('4')).toHaveClass('cmp-stat-leader')

    // The button comes back from its loading state.
    expect(screen.getByRole('button', { name: 'Compare' })).toBeEnabled()
  })

  it('surfaces a failed comparison instead of showing a partial grid', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/athletes') return Promise.resolve(athletes)
      if (path.startsWith('/api/compare/athletes')) {
        return Promise.reject(new Error('Comparison is unavailable right now'))
      }
      return Promise.resolve({})
    })

    renderCompare()
    await screen.findByLabelText(/Athlete A/i)

    fireEvent.change(screen.getByLabelText(/Athlete A/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/Athlete B/i), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }))

    expect(await screen.findByText('Comparison is unavailable right now')).toBeInTheDocument()
    expect(screen.queryByText('Appearances')).not.toBeInTheDocument()
  })

  it('shows the roster load error when the athletes call fails', async () => {
    mocks.apiRequest.mockImplementation((path) => {
      if (path === '/api/athletes') return Promise.reject(new Error('Could not load the roster'))
      return Promise.resolve({})
    })

    renderCompare()

    expect(await screen.findByText('Could not load the roster')).toBeInTheDocument()
  })

  it('switches to the team comparison tab', async () => {
    mocks.apiRequest.mockImplementation(async (url) => {
      if (url === '/api/athletes') return athletes
      return { period: { summary: { played: 0 }, opponents: [], matches: [] }, comparePeriod: null }
    })
    render(<BrowserRouter><Compare /></BrowserRouter>)

    fireEvent.click(screen.getByRole('tab', { name: 'Team vs opponents' }))

    expect(screen.getByRole('heading', { level: 1, name: 'Compare your team' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Team vs opponents' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText(/No finished matches in this period/)).toBeInTheDocument()
  })
})
