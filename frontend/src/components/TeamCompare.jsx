// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Link } from 'react-router-dom'
import { apiRequest } from '../lib/api'
import { periodFor, comparisonFor } from '../lib/periods'
import './TeamCompare.css'

const SIDE_ROWS = [
  ['Goals', 'goals'],
  ['Shots on target', 'shotsOnTarget'],
  ['Saves', 'saves'],
  ['Penalties', 'penalties'],
  ['Yellow cards', 'yellowCards'],
  ['Red cards', 'redCards'],
]

function formatRange({ from, to }) {
  const fmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  return `${fmt(from)} to ${fmt(to)}`
}

function SideBar({ label, us, them }) {
  const total = us + them
  const usShare = total > 0 ? (us / total) * 100 : 50
  return (
    <div className="tc-side-row">
      <span className="tc-side-value">{us}</span>
      <div className="tc-side-middle">
        <span className="tc-side-label">{label}</span>
        <div className="tc-side-bar" aria-hidden="true">
          <span className="tc-side-bar-us" style={{ width: `${usShare}%` }} />
        </div>
      </div>
      <span className="tc-side-value tc-side-value-them">{them}</span>
    </div>
  )
}

function Delta({ value, previous, suffix = '', lowerIsBetter = false }) {
  if (previous === undefined || previous === null) return null
  const diff = +(value - previous).toFixed(2)
  if (diff === 0) return <span className="tc-delta">Same as before</span>
  const better = lowerIsBetter ? diff < 0 : diff > 0
  return (
    <span className={`tc-delta ${better ? 'tc-delta-up' : 'tc-delta-down'}`}>
      {diff > 0 ? '+' : ''}{diff}{suffix} vs comparison
    </span>
  )
}

