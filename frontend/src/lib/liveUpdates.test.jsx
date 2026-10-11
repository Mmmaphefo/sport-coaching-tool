// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { formatCountdown, matchMinute, usePolling, useNow } from './liveUpdates'
import KickoffCountdown from '../components/KickoffCountdown'

function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-11T15:00:00Z'))
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('formatCountdown', () => {
  it('uses days, then hours, then minutes:seconds', () => {
    expect(formatCountdown(((2 * 24 + 3) * 60 + 4) * 60 * 1000)).toBe('2d 3h 04m')
    expect(formatCountdown(((3 * 60) + 4) * 60 * 1000 + 5000)).toBe('3h 04m 05s')
    expect(formatCountdown((4 * 60 + 5) * 1000)).toBe('04:05')
    expect(formatCountdown(-5000)).toBe('00:00')
  })
})

describe('matchMinute', () => {
  it('counts whole minutes since the anchor, never negative', () => {
    expect(matchMinute('2026-10-11T14:35:30Z', Date.parse('2026-10-11T15:00:00Z'))).toBe(24)
    expect(matchMinute('2026-10-11T16:00:00Z', Date.parse('2026-10-11T15:00:00Z'))).toBe(0)
    expect(matchMinute(null)).toBe(0)
  })
})

function Poller({ load, ms, enabled }) {
  usePolling(load, ms, enabled)
  return null
}

describe('usePolling', () => {
  it('runs the loader every interval while enabled', () => {
    const load = vi.fn()
    render(<Poller load={load} ms={5000} enabled />)
    act(() => { vi.advanceTimersByTime(15000) })
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('pauses while the tab is hidden and refreshes as soon as it is shown again', () => {
    const load = vi.fn()
    render(<Poller load={load} ms={5000} enabled />)
    act(() => { setVisibility('hidden') })
    act(() => { vi.advanceTimersByTime(20000) })
    expect(load).not.toHaveBeenCalled()
    act(() => { setVisibility('visible') })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('does nothing when disabled, and stops when unmounted', () => {
    const load = vi.fn()
    const { rerender, unmount } = render(<Poller load={load} ms={5000} enabled={false} />)
    act(() => { vi.advanceTimersByTime(20000) })
    expect(load).not.toHaveBeenCalled()
    rerender(<Poller load={load} ms={5000} enabled />)
    act(() => { vi.advanceTimersByTime(5000) })
    expect(load).toHaveBeenCalledTimes(1)
    unmount()
    act(() => { vi.advanceTimersByTime(20000) })
    expect(load).toHaveBeenCalledTimes(1)
  })
})

function Clock() {
  const now = useNow(1000)
  return <span>{new Date(now).toISOString()}</span>
}

describe('useNow and KickoffCountdown', () => {
  it('ticks every second', () => {
    render(<Clock />)
    expect(screen.getByText('2026-10-11T15:00:00.000Z')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByText('2026-10-11T15:00:01.000Z')).toBeInTheDocument()
  })

  it('counts down to kickoff, then says it is kicking off', () => {
    render(<KickoffCountdown kickoff="2026-10-11T15:01:05Z" />)
    expect(screen.getByText('01:05')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(5000) })
    expect(screen.getByText('01:00')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(60000) })
    expect(screen.getByText('Kicking off…')).toBeInTheDocument()
  })

  it('renders nothing without a kickoff time', () => {
    const { container } = render(<KickoffCountdown kickoff={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
