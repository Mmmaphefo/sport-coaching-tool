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

  it('shows an error message when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Could not load public squads right now.')).toBeInTheDocument()
    })
  })
})