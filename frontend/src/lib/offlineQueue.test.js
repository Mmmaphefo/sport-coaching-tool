// AI assistance: drafted with Claude (Sonnet 5) via claude.ai; reviewed and tested by the project team.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  clearQueue,
  enqueue,
  findQueuedCreate,
  flushQueue,
  getQueue,
  newClientId,
  onConnectivityChange,
  queueLength,
  removeQueuedCreate,
  updateQueuedCreate,
} from './offlineQueue'

const MATCH = '/api/events/5'
const OTHER_MATCH = '/api/fixtures/9'

// api.js tags failures so the queue can tell "retry later" (offline, 5xx)
// apart from "never" (4xx) — the queue's contract is built around these.
function networkError() {
  return Object.assign(new Error('Could not reach the server. Is the backend running?'), {
    status: 0,
    isRetryable: true,
  })
}

function rejection(status = 404) {
  return Object.assign(new Error('Log entry not found'), {
    status,
    isRetryable: false,
  })
}

function goalBody(clientId, minute = 10) {
  return { athlete_id: 3, action_type: 'goal', is_scoring: true, minute, client_id: clientId }
}

beforeEach(() => {
  localStorage.clear()
})

describe('offlineQueue', () => {
  it('persists per match and gives every create a client id for idempotent replay', () => {
    const entry = enqueue(MATCH, {
      type: 'create',
      clientId: null,
      path: `${MATCH}/logs`,
      method: 'POST',
      body: { athlete_id: 3, action_type: 'goal' },
    })

    // A create without its own id reuses the action id as its replay key,
    // so the body the server sees always carries client_id.
    expect(entry.actionId).toEqual(expect.any(String))
    expect(entry.clientId).toBe(entry.actionId)
    expect(queueLength(MATCH)).toBe(1)

    // Namespaced per match — a fixture's queue never leaks into an event's.
    enqueue(OTHER_MATCH, { type: 'create', clientId: 'other-1', path: `${OTHER_MATCH}/logs`, method: 'POST', body: {} })
    expect(queueLength(MATCH)).toBe(1)
    expect(queueLength(OTHER_MATCH)).toBe(1)
  })

  it('stamps every create at queue time with occurred_at and a stable device id', () => {
    const first = enqueue(MATCH, { type: 'create', path: `${MATCH}/logs`, method: 'POST', body: { action_type: 'goal' } })
    const second = enqueue(OTHER_MATCH, { type: 'create', path: `${OTHER_MATCH}/logs`, method: 'POST', body: { action_type: 'goal' } })

    // occurred_at is the queue-time instant — when the action happened.
    expect(first.body.occurred_at).toBe(new Date(first.queuedAt).toISOString())
    expect(first.body.device_id).toEqual(expect.any(String))
    // One device: the id is persisted per browser profile, not per action.
    expect(second.body.device_id).toBe(first.body.device_id)
    expect(localStorage.getItem('kickstat_device_id')).toBe(first.body.device_id)

    // Edits carry no "happened at" time of their own.
    const edit = enqueue(MATCH, { type: 'edit', path: `${MATCH}/logs/1`, method: 'PATCH', body: { minute: 9 } })
    expect(edit.body.occurred_at).toBeUndefined()
    expect(edit.body.device_id).toBeUndefined()
  })

  it('generates unique client ids even without crypto.randomUUID', () => {
    const seen = new Set()
    for (let i = 0; i < 50; i += 1) seen.add(newClientId())
    expect(seen.size).toBe(50)
  })

  it('replays queued actions in order and empties the queue', async () => {
    const getToken = () => 'token'
    const apiRequest = vi.fn().mockResolvedValue({ id: 101 })
    enqueue(MATCH, { type: 'create', clientId: 'client-goal', path: `${MATCH}/logs`, method: 'POST', body: goalBody('client-goal') })
    enqueue(MATCH, { type: 'edit', targetClientId: 'client-goal', path: `${MATCH}/logs/101`, method: 'PATCH', body: { minute: 12 } })
    enqueue(MATCH, { type: 'undo', targetClientId: 'client-goal', path: `${MATCH}/logs/101`, method: 'DELETE' })

    const results = await flushQueue(MATCH, apiRequest, getToken)

    // Order matters: the edit and the undo must land after the create they target.
    expect(apiRequest.mock.calls.map(([path]) => path)).toEqual([
      `${MATCH}/logs`,
      `${MATCH}/logs/101`,
      `${MATCH}/logs/101`,
    ])
    expect(apiRequest.mock.calls[0][1]).toMatchObject({ method: 'POST', getToken })
    // The create still carries its client values — plus the queue-time stamps
    // (device + occurred_at) the server orders the timeline by.
    const replayedBody = apiRequest.mock.calls[0][1].body
    expect(replayedBody).toMatchObject(goalBody('client-goal'))
    expect(replayedBody.device_id).toEqual(expect.any(String))
    expect(replayedBody.occurred_at).toEqual(expect.any(String))
    expect(results.every((r) => r.ok)).toBe(true)
    expect(queueLength(MATCH)).toBe(0)
  })

  it('drops an action the server permanently rejects and keeps replaying the rest', async () => {
    const apiRequest = vi.fn()
      .mockRejectedValueOnce(rejection(400))
      .mockResolvedValueOnce({ id: 102 })
    enqueue(MATCH, { type: 'create', clientId: 'client-bad', path: `${MATCH}/logs`, method: 'POST', body: goalBody('client-bad') })
    enqueue(MATCH, { type: 'create', clientId: 'client-good', path: `${MATCH}/logs`, method: 'POST', body: goalBody('client-good') })

    const results = await flushQueue(MATCH, apiRequest, () => 'token')

    // The 4xx is dropped, not retried — and it must not wedge the queue.
    expect(results[0]).toMatchObject({ ok: false, dropped: true })
    expect(results[1].ok).toBe(true)
    expect(apiRequest).toHaveBeenCalledTimes(2)
    expect(queueLength(MATCH)).toBe(0)
  })

  it('stops at a transient failure and leaves the remaining actions queued', async () => {
    const apiRequest = vi.fn()
      .mockResolvedValueOnce({ id: 101 })
      .mockRejectedValueOnce(networkError())
    enqueue(MATCH, { type: 'create', clientId: 'client-one', path: `${MATCH}/logs`, method: 'POST', body: goalBody('client-one') })
    enqueue(MATCH, { type: 'create', clientId: 'client-two', path: `${MATCH}/logs`, method: 'POST', body: goalBody('client-two') })
    enqueue(MATCH, { type: 'create', clientId: 'client-three', path: `${MATCH}/logs`, method: 'POST', body: goalBody('client-three') })

    const results = await flushQueue(MATCH, apiRequest, () => 'token')

    expect(results).toHaveLength(2)
    expect(results[1]).toMatchObject({ ok: false })
    expect(results[1].dropped).toBeUndefined()
    // The failed action and everything behind it stay queued, so the next
    // attempt retries from exactly where this one gave up.
    expect(apiRequest).toHaveBeenCalledTimes(2)
    const remaining = getQueue(MATCH)
    expect(remaining.map((a) => a.clientId)).toEqual(['client-two', 'client-three'])
  })

  it('rewrites a queued create instead of stacking an edit behind it', () => {
    enqueue(MATCH, { type: 'create', clientId: 'client-goal', path: `${MATCH}/logs`, method: 'POST', body: goalBody('client-goal') })

    expect(updateQueuedCreate(MATCH, 'client-goal', goalBody('client-goal', 12))).toBe(true)
    expect(getQueue(MATCH)[0].body.minute).toBe(12)
    expect(queueLength(MATCH)).toBe(1) // one action, not create + edit

    expect(updateQueuedCreate(MATCH, 'missing', {})).toBe(false)
  })

  it('undoing an unsent create also drops any queued follow-ups for it', () => {
    enqueue(MATCH, { type: 'create', clientId: 'client-goal', path: `${MATCH}/logs`, method: 'POST', body: goalBody('client-goal') })
    enqueue(MATCH, { type: 'edit', targetClientId: 'client-goal', path: `${MATCH}/logs/1`, method: 'PATCH', body: { minute: 5 } })

    removeQueuedCreate(MATCH, 'client-goal')

    expect(getQueue(MATCH)).toHaveLength(0)
  })

  it('finds the queued create behind an optimistic row', () => {
    enqueue(MATCH, { type: 'create', clientId: 'client-goal', path: `${MATCH}/logs`, method: 'POST', body: goalBody('client-goal') })

    expect(findQueuedCreate(MATCH, 'client-goal')?.type).toBe('create')
    expect(findQueuedCreate(MATCH, 'missing')).toBeNull()
  })

  it('clears the queue for one match without touching another', () => {
    enqueue(MATCH, { type: 'create', clientId: 'client-goal', path: `${MATCH}/logs`, method: 'POST', body: goalBody('client-goal') })
    enqueue(OTHER_MATCH, { type: 'create', clientId: 'client-other', path: `${OTHER_MATCH}/logs`, method: 'POST', body: {} })

    clearQueue(MATCH)

    expect(queueLength(MATCH)).toBe(0)
    expect(queueLength(OTHER_MATCH)).toBe(1)
  })

  it('reports connectivity changes and lets the caller unsubscribe', () => {
    const listener = vi.fn()
    const off = onConnectivityChange(listener)

    window.dispatchEvent(new Event('online'))
    window.dispatchEvent(new Event('offline'))
    expect(listener).toHaveBeenCalledTimes(2)

    off()
    window.dispatchEvent(new Event('online'))
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
