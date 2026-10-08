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

export async function apiRequest(path, { method = 'GET', body, getToken } = {}) {
  let token
  try {
    token = await withTimeout(
      Promise.resolve().then(() => getToken()),
      TOKEN_TIMEOUT_MS,
      'Sign-in verification timed out. Please refresh the page and try again.'
    )
  } catch (err) {
    // A failed token fetch usually means we're effectively offline, so this
    // is reported as a network error — queued actions are kept, not dropped.
    throw requestError(err.message, { cause: err })
  }

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
      throw requestError('The server took too long to respond. Please try again.', { cause: err })
    }
    throw requestError('Could not reach the server. Is the backend running?', { cause: err })
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

// Downloads a file (CSV/PDF report) that needs the Authorization header, so a
// plain <a href> won't do. Streams the response into a blob and triggers a
// save-as using the server's Content-Disposition filename when present.
export async function apiDownload(path, { getToken, filename } = {}) {
  const token = await getToken()

  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}))
    throw new Error(errorBody.error || `Download failed with status ${res.status}`)
  }

  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition') || ''
  const match = disposition.match(/filename="?([^";]+)"?/)
  const name = filename || (match ? match[1] : 'download')

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
// True when the failure is worth retrying later (offline / server down).
export function isRetryableError(err) {
  return Boolean(err && err.isRetryable)
}
