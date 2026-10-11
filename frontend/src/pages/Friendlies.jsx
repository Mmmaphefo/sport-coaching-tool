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
  if (Number.isNaN(d.getTime())) return 'Date to be confirmed'
  const day = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return `${day} · ${time}`
}

function Friendlies() {
  const { getToken } = useAuth()
  const confirm = useConfirm()
  const [friendlies, setFriendlies] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  // Proposing now happens from Events (format Match, type "Friendly
  // proposal"), so this page only needs the proposals themselves.
  const load = useCallback(async () => {
    setFriendlies(await apiRequest('/api/friendlies', { getToken }))
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

  return (
    <Layout>
      <div className="fr-page">
        <header className="fr-head">
          <h1>Friendlies</h1>
          <p>Friendly proposals you have sent and received — the other squad accepts or declines, and an accepted match lands on both calendars.</p>
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
          <p className="fr-muted">
            Friendlies are proposed from <Link to="/events">Events</Link>: schedule an event with
            format <strong>Match</strong>, set the type to <strong>Friendly proposal</strong>, and pick a
            registered squad as the opponent. Proposals you send and receive appear on this page.
          </p>
        </section>
      </div>
    </Layout>
  )
}

export default Friendlies
