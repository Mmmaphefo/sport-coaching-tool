import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import './PublicSquad.css'

const API_URL = import.meta.env.VITE_API_URL

function initials(name) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
}

// Derives a season W-D-L record from recentResults. The backend doesn't
// track a standalone "record" field, but every result already carries both
// scores, so this is just a tally — no new endpoint needed.
function tallyRecord(results) {
  return results.reduce(
    (acc, r) => {
      if (r.squadScore > r.opponentScore) acc.won += 1
      else if (r.squadScore < r.opponentScore) acc.lost += 1
      else acc.drawn += 1
      return acc
    },
    { won: 0, drawn: 0, lost: 0 }
  )
}

// The backend's `leaders` list is already sorted by goals then assists, so
// leaders[0] is the top scorer. The top assister isn't separately sorted,
// so it's picked out here from the same list rather than asking the
// backend for a second ranking.
function topAssister(leaders) {
  if (leaders.length === 0) return null
  return leaders.reduce((best, l) => (l.assists > (best?.assists ?? -1) ? l : best), null)
}

function PublicSquad() {
  const { id } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`${API_URL}/api/public/squads/${id}`)
      .then(async (res) => {
        const body = await res.json()
        if (!res.ok) throw new Error(body.error || 'Not found')
        setData(body)
      })
      .catch((err) => setError(err.message))
  }, [id])

  if (error) {
    return (
      <div className="ps-shell">
        <Link to="/public" className="ps-back">&larr; All squads</Link>
        <p className="ps-error">{error}</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="ps-shell">
        <p>Loading...</p>
      </div>
    )
  }

  const record = tallyRecord(data.recentResults)
  const topScorer = data.leaders[0] || null
  const topAssist = topAssister(data.leaders)

  return (
    <div className="ps-shell">
      <div className="ps-banner">
        <div className="ps-banner-id">
          <div className="ps-crest">{initials(data.squad.name)}</div>
          <div>
            <p className="ps-eyebrow">SQUAD PROFILE</p>
            <h1 className="ps-title">{data.squad.name}</h1>
            <p className="ps-subtitle">{data.roster.length} player{data.roster.length === 1 ? '' : 's'}</p>
          </div>
        </div>
        <div className="ps-record">
          <div className="ps-record-chip">
            <span className="ps-record-num">{record.won}</span>
            <span className="ps-record-label">Won</span>
          </div>
          <div className="ps-record-chip">
            <span className="ps-record-num">{record.drawn}</span>
            <span className="ps-record-label">Drawn</span>
          </div>
          <div className="ps-record-chip">
            <span className="ps-record-num">{record.lost}</span>
            <span className="ps-record-label">Lost</span>
          </div>
        </div>
      </div>

      <Link to="/public" className="ps-back">&larr; All squads</Link>

      <section className="ps-section">
        <div className="ps-section-head">
          <h2>Recent results</h2>
          <span className="ps-section-tag">LAST {Math.min(data.recentResults.length, 10)}</span>
        </div>
        {data.recentResults.length === 0 ? (
          <p className="ps-empty">No completed games yet.</p>
        ) : (
          <div className="ps-results-list">
            {data.recentResults.map((r, i) => {
              const outcome =
                r.squadScore > r.opponentScore ? 'W' : r.squadScore < r.opponentScore ? 'L' : 'D'
              return (
                <div className="ps-result-row" key={i}>
                  <span className={`ps-result-badge ps-result-badge-${outcome}`}>{outcome}</span>
                  <span className="ps-result-date">
                    {new Date(r.date).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                  <span className="ps-result-opponent">vs {r.opponent}</span>
                  <span className="ps-result-score">{r.squadScore}&ndash;{r.opponentScore}</span>
                  {r.league && <span className="ps-result-league">{r.league}</span>}
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="ps-section">
        <div className="ps-section-head">
          <h2>Top performers</h2>
          <span className="ps-section-tag">SEASON LEADERS</span>
        </div>
        {data.leaders.length === 0 ? (
          <p className="ps-empty">No goals or assists logged yet.</p>
        ) : (
          <div className="ps-performer-grid">
            {topScorer && (
              <div className="ps-performer-card">
                <span className="ps-performer-num">1</span>
                <p className="ps-performer-label">TOP SCORER</p>
                <p className="ps-performer-value">{topScorer.goals} goal{topScorer.goals === 1 ? '' : 's'}</p>
                <p className="ps-performer-name">{topScorer.athleteName}</p>
              </div>
            )}
            {topAssist && (
              <div className="ps-performer-card">
                <span className="ps-performer-num">2</span>
                <p className="ps-performer-label">MOST ASSISTS</p>
                <p className="ps-performer-value">{topAssist.assists} assist{topAssist.assists === 1 ? '' : 's'}</p>
                <p className="ps-performer-name">{topAssist.athleteName}</p>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="ps-section">
        <div className="ps-section-head">
          <h2>First-team squad</h2>
          <span className="ps-section-tag">{data.roster.length} PLAYERS</span>
        </div>
        <div className="ps-squad-grid">
          {data.roster.map((a) => (
            <div className="ps-squad-card" key={a.id}>
              <div className="ps-squad-avatar">{initials(a.name)}</div>
              <div>
                <p className="ps-squad-name">{a.name}</p>
                <p className="ps-squad-meta">
                  {a.position || 'Squad player'}{a.squad_number != null ? ` · #${a.squad_number}` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export default PublicSquad