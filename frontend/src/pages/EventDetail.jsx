import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import Layout from '../components/Layout'
import Loader from '../components/Loader'
import { apiRequest } from '../lib/api'
import { ACTION_TYPES, formatActionType } from '../lib/actions'
import { useConfirm } from '../lib/confirm'
import WeatherWidget from '../components/WeatherWidget'
import VenueMapEditor from '../components/VenueMapEditor'
import AddressSearchInput from '../components/AddressSearchInput'
import ClashBanner from '../components/ClashBanner'
import RsvpPanel from '../components/RsvpPanel'
import { useCountUp } from '../lib/useCountUp'
import './EventDetail.css'

const emptyLogForm = {
  for: '', // athlete id as a string, or 'opponent'
  action_type: 'goal',
  is_scoring: true,
  minute: '',
  notes: '',
}

const statusLabel = {
  scheduled: 'Scheduled',
  live: 'Live',
  completed: 'Completed',
  cancelled: 'Cancelled',
  open: 'Open',
  full: 'Full',
}

// '2026-09-17T17:00:00.000Z' -> '2026-09-17T18:00' in the browser's timezone,
// suitable as the value of a datetime-local input.
function toLocalInputValue(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

// The API stores the venue pin as a number or null; the map editor treats
// null/'' as "no pin", so normalise the two the same way here.
function toCoordInput(value) {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function formatDateTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function StatNumber({ value, suffix = '' }) {
  const animated = useCountUp(value)
  return <>{animated}{suffix}</>
}

function SimpleEventDetail({ detail, athletes, id, getToken, onChange, isAthlete = false }) {
  const { event, result, timeline, availability, penalties } = detail
  const confirm = useConfirm()
  const [logForm, setLogForm] = useState(emptyLogForm)
  const [editingLogId, setEditingLogId] = useState(null)
  const [logSaving, setLogSaving] = useState(false)
  const [logError, setLogError] = useState('')
  const [error, setError] = useState('')
  const [statusSaving, setStatusSaving] = useState(false)
  const [editingEvent, setEditingEvent] = useState(false)
  const [eventForm, setEventForm] = useState(null)
  const [eventSaving, setEventSaving] = useState(false)

  function openEventEdit() {
    setEventForm({
      name: event.event_type === 'match' ? (event.opponent || '') : (event.title || ''),
      event_date: toLocalInputValue(event.event_date),
      location: event.location || '',
      lat: toCoordInput(event.location_lat),
      lng: toCoordInput(event.location_lng),
      duration_minutes: String(event.duration_minutes ?? 90),
    })
    setEditingEvent(true)
  }

  async function handleEventEditSubmit(e) {
    e.preventDefault()
    if (!eventForm) return
    setEventSaving(true)
    setError('')
    const body = {
      event_date: eventForm.event_date,
      location: eventForm.location.trim() || null,
      // Sent together, nulls included: clearing the pin in the map editor
      // should clear it on the server too.
      location_lat: eventForm.lat,
      location_lng: eventForm.lng,
      duration_minutes: Number(eventForm.duration_minutes) || 90,
    }
    if (event.event_type === 'match') {
      body.opponent = eventForm.name.trim() || null
    } else {
      body.title = eventForm.name.trim() || null
    }
    try {
      await apiRequest(`/api/events/${id}`, { method: 'PATCH', body, getToken })
      setEditingEvent(false)
      setEventForm(null)
      onChange()
    } catch (err) {
      setError(err.message)
    } finally {
      setEventSaving(false)
    }
  }

  async function handleStatusChange(status) {
    setStatusSaving(true)
    setError('')
    try {
      await apiRequest(`/api/events/${id}`, {
        method: 'PATCH',
        body: { status },
        getToken,
      })
      onChange()
    } catch (err) {
      setError(err.message)
    } finally {
      setStatusSaving(false)
    }
  }

  function resetLogForm() {
    setLogForm(emptyLogForm)
    setEditingLogId(null)
    setLogError('')
  }

  function openEditLogForm(entry) {
    setLogForm({
      for: entry.athlete_id ? String(entry.athlete_id) : 'opponent',
      action_type: entry.action_type,
      is_scoring: entry.is_scoring,
      minute: entry.minute ?? '',
      notes: entry.notes || '',
    })
    setEditingLogId(entry.id)
  }

  function handleActionTypeChange(value) {
    const meta = ACTION_TYPES.find((a) => a.value === value)
    setLogForm((f) => ({ ...f, action_type: value, is_scoring: meta ? meta.scoring : f.is_scoring }))
  }

  async function handleLogSubmit(e) {
    e.preventDefault()
    if (!logForm.for) {
      setLogError('Select who this action is for')
      return
    }

    setLogSaving(true)
    setLogError('')

    const payload = {
      athlete_id: logForm.for !== 'opponent' ? Number(logForm.for) : null,
      action_type: logForm.action_type,
      is_scoring: logForm.is_scoring,
      minute: logForm.minute !== '' ? Number(logForm.minute) : null,
      notes: logForm.notes.trim() || null,
    }

    try {
      if (editingLogId) {
        await apiRequest(`/api/events/${id}/logs/${editingLogId}`, {
          method: 'PATCH',
          body: payload,
          getToken,
        })
      } else {
        await apiRequest(`/api/events/${id}/logs`, {
          method: 'POST',
          body: payload,
          getToken,
        })
      }
      resetLogForm()
      onChange()
    } catch (err) {
      setLogError(err.message)
    } finally {
      setLogSaving(false)
    }
  }

  async function handleUndo(logId) {
    const answer = await confirm({
      title: 'Undo log entry',
      message: 'Undo this log entry? It is removed from the timeline and the match stats.',
      confirmLabel: 'Undo entry',
      tone: 'danger',
    })
    if (!answer) return
    try {
      await apiRequest(`/api/events/${id}/logs/${logId}`, { method: 'DELETE', getToken })
      onChange()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      <div className="roster-header">
        <div>
          <span className="dashboard-eyebrow">
            {event.event_type === 'match' ? 'Match' : 'Training'} · {event.status}
          </span>
           <h1>{event.opponent || 'Training session'}</h1>
          <p className="event-detail-date">{new Date(event.event_date).toLocaleString()}</p>
          {event.location && <p className="event-detail-location">📍 {event.location}</p>}
        </div>
        <div className="event-detail-actions">
          {!isAthlete && event.status === 'scheduled' && (
            <button className="btn btn-gold" disabled={statusSaving} onClick={() => handleStatusChange('live')}>
              Start live
            </button>
          )}
          {!isAthlete && event.status === 'live' && (
            <button className="btn btn-danger" disabled={statusSaving} onClick={() => handleStatusChange('completed')}>
              End event
            </button>
         )}
          {!isAthlete && (event.status === 'scheduled' || event.status === 'live') && (
            <button className="btn btn-ghost" onClick={openEventEdit}>
              Edit details
            </button>
          )}
          {event.event_type === 'match' && event.status === 'completed' && (
            <Link to={`/reports/match/event/${id}`} className="btn btn-ghost">
              Match report
            </Link>
          )}
        </div>
      </div>

      {editingEvent && eventForm && (
        <form className="roster-form" onSubmit={handleEventEditSubmit}>
          <h3>Edit event</h3>
          <div className="roster-form-grid">
            <label>
              {event.event_type === 'match' ? 'Opponent' : 'Title'}
              <input
                type="text"
                value={eventForm.name}
                onChange={(e) => setEventForm({ ...eventForm, name: e.target.value })}
              />
            </label>
            <label>
              Date &amp; time
              <input
                type="datetime-local"
                value={eventForm.event_date}
                onChange={(e) => setEventForm({ ...eventForm, event_date: e.target.value })}
                required
              />
            </label>
            <label>
              Location
              {/* Same single address entry as the creation form — type,
                  pick a suggestion, then fine-tune the pin on the map. */}
              <AddressSearchInput
                value={eventForm.location}
                onChange={(text) => setEventForm((f) => ({ ...f, location: text }))}
                onPick={({ name, lat, lng }) => setEventForm((f) => ({ ...f, location: name, lat, lng }))}
                proximity={
                  eventForm.lat !== null && eventForm.lng !== null
                    ? { lat: Number(eventForm.lat), lng: Number(eventForm.lng) }
                    : undefined
                }
              />
            </label>
            <label>
              Duration (minutes)
              <input
                type="number"
                min="1"
                value={eventForm.duration_minutes}
                onChange={(e) => setEventForm({ ...eventForm, duration_minutes: e.target.value })}
              />
            </label>
            <div className="roster-form-wide">
              <span className="event-form-map-heading">Pitch pin — chosen from the address above; drag the pin or the map to fine-tune</span>
              <VenueMapEditor
                latitude={eventForm.lat}
                longitude={eventForm.lng}
                label={eventForm.location}
                searchable={false}
                onChange={({ lat, lng }) => setEventForm((f) => ({ ...f, lat, lng }))}
              />
            </div>
          </div>
          <div className="roster-form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => { setEditingEvent(false); setEventForm(null) }}>
              Cancel
            </button>
            <button type="submit" className="btn btn-gold" disabled={eventSaving}>
              {eventSaving ? <Loader inline label="Saving..." /> : 'Save changes'}
            </button>
          </div>
        </form>
      )}

      <ClashBanner eventId={id} getToken={getToken} />
      <RsvpPanel eventId={id} getToken={getToken} />

      {event.status === 'scheduled' && availability && !availability.meets && !isAthlete && (
        <div className="event-availability-note">
          <strong>
            {availability.available} of {availability.required} players available
          </strong>{' '}
          — the match can&apos;t go live until at least {availability.required} players are marked
          available in the RSVP panel above.
        </div>
      )}

      {(event.location || event.location_lat) && (
        <WeatherWidget
          location={event.location}
          latitude={event.location_lat}
          longitude={event.location_lng}
        />
      )}

      {error && <div className="roster-error">{error}</div>}

      {event.event_type === 'match' && (
        <div className="event-result">
          <div className="event-result-side">
            <span className="event-result-label">Your Squad</span>
            <span className="event-result-score">{result.squad}</span>
          </div>
          <span className="event-result-sep">—</span>
          <div className="event-result-side">
            <span className="event-result-score">{result.opponent}</span>
            <span className="event-result-label">{event.opponent || 'Opponent'}</span>
          </div>
        </div>
      )}

      {penalties && penalties.length > 0 && (
        <div className="event-penalties">
          <h3>Penalties & Cards</h3>
          <ul className="event-penalties-list">
            {penalties.map((p) => (
              <li key={p.id} className="event-penalty-item">
                <span className="event-penalty-minute">{p.minute}'</span>
                <span className="event-penalty-type">{formatActionType(p.action_type)}</span>
                <span className="event-penalty-player">{p.athlete_name || 'Opponent'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!isAthlete && (
        <form className="roster-form" onSubmit={handleLogSubmit}>
          <h3>{editingLogId ? 'Edit log entry' : 'Log an action'}</h3>
        <div className="roster-form-grid">
          <label>
            For
            <select value={logForm.for} onChange={(e) => setLogForm({ ...logForm, for: e.target.value })}>
              <option value="" disabled>Select athlete</option>
              {athletes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}{a.squad_number != null ? ` (#${a.squad_number})` : ''}
                </option>
              ))}
              <option value="opponent">Opponent</option>
            </select>
          </label>
          <label>
            Action
            <select value={logForm.action_type} onChange={(e) => handleActionTypeChange(e.target.value)}>
              {ACTION_TYPES.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </label>
          <label>
            Minute
            <input
              type="number"
              min="0"
              value={logForm.minute}
              onChange={(e) => setLogForm({ ...logForm, minute: e.target.value })}
            />
          </label>
          <label className="roster-form-checkbox">
            <input
              type="checkbox"
              checked={logForm.is_scoring}
              onChange={(e) => setLogForm({ ...logForm, is_scoring: e.target.checked })}
            />
            Counts toward result
          </label>
          <label className="roster-form-wide">
            Notes
            <input
              type="text"
              value={logForm.notes}
              onChange={(e) => setLogForm({ ...logForm, notes: e.target.value })}
              placeholder="Optional"
            />
          </label>
        </div>
        <div className="roster-form-actions">
          {editingLogId && (
            <button type="button" className="btn btn-ghost" onClick={resetLogForm}>
              Cancel edit
            </button>
          )}
          <button type="submit" className="btn btn-gold" disabled={logSaving}>
            {logSaving ? (
              <Loader inline label="Saving..." />
            ) : editingLogId ? (
              'Save changes'
            ) : (
              'Log action'
            )}
          </button>
        </div>
        {logError && <div className="roster-error">{logError}</div>}
      </form>
      )}

      <h3 className="event-timeline-heading">Timeline</h3>
      {timeline.length === 0 ? (
        <div className="roster-empty">
          <p>No actions logged yet.</p>
        </div>
      ) : (
        <div className="event-timeline">
          {timeline.map((entry) => (
            <div className="timeline-entry" key={entry.id}>
              <span className="timeline-minute">{entry.minute != null ? `${entry.minute}'` : '—'}</span>
              <div className="timeline-body">
                <span className="timeline-action">{formatActionType(entry.action_type)}</span>
                <span className="timeline-who">{entry.athlete_name || 'Opponent'}</span>
                {entry.notes && <span className="timeline-notes">{entry.notes}</span>}
              </div>
              {!isAthlete && (
                <div className="timeline-actions">
                  <button className="btn btn-ghost" onClick={() => openEditLogForm(entry)}>Edit</button>
                  <button className="btn btn-danger" onClick={() => handleUndo(entry.id)}>Undo</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function LeagueDetail({ detail, id, getToken, onChange, isAthlete = false }) {
  const navigate = useNavigate()
  const { event, teams, fixtures, standings, stats } = detail
  const [joining, setJoining] = useState(false)
  const [startingFixtureId, setStartingFixtureId] = useState(null)
  const [dateDrafts, setDateDrafts] = useState({})
  const [savingFixtureDateId, setSavingFixtureDateId] = useState(null)
  const [error, setError] = useState('')

  async function handleSaveFixtureDate(fixtureId) {
    const value = dateDrafts[fixtureId] || ''
    if (!value.trim()) return
    setSavingFixtureDateId(fixtureId)
    setError('')
    try {
      await apiRequest(`/api/fixtures/${fixtureId}`, {
        method: 'PATCH',
        body: { event_date: value },
        getToken,
      })
      setDateDrafts((drafts) => {
        const next = { ...drafts }
        delete next[fixtureId]
        return next
      })
      onChange()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingFixtureDateId(null)
    }
  }

  async function handleJoin() {
    setJoining(true)
    setError('')
    try {
      await apiRequest(`/api/events/${id}/join`, { method: 'POST', getToken })
      onChange()
    } catch (err) {
      setError(err.message)
    } finally {
      setJoining(false)
    }
  }

  async function handleStartFixture(fixtureId) {
    setStartingFixtureId(fixtureId)
    setError('')
    try {
      await apiRequest(`/api/fixtures/${fixtureId}`, {
        method: 'PATCH',
        body: { status: 'live' },
        getToken,
      })
      navigate(`/live/fixture/${fixtureId}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setStartingFixtureId(null)
    }
  }

  const isOpen = event.status === 'open'
  const mySquadJoined = teams.some((t) => t.is_mine)
  const formatLabel = event.format === 'league' ? 'League' : 'Tournament'
  const statusText = statusLabel[event.status] || event.status
  const mineSquadIds = new Set(teams.filter((t) => t.is_mine).map((t) => t.squad_id))

  // League-wide analytics, all derived from the real standings/fixtures payload —
  // no invented numbers, so the charts stay honest however the season develops.
  const matchesPlayed = Math.round(standings.reduce((sum, t) => sum + t.played, 0) / 2)
  const totalGoals = standings.reduce((sum, t) => sum + t.gf, 0)
  const goalsPerMatch = matchesPlayed > 0 ? (totalGoals / matchesPlayed).toFixed(1) : '0.0'
  const topScorer = stats?.topScorers?.[0] ?? null
  const topScorerGoals = topScorer ? topScorer.goals : 0
  const topAssisterAssists = stats?.topAssisters?.[0]?.assists ?? 0
  const maxPoints = Math.max(1, ...standings.map((t) => t.points))
  const maxGoalsForChart = Math.max(1, ...standings.flatMap((t) => [t.gf, t.ga]))

  return (
    <div className="lg-page">
      <header className="lg-head">
        <div className="lg-head-main">
          <span className="lg-eyebrow">
            {formatLabel} centre · {statusText}
          </span>
          <h1 className="lg-title">{event.title || 'Untitled league'}</h1>
          <div className="lg-head-meta">
            <span className="lg-tag">
              {teams.length} / {event.required_teams} teams joined
            </span>
            {event.location && <span className="lg-loc">📍 {event.location}</span>}
          </div>
        </div>
        {isOpen && !mySquadJoined && !isAthlete && (
          <button className="btn btn-gold lg-join-btn" disabled={joining} onClick={handleJoin}>
            {joining ? <Loader inline label="Joining..." /> : 'Join league'}
          </button>
        )}
      </header>

      <ClashBanner eventId={id} getToken={getToken} />

      {/* Fixtures are gated on the home squad's availability, so the panel
          that collects it belongs on the league page too. */}
      <RsvpPanel eventId={id} getToken={getToken} />

      {(event.location || event.location_lat) && (
        <WeatherWidget
          location={event.location}
          latitude={event.location_lat}
          longitude={event.location_lng}
        />
      )}

      {error && <div className="roster-error">{error}</div>}

      <div className="lg-hero">
        <div className="lg-hero-text">
          <span className="lg-hero-eyebrow">
            {formatLabel} · {statusText}
          </span>
          <h2 className="lg-hero-title">Every point earned, charted</h2>
          <p className="lg-hero-sub">
            Live standings, scoring charts and the full fixture grid — everything
            updates as results are logged.
          </p>
        </div>
        <div className="lg-hero-teams">
          {teams.map((team) => (
            <span
              key={team.squad_id}
              className={`lg-team-chip ${team.is_mine ? 'lg-team-chip-mine' : ''}`}
            >
              {team.squad_name}
            </span>
          ))}
        </div>
      </div>

      <div className="lg-stat-grid">
        <div className="lg-stat-card">
          <span className="lg-stat-label">Teams</span>
          <span className="lg-stat-value">
            <StatNumber value={teams.length} />
            <span className="lg-stat-dim">/{event.required_teams ?? '—'}</span>
          </span>
          <span className="lg-stat-note">
            {mySquadJoined ? 'Your squad is entered' : 'Your squad not entered'}
          </span>
        </div>

        <div className="lg-stat-card">
          <span className="lg-stat-label">Matches played</span>
          <span className="lg-stat-value">
            <StatNumber value={matchesPlayed} />
          </span>
          <span className="lg-stat-note">{fixtures.length} fixtures in the grid</span>
        </div>

        <div className="lg-stat-card">
          <span className="lg-stat-label">Goals scored</span>
          <span className="lg-stat-value">
            <StatNumber value={totalGoals} />
          </span>
          <span className="lg-stat-note">{goalsPerMatch} per match</span>
        </div>

        <div className="lg-stat-card lg-stat-card-accent">
          <span className="lg-stat-label">Top scorer</span>
          <span className="lg-stat-value lg-stat-value-name">
            {topScorer ? topScorer.athleteName : '—'}
          </span>
          <span className="lg-stat-note">
            {topScorer
              ? `${topScorer.goals} goal${topScorer.goals === 1 ? '' : 's'} · ${topScorer.squadName}`
              : 'No goals recorded yet'}
          </span>
        </div>
      </div>

      {standings.length > 1 && (
        <div className="lg-charts-grid">
          <div className="lg-chart-card">
            <span className="lg-chart-eyebrow">Title race</span>
            <h3>Points by team</h3>
            <div className="lg-hbars">
              {standings.map((row) => (
                <div className="lg-hbar-row" key={row.squadId}>
                  <span className="lg-hbar-name" title={row.squadName}>
                    {row.squadName}
                  </span>
                  <div className="lg-hbar-track">
                    <div
                      className={`lg-hbar-fill ${mineSquadIds.has(row.squadId) ? 'lg-hbar-fill-mine' : ''}`}
                      style={{ width: `${(row.points / maxPoints) * 100}%` }}
                    />
                  </div>
                  <span className="lg-hbar-value">{row.points}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="lg-chart-card">
            <span className="lg-chart-eyebrow">Firepower vs resilience</span>
            <h3>Goals for &amp; against</h3>
            <div className="lg-ga-chart">
              {standings.map((row) => (
                <div className="lg-ga-col" key={row.squadId}>
                  <div className="lg-ga-bars">
                    <div
                      className="lg-ga-bar lg-ga-bar-for"
                      style={{ height: `${(row.gf / maxGoalsForChart) * 100}%` }}
                    />
                    <div
                      className="lg-ga-bar lg-ga-bar-against"
                      style={{ height: `${(row.ga / maxGoalsForChart) * 100}%` }}
                    />
                  </div>
                  <span className="lg-ga-label" title={row.squadName}>
                    {row.squadName.split(' ')[0]}
                  </span>
                </div>
              ))}
            </div>
            <div className="lg-chart-footer">
              <span className="lg-legend-item">
                <span className="lg-legend-swatch lg-legend-swatch-for" /> Goals for
              </span>
              <span className="lg-legend-item">
                <span className="lg-legend-swatch lg-legend-swatch-against" /> Goals against
              </span>
            </div>
          </div>
        </div>
      )}

      {standings.length > 0 && (
        <section className="lg-section">
          <div className="lg-section-head">
            <span className="lg-chart-eyebrow">League table</span>
            <h3>Standings</h3>
          </div>
          <div className="lg-table-wrap">
            <table className="lg-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Team</th>
                  <th>P</th>
                  <th>W</th>
                  <th>D</th>
                  <th>L</th>
                  <th>GF</th>
                  <th>GA</th>
                  <th>GD</th>
                  <th>Pts</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((row, i) => (
                  <tr
                    key={row.squadId}
                    className={mineSquadIds.has(row.squadId) ? 'lg-table-row-mine' : ''}
                  >
                    <td className="lg-table-rank">{i + 1}</td>
                    <td className="lg-table-team">{row.squadName}</td>
                    <td>{row.played}</td>
                    <td>{row.wins}</td>
                    <td>{row.draws}</td>
                    <td>{row.losses}</td>
                    <td>{row.gf}</td>
                    <td>{row.ga}</td>
                    <td>{row.gd > 0 ? `+${row.gd}` : row.gd}</td>
                    <td className="lg-table-points">{row.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {fixtures.length > 0 && (
        <section className="lg-section">
          <div className="lg-section-head">
            <span className="lg-chart-eyebrow">Fixture grid</span>
            <h3>Fixtures</h3>
            <span className="lg-fixture-count">{fixtures.length} matches</span>
          </div>
          <div className="lg-fixtures">
            {fixtures.map((fixture) => {
              const kickoff = fixture.event_date ? new Date(fixture.event_date) : null
              return (
                <div key={fixture.id} className={`lg-fixture-row lg-fixture-row-${fixture.status}`}>
                  <div className="lg-fixture-date">
                    <span className="lg-fixture-day">
                      {kickoff
                        ? kickoff.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }).toUpperCase()
                        : 'TBC'}
                    </span>
                    <span className="lg-fixture-time">
                      {kickoff
                        ? kickoff.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
                        : '—'}
                    </span>
                  </div>
                  <div className="lg-fixture-main">
                    <div className="lg-fixture-tags">
                      <span className={`event-status event-status-${fixture.status}`}>
                        {statusLabel[fixture.status] || fixture.status}
                      </span>
                    </div>
                    <span className="lg-fixture-teams">
                      <span className={fixture.is_home_mine ? 'lg-fixture-mine' : ''}>
                        {fixture.home_squad_name}
                      </span>
                      <span className="lg-fixture-vs">—</span>
                      <span className={fixture.is_away_mine ? 'lg-fixture-mine' : ''}>
                        {fixture.away_squad_name}
                      </span>
                    </span>
                  </div>
                  <div className="lg-fixture-actions">
                    {fixture.is_home_mine && fixture.status === 'scheduled' && !isAthlete ? (
                      <div className="lg-kickoff-edit">
                        <input
                          type="datetime-local"
                          aria-label="Fixture kickoff"
                          value={dateDrafts[fixture.id] ?? toLocalInputValue(fixture.event_date)}
                          onChange={(e) => setDateDrafts({ ...dateDrafts, [fixture.id]: e.target.value })}
                        />
                        <button
                          type="button"
                          className="btn btn-gold"
                          disabled={
                            savingFixtureDateId === fixture.id ||
                            !(dateDrafts[fixture.id] ?? fixture.event_date)
                          }
                          onClick={() => handleSaveFixtureDate(fixture.id)}
                        >
                          {savingFixtureDateId === fixture.id ? (
                            <Loader inline label="Saving..." />
                          ) : (
                            'Save kickoff'
                          )}
                        </button>
                      </div>
                    ) : (
                      <span className="lg-fixture-kickoff">
                        {fixture.event_date ? formatDateTime(fixture.event_date) : 'Kickoff TBC'}
                      </span>
                    )}
                    {fixture.status === 'scheduled' && fixture.is_home_mine && !isAthlete && (
                      <button
                        className="btn btn-gold lg-btn-live"
                        disabled={startingFixtureId === fixture.id}
                        onClick={() => handleStartFixture(fixture.id)}
                      >
                        {startingFixtureId === fixture.id ? (
                          <Loader inline label="Starting..." />
                        ) : (
                          'Start live'
                        )}
                      </button>
                    )}
                    {fixture.status === 'live' && !isAthlete && (
                      <button
                        className="btn btn-gold lg-btn-live"
                        onClick={() => navigate(`/live/fixture/${fixture.id}`)}
                      >
                        Go live
                      </button>
                    )}
                    {fixture.status === 'completed' && (fixture.is_home_mine || fixture.is_away_mine) && (
                      <Link to={`/reports/match/fixture/${fixture.id}`} className="btn btn-ghost">
                        Match report
                      </Link>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {stats && (
        <div className="lg-leaders-grid">
          <div className="lg-panel">
            <span className="lg-chart-eyebrow">Golden boot race</span>
            <h3>Top scorers</h3>
            {stats.topScorers.length === 0 ? (
              <p className="roster-status">No goals recorded yet.</p>
            ) : (
              <div className="lg-leader-list">
                {stats.topScorers.map((s, i) => (
                  <div className="lg-leader-row" key={s.athleteId}>
                    <span className="lg-leader-rank">{i + 1}</span>
                    <div className="lg-leader-info">
                      <span className="lg-leader-name">{s.athleteName}</span>
                      <span className="lg-leader-pos">{s.squadName}</span>
                    </div>
                    <div className="lg-leader-side">
                      <span className="lg-leader-num">
                        {s.goals}
                        <span className="lg-leader-num-label">goal{s.goals === 1 ? '' : 's'}</span>
                      </span>
                      <div className="lg-leader-track">
                        <div
                          className="lg-leader-fill"
                          style={{ width: `${topScorerGoals > 0 ? (s.goals / topScorerGoals) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="lg-panel">
            <span className="lg-chart-eyebrow">Playmaker race</span>
            <h3>Top assisters</h3>
            {stats.topAssisters.length === 0 ? (
              <p className="roster-status">No assists recorded yet.</p>
            ) : (
              <div className="lg-leader-list">
                {stats.topAssisters.map((s, i) => (
                  <div className="lg-leader-row" key={s.athleteId}>
                    <span className="lg-leader-rank">{i + 1}</span>
                    <div className="lg-leader-info">
                      <span className="lg-leader-name">{s.athleteName}</span>
                      <span className="lg-leader-pos">{s.squadName}</span>
                    </div>
                    <div className="lg-leader-side">
                      <span className="lg-leader-num">
                        {s.assists}
                        <span className="lg-leader-num-label">assist{s.assists === 1 ? '' : 's'}</span>
                      </span>
                      <div className="lg-leader-track">
                        <div
                          className="lg-leader-fill lg-leader-fill-assist"
                          style={{ width: `${topAssisterAssists > 0 ? (s.assists / topAssisterAssists) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function EventDetail() {
  const { id } = useParams()
  const { getToken } = useAuth()

  const [detail, setDetail] = useState(null)
  const [athletes, setAthletes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [role, setRole] = useState(null)

  const pollRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    apiRequest('/api/account/me', { getToken })
      .then((me) => {
        if (!cancelled) setRole(me.role)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [getToken])

  const isAthlete = role === 'athlete'

  const loadDetail = useCallback(async () => {
    try {
      const data = await apiRequest(`/api/events/${id}`, { getToken })
      setDetail(data)
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [id, getToken])

  const loadAthletes = useCallback(async () => {
    try {
      const data = await apiRequest('/api/athletes', { getToken })
      setAthletes(data)
    } catch {
      // roster load failing isn't fatal to viewing the event
    }
  }, [getToken])

  useEffect(() => {
    loadDetail()
    loadAthletes()
  }, [loadDetail, loadAthletes])

  // Poll while a simple event is live so the dashboard/timeline stays near-real-time.
  useEffect(() => {
    if (
      detail?.event?.status === 'live' &&
      detail?.event?.format !== 'league' &&
      detail?.event?.format !== 'tournament'
    ) {
      pollRef.current = setInterval(loadDetail, 5000)
      return () => clearInterval(pollRef.current)
    }
  }, [detail?.event?.status, detail?.event?.format, loadDetail])

  if (loading) {
    return (
      <Layout>
        <Loader label="Loading event..." />
      </Layout>
    )
  }

  if (!detail) {
    return (
      <Layout>
        {error && <div className="roster-error">{error}</div>}
      </Layout>
    )
  }

  const isLeague = detail.event.format === 'league' || detail.event.format === 'tournament'

  return (
    <Layout>
      {isLeague ? (
        <LeagueDetail detail={detail} id={id} getToken={getToken} onChange={loadDetail} isAthlete={isAthlete} />
      ) : (
        <SimpleEventDetail detail={detail} athletes={athletes} id={id} getToken={getToken} onChange={loadDetail} isAthlete={isAthlete} />
      )}
    </Layout>
  )
}

export default EventDetail
