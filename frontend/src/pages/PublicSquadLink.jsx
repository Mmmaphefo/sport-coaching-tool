import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import './PublicSquadLink.css'

const API_URL = import.meta.env.VITE_API_URL

// No auth, no Layout (Layout assumes a signed-in user) — this is a
// standalone page anyone with the link can open.
function PublicSquadLink() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`${API_URL}/api/public/links/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'This link is not active')
        }
        return res.json()
      })
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  if (loading) {
    return <div className="public-squad-page"><p>Loading...</p></div>
  }

  if (error || !data) {
    return (
      <div className="public-squad-page">
        <p className="public-squad-error">{error || 'This link is not active.'}</p>
      </div>
    )
  }

  return (
    <div className="public-squad-page">
      <header className="public-squad-header">
        <h1>{data.squadName}</h1>
        <a
          className="btn btn-ghost"
          href={`${API_URL}/api/public/links/${token}/export.csv`}
        >
          Download CSV
        </a>
      </header>

      <section>
        <h2>Roster</h2>
        <div className="public-squad-table-wrap">
          <table className="public-squad-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Position</th>
                <th>Apps</th>
                <th>Goals</th>
                <th>Assists</th>
                <th>YC</th>
                <th>RC</th>
              </tr>
            </thead>
            <tbody>
              {data.roster.map((a) => (
                <tr key={a.name}>
                  <td>{a.squadNumber ?? '-'}</td>
                  <td>{a.name}</td>
                  <td>{a.position || '-'}</td>
                  <td>{a.appearances}</td>
                  <td>{a.goals}</td>
                  <td>{a.assists}</td>
                  <td>{a.yellowCards}</td>
                  <td>{a.redCards}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {data.results.length > 0 && (
        <section>
          <h2>Recent results</h2>
          <ul className="public-squad-results">
            {data.results.map((r) => (
              <li key={`${r.opponent}-${r.date}`}>
                <span>{new Date(r.date).toLocaleDateString()}</span>
                <span>vs {r.opponent || 'Opponent'}</span>
                <strong>{r.squadScore} – {r.opponentScore}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

export default PublicSquadLink
