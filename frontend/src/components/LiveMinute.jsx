// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
// The running match minute (e.g. "23'"), ticking every second from when the
// match went live. Shared by the dashboard's live cards.
import { useNow, matchMinute } from '../lib/liveUpdates'

function LiveMinute({ startedAt, className = '' }) {
  const now = useNow(1000)
  if (!startedAt) return null
  return (
    <span className={`live-minute-tag ${className}`.trim()} aria-label={`Minute ${matchMinute(startedAt, now)}`}>
      {matchMinute(startedAt, now)}&prime;
    </span>
  )
}

export default LiveMinute
