// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
// Friendlies (T24): propose a match to another squad from the public
// directory, and accept or decline the ones they send back. Accepting lands
// the same match on both calendars.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import Layout from '../components/Layout'
import Loader from '../components/Loader'
import { apiRequest } from '../lib/api'
import { useConfirm } from '../lib/confirm'
import './Friendlies.css'

const STATUS_LABEL = {
  proposed: 'Proposed',
  accepted: 'Accepted',
  declined: 'Declined',
  cancelled: 'Cancelled',
}

const ACTION_VERB = {
  accept: 'Accept',
  decline: 'Decline',
  cancel: 'Cancel',
}

const ACTION_NOTE = {
  accept: 'The match lands on both calendars at the proposed kickoff, with clash warnings if either side is already booked.',
  decline: 'They will see the proposal as declined.',
  cancel: 'They will see the proposal as withdrawn.',
}

function formatKickoff(value) {
  const d = new Date(value)
  const day = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return `${day} · ${time}`
}

function Friendlies() {
  const { getToken } = useAuth()
  const confirm = useConfirm()
  const [friendlies, setFriendlies] = useState(null)
  const [squads, setSquads] = useState([])
  const [mySquadId, setMySquadId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ opponent: '', date: '', time: '15:00', location: '', message: '' })
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    // The directory is the same public one the leaderboard uses — the route
    // ignores the token, but apiRequest always attaches one.
    const [list, directory, me] = await Promise.all([
      apiRequest('/api/friendlies', { getToken }),
      apiRequest('/api/public/squads', { getToken }).catch(() => []),
      apiRequest('/api/account/me', { getToken }),
    ])
    setFriendlies(list)
    setSquads(directory)
    setMySquadId(me.squadId ?? null)
  }, [getToken])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await load()
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  async function refresh() {
    try {
      setFriendlies(await apiRequest('/api/friendlies', { getToken }))
    } catch (err) {
      setError(err.message)
    }
  }

  const otherName = (f) => (f.direction === 'outgoing' ? f.opposing_squad : f.proposing_squad)

  async function propose(e) {
    e.preventDefault()
    if (!form.opponent) {
      setFormError('Pick a squad to play against.')
      return
    }
    if (!form.date) {
      setFormError('Pick a kickoff date.')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      await apiRequest('/api/friendlies', {
        method: 'POST',
        body: {
          opposing_squad_id: Number(form.opponent),
          event_date: form.date,
          event_time: form.time || null,
          location: form.location.trim() || null,
          message: form.message.trim() || null,
        },
        getToken,
      })
      setForm((f) => ({ ...f, opponent: '', date: '', location: '', message: '' }))
      await refresh()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function respond(friendly, action) {
    const proceed = await confirm({
      title: `${ACTION_VERB[action]} the friendly with ${otherName(friendly)}?`,
      message: ACTION_NOTE[action],
      confirmLabel: `${ACTION_VERB[action]} friendly`,
    })
    if (!proceed) return
    setBusyId(friendly.id)
    setError('')
    try {
      await apiRequest(`/api/friendlies/${friendly.id}/${action}`, { method: 'POST', getToken })
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  const incoming = (friendlies || []).filter((f) => f.status === 'proposed' && f.direction === 'incoming')
  const directory = squads.filter((s) => String(s.id) !== String(mySquadId))

  return (
    <Layout>
      <div className="fr-page">
        <header className="fr-head">
          <h1>Friendlies</h1>
          <p>Propose a match to a squad from the public directory — they accept or decline, and the match lands on both calendars.</p>
        </header>

        {error && <div className="fr-error" role="alert">{error}</div>}
        {loading && <Loader label="Loading friendlies..." />}

        {friendlies && (
          <section className="fr-card" aria-labelledby="fr-in-title">
            <h2 id="fr-in-title">Waiting for your answer</h2>
            {incoming.length === 0 ? (
              <p className="fr-muted">No open proposals addressed to your squad.</p>
            ) : (
              <ul className="fr-in-list">
                {incoming.map((f) => (
                  <li key={f.id} className="fr-in-item">
                    <div className="fr-in-who">
                      <span className="fr-in-squad">{f.proposing_squad}</span>
                      <span className="fr-in-when">{formatKickoff(f.event_date)}</span>
                      {f.location && <span className="fr-in-where">{f.location}</span>}
                    </div>
                    {f.message && <p className="fr-in-msg">“{f.message}”</p>}
                    <div className="fr-in-actions">
                      <button type="button" className="btn btn-gold" disabled={busyId === f.id} onClick={() => respond(f, 'accept')}>
                        Accept
                      </button>
                      <button type="button" className="btn btn-ghost" disabled={busyId === f.id} onClick={() => respond(f, 'decline')}>
                        Decline
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {friendlies && (
          <section className="fr-card" aria-labelledby="fr-all-title">
            <h2 id="fr-all-title">All friendlies</h2>
            {friendlies.length === 0 ? (
              <p className="fr-muted">Nothing here yet — propose your first friendly below.</p>
            ) : (
              <div className="fr-table-wrap">
                <table className="fr-table">
                  <thead>
                    <tr>
                      <th scope="col">Opponent</th>
                      <th scope="col">Kickoff</th>
                      <th scope="col">Status</th>
                      <th scope="col"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {friendlies.map((f) => (
                      <tr key={f.id}>
                        <th scope="row">
                          {otherName(f)}
                          <span className="fr-side">{f.direction === 'outgoing' ? 'You proposed' : 'They proposed'}</span>
                        </th>
                        <td>{formatKickoff(f.event_date)}</td>
                        <td>
                          <span className={`fr-status fr-status-${f.status}`}>{STATUS_LABEL[f.status] || f.status}</span>
                          {f.status === 'declined' && f.decline_reason && (
                            <span className="fr-reason">“{f.decline_reason}”</span>
                          )}
                        </td>
                        <td className="fr-row-actions">
                          {f.status === 'proposed' && f.direction === 'outgoing' && (
                            <button type="button" className="btn btn-ghost" disabled={busyId === f.id} onClick={() => respond(f, 'cancel')}>
                              Cancel
                            </button>
                          )}
                          {f.status === 'accepted' && f.event_id && <Link to={`/events/${f.event_id}`}>Open</Link>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        <section className="fr-card" aria-labelledby="fr-new-title">
          <h2 id="fr-new-title">Propose a friendly</h2>
          {directory.length === 0 ? (
            <p className="fr-muted">No other public squads yet — squads appear here once they list themselves on the public leaderboard.</p>
          ) : (
            <form className="fr-form" onSubmit={propose}>
              <label className="fr-field">
                Opponent
                <select value={form.opponent} onChange={(e) => setForm((f) => ({ ...f, opponent: e.target.value }))}>
                  <option value="">Pick a squad…</option>
                  {directory.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} · {s.athlete_count} players</option>
                  ))}
                </select>
              </label>
              <label className="fr-field">
                Kickoff date
                <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
              </label>
              <label className="fr-field">
                Kickoff time
                <input type="time" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} />
              </label>
              <label className="fr-field fr-field-wide">
                Venue
                <input type="text" maxLength="200" value={form.location} placeholder="Home Ground (optional)"
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
              </label>
              <label className="fr-field fr-field-wide">
                Message
                <textarea rows="2" maxLength="1000" value={form.message} placeholder="Anything you want to tell their coach (optional)"
                  onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} />
              </label>
              <div className="fr-form-actions">
                <button type="submit" className="btn btn-gold" disabled={saving}>
                  {saving ? 'Sending...' : 'Send proposal'}
                </button>
              </div>
            </form>
          )}
          {formError && <div className="fr-error" role="alert">{formError}</div>}
        </section>
      </div>
    </Layout>
  )
}

export default Friendlies
