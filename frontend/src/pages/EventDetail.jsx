import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { useParams, useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import { apiRequest, apiDownload } from '../lib/api'
import { ACTION_TYPES, formatActionType } from '../lib/actions'
import WeatherWidget from '../components/WeatherWidget'
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

// T26: penalties & discipline — the backend already filters card/penalty log
// entries out of the timeline into `penalties`; this surfaces them in one place.
function DisciplineSection({ penalties }) {
  if (!penalties || penalties.length === 0) return null

  return (
    <>
      <h3 className="event-timeline-heading">Penalties &amp; discipline</h3>
      <div className="event-timeline">
        {penalties.map((p) => (
          <div className="timeline-entry" key={p.id}>
            <span className="timeline-minute">{p.minute != null ? `${p.minute}'` : '—'}</span>
            <div className="timeline-body">
              <span className="timeline-action">{formatActionType(p.action_type)}</span>
              <span className="timeline-who">{p.athlete_name || 'Opponent'}</span>
              {p.notes && <span className="timeline-notes">{p.notes}</span>}
            </div>
            <span
              className={`event-discipline-badge ${
                p.action_type.includes('red')
                  ? 'event-discipline-badge--red'
                  : p.action_type.includes('yellow')
                    ? 'event-discipline-badge--yellow'
                    : 'event-discipline-badge--penalty'
              }`}
            >
              {p.action_type.includes('card') ? 'Card' : 'Penalty'}
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

// T22: auto post-match summary & highlights. Only meaningful once the event has
// completed; any failure to build it is silent — it's a bonus panel.
function MatchSummaryPanel({ id, getToken, status }) {
  const [summary, setSummary] = useState(null)

  useEffect(() => {
    if (status !== 'completed') return undefined
    let cancelled = false
    apiRequest(`/api/events/${id}/summary`, { getToken })
      .then((data) => {
        if (!cancelled) setSummary(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [id, status, getToken])

  if (status !== 'completed' || !summary) return null

  return (
    <section className="event-summary">
      <span className="event-summary-headline">{summary.headline}</span>
      <p className="event-summary-narrative">{summary.narrative}</p>
      {summary.highlights.length > 0 && (
        <ul className="event-summary-highlights">
          {summary.highlights.map((h, i) => (
            <li key={i} className={`event-summary-highlight event-summary-highlight--${h.kind}`}>
              {h.minute != null && <span className="timeline-minute">{h.minute}'</span>}
              {h.text}
            </li>
          ))}
        </ul>
      )}
      <div className="event-summary-stats">
        <span>{summary.stats.goals} goals</span>
        <span>{summary.stats.yellowCards} yellow</span>
        <span>{summary.stats.redCards} red</span>
        <span>{summary.stats.penaltiesScored} pens scored</span>
        <span>{summary.stats.penaltiesMissed} pens missed</span>
      </div>
    </section>
  )
}

const RSVP_OPTIONS = [
  { value: 'yes', label: 'In' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'no', label: 'Out' },
]

// T21: availability (RSVPs) + one-click lineup suggestion ranked by coach
// rating and recent form, with injuries and RSVP'd-out players explained.
function LineupAssistant({ id, athletes, getToken }) {
  const [rsvpStatus, setRsvpStatus] = useState({})
  const [savingRsvps, setSavingRsvps] = useState(false)
  const [rsvpMessage, setRsvpMessage] = useState('')
  const [rsvpError, setRsvpError] = useState('')
  const [size, setSize] = useState(11)
  const [suggestion, setSuggestion] = useState(null)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestError, setSuggestError] = useState('')

  useEffect(() => {
    apiRequest(`/api/events/${id}/rsvps`, { getToken })
      .then((rows) =>
        setRsvpStatus(Object.fromEntries(rows.map((r) => [r.athlete_id, r.status])))
      )
      .catch(() => {})
  }, [id, getToken])

  async function saveRsvps() {
    const entries = Object.entries(rsvpStatus).map(([athleteId, status]) => ({
      athlete_id: Number(athleteId),
      status,
    }))
    if (entries.length === 0) {
      setRsvpError('Mark at least one athlete first')
      return
    }
    setSavingRsvps(true)
    setRsvpError('')
    setRsvpMessage('')
    try {
      await apiRequest(`/api/events/${id}/rsvps`, {
        method: 'PUT',
        getToken,
        body: { rsvps: entries },
      })
      setRsvpMessage('Availability saved')
    } catch (err) {
      setRsvpError(err.message)
    } finally {
      setSavingRsvps(false)
    }
  }

  async function suggestLineup() {
    setSuggesting(true)
    setSuggestError('')
    try {
      const data = await apiRequest(`/api/events/${id}/lineup-suggestion?size=${size}`, {
        getToken,
      })
      setSuggestion(data)
    } catch (err) {
      setSuggestError(err.message)
    } finally {
      setSuggesting(false)
    }
  }

  if (athletes.length === 0) return null

  return (
    <section className="event-lineup">
      <h3 className="event-timeline-heading">Availability &amp; lineup</h3>
      <div className="event-rsvp-list">
        {athletes.map((a) => (
          <div key={a.id} className="event-rsvp-row">
            <span className="event-rsvp-name">
              {a.name}
              {a.squad_number != null ? ` (#${a.squad_number})` : ''}
            </span>
            <div className="event-rsvp-options">
              {RSVP_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`event-rsvp-btn ${rsvpStatus[a.id] === opt.value ? `event-rsvp-btn--${opt.value}` : ''}`}
                  onClick={() =>
                    setRsvpStatus((s) => ({ ...s, [a.id]: opt.value }))
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="roster-form-actions">
        <button className="btn btn-ghost" onClick={saveRsvps} disabled={savingRsvps}>
          {savingRsvps ? 'Saving...' : 'Save availability'}
        </button>
        <span className="event-lineup-input">
          Starting XI size
          <input
            type="number"
            min="1"
            max="30"
            value={size}
            onChange={(e) => setSize(e.target.value)}
          />
          <button className="btn btn-gold" onClick={suggestLineup} disabled={suggesting}>
            {suggesting ? 'Thinking...' : 'Suggest lineup'}
          </button>
        </span>
      </div>
      {rsvpMessage && <p className="event-lineup-note">{rsvpMessage}</p>}
      {rsvpError && <div className="roster-error">{rsvpError}</div>}
      {suggestError && <div className="roster-error">{suggestError}</div>}

      {suggestion && (
        <div className="event-suggestion">
          {suggestion.starters.length === 0 ? (
            <p className="roster-status">No available players to suggest.</p>
          ) : (
            <>
              <h4>Starting lineup</h4>
              <ol className="event-suggestion-list">
                {suggestion.starters.map((s) => (
                  <li key={s.athlete.id}>
                    <strong>{s.athlete.name}</strong>
                    {s.athlete.position ? ` — ${s.athlete.position}` : ''}
                    <span className="event-suggestion-reason">{s.reason}</span>
                    {s.form.goals + s.form.assists > 0 && (
                      <span className={`event-rsvp-btn event-rsvp-btn--yes event-suggestion-doubt`}>
                        In form
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
          {suggestion.bench.length > 0 && (
            <>
              <h4>Bench</h4>
              <p className="event-suggestion-bench">
                {suggestion.bench.map((s) => s.athlete.name).join(', ')}
              </p>
            </>
          )}
          {suggestion.doubtful.length > 0 && (
            <>
              <h4>Doubtful</h4>
              <ul className="event-suggestion-list">
                {suggestion.doubtful.map((s) => (
                  <li key={s.athlete.id}>
                    <strong>{s.athlete.name}</strong>
                    <span className="event-suggestion-reason">{s.reason}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {suggestion.unavailable.length > 0 && (
            <>
              <h4>Unavailable</h4>
              <ul className="event-suggestion-list">
                {suggestion.unavailable.map((s) => (
                  <li key={s.athlete.id}>
                    <strong>{s.athlete.name}</strong>
                    <span className="event-suggestion-reason">{s.reason}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  )
}

function SimpleEventDetail({ detail, athletes, id, getToken, onChange }) {
  const { event, result, penalties, timeline } = detail
  const [logForm, setLogForm] = useState(emptyLogForm)
  const [editingLogId, setEditingLogId] = useState(null)
  const [logSaving, setLogSaving] = useState(false)
  const [logError, setLogError] = useState('')
  const [error, setError] = useState('')
  const [statusSaving, setStatusSaving] = useState(false)
  const [exporting, setExporting] = useState('')

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

  async function handleExport(format) {
    setExporting(format)
    setError('')
    try {
      await apiDownload(`/api/events/${id}/report.${format}`, { getToken })
    } catch (err) {
      setError(err.message)
    } finally {
      setExporting('')
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
    if (!window.confirm('Undo this log entry?')) return
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
          {event.event_type === 'match' && (
            <>
              <button
                className="btn btn-ghost"
                disabled={exporting !== ''}
                onClick={() => handleExport('csv')}
              >
                {exporting === 'csv' ? 'Exporting...' : 'Report CSV'}
              </button>
              <button
                className="btn btn-ghost"
                disabled={exporting !== ''}
                onClick={() => handleExport('pdf')}
              >
                {exporting === 'pdf' ? 'Exporting...' : 'Report PDF'}
              </button>
            </>
          )}
          {event.status === 'scheduled' && (
            <button className="btn btn-gold" disabled={statusSaving} onClick={() => handleStatusChange('live')}>
              Start live
            </button>
          )}
          {event.status === 'live' && (
            <button className="btn btn-danger" disabled={statusSaving} onClick={() => handleStatusChange('completed')}>
              End event
            </button>
         )}
        </div>
      </div>

      {event.location && <WeatherWidget location={event.location} />}

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

      <MatchSummaryPanel id={id} getToken={getToken} status={event.status} />

      {event.event_type === 'match' && (
        <LineupAssistant id={id} athletes={athletes} getToken={getToken} />
      )}

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
            {logSaving ? 'Saving...' : editingLogId ? 'Save changes' : 'Log action'}
          </button>
        </div>
        {logError && <div className="roster-error">{logError}</div>}
      </form>

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
              <div className="timeline-actions">
                <button className="btn btn-ghost" onClick={() => openEditLogForm(entry)}>Edit</button>
                <button className="btn btn-danger" onClick={() => handleUndo(entry.id)}>Undo</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <DisciplineSection penalties={penalties} />
    </>
  )
}

function LeagueDetail({ detail, id, getToken, onChange }) {
  const navigate = useNavigate()
  const { event, teams, fixtures, standings, stats } = detail
  const [joining, setJoining] = useState(false)
  const [startingFixtureId, setStartingFixtureId] = useState(null)
  const [error, setError] = useState('')

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

  return (
    <>
      <div className="roster-header">
        <div>
          <span className="dashboard-eyebrow">
            {event.format === 'league' ? 'League' : 'Tournament'} · {statusLabel[event.status] || event.status}
          </span>
         <h1>{event.title || 'Untitled league'}</h1>
          <p className="event-detail-date">
            {teams.length} / {event.required_teams} teams joined
          </p>
          {event.location && <p className="event-detail-location">📍 {event.location}</p>}
        </div>
        {isOpen && !mySquadJoined && (
          <button className="btn btn-gold" disabled={joining} onClick={handleJoin}>
            {joining ? 'Joining...' : 'Join league'}
          </button>
        )}
      </div>

      {event.location && <WeatherWidget location={event.location} />}

      {error && <div className="roster-error">{error}</div>}

      <section className="league-section">
        <h3>Teams</h3>
        <div className="league-teams">
          {teams.map((team) => (
            <span key={team.squad_id} className={`league-team ${team.is_mine ? 'league-team-mine' : ''}`}>
              {team.squad_name}
            </span>
          ))}
        </div>
      </section>

      {standings.length > 0 && (
        <section className="league-section">
          <h3>Standings</h3>
          <table className="league-table">
            <thead>
              <tr>
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
              {standings.map((row) => (
                <tr key={row.squadId}>
                  <td>{row.squadName}</td>
                  <td>{row.played}</td>
                  <td>{row.wins}</td>
                  <td>{row.draws}</td>
                  <td>{row.losses}</td>
                  <td>{row.gf}</td>
                  <td>{row.ga}</td>
                  <td>{row.gd}</td>
                  <td className="league-points">{row.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {fixtures.length > 0 && (
        <section className="league-section">
          <h3>Fixtures</h3>
          <div className="league-fixtures">
            {fixtures.map((fixture) => (
              <div key={fixture.id} className={`league-fixture league-fixture-${fixture.status}`}>
                <div className="league-fixture-teams">
                  <span className={fixture.is_home_mine ? 'league-fixture-mine' : ''}>
                    {fixture.home_squad_name}
                  </span>
                  <span className="league-fixture-vs">vs</span>
                  <span className={fixture.is_away_mine ? 'league-fixture-mine' : ''}>
                    {fixture.away_squad_name}
                  </span>
                </div>
                <span className={`event-status event-status-${fixture.status}`}>
                  {statusLabel[fixture.status] || fixture.status}
                </span>
                {fixture.status === 'scheduled' && fixture.is_home_mine && (
                  <button
                    className="btn btn-gold"
                    disabled={startingFixtureId === fixture.id}
                    onClick={() => handleStartFixture(fixture.id)}
                  >
                    {startingFixtureId === fixture.id ? 'Starting...' : 'Start live'}
                  </button>
                )}
                {fixture.status === 'live' && (
                  <button className="btn btn-gold" onClick={() => navigate(`/live/fixture/${fixture.id}`)}>
                    Go live
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {stats && (
        <section className="league-section">
          <h3>Top Scorers</h3>
          {stats.topScorers.length === 0 ? (
            <p className="roster-status">No goals recorded yet.</p>
          ) : (
            <ol className="league-stats-list">
              {stats.topScorers.map((s) => (
                <li key={s.athleteId}>
                  {s.athleteName} <span className="league-stats-meta">({s.squadName})</span> — {s.goals} goal{s.goals === 1 ? '' : 's'}
                </li>
              ))}
            </ol>
          )}

          <h3 className="league-subheading">Top Assisters</h3>
          {stats.topAssisters.length === 0 ? (
            <p className="roster-status">No assists recorded yet.</p>
          ) : (
            <ol className="league-stats-list">
              {stats.topAssisters.map((s) => (
                <li key={s.athleteId}>
                  {s.athleteName} <span className="league-stats-meta">({s.squadName})</span> — {s.assists} assist{s.assists === 1 ? '' : 's'}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </>
  )
}

function EventDetail() {
  const { id } = useParams()
  const { getToken } = useAuth()

  const [detail, setDetail] = useState(null)
  const [athletes, setAthletes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const pollRef = useRef(null)

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
    if (detail?.event?.status === 'live' && detail?.event?.format === 'match') {
      pollRef.current = setInterval(loadDetail, 5000)
      return () => clearInterval(pollRef.current)
    }
  }, [detail?.event?.status, detail?.event?.format, loadDetail])

  if (loading) {
    return (
      <Layout>
        <p className="roster-status">Loading event...</p>
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
        <LeagueDetail detail={detail} id={id} getToken={getToken} onChange={loadDetail} />
      ) : (
        <SimpleEventDetail detail={detail} athletes={athletes} id={id} getToken={getToken} onChange={loadDetail} />
      )}
    </Layout>
  )
}

export default EventDetail
