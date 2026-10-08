import { useState, useEffect, useCallback } from 'react'
import { apiRequest } from '../lib/api'
import './RsvpPanel.css'

const STATUS_LABEL = {
  pending: 'Pending',
  available: 'Available',
  unavailable: 'Unavailable',
  maybe: 'Maybe',
}

const STATUS_OPTIONS = ['available', 'maybe', 'unavailable']

// Lets a coach/assistant see (and set, on an athlete's behalf) who's
// available for an event, and lets an athlete set their own availability.
export default function RsvpPanel({ eventId, getToken }) {
  const [role, setRole] = useState(null)
  const [myAthleteId, setMyAthleteId] = useState(null)
  const [rsvps, setRsvps] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState(null)

  const load = useCallback(async () => {
    try {
      const [me, data] = await Promise.all([
        apiRequest('/api/account/me', { getToken }),
        apiRequest(`/api/events/${eventId}/rsvps`, { getToken }),
      ])
      setRole(me.role)
      setMyAthleteId(me.athleteId)
      // Guard against a missing/malformed rsvps field (e.g. an unexpected
      // response shape) rather than trusting the API always returns an
      // array — an undefined value here would otherwise silently break
      // every .find()/.map() call below.
      setRsvps(Array.isArray(data.rsvps) ? data.rsvps : [])
      setSummary(data.summary)
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [eventId, getToken])

  useEffect(() => {
    load()
  }, [load])

  async function setStatus(athleteId, status, isMine) {
    setSavingId(athleteId)
    try {
      const path = isMine
        ? `/api/events/${eventId}/rsvps/mine`
        : `/api/events/${eventId}/rsvps/${athleteId}`
      await apiRequest(path, { method: 'PUT', body: { status }, getToken })
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingId(null)
    }
  }

  if (loading) return null
  if (error) return <div className="rsvp-panel rsvp-panel-error">Couldn't load availability: {error}</div>

  const isCoachOrAssistant = role === 'coach' || role === 'assistant'

  // An athlete without an athletes-table row linked to their account
  // (shouldn't normally happen) just sees the summary, not a self-toggle.
  const mine = rsvps.find((r) => r.athlete_id === myAthleteId)

  return (
    <div className="rsvp-panel">
      <div className="rsvp-panel-header">
        <h3>Availability</h3>
        {summary && (
          <div className="rsvp-summary">
            <span className="rsvp-pill rsvp-pill-available">{summary.available} available</span>
            <span className="rsvp-pill rsvp-pill-maybe">{summary.maybe} maybe</span>
            <span className="rsvp-pill rsvp-pill-unavailable">{summary.unavailable} unavailable</span>
            <span className="rsvp-pill rsvp-pill-pending">{summary.pending} pending</span>
          </div>
        )}
      </div>

      {role === 'athlete' && mine && (
        <div className="rsvp-mine">
          <span>Your availability:</span>
          <div className="rsvp-buttons">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                className={`rsvp-btn rsvp-btn-${opt}${mine.status === opt ? ' rsvp-btn-active' : ''}`}
                disabled={savingId === myAthleteId}
                onClick={() => setStatus(myAthleteId, opt, true)}
              >
                {STATUS_LABEL[opt]}
              </button>
            ))}
          </div>
        </div>
      )}

      {isCoachOrAssistant && (
        <ul className="rsvp-list">
          {rsvps.map((r) => (
            <li key={r.athlete_id} className="rsvp-row">
              <span className="rsvp-name">{r.name}</span>
              <div className="rsvp-buttons">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    className={`rsvp-btn rsvp-btn-${opt}${r.status === opt ? ' rsvp-btn-active' : ''}`}
                    disabled={savingId === r.athlete_id}
                    onClick={() => setStatus(r.athlete_id, opt, false)}
                    title={`Mark ${r.name} as ${STATUS_LABEL[opt].toLowerCase()}`}
                  >
                    {STATUS_LABEL[opt]}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}