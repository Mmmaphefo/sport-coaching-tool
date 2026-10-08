import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { apiRequest } from '../lib/api'
import './ClashBanner.css'

// Advisory only — flags other items on the same squad's calendar (its own
// events, plus fixtures in leagues/tournaments it has joined) whose
// scheduled windows overlap this one. Never blocks anything; a coach may
// genuinely need two things happening at once (e.g. an assistant covering
// one while they run the other). Pass eventId or fixtureId — not both.
export default function ClashBanner({ eventId, fixtureId, getToken }) {
  const [clashes, setClashes] = useState([])

  useEffect(() => {
    let cancelled = false
    const path = fixtureId
      ? `/api/fixtures/${fixtureId}/clashes`
      : `/api/events/${eventId}/clashes`
    apiRequest(path, { getToken })
      .then((data) => {
        if (!cancelled) setClashes(Array.isArray(data) ? data : [])
      })
      .catch(() => {
        // A failed clash check shouldn't block viewing the event.
      })
    return () => {
      cancelled = true
    }
  }, [eventId, fixtureId, getToken])

  if (clashes.length === 0) return null

  const linkFor = (c) => (c.kind === 'fixture' ? `/events/${c.event_id}` : `/events/${c.id}`)
  const labelFor = (c) => c.label || c.title || (c.opponent ? `vs ${c.opponent}` : 'Untitled event')

  return (
    <div className="clash-banner" role="alert">
      <span className="clash-banner-icon">⚠️</span>
      <div>
        <strong>Schedule clash{clashes.length > 1 ? 'es' : ''}:</strong>{' '}
        {clashes.map((c, i) => (
          <span key={`${c.kind}-${c.id}`}>
            <Link to={linkFor(c)}>
              {labelFor(c)}
              {' '}({new Date(c.event_date).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })})
            </Link>
            {i < clashes.length - 1 ? ', ' : ''}
          </span>
        ))}
        {' '}overlaps this one.
      </div>
    </div>
  )
}