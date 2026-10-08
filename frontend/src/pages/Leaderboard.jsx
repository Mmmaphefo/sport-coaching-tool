import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiRequest } from '../lib/api'
import './Leaderboard.css'

// T25: public, platform-wide leaderboard. Sits outside the authed app shell so
// signed-out visitors can browse it (the API route is public too).
function Leaderboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    apiRequest('/api/leaderboard')
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="leaderboard-shell">
      <header className="leaderboard-header">
        <div>
          <span className="leaderboard-eyebrow">KickStat</span>
          <h1>Platform leaderboard</h1>
          <p className="leaderboard-sub">
            Every completed match on the platform — league fixtures and friendlies alike — rolled
            into one table.
          </p>
        </div>
        <Link to="/" className="btn btn-ghost">Back to home</Link>
      </header>

      {loading && <p className="leaderboard-status">Loading leaderboard...</p>}
      {error && <div className="roster-error">{error}</div>}

      {data && data.leaderboard.length === 0 && (
        <div className="roster-empty">
          <p>No squads on the platform yet.</p>
        </div>
      )}

      {data && data.leaderboard.length > 0 && (
        <>
          <p className="leaderboard-meta">
            {data.total_squads} squads · {data.total_matches} completed match
            {data.total_matches === 1 ? '' : 'es'}
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Squad</th>
                  <th>Players</th>
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
                {data.leaderboard.map((row) => (
                  <tr key={row.squad_id} className={row.rank === 1 ? 'leaderboard-first' : ''}>
                    <td className="leaderboard-rank">{row.rank}</td>
                    <td className="leaderboard-name">{row.name}</td>
                    <td>{row.athlete_count}</td>
                    <td>{row.played}</td>
                    <td>{row.wins}</td>
                    <td>{row.draws}</td>
                    <td>{row.losses}</td>
                    <td>{row.gf}</td>
                    <td>{row.ga}</td>
                    <td>{row.gd > 0 ? `+${row.gd}` : row.gd}</td>
                    <td className="leaderboard-points">{row.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

export default Leaderboard
