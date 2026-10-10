import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Link, Navigate } from 'react-router-dom'
import Layout from '../components/Layout'
import Loader from '../components/Loader'
import { apiRequest } from '../lib/api'
import { useConfirm } from '../lib/confirm'
import { fileToProfilePhoto } from '../lib/image'
import './Roster.css'

const emptyForm = {
  name: '',
  position: '',
  squad_number: '',
  date_of_birth: '',
  contact_info: '',
  email: '',
  height_cm: '',
  weight_kg: '',
  tactical_tags: '',
  coach_notes: '',
}

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'ready', label: 'Ready' },
  { key: 'managed', label: 'Managed' },
  { key: 'injured', label: 'Injured' },
]

// No per-athlete readiness data is tracked yet anywhere in the app — the
// score on each card is a clearly labelled availability placeholder (same
// product decision as the dashboard's estimate training-load line) until
// real wellness/load tracking lands.
function readinessFor(athlete) {
  if (athlete.is_injured) return 25
  if (athlete.is_managed) return 60
  return 95
}

function statusFor(athlete) {
  if (athlete.is_injured) return 'injured'
  if (athlete.is_managed) return 'managed'
  return 'ready'
}

function initialsFor(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Football season label (e.g. "2026/27") for the squad header strip — the
// season starts in August and runs through July.
function currentSeason() {
  const now = new Date()
  const y = now.getFullYear()
  return now.getMonth() >= 6
    ? `${y}/${String((y + 1) % 100).padStart(2, '0')}`
    : `${y - 1}/${String(y % 100).padStart(2, '0')}`
}

// Player-account chips on the roster cards, driven by account_status from
// GET /api/athletes.
const ACCOUNT_STATUS_LABELS = {
  joined: 'Joined',
  invited: 'Invite pending',
  none: 'No account',
}

function CopyButton({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — the value is
      // still selectable for a manual copy.
    }
  }

  return (
    <button type="button" className="ros-copy-btn" onClick={copy}>
      {copied ? 'Copied' : label}
    </button>
  )
}

// Shown after inviting a player (from the card or the add-athlete form):
// the pre-created login details plus the invite link, so the coach can hand
// them over. On a resend the password is long gone — only the link returns.
function InviteCredentials({ name, invite }) {
  if (!invite) return null

  const credentials = invite.credentials || null
  const accountNotCreated = invite.account && invite.account.created === false

  return (
    <div className="ros-credentials">
      <p className="ros-credentials-title">
        {invite.resent ? 'Invite re-sent' : 'Player invite sent'}
      </p>
      {invite.resent ? (
        <p className="ros-credentials-text">
          The pending invite link has been emailed again. The original password cannot be recovered — share the link below if it still hasn&apos;t arrived.
        </p>
      ) : credentials ? (
        <p className="ros-credentials-text">
          An account was created for {name}. Share these login details with them — they can change the password any time from Account settings.
        </p>
      ) : accountNotCreated ? (
        <p className="ros-credentials-text">
          An account with this email already exists, so no new password was generated — the invite link below still works.
        </p>
      ) : (
        <p className="ros-credentials-text">
          The account couldn&apos;t be created automatically, but the invite link below still works — {name} can set up their own sign-in when accepting.
        </p>
      )}
      {credentials && (
        <>
          <div className="ros-cred-row">
            <span className="ros-cred-label">Email</span>
            <span className="ros-cred-value">{credentials.email}</span>
            <CopyButton value={credentials.email} />
          </div>
          <div className="ros-cred-row">
            <span className="ros-cred-label">Password</span>
            <span className="ros-cred-value">{credentials.password}</span>
            <CopyButton value={credentials.password} />
          </div>
        </>
      )}
      <div className="ros-cred-row">
        <span className="ros-cred-label">Invite link</span>
        <span className="ros-cred-value ros-cred-link">{invite.inviteLink}</span>
        <CopyButton value={invite.inviteLink} />
      </div>
      <p className="ros-credentials-note">
        Share these details securely — anyone with the link can accept the invite.
      </p>
    </div>
  )
}

