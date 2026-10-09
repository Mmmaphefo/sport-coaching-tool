import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { useParams, Link, Navigate, useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import Loader from '../components/Loader'
import Pitch from '../components/Pitch'
import LineupWizard from '../components/LineupWizard'
import { apiRequest, isRetryableError } from '../lib/api'
import {
  enqueue,
  findQueuedCreate,
  flushQueue,
  getQueue,
  newClientId,
  onConnectivityChange,
  queueLength,
  removeQueuedCreate,
  updateQueuedCreate,
} from '../lib/offlineQueue'
import { ACTION_TYPES, QUICK_ACTIONS, formatActionType } from '../lib/actions'
import { useConfirm } from '../lib/confirm'
import { FULL_TIME_MINUTE, runSimulation } from '../lib/simulation'
import {
  assistForGoal,
  canLogOn,
  computeRating,
  detectFormation,
  initialsOf,
  isLinkedAssist,
  parseSubstitutionNotes,
  ratingColor,
  splitLineup,
} from '../lib/lineups'
import './LiveMatch.css'

// Approximation: elapsed minutes since the scheduled kickoff time.
function elapsedMinutes(eventDate) {
  if (!eventDate) return 0
  const diffMs = Date.now() - new Date(eventDate).getTime()
  return Math.max(0, Math.floor(diffMs / 60000))
}

function useMatchDetail() {
  const { id, fixtureId } = useParams()
  const { getToken } = useAuth()

  const isFixture = Boolean(fixtureId)
  const entityId = fixtureId || id
  const apiPrefix = isFixture ? '/api/fixtures' : '/api/events'

  const [detail, setDetail] = useState(null)
  const [athletes, setAthletes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [clockMinute, setClockMinute] = useState(0)

  const pollRef = useRef(null)
  const clockRef = useRef(null)
  const prevTimelineRef = useRef([])
  const [newEntryIds, setNewEntryIds] = useState(new Set())

  const loadDetail = useCallback(async () => {
    try {
      const data = await apiRequest(`${apiPrefix}/${entityId}`, { getToken })
      setDetail(data)
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [entityId, apiPrefix, getToken])

  useEffect(() => {
    loadDetail()
    apiRequest('/api/athletes', { getToken }).then(setAthletes).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, apiPrefix])

  const activeStatus = isFixture ? detail?.fixture?.status : detail?.event?.status
  const activeDate = isFixture ? detail?.fixture?.event_date : detail?.event?.event_date
  const activeStartedAt = isFixture ? detail?.fixture?.started_at : detail?.event?.started_at

  // The live clock anchors on when the event actually went live, falling
  // back to the scheduled kickoff for rows that predate started_at. Using
  // the scheduled time alone is what pinned the counter at 0' whenever an
  // event started early/late or without a time.
  const clockAnchor = activeStartedAt || activeDate

  useEffect(() => {
    if (activeStatus === 'live') {
      pollRef.current = setInterval(loadDetail, 3000)
      return () => clearInterval(pollRef.current)
    }
  }, [activeStatus, loadDetail])

  // Track newly added timeline entries for flash animation
  useEffect(() => {
    const currentIds = new Set((detail?.timeline || []).map((e) => e.id))
    const prevIds = prevTimelineRef.current
    if (prevIds.length > 0) {
      const fresh = new Set()
      currentIds.forEach((id) => { if (!prevIds.includes(id)) fresh.add(id) })
      if (fresh.size > 0) {
        setNewEntryIds(fresh)
        setTimeout(() => setNewEntryIds(new Set()), 1000)
      }
    }
    prevTimelineRef.current = [...currentIds]
  }, [detail?.timeline])

  useEffect(() => {
    if (!clockAnchor) return
    setClockMinute(elapsedMinutes(clockAnchor))
    clockRef.current = setInterval(() => {
      setClockMinute(elapsedMinutes(clockAnchor))
    }, 30000)
    return () => clearInterval(clockRef.current)
  }, [clockAnchor])

  return {
    isFixture,
    entityId,
    apiPrefix,
    detail,
    athletes,
    loading,
    error,
    setError,
    clockMinute,
    loadDetail,
    activeStatus,
    newEntryIds,
  }
}

function LiveMatch() {
  const {
    isFixture,
    entityId,
    apiPrefix,
    detail,
    athletes,
    loading,
    error,
    setError,
    clockMinute,
    loadDetail,
    activeStatus,
    newEntryIds,
  } = useMatchDetail()

  const { getToken } = useAuth()
  const confirm = useConfirm()

  // The match centre is a logging tool — players never see it, they follow
  // live scores from the dashboard instead.
  const [role, setRole] = useState(null)
  useEffect(() => {
    let cancelled = false
    apiRequest('/api/account/me', { getToken })
      .then((me) => {
        if (!cancelled) setRole(me.role)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [getToken])

  const [flow, setFlow] = useState(null)
  const [hint, setHint] = useState('')
  const [logging, setLogging] = useState(false)
  const [savingLineup, setSavingLineup] = useState(false)
  // Set when the XI is saved on a match that is due but short of available
  // players: the server keeps the lineups but refuses to kick off.
  const [startBlocked, setStartBlocked] = useState(null)

  // --- Lineup suggestions: a data-backed head start for the wizard. ---
  const [lineupSuggestions, setLineupSuggestions] = useState(null)

  // Suggestions are supplementary: when the endpoint fails (or the squad has
  // no history) the wizard falls back to its own by-squad-number auto-fill.
  const suggestionsReady = Boolean(
    detail &&
    activeStatus !== 'completed' && activeStatus !== 'cancelled' &&
    (detail.lineups || []).length === 0 &&
    (isFixture ? detail.canLog !== false : true)
  )
  useEffect(() => {
    if (!suggestionsReady) return
    let cancelled = false
    apiRequest(`${apiPrefix}/${entityId}/lineup/suggestions`, { getToken })
      .then((data) => {
        if (!cancelled) setLineupSuggestions(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [suggestionsReady, apiPrefix, entityId, getToken])

  // Never carry one match's suggestions into another.
  useEffect(() => {
    setLineupSuggestions(null)
  }, [entityId, apiPrefix])

  const [editingEntryId, setEditingEntryId] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [editSaving, setEditSaving] = useState(false)
  const [endingFixture, setEndingFixture] = useState(false)

  // --- Offline-first logging. ---
  // matchKey namespaces the queue per event/fixture, so switching matches
  // (or opening two on different devices) can't cross-contaminate queues.
  const matchKey = `${apiPrefix}/${entityId}`
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pendingCount, setPendingCount] = useState(() => queueLength(matchKey))
  const [syncing, setSyncing] = useState(false)
  const [syncNote, setSyncNote] = useState('')
  const syncingRef = useRef(false)

  // Optimistic layer: queued rows are mirrored here so the timeline and the
  // scoreboard move the moment an action is taken — a queued create keeps
  // its client id as `id` until the server assigns the real one.
  const [pendingCreates, setPendingCreates] = useState([])
  const [pendingRemovals, setPendingRemovals] = useState(() => new Set())
  const [pendingEdits, setPendingEdits] = useState(() => ({}))

  // Restore the optimistic view from a queue left behind by a previous
  // session (actions queued offline, then the tab was closed or crashed).
  useEffect(() => {
    const queued = getQueue(matchKey)
    if (queued.length === 0) return
    setPendingCreates((prev) => [
      ...prev,
      ...queued
        .filter((a) => a.type === 'create' && !prev.some((p) => p.id === a.clientId))
        .map((a) => ({ id: a.clientId, _pending: true, ...a.body })),
    ])
    for (const a of queued) {
      const id = Number(a.path.split('/').pop())
      if (Number.isNaN(id)) continue
      if (a.type === 'undo') setPendingRemovals((prev) => new Set(prev).add(id))
      if (a.type === 'edit') setPendingEdits((prev) => ({ ...prev, [id]: a.body }))
    }
  }, [matchKey])

  // Builds the row shown in the timeline while a create waits in the queue.
  function buildOptimisticRow(clientIdValue, body) {
    const entryNotes = body.action_type === 'substitution' && body.substitute_athlete_id
      ? `on:${Number(body.substitute_athlete_id)}`
      : (body.notes || null)
    return {
      id: clientIdValue,
      _pending: true,
      athlete_id: body.athlete_id ?? null,
      action_type: body.action_type,
      is_scoring: Boolean(body.is_scoring),
      value: body.value ?? 1,
      minute: body.minute ?? null,
      notes: entryNotes,
      logged_at: new Date().toISOString(),
    }
  }

  // Queues a create and shows it on the timeline straight away.
  function queueLog(body) {
    const clientIdValue = newClientId()
    enqueue(matchKey, {
      type: 'create',
      clientId: clientIdValue,
      path: `${apiPrefix}/${entityId}/logs`,
      method: 'POST',
      body: { ...body, client_id: clientIdValue },
    })
    const rows = [buildOptimisticRow(clientIdValue, body)]
    if (body.assist_athlete_id) {
      rows.push({
        id: `${clientIdValue}-assist`,
        _pending: true,
        athlete_id: body.assist_athlete_id,
        action_type: 'assist',
        is_scoring: false,
        value: 1,
        minute: body.minute ?? null,
        related_log_id: clientIdValue,
      })
    }
    setPendingCreates((prev) => [...prev, ...rows])
    setPendingCount(queueLength(matchKey))
  }

  const trySync = useCallback(async () => {
    if (!navigator.onLine || syncingRef.current) return
    syncingRef.current = true
    setSyncing(true)
    try {
      const results = await flushQueue(matchKey, apiRequest, getToken)

      // A create that synced exposes the server's own row: swap the mirror
      // onto its numeric id so the dedupe effect can retire it once the
      // timeline refresh catches up. Anything the server permanently
      // rejected is retired here too — and reported, not swallowed.
      const createdRows = results.filter(
        (r) => r.ok && r.action.type === 'create' && r.result?.id != null
      )
      const droppedCreates = results.filter((r) => r.dropped && r.action.type === 'create')
      const resolvedId = (r) => Number(r.action.path.split('/').pop())

      setPendingCreates((prev) => prev
        .filter((row) => !droppedCreates.some(
          (r) => r.action.clientId === row.id || r.action.clientId === row.related_log_id
        ))
        .map((row) => {
          const goal = createdRows.find((r) => r.action.clientId === row.id)
          if (goal) return { ...goal.result, _pending: true }
          const assistOf = createdRows.find((r) => r.action.clientId === row.related_log_id)
          if (assistOf) return { ...row, related_log_id: assistOf.result.id }
          return row
        })
      )

      setPendingRemovals((prev) => {
        const next = new Set(prev)
        for (const r of results) {
          if (r.action.type === 'undo') next.delete(resolvedId(r))
        }
        return next
      })

      setPendingEdits((prev) => {
        let next = prev
        for (const r of results) {
          if (r.action.type === 'edit' && next[resolvedId(r)]) {
            next = { ...next }
            delete next[resolvedId(r)]
          }
        }
        return next
      })

      const droppedCount = results.filter((r) => r.dropped).length
      if (droppedCount > 0) {
        setSyncNote(
          `${droppedCount} queued ${droppedCount === 1 ? 'action was' : 'actions were'} rejected by the server and skipped.`
        )
      }

      setPendingCount(queueLength(matchKey))
      await loadDetail()
    } finally {
      syncingRef.current = false
      setSyncing(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchKey, getToken])

  useEffect(() => {
    const handleChange = () => {
      setIsOnline(navigator.onLine)
      if (navigator.onLine) trySync()
    }
    const off = onConnectivityChange(handleChange)
    // Also try once on mount, in case actions were queued in a previous
    // session that ended (or crashed) before they could sync.
    if (navigator.onLine && queueLength(matchKey) > 0) trySync()
    return off
  }, [matchKey, trySync])

  // A dropped connection mid-match doesn't fire a browser 'offline' event
  // if the wifi/data just goes flaky rather than fully off — so also retry
  // periodically whenever something is still queued, and whenever the tab
  // comes back to the foreground.
  useEffect(() => {
    if (pendingCount === 0) return undefined
    const interval = setInterval(trySync, 5000)
    const retryOnFocus = () => trySync()
    window.addEventListener('focus', retryOnFocus)
    document.addEventListener('visibilitychange', retryOnFocus)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', retryOnFocus)
      document.removeEventListener('visibilitychange', retryOnFocus)
    }
  }, [pendingCount, trySync])

  // Retire optimistic rows the server has caught up with: a synced create
  // whose numeric id is now in the timeline, or a synthetic assist whose
  // goal has arrived (the real pair comes back together).
  useEffect(() => {
    const ids = new Set((detail?.timeline || []).map((e) => e.id))
    if (ids.size === 0) return
    setPendingCreates((prev) => {
      const next = prev.filter((row) => {
        if (typeof row.id === 'number' && ids.has(row.id)) return false
        if (row.related_log_id != null && ids.has(row.related_log_id)) return false
        return true
      })
      return next.length === prev.length ? prev : next
    })
  }, [detail?.timeline])

  // --- Match simulation (Quick Sim / Simulate Match). ---
  // The backend builds the script, weighted by EA FC ratings; this page replays
  // it through the normal log endpoint, so a simulated match is recorded
  // exactly like a hand-logged one.
  const [simulation, setSimulation] = useState(null)
  const [simLogs, setSimLogs] = useState([])
  const [simMinute, setSimMinute] = useState(0)
  const [simScore, setSimScore] = useState({ home: 0, away: 0 })
  const [simBase, setSimBase] = useState(null)
  const simCancelRef = useRef(false)

  const navigate = useNavigate()

  if (role === 'athlete') {
    return <Navigate to="/dashboard" replace />
  }

  if (loading) {
    return (
      <Layout>
        <Loader label="Loading live match..." />
      </Layout>
    )
  }

  if (!detail) {
    return (
      <Layout>
        {error && <div className="roster-error">{error}</div>}
      </Layout>
    )
  }

  const event = isFixture ? detail.fixture : detail.event
  const rawResult = detail.result || { home: 0, away: 0 }
  const result = isFixture
    ? rawResult
    : { home: rawResult.squad ?? 0, away: rawResult.opponent ?? 0 }
  const timeline = detail.timeline || []
  const lineups = detail.lineups || []
  const lineupsSet = lineups.length > 0
  const canLog = isFixture ? detail.canLog : true

  // While a simulation is replaying, the incidents it has just posted are
  // shown straight away (deduped against whatever the server has already
  // returned) so the timeline and the player ratings move live. The same
  // layering puts queued (not yet synced) rows on screen immediately.
  const timelineIds = new Set(timeline.map((entry) => entry.id))
  const pendingSimLogs = simLogs.filter(
    (log) => log?.id != null && !timelineIds.has(log.id)
  )
  const optimisticRows = pendingCreates
    .filter((row) => !timelineIds.has(row.id))
    .map((row) => ({ ...row, ...(pendingEdits[row.id] || {}) }))
  const hasOptimisticLayer =
    pendingSimLogs.length > 0 || optimisticRows.length > 0 ||
    pendingRemovals.size > 0 || Object.keys(pendingEdits).length > 0
  const mergedTimeline = hasOptimisticLayer
    ? [...timeline, ...pendingSimLogs, ...optimisticRows]
      .filter((entry) => !pendingRemovals.has(entry.id))
      .map((entry) => ({ ...entry, ...(pendingEdits[entry.id] || {}) }))
      .sort((a, b) => {
        const minuteDiff = (a.minute ?? 0) - (b.minute ?? 0)
        if (minuteDiff !== 0) return minuteDiff
        if (typeof a.id === 'number' && typeof b.id === 'number') return a.id - b.id
        return String(a.id ?? '').localeCompare(String(b.id ?? ''))
      })
    : timeline
  const loggingOpen = canLog && activeStatus === 'live'

  // Saving the XI on a due match normally starts it — unless the squad is
  // short of available players. Surface the server's refusal wherever the
  // coach lands after saving.
  const blockedNote = startBlocked
    ? `Lineups saved, but the match can't go live yet: only ${startBlocked.available} of ${startBlocked.required} required players are marked available. Collect more RSVPs on the event page, then start the match.`
    : ''

  const homeName = isFixture ? event.home_squad_name : 'Your Squad'
  const awayName = isFixture ? event.away_squad_name : (event.opponent || 'Opponent')
  const summaryPath = isFixture ? `/events/${event.event_id}` : `/events/${entityId}`

  const homeRoster = isFixture ? (detail.rosters?.home || []) : athletes
  const awayRoster = isFixture ? (detail.rosters?.away || []) : []
  const homeSide = splitLineup(lineups, 'home')
  const awaySide = splitLineup(lineups, 'away')

  const homeFormation = detectFormation(homeSide.starters, 'home')
  const awayFormation = isFixture ? detectFormation(awaySide.starters, 'away') : null

  // Ratings come from whatever has been logged for each player so far.
  const hasLogs = mergedTimeline.length > 0
  const ratingOf = (athleteId) => {
    if (!hasLogs) return null
    return computeRating(mergedTimeline.filter((e) => e.athlete_id === athleteId))
  }

  const withRatings = (rows) =>
    rows.map((r) => ({ ...r, rating: ratingOf(r.athlete_id) }))

  const nameById = new Map()
  for (const r of lineups) nameById.set(r.athlete_id, r.name)
  for (const r of [...homeRoster, ...awayRoster]) {
    if (!nameById.has(r.id)) nameById.set(r.id, r.name)
  }

  async function postLog(body) {
    if (logging) return
    setLogging(true)
    setError('')
    setHint('')
    const fullBody = { minute: clockMinute, ...body }
    try {
      const created = await apiRequest(`${apiPrefix}/${entityId}/logs`, {
        method: 'POST',
        body: fullBody,
        getToken,
      })
      setFlow(null)
      // Show the row straight away; the reload below swaps it for the
      // server's copy and the dedupe effect retires the mirror.
      if (created?.id != null) {
        setPendingCreates((prev) => [...prev, created])
      }
      await loadDetail()
    } catch (err) {
      if (isRetryableError(err)) {
        // Offline (or the server is unreachable): queue the entry with a
        // client id so a replay can never double-log it, and put it on the
        // timeline now — the score and ratings move immediately.
        queueLog(fullBody)
        setFlow(null)
        setHint('Saved on this device — the timeline is already updated; it will sync automatically.')
      } else {
        setError(err.message)
      }
    } finally {
      setLogging(false)
    }
  }

  async function handleSaveLineup(payload) {
    if (savingLineup) return
    setSavingLineup(true)
    setError('')
    try {
      const saved = await apiRequest(`${apiPrefix}/${entityId}/lineup`, {
        method: 'PUT',
        body: payload,
        getToken,
      })
      setStartBlocked(saved?.startBlocked || null)
      await loadDetail()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingLineup(false)
    }
  }

  function handleActionClick(action) {
    if (!loggingOpen) return
    closeEdit()
    setHint('')
    setFlow({
      kind: action.value === 'substitution' ? 'subOff' : 'pick',
      action,
    })
  }

  function handlePickPlayer(player, side) {
    if (!flow || logging || !loggingOpen) return
    const row = lineups.find((l) => l.athlete_id === player.athlete_id)

    if (flow.kind === 'pick') {
      const { action } = flow
      if (!canLogOn(row, action.value)) {
        setHint('Substitutes can only receive a yellow or red card')
        return
      }
      if (action.value === 'substitution') {
        setFlow({ kind: 'subOn', action, offId: player.athlete_id, offSide: side })
        return
      }
      if (action.value === 'goal') {
        setFlow({ kind: 'assist', action, scorerId: player.athlete_id, scorerSide: side })
        return
      }
      postLog({
        athlete_id: player.athlete_id,
        action_type: action.value,
        is_scoring: action.scoring,
        notes: null,
      })
    } else if (flow.kind === 'assist') {
      if (player.athlete_id === flow.scorerId) return
      if (!row?.is_starter) {
        setHint('The assist must come from a player on the pitch')
        return
      }
      postLog({
        athlete_id: flow.scorerId,
        action_type: 'goal',
        is_scoring: true,
        assist_athlete_id: player.athlete_id,
      })
    } else if (flow.kind === 'subOff') {
      if (!row?.is_starter) {
        setHint('Swap a starting player for a substitute')
        return
      }
      setFlow({ kind: 'subOn', action: flow.action, offId: player.athlete_id, offSide: side })
    }
  }

  function handlePickBench(row, side) {
    if (!flow || logging || !loggingOpen) return

    if (flow.kind === 'pick') {
      if (!canLogOn(row, flow.action.value)) {
        setHint('Substitutes can only receive a yellow or red card')
        return
      }
      postLog({
        athlete_id: row.athlete_id,
        action_type: flow.action.value,
        is_scoring: flow.action.scoring,
        notes: null,
      })
    } else if (flow.kind === 'subOn') {
      if (side !== flow.offSide) {
        setHint('Pick a substitute from the same team')
        return
      }
      if (row.is_starter) {
        setHint('Pick a substitute (a bench player)')
        return
      }
      postLog({
        athlete_id: flow.offId,
        action_type: 'substitution',
        is_scoring: false,
        substitute_athlete_id: row.athlete_id,
      })
    } else if (flow.kind === 'assist') {
      setHint('The assist must come from a player on the pitch')
    }
  }

  function handleOpponentGoal() {
    if (!flow || logging || !loggingOpen) return
    if (flow.kind === 'pick' && flow.action.value === 'goal') {
      postLog({ athlete_id: null, action_type: 'goal', is_scoring: true, notes: null })
    }
  }

  async function handleUndo(entry) {
    const answer = await confirm({
      title: 'Undo log entry',
      message: 'Undo this log entry? It is removed from the timeline and the match stats.',
      confirmLabel: 'Undo entry',
      tone: 'danger',
    })
    if (!answer) return

    // A string id means the row is still only in the queue: undoing it is a
    // local decision — the queued create simply never goes out.
    if (typeof entry.id === 'string') {
      removeQueuedCreate(matchKey, entry.id)
      setPendingCreates((prev) => prev.filter(
        (row) => row.id !== entry.id && row.related_log_id !== entry.id
      ))
      setPendingCount(queueLength(matchKey))
      setHint('Entry removed — it had not left this device yet.')
      return
    }

    const logId = entry.id
    // Hide it here and now; the server copy goes with the DELETE below (or
    // with the queued one when offline).
    setPendingRemovals((prev) => new Set(prev).add(logId))
    try {
      await apiRequest(`${apiPrefix}/${entityId}/logs/${logId}`, { method: 'DELETE', getToken })
      setPendingRemovals((prev) => {
        const next = new Set(prev)
        next.delete(logId)
        return next
      })
      await loadDetail()
    } catch (err) {
      if (isRetryableError(err)) {
        enqueue(matchKey, { type: 'undo', path: `${apiPrefix}/${entityId}/logs/${logId}`, method: 'DELETE' })
        setPendingCount(queueLength(matchKey))
        setHint('No connection — the entry is hidden here and the undo will sync automatically.')
      } else {
        // Already gone server-side — either way it should not stay on screen.
        setPendingRemovals((prev) => {
          const next = new Set(prev)
          next.delete(logId)
          return next
        })
        await loadDetail()
      }
    }
  }

  function openEdit(entry) {
    setFlow(null)
    setEditingEntryId(entry.id)
    setEditForm({
      for: entry.athlete_id ? String(entry.athlete_id) : 'opponent',
      action_type: entry.action_type,
      is_scoring: entry.is_scoring,
      minute: entry.minute ?? '',
      notes: entry.notes || '',
    })
  }

  function closeEdit() {
    setEditingEntryId(null)
    setEditForm(null)
  }

  async function handleEditSubmit(e) {
    e.preventDefault()
    if (!editForm) return
    setEditSaving(true)
    setError('')
    const body = {
      athlete_id: editForm.for !== 'opponent' ? Number(editForm.for) : null,
      action_type: editForm.action_type,
      is_scoring: editForm.is_scoring,
      minute: editForm.minute !== '' ? Number(editForm.minute) : null,
      notes: editForm.notes.trim() || null,
    }

    // Editing a row that hasn't synced yet: the queued create carries the
    // newer values out when it goes — there is no server id to PATCH.
    if (typeof editingEntryId === 'string') {
      const queued = findQueuedCreate(matchKey, editingEntryId)
      if (queued) {
        const mergedBody = { ...queued.body, ...body }
        if (mergedBody.action_type !== 'substitution') delete mergedBody.substitute_athlete_id
        if (mergedBody.action_type !== 'goal') delete mergedBody.assist_athlete_id
        updateQueuedCreate(matchKey, editingEntryId, mergedBody)
        setPendingCreates((prev) => prev.map((row) => (
          row.id === editingEntryId ? { ...row, ...body } : row
        )))
        setHint('Edit applied to the entry waiting to sync.')
      }
      closeEdit()
      setEditSaving(false)
      return
    }

    const path = `${apiPrefix}/${entityId}/logs/${editingEntryId}`
    try {
      await apiRequest(path, { method: 'PATCH', body, getToken })
      closeEdit()
      await loadDetail()
    } catch (err) {
      if (isRetryableError(err)) {
        enqueue(matchKey, { type: 'edit', path, method: 'PATCH', body })
        setPendingEdits((prev) => ({ ...prev, [editingEntryId]: body }))
        setPendingCount(queueLength(matchKey))
        setHint('No connection — the edit is shown here and will sync automatically.')
        closeEdit()
      } else {
        setError(err.message)
      }
    } finally {
      setEditSaving(false)
    }
  }

  async function handleEndFixture() {
    const answer = await confirm({
      title: isFixture ? 'End fixture' : 'End event',
      message: isFixture
        ? 'End this fixture? No more actions can be logged.'
        : 'End this event? No more actions can be logged.',
      confirmLabel: isFixture ? 'End fixture' : 'End event',
      tone: 'danger',
    })
    if (!answer) return
    setEndingFixture(true)
    setError('')
    try {
      await apiRequest(`${apiPrefix}/${entityId}`, {
        method: 'PATCH',
        body: { status: 'completed' },
        getToken,
      })
      navigate(summaryPath)
    } catch (err) {
      setError(err.message)
    } finally {
      setEndingFixture(false)
    }
  }

  // --- Simulation controls ------------------------------------------------
  const simFetching = simulation?.phase === 'fetching'
  const simRunning = simulation?.phase === 'running'
  const simBusy = simFetching || simRunning
  const simReady =
    canLog && lineupsSet && activeStatus !== 'completed' && activeStatus !== 'cancelled'
  const simProgress = simFetching
    ? 4
    : Math.round((Math.min(simMinute, FULL_TIME_MINUTE) / FULL_TIME_MINUTE) * 100)

  // The scoreboard follows the replay: the score as it stood before kickoff
  // plus the goals the simulation has produced. The server's own result is
  // ignored until the closing reload, otherwise the three-second poll would
  // count every goal a second time.
  const baseResult = simBase
    ? { home: simBase.home + simScore.home, away: simBase.away + simScore.away }
    : result
  // Queued scoring entries count immediately too — the server's result only
  // becomes authoritative for them once the queue empties and reloads.
  const awayIds = isFixture ? new Set(awayRoster.map((a) => a.id)) : null
  const pendingScore = pendingCreates.reduce(
    (acc, entry) => {
      if (!entry.is_scoring || pendingRemovals.has(entry.id)) return acc
      const side = isFixture
        ? (entry.athlete_id != null && awayIds.has(entry.athlete_id) ? 'away' : 'home')
        : (entry.athlete_id == null ? 'away' : 'home')
      acc[side] += entry.value ?? 1
      return acc
    },
    { home: 0, away: 0 }
  )
  const displayResult = {
    home: baseResult.home + pendingScore.home,
    away: baseResult.away + pendingScore.away,
  }
  const displayMinute = simBusy ? simMinute : clockMinute

  const ratingsSources = (() => {
    const values = Object.values(simulation?.ratings || {})
    if (values.length === 0) return null
    const dataset = values.filter((rating) => rating.source === 'dataset').length
    return { dataset, estimated: values.length - dataset, total: values.length }
  })()

  function handleSimEvent(entry, created) {
    if (created?.id != null) setSimLogs((prev) => [...prev, created])
    if (entry.action_type === 'goal' && entry.is_scoring) {
      const side = entry.team_side === 'away' ? 'away' : 'home'
      setSimScore((prev) => ({ ...prev, [side]: prev[side] + 1 }))
    }
  }

  // mode 'quick' replays the whole match at once; 'timed' walks the 90 minutes
  // over two real-world minutes so the logging can be watched happening.
  async function startSimulation(mode) {
    if (simBusy) return

    if (hasLogs) {
      const answer = await confirm({
        title: mode === 'quick' ? 'Quick Sim' : 'Simulate Match',
        message:
          'This match already has actions logged. The simulated incidents are added on top of them.',
        confirmLabel: 'Simulate anyway',
      })
      if (!answer) return
    }

    simCancelRef.current = false
    setFlow(null)
    setHint('')
    setError('')
    setSimLogs([])
    setSimMinute(0)
    setSimScore({ home: 0, away: 0 })
    setSimBase({ ...result })
    setSimulation({ mode, phase: 'fetching', posted: 0, total: 0, ratings: null, summary: null })

    let script
    try {
      script = await apiRequest(`${apiPrefix}/${entityId}/simulate`, {
        method: 'POST',
        body: { mode },
        getToken,
      })
      // Simulating kicks a scheduled match off, so pull the page detail again:
      // the view switches from the pre-match preview to live logging.
      await loadDetail()
    } catch (err) {
      setSimBase(null)
      setSimulation({ mode, phase: 'error', posted: 0, total: 0, ratings: null, summary: null })
      setError(err.message)
      return
    }

    const incidents = script.events || []
    setSimulation((prev) => ({
      ...prev,
      phase: 'running',
      total: incidents.length,
      ratings: script.ratings || {},
      summary: script.summary || null,
    }))

    const report = await runSimulation({
      script: incidents,
      mode,
      postEvent: (body) =>
        apiRequest(`${apiPrefix}/${entityId}/logs`, { method: 'POST', body, getToken }),
      onMinute: (minute) => setSimMinute(minute),
      onEvent: handleSimEvent,
      isCancelled: () => simCancelRef.current,
    })

    const failureMessage = report.failures.length > 0 ? report.failures[0].error.message : ''
    await loadDetail()
    setSimBase(null)
    setSimScore({ home: 0, away: 0 })
    setSimMinute(report.lastMinute)
    setSimulation((prev) => ({
      ...prev,
      phase: report.cancelled ? 'stopped' : 'done',
      posted: report.posted,
      failures: report.failures.length,
    }))
    if (failureMessage) setError(failureMessage)
  }

  function stopSimulation() {
    simCancelRef.current = true
  }

  const header = (
    <div className="live-header">
      <div>
        <span className="dashboard-eyebrow">Live match</span>
        <h1>
          {isFixture
            ? `${homeName} vs ${awayName}`
            : (event.event_type === 'match'
              ? `vs ${event.opponent || 'Opponent TBD'}`
              : (event.title || 'Training session'))}
        </h1>
      </div>
      <div className="live-header-actions">
        {activeStatus === 'live' && (
          <span className="live-pulse">
            <span className="live-pulse-dot" />
            <span style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#e04040' }}>Live</span>
          </span>
        )}
        {simReady && (
          <>
            <button
              type="button"
              className="btn btn-gold"
              disabled={simBusy}
              onClick={() => startSimulation('quick')}
              title="Play the whole match straight away and log every incident"
            >
              {simFetching && simulation.mode === 'quick' ? (
                <Loader inline label="Simulating..." />
              ) : (
                'Quick Sim'
              )}
            </button>
            <button
              type="button"
              className="btn btn-gold"
              disabled={simBusy}
              onClick={() => startSimulation('timed')}
              title="Watch the 90 minutes replay over two real-world minutes"
            >
              {simFetching && simulation.mode === 'timed' ? (
                <Loader inline label="Simulating..." />
              ) : (
                'Simulate Match'
              )}
            </button>
          </>
        )}
        {simRunning && (
          <button type="button" className="btn btn-ghost" onClick={stopSimulation}>
            Stop
          </button>
        )}
        {loggingOpen && (
          <button
            type="button"
            className="btn btn-danger"
            disabled={endingFixture}
            onClick={handleEndFixture}
          >
            {endingFixture ? (
              <Loader inline label="Ending..." />
            ) : isFixture ? (
              'End fixture'
            ) : (
              'End event'
            )}
          </button>
        )}
        <Link to={summaryPath} className="btn btn-ghost">Summary</Link>
      </div>
    </div>
  )

  // --- Lineup gate: nobody logs until the starting XIs exist. ---
  if (!lineupsSet) {
    if (canLog && activeStatus !== 'completed' && activeStatus !== 'cancelled') {
      return (
        <Layout>
          {header}
          {error && <div className="roster-error">{error}</div>}
          <LineupWizard
            homeName={homeName}
            awayName={isFixture ? awayName : null}
            homeRoster={homeRoster}
            awayRoster={isFixture ? awayRoster : null}
            suggestions={lineupSuggestions}
            saving={savingLineup}
            onSave={handleSaveLineup}
          />
        </Layout>
      )
    }
    return (
      <Layout>
        {header}
        <div className="roster-empty">
          <p>Waiting for the home coach to set the starting lineups.</p>
        </div>
      </Layout>
    )
  }

  // Simple events used to bounce straight to the summary before going live;
  // now the coach may set the XI pre-match, so keep them here with a
  // read-only pitch until kickoff. Finished events still redirect.
  if (!isFixture && activeStatus !== 'live') {
    if (activeStatus === 'scheduled' && canLog) {
      return (
        <Layout>
          {header}
          {error && <div className="roster-error">{error}</div>}
          {blockedNote ? (
            <div className="live-note live-note-warn">{blockedNote}</div>
          ) : (
            <div className="live-note">
              Lineups are set. The match starts at kickoff — come back then to log actions.
            </div>
          )}
          <Pitch homePlayers={withRatings(homeSide.starters)} awayPlayers={[]} />
        </Layout>
      )
    }
    return <Navigate to={`/events/${entityId}`} replace />
  }

  // --- Live / scheduled fixture view with the pitch. ---
  const fadedIds = (() => {
    if (!flow) return null
    const set = new Set()
    if (flow.kind === 'assist') {
      for (const r of lineups) {
        if (!r.is_starter || r.athlete_id === flow.scorerId) set.add(r.athlete_id)
      }
    }
    return set
  })()

  const selectedId =
    flow?.kind === 'assist' ? flow.scorerId
      : flow?.kind === 'subOn' ? flow.offId
        : null

  const assistCandidates =
    flow?.kind === 'assist'
      ? lineups.filter(
        (r) => r.team_side === flow.scorerSide && r.is_starter && r.athlete_id !== flow.scorerId
      )
      : []

  const subBench =
    flow?.kind === 'subOn'
      ? (flow.offSide === 'home' ? homeSide.bench : awaySide.bench)
      : []

  const flowBanner = (() => {
    if (!flow) return null
    if (flow.kind === 'pick') {
      const cardFlow = flow.action.value === 'yellow_card' || flow.action.value === 'red_card'
      return `Log ${flow.action.label}: tap a player on the pitch${
        cardFlow ? ' or a substitute below' : ''
      }.`
    }
    if (flow.kind === 'assist') {
      return `Goal — ${nameById.get(flow.scorerId) || 'scorer'}. Tap the assister (optional).`
    }
    if (flow.kind === 'subOff') return 'Substitution: tap the player coming off.'
    if (flow.kind === 'subOn') {
      return `${nameById.get(flow.offId) || 'Player'} off — tap the substitute coming on.`
    }
    return null
  })()

  const benchChip = (row, side) => {
    let pickable = false
    if (flow && loggingOpen && !logging) {
      if (flow.kind === 'pick') pickable = canLogOn(row, flow.action.value)
      else if (flow.kind === 'subOn') pickable = side === flow.offSide && !row.is_starter
    }
    const rating = ratingOf(row.athlete_id)
    const color = rating != null ? ratingColor(rating) : null
    return (
      <button
        key={`${side}-${row.athlete_id}`}
        type="button"
        className={`live-bench-chip${pickable ? ' is-pickable' : ''}${flow && !pickable ? ' is-muted' : ''}`}
        onClick={() => handlePickBench(row, side)}
      >
        {row.photo ? (
          <img className="live-bench-img" src={row.photo} alt="" />
        ) : (
          <span className="live-bench-initials">{initialsOf(row.name)}</span>
        )}
        <span className="live-bench-name">
          {row.squad_number != null ? `#${row.squad_number} ` : ''}{row.name}
        </span>
        {color && (
          <span className="live-bench-rating" style={{ background: color.bg, color: color.fg }}>
            {rating.toFixed(1)}
          </span>
        )}
      </button>
    )
  }

  // Linked assists fold into their goal's row instead of standing alone.
  const visibleTimeline = mergedTimeline.filter((e) => !isLinkedAssist(e))
  // Incidents the replay has just posted flash like a hand-logged one.
  const simLogIds = new Set(
    simLogs.map((log) => log?.id).filter((value) => value != null)
  )

  return (
    <Layout>
      {header}

      {(!isOnline || pendingCount > 0) && (
        <div className="offline-banner" role="status">
          <span>
            {!isOnline
              ? `You're offline — logging still works and the timeline updates straight away.${pendingCount > 0 ? ` (${pendingCount} queued)` : ''}`
              : syncing
                ? 'Reconnected — syncing queued entries...'
                : `${pendingCount} entr${pendingCount === 1 ? 'y' : 'ies'} queued, waiting to sync.`}
          </span>
          {isOnline && pendingCount > 0 && !syncing && (
            <button type="button" className="btn btn-ghost offline-sync-btn" onClick={trySync}>
              Sync now
            </button>
          )}
        </div>
      )}

      {syncNote && <div className="live-note">{syncNote}</div>}
      {hint && !flow && <div className="live-note">{hint}</div>}
      {blockedNote && !flow && <div className="live-note live-note-warn">{blockedNote}</div>}
      {error && <div className="roster-error">{error}</div>}

      <div className="live-scoreboard">
        <span className="live-team">
          {homeName}
          {homeFormation && <span className="live-formation-chip">{homeFormation}</span>}
        </span>
        <div className="live-score-center">
          <span className="live-minute">{displayMinute}'</span>
          <span className="live-score">{displayResult.home} - {displayResult.away}</span>
        </div>
        <span className="live-team live-team-right">
          {awayName}
          {awayFormation && <span className="live-formation-chip">{awayFormation}</span>}
        </span>
      </div>

      {activeStatus === 'scheduled' && (
        <div className="live-note">
          Kicks off at {event.event_date ? new Date(event.event_date).toLocaleString() : 'TBD'} — lineups are set.
        </div>
      )}

      {simBusy && (
        <div className="live-sim-status" role="status" aria-live="polite">
          <div className="live-sim-status-row">
            <span className="live-sim-chip">
              {simFetching
                ? 'Fetching player ratings'
                : `${simulation.mode === 'quick' ? 'Quick Sim' : 'Simulating'} · ${simMinute}'`}
            </span>
            <span className="live-sim-meta">
              {simFetching
                ? 'Looking up EA FC ratings for the squad — the first run can take a few seconds'
                : `${simulation.posted} of ${simulation.total} incidents logged`}
            </span>
          </div>
          <div className="live-sim-bar">
            <span className="live-sim-bar-fill" style={{ width: `${simProgress}%` }} />
          </div>
        </div>
      )}

      {simulation && !simBusy && (
        <div className="live-sim-result">
          <div>
            <span className="live-sim-result-title">
              {simulation.phase === 'stopped' ? 'Simulation stopped' : 'Simulation complete'}
            </span>
            <span className="live-sim-result-line">
              {displayResult.home} - {displayResult.away} from {simulation.posted} logged incidents
              {simulation.failures ? ` · ${simulation.failures} rejected` : ''}
            </span>
            {ratingsSources && (
              <span className="live-sim-result-note">
                EA FC ratings: {ratingsSources.dataset} from the dataset,{' '}
                {ratingsSources.estimated} estimated by position ({ratingsSources.total} players)
              </span>
            )}
            {simulation.summary && (
              <span className="live-sim-result-note">
                Squad {simulation.summary.homeStrength} vs {simulation.summary.awayStrength} · expected
                goals {simulation.summary.homeExpectedGoals} - {simulation.summary.awayExpectedGoals}
              </span>
            )}
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => setSimulation(null)}>
            Dismiss
          </button>
        </div>
      )}

      {loggingOpen && !simBusy && (
        <>
          <h3 className="live-section-heading">Log Event</h3>
          <div className="live-action-grid">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.value}
                type="button"
                className={`live-action-btn live-action-${action.tone}${
                  flow?.action?.value === action.value ? ' is-active' : ''
                }`}
                onClick={() => handleActionClick(action)}
              >
                {action.label}
              </button>
            ))}
          </div>

          {flow && (
            <div className="live-flow-panel">
              <div className="live-flow-header">
                <span>{flowBanner}</span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={logging}
                  onClick={() => { setFlow(null); setHint('') }}
                >
                  Cancel
                </button>
              </div>
              {hint && <p className="live-flow-hint">{hint}</p>}

              {flow.kind === 'assist' && (
                <div className="live-flow-grid">
                  <button
                    type="button"
                    className="live-who-btn live-who-opponent"
                    disabled={logging}
                    onClick={() =>
                      postLog({
                        athlete_id: flow.scorerId,
                        action_type: 'goal',
                        is_scoring: true,
                      })}
                  >
                    No assist
                  </button>
                  {assistCandidates.map((r) => (
                    <button
                      key={r.athlete_id}
                      type="button"
                      className="live-who-btn"
                      disabled={logging}
                      onClick={() =>
                        postLog({
                          athlete_id: flow.scorerId,
                          action_type: 'goal',
                          is_scoring: true,
                          assist_athlete_id: r.athlete_id,
                        })}
                    >
                      {r.squad_number != null ? `#${r.squad_number} ` : ''}{r.name}
                    </button>
                  ))}
                </div>
              )}

              {flow.kind === 'subOn' && (
                <div className="live-flow-grid">
                  {subBench.length === 0 && (
                    <p className="live-flow-hint">No substitutes named on the bench.</p>
                  )}
                  {subBench.map((r) => (
                    <button
                      key={r.athlete_id}
                      type="button"
                      className="live-who-btn"
                      disabled={logging}
                      onClick={() => handlePickBench(r, flow.offSide)}
                    >
                      {r.squad_number != null ? `#${r.squad_number} ` : ''}{r.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <Pitch
        homePlayers={withRatings(homeSide.starters)}
        awayPlayers={withRatings(awaySide.starters)}
        selectedId={selectedId}
        fadedIds={fadedIds}
        onSelect={loggingOpen && !simBusy ? handlePickPlayer : undefined}
      />

      <div className="live-bench">
        <div className="live-bench-col">
          <span className="live-bench-title">{homeName} · bench</span>
          <div className="live-bench-chips">
            {homeSide.bench.length === 0 && <span className="live-bench-empty">No substitutes</span>}
            {homeSide.bench.map((r) => benchChip(r, 'home'))}
            {!isFixture && (
              <button
                type="button"
                className={`live-bench-chip live-bench-opponent${
                  flow?.kind === 'pick' && flow.action.value === 'goal' ? ' is-pickable' : ''
                }`}
                onClick={handleOpponentGoal}
              >
                <span className="live-bench-initials live-bench-initials-opponent">?</span>
                <span className="live-bench-name">Opponent (no player)</span>
              </button>
            )}
          </div>
        </div>
        {isFixture && (
          <div className="live-bench-col">
            <span className="live-bench-title">{awayName} · bench</span>
            <div className="live-bench-chips">
              {awaySide.bench.length === 0 && <span className="live-bench-empty">No substitutes</span>}
              {awaySide.bench.map((r) => benchChip(r, 'away'))}
            </div>
          </div>
        )}
      </div>

      <h3 className="live-section-heading">Timeline</h3>
      {visibleTimeline.length === 0 ? (
        <div className="roster-empty">
          <p>No actions logged yet.</p>
        </div>
      ) : (
        <div className="live-timeline">
          {visibleTimeline.map((entry) => {
            const minuteClass = entry.action_type === 'goal'
              ? 'live-timeline-minute--goal'
              : entry.action_type.includes('card')
                ? 'live-timeline-minute--card'
                : entry.action_type.includes('penalty')
                  ? 'live-timeline-minute--penalty'
                  : ''
            const isNew = newEntryIds.has(entry.id) || simLogIds.has(entry.id) || Boolean(entry._pending)
            const assist = entry.action_type === 'goal' ? assistForGoal(mergedTimeline, entry.id) : null
            const subOnId = entry.action_type === 'substitution' ? parseSubstitutionNotes(entry.notes) : null
            return (
            <div key={entry.id}>
              <div className={`live-timeline-entry${isNew ? ' live-timeline-entry--new' : ''}`}>
                <span className={`live-timeline-minute ${minuteClass}`}>
                  {entry.minute != null ? `${entry.minute}'` : '—'}
                </span>
                <div className="live-timeline-body">
                  <span className="live-timeline-action">{formatActionType(entry.action_type)}</span>
                  <span className="live-timeline-who">{entry.athlete_name || nameById.get(entry.athlete_id) || 'Opponent'}</span>
                  {entry._pending && <span className="live-timeline-pending">queued</span>}
                  {assist && (
                    <span className="live-timeline-detail">
                      assist: {assist.athlete_name || nameById.get(assist.athlete_id) || '—'}
                    </span>
                  )}
                  {subOnId != null && (
                    <span className="live-timeline-detail">
                      on: {nameById.get(subOnId) || `#${subOnId}`}
                    </span>
                  )}
                </div>
                {canLog && !simBusy && (
                  <div className="live-timeline-actions">
                    <button type="button" className="btn btn-ghost" onClick={() => openEdit(entry)}>
                      Edit
                    </button>
                    <button type="button" className="btn btn-danger" onClick={() => handleUndo(entry)}>
                      Undo
                    </button>
                  </div>
                )}
              </div>

              {canLog && editingEntryId === entry.id && editForm && (
                <form className="roster-form live-edit-form" onSubmit={handleEditSubmit}>
                  <div className="roster-form-grid">
                    <label>
                      For
                      <select
                        value={editForm.for}
                        onChange={(e) => setEditForm({ ...editForm, for: e.target.value })}
                      >
                        {homeRoster.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}{a.squad_number != null ? ` (#${a.squad_number})` : ''}
                          </option>
                        ))}
                        <option value="opponent">Opponent</option>
                      </select>
                    </label>
                    <label>
                      Action
                      <select
                        value={editForm.action_type}
                        onChange={(e) => setEditForm({ ...editForm, action_type: e.target.value })}
                      >
                        {ACTION_TYPES.map((a) => (
                          <option key={a.value} value={a.value}>{a.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Minute
                      <input
                        type="number"
                        min="0"
                        value={editForm.minute}
                        onChange={(e) => setEditForm({ ...editForm, minute: e.target.value })}
                      />
                    </label>
                    <label className="roster-form-checkbox">
                      <input
                        type="checkbox"
                        checked={editForm.is_scoring}
                        onChange={(e) => setEditForm({ ...editForm, is_scoring: e.target.checked })}
                      />
                      Counts toward result
                    </label>
                    <label className="roster-form-wide">
                      Notes
                      <input
                        type="text"
                        value={editForm.notes}
                        onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                        placeholder="Optional"
                      />
                    </label>
                  </div>
                  <div className="roster-form-actions">
                    <button type="button" className="btn btn-ghost" onClick={closeEdit}>
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-gold" disabled={editSaving}>
                      {editSaving ? <Loader inline label="Saving..." /> : 'Save changes'}
                    </button>
                  </div>
                </form>
              )}
            </div>
            )
          })}
        </div>
      )}
    </Layout>
  )
}

export default LiveMatch
