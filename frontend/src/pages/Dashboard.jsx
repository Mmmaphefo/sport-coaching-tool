import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Link, useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import Loader from '../components/Loader'
import { apiRequest } from '../lib/api'
import { useCountUp } from '../lib/useCountUp'
import './Dashboard.css'

const PERIODS = [
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: 'season', label: 'Season' },
]

// Player-view periods map onto calendar-day cutoffs over the player's own
// match logs; "season" shows everything the stats endpoint returned.
const PLAYER_PERIOD_DAYS = { '7d': 7, '30d': 30, season: null }

function StatNumber({ value, suffix = '' }) {
  const animated = useCountUp(value)
  return <>{animated}{suffix}</>
}

function readinessLinePath(trend, width, height, padding) {
  if (!trend.length) return ''
  const innerW = width - padding * 2
  const innerH = height - padding * 2
  return trend
    .map((point, i) => {
      const x = padding + (i / Math.max(trend.length - 1, 1)) * innerW
      const y = padding + innerH - (point.readiness / 100) * innerH
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

// No real training-load data is tracked yet anywhere in the app — this is
// a clearly labelled estimate line, not derived from anything real, per
// the product decision to keep it as a static placeholder for now.
function placeholderTrainingLoadPath(count, width, height, padding) {
  const innerW = width - padding * 2
  const innerH = height - padding * 2
  const shape = [55, 62, 58, 70, 66, 60, 64, 58, 61, 57, 63, 59, 62, 60]
  return shape
    .slice(0, count)
    .map((v, i) => {
      const x = padding + (i / Math.max(count - 1, 1)) * innerW
      const y = padding + innerH - (v / 100) * innerH
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

function Dashboard() {
  const { getToken } = useAuth()
  const navigate = useNavigate()
  const [period, setPeriod] = useState('7d')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteSending, setInviteSending] = useState(false)
  const [inviteResult, setInviteResult] = useState(null)
  const [inviteError, setInviteError] = useState('')
  // The account payload decides which view renders: staff get the squad
  // intelligence, players get a personal view built from their own athlete
  // stats (athleteId is the roster row their account is linked to).
  const [me, setMe] = useState(null)
  const [playerData, setPlayerData] = useState(null)
  const [playerError, setPlayerError] = useState('')
  // Snapshot "now" once for the player period cutoffs — same one-time
  // pattern the profile card uses.
  const [nowMs] = useState(() => Date.now())
  // Season-form trends are independent of the period pills — they always
  // cover the rolling 12-month window, so they load once.
  const [trends, setTrends] = useState(null)

  useEffect(() => {
    let cancelled = false
    apiRequest('/api/account/me', { getToken })
      .then((account) => {
        if (!cancelled) setMe(account)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [getToken])

  const isAthlete = me?.role === 'athlete'
  const athleteId = me?.athleteId ?? null

  // Players' personal numbers come from their own stats endpoint — the same
  // payload that powers their profile card. The squad summary keeps loading
  // for everyone (it powers the live score card and the attack leaders).
  useEffect(() => {
    if (!isAthlete || !athleteId) return undefined
    let cancelled = false
    setPlayerError('')
    apiRequest(`/api/athletes/${athleteId}/stats`, { getToken })
      .then((result) => {
        if (!cancelled) setPlayerData(result)
      })
      .catch((err) => {
        if (!cancelled) setPlayerError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [isAthlete, athleteId, getToken])

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true)
    }
    setError('')
    try {
      const result = await apiRequest(`/api/dashboard/summary?period=${period}`, { getToken })
      setData(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period])

  useEffect(() => {
    load()
  }, [load])

  const loadTrends = useCallback(async () => {
    try {
      const result = await apiRequest('/api/dashboard/trends', { getToken })
      setTrends(result)
    } catch {
      // The form chart is supplementary — a failure leaves the rest of the
      // dashboard untouched.
      setTrends(null)
    }
  }, [getToken])

  useEffect(() => {
    loadTrends()
  }, [loadTrends])

  // While a match is live, quietly re-poll the summary so the live-score
  // card tracks goals as they are logged in the match centre.
  useEffect(() => {
    if (!data?.liveEvent) return undefined
    const poll = setInterval(() => load(true), 10000)
    return () => clearInterval(poll)
  }, [data?.liveEvent, load])

  // ---- Player view: derived personal data ----------------------------------
  // Everything is computed from the athlete stats payload's logs — the same
  // entries the profile card aggregates. The period pills filter the logs;
  // the season cards prefer the server's authoritative totals.
  const playerLogs = useMemo(() => playerData?.logs ?? [], [playerData])

  const playerPeriodLogs = useMemo(() => {
    const days = PLAYER_PERIOD_DAYS[period]
    if (!days) return playerLogs
    const cutoff = nowMs - days * 86400000
    return playerLogs.filter((l) => new Date(l.event_date).getTime() >= cutoff)
  }, [playerLogs, period, nowMs])

  const playerAgg = useMemo(() => {
    const sumOf = (type) =>
      playerPeriodLogs
        .filter((l) => l.action_type === type)
        .reduce((sum, l) => sum + (l.value || 0), 0)
    const appearances = new Set(playerPeriodLogs.map((l) => l.event_id)).size
    if (period === 'season' && playerData?.stats) {
      return {
        appearances: playerData.stats.appearances ?? appearances,
        goals: playerData.stats.goals ?? sumOf('goal'),
        assists: playerData.stats.assists ?? sumOf('assist'),
      }
    }
    return { appearances, goals: sumOf('goal'), assists: sumOf('assist') }
  }, [playerPeriodLogs, playerData, period])

  // One entry per match the player contributed in, in the selected period —
  // the data behind the interactive bar chart below.
  const playerMatches = useMemo(() => {
    const byEvent = new Map()
    for (const log of playerPeriodLogs) {
      if (!byEvent.has(log.event_id)) {
        byEvent.set(log.event_id, {
          eventId: log.event_id,
          date: log.event_date,
          opponent: log.opponent || 'Match',
          goals: 0,
          assists: 0,
        })
      }
      const match = byEvent.get(log.event_id)
      if (log.action_type === 'goal') match.goals += log.value || 0
      if (log.action_type === 'assist') match.assists += log.value || 0
    }
    return [...byEvent.values()]
      .filter((m) => m.goals + m.assists > 0)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(-12)
  }, [playerPeriodLogs])

  const handleInvite = async (e) => {
    e.preventDefault()
    setInviteSending(true)
    setInviteError('')
    setInviteResult(null)
    try {
      const result = await apiRequest('/api/invites', {
        method: 'POST',
        body: { email: inviteEmail },
        getToken,
      })
      setInviteResult(result)
      setInviteEmail('')
    } catch (err) {
      setInviteError(err.message)
    } finally {
      setInviteSending(false)
    }
  }

  const now = new Date()
  const dateLabel = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  const timeLabel = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

  if (loading && !data) {
    return (
      <Layout>
        <Loader label="Loading dashboard..." />
      </Layout>
    )
  }

  if (error && !data) {
    return (
      <Layout>
        <div className="roster-error">{error}</div>
      </Layout>
    )
  }

  // Players additionally wait for their own stats payload before rendering
  // the personal view — it drives the stat cards and the match chart.
  if (isAthlete && !playerData && !playerError) {
    return (
      <Layout>
        <Loader label="Loading your stats..." />
      </Layout>
    )
  }

  const { squad, readinessTrend, positionAvailability, form, teamGoals, attackLeaders, nextEvent, liveEvent } = data

  // Season-form chart inputs (staff view): the last 10 completed matches,
  // oldest first, scaled to the busiest scoreline in that run.
  const trendMatches = trends?.matches ?? []
  const trendRecent = trendMatches.slice(-10)
  const trendMax = Math.max(1, ...trendRecent.map((m) => Math.max(m.goalsFor, m.goalsAgainst)))

  // Player match chart geometry: one stacked bar per match, scaled to the
  // best single-match return in the period.
  const maxContrib = Math.max(1, ...playerMatches.map((m) => m.goals + m.assists))

  const readinessDelta = readinessTrend.length > 1
    ? readinessTrend[readinessTrend.length - 1].readiness - readinessTrend[0].readiness
    : 0

  const chartW = 640
  const chartH = 260
  const chartPad = 28
  const linePath = readinessLinePath(readinessTrend, chartW, chartH, chartPad)
  const trainingPath = placeholderTrainingLoadPath(readinessTrend.length, chartW, chartH, chartPad)

  const posEntries = Object.entries(positionAvailability).filter(([label, v]) => v > 0 || label !== 'Other')
  const maxPos = Math.max(1, ...posEntries.map(([, v]) => v))

  const donutTotal = Math.max(1, squad.readyCount + squad.managedCount + squad.injuredCount)
  const circumference = 2 * Math.PI * 54
  const readySeg = (squad.readyCount / donutTotal) * circumference
  const managedSeg = (squad.managedCount / donutTotal) * circumference
  const injuredSeg = (squad.injuredCount / donutTotal) * circumference

  return (
    <Layout>
      <div className="dash-header">
        <div>
          <h1>Dashboard</h1>
          <span className="dash-eyebrow">Squad intelligence overview</span>
        </div>
        {nextEvent ? (
          <Link to={`/events/${nextEvent.id}`} className="btn btn-gold dash-next-btn">
            Next event
          </Link>
        ) : (
          <Link to="/events" className="btn btn-gold dash-next-btn">
            {isAthlete ? 'View events' : 'Schedule event'}
          </Link>
        )}
      </div>

      <div className="dash-intro">
        <span className="dash-date-line">{dateLabel.toUpperCase()} &middot; UPDATED {timeLabel}</span>
        <h2 className="dash-headline">{isAthlete ? 'Your game at a glance' : 'The full squad picture'}</h2>
        <p className="dash-sub">
          {isAthlete
            ? 'Your appearances, goals, assists and match-by-match output. Figures update together as you change the period.'
            : 'Readiness, workload and output in one matchday view. Figures update together as you change the period.'}
        </p>
        <div className="dash-period-toggle">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              className={`dash-period-pill ${period === p.key ? 'dash-period-pill-active' : ''}`}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {isAthlete && playerError && <p className="dash-invite-error">{playerError}</p>}

      {liveEvent && (
        <div className="dash-live-card" data-testid="dash-live-card">
          <div className="dash-live-top">
            <span className="dash-live-badge">
              <span className="dash-live-badge-dot" />
              Live now
            </span>
            <span className="dash-live-title">{liveEvent.title}</span>
          </div>
          <div className="dash-live-score-row">
            <span className="dash-live-team">{liveEvent.homeLabel}</span>
            <span className="dash-live-score">
              <StatNumber value={liveEvent.homeScore} />
              <span className="dash-live-score-sep">–</span>
              <StatNumber value={liveEvent.awayScore} />
            </span>
            <span className="dash-live-team">{liveEvent.awayLabel}</span>
          </div>
          <div className="dash-live-foot">
            {!isAthlete && (
              <Link to={liveEvent.link} className="dash-live-link">
                Open live match centre &rsaquo;
              </Link>
            )}
            <span className="dash-live-hint">Score updates as goals are logged</span>
          </div>
        </div>
      )}

      {isAthlete ? (
        <div className="dash-stat-grid">
          <div className="dash-stat-card dash-stat-card-accent">
            <span className="dash-stat-label">Goals</span>
            <span className="dash-stat-value"><StatNumber value={playerAgg.goals} /></span>
            <span className="dash-stat-note">{playerAgg.goals + playerAgg.assists} goal contributions</span>
          </div>

          <div className="dash-stat-card">
            <span className="dash-stat-label">Appearances</span>
            <span className="dash-stat-value dash-stat-value-dark"><StatNumber value={playerAgg.appearances} /></span>
            <span className="dash-stat-note">matches in this period</span>
          </div>

          <div className="dash-stat-card">
            <span className="dash-stat-label">Assists</span>
            <span className="dash-stat-value dash-stat-value-dark"><StatNumber value={playerAgg.assists} /></span>
            <span className="dash-stat-note">set up by you</span>
          </div>

          <div className="dash-stat-card">
            <span className="dash-stat-label">Goal contributions</span>
            <span className="dash-stat-value dash-stat-value-dark"><StatNumber value={playerAgg.goals + playerAgg.assists} /></span>
            <span className="dash-stat-note">goals + assists</span>
          </div>
        </div>
      ) : (
        <div className="dash-stat-grid">
          <div className="dash-stat-card dash-stat-card-accent">
            <span className="dash-stat-label">Squad readiness</span>
            <span className="dash-stat-value"><StatNumber value={squad.readinessPct} suffix="%" /></span>
            <span className={`dash-stat-delta ${readinessDelta >= 0 ? 'dash-stat-delta-up' : 'dash-stat-delta-down'}`}>
              {readinessDelta >= 0 ? '+' : ''}{readinessDelta}% this period
            </span>
            {squad.gender && (
              <span className="dash-gender-badge">{squad.gender === 'male' ? '♂ Male' : '♀ Female'}</span>
            )}
          </div>

          <div className="dash-stat-card">
            <span className="dash-stat-label">Available now</span>
            <span className="dash-stat-value dash-stat-value-dark">
              <StatNumber value={squad.readyCount} />/{squad.totalRoster}
            </span>
            <span className="dash-stat-note">{squad.managedCount} managed &middot; {squad.injuredCount} injured</span>
          </div>

          <div className="dash-stat-card">
            <span className="dash-stat-label">Team goals</span>
            <span className="dash-stat-value dash-stat-value-dark"><StatNumber value={teamGoals.total} /></span>
            <span className="dash-stat-note">{teamGoals.perMatch} per match</span>
          </div>

          <div className="dash-stat-card">
            <span className="dash-stat-label">Recent form</span>
            <span className="dash-stat-value dash-stat-value-dark dash-form-letters">
              {form.results.length ? form.results.join(' ') : '\u2014'}
            </span>
            <span className="dash-stat-note">{form.points} points from {form.pointsPossible}</span>
          </div>
        </div>
      )}

      <div className="dash-mid-grid">
        {isAthlete ? (
          <div className="dash-chart-card">
            <span className="dash-chart-eyebrow">Match by match</span>
            <h3>Your goal contributions</h3>
            {playerMatches.length === 0 ? (
              <p className="roster-status">No goals or assists logged in this period yet.</p>
            ) : (
              <>
                <div className="dash-player-chart">
                  {playerMatches.map((match) => {
                    const total = match.goals + match.assists
                    const heightPct = Math.round((total / maxContrib) * 100)
                    return (
                      <button
                        type="button"
                        key={match.eventId}
                        className="dash-player-chart-col"
                        title={`vs ${match.opponent} — ${match.goals} goal${match.goals === 1 ? '' : 's'}, ${match.assists} assist${match.assists === 1 ? '' : 's'}`}
                        onClick={() => navigate(`/events/${match.eventId}`)}
                      >
                        <span className="dash-player-bar-track">
                          <span className="dash-player-bar-stack" style={{ height: `${heightPct}%` }}>
                            {match.assists > 0 && (
                              <span className="dash-player-bar-assists" style={{ flexGrow: match.assists }} />
                            )}
                            <span className="dash-player-bar-goals" style={{ flexGrow: match.goals }} />
                          </span>
                        </span>
                        <span className="dash-player-chart-value">{total}</span>
                        <span className="dash-player-chart-label">
                          {new Date(match.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <div className="dash-chart-footer">
                  <span className="dash-legend-item"><span className="dash-legend-swatch dash-legend-swatch-gold" /> Goals</span>
                  <span className="dash-legend-item"><span className="dash-legend-swatch dash-legend-swatch-blue" /> Assists</span>
                  <span className="dash-player-chart-hint">Tap a bar to open the match</span>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="dash-chart-card">
            <span className="dash-chart-eyebrow">Performance pulse</span>
            <h3>Readiness vs training load</h3>
            <svg viewBox={`0 0 ${chartW} ${chartH}`} className="dash-line-chart" preserveAspectRatio="none">
              <line x1={chartPad} y1={chartH - chartPad} x2={chartW - chartPad} y2={chartH - chartPad} stroke="var(--color-line)" strokeWidth="1" />
              <path d={trainingPath} fill="none" stroke="var(--color-silver)" strokeWidth="2" strokeDasharray="5 5" />
              <path d={linePath} fill="none" stroke="var(--color-blue)" strokeWidth="3" className="dash-line-path" />
            </svg>
            <div className="dash-chart-footer">
              <span className="dash-legend-item"><span className="dash-legend-swatch dash-legend-swatch-blue" /> Readiness (real)</span>
              <span className="dash-legend-item"><span className="dash-legend-swatch dash-legend-swatch-dashed" /> Training load (estimate)</span>
            </div>
          </div>
        )}

        <div className="dash-fixture-card">
          {nextEvent ? (
            <>
              <span className="dash-fixture-eyebrow">Next fixture</span>
              <h3>{nextEvent.opponent ? `vs ${nextEvent.opponent}` : (nextEvent.title || 'Upcoming event')}</h3>
              <div className="dash-fixture-grid">
                <div>
                  <span className="dash-fixture-label">Kick-off</span>
                  <span className="dash-fixture-value">
                    {new Date(nextEvent.event_date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div>
                  <span className="dash-fixture-label">Venue</span>
                  <span className="dash-fixture-value">{nextEvent.location || 'TBC'}</span>
                </div>
              </div>
              {/* Lineup confidence is a staff planning tool — players don't
                  see squad-selection estimates. */}
              {!isAthlete && (
                <div className="dash-fixture-confidence">
                  <div className="dash-fixture-confidence-top">
                    <span>Lineup confidence</span>
                    <span className="dash-fixture-confidence-tag">estimate</span>
                  </div>
                  <div className="dash-confidence-track">
                    <div className="dash-confidence-fill" style={{ width: '70%' }} />
                  </div>
                </div>
              )}
              <Link to={`/events/${nextEvent.id}`} className="dash-fixture-link">Open match details &rsaquo;</Link>
            </>
          ) : (
            <>
              <span className="dash-fixture-eyebrow">Next fixture</span>
              <h3>No upcoming event scheduled</h3>
              <p className="dash-fixture-empty">Create an event to see matchday details here.</p>
              <Link to="/events" className="dash-fixture-link">Go to events &rsaquo;</Link>
            </>
          )}
        </div>
      </div>

      <div className="dash-bottom-grid">
        {!isAthlete && (
          <div className="dash-panel" data-testid="dash-trends">
            <span className="dash-chart-eyebrow">Season form</span>
            <h3>Match results</h3>
            {trendMatches.length === 0 ? (
              <p className="roster-status">No completed matches yet — the form chart fills in as results come in.</p>
            ) : (
              <>
                <div className="dash-trend-dots">
                  {trendRecent.map((m) => (
                    <button
                      type="button"
                      key={`dot-${m.kind}-${m.id}`}
                      className={`dash-trend-dot dash-trend-${m.result.toLowerCase()}`}
                      title={`${new Date(m.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} vs ${m.opponent} — ${m.goalsFor}-${m.goalsAgainst}`}
                      onClick={() => navigate(`/reports/match/${m.kind}/${m.id}`)}
                    >
                      {m.result}
                    </button>
                  ))}
                </div>
                <div className="dash-trend-bars">
                  {trendRecent.map((m) => (
                    <button
                      type="button"
                      key={`bar-${m.kind}-${m.id}`}
                      className="dash-trend-col"
                      title={`vs ${m.opponent} — ${m.goalsFor} for, ${m.goalsAgainst} against`}
                      onClick={() => navigate(`/reports/match/${m.kind}/${m.id}`)}
                    >
                      <span className="dash-trend-bar-track">
                        <span
                          className="dash-trend-bar dash-trend-bar-for"
                          style={{ height: `${(m.goalsFor / trendMax) * 100}%` }}
                        />
                      </span>
                      <span className="dash-trend-bar-track">
                        <span
                          className="dash-trend-bar dash-trend-bar-against"
                          style={{ height: `${(m.goalsAgainst / trendMax) * 100}%` }}
                        />
                      </span>
                    </button>
                  ))}
                </div>
                {trends?.summary && (
                  <div className="dash-trend-record">
                    <span><strong>{trends.summary.played}</strong> played</span>
                    <span><strong>{trends.summary.wins}</strong> won</span>
                    <span><strong>{trends.summary.draws}</strong> drawn</span>
                    <span><strong>{trends.summary.losses}</strong> lost</span>
                    <span><strong>{trends.summary.points}</strong> pts</span>
                  </div>
                )}
                <div className="dash-chart-footer">
                  <span className="dash-legend-item"><span className="dash-legend-swatch dash-legend-swatch-gold" /> Goals for</span>
                  <span className="dash-legend-item"><span className="dash-legend-swatch dash-legend-swatch-blue" /> Goals against</span>
                  <span className="dash-player-chart-hint">Tap a result to open the match report</span>
                </div>
              </>
            )}
          </div>
        )}

        {!isAthlete && (
          <div className="dash-panel">
            <span className="dash-chart-eyebrow">By unit</span>
            <h3>Position availability</h3>
            <div className="dash-bar-chart">
              {posEntries.map(([label, count]) => (
                <div className="dash-bar-col" key={label}>
                  <div className="dash-bar-track">
                    <div className="dash-bar-fill" style={{ height: `${(count / maxPos) * 100}%` }} />
                  </div>
                  <span className="dash-bar-value">{count}</span>
                  <span className="dash-bar-label">{label}</span>
                </div>
              ))}
            </div>
            <Link to="/roster" className="dash-panel-link">Manage full roster &rsaquo;</Link>
          </div>
        )}

        <div className="dash-panel">
          <span className="dash-chart-eyebrow">Goal contributions</span>
          <h3>Attack leaders</h3>
          {attackLeaders.length === 0 ? (
            <p className="roster-status">No goals logged in this period yet.</p>
          ) : (
            <div className="dash-leader-list">
              {attackLeaders.map((leader, i) => (
                <div className="dash-leader-row" key={leader.id}>
                  <span className="dash-leader-rank">{i + 1}</span>
                  <div className="dash-leader-info">
                    <span className="dash-leader-name">{leader.name}</span>
                    <span className="dash-leader-pos">{leader.position || 'Unlisted'}</span>
                  </div>
                  <span className="dash-leader-goals">
                    <StatNumber value={leader.goals} />
                    <span className="dash-leader-goals-label">goals</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {!isAthlete && (
          <div className="dash-panel">
            <span className="dash-chart-eyebrow">Risk monitor</span>
            <h3>Squad status</h3>
            <div className="dash-donut-wrap">
              <svg viewBox="0 0 140 140" className="dash-donut">
                <circle cx="70" cy="70" r="54" fill="none" stroke="var(--color-line)" strokeWidth="16" />
                <circle cx="70" cy="70" r="54" fill="none" stroke="var(--color-blue)" strokeWidth="16"
                  strokeDasharray={`${readySeg} ${circumference - readySeg}`} transform="rotate(-90 70 70)" />
                <circle cx="70" cy="70" r="54" fill="none" stroke="var(--color-lime)" strokeWidth="16"
                  strokeDasharray={`${managedSeg} ${circumference - managedSeg}`} strokeDashoffset={-readySeg} transform="rotate(-90 70 70)" />
                <circle cx="70" cy="70" r="54" fill="none" stroke="#b33b3b" strokeWidth="16"
                  strokeDasharray={`${injuredSeg} ${circumference - injuredSeg}`} strokeDashoffset={-(readySeg + managedSeg)} transform="rotate(-90 70 70)" />
              </svg>
            </div>
            <div className="dash-donut-legend">
              <div className="dash-donut-stat">
                <span className="dash-donut-num">{squad.readyCount}</span>
                <span className="dash-donut-label">Ready</span>
              </div>
              <div className="dash-donut-stat">
                <span className="dash-donut-num">{squad.managedCount}</span>
                <span className="dash-donut-label">Managed</span>
              </div>
              <div className="dash-donut-stat">
                <span className="dash-donut-num">{squad.injuredCount}</span>
                <span className="dash-donut-label">Injured</span>
              </div>
            </div>
          </div>
        )}

        {!isAthlete && (
          <div className="dash-panel">
            <span className="dash-chart-eyebrow">Staff</span>
            <h3>Invite an Assistant</h3>
            <p className="dash-invite-desc">
              Send an invitation email so an assistant coach can join your squad
              and help plan and log matchdays.
            </p>
            <form className="dash-invite-form" onSubmit={handleInvite}>
              <input
                type="email"
                className="dash-invite-input"
                placeholder="assistant@example.com"
                aria-label="Assistant email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
              <button type="submit" className="btn btn-gold dash-invite-btn" disabled={inviteSending}>
                {inviteSending ? <Loader inline label="Sending..." /> : 'Send invite'}
              </button>
            </form>
            {inviteError && <p className="dash-invite-error">{inviteError}</p>}
            {inviteResult && (
              <div className="dash-invite-success">
                <p>
                  {inviteResult.emailSent
                    ? 'Invitation email sent. Share this link as a fallback:'
                    : 'Invite created — the email could not be delivered, so share this link instead:'}
                </p>
                {inviteResult.emailError && (
                  <p className="dash-invite-error">Delivery failed: {inviteResult.emailError}</p>
                )}
                <code className="dash-invite-link">{inviteResult.inviteLink}</code>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  )
}

export default Dashboard