// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
//
// The production branch of middleware/auth.js (real Clerk) never runs in the
// integration tests, which use the NODE_ENV=test stand-in. These tests load
// the production branch with a fake @clerk/express so the 401 diagnostics —
// which caught the Oct 9 Clerk key mismatch — stay correct.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const authPath = require.resolve('../../src/middleware/auth.js')
const clerkPath = require.resolve('@clerk/express')

// ace-louse-44.clerk.accounts.dev, the instance the website uses.
const PK = 'pk_test_YWNlLWxvdXNlLTQ0LmNsZXJrLmFjY291bnRzLmRldiQ'

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
const jwt = (payload) => `${b64url({ alg: 'RS256' })}.${b64url(payload)}.sig`

let fakeClerk
let saved

function loadProductionAuth() {
  delete require.cache[authPath]
  require.cache[clerkPath] = { id: clerkPath, filename: clerkPath, loaded: true, exports: fakeClerk }
  return require(authPath)
}

function mockRes() {
  const res = { statusCode: 200, body: null }
  res.status = vi.fn((code) => { res.statusCode = code; return res })
  res.json = vi.fn((body) => { res.body = body; return res })
  return res
}

async function run(middleware, req) {
  const res = mockRes()
  const next = vi.fn()
  await middleware(req, res, next)
  return { res, next }
}

beforeEach(() => {
  saved = {
    NODE_ENV: process.env.NODE_ENV,
    CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY,
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    cached: require.cache[clerkPath],
  }
  process.env.NODE_ENV = 'production'
  process.env.CLERK_PUBLISHABLE_KEY = PK
  process.env.CLERK_SECRET_KEY = 'sk_test_x'
  fakeClerk = {
    clerkMiddleware: vi.fn(() => (req, res, next) => next()),
    getAuth: vi.fn(() => ({ userId: null })),
    verifyToken: vi.fn(async () => {
      throw Object.assign(new Error('bad'), { reason: 'token-invalid-signature' })
    }),
  }
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  for (const key of ['NODE_ENV', 'CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY']) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  if (saved.cached) require.cache[clerkPath] = saved.cached
  else delete require.cache[clerkPath]
  delete require.cache[authPath]
  vi.restoreAllMocks()
})

describe('production requireAuth', () => {
  test('passes a signed-in request through', async () => {
    fakeClerk.getAuth.mockReturnValue({ userId: 'user_1' })
    const { requireAuth } = loadProductionAuth()
    const { res, next } = await run(requireAuth(), { headers: {} })
    expect(next).toHaveBeenCalledWith()
    expect(res.status).not.toHaveBeenCalled()
  })

  test('answers 401 JSON (not a redirect) when no token is sent', async () => {
    const { requireAuth } = loadProductionAuth()
    for (const authorization of [undefined, 'Bearer null', 'Bearer undefined', 'Bearer ']) {
      const { res, next } = await run(requireAuth(), { method: 'GET', originalUrl: '/x', headers: { authorization } })
      expect(next).not.toHaveBeenCalled()
      expect(res.statusCode).toBe(401)
      expect(res.body.reason).toBe('no-token')
    }
  })

  test('names a Clerk app mismatch between website and server', async () => {
    const { requireAuth } = loadProductionAuth()
    const token = jwt({ iss: 'https://other-app-12.clerk.accounts.dev', sub: 'user_1' })
    const { res } = await run(requireAuth(), { method: 'GET', originalUrl: '/x', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(401)
    expect(res.body.error).toContain('other-app-12.clerk.accounts.dev')
    expect(res.body.error).toContain('ace-louse-44.clerk.accounts.dev')
  })

  test('explains a key mismatch from the verification reason when issuers match', async () => {
    const { requireAuth } = loadProductionAuth()
    const token = jwt({ iss: 'https://ace-louse-44.clerk.accounts.dev', sub: 'user_1' })
    const { res } = await run(requireAuth(), { method: 'GET', originalUrl: '/x', headers: { authorization: `Bearer ${token}` } })
    expect(res.body).toMatchObject({ reason: 'token-invalid-signature' })
    expect(res.body.error).toMatch(/CLERK_SECRET_KEY/)
  })

  test('reports an expired token', async () => {
    fakeClerk.verifyToken.mockRejectedValue(Object.assign(new Error('exp'), { reason: 'token-expired' }))
    const { requireAuth } = loadProductionAuth()
    const token = jwt({ iss: 'https://ace-louse-44.clerk.accounts.dev' })
    const { res } = await run(requireAuth(), { method: 'GET', originalUrl: '/x', headers: { authorization: `Bearer ${token}` } })
    expect(res.body.reason).toBe('token-expired')
    expect(res.body.error).toMatch(/expired/)
  })

  test('handles a malformed token and an unknown failure reason', async () => {
    fakeClerk.verifyToken.mockRejectedValue(new Error('weird'))
    const { requireAuth } = loadProductionAuth()
    const { res } = await run(requireAuth(), { method: 'GET', originalUrl: '/x', headers: { authorization: 'Bearer not-a-jwt' } })
    expect(res.statusCode).toBe(401)
    expect(res.body.reason).toBe('token-verification-failed')
    expect(res.body.error).toMatch(/not signed in/)
  })

  test('a token Clerk verifies but the session rejects is still a 401', async () => {
    fakeClerk.verifyToken.mockResolvedValue({ sub: 'user_1' })
    const { requireAuth } = loadProductionAuth()
    const token = jwt({ iss: 'https://ace-louse-44.clerk.accounts.dev' })
    const { res } = await run(requireAuth(), { method: 'GET', originalUrl: '/x', headers: { authorization: `Bearer ${token}` } })
    expect(res.body.reason).toBe('verified-but-rejected')
  })

  test('passes unexpected Clerk errors to the error handler', async () => {
    const boom = new Error('clerk down')
    fakeClerk.getAuth.mockImplementation(() => { throw boom })
    const { requireAuth } = loadProductionAuth()
    const { next } = await run(requireAuth(), { headers: {} })
    expect(next).toHaveBeenCalledWith(boom)
  })

  test('exports the real Clerk middleware and getAuth in production', () => {
    const auth = loadProductionAuth()
    expect(auth.clerkMiddleware).toBe(fakeClerk.clerkMiddleware)
    expect(auth.getAuth).toBe(fakeClerk.getAuth)
  })
})
