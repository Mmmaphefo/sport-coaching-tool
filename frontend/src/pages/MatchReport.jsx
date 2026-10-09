// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
// Match report (T20): a printable record of one match with a CSV export of
// its timeline. Works for regular matches and league/tournament fixtures.
import { useEffect, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Link, useParams } from 'react-router-dom'
import Layout from '../components/Layout'
import Loader from '../components/Loader'
import { apiRequest } from '../lib/api'
import { toCsv, downloadCsv, slug } from '../lib/csv'
import '../components/TeamCompare.css'
import './Report.css'

const ACTION_LABEL = {
  goal: 'Goal',
  point: 'Point',
  assist: 'Assist',
  penalty: 'Penalty',
  shot_on_target: 'Shot on target',
  save: 'Save',
  yellow_card: 'Yellow card',
  red_card: 'Red card',
  substitution: 'Substitution',
  other: 'Other',
}

const RESULT_LABEL = { W: 'Won', D: 'Drew', L: 'Lost' }

function minuteLabel(minute) {
  return minute === null || minute === undefined ? '' : `${minute}′`
}

function MatchReport() {
  const { kind, id } = useParams()
  const { getToken } = useAuth()
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    apiRequest(`/api/reports/match/${kind}/${id}`, { getToken })
      .then((data) => {
        if (!cancelled) setReport(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [kind, id, getToken])

  if (error) {
    return (
      <Layout>
        <div className="rp-page">
          <div className="cmp-error" role="alert">{error}</div>
          <Link to="/reports" className="btn btn-ghost">Back to reports</Link>
        </div>
      </Layout>
    )
  }

  if (!report) {
    return (
      <Layout>
        <div className="rp-page"><Loader label="Building the report..." /></div>
      </Layout>
    )
  }

  const { match, score, squadName } = report
  const home = match.home ? { name: squadName, side: 'us' } : { name: match.opponent, side: 'them' }
  const away = match.home ? { name: match.opponent, side: 'them' } : { name: squadName, side: 'us' }
  const sideName = (side) => (side === 'us' ? squadName : match.opponent)
  const date = new Date(match.date)
  const finished = match.status === 'completed'

  function exportCsv() {
    const csv = toCsv(
      ['Minute', 'Team', 'Action', 'Player', 'Detail'],
      report.timeline.map((t) => [
        t.minute ?? '', sideName(t.side), ACTION_LABEL[t.action] || t.action, t.name, t.detail || '',
      ])
    )
    downloadCsv(`${slug(squadName)}-vs-${slug(match.opponent)}-${date.toISOString().slice(0, 10)}.csv`, csv)
  }

  const statRows = [
    ['Shots on target', 'shotsOnTarget'],
    ['Saves', 'saves'],
    ['Penalties', 'penalties'],
    ['Yellow cards', 'yellowCards'],
    ['Red cards', 'redCards'],
  ]

  return (
    <Layout>
      <div className="rp-page">
        <div className="rp-toolbar">
          <Link to="/reports" className="btn btn-ghost">Season report</Link>
          <div className="rp-toolbar-actions">
            <button type="button" className="btn btn-ghost" onClick={exportCsv} disabled={report.timeline.length === 0}>
              Download CSV
            </button>
            <button type="button" className="btn btn-gold" onClick={() => window.print()}>
              Print or save as PDF
            </button>
          </div>
        </div>

        <article className="rp-doc">
          <header className="rp-doc-head">
            <p className="rp-doc-kind">
              Match report{match.competition ? `, ${match.competition}` : ''}
            </p>
            <p className="rp-doc-meta">
              {date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              {match.location ? `, ${match.location}` : ''}
            </p>
            {!finished && (
              <p className="rp-provisional">This match is not finished yet, so the score is provisional.</p>
            )}
          </header>

          <div className="rp-scoreline" aria-label={`${home.name} ${score[home.side]}, ${away.name} ${score[away.side]}`}>
            <span className="rp-team">{home.name}</span>
            <span className="rp-score">{score[home.side]}–{score[away.side]}</span>
            <span className="rp-team rp-team-away">{away.name}</span>
          </div>
          {finished && (
            <p className="rp-outcome">
              <span className={`rp-result rp-result-${report.result}`}>{RESULT_LABEL[report.result]}</span>
            </p>
          )}

          <div className="rp-columns">
            <section className="rp-section">
              <h2>Goals</h2>
              {report.scorers.length === 0 ? <p className="tc-muted">No goals.</p> : (
                <ul className="rp-list">
                  {report.scorers.map((g, i) => (
                    <li key={i}>
                      <span className="rp-minute">{minuteLabel(g.minute)}</span>
                      <span>
                        <strong>{g.name}</strong>
                        {g.side === 'them' && g.name !== match.opponent ? ` (${match.opponent})` : ''}
                        {g.assist ? `, assisted by ${g.assist}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rp-section">
              <h2>Discipline</h2>
              {report.cards.length === 0 && report.penalties.length === 0 ? (
                <p className="tc-muted">No cards or penalties.</p>
              ) : (
                <ul className="rp-list">
                  {report.cards.map((c, i) => (
                    <li key={`c${i}`}>
                      <span className="rp-minute">{minuteLabel(c.minute)}</span>
                      <span>
                        <span className={`rp-card rp-card-${c.card}`} aria-hidden="true" />
                        {c.card === 'red' ? 'Red card' : 'Yellow card'}: <strong>{c.name}</strong>
                        {c.side === 'them' && c.name !== match.opponent ? ` (${match.opponent})` : ''}
                      </span>
                    </li>
                  ))}
                  {report.penalties.map((p, i) => (
                    <li key={`p${i}`}>
                      <span className="rp-minute">{minuteLabel(p.minute)}</span>
                      <span>Penalty: <strong>{p.name}</strong>{p.side === 'them' && p.name !== match.opponent ? ` (${match.opponent})` : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="rp-section">
            <h2>Match stats</h2>
            <div className="tc-sides">
              <div className="tc-sides-head">
                <span>{squadName}</span>
                <span>{match.opponent}</span>
              </div>
              {statRows.map(([label, key]) => {
                const us = report.stats.us[key]
                const them = report.stats.them[key]
                const share = us + them > 0 ? (us / (us + them)) * 100 : 50
                return (
                  <div className="tc-side-row" key={key}>
                    <span className="tc-side-value">{us}</span>
                    <div className="tc-side-middle">
                      <span className="tc-side-label">{label}</span>
                      <div className="tc-side-bar" aria-hidden="true">
                        <span className="tc-side-bar-us" style={{ width: `${share}%` }} />
                      </div>
                    </div>
                    <span className="tc-side-value tc-side-value-them">{them}</span>
                  </div>
                )
              })}
            </div>
          </section>

          {report.substitutions.length > 0 && (
            <section className="rp-section">
              <h2>Substitutions</h2>
              <ul className="rp-list">
                {report.substitutions.map((sub, i) => (
                  <li key={i}>
                    <span className="rp-minute">{minuteLabel(sub.minute)}</span>
                    <span>{sub.on ? <><strong>{sub.on}</strong> on for {sub.off}</> : <>{sub.off} off</>}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rp-section">
            <h2>Timeline</h2>
            {report.timeline.length === 0 ? <p className="tc-muted">Nothing was logged for this match.</p> : (
              <div className="tc-table-wrap">
                <table className="tc-table">
                  <thead>
                    <tr>
                      <th scope="col">Minute</th>
                      <th scope="col">Team</th>
                      <th scope="col">Action</th>
                      <th scope="col">Player</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.timeline.map((t, i) => (
                      <tr key={i}>
                        <td>{minuteLabel(t.minute) || '–'}</td>
                        <td>{sideName(t.side)}</td>
                        <th scope="row">{ACTION_LABEL[t.action] || t.action}</th>
                        <td>{t.action === 'substitution' && t.detail ? t.detail : t.name}{t.detail && t.action !== 'substitution' ? `, ${t.detail}` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p className="rp-footnote">
            Generated by KickStat on {new Date().toLocaleDateString()}. All figures come from the live match log.
          </p>
        </article>
      </div>
    </Layout>
  )
}

export default MatchReport
