import { useState, useEffect } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Link } from 'react-router-dom'
import Layout from '../components/Layout'
import { apiRequest } from '../lib/api'
import './Compare.css'

function StatBox({ label, valueA, valueB, accent = false }) {
  const a = valueA ?? 0
  const b = valueB ?? 0
  const leader = a > b ? 'A' : b > a ? 'B' : null

  return (
    <div className={`cmp-stat${accent ? ' cmp-stat-accent' : ''}`}>
      <span className="cmp-stat-label">{label}</span>
      <div className="cmp-stat-values">
        <span className={`cmp-stat-value${leader === 'A' ? ' cmp-stat-leader' : ''}`}>{a}</span>
        <span className="cmp-stat-vs">vs</span>
        <span className={`cmp-stat-value${leader === 'B' ? ' cmp-stat-leader' : ''}`}>{b}</span>
      </div>
    </div>
  )
}

function Compare() {
  const { getToken } = useAuth()
  const [athletes, setAthletes] = useState([])
  const [athleteAId, setAthleteAId] = useState('')
  const [athleteBId, setAthleteBId] = useState('')
  const [comparison, setComparison] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadRoster() {
      try {
        const roster = await apiRequest('/api/athletes', { getToken })
        setAthletes(roster)
      } catch (err) {
        setError(err.message)
      }
    }
    loadRoster()
  }, [getToken])

  async function handleCompare(e) {
    e.preventDefault()
    if (!athleteAId || !athleteBId) {
      setError('Select two athletes to compare')
      return
    }
    if (athleteAId === athleteBId) {
      setError('Please select two different athletes')
      return
    }

    setLoading(true)
    setError('')
    setComparison(null)
    try {
      const result = await apiRequest(`/api/compare/athletes?a=${athleteAId}&b=${athleteBId}`, { getToken })
      setComparison(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Layout>
      <div className="cmp-page">
        <header className="cmp-head">
          <div>
            <span className="cmp-eyebrow">Head to head</span>
            <h1 className="cmp-title">Compare athletes</h1>
          </div>
          <Link to="/roster" className="btn btn-ghost">Back to roster</Link>
        </header>

        <form className="cmp-selector" onSubmit={handleCompare}>
          <label className="cmp-select-label">
            Athlete A
            <select value={athleteAId} onChange={(e) => setAthleteAId(e.target.value)} required>
              <option value="">Select athlete...</option>
              {athletes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.squad_number != null ? `#${a.squad_number} ` : ''}{a.name}
                </option>
              ))}
            </select>
          </label>

          <label className="cmp-select-label">
            Athlete B
            <select value={athleteBId} onChange={(e) => setAthleteBId(e.target.value)} required>
              <option value="">Select athlete...</option>
              {athletes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.squad_number != null ? `#${a.squad_number} ` : ''}{a.name}
                </option>
              ))}
            </select>
          </label>

          <button type="submit" className="btn btn-gold" disabled={loading || !athleteAId || !athleteBId}>
            {loading ? 'Loading...' : 'Compare'}
          </button>
        </form>

        {error && <div className="cmp-error">{error}</div>}

        {comparison && (
          <div className="cmp-result">
            <div className="cmp-athlete-header">
              <div className="cmp-athlete-name">
                <span className="cmp-athlete-number">
                  {comparison.athleteA.squad_number != null ? `#${comparison.athleteA.squad_number}` : ''}
                </span>
                <h2>{comparison.athleteA.name}</h2>
                {comparison.athleteA.position && <span className="cmp-position">{comparison.athleteA.position}</span>}
              </div>
              <div className="cmp-athlete-name">
                <span className="cmp-athlete-number">
                  {comparison.athleteB.squad_number != null ? `#${comparison.athleteB.squad_number}` : ''}
                </span>
                <h2>{comparison.athleteB.name}</h2>
                {comparison.athleteB.position && <span className="cmp-position">{comparison.athleteB.position}</span>}
              </div>
            </div>

            <div className="cmp-stats-grid">
              <StatBox label="Appearances" valueA={comparison.athleteA.stats.appearances} valueB={comparison.athleteB.stats.appearances} />
              <StatBox label="Goals" valueA={comparison.athleteA.stats.goals} valueB={comparison.athleteB.stats.goals} accent />
              <StatBox label="Assists" valueA={comparison.athleteA.stats.assists} valueB={comparison.athleteB.stats.assists} />
              <StatBox label="G+A per match" valueA={comparison.athleteA.stats.involvementsPerMatch} valueB={comparison.athleteB.stats.involvementsPerMatch} accent />
              <StatBox label="Penalties" valueA={comparison.athleteA.stats.penalties} valueB={comparison.athleteB.stats.penalties} />
              <StatBox label="Yellow cards" valueA={comparison.athleteA.stats.yellowCards} valueB={comparison.athleteB.stats.yellowCards} />
              <StatBox label="Red cards" valueA={comparison.athleteA.stats.redCards} valueB={comparison.athleteB.stats.redCards} />
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}

export default Compare
