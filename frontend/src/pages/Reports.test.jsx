// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import SeasonReport from './SeasonReport'
import MatchReport from './MatchReport'

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), getToken: vi.fn(), download: vi.fn() }))
vi.mock('../lib/api', () => ({ apiRequest: mocks.apiRequest }))
vi.mock('@clerk/clerk-react', () => ({ useAuth: () => ({ getToken: mocks.getToken }) }))
vi.mock('../components/Layout', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../lib/csv', async (orig) => ({ ...(await orig()), downloadCsv: mocks.download }))

const side = (o = {}) => ({ goals: 0, shotsOnTarget: 0, saves: 0, penalties: 0, yellowCards: 0, redCards: 0, ...o })

const season = {
  squadName: 'Wits FC',
  from: '2026-01-01',
  to: '2026-10-09',
  summary: {
    played: 2, wins: 1, draws: 0, losses: 1, points: 3, goalsFor: 3, goalsAgainst: 2, cleanSheets: 0,
  },
  matches: [
    { kind: 'match', id: 11, date: '2026-03-01T15:00:00Z', opponent: '=Rovers', competition: null, result: 'W', us: side({ goals: 3 }), them: side({ goals: 1 }) },
    { kind: 'fixture', id: 5, date: '2026-04-01T15:00:00Z', opponent: 'City', competition: 'Spring League', result: 'L', us: side(), them: side({ goals: 1 }) },
  ],
  opponents: [{ opponent: 'City', played: 1, wins: 0, draws: 0, losses: 1, goalsFor: 0, goalsAgainst: 1 }],
  players: [{ id: 1, name: 'Sam Striker', squadNumber: 9, appearances: 2, goals: 3, assists: 0, shotsOnTarget: 4, yellowCards: 0, redCards: 0 }],
}

const matchReport = {
  squadName: 'Wits FC',
  match: { kind: 'event', id: 11, date: '2026-03-01T15:00:00Z', location: 'Home Ground', status: 'completed', competition: null, opponent: 'Rovers', home: true },
  score: { us: 2, them: 1 },
  result: 'W',
  stats: { us: side({ shotsOnTarget: 5 }), them: side({ redCards: 1 }) },
  scorers: [
    { side: 'us', name: 'Sam Striker', minute: 12, assist: 'Wes Winger' },
    { side: 'them', name: 'Rovers', minute: 30, assist: null },
  ],
  cards: [{ side: 'them', name: 'Rovers', minute: 70, card: 'red' }],
  penalties: [],
  substitutions: [{ side: 'us', off: 'Sam Striker', on: 'Ben Bench', minute: 75 }],
  timeline: [
    { minute: 12, side: 'us', action: 'goal', name: 'Sam Striker', detail: null },
    { minute: 75, side: 'us', action: 'substitution', name: 'Sam Striker', detail: 'Sam Striker off, Ben Bench on' },
  ],
}

beforeEach(() => {
  mocks.apiRequest.mockReset()
  mocks.download.mockReset()
})

describe('SeasonReport', () => {
  it('shows the record, results with links to match reports, and players', async () => {
    mocks.apiRequest.mockResolvedValue(season)
    render(<MemoryRouter><SeasonReport /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: 'Wits FC' })).toBeInTheDocument()
    expect(screen.getByText('1–0–1')).toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: 'Match report' })
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/reports/match/event/11', '/reports/match/fixture/5'])
    expect(screen.getByRole('rowheader', { name: '9. Sam Striker' })).toBeInTheDocument()
    expect(mocks.apiRequest.mock.calls[0][0]).toMatch(/^\/api\/reports\/season\?from=\d{4}-01-01&to=/)
  })

  it('downloads results and players as one CSV with formulas neutralised', async () => {
    mocks.apiRequest.mockResolvedValue(season)
    render(<MemoryRouter><SeasonReport /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Wits FC' })

    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }))

    const [filename, csv] = mocks.download.mock.calls[0]
    expect(filename).toBe('wits-fc-season-' + mocks.apiRequest.mock.calls[0][0].match(/from=([\d-]+)/)[1] + '-to-' + mocks.apiRequest.mock.calls[0][0].match(/to=([\d-]+)/)[1] + '.csv')
    expect(csv).toContain("2026-03-01,'=Rovers,Friendly,W,3,1")
    expect(csv).toContain('2026-04-01,City,Spring League,L,0,1')
    expect(csv).toContain('Sam Striker,9,2,3,0,4,0,0')
  })

  it('prints via the browser print dialog', async () => {
    mocks.apiRequest.mockResolvedValue(season)
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    render(<MemoryRouter><SeasonReport /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Wits FC' })
    fireEvent.click(screen.getByRole('button', { name: 'Print or save as PDF' }))
    expect(print).toHaveBeenCalled()
    print.mockRestore()
  })

  it('explains an empty period and disables the CSV', async () => {
    mocks.apiRequest.mockResolvedValue({ ...season, summary: { ...season.summary, played: 0 }, matches: [], players: [], opponents: [] })
    render(<MemoryRouter><SeasonReport /></MemoryRouter>)
    expect(await screen.findByText(/No finished matches in this period/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDisabled()
  })
})

describe('MatchReport', () => {
  function renderMatch(path = '/reports/match/event/11') {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/reports/match/:kind/:id" element={<MatchReport />} />
        </Routes>
      </MemoryRouter>
    )
  }

  it('renders the scoreline, scorers with assists, discipline and substitutions', async () => {
    mocks.apiRequest.mockResolvedValue(matchReport)
    renderMatch()

    expect(await screen.findByLabelText('Wits FC 2, Rovers 1')).toBeInTheDocument()
    expect(mocks.apiRequest.mock.calls[0][0]).toBe('/api/reports/match/event/11')
    expect(screen.getByText(/assisted by Wes Winger/)).toBeInTheDocument()
    expect(screen.getByText('Won')).toBeInTheDocument()
    const subs = screen.getByRole('heading', { name: 'Substitutions' }).parentElement
    expect(within(subs).getByText('Ben Bench')).toBeInTheDocument()
  })

  it('downloads the timeline as CSV', async () => {
    mocks.apiRequest.mockResolvedValue(matchReport)
    renderMatch()
    await screen.findByLabelText('Wits FC 2, Rovers 1')

    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    const [filename, csv] = mocks.download.mock.calls[0]
    expect(filename).toBe('wits-fc-vs-rovers-2026-03-01.csv')
    expect(csv.split('\r\n')[0]).toBe('Minute,Team,Action,Player,Detail')
    expect(csv).toContain('12,Wits FC,Goal,Sam Striker,')
  })

  it('puts the home team first when the squad played away', async () => {
    mocks.apiRequest.mockResolvedValue({ ...matchReport, match: { ...matchReport.match, home: false, competition: 'Spring League' } })
    renderMatch('/reports/match/fixture/5')
    expect(await screen.findByLabelText('Rovers 1, Wits FC 2')).toBeInTheDocument()
    expect(screen.getByText(/Match report, Spring League/)).toBeInTheDocument()
  })

  it('flags an unfinished match as provisional', async () => {
    mocks.apiRequest.mockResolvedValue({ ...matchReport, match: { ...matchReport.match, status: 'live' } })
    renderMatch()
    expect(await screen.findByText(/score is provisional/)).toBeInTheDocument()
  })

  it('shows the error for a match the squad cannot see', async () => {
    mocks.apiRequest.mockRejectedValue(Object.assign(new Error('Match not found'), { status: 404 }))
    renderMatch()
    expect(await screen.findByRole('alert')).toHaveTextContent('Match not found')
  })
})