function Roster() {
  const { getToken } = useAuth()
  const confirm = useConfirm()
  const [athletes, setAthletes] = useState([])
  const [statsById, setStatsById] = useState({})
  const [squadName, setSquadName] = useState('')
  const [role, setRole] = useState(null)
  const [athleteId, setAthleteId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [justAdded, setJustAdded] = useState(null)
  const [editMode, setEditMode] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  // Photo uploads: the athlete currently saving (drives the card spinner),
  // plus refs for the shared hidden file input and who it was opened for.
  const [photoSavingId, setPhotoSavingId] = useState(null)
  const fileInputRef = useRef(null)
  const photoTargetRef = useRef(null)
  // Player invites from the card: which athlete's inline email form is open,
  // and the credentials panel shown after an invite is sent.
  const [inviteFor, setInviteFor] = useState(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteSending, setInviteSending] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [credentialsFor, setCredentialsFor] = useState(null)

  const isCoach = role === 'coach'

  const loadAccount = useCallback(async () => {
    try {
      const me = await apiRequest('/api/account/me', { getToken })
      setRole(me.role)
      setAthleteId(me.athleteId ?? null)
    } catch {
      setRole('coach')
    }
  }, [getToken])

  const loadAthletes = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiRequest('/api/athletes', { getToken })
      setAthletes(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [getToken])

  useEffect(() => {
    loadAccount()
    loadAthletes()
  }, [loadAccount, loadAthletes])

  // Squad display name for the header strip (falls back to season only).
  useEffect(() => {
    let cancelled = false
    apiRequest('/api/squads/mine', { getToken })
      .then((squad) => {
        if (!cancelled) setSquadName(squad.name || '')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [getToken])

  // Per-card season output (goals/assists) comes from each athlete's stats
  // endpoint — failures degrade to zeroes rather than blocking the grid.
  useEffect(() => {
    if (athletes.length === 0) return undefined
    let cancelled = false
    Promise.all(
      athletes.map((athlete) =>
        apiRequest(`/api/athletes/${athlete.id}/stats`, { getToken })
          .then((s) => [athlete.id, { goals: s.goals ?? 0, assists: s.assists ?? 0 }])
          .catch(() => [athlete.id, { goals: 0, assists: 0 }])
      )
    ).then((entries) => {
      if (!cancelled) setStatsById(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
  }, [athletes, getToken])

  // Same availability formula the backend dashboard summary uses.
  const counts = {
    total: athletes.length,
    injured: athletes.filter((a) => a.is_injured).length,
    managed: athletes.filter((a) => a.is_managed && !a.is_injured).length,
  }
  counts.ready = counts.total - counts.injured - counts.managed

  const filteredAthletes = athletes.filter((athlete) => {
    const q = search.trim().toLowerCase()
    const matchesSearch = q === '' || athlete.name.toLowerCase().includes(q)
    const matchesFilter = filter === 'all' || statusFor(athlete) === filter
    return matchesSearch && matchesFilter
  })

  function openAddForm() {
    setForm(emptyForm)
    setEditingId(null)
    setJustAdded(null)
    setEditMode(false)
    setFormOpen(true)
  }

  function openEditForm(athlete) {
    setForm({
      name: athlete.name || '',
      position: athlete.position || '',
      squad_number: athlete.squad_number ?? '',
      date_of_birth: athlete.date_of_birth ? athlete.date_of_birth.slice(0, 10) : '',
      contact_info: athlete.contact_info || '',
      email: athlete.email || '',
      height_cm: athlete.height_cm ?? '',
      weight_kg: athlete.weight_kg ?? '',
      tactical_tags: athlete.tactical_tags || '',
      coach_notes: athlete.coach_notes || '',
    })
    setEditingId(athlete.id)
    setJustAdded(null)
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setForm(emptyForm)
    setEditingId(null)
    setJustAdded(null)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('Athlete name is required')
      return
    }

    const trimmedName = form.name.trim()
    const squadNumber = form.squad_number ? Number(form.squad_number) : null

    const duplicateName = athletes.find(
      (a) => a.id !== editingId && a.name.trim().toLowerCase() === trimmedName.toLowerCase()
    )
    if (duplicateName) {
      setError(`${trimmedName} is already on the roster.`)
      return
    }

    if (squadNumber != null) {
      const duplicateNumber = athletes.find(
        (a) => a.id !== editingId && a.squad_number === squadNumber
      )
      if (duplicateNumber) {
        setError(`Squad number ${squadNumber} is already taken by ${duplicateNumber.name}.`)
        return
      }
    }

    setSaving(true)
    setError('')
    setJustAdded(null)

    const payload = {
      name: trimmedName,
      position: form.position.trim() || null,
      squad_number: squadNumber,
      date_of_birth: form.date_of_birth || null,
      contact_info: form.contact_info.trim() || null,
      email: form.email.trim() || null,
      height_cm: form.height_cm ? Number(form.height_cm) : null,
      weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
      tactical_tags: form.tactical_tags.trim() || null,
      coach_notes: form.coach_notes.trim() || null,
    }

    try {
      if (editingId) {
        await apiRequest(`/api/athletes/${editingId}`, {
          method: 'PATCH',
          body: payload,
          getToken,
        })
        closeForm()
      } else {
        const emailToInvite = form.email.trim()
        const created = await apiRequest('/api/athletes', {
          method: 'POST',
          body: { ...payload, email: emailToInvite || null },
          getToken,
        })
        // Swap the form out for a confirmation immediately — no Save button
        // remains, so there's nothing left to double-click.
        setFormOpen(false)
        setJustAdded({
          name: created.name,
          invited: !!created.invite,
          email: emailToInvite,
          invite: created.invite || null,
        })
      }
      await loadAthletes()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    const answer = await confirm({
      title: 'Remove athlete',
      message: 'Remove this athlete from the roster? Their logged stats stay in the match history.',
      confirmLabel: 'Remove',
      tone: 'danger',
    })
    if (!answer) return
    try {
      await apiRequest(`/api/athletes/${id}`, { method: 'DELETE', getToken })
      await loadAthletes()
    } catch (err) {
      setError(err.message)
    }
  }

  // Opens the shared file input for one card; the change handler below picks
  // the file up and PATCHes it onto the athlete that was clicked.
  function openPhotoPicker(athleteId) {
    if (photoSavingId) return
    photoTargetRef.current = athleteId
    fileInputRef.current?.click()
  }

  async function handlePhotoChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    const athleteId = photoTargetRef.current
    photoTargetRef.current = null
    if (!file || !athleteId) return

    setPhotoSavingId(athleteId)
    setError('')
    try {
      const photo = await fileToProfilePhoto(file)
      await apiRequest(`/api/athletes/${athleteId}`, {
        method: 'PATCH',
        body: { photo },
        getToken,
      })
      setAthletes((prev) => prev.map((a) => (a.id === athleteId ? { ...a, photo } : a)))
    } catch (err) {
      setError(err.message)
    } finally {
      setPhotoSavingId(null)
    }
  }

  async function handleRemovePhoto() {
    if (!editingId) return
    const answer = await confirm({
      title: 'Remove profile photo',
      message: "Remove this athlete's profile photo? Their initials will show on the card instead.",
      confirmLabel: 'Remove photo',
      tone: 'danger',
    })
    if (!answer) return
    setPhotoSavingId(editingId)
    setError('')
    try {
      await apiRequest(`/api/athletes/${editingId}`, {
        method: 'PATCH',
        body: { photo: null },
        getToken,
      })
      setAthletes((prev) => prev.map((a) => (a.id === editingId ? { ...a, photo: null } : a)))
    } catch (err) {
      setError(err.message)
    } finally {
      setPhotoSavingId(null)
    }
  }

  // ---- Player invites (per card) ----

  function openInviteForm(athlete) {
    setCredentialsFor(null)
    setInviteError('')
    setInviteEmail(athlete.invite_email || athlete.email || '')
    setInviteFor(athlete.id)
  }

  function closeInviteForm() {
    setInviteFor(null)
    setInviteEmail('')
    setInviteError('')
  }

  async function submitInvite(e, athlete) {
    e.preventDefault()
    const email = inviteEmail.trim()
    if (!email) {
      setInviteError('Email is required')
      return
    }
    setInviteSending(true)
    setInviteError('')
    try {
      const res = await apiRequest(`/api/athletes/${athlete.id}/invite`, {
        method: 'POST',
        body: { email },
        getToken,
      })
      closeInviteForm()
      setCredentialsFor({ athleteId: athlete.id, invite: res.invite })
      await loadAthletes()
    } catch (err) {
      setInviteError(err.message)
    } finally {
      setInviteSending(false)
    }
  }

  // Players never see the team roster — they land on their own profile card
  // instead, the same page the coach opens for them (/roster/:id).
  if (role === 'athlete') {
    return <Navigate to={athleteId ? `/roster/${athleteId}` : '/dashboard'} replace />
  }

  return (
    <Layout>
      <div className="roster-page">
        <header className="ros-head">
          <div>
            <span className="ros-eyebrow">Player management</span>
            <h1 className="ros-title">Roster</h1>
          </div>
          {isCoach && (
            <div className="ros-head-actions">
              <button
                type="button"
                className={`btn-icon${editMode ? ' btn-icon-active' : ''}`}
                onClick={() => setEditMode((prev) => !prev)}
                title={editMode ? 'Done editing roster' : 'Edit roster'}
                aria-pressed={editMode}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                  <path d="M15 5l4 4" />
                </svg>
              </button>
              <button className="btn btn-gold ros-add-btn" onClick={openAddForm}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <line x1="19" y1="8" x2="19" y2="14" />
                  <line x1="22" y1="11" x2="16" y2="11" />
                </svg>
                Add athlete
              </button>
            </div>
          )}
        </header>

        <section className="ros-hero">
          <span className="ros-hero-label">
            {squadName ? `${squadName} · ` : ''}{currentSeason()}
          </span>
          <h2 className="ros-hero-title">Build the matchday group</h2>
          <p className="ros-hero-sub">
            Monitor every athlete&rsquo;s role, availability and latest readiness score.
          </p>
        </section>

        {!loading && athletes.length > 0 && (
          <section className="ros-stats">
            <div className="ros-stat-card">
              <span className="ros-stat-label">Total athletes</span>
              <span className="ros-stat-value">{counts.total}</span>
            </div>
            <div className="ros-stat-card">
              <span className="ros-stat-label">Ready</span>
              <span className="ros-stat-value">{counts.ready}</span>
            </div>
            <div className="ros-stat-card">
              <span className="ros-stat-label">Managed</span>
              <span className="ros-stat-value">{counts.managed}</span>
            </div>
            <div className="ros-stat-card ros-stat-card-injured">
              <span className="ros-stat-label">Injured</span>
              <span className="ros-stat-value">{counts.injured}</span>
            </div>
          </section>
        )}

        {!loading && athletes.length > 0 && (
          <div className="ros-toolbar">
            <div className="roster-search">
              <svg className="roster-search-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search athlete"
              />
            </div>
            <div className="ros-filters">
              <svg className="ros-filters-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="4" y1="21" x2="4" y2="14" />
                <line x1="4" y1="10" x2="4" y2="3" />
                <line x1="12" y1="21" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12" y2="3" />
                <line x1="20" y1="21" x2="20" y2="16" />
                <line x1="20" y1="12" x2="20" y2="3" />
                <line x1="1" y1="14" x2="7" y2="14" />
                <line x1="9" y1="8" x2="15" y2="8" />
                <line x1="17" y1="16" x2="23" y2="16" />
              </svg>
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`ros-filter-btn${filter === f.key ? ' ros-filter-active' : ''}`}
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <div className="roster-error">{error}</div>}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handlePhotoChange}
        />
        {formOpen && isCoach && (
          <form className="roster-form" onSubmit={handleSubmit}>
            <h3>{editingId ? 'Edit athlete' : 'Add athlete'}</h3>
            <div className="roster-form-grid">
              <label>
                Name
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </label>
              <label>
                Position
                <select
                  value={form.position}
                  onChange={(e) => setForm({ ...form, position: e.target.value })}
                >
                  <option value="">Select position</option>
                  <optgroup label="Goalkeeper">
                    <option value="Goalkeeper">Goalkeeper</option>
                  </optgroup>
                  <optgroup label="Defenders">
                    <option value="Centre-Back">Centre-Back</option>
                    <option value="Right-Back">Right-Back</option>
                    <option value="Left-Back">Left-Back</option>
                    <option value="Wing-Back">Wing-Back</option>
                    <option value="Sweeper">Sweeper</option>
                  </optgroup>
                  <optgroup label="Midfielders">
                    <option value="Defensive Midfielder">Defensive Midfielder</option>
                    <option value="Central Midfielder">Central Midfielder</option>
                    <option value="Attacking Midfielder">Attacking Midfielder</option>
                    <option value="Right Midfielder">Right Midfielder</option>
                    <option value="Left Midfielder">Left Midfielder</option>
                  </optgroup>
                  <optgroup label="Forwards">
                    <option value="Right Winger">Right Winger</option>
                    <option value="Left Winger">Left Winger</option>
                    <option value="Striker">Striker</option>
                    <option value="Centre Forward">Centre Forward</option>
                  </optgroup>
                </select>
              </label>
              <label>
                Squad number
                <input
                  type="number"
                  min="0"
                  value={form.squad_number}
                  onChange={(e) => setForm({ ...form, squad_number: e.target.value })}
                />
              </label>
              <label>
                Date of birth
                <input
                  type="date"
                  value={form.date_of_birth}
                  onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
                />
              </label>
              <label>
                Height (cm)
                <input
                  type="number"
                  min="50"
                  max="300"
                  value={form.height_cm}
                  onChange={(e) => setForm({ ...form, height_cm: e.target.value })}
                  placeholder="e.g. 180"
                />
              </label>
              <label>
                Weight (kg)
                <input
                  type="number"
                  min="10"
                  max="300"
                  value={form.weight_kg}
                  onChange={(e) => setForm({ ...form, weight_kg: e.target.value })}
                  placeholder="e.g. 75"
                />
              </label>
              <label className="roster-form-wide">
                Tactical tags (comma-separated)
                <input
                  type="text"
                  value={form.tactical_tags}
                  onChange={(e) => setForm({ ...form, tactical_tags: e.target.value })}
                  placeholder="e.g. strong header, fast winger, good under pressure"
                />
              </label>
              <label className="roster-form-wide">
                Coach notes
                <textarea
                  value={form.coach_notes}
                  onChange={(e) => setForm({ ...form, coach_notes: e.target.value })}
                  placeholder="e.g. Needs work on weak foot. Excellent leadership qualities."
                  rows="3"
                />
              </label>
              <label className="roster-form-wide">
                Contact info
                <input
                  type="text"
                  value={form.contact_info}
                  onChange={(e) => setForm({ ...form, contact_info: e.target.value })}
                  placeholder="Phone or email"
                />
              </label>
              {!editingId && (
                <label className="roster-form-wide">
                  Athlete's login email (optional)
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="Sends them an invite email to create their own account"
                  />
                </label>
              )}
            </div>
            <div className="roster-form-actions">
              <button type="button" className="btn btn-ghost" onClick={closeForm}>
                Cancel
              </button>
              {editingId && athletes.find((a) => a.id === editingId)?.photo && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleRemovePhoto}
                  disabled={photoSavingId === editingId}
                >
                  {photoSavingId === editingId ? (
                    <Loader inline label="Removing..." />
                  ) : (
                    'Remove photo'
                  )}
                </button>
              )}
              <button type="submit" className="btn btn-gold" disabled={saving}>
                {saving ? <Loader inline label="Saving..." /> : 'Save athlete'}
              </button>
            </div>
          </form>
        )}

        {justAdded && (
          <div className="roster-form roster-added-confirmation">
            <p>
              <strong>{justAdded.name}</strong> was added to the roster.
              {justAdded.invited &&
                (justAdded.invite?.emailSent
                  ? ` An invite email has been sent to ${justAdded.email}.`
                  : ` The invite email could not be delivered to ${justAdded.email} — share the link below instead.`)}
            </p>
            <InviteCredentials name={justAdded.name} invite={justAdded.invite} />
            <div className="roster-form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setJustAdded(null)}>
                Done
              </button>
              <button type="button" className="btn btn-gold" onClick={openAddForm}>
                Add another
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <Loader label="Loading roster..." />
        ) : athletes.length === 0 ? (
          <div className="roster-empty">
            <p>No athletes yet. {isCoach ? 'Add your first athlete to start building your squad.' : 'Your coach will add athletes here.'}</p>
          </div>
        ) : filteredAthletes.length === 0 ? (
          <div className="roster-empty">
            {search.trim() ? (
              <p>No athletes match &ldquo;{search.trim()}&rdquo;.</p>
            ) : (
              <p>No athletes currently marked {filter}.</p>
            )}
          </div>
        ) : (
          <div className="ros-grid">
            {filteredAthletes.map((athlete, index) => {
              const status = statusFor(athlete)
              const score = readinessFor(athlete)
              const stats = statsById[athlete.id] || { goals: 0, assists: 0 }
              const ghostNumber = String(athlete.squad_number ?? index + 1).padStart(2, '0')
              return (
                <div className="ros-card" key={athlete.id}>
                  <Link to={`/roster/${athlete.id}`} className="ros-card-main">
                    <span className="ros-card-ghost" aria-hidden="true">{ghostNumber}</span>
                    <span className={`ros-card-pill ros-card-pill-${status}`}>{status}</span>
                    <span className="ros-avatar-wrap">
                      <span className={`ros-card-avatar${athlete.photo ? ' ros-card-avatar-photo' : ''}`}>
                        {athlete.photo ? (
                          <img className="ros-card-avatar-img" src={athlete.photo} alt="" />
                        ) : (
                          initialsFor(athlete.name)
                        )}
                      </span>
                      {isCoach && (
                        <span
                          role="button"
                          tabIndex={0}
                          className={`ros-photo-btn${photoSavingId === athlete.id ? ' ros-photo-btn-saving' : ''}`}
                          aria-label={`${athlete.photo ? 'Replace' : 'Add'} photo for ${athlete.name}`}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            openPhotoPicker(athlete.id)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              e.stopPropagation()
                              openPhotoPicker(athlete.id)
                            }
                          }}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                            <circle cx="12" cy="13" r="4" />
                          </svg>
                        </span>
                      )}
                    </span>
                    <div className="ros-card-body">
                      <div className="ros-card-toprow">
                        <h3 className="ros-card-name">{athlete.name}</h3>
                        <span className="ros-card-score">{score}%</span>
                      </div>
                      <span className="ros-card-pos">{(athlete.position || 'Unlisted').toUpperCase()}</span>
                      <div className="ros-card-bar">
                        <span
                          className={`ros-card-bar-fill${status === 'injured' ? ' ros-card-bar-injured' : ''}`}
                          style={{ width: `${score}%` }}
                        />
                      </div>
                      <div className="ros-card-foot">
                        <span>{stats.goals} goals</span>
                        <span>{stats.assists} assists</span>
                        <span className="ros-card-profile">Profile &rsaquo;</span>
                      </div>
                    </div>
                  </Link>
                  {isCoach && (
                    <div className="ros-account">
                      <span
                        className={`ros-account-chip ros-account-chip-${athlete.account_status || 'none'}`}
                      >
                        {ACCOUNT_STATUS_LABELS[athlete.account_status] || 'No account'}
                      </span>
                      {athlete.account_status !== 'joined'
                        && inviteFor !== athlete.id
                        && credentialsFor?.athleteId !== athlete.id && (
                          <button
                            type="button"
                            className="btn btn-ghost ros-invite-btn"
                            onClick={() => openInviteForm(athlete)}
                          >
                            Invite player
                          </button>
                        )}
                      {athlete.account_status !== 'joined' && inviteFor === athlete.id && (
                        <form className="ros-account-form" onSubmit={(e) => submitInvite(e, athlete)}>
                          <input
                            type="email"
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                            placeholder="player@email.com"
                            aria-label={`Invite email for ${athlete.name}`}
                            required
                          />
                          <button type="submit" className="btn btn-gold" disabled={inviteSending}>
                            {inviteSending ? <Loader inline label="Sending..." /> : 'Send invite'}
                          </button>
                          <button type="button" className="btn btn-ghost" onClick={closeInviteForm}>
                            Cancel
                          </button>
                          {inviteError && <p className="ros-account-error">{inviteError}</p>}
                        </form>
                      )}
                    </div>
                  )}
                  {isCoach && credentialsFor?.athleteId === athlete.id && (
                    <div className="ros-credentials-wrap">
                      <InviteCredentials name={athlete.name} invite={credentialsFor.invite} />
                      <div className="ros-credentials-actions">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => setCredentialsFor(null)}
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  )}
                  {isCoach && editMode && (
                    <div className="ros-card-actions">
                      <button className="btn btn-ghost" onClick={() => openEditForm(athlete)}>
                        Edit
                      </button>
                      <button className="btn btn-danger" onClick={() => handleDelete(athlete.id)}>
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Layout>
  )
}

export default Roster
