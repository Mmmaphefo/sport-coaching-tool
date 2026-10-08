// Offline-first logging queue.
//
// Live logging happens pitch-side, often with a weak or dropped signal.
// This queues log create/edit/undo actions in localStorage when the network
// is unavailable, applies them to the UI optimistically, and replays them in
// order once the connection returns — so an event's data is never lost to a
// dropped signal.
//
// Correctness rules:
//   - Every create carries a client-generated id that is also sent to the
//     server (client_id). Replaying a create whose response was lost is a
//     no-op server-side: the backend sees the id and returns the row it
//     already stored, instead of inserting a duplicate.
//   - A permanent rejection (HTTP 4xx — e.g. an entry that was already
//     undone) is dropped and the replay continues. Only network/server
//     failures pause the queue, so one bad action can never wedge it.

const STORAGE_PREFIX = 'kickstat_offline_queue_'

function storageKey(matchKey) {
  return `${STORAGE_PREFIX}${matchKey}`
}

function readQueue(matchKey) {
  try {
    const raw = localStorage.getItem(storageKey(matchKey))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function writeQueue(matchKey, queue) {
  try {
    localStorage.setItem(storageKey(matchKey), JSON.stringify(queue))
  } catch {
    // Storage full/unavailable (private browsing) — actions still work
    // live, they just won't survive a reload while offline.
  }
}

// crypto.randomUUID needs a secure context; the fallback keeps local dev
// over plain http working too. Uniqueness only matters per match.
export function newClientId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// action: { type: 'create' | 'edit' | 'undo', path, method, body, clientId? }
export function enqueue(matchKey, action) {
  const queue = readQueue(matchKey)
  const entry = { actionId: newClientId(), ...action, queuedAt: Date.now() }
  if (entry.type === 'create' && !entry.clientId) {
    entry.clientId = entry.actionId
  }
  queue.push(entry)
  writeQueue(matchKey, queue)
  return entry
}

export function getQueue(matchKey) {
  return readQueue(matchKey)
}

export function queueLength(matchKey) {
  return readQueue(matchKey).length
}

// The still-queued create behind an optimistically-shown entry, if any.
// LiveMatch uses this when the user edits or undoes a row that hasn't
// reached the server yet (its row id is the client id).
export function findQueuedCreate(matchKey, clientIdValue) {
  return readQueue(matchKey).find((a) => a.type === 'create' && a.clientId === clientIdValue) || null
}

// Editing an entry that was never sent doesn't need a PATCH — the queued
// create simply carries the newer values when it finally goes out.
export function updateQueuedCreate(matchKey, clientIdValue, body) {
  const queue = readQueue(matchKey)
  const idx = queue.findIndex((a) => a.type === 'create' && a.clientId === clientIdValue)
  if (idx === -1) return false
  queue[idx] = { ...queue[idx], body }
  writeQueue(matchKey, queue)
  return true
}

// Undoing an entry that was never sent: the create (and any queued edits
// targeting it) disappear entirely — nothing was ever recorded server-side.
export function removeQueuedCreate(matchKey, clientIdValue) {
  const queue = readQueue(matchKey).filter(
    (a) => !(a.type === 'create' && a.clientId === clientIdValue) && a.targetClientId !== clientIdValue
  )
  writeQueue(matchKey, queue)
}

export function removeAction(matchKey, actionId) {
  writeQueue(matchKey, readQueue(matchKey).filter((a) => a.actionId !== actionId))
}

// Replays queued actions in order against `apiRequest`, one at a time —
// order matters here (an edit/undo must land after the create it targets).
// Transient failures stop the pass and leave the rest of the queue intact;
// permanent rejections are dropped so they can't block what follows.
export async function flushQueue(matchKey, apiRequest, getToken) {
  const queue = readQueue(matchKey)
  const results = []

  for (const action of queue) {
    try {
      const result = await apiRequest(action.path, {
        method: action.method,
        body: action.body,
        getToken,
      })
      removeAction(matchKey, action.actionId)
      results.push({ action, ok: true, result })
    } catch (err) {
      if (err && err.isRetryable === false) {
        removeAction(matchKey, action.actionId)
        results.push({ action, ok: false, dropped: true, error: err.message })
        continue
      }
      results.push({ action, ok: false, error: err.message })
      break // transient — retry from this action on the next attempt
    }
  }

  return results
}

export function clearQueue(matchKey) {
  writeQueue(matchKey, [])
}

// Small helper so callers don't need to import both navigator.onLine and
// the 'online'/'offline' event wiring separately.
export function onConnectivityChange(callback) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}
