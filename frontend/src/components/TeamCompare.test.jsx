// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TeamCompare from './TeamCompare'

const renderTeam = () => render(<MemoryRouter><TeamCompare /></MemoryRouter>)

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), getToken: vi.fn() }))
vi.mock('../lib/api', () => ({ apiRequest: mocks.apiRequest }))
vi.mock('@clerk/clerk-react', () => ({ useAuth: () => ({ getToken: mocks.getToken }) }))

const side = (o = {}) => ({ goals: 0, shotsOnTarget: 0, saves: 0, penalties: 0, yellowCards: 0, redCards: 0, ...o })
function summary(o = {}) {
  return {
    played: 3, wins: 2, draws: 0, losses: 1, points: 6, pointsPerMatch: 2, winRate: 67,
    goalsFor: 5, goalsAgainst: 2, goalDifference: 3, cleanSheets: 1,
    us: side({ goals: 5, shotsOnTarget: 9 }), them: side({ goals: 2, yellowCards: 4 }),
    perMatch: { goalsFor: 1.67, goalsAgainst: 0.67, shotsOnTargetFor: 3, shotsOnTargetAgainst: 1 },
    ...o,
  }
}
const response = (o = {}) => ({
  period: {
    summary: summary(),
    opponents: [{ opponent: 'Rovers', played: 2, wins: 1, draws: 0, losses: 1, goalsFor: 3, goalsAgainst: 2 }],
    matches: [],
  },
  comparePeriod: null,
  ...o,
})

describe('TeamCompare', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset()
  })

  it("loads this year's record and the us-vs-opponents breakdown", async () => {
    mocks.apiRequest.mockResolvedValue(response())
    renderTeam()

    expect(await screen.findByText('2–0–1')).toBeInTheDocument()
    expect(screen.getByText('+3')).toBeInTheDocument()
    expect(screen.getByText('Shots on target')).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Record against each opponent' })
    expect(within(table).getByRole('rowheader', { name: 'Rovers' })).toBeInTheDocument()

    const url = mocks.apiRequest.mock.calls[0][0]
    expect(url).toMatch(/^\/api\/compare\/team\?from=\d{4}-01-01&to=\d{4}-\d{2}-\d{2}$/)
  })

  it('asks for a comparison period and shows how this period differs', async () => {
    mocks.apiRequest.mockResolvedValue(response())
    renderTeam()
    await screen.findByText('2–0–1')

    mocks.apiRequest.mockResolvedValue(response({
      comparePeriod: { summary: summary({ played: 4, winRate: 25, pointsPerMatch: 1, goalDifference: -2 }), opponents: [], matches: [] },
    }))
    fireEvent.change(screen.getByLabelText('Compare with'), { target: { value: 'last-year' } })

    expect(await screen.findByRole('table', { name: /this period against the comparison/ })).toBeInTheDocument()
    expect(screen.getByText('+42% win rate vs comparison')).toBeInTheDocument()
    expect(mocks.apiRequest.mock.calls.at(-1)[0]).toContain('vs_from=')
  })

  it('explains an empty period instead of showing zeros', async () => {
    mocks.apiRequest.mockResolvedValue(response({ period: { summary: summary({ played: 0 }), opponents: [], matches: [] } }))
    renderTeam()
    expect(await screen.findByText(/No finished matches in this period/)).toBeInTheDocument()
  })

  it('shows the server error', async () => {
    mocks.apiRequest.mockImplementation(async () => { throw new Error('Period: use dates in the form YYYY-MM-DD') })
    renderTeam()
    expect(await screen.findByRole('alert')).toHaveTextContent('use dates in the form')
  })

  it('custom dates send exactly the chosen range', async () => {
    mocks.apiRequest.mockResolvedValue(response())
    renderTeam()
    await screen.findByText('2–0–1')

    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'custom' } })
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-02-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-03-31' } })

    await vi.waitFor(() =>
      expect(mocks.apiRequest.mock.calls.at(-1)[0]).toBe('/api/compare/team?from=2026-02-01&to=2026-03-31')
    )
  })
})
