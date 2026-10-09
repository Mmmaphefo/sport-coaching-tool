// AI assistance: drafted with Qoder (AI coding assistant); reviewed and tested by the project team.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiRequest } from './api'

describe('apiRequest', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mockResponse({ ok = true, status = 200, json = {} }) {
    globalThis.fetch.mockResolvedValue({
      ok,
      status,
      json: vi.fn().mockResolvedValue(json),
    })
  }

  it('sends the request with an auth token and JSON body', async () => {
    mockResponse({ json: { id: 1 } })
    const getToken = vi.fn().mockResolvedValue('test-token')

    await apiRequest('/api/squads/mine', {
      method: 'PATCH',
      body: { name: 'Golden Lions' },
      getToken,
    })

    expect(getToken).toHaveBeenCalledOnce()
    // objectContaining: apiRequest also passes an AbortSignal for the
    // request-timeout guard, which isn't relevant to this assertion.
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:5001/api/squads/mine',
      expect.objectContaining({
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({ name: 'Golden Lions' }),
      })
    )
  })

  it('returns the parsed JSON response', async () => {
    mockResponse({ json: { role: 'coach' } })

    const result = await apiRequest('/api/account/me', { getToken: vi.fn() })

    expect(result).toEqual({ role: 'coach' })
  })

  it('returns null for 204 responses', async () => {
    mockResponse({ status: 204, json: {} })

    const result = await apiRequest('/api/athletes/1', {
      method: 'DELETE',
      getToken: vi.fn(),
    })

    expect(result).toBeNull()
  })

  it('throws the server error message when the request fails', async () => {
    mockResponse({ ok: false, status: 409, json: { error: 'Invite already used' } })

    await expect(
      apiRequest('/api/invites/abc123/accept', { method: 'POST', getToken: vi.fn() })
    ).rejects.toThrow('Invite already used')
  })

  it('falls back to the status code when the error body has no message', async () => {
    mockResponse({ ok: false, status: 500, json: {} })

    await expect(apiRequest('/api/account/me', { getToken: vi.fn() })).rejects.toThrow(
      'Request failed with status 500'
    )
  })

  it('falls back to the status code when the error body is not JSON', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token <')),
    })

    // A write is never retried, so the 502 surfaces straight away.
    await expect(
      apiRequest('/api/account/role', { method: 'PATCH', getToken: vi.fn() })
    ).rejects.toThrow('Request failed with status 502')
  })

  it('retries a GET through a cold start (503) and then succeeds', async () => {
    vi.useFakeTimers()
    try {
      globalThis.fetch
        .mockResolvedValueOnce({ ok: false, status: 503, json: vi.fn().mockResolvedValue({}) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ ok: 1 }) })

      const promise = apiRequest('/api/squads/mine', { getToken: vi.fn() })
      await vi.advanceTimersByTimeAsync(2000)

      await expect(promise).resolves.toEqual({ ok: 1 })
      expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up on a GET after the retry budget and reports the last error', async () => {
    vi.useFakeTimers()
    try {
      globalThis.fetch.mockRejectedValue(new TypeError('Failed to fetch'))

      const promise = apiRequest('/api/squads/mine', { getToken: vi.fn() })
      const assertion = expect(promise).rejects.toMatchObject({ isNetworkError: true })
      await vi.advanceTimersByTimeAsync(2000 + 4000 + 8000)
      await assertion

      expect(globalThis.fetch).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never retries a write, so nothing is applied twice', async () => {
    globalThis.fetch.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(
      apiRequest('/api/athletes', { method: 'POST', body: { name: 'A' }, getToken: vi.fn() })
    ).rejects.toMatchObject({ isNetworkError: true })
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('does not retry a permanent 4xx rejection', async () => {
    mockResponse({ ok: false, status: 404, json: { error: 'Not found' } })

    await expect(apiRequest('/api/squads/mine', { getToken: vi.fn() })).rejects.toThrow('Not found')
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects with a clear error when the auth token never settles', async () => {
    // Regression: Clerk's dev-browser handshake can hang in Safari (blocked
    // third-party storage), leaving buttons disabled forever with no feedback.
    vi.useFakeTimers()
    try {
      const hangingGetToken = vi.fn().mockReturnValue(new Promise(() => {}))
      const promise = apiRequest('/api/account/me', { getToken: hangingGetToken })
      // Attach the rejection handler before the timers run so the throw is
      // never observed as an unhandled rejection in the meantime.
      const assertion = expect(promise).rejects.toThrow('Sign-in verification timed out')

      await vi.advanceTimersByTimeAsync(12000)
      await assertion

      expect(globalThis.fetch).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('asks Clerk for a token on every retry, never reusing an old one', async () => {
    vi.useFakeTimers()
    try {
      globalThis.fetch
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({}) })
      const getToken = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('new')

      const promise = apiRequest('/api/squads/mine', { getToken })
      await vi.advanceTimersByTimeAsync(2000)
      await promise

      expect(getToken).toHaveBeenCalledTimes(2)
      expect(globalThis.fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer new')
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries a 401 once with a freshly minted token', async () => {
    globalThis.fetch
      .mockResolvedValueOnce({ ok: false, status: 401, json: vi.fn().mockResolvedValue({ error: 'expired' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ ok: 1 }) })
    const getToken = vi.fn().mockResolvedValueOnce('stale').mockResolvedValueOnce('fresh')

    await expect(apiRequest('/api/squads/mine', { getToken })).resolves.toEqual({ ok: 1 })
    expect(getToken).toHaveBeenLastCalledWith({ skipCache: true })
    expect(globalThis.fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh')
  })

  it('reports a persistent 401 after the single refresh', async () => {
    mockResponse({ ok: false, status: 401, json: { error: 'You are not signed in.' } })

    await expect(apiRequest('/api/squads/mine', { getToken: vi.fn() })).rejects.toMatchObject({ status: 401 })
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })
})
