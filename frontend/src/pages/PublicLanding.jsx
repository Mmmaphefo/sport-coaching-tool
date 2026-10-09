import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import './PublicLanding.css'

const API_URL = import.meta.env.VITE_API_URL

function IconBroadcast() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
      <path d="M8.5 14.5a5 5 0 0 1 7 0" />
      <path d="M5.5 11.5a9 9 0 0 1 13 0" />
      <path d="M2.5 8.5a13 13 0 0 1 19 0" />
    </svg>
  )
}

function IconUsers() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.8 19.5c.9-3.4 3.3-5.2 6.2-5.2s5.3 1.8 6.2 5.2" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M15.5 14.6c2.2.3 3.7 1.9 4.3 4.2" />
    </svg>
  )
}

function IconTrophy() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M7 5H4a1 1 0 0 0-1 1v1a4 4 0 0 0 4 4" />
      <path d="M17 5h3a1 1 0 0 1 1 1v1a4 4 0 0 1-4 4" />
      <path d="M12 14v3" />
      <path d="M9 20.5h6" />
      <path d="M10 17.5h4l.6 3H9.4l.6-3Z" />
    </svg>
  )
}

const FEATURES = [
  {
    Icon: IconBroadcast,
    title: 'Live match centre',
    body: 'Follow every kick with live scores and updates as they happen.',
  },
  {
    Icon: IconUsers,
    title: 'Every squad, public',
    body: 'Browse first-team squads, player positions and season leaders for every club that has opted in.',
  },
  {
    Icon: IconTrophy,
    title: 'League play',
    body: 'Once a league fills up, its fixtures and results become visible here too.',
  },
]

function LiveCard({ item }) {
  if (item.kind === 'match') {
    return (
      <div className="pl-live-match">
        <span className="pl-live-team">{item.squadName}</span>
        <span className="pl-live-score">{item.squadScore}&ndash;{item.opponentScore}</span>
        <span className="pl-live-team">{item.opponent}</span>
      </div>
    )
  }
  return (
    <div className="pl-live-match">
      <span className="pl-live-team">{item.homeName}</span>
      <span className="pl-live-score">{item.homeScore}&ndash;{item.awayScore}</span>
      <span className="pl-live-team">{item.awayName}</span>
    </div>
  )
}

function PublicLanding() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [board, setBoard] = useState(null)

  useEffect(() => {
    fetch(`${API_URL}/api/public/squads`)
      .then((res) => res.json())
      .then(setData)
      .catch(() => setError('Could not load public squads right now.'))
  }, [])

  // The table is a nice-to-have: if it fails, the directory and the live
  // banner above still work, so this fetch swallows its own errors.
  useEffect(() => {
    fetch(`${API_URL}/api/public/leaderboard`)
      .then((res) => res.json())
      .then((payload) => setBoard(payload.leaderboard || null))
      .catch(() => setBoard(null))
  }, [])

  const filteredSquads = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    if (!q) return data.squads
    return data.squads.filter((s) => s.name.toLowerCase().includes(q))
  }, [data, query])

  return (
    <div className="pl-page welcome-hero">
      <div className="welcome-overlay" />
      <div className="welcome-vignette" />
      <div className="pl-wash" />

      <div className="pl-content">
        <div className="pl-hero-card">
          <div className="pl-hero-id">
            <img src="/logo-crest-reversed.svg" alt="KickStat" className="pl-hero-logo" />
            <div>
              <p className="pl-hero-eyebrow">THE PUBLIC HOME OF KICKSTAT</p>
              <h1 className="pl-hero-title">Follow the club. Live.</h1>
              <p className="pl-hero-subtitle">
                Live matches, results, and every public squad&rsquo;s roster and season stats &mdash;
                free for every supporter, no sign-in needed.
              </p>
              <div className="pl-hero-actions">
                <a href="#pl-teams" className="pl-hero-cta">
                  Browse teams
                </a>
                <Link to="/sign-in" className="pl-hero-cta-secondary">Sign in</Link>
              </div>
            </div>
          </div>
        </div>

        {error && <p className="pl-error">{error}</p>}

        {data && data.live.length > 0 && (
          <section className="pl-live-banner">
            <div className="pl-live-head">
              <span className="pl-live-dot" />
              <span>LIVE NOW</span>
            </div>
            <div className="pl-live-list">
              {data.live.map((item) => (
                <LiveCard item={item} key={`${item.kind}-${item.id}`} />
              ))}
            </div>
          </section>
        )}

        {board && board.length > 0 && (
          <section className="pl-section" id="pl-board">
            <h2 className="pl-section-title">PLATFORM TABLE</h2>
            <p className="pl-board-sub">
              Every public squad&rsquo;s completed-match record &mdash; friendly results and league fixtures together.
            </p>
            <div className="pl-board-wrap">
              <table className="pl-board">
                <thead>
                  <tr>
                    <th>#</th>
                    <th className="pl-board-team">Team</th>
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
                  {board.map((row, index) => (
                    <tr key={row.squadId}>
                      <td>{index + 1}</td>
                      <td className="pl-board-team">
                        <Link to={`/public/${row.squadId}`}>{row.squadName}</Link>
                      </td>
                      <td>{row.played}</td>
                      <td>{row.won}</td>
                      <td>{row.drawn}</td>
                      <td>{row.lost}</td>
                      <td>{row.goalsFor}</td>
                      <td>{row.goalsAgainst}</td>
                      <td>
                        {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                      </td>
                      <td className="pl-board-pts">{row.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="pl-section">
          <h2 className="pl-section-title">WHAT YOU&rsquo;LL FIND HERE</h2>
          <div className="pl-feature-grid">
            {FEATURES.map((f) => (
              <div className="pl-feature-card" key={f.title}>
                <div className="pl-feature-icon"><f.Icon /></div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="pl-section" id="pl-teams">
          <div className="pl-teams-head">
            <h2 className="pl-section-title">TEAMS</h2>
            <input
              type="text"
              className="pl-search"
              placeholder="Search teams..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {!data ? (
            <p className="pl-empty">Loading...</p>
          ) : filteredSquads.length === 0 ? (
            <p className="pl-empty">
              {data.squads.length === 0 ? 'No public squads yet.' : 'No teams match your search.'}
            </p>
          ) : (
            <div className="pl-team-grid">
              {filteredSquads.map((s) => (
                <Link to={`/public/${s.id}`} className="pl-team-card" key={s.id}>
                  <div className="pl-team-avatar">
                    {s.name
                      .split(' ')
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((w) => w[0]?.toUpperCase())
                      .join('')}
                  </div>
                  <div>
                    <h3>{s.name}</h3>
                    <p>{s.athlete_count} athlete{s.athlete_count === 1 ? '' : 's'}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

export default PublicLanding