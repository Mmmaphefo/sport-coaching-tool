const isTestEnv = process.env.NODE_ENV === 'test'

let clerkMiddleware, requireAuth, getAuth

// Decode a base64url JWT segment without verifying it — used only to report
// which Clerk instance issued a rejected token, never to grant access.
function decodeJwtPart(part) {
  try {
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
  } catch {
    return null
  }
}

// The Clerk Frontend API host a publishable key belongs to, e.g.
// pk_test_YWNlLWxvdXNlLTQ0LmNsZXJrLmFjY291bnRzLmRldiQ -> ace-louse-44.clerk.accounts.dev
function instanceFromPublishableKey(pk) {
  try {
    const encoded = String(pk).split('_')[2]
    return Buffer.from(encoded, 'base64').toString('utf8').replace(/\$$/, '')
  } catch {
    return null
  }
}

// Work out WHY a request was treated as signed out, so a 401 says what to fix
// instead of a generic "session expired". Only public facts are reported:
// the Clerk reason code and the token's issuer host — never key material.
async function diagnoseUnauthenticated(req, verifyToken) {
  const header = req.headers.authorization || ''
  const token = header.replace(/^Bearer\s+/i, '').trim()
  if (!token || token === 'null' || token === 'undefined') {
    return { reason: 'no-token' }
  }

  const parts = token.split('.')
  const payload = parts.length === 3 ? decodeJwtPart(parts[1]) : null
  const issuer = payload?.iss ? String(payload.iss).replace(/^https?:\/\//, '') : null
  const expected = instanceFromPublishableKey(process.env.CLERK_PUBLISHABLE_KEY)

  try {
    await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY })
    return { reason: 'verified-but-rejected', issuer, expected }
  } catch (err) {
    return { reason: err?.reason || 'token-verification-failed', issuer, expected }
  }
}

const HINTS = {
  'no-token': 'This browser did not send a sign-in token. Sign out and sign in again.',
  'token-expired': 'Your sign-in token expired before it reached the server. Please try again.',
  'token-invalid-signature':
    'The server is configured with a different Clerk app than the website (CLERK_SECRET_KEY mismatch).',
  'jwk-kid-mismatch':
    'The server is configured with a different Clerk app than the website (CLERK_SECRET_KEY mismatch).',
  'secret-key-invalid': 'The server’s CLERK_SECRET_KEY is missing or invalid.',
}

if (isTestEnv) {
  clerkMiddleware = () => (req, res, next) => next()
  requireAuth = () => (req, res, next) => next()
  getAuth = (req) => ({
    userId: req.headers['x-test-clerk-user-id'] || 'test_clerk_user',
  })
} else {
  const clerk = require('@clerk/express')
  clerkMiddleware = clerk.clerkMiddleware
  getAuth = clerk.getAuth

  // Clerk's own requireAuth() answers an unauthenticated API call with a 302
  // redirect to "/" on the API host, which the browser follows and reports as
  // a confusing "Request failed with status 404". An API should answer 401
  // JSON instead, with the concrete reason, so the frontend can recover and
  // misconfiguration is obvious. clerkMiddleware() runs first (app.js).
  requireAuth = () => async (req, res, next) => {
    let userId
    try {
      userId = getAuth(req)?.userId
    } catch (err) {
      return next(err)
    }
    if (userId) return next()

    const diag = await diagnoseUnauthenticated(req, clerk.verifyToken).catch(() => ({
      reason: 'unknown',
    }))
    console.warn(
      `401 ${req.method} ${req.originalUrl}: reason=${diag.reason}` +
        (diag.issuer ? ` tokenIssuer=${diag.issuer} expectedIssuer=${diag.expected}` : '')
    )
    const mismatch = diag.issuer && diag.expected && diag.issuer !== diag.expected
    return res.status(401).json({
      error: mismatch
        ? `Sign-in token is from a different Clerk app (${diag.issuer}) than the server expects (${diag.expected}).`
        : HINTS[diag.reason] || 'You are not signed in. Please sign in again.',
      reason: diag.reason,
    })
  }
}

module.exports = { clerkMiddleware, requireAuth, getAuth }
