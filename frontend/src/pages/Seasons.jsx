import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Link } from 'react-router-dom'
import Layout from '../components/Layout'
import { apiRequest, apiDownload } from '../lib/api'
import './Seasons.css'

const emptySeasonForm = { name: '', start_date: '', end_date: '' }

const emptyScheduleForm = {
  opponents: '',
  start_date: '',
  interval_days: 7,
  time: '15:00',
  location: '',
  alternate_venues: false,
}

const resultBadge = { W: 'seasons-result-w', D: 'seasons-result-d', L: 'seasons-result-l' }

function TotalsCards({ totals }) {
  return (
    <div className="stats-grid">
      <div className="stats-card">
        <span className="stats-value">{totals.played}</span>
        <span className="stats-label">Played</span>
      </div>
      <div className="stats-card">
        <span className="stats-value">{totals.wins}</span>
        <span className="stats-label">Won</span>
      </div>
      <div className="stats-card">
        <span className="stats-value">{totals.draws}</span>
        <span className="stats-label">Drawn</span>
      </div>
      <div className="stats-card">
        <span className="stats-value">{totals.losses}</span>
        <span className="stats-label">Lost</span>
      </div>
      <div className="stats-card">
        <span className="stats-value">{totals.gf}</span>
        <span className="stats-label">Goals for</span>
      </div>
      <div className="stats-card">
        <span className="stats-value">{totals.ga}</span>
        <span className="stats-label">Goals against</span>
      </div>
      <div className="stats-card">
        <span className="stats-value">{totals.gd > 0 ? `+${totals.gd}` : totals.gd}</span>
        <span className="stats-label">Difference</span>
      </div>
      <div className="stats-card">
        <span className="stats-value">{totals.points}</span>
        <span className="stats-label">Points</span>
      </div>
    </div>
  )
}

