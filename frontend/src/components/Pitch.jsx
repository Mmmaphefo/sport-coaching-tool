import { initialsOf, ratingColor } from '../lib/lineups'
import './Pitch.css'

function clampPct(value) {
  return Math.min(98, Math.max(2, Math.round(value)))
}

function PitchPlayer({ player, side, editable, selected, faded, onSelect, onMove }) {
  function beginDrag(e) {
    if (!editable) return
    e.preventDefault()
    e.stopPropagation()
    // Walk up to the pitch frame so moves outside the dot still count.
    const frame = e.currentTarget.closest('.pitch-frame')
    if (!frame) return
    e.target.setPointerCapture?.(e.pointerId)

    const move = (ev) => {
      const rect = frame.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const x = ((ev.clientX - rect.left) / rect.width) * 100
      const y = ((ev.clientY - rect.top) / rect.height) * 100
      onMove?.(player.athlete_id, side, clampPct(x), clampPct(y))
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    move(e)
  }

  const color = player.rating != null ? ratingColor(player.rating) : null
  const classes = [
    'pitch-player',
    `pitch-player-${side}`,
    selected ? 'is-selected' : '',
    faded ? 'is-faded' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={classes}
      style={{ left: `${player.pos_x}%`, top: `${player.pos_y}%` }}
      onPointerDown={editable ? beginDrag : undefined}
      onClick={!editable && onSelect ? () => onSelect(player, side) : undefined}
    >
      <span className="pitch-dot">
        {player.photo ? (
          <img className="pitch-dot-img" src={player.photo} alt="" draggable={false} />
        ) : (
          <span className="pitch-dot-initials">{initialsOf(player.name)}</span>
        )}
        {color && (
          <span
            className="pitch-rating"
            style={{ background: color.bg, color: color.fg }}
            aria-label={`Rating ${player.rating.toFixed(1)}`}
          >
            {player.rating.toFixed(1)}
          </span>
        )}
      </span>
      <span className="pitch-player-name">
        {player.squad_number != null ? `${player.squad_number} · ` : ''}{player.name}
      </span>
    </div>
  )
}

// A portrait football pitch (vibrant green, home at the bottom attacking up)
// that renders both lineups as positioned player dots. In `editable` mode the
// dots drag freely; otherwise they are tappable for logging.
export default function Pitch({
  homePlayers = [],
  awayPlayers = [],
  editable = false,
  selectedId = null,
  fadedIds = null,
  onSelect,
  onMove,
}) {
  return (
    <div className={`pitch-frame${editable ? ' is-editable' : ''}`}>
      <div className="pitch-border" aria-hidden="true" />
      <div className="pitch-line pitch-line-half" aria-hidden="true" />
      <div className="pitch-circle" aria-hidden="true" />
      <div className="pitch-box pitch-box-home" aria-hidden="true" />
      <div className="pitch-box pitch-box-home-six" aria-hidden="true" />
      <div className="pitch-box pitch-box-away" aria-hidden="true" />
      <div className="pitch-box pitch-box-away-six" aria-hidden="true" />

      {homePlayers.map((p) => (
        <PitchPlayer
          key={`h-${p.athlete_id}`}
          player={p}
          side="home"
          editable={editable}
          selected={selectedId === p.athlete_id}
          faded={Boolean(fadedIds?.has(p.athlete_id))}
          onSelect={onSelect}
          onMove={onMove}
        />
      ))}
      {awayPlayers.map((p) => (
        <PitchPlayer
          key={`a-${p.athlete_id}`}
          player={p}
          side="away"
          editable={editable}
          selected={selectedId === p.athlete_id}
          faded={Boolean(fadedIds?.has(p.athlete_id))}
          onSelect={onSelect}
          onMove={onMove}
        />
      ))}
    </div>
  )
}
