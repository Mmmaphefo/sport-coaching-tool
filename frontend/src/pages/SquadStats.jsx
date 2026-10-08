import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import Layout from '../components/Layout'
import { apiRequest } from '../lib/api'
import './SquadStats.css'

const RESULT_COLORS = { W: '#1d7a34', D: '#9a9a9a', L: '#b3261e' }

// Dependency-free SVG line chart, same spirit as the one in AthleteStats.
// series: match rows in chronological order, each with `cumulative` totals.
// lines: [{ key, label, color }] plotted from each row's cumulative[key].
function CumulativeChart({ series, lines, title }) {
  if (!series || series.length === 0) return null

  const width = 640
  const height = 220
  const pad = { top: 24, right: 16, bottom: 34, left: 40 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom

  const values = series.flatMap((m) => lines.map((l) => m.cumulative[l.key]))
  const max = Math.max(...values, 1)
  const stepX = series.length > 1 ? plotW / (series.length - 1) : 0
  const xAt = (i) => pad.left + i * stepX
  const yAt = (v) => pad.top + plotH - (v / max) * plotH

  const labelEvery = Math.ceil(series.length / 8)

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: '100%', maxWidth: 640, height: 'auto' }}
      role="img"
      aria-label={title}
    >
      {/* gridlines */}
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={yAt(max * f)}
            y2={yAt(max * f)}
            stroke="#eee"
          />
          <text x={pad.left - 6} y={yAt(max * f) + 4} textAnchor="end" fontSize="10" fill="#888">
            {Math.round(max * f)}
          </text>
        </g>
      ))}

      {lines.map((l) => (
        <g key={l.key}>
          <polyline
            fill="none"
            stroke={l.color}
            strokeWidth="2"
            points={series.map((m, i) => `${xAt(i)},${yAt(m.cumulative[l.key])}`).join(' ')}
          />
          {series.map((m, i) => (
            <circle
              key={`${l.key}-${m.kind}-${m.refId}`}
              cx={xAt(i)}
              cy={yAt(m.cumulative[l.key])}
              r={l.key === '__result' ? 4 : 3}
              fill={l.key === '__result' ? RESULT_COLORS[m.result] || '#333' : l.color}
            >
              <title>{`M${i + 1} vs ${m.opponent}: ${m.gf}-${m.ga} (${m.result}) · ${l.label} ${m.cumulative[l.key]}`}</title>
            </circle>
          ))}
        </g>
      ))}

      {series.map((m, i) =>
        i % labelEvery === 0 || i === series.length - 1 ? (
          <text
            key={`x-${m.kind}-${m.refId}`}
            x={xAt(i)}
            y={height - pad.bottom + 16}
            textAnchor="middle"
            fontSize="9"
            fill="#888"
          >
            {m.date ? new Date(m.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : `M${i + 1}`}
          </text>
        ) : null
      )}

      {lines.map((l, i) => (
        <g key={`legend-${l.key}`} transform={`translate(${pad.left + i * 130}, ${height - 8})`}>
          <rect width="10" height="10" rx="2" fill={l.color} />
          <text x="14" y="9" fontSize="10" fill="#555">
            {l.label}
          </text>
        </g>
      ))}
    </svg>
  )
}

