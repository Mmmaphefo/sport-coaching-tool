import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PublicLanding from './PublicLanding'

function mockFetchOnce(data) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    })
  )
}

// The page fetches the directory and the leaderboard separately; route each
// URL to its own payload. An Error value makes that request reject.
function mockFetchByUrl(handlers) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const key = String(url).includes('/api/public/leaderboard') ? 'leaderboard' : 'squads'
      const payload = handlers[key]
      if (payload instanceof Error) return Promise.reject(payload)
      return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) })
    })
  )
}

function renderPage() {
  return render(
    <MemoryRouter>
      <PublicLanding />
    </MemoryRouter>
  )
}

describe('PublicLanding', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders the public squads directory once loaded', async () => {
    mockFetchOnce({
      squads: [
        { id: 1, name: 'Harwick Rovers', athlete_count: 23 },
        { id: 2, name: 'Marlow Athletic', athlete_count: 21 },
      ],
      live: [],
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Harwick Rovers')).toBeInTheDocument()
    })
    expect(screen.getByText('Marlow Athletic')).toBeInTheDocument()
    expect(screen.getByText('23 athletes')).toBeInTheDocument()
  })

  it('shows the live banner when a match is live', async () => {
    mockFetchOnce({
      squads: [],
      live: [
        {
          kind: 'match',
          id: 5,
          squadName: 'Harwick Rovers',
          opponent: 'Marlow Athletic',
          squadScore: 2,
          opponentScore: 1,
        },
      ],
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('LIVE NOW')).toBeInTheDocument()
    })
    expect(screen.getByText('Harwick Rovers')).toBeInTheDocument()
    expect(screen.getByText('Marlow Athletic')).toBeInTheDocument()
    expect(screen.getByText('2–1')).toBeInTheDocument()
  })

  it('shows the live banner for a live fixture too', async () => {
    mockFetchOnce({
      squads: [],
      live: [
        {
          kind: 'fixture',
          id: 9,
          homeName: 'Rovers',
          awayName: 'Athletic 21',
          homeScore: 0,
          awayScore: 0,
        },
      ],
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('LIVE NOW')).toBeInTheDocument()
    })
    expect(screen.getByText('Rovers')).toBeInTheDocument()
    expect(screen.getByText('Athletic 21')).toBeInTheDocument()
  })

  it('hides the live banner when nothing is live', async () => {
    mockFetchOnce({ squads: [], live: [] })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('No public squads yet.')).toBeInTheDocument()
    })
    expect(screen.queryByText('LIVE NOW')).not.toBeInTheDocument()
  })

  it('filters teams by search query', async () => {
    mockFetchOnce({
      squads: [
        { id: 1, name: 'Harwick Rovers', athlete_count: 23 },
        { id: 2, name: 'Marlow Athletic', athlete_count: 21 },
      ],
      live: [],
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Harwick Rovers')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('Search teams...'), {
      target: { value: 'marlow' },
    })

    expect(screen.queryByText('Harwick Rovers')).not.toBeInTheDocument()
    expect(screen.getByText('Marlow Athletic')).toBeInTheDocument()
  })

  it('shows a message when a search matches no teams', async () => {
    mockFetchOnce({
      squads: [{ id: 1, name: 'Harwick Rovers', athlete_count: 23 }],
      live: [],
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Harwick Rovers')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('Search teams...'), {
      target: { value: 'zzz' },
    })

    expect(screen.getByText('No teams match your search.')).toBeInTheDocument()
  })

  it('renders the platform table ranked from the leaderboard endpoint', async () => {
    mockFetchByUrl({
      squads: { squads: [], live: [] },
      leaderboard: {
        leaderboard: [
          {
            squadId: 1,
            squadName: 'Rovers FC',
            played: 2,
            won: 2,
            drawn: 0,
            lost: 0,
            goalsFor: 5,
            goalsAgainst: 1,
            goalDifference: 4,
            cleanSheets: 1,
            points: 6,
          },
          {
            squadId: 2,
            squadName: 'Athletic United',
            played: 1,
            won: 0,
            drawn: 0,
            lost: 1,
            goalsFor: 0,
            goalsAgainst: 2,
            goalDifference: -2,
            cleanSheets: 0,
            points: 0,
          },
        ],
      },
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('PLATFORM TABLE')).toBeInTheDocument()
    })
    expect(screen.getByText('Rovers FC')).toBeInTheDocument()
    expect(screen.getByText('Athletic United')).toBeInTheDocument()
    // Goal difference is signed for positive values.
    expect(screen.getByText('+4')).toBeInTheDocument()
    expect(screen.getByText('-2')).toBeInTheDocument()
  })

  it('keeps the directory working when the leaderboard request fails', async () => {
    mockFetchByUrl({
      squads: { squads: [{ id: 1, name: 'Harwick Rovers', athlete_count: 23 }], live: [] },
      leaderboard: new Error('network down'),
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Harwick Rovers')).toBeInTheDocument()
    })
    expect(screen.queryByText('PLATFORM TABLE')).not.toBeInTheDocument()
  })

  it('shows an error message when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Could not load public squads right now.')).toBeInTheDocument()
    })
  })
})