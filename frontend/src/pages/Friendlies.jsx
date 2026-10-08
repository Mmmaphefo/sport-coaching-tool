import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Link } from 'react-router-dom'
import Layout from '../components/Layout'
import { apiRequest } from '../lib/api'
import './Friendlies.css'

const statusLabel = {
  pending: 'Pending',
  accepted: 'Accepted',
  declined: 'Declined',
  cancelled: 'Cancelled',
}

function FriendlyCard({ friendly, getToken, onAction }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function act(action) {
    setBusy(true)
    setError('')
    try {
      await apiRequest(`/api/friendlies/${friendly.id}/${action}`, {
        method: 'POST',
        getToken,
      })
      onAction()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const other =
    friendly.direction === 'incoming' ? friendly.from_squad : friendly.to_squad
  const eventId = friendly.direction === 'incoming' ? friendly.to_event_id : friendly.from_event_id

  return (
    <div className={`friendlies-card friendlies-card--${friendly.status}`}>
      <div className="friendlies-card-main">
        <span className="friendlies-direction">
          {friendly.direction === 'incoming' ? 'Invitation from' : 'Proposed to'}
        </span>
        <span className="friendlies-opponent">{other?.name || 'Unknown squad'}</span>
        <span className="friendlies-meta">
          {new Date(friendly.proposed_date).toLocaleString()}
          {friendly.location ? ` · ${friendly.location}` : ''}
        </span>
        {friendly.message && <span className="friendlies-message">“{friendly.message}”</span>}
      </div>
      <div className="friendlies-card-side">
        <span className={`event-status event-status-${friendly.status}`}>
          {statusLabel[friendly.status] || friendly.status}
        </span>
        {friendly.status === 'pending' && friendly.direction === 'incoming' && (
          <div className="friendlies-actions">
            <button className="btn btn-gold" disabled={busy} onClick={() => act('accept')}>
              Accept
            </button>
            <button className="btn btn-danger" disabled={busy} onClick={() => act('decline')}>
              Decline
            </button>
          </div>
        )}
        {friendly.status === 'pending' && friendly.direction === 'outgoing' && (
          <button className="btn btn-danger" disabled={busy} onClick={() => act('cancel')}>
            Cancel proposal
          </button>
        )}
        {friendly.status === 'accepted' && eventId && (
          <Link className="btn btn-ghost" to={`/events/${eventId}`}>
            Open match
          </Link>
        )}
      </div>
      {error && <div className="roster-error friendlies-error">{error}</div>}
    </div>
  )
}

function Friendlies() {
  const { getToken } = useAuth()

  const [friendlies, setFriendlies] = useState(null)
  const [directory, setDirectory] = useState([])
  const [mySquadId, setMySquadId] = useState(null)
  const [form, setForm] = useState({ to_squad_id: '', proposed_date: '', location: '', message: '' })
  const [proposing, setProposing] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await apiRequest('/api/friendlies', { getToken })
      setFriendlies(data)
    } catch (err) {
      setError(err.message)
      setFriendlies([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    load()
    apiRequest('/api/squads/directory', { getToken })
      .then(setDirectory)
      .catch(() => setDirectory([]))
    apiRequest('/api/squads/mine', { getToken })
      .then((squad) => setMySquadId(squad.id))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handlePropose(e) {
    e.preventDefault()
    setProposing(true)
    setError('')
    setMessage('')
    try {
      await apiRequest('/api/friendlies', {
        method: 'POST',
        getToken,
        body: {
          to_squad_id: Number(form.to_squad_id),
          proposed_date: form.proposed_date,
          location: form.location.trim() || undefined,
          message: form.message.trim() || undefined,
        },
      })
      setForm({ to_squad_id: '', proposed_date: '', location: '', message: '' })
      setMessage('Friendly proposed — the other squad will see it in their invitations.')
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setProposing(false)
    }
  }

  if (friendlies === null) {
    return (
      <Layout>
        <p className="roster-status">Loading friendlies...</p>
      </Layout>
    )
  }

  const incoming = friendlies.filter((f) => f.direction === 'incoming')
  const outgoing = friendlies.filter((f) => f.direction === 'outgoing')
  const selectable = directory.filter((s) => s.id !== mySquadId)

  return (
    <Layout>
      <div className="roster-header">
        <div>
          <span className="dashboard-eyebrow">Friendlies</span>
          <h1>Arrange friendly matches</h1>
          <p className="friendlies-hint">
            Propose a friendly to any squad on the platform. When they accept, a match event
            appears on both calendars automatically.
          </p>
        </div>
      </div>

      {error && <div className="roster-error">{error}</div>}
      {message && <div className="friendlies-success">{message}</div>}

      <form className="roster-form" onSubmit={handlePropose}>
        <h3>Propose a friendly</h3>
        {selectable.length === 0 ? (
          <p className="roster-status">
            No other squads on the platform yet — invitations will appear here as they join.
          </p>
        ) : (
          <div className="roster-form-grid">
            <label>
              Opponent squad
              <select
                value={form.to_squad_id}
                onChange={(e) => setForm({ ...form, to_squad_id: e.target.value })}
                required
              >
                <option value="" disabled>Select a squad</option>
                {selectable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.athlete_count} player{s.athlete_count === 1 ? '' : 's'})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Proposed date &amp; time
              <input
                type="datetime-local"
                value={form.proposed_date}
                onChange={(e) => setForm({ ...form, proposed_date: e.target.value })}
                required
              />
            </label>
            <label>
              Location
              <input
                type="text"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="Optional"
              />
            </label>
            <label className="roster-form-wide">
              Message
              <input
                type="text"
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder="Optional — e.g. looking for a tough run-out before the cup"
              />
            </label>
          </div>
        )}
        {selectable.length > 0 && (
          <div className="roster-form-actions">
            <button type="submit" className="btn btn-gold" disabled={proposing}>
              {proposing ? 'Sending...' : 'Send invitation'}
            </button>
          </div>
        )}
      </form>

      <h3 className="live-section-heading">Invitations received ({incoming.length})</h3>
      {incoming.length === 0 ? (
        <div className="roster-empty">
          <p>No incoming friendly invitations.</p>
        </div>
      ) : (
        <div className="friendlies-list">
          {incoming.map((f) => (
            <FriendlyCard key={f.id} friendly={f} getToken={getToken} onAction={load} />
          ))}
        </div>
      )}

      <h3 className="live-section-heading">Your proposals ({outgoing.length})</h3>
      {outgoing.length === 0 ? (
        <div className="roster-empty">
          <p>You haven't proposed any friendlies yet.</p>
        </div>
      ) : (
        <div className="friendlies-list">
          {outgoing.map((f) => (
            <FriendlyCard key={f.id} friendly={f} getToken={getToken} onAction={load} />
          ))}
        </div>
      )}
    </Layout>
  )
}

export default Friendlies
