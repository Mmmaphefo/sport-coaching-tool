// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
// Seasons (T17): named periods with their own record, per-match breakdown and
// schedule, plus the schedule generator (T23) that spreads opponents across
// the season and flags clashes without blocking them.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import Layout from '../components/Layout'
import Loader from '../components/Loader'
import { apiRequest } from '../lib/api'
import { useConfirm } from '../lib/confirm'
import './Seasons.css'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const STATUS_LABEL = { scheduled: 'Scheduled', live: 'Live', completed: 'Completed', cancelled: 'Cancelled', open: 'Open' }
const RESULT_LABEL = { W: 'Won', D: 'Drew', L: 'Lost' }

function formatDay(value) {
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatKickoff(value) {
  const d = new Date(value)
  const day = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return `${day} · ${time}`
}

function Seasons() {
  const { getToken } = useAuth()
  const confirm = useConfirm()
  const [seasons, setSeasons] = useState(null)
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', from: '', to: '' })
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [gen, setGen] = useState({ opponents: '', first: '', time: '10:00', cadence: '7', weekday: '', duration: '90', location: '' })
  const [plan, setPlan] = useState(null)
  const [genError, setGenError] = useState('')
  const [genBusy, setGenBusy] = useState(false)

  const fetchSeasons = useCallback(async () => {
    try {
      return await apiRequest('/api/seasons', { getToken })
    } catch (err) {
      setError(err.message)
      return null
    }
  }, [getToken])

  const fetchDetail = useCallback(async (id) => {
    try {
      return await apiRequest(`/api/seasons/${id}`, { getToken })
    } catch (err) {
      setError(err.message)
      return null
    }
  }, [getToken])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const list = await fetchSeasons()
      if (cancelled) return
      if (list) {
        setSeasons(list)
        // The newest season is the natural starting point.
        if (list.length > 0) {
          const first = await fetchDetail(list[0].id)
          if (!cancelled && first) setDetail(first)
        }
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [fetchSeasons, fetchDetail])

  async function createSeason(e) {
    e.preventDefault()
    if (!form.name.trim() || !form.from || !form.to) {
      setFormError('Give the season a name and both dates.')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const created = await apiRequest('/api/seasons', {
        method: 'POST',
        body: { name: form.name.trim(), starts_on: form.from, ends_on: form.to },
        getToken,
      })
      const list = await apiRequest('/api/seasons', { getToken })
      setSeasons(list)
      setDetail(await apiRequest(`/api/seasons/${created.id}`, { getToken }))
      setForm({ name: '', from: '', to: '' })
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function selectSeason(id) {
    setPlan(null)
    setGenError('')
    setError('')
    try {
      setDetail(await apiRequest(`/api/seasons/${id}`, { getToken }))
    } catch (err) {
      setError(err.message)
    }
  }

  async function removeSeason(season) {
    const proceed = await confirm({
      title: `Delete "${season.name}"?`,
      message: 'The season is removed, but its matches stay on the calendar — they just lose their season tag.',
      confirmLabel: 'Delete season',
    })
    if (!proceed) return
    try {
      await apiRequest(`/api/seasons/${season.id}`, { method: 'DELETE', getToken })
      const list = await apiRequest('/api/seasons', { getToken })
      setSeasons(list)
      if (String(detail?.season.id) === String(season.id)) {
        setDetail(list.length > 0 ? await apiRequest(`/api/seasons/${list[0].id}`, { getToken }) : null)
      }
    } catch (err) {
      setError(err.message)
    }
  }

  function generatorBody(dryRun) {
    const opponents = gen.opponents.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
    const body = {
      opponents,
      kickoff_time: gen.time,
      cadence_days: Number(gen.cadence) || 7,
      weekday: gen.weekday === '' ? null : Number(gen.weekday),
      duration_minutes: Number(gen.duration) || 90,
      location: gen.location.trim() || null,
      dry_run: dryRun,
    }
    // Left empty, the server picks the season start (or tomorrow when the
    // season is already underway) — sending a stale date would 400.
    if (gen.first) body.first_kickoff = gen.first
    return body
  }

  async function runSchedule(dryRun) {
    setGenBusy(true)
    setGenError('')
    if (!dryRun) setPlan(null)
    try {
      const res = await apiRequest(`/api/seasons/${detail.season.id}/schedule`, {
        method: 'POST',
        body: generatorBody(dryRun),
        getToken,
      })
      if (dryRun) {
        setPlan(res)
      } else {
        setDetail(await apiRequest(`/api/seasons/${detail.season.id}`, { getToken }))
        setSeasons(await apiRequest('/api/seasons', { getToken }))
      }
    } catch (err) {
      setGenError(err.message)
    } finally {
      setGenBusy(false)
    }
  }

  const s = detail?.summary

  return (
    <Layout>
      <div className="sn-page">
        <header className="sn-head">
          <h1>Seasons</h1>
          <p>Named periods for your squad — each carries its own record, breakdown and schedule, and prints as a report.</p>
        </header>

        {error && <div className="sn-error" role="alert">{error}</div>}
        {loading && <Loader label="Loading seasons..." />}

        {seasons && (
          <section className="sn-card" aria-labelledby="sn-list-title">
            <h2 id="sn-list-title">Your seasons</h2>
            {seasons.length === 0 ? (
              <p className="sn-muted">No seasons yet — create one below to track a period and generate its schedule.</p>
            ) : (
              <div className="sn-table-wrap">
                <table className="sn-table">
                  <thead>
                    <tr>
                      <th scope="col">Season</th>
                      <th scope="col">Dates</th>
                      <th scope="col">Matches</th>
                      <th scope="col">Played</th>
                      <th scope="col"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {seasons.map((season) => (
                      <tr key={season.id} className={detail && String(detail.season.id) === String(season.id) ? 'sn-row-active' : ''}>
                        <th scope="row">{season.name}</th>
                        <td>{formatDay(season.starts_on)} – {formatDay(season.ends_on)}</td>
                        <td>{season.event_count}</td>
                        <td>{season.completed_count}</td>
                        <td className="sn-row-actions">
                          <button type="button" className="btn btn-ghost" onClick={() => selectSeason(season.id)}>View</button>
                          <button type="button" className="btn btn-ghost sn-danger" onClick={() => removeSeason(season)}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        <section className="sn-card" aria-labelledby="sn-create-title">
          <h2 id="sn-create-title">New season</h2>
          <form className="sn-create-form" onSubmit={createSeason}>
            <label className="sn-field">
              Name
              <input type="text" value={form.name} maxLength="100" placeholder="2026 Season"
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </label>
            <label className="sn-field">
              From
              <input type="date" value={form.from}
                onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))} />
            </label>
            <label className="sn-field">
              To
              <input type="date" value={form.to}
                onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))} />
            </label>
            <button type="submit" className="btn btn-gold" disabled={saving}>
              {saving ? 'Creating...' : 'Create season'}
            </button>
          </form>
          {formError && <div className="sn-error" role="alert">{formError}</div>}
        </section>

        {detail && (
          <section className="sn-card sn-detail" aria-labelledby="sn-detail-title">
            <div className="sn-detail-head">
              <div>
                <h2 id="sn-detail-title">{detail.season.name}</h2>
                <p className="sn-muted">{formatDay(detail.season.starts_on)} – {formatDay(detail.season.ends_on)}</p>
              </div>
              <Link className="btn btn-ghost" to={`/reports?season=${detail.season.id}`}>Printable report</Link>
            </div>

            <dl className="sn-record">
              <div><dt>Played</dt><dd>{s.played}</dd></div>
              <div><dt>Won, drawn, lost</dt><dd>{s.wins}–{s.draws}–{s.losses}</dd></div>
              <div><dt>Goals for and against</dt><dd>{s.goalsFor}–{s.goalsAgainst}</dd></div>
              <div><dt>Clean sheets</dt><dd>{s.cleanSheets}</dd></div>
            </dl>

            <h3>Results</h3>
            {detail.matches.length === 0 ? (
              <p className="sn-muted">No finished matches in this season yet — the breakdown appears as matches complete.</p>
            ) : (
              <div className="sn-table-wrap">
                <table className="sn-table">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Opponent</th>
                      <th scope="col">Score</th>
                      <th scope="col">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.matches.map((m) => (
                      <tr key={`${m.kind}-${m.id}`}>
                        <td>{formatDay(m.date)}</td>
                        <th scope="row">{m.opponent}</th>
                        <td>{m.us.goals}–{m.them.goals}</td>
                        <td><span className={`sn-result sn-result-${m.result}`}>{RESULT_LABEL[m.result]}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h3>Schedule</h3>
            {detail.schedule.length === 0 ? (
              <p className="sn-muted">Nothing scheduled for this season yet — use the generator below.</p>
            ) : (
              <div className="sn-table-wrap">
                <table className="sn-table">
                  <thead>
                    <tr>
                      <th scope="col">Kickoff</th>
                      <th scope="col">Opponent</th>
                      <th scope="col">Status</th>
                      <th scope="col"><span className="sr-only">Open</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.schedule.map((e) => (
                      <tr key={e.id}>
                        <td>{formatKickoff(e.event_date)}</td>
                        <th scope="row">{e.opponent}</th>
                        <td>
                          <span className={`sn-status sn-status-${e.status}`}>{STATUS_LABEL[e.status] || e.status}</span>
                          {e.clashes && e.clashes.length > 0 && (
                            <span className="sn-clash" title={`Overlaps ${e.clashes.length} other item${e.clashes.length === 1 ? '' : 's'} on the calendar`}>
                              Clash
                            </span>
                          )}
                        </td>
                        <td><Link to={`/events/${e.id}`}>Open</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h3>Generate the schedule</h3>
            <p className="sn-muted">One match per opponent, spread across the season. Clashes with the existing calendar are flagged, never blocked.</p>
            <form className="sn-gen" onSubmit={(e) => { e.preventDefault(); runSchedule(true) }}>
              <label className="sn-field sn-field-wide">
                Opponents (one per line)
                <textarea rows="3" value={gen.opponents} placeholder={'Rovers\nUnited\nCity'}
                  onChange={(e) => setGen((g) => ({ ...g, opponents: e.target.value }))} />
              </label>
              <label className="sn-field">
                First kickoff
                <input type="date" value={gen.first} placeholder={detail.season.starts_on}
                  onChange={(e) => setGen((g) => ({ ...g, first: e.target.value }))} />
              </label>
              <label className="sn-field">
                Kickoff time
                <input type="time" value={gen.time}
                  onChange={(e) => setGen((g) => ({ ...g, time: e.target.value }))} />
              </label>
              <label className="sn-field">
                Days between matches
                <input type="number" min="1" max="28" value={gen.cadence}
                  onChange={(e) => setGen((g) => ({ ...g, cadence: e.target.value }))} />
              </label>
              <label className="sn-field">
                Day of the week
                <select value={gen.weekday} onChange={(e) => setGen((g) => ({ ...g, weekday: e.target.value }))}>
                  <option value="">Any</option>
                  {WEEKDAYS.map((day, i) => (
                    <option key={day} value={i}>{day}s</option>
                  ))}
                </select>
              </label>
              <label className="sn-field">
                Duration (minutes)
                <input type="number" min="15" max="300" value={gen.duration}
                  onChange={(e) => setGen((g) => ({ ...g, duration: e.target.value }))} />
              </label>
              <label className="sn-field sn-field-wide">
                Venue
                <input type="text" maxLength="200" value={gen.location} placeholder="Home Ground (optional)"
                  onChange={(e) => setGen((g) => ({ ...g, location: e.target.value }))} />
              </label>
              <div className="sn-gen-actions">
                <button type="submit" className="btn btn-ghost" disabled={genBusy}>Preview</button>
                <button type="button" className="btn btn-gold" disabled={genBusy} onClick={() => runSchedule(false)}>
                  Create schedule
                </button>
              </div>
            </form>
            {genError && <div className="sn-error" role="alert">{genError}</div>}

            {plan && (
              <div className="sn-plan">
                <h4>Preview — {plan.planned.length} match{plan.planned.length === 1 ? '' : 'es'}, {plan.clash_count} with clash{plan.clash_count === 1 ? '' : 'es'}</h4>
                <ul>
                  {plan.planned.map((p) => (
                    <li key={p.opponent} className={p.clashes.length > 0 ? 'sn-plan-clash' : ''}>
                      <span className="sn-plan-when">{formatKickoff(p.event_date)}</span>
                      <span className="sn-plan-who">vs {p.opponent}</span>
                      {p.clashes.length > 0 ? (
                        <span className="sn-plan-note">Clashes with {p.clashes.map((c) => c.label).join(', ')}</span>
                      ) : (
                        <span className="sn-plan-note sn-muted">No clash</span>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="sn-muted">Create the schedule to add these matches to the calendar.</p>
              </div>
            )}
          </section>
        )}
      </div>
    </Layout>
  )
}

export default Seasons
