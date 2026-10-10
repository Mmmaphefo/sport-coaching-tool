// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ClashBanner from './ClashBanner'

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }))
vi.mock('../lib/api', () => ({ apiRequest: mocks.apiRequest }))

const renderBanner = (props) => render(<MemoryRouter><ClashBanner getToken={vi.fn()} {...props} /></MemoryRouter>)

beforeEach(() => {
  mocks.apiRequest.mockReset()
})

describe('ClashBanner', () => {
  it('links every overlapping item, labelled sensibly', async () => {
    mocks.apiRequest.mockResolvedValue([
      { kind: 'event', id: 3, title: 'Gym session', event_date: '2026-10-20T15:00:00Z' },
      { kind: 'event', id: 4, opponent: 'Rovers', event_date: '2026-10-20T15:30:00Z' },
      { kind: 'fixture', id: 8, event_id: 12, label: 'City vs Wits', event_date: '2026-10-20T16:00:00Z' },
      { kind: 'event', id: 5, event_date: '2026-10-20T16:30:00Z' },
    ])
    renderBanner({ eventId: 9 })

    expect(await screen.findByRole('alert')).toHaveTextContent('Schedule clashes:')
    expect(mocks.apiRequest.mock.calls[0][0]).toBe('/api/events/9/clashes')
    const hrefs = screen.getAllByRole('link').map((a) => [a.textContent.split(' (')[0], a.getAttribute('href')])
    expect(hrefs).toEqual([
      ['Gym session', '/events/3'],
      ['vs Rovers', '/events/4'],
      ['City vs Wits', '/events/12'],
      ['Untitled event', '/events/5'],
    ])
  })

  it('uses the singular for one clash and checks fixtures by fixture id', async () => {
    mocks.apiRequest.mockResolvedValue([{ kind: 'event', id: 3, title: 'Gym', event_date: '2026-10-20T15:00:00Z' }])
    renderBanner({ fixtureId: 21 })
    expect(await screen.findByRole('alert')).toHaveTextContent(/Schedule clash:/)
    expect(mocks.apiRequest.mock.calls[0][0]).toBe('/api/fixtures/21/clashes')
  })

  it('shows nothing when there are no clashes, an odd response, or the check fails', async () => {
    // Factories, not promises: a rejected promise created up front, before the
    // component is there to catch it, is reported as an unhandled rejection.
    const outcomes = [
      () => Promise.resolve([]),
      () => Promise.resolve({ nope: true }),
      () => Promise.reject(new Error('down')),
    ]
    for (const outcome of outcomes) {
      mocks.apiRequest.mockImplementationOnce(outcome)
      const { container, unmount } = renderBanner({ eventId: 9 })
      await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalled())
      await act(async () => {})
      expect(container).toBeEmptyDOMElement()
      mocks.apiRequest.mockClear()
      unmount()
    }
  })
})
