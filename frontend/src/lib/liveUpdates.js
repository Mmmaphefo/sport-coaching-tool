// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
//
// Shared helpers that keep match pages current without a page refresh:
//   - useNow:       re-renders every `intervalMs`, for ticking clocks/countdowns
//   - usePolling:   re-runs a loader on a timer, paused while the tab is
//                   hidden and run again as soon as it becomes visible
//   - formatCountdown / matchMinute: the text the clocks show
import { useEffect, useRef, useState } from 'react'

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

export function usePolling(load, intervalMs, enabled = true) {
  // Always call the latest loader without restarting the timer on each render.
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  }, [load])

  useEffect(() => {
    if (!enabled || !intervalMs) return undefined
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
    const tick = () => {
      if (visible()) loadRef.current()
    }
    const onVisibility = () => {
      if (visible()) loadRef.current()
    }
    const timer = setInterval(tick, intervalMs)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, intervalMs])
}

const pad = (n) => String(n).padStart(2, '0')

// Time until kickoff as a short, ticking label.
//   > 1 day:   "2d 3h 04m"
//   > 1 hour:  "3h 04m 05s"
//   otherwise: "04:05"
export function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (days > 0) return `${days}d ${hours}h ${pad(minutes)}m`
  if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`
  return `${pad(minutes)}:${pad(seconds)}`
}

// Whole minutes played since the anchor (kickoff or the moment it went live).
export function matchMinute(anchor, now = Date.now()) {
  if (!anchor) return 0
  return Math.max(0, Math.floor((now - new Date(anchor).getTime()) / 60000))
}
