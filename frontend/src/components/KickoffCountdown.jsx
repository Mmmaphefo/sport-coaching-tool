// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
// A countdown to kickoff that ticks every second, e.g. "Kicks off in 04:05".
import { useNow, formatCountdown } from '../lib/liveUpdates'
import './KickoffCountdown.css'

function KickoffCountdown({ kickoff, className = '' }) {
  const now = useNow(1000)
  if (!kickoff) return null
  const remaining = new Date(kickoff).getTime() - now
  return (
    <p className={`kickoff-countdown ${className}`.trim()} aria-live="off">
      {remaining > 0 ? (
        <>Kicks off in <strong>{formatCountdown(remaining)}</strong></>
      ) : (
        <strong>Kicking off…</strong>
      )}
    </p>
  )
}

export default KickoffCountdown
