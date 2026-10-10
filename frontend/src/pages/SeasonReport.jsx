// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
// Season report (T20): a printable summary of a period with a CSV export.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Link, useSearchParams } from 'react-router-dom'
import Layout from '../components/Layout'
import Loader from '../components/Loader'
import { apiRequest } from '../lib/api'
import { periodFor } from '../lib/periods'
import { toCsv, downloadCsv, slug } from '../lib/csv'
import '../components/TeamCompare.css'
import './Report.css'

function formatDay(value) {
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatRange(from, to) {
  return `${formatDay(`${from}T00:00:00`)} to ${formatDay(`${to}T00:00:00`)}`
}

const RESULT_LABEL = { W: 'Won', D: 'Drew', L: 'Lost' }

function SeasonReport() {
  const { getToken } = useAuth()
  const [preset, setPreset] = useState('year')
  const [custom, setCustom] = useState(() => periodFor('year'))
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Saved seasons (T17): picked here so the report covers exactly the
  // coach's season instead of hand-typed dates. Loaded lazily — only once
  // the option is chosen or a ?season= link opens the page.
  const [seasonsList, setSeasonsList] = useState(null)
  const [seasonId, setSeasonId] = useState('')
  const [seasonsError, setSeasonsError] = useState('')
  const [searchParams] = useSearchParams()

  useEffect(() => {
    const wanted = searchParams.get('season')
    if (wanted) {
      setPreset('season')
      setSeasonId(wanted)
      apiRequest('/api/seasons', { getToken })
        .then((list) => setSeasonsList(list))
        .catch((err) => setSeasonsError(err.message))
    }
  }, [searchParams, getToken])

  const loadSeasons = useCallback(async () => {
    if (seasonsList) return
    try {
      setSeasonsList(await apiRequest('/api/seasons', { getToken }))
    } catch (err) {
      setSeasonsError(err.message)
    }
  }, [getToken, seasonsList])

  const period = useMemo(() => {
    if (preset === 'custom') return custom
    if (preset === 'season') {
      const season = seasonsList?.find((s) => String(s.id) === seasonId)
      return season ? { from: season.starts_on, to: season.ends_on } : null
    }
    return periodFor(preset)
  }, [preset, custom, seasonsList, seasonId])

  const load = useCallback(async () => {
    // "A saved season" with nothing picked yet: wait rather than error.
    if (preset === 'season' && !period) {
      setReport(null)
      setLoading(false)
      return
    }
    if (!period.from || !period.to || period.from > period.to) {
      setError('Choose a start date on or before the end date.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ from: period.from, to: period.to })
      setReport(await apiRequest(`/api/reports/season?${params}`, { getToken }))
    } catch (err) {
      setReport(null)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [preset, period, getToken])

  useEffect(() => {
    load()
  }, [load])

  function exportCsv() {
    const results = toCsv(
      ['Date', 'Opponent', 'Competition', 'Result', 'Goals for', 'Goals against',
        'Shots on target for', 'Shots on target against', 'Yellow cards', 'Red cards'],
      report.matches.map((m) => [
        new Date(m.date).toISOString().slice(0, 10), m.opponent, m.competition || 'Friendly',
        m.result, m.us.goals, m.them.goals, m.us.shotsOnTarget, m.them.shotsOnTarget,
        m.us.yellowCards, m.us.redCards,
      ])
    )
    const players = toCsv(
      ['Player', 'Number', 'Appearances', 'Goals', 'Assists', 'Shots on target', 'Yellow cards', 'Red cards'],
      report.players.map((p) => [
        p.name, p.squadNumber, p.appearances, p.goals, p.assists, p.shotsOnTarget, p.yellowCards, p.redCards,
      ])
    )
    // One file, two tables, separated by a blank line: opens cleanly in Excel
    // and Google Sheets without needing a zip of several files.
    downloadCsv(
      `${slug(report.squadName)}-season-${period.from}-to-${period.to}.csv`,
      `Results\r\n${results}\r\n\r\nPlayers\r\n${players}\r\n`
    )
  }

  const s = report?.summary

  return (
    <Layout>
      <div className="rp-page">
        <div className="rp-toolbar">
          <div className="rp-toolbar-fields">
            <label className="tc-field">
              Period
              <select value={preset} onChange={(e) => {
                if (e.target.value === 'season') loadSeasons()
                setPreset(e.target.value)
              }}>
                <option value="year">This year</option>
                <option value="last-year">Last year</option>
                <option value="90">Last 90 days</option>
                <option value="season">A saved season</option>
                <option value="custom">Custom dates</option>
              </select>
            </label>
            {preset === 'season' && (
              <label className="tc-field">
                Season
                <select value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
                  <option value="">Choose a season…</option>
                  {(seasonsList || []).map((s) => (
                    <option key={s.id} value={String(s.id)}>{s.name}</option>
                  ))}
                </select>
              </label>
            )}
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
          </div>
          <div className="rp-toolbar-actions">
            <button type="button" className="btn btn-ghost" onClick={exportCsv} disabled={!report || !s?.played}>
              Download CSV
            </button>
            <button type="button" className="btn btn-gold" onClick={() => window.print()} disabled={!report}>
              Print or save as PDF
            </button>
          </div>
        </div>

        {error && <div className="cmp-error" role="alert">{error}</div>}
        {seasonsError && <div className="cmp-error" role="alert">{seasonsError}</div>}
        {preset === 'season' && !period && (
          <p className="tc-muted">Choose one of your seasons to build its report.</p>
        )}
        {loading && !report && <Loader label="Building the report..." />}

        {report && (
          <article className={`rp-doc${loading ? ' rp-doc-loading' : ''}`}>
            <header className="rp-doc-head">
              <p className="rp-doc-kind">Season report</p>
              <h1 className="rp-doc-title">{report.squadName}</h1>
              <p className="rp-doc-meta">{formatRange(report.from, report.to)}</p>
            </header>

            {s.played === 0 ? (
              <p className="tc-empty">
                No finished matches in this period. Results appear here once a match is completed.
              </p>
            ) : (
              <>
                <dl className="tc-record rp-record">
                  <div><dt>Played</dt><dd>{s.played}</dd></div>
                  <div><dt>Won, drawn, lost</dt><dd>{s.wins}–{s.draws}–{s.losses}</dd></div>
                  <div><dt>Points</dt><dd>{s.points}</dd></div>
                  <div><dt>Goals for and against</dt><dd>{s.goalsFor}–{s.goalsAgainst}</dd></div>
                  <div><dt>Clean sheets</dt><dd>{s.cleanSheets}</dd></div>
                </dl>

                <section className="rp-section">
                  <h2>Results</h2>
                  <div className="tc-table-wrap">
                    <table className="tc-table">
                      <thead>
                        <tr>
                          <th scope="col">Date</th>
                          <th scope="col">Opponent</th>
                          <th scope="col">Competition</th>
                          <th scope="col">Score</th>
                          <th scope="col">Result</th>
                          <th scope="col" className="rp-no-print"><span className="sr-only">Report</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.matches.map((m) => (
                          <tr key={`${m.kind}-${m.id}`}>
                            <td>{formatDay(m.date)}</td>
                            <th scope="row">{m.opponent}</th>
                            <td>{m.competition || 'Friendly'}</td>
                            <td>{m.us.goals}–{m.them.goals}</td>
                            <td><span className={`rp-result rp-result-${m.result}`}>{RESULT_LABEL[m.result]}</span></td>
                            <td className="rp-no-print">
                              <Link to={`/reports/match/${m.kind === 'fixture' ? 'fixture' : 'event'}/${m.id}`}>
                                Match report
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="rp-section">
                  <h2>Players</h2>
                  {report.players.length === 0 ? (
                    <p className="tc-muted">No player actions were logged in these matches.</p>
                  ) : (
                    <div className="tc-table-wrap">
                      <table className="tc-table">
                        <thead>
                          <tr>
                            <th scope="col">Player</th>
                            <th scope="col"><abbr title="Appearances">Apps</abbr></th>
                            <th scope="col">Goals</th>
                            <th scope="col">Assists</th>
                            <th scope="col"><abbr title="Shots on target">SoT</abbr></th>
                            <th scope="col"><abbr title="Yellow cards">YC</abbr></th>
                            <th scope="col"><abbr title="Red cards">RC</abbr></th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.players.map((p) => (
                            <tr key={p.id}>
                              <th scope="row">{p.squadNumber != null ? `${p.squadNumber}. ` : ''}{p.name}</th>
                              <td>{p.appearances}</td>
                              <td>{p.goals}</td>
                              <td>{p.assists}</td>
                              <td>{p.shotsOnTarget}</td>
                              <td>{p.yellowCards}</td>
                              <td>{p.redCards}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="rp-section">
                  <h2>Against each opponent</h2>
                  <div className="tc-table-wrap">
                    <table className="tc-table">
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
                        {report.opponents.map((o) => (
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
                </section>
              </>
            )}
            <p className="rp-footnote">
              Generated by KickStat on {formatDay(new Date())}. All figures come from the live match log.
            </p>
          </article>
        )}
      </div>
    </Layout>
  )
}

export default SeasonReport