function SeasonPage({ season, getToken, onDeleted }) {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [schedule, setSchedule] = useState(emptyScheduleForm)
  const [scheduleResult, setScheduleResult] = useState(null)
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const [exporting, setExporting] = useState('')

  const loadSummary = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiRequest(`/api/seasons/${season.id}/summary`, { getToken })
      setSummary(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season.id])

  useEffect(() => {
    setScheduleResult(null)
    loadSummary()
  }, [loadSummary])

  async function handleExport(format) {
    setExporting(format)
    setError('')
    try {
      await apiDownload(`/api/seasons/${season.id}/report.${format}`, { getToken })
    } catch (err) {
      setError(err.message)
    } finally {
      setExporting('')
    }
  }

  async function handleScheduleSubmit(e) {
    e.preventDefault()
    const opponents = schedule.opponents
      .split('\n')
      .map((o) => o.trim())
      .filter(Boolean)
    if (opponents.length === 0) {
      setError('Add at least one opponent (one per line)')
      return
    }

    setScheduleSaving(true)
    setError('')
    try {
      const data = await apiRequest(`/api/seasons/${season.id}/schedule`, {
        method: 'POST',
        getToken,
        body: {
          opponents,
          start_date: schedule.start_date,
          interval_days: Number(schedule.interval_days) || 7,
          time: schedule.time,
          location: schedule.location.trim() || undefined,
          alternate_venues: schedule.alternate_venues,
        },
      })
      setScheduleResult(data)
      setSchedule(emptyScheduleForm)
      loadSummary()
    } catch (err) {
      setError(err.message)
    } finally {
      setScheduleSaving(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete season "${season.name}"? Events keep their data but become untagged.`)) return
    setError('')
    try {
      await apiRequest(`/api/seasons/${season.id}`, { method: 'DELETE', getToken })
      onDeleted()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <section className="seasons-detail">
      {error && <div className="roster-error">{error}</div>}

      <div className="seasons-detail-header">
        <div>
          <h2>{season.name}</h2>
          <span className="seasons-period">
            {season.start_date} → {season.end_date} · {season.event_count} tagged event
            {season.event_count === 1 ? '' : 's'}
          </span>
        </div>
        <div className="seasons-export-row">
          <button className="btn btn-ghost" disabled={exporting !== ''} onClick={() => handleExport('csv')}>
            {exporting === 'csv' ? 'Exporting...' : 'Export CSV'}
          </button>
          <button className="btn btn-ghost" disabled={exporting !== ''} onClick={() => handleExport('pdf')}>
            {exporting === 'pdf' ? 'Exporting...' : 'Export PDF'}
          </button>
          <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
        </div>
      </div>

      {loading ? (
        <p className="roster-status">Loading season summary...</p>
      ) : summary ? (
        <>
          <TotalsCards totals={summary.totals} />

          <h3 className="live-section-heading">Matches</h3>
          {summary.matches.length === 0 ? (
            <div className="roster-empty">
              <p>No completed matches fall inside this season yet.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="seasons-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Opponent</th>
                    <th>Venue</th>
                    <th>For</th>
                    <th>Against</th>
                    <th>Result</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {summary.matches.map((m) => (
                    <tr key={`${m.kind}-${m.refId}`}>
                      <td>{m.date ? new Date(m.date).toLocaleDateString() : '—'}</td>
                      <td>{m.opponent}</td>
                      <td>{m.venue || ''}</td>
                      <td>{m.gf}</td>
                      <td>{m.ga}</td>
                      <td>
                        <span className={`seasons-result ${resultBadge[m.result] || ''}`}>{m.result}</span>
                      </td>
                      <td>
                        {m.kind === 'event' && m.eventId ? (
                          <Link to={`/events/${m.eventId}`}>View</Link>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      <section className="seasons-schedule">
        <h3 className="live-section-heading">Generate a season schedule</h3>
        <p className="seasons-hint">
          Creates one match event per opponent, evenly spaced through the season. Any fixture that
          overlaps an event already in your calendar gets flagged.
        </p>
        <form className="roster-form" onSubmit={handleScheduleSubmit}>
          <div className="roster-form-grid">
            <label className="roster-form-wide">
              Opponents (one per line, in playing order)
              <textarea
                rows={4}
                value={schedule.opponents}
                onChange={(e) => setSchedule({ ...schedule, opponents: e.target.value })}
                placeholder={'Riverside FC\nNorthgate United\nHarbour City'}
              />
            </label>
            <label>
              First match date
              <input
                type="date"
                value={schedule.start_date}
                onChange={(e) => setSchedule({ ...schedule, start_date: e.target.value })}
              />
            </label>
            <label>
              Kick-off time
              <input
                type="time"
                value={schedule.time}
                onChange={(e) => setSchedule({ ...schedule, time: e.target.value })}
              />
            </label>
            <label>
              Interval (days)
              <input
                type="number"
                min="1"
                value={schedule.interval_days}
                onChange={(e) => setSchedule({ ...schedule, interval_days: e.target.value })}
              />
            </label>
            <label>
              Home venue
              <input
                type="text"
                value={schedule.location}
                onChange={(e) => setSchedule({ ...schedule, location: e.target.value })}
                placeholder="Optional"
              />
            </label>
            <label className="roster-form-checkbox">
              <input
                type="checkbox"
                checked={schedule.alternate_venues}
                onChange={(e) => setSchedule({ ...schedule, alternate_venues: e.target.checked })}
              />
              Alternate home/away
            </label>
          </div>
          <div className="roster-form-actions">
            <button type="submit" className="btn btn-gold" disabled={scheduleSaving}>
              {scheduleSaving ? 'Generating...' : 'Generate schedule'}
            </button>
          </div>
        </form>

        {scheduleResult && (
          <div className="seasons-schedule-result">
            <p>
              Created {scheduleResult.created_count} match event
              {scheduleResult.created_count === 1 ? '' : 's'}.
              {scheduleResult.generated_past_season_end && ' Note: the schedule runs past the end of the season.'}
            </p>
            {scheduleResult.clash_count > 0 && (
              <div className="seasons-clash-warning">
                <strong>⚠ {scheduleResult.clash_count} clash{scheduleResult.clash_count === 1 ? '' : 'es'} detected:</strong>
                <ul>
                  {scheduleResult.clashes.map((c) => (
                    <li key={c.event_id}>
                      vs {c.opponent} — overlaps{' '}
                      {c.conflicts_with.map((x) => `${x.against} (${new Date(x.event_date).toLocaleString()})`).join(', ')}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ul className="seasons-created-list">
              {scheduleResult.events.map((e) => (
                <li key={e.id}>
                  vs {e.opponent} · {new Date(e.event_date).toLocaleString()}
                  {e.location ? ` · ${e.location}` : ''} — <Link to={`/events/${e.id}`}>open</Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </section>
  )
}

function Seasons() {
  const { getToken } = useAuth()

  const [seasons, setSeasons] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [form, setForm] = useState(emptySeasonForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadSeasons = useCallback(
    async (preferredId) => {
      try {
        const data = await apiRequest('/api/seasons', { getToken })
        setSeasons(data)
        setSelectedId((current) => {
          const wanted = preferredId ?? current
          return data.some((s) => s.id === wanted) ? wanted : data[0]?.id ?? null
        })
      } catch (err) {
        setError(err.message)
        setSeasons([])
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  useEffect(() => {
    loadSeasons()
  }, [loadSeasons])

  async function handleCreate(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const created = await apiRequest('/api/seasons', {
        method: 'POST',
        getToken,
        body: { name: form.name.trim(), start_date: form.start_date, end_date: form.end_date },
      })
      setForm(emptySeasonForm)
      loadSeasons(created.id)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (seasons === null) {
    return (
      <Layout>
        <p className="roster-status">Loading seasons...</p>
      </Layout>
    )
  }

  const selected = seasons.find((s) => s.id === selectedId) || null

  return (
    <Layout>
      <div className="roster-header">
        <div>
          <span className="dashboard-eyebrow">Seasons</span>
          <h1>Season totals &amp; breakdowns</h1>
          <p className="seasons-hint">
            Tag matches to a season to track W/D/L and goals across its date range, generate
            schedules, and export reports.
          </p>
        </div>
      </div>

      {error && <div className="roster-error">{error}</div>}

      <form className="roster-form" onSubmit={handleCreate}>
        <h3>New season</h3>
        <div className="roster-form-grid">
          <label>
            Name
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="2026/27"
              required
            />
          </label>
          <label>
            Starts
            <input
              type="date"
              value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              required
            />
          </label>
          <label>
            Ends
            <input
              type="date"
              value={form.end_date}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              required
            />
          </label>
        </div>
        <div className="roster-form-actions">
          <button type="submit" className="btn btn-gold" disabled={saving}>
            {saving ? 'Creating...' : 'Create season'}
          </button>
        </div>
      </form>

      {seasons.length === 0 ? (
        <div className="roster-empty">
          <p>No seasons yet — create your first one above.</p>
        </div>
      ) : (
        <>
          <div className="seasons-tabs">
            {seasons.map((s) => (
              <button
                key={s.id}
                className={`seasons-tab ${s.id === selectedId ? 'seasons-tab-active' : ''}`}
                onClick={() => setSelectedId(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
          {selected && (
            <SeasonPage
              season={selected}
              getToken={getToken}
              onDeleted={() => loadSeasons(null)}
            />
          )}
        </>
      )}
    </Layout>
  )
}

export default Seasons
