// AI assistance: drafted with Claude (Sonnet 5) via claude.ai; reviewed and tested by the project team.
import { useState, useEffect } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import { apiRequest } from '../lib/api'
import './Setup.css'

function Setup() {
  const { getToken } = useAuth()
  const navigate = useNavigate()

  const [step, setStep] = useState(() => {
    if (typeof window === 'undefined') return 'name'
    return window.sessionStorage.getItem('kickstat_setup_step') || 'name'
  }) // name | assistant | roster
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('kickstat_setup_step', step)
    }
  }, [step])

  const [squadName, setSquadName] = useState('')
  const [squadGender, setSquadGender] = useState('male')

  const [assistantEmail, setAssistantEmail] = useState('')
  const [assistantInviteLink, setAssistantInviteLink] = useState(null)

  const [athleteForm, setAthleteForm] = useState({
    name: '',
    position: '',
    squad_number: '',
    date_of_birth: '',
    contact_info: '',
    email: '',
  })
  const [athletes, setAthletes] = useState([])

  async function handleNameSubmit(e) {
    e.preventDefault()
    if (!squadName.trim()) {
      setError('Squad name is required')
      return
    }
    setSaving(true)
    setError('')
    try {
      await apiRequest('/api/squads/mine', {
        method: 'PATCH',
        body: { name: squadName.trim(), gender: squadGender },
        getToken,
      })
      setStep('assistant')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleInviteAssistant(e) {
    e.preventDefault()
    if (!assistantEmail.trim() || assistantInviteLink) {
      setStep('roster')
      return
    }
    setSaving(true)
    setError('')
    try {
      const data = await apiRequest('/api/invites', {
        method: 'POST',
        body: { email: assistantEmail.trim() },
        getToken,
      })
      setAssistantInviteLink(data.inviteLink)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleAddAthlete(e) {
    e.preventDefault()
    const trimmedName = athleteForm.name.trim()
    if (!trimmedName) {
      setError('Athlete name is required')
      return
    }

    const squadNumber = athleteForm.squad_number ? Number(athleteForm.squad_number) : null

    // Same duplicate guards as the roster page, checked against the athletes
    // added in this session.
    if (athletes.some((a) => a.name.trim().toLowerCase() === trimmedName.toLowerCase())) {
      setError(`${trimmedName} is already on the roster.`)
      return
    }
    if (squadNumber != null && athletes.some((a) => a.squad_number === squadNumber)) {
      setError(`Squad number ${squadNumber} is already taken.`)
      return
    }

    setSaving(true)
    setError('')
    try {
      const created = await apiRequest('/api/athletes', {
        method: 'POST',
        body: {
          name: trimmedName,
          position: athleteForm.position || null,
          squad_number: squadNumber,
          date_of_birth: athleteForm.date_of_birth || null,
          contact_info: athleteForm.contact_info.trim() || null,
          email: athleteForm.email.trim() || null,
        },
        getToken,
      })
      setAthletes((prev) => [...prev, created])
      setAthleteForm({ name: '', position: '', squad_number: '', date_of_birth: '', contact_info: '', email: '' })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function finishSetup() {
    setSaving(true)
    setError('')
    try {
      const updated = await apiRequest('/api/squads/mine', {
        method: 'PATCH',
        body: { onboarded: true },
        getToken,
      })
      if (!updated.onboarded) {
        setError('Setup could not be completed. Please try again.')
        return
      }
      // Verify the write is visible to a fresh read before navigating,
      // so OnboardingGuard on /dashboard doesn't see stale onboarded=false.
      const verified = await apiRequest('/api/squads/mine', { getToken })
      if (!verified.onboarded) {
        setError('Setup could not be completed. Please try again.')
        return
      }
      navigate('/dashboard')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Layout>
      <div className="setup-header">
        <span className="dashboard-eyebrow">Welcome</span>
        <h1>Let's set up your squad</h1>
      </div>

      <div className="setup-steps">
        <span className={step === 'name' ? 'setup-step-active' : ''}>1. Squad name</span>
        <span className={step === 'assistant' ? 'setup-step-active' : ''}>2. Invite an assistant</span>
        <span className={step === 'roster' ? 'setup-step-active' : ''}>3. Add your roster</span>
      </div>

      {error && <div className="roster-error">{error}</div>}

      {step === 'name' && (
        <form className="roster-form" onSubmit={handleNameSubmit}>
          <h3>What's your squad called?</h3>
          <div className="roster-form-grid">
            <label className="roster-form-wide">
              Squad name
              <input
                type="text"
                value={squadName}
                onChange={(e) => setSquadName(e.target.value)}
                required
                autoFocus
              />
            </label>
            <label className="roster-form-wide">
              Squad gender
              <select value={squadGender} onChange={(e) => setSquadGender(e.target.value)}>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </label>
          </div>
          <div className="roster-form-actions">
            <button type="submit" className="btn btn-gold" disabled={saving}>
              {saving ? 'Saving...' : 'Next'}
            </button>
          </div>
        </form>
      )}

      {step === 'assistant' && (
        <form className="roster-form" onSubmit={handleInviteAssistant}>
          <h3>Invite an assistant (optional)</h3>
          <p className="setup-step-hint">
            Assistants can log live events but can't edit your roster. You can invite more later from the Dashboard.
          </p>
          <div className="roster-form-grid">
            <label className="roster-form-wide">
              Assistant's email
              <input
                type="email"
                value={assistantEmail}
                onChange={(e) => setAssistantEmail(e.target.value)}
                placeholder="assistant@example.com"
              />
            </label>
          </div>
          {assistantInviteLink && (
            <div className="roster-invite-created">
              <p>Invite email sent! They can also use this link directly:</p>
              <code>{assistantInviteLink}</code>
            </div>
          )}
          <div className="roster-form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setStep('roster')}>
              Skip
            </button>
            <button type="submit" className="btn btn-gold" disabled={saving}>
              {saving ? 'Sending...' : assistantInviteLink ? 'Continue' : 'Send invite'}
            </button>
          </div>
        </form>
      )}

      {step === 'roster' && (
        <>
          <form className="roster-form" onSubmit={handleAddAthlete}>
            <h3>Add your athletes</h3>
            <div className="roster-form-grid">
              <label>
                Name
                <input
                  type="text"
                  value={athleteForm.name}
                  onChange={(e) => setAthleteForm({ ...athleteForm, name: e.target.value })}
                  required
                />
              </label>
              <label>
                Position
                <select
                  value={athleteForm.position}
                  onChange={(e) => setAthleteForm({ ...athleteForm, position: e.target.value })}
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
                  value={athleteForm.squad_number}
                  onChange={(e) => setAthleteForm({ ...athleteForm, squad_number: e.target.value })}
                />
              </label>
              <label>
                Date of birth
                <input
                  type="date"
                  value={athleteForm.date_of_birth}
                  onChange={(e) => setAthleteForm({ ...athleteForm, date_of_birth: e.target.value })}
                />
              </label>
              <label className="roster-form-wide">
                Contact info
                <input
                  type="text"
                  value={athleteForm.contact_info}
                  onChange={(e) => setAthleteForm({ ...athleteForm, contact_info: e.target.value })}
                  placeholder="Phone or email"
                />
              </label>
              <label className="roster-form-wide">
                Athlete's login email (optional)
                <input
                  type="email"
                  value={athleteForm.email}
                  onChange={(e) => setAthleteForm({ ...athleteForm, email: e.target.value })}
                  placeholder="Sends them an invite email to create their own account"
                />
              </label>
            </div>
            <div className="roster-form-actions">
              <button type="submit" className="btn btn-gold" disabled={saving}>
                {saving ? 'Saving...' : 'Save athlete'}
              </button>
            </div>
          </form>

          {athletes.length > 0 && (
            <ul className="setup-athlete-list">
              {athletes.map((a) => (
                <li key={a.id}>
                  {a.squad_number != null ? `#${a.squad_number} ` : ''}
                  {a.name}
                </li>
              ))}
            </ul>
          )}

          <div className="roster-form-actions setup-finish-row">
            <button type="button" className="btn btn-gold" onClick={finishSetup} disabled={saving}>
              {athletes.length === 0 ? "I'll add athletes later" : 'Finish setup'}
            </button>
          </div>
        </>
      )}
    </Layout>
  )
}

export default Setup