function TeamCompare() {
  const { getToken } = useAuth()
  const [preset, setPreset] = useState('year')
  const [custom, setCustom] = useState(() => periodFor('year'))
  const [compareMode, setCompareMode] = useState('none')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const period = useMemo(() => (preset === 'custom' ? custom : periodFor(preset)), [preset, custom])
  const comparison = useMemo(() => comparisonFor(compareMode, period), [compareMode, period])

  const load = useCallback(async () => {
    if (!period.from || !period.to || period.from > period.to) {
      setError('Choose a start date on or before the end date.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ from: period.from, to: period.to })
    if (comparison) {
      params.set('vs_from', comparison.from)
      params.set('vs_to', comparison.to)
    }
    try {
      setData(await apiRequest(`/api/compare/team?${params}`, { getToken }))
    } catch (err) {
      setData(null)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [period, comparison, getToken])

  useEffect(() => {
    load()
  }, [load])

  const s = data?.period?.summary
  const prev = data?.comparePeriod?.summary

  return (
    <section className="tc" aria-labelledby="tc-heading">
      <div className="tc-heading-row">
        <h2 id="tc-heading" className="tc-heading">Your team against its opponents</h2>
        <Link to="/reports" className="btn btn-ghost">Season report</Link>
      </div>

      <div className="tc-controls">
        <label className="tc-field">
          Period
          <select value={preset} onChange={(e) => setPreset(e.target.value)}>
            <option value="year">This year</option>
            <option value="last-year">Last year</option>
            <option value="90">Last 90 days</option>
            <option value="custom">Custom dates</option>
          </select>
        </label>
        {preset === 'custom' && (
          <>
            <label className="tc-field">
              From
              <input type="date" value={custom.from} max={custom.to}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            </label>
            <label className="tc-field">
              To
              <input type="date" value={custom.to} min={custom.from}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </label>
          </>
        )}
        <label className="tc-field">
          Compare with
          <select value={compareMode} onChange={(e) => setCompareMode(e.target.value)}>
            <option value="none">Nothing</option>
            <option value="previous">The period before</option>
            <option value="last-year">Same dates last year</option>
          </select>
        </label>
      </div>

      <p className="tc-range" aria-live="polite">
        {formatRange(period)}
        {comparison && <> compared with {formatRange(comparison)}</>}
      </p>

      {error && <div className="cmp-error" role="alert">{error}</div>}
      {loading && !data && <p className="tc-muted">Loading team stats...</p>}

      {s && s.played === 0 && !error && (
        <p className="tc-empty">
          No finished matches in this period. Results appear here once a match is completed.
        </p>
      )}

      {s && s.played > 0 && (
        <div className={`tc-body${loading ? ' tc-body-loading' : ''}`}>
          <dl className="tc-record">
            <div>
              <dt>Played</dt>
              <dd>{s.played}</dd>
              <Delta value={s.played} previous={prev?.played} />
            </div>
            <div>
              <dt>Won, drawn, lost</dt>
              <dd>{s.wins}–{s.draws}–{s.losses}</dd>
              <Delta value={s.winRate} previous={prev?.winRate} suffix="% win rate" />
            </div>
            <div>
              <dt>Points</dt>
              <dd>{s.points}</dd>
              <Delta value={s.pointsPerMatch} previous={prev?.pointsPerMatch} suffix=" per match" />
            </div>
            <div>
              <dt>Goal difference</dt>
              <dd>{s.goalDifference > 0 ? `+${s.goalDifference}` : s.goalDifference}</dd>
              <Delta value={s.goalDifference} previous={prev?.goalDifference} />
            </div>
            <div>
              <dt>Clean sheets</dt>
              <dd>{s.cleanSheets}</dd>
              <Delta value={s.cleanSheets} previous={prev?.cleanSheets} />
            </div>
          </dl>

          <div className="tc-sides">
            <div className="tc-sides-head">
              <span>Us</span>
              <span>Opponents</span>
            </div>
            {SIDE_ROWS.map(([label, key]) => (
              <SideBar key={key} label={label} us={s.us[key]} them={s.them[key]} />
            ))}
          </div>

          {prev && (
            <div className="tc-table-wrap">
              <table className="tc-table">
                <caption>Per-match averages, this period against the comparison</caption>
                <thead>
                  <tr>
                    <th scope="col">Measure</th>
                    <th scope="col">This period</th>
                    <th scope="col">Comparison</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><th scope="row">Matches</th><td>{s.played}</td><td>{prev.played}</td></tr>
                  <tr><th scope="row">Win rate</th><td>{s.winRate}%</td><td>{prev.winRate}%</td></tr>
                  <tr><th scope="row">Points per match</th><td>{s.pointsPerMatch}</td><td>{prev.pointsPerMatch}</td></tr>
                  <tr><th scope="row">Goals scored per match</th><td>{s.perMatch.goalsFor}</td><td>{prev.perMatch.goalsFor}</td></tr>
                  <tr><th scope="row">Goals conceded per match</th><td>{s.perMatch.goalsAgainst}</td><td>{prev.perMatch.goalsAgainst}</td></tr>
                  <tr><th scope="row">Shots on target per match</th><td>{s.perMatch.shotsOnTargetFor}</td><td>{prev.perMatch.shotsOnTargetFor}</td></tr>
                </tbody>
              </table>
            </div>
          )}

          <div className="tc-table-wrap">
            <table className="tc-table">
              <caption>Record against each opponent</caption>
              <thead>
                <tr>
                  <th scope="col">Opponent</th>
                  <th scope="col"><abbr title="Played">P</abbr></th>
                  <th scope="col"><abbr title="Won">W</abbr></th>
                  <th scope="col"><abbr title="Drawn">D</abbr></th>
                  <th scope="col"><abbr title="Lost">L</abbr></th>
                  <th scope="col"><abbr title="Goals for">GF</abbr></th>
                  <th scope="col"><abbr title="Goals against">GA</abbr></th>
                </tr>
              </thead>
              <tbody>
                {data.period.opponents.map((o) => (
                  <tr key={o.opponent}>
                    <th scope="row">{o.opponent}</th>
                    <td>{o.played}</td>
                    <td>{o.wins}</td>
                    <td>{o.draws}</td>
                    <td>{o.losses}</td>
                    <td>{o.goalsFor}</td>
                    <td>{o.goalsAgainst}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}

export default TeamCompare