function SquadStats() {
  const { getToken } = useAuth()

  const [seasons, setSeasons] = useState([])
  const [seasonId, setSeasonId] = useState('')
  const [trends, setTrends] = useState(null)
  const [opponents, setOpponents] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const query = seasonId ? `?season_id=${encodeURIComponent(seasonId)}` : ''
      const [t, o] = await Promise.all([
        apiRequest(`/api/squads/mine/trends${query}`, { getToken }),
        apiRequest(`/api/squads/mine/vs-opponents${query}`, { getToken }),
      ])
      setTrends(t)
      setOpponents(o)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonId])

  useEffect(() => {
    apiRequest('/api/seasons', { getToken })
      .then(setSeasons)
      .catch(() => setSeasons([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <Layout>
      <div className="roster-header">
        <div>
          <span className="dashboard-eyebrow">Squad stats</span>
          <h1>Trends &amp; opponent comparison</h1>
        </div>
        <div>
          <select
            value={seasonId}
            onChange={(e) => setSeasonId(e.target.value)}
            style={{ padding: '0.4rem 0.6rem', borderRadius: 6 }}
          >
            <option value="">All time</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="roster-error">{error}</div>}
      {loading && <p className="roster-status">Loading squad stats...</p>}

      {trends && (
        <>
          <div className="stats-grid">
            <div className="stats-card">
              <span className="stats-value">{trends.totals.played}</span>
              <span className="stats-label">Played</span>
            </div>
            <div className="stats-card">
              <span className="stats-value">{trends.totals.wins}</span>
              <span className="stats-label">Won</span>
            </div>
            <div className="stats-card">
              <span className="stats-value">{trends.totals.draws}</span>
              <span className="stats-label">Drawn</span>
            </div>
            <div className="stats-card">
              <span className="stats-value">{trends.totals.losses}</span>
              <span className="stats-label">Lost</span>
            </div>
            <div className="stats-card">
              <span className="stats-value">
                {trends.totals.gd > 0 ? `+${trends.totals.gd}` : trends.totals.gd}
              </span>
              <span className="stats-label">Goal diff</span>
            </div>
            <div className="stats-card">
              <span className="stats-value">{trends.totals.points}</span>
              <span className="stats-label">Points</span>
            </div>
          </div>

          <h3 className="live-section-heading">Form over time</h3>
          {trends.matches.length === 0 ? (
            <div className="roster-empty">
              <p>No completed matches in this range yet — results will chart here.</p>
            </div>
          ) : (
            <div className="squadstats-charts">
              <div>
                <p className="squadstats-chart-title">Cumulative points (dot colour = match result)</p>
                <CumulativeChart
                  series={trends.matches}
                  lines={[{ key: 'points', label: 'Points', color: '#c9a227' }]}
                  title="Cumulative points over time"
                />
              </div>
              <div>
                <p className="squadstats-chart-title">Cumulative goals for / against</p>
                <CumulativeChart
                  series={trends.matches}
                  lines={[
                    { key: 'gf', label: 'Goals for', color: '#1d7a34' },
                    { key: 'ga', label: 'Goals against', color: '#b3261e' },
                  ]}
                  title="Cumulative goals for and against over time"
                />
              </div>
            </div>
          )}
        </>
      )}

      {opponents && (
        <>
          <h3 className="live-section-heading">Team vs opponent comparison</h3>
          {opponents.opponents.length === 0 ? (
            <div className="roster-empty">
              <p>No opponents faced in this range yet.</p>
            </div>
          ) : (
            <div className="squadstats-opponents">
              {opponents.opponents.map((o) => (
                <details key={o.opponent} className="squadstats-opponent">
                  <summary>
                    <span className="squadstats-opponent-name">{o.opponent}</span>
                    <span className="squadstats-opponent-record">
                      P {o.played} · W {o.wins} · D {o.draws} · L {o.losses} · GF {o.gf} · GA {o.ga}
                      {o.gd !== 0 && o.gd > 0 ? ` (+${o.gd})` : o.gd !== 0 ? ` (${o.gd})` : ''}
                    </span>
                  </summary>
                  <ul className="squadstats-opponent-matches">
                    {o.matches.map((m) => (
                      <li key={`${m.kind}-${m.refId}`}>
                        {m.date ? new Date(m.date).toLocaleDateString() : '—'}
                        {m.venue ? ` (${m.venue})` : ''} — {m.gf}-{m.ga}{' '}
                        <span className={`seasons-result seasons-result-${m.result.toLowerCase()}`}>{m.result}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          )}
        </>
      )}
    </Layout>
  )
}

export default SquadStats
