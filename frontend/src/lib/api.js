const API_URL = import.meta.env.VITE_API_URL

// Clerk's dev-browser handshake (pk_test_*) relies on third-party storage that
// Safari can block (Private mode, or cross-site tracking prevention), and when
// it does, getToken() never settles — the UI used to sit on a disabled button
// with no error forever. Every await below is therefore bounded: a hang
// surfaces as a clear error the user can act on (refresh), instead of a freeze.
const TOKEN_TIMEOUT_MS = 12000
const REQUEST_TIMEOUT_MS = 20000

function withTimeout(promise, ms, message) {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId))
}

// Every failure carries a verdict so callers (especially the offline queue)
// can tell "try again later" apart from "this will never work":
//   status 0        → the request never got an answer (offline, DNS, timeout)
//   status >= 500   → the server hiccuped; worth retrying later
//   status 4xx      → a permanent rejection; replaying it can never succeed
function requestError(message, { status = 0, cause } = {}) {
  const err = new Error(message, cause ? { cause } : undefined)
  err.status = status
  err.isNetworkError = status === 0
  err.isRetryable = status === 0 || status >= 500
  return err
}

// The production API runs on Render's free tier, which sleeps after ~15
// minutes idle and takes 30-60s to wake. While it boots, requests hang or
// come back 502/503/504. Reads (GET) are safe to repeat, so they are retried
// with backoff long enough to ride out a cold start; writes are never retried
// here (the offline queue owns replaying those) so nothing is applied twice.
const GET_RETRY_DELAYS_MS = [2000, 4000, 8000]
const COLD_START_STATUSES = new Set([502, 503, 504])

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Fire-and-forget ping that starts waking the backend the moment the app
// loads, so it is usually warm by the time the user has signed in.
export function wakeBackend() {
  if (!API_URL || typeof fetch !== 'function') return
  try {
    fetch(`${API_URL}/api/health`, { method: 'GET' }).catch(() => {})
  } catch {
    // Never let a warm-up ping break the app.
  }
}

async function sendOnce(path, { method, body, token }) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let res
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch (err) {
    if (err.name === 'AbortError') {
      throw requestError(
        'The server is taking too long to respond (it may be waking up). Please try again in a moment.',
        { cause: err }
      )
    }
    throw requestError('Could not reach the server. Check your connection and try again.', { cause: err })
  } finally {
    clearTimeout(timeoutId)
  }

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}))
    throw requestError(errorBody.error || `Request failed with status ${res.status}`, {
      status: res.status,
    })
  }

  if (res.status === 204) {
    return null
  }

  return res.json()
}

// Clerk session tokens live for only 60 seconds, so a token must never be
// reused across retries: a cold-start retry loop can easily outlast it and
// the server then rejects the request as signed out. Each attempt asks Clerk
// for a token (Clerk returns its cached one while still valid and refreshes
// it otherwise); skipCache forces a brand-new one.
async function fetchToken(getToken, { skipCache = false } = {}) {
  try {
    return await withTimeout(
      Promise.resolve().then(() => (skipCache ? getToken({ skipCache: true }) : getToken())),
      TOKEN_TIMEOUT_MS,
      'Sign-in verification timed out. Please refresh the page and try again.'
    )
  } catch (err) {
    // A failed token fetch usually means we're effectively offline, so this
    // is reported as a network error — queued actions are kept, not dropped.
    throw requestError(err.message, { cause: err })
  }
}

export async function apiRequest(path, { method = 'GET', body, getToken, retry } = {}) {
  const canRetry = retry ?? method === 'GET'
  const delays = canRetry ? GET_RETRY_DELAYS_MS : []

  for (let attempt = 0; ; attempt++) {
    const token = await fetchToken(getToken)
    try {
      return await sendOnce(path, { method, body, token })
    } catch (err) {
      // A 401 can mean the token expired in flight. Retry exactly once with a
      // freshly minted token before reporting the user as signed out. The
      // server rejected the request outright, so even a write is safe to
      // resend here: nothing was applied. It returns directly, so it can
      // only ever happen once per request.
      if (err.status === 401) {
        const fresh = await fetchToken(getToken, { skipCache: true })
        return sendOnce(path, { method, body, token: fresh })
      }
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false
      const coldStart = err.status === 0 || COLD_START_STATUSES.has(err.status)
      if (attempt >= delays.length || offline || !coldStart) throw err
      await sleep(delays[attempt])
    }
  }
}

// True when the failure is worth retrying later (offline / server down).
export function isRetryableError(err) {
  return Boolean(err && err.isRetryable)
}
