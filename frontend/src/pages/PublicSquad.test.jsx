import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import PublicSquad from './PublicSquad'

function mockFetchOnce(data) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    })
  )
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/public/:id" element={<PublicSquad />} />
      </Routes>
    </MemoryRouter>
  )
}

const payload = {
  squad: { id: 1, name: 'Harwick Rovers' },
  roster: [
    { id: 1, name: 'Sam Peters', position: 'Forward', squad_number: 9 },
    { id: 2, name: 'Jo Lee', position: 'Midfielder', squad_number: 8 },
  ],
  // One win, one loss, one draw — exercises tallyRecord's three branches.
  recentResults: [
    { date: '2026-02-08', opponent: 'Brackley Town', squadScore: 2, opponentScore: 0, league: null },
    { date: '2026-02-01', opponent: 'Whitfield FC', squadScore: 1, opponentScore: 3, league: null },
    { date: '2026-01-25', opponent: 'Oldcombe United', squadScore: 1, opponentScore: 1, league: null },
  ],
  // Sam leads on goals (so is leaders[0], the backend's own sort), but Jo
  // leads on assists — exercises topAssister() picking a different player
  // than the array's first entry.
  leaders: [
    { athleteId: 1, athleteName: 'Sam Peters', goals: 4, assists: 1 },
    { athleteId: 2, athleteName: 'Jo Lee', goals: 1, assists: 3 },
  ],
}

describe('PublicSquad', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders the squad name, player count and computed W-D-L record', async () => {
    mockFetchOnce(payload)
    renderAt('/public/1')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Harwick Rovers' })).toBeInTheDocument()
    })
    expect(screen.getByText('2 players')).toBeInTheDocument()

    const record = document.querySelector('.ps-record')
    expect(within(record).getByText('Won')).toBeInTheDocument()
    expect(within(record).getByText('Drawn')).toBeInTheDocument()
    expect(within(record).getByText('Lost')).toBeInTheDocument()
    const counts = within(record).getAllByText(/^\d$/).map((el) => el.textContent)
    expect(counts).toEqual(['1', '1', '1'])
  })

  it('lists recent results with opponent names', async () => {
    mockFetchOnce(payload)
    renderAt('/public/1')

    await waitFor(() => {
      expect(screen.getByText('vs Brackley Town')).toBeInTheDocument()
    })
    expect(screen.getByText('vs Whitfield FC')).toBeInTheDocument()
    expect(screen.getByText('vs Oldcombe United')).toBeInTheDocument()
  })

  it('shows the top scorer and separately-computed top assister', async () => {
    mockFetchOnce(payload)
    renderAt('/public/1')

    await waitFor(() => {
      expect(screen.getByText('TOP SCORER')).toBeInTheDocument()
    })
    expect(screen.getByText('4 goals')).toBeInTheDocument()
    expect(screen.getByText('MOST ASSISTS')).toBeInTheDocument()
    expect(screen.getByText('3 assists')).toBeInTheDocument()
  })

  it('lists every roster player with position and squad number', async () => {
    mockFetchOnce(payload)
    renderAt('/public/1')

    await waitFor(() => {
      expect(document.querySelector('.ps-squad-grid')).toBeInTheDocument()
    })

    const grid = document.querySelector('.ps-squad-grid')
    expect(within(grid).getByText('Sam Peters')).toBeInTheDocument()
    expect(within(grid).getByText('Forward · #9')).toBeInTheDocument()
    expect(within(grid).getByText('Jo Lee')).toBeInTheDocument()
    expect(within(grid).getByText('Midfielder · #8')).toBeInTheDocument()
  })

  it('shows the empty state when there are no results or leaders yet', async () => {
    mockFetchOnce({
      squad: { id: 2, name: 'New Squad' },
      roster: [],
      recentResults: [],
      leaders: [],
    })
    renderAt('/public/2')

    await waitFor(() => {
      expect(screen.getByText('No completed games yet.')).toBeInTheDocument()
    })
    expect(screen.getByText('No goals or assists logged yet.')).toBeInTheDocument()
  })

  it('shows an error state for a squad that is not public', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'This squad has not made a public page available' }),
      })
    )
    renderAt('/public/999')

    await waitFor(() => {
      expect(
        screen.getByText('This squad has not made a public page available')
      ).toBeInTheDocument()
    })
  })
})