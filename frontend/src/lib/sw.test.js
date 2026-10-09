// AI assistance: drafted with Claude (Sonnet 5) via claude.ai; reviewed and tested by the project team.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Vitest runs with the frontend root as the working directory (locally and
// in CI alike), which is the anchor for reading the shipped public/ files.
// import.meta.url is an HTTP URL under vitest, so it can't be used here.
const frontendRoot = process.cwd()
const publicDir = resolve(frontendRoot, 'public')

const ORIGIN = 'https://kickstat.pages.dev'
const SHELL = 'kickstat-shell-v1'
const TILES = 'kickstat-tiles-v1'

// public/sw.js is a classic service-worker script, not an app module, so it
// can't just be imported: it is evaluated against stubbed worker globals
// (self/caches/fetch/Response) and driven through synthetic fetch events.
// That exercises the real shipped file — strategies, pass-throughs, cache
// versioning — without a browser.
let listeners
let cacheStore
let fetchMock

function makeResponse({ ok = true, status = 200, type = 'basic' } = {}) {
  const res = { ok, status, type, headers: new Map() }
  res.clone = () => makeResponse({ ok, status, type })
  return res
}

function makeCache() {
  const store = new Map()
  const key = (k) => (typeof k === 'string' ? k : k.url)
  return {
    store,
    match: async (k) => store.get(key(k)) || null,
    put: vi.fn(async (k, res) => { store.set(key(k), res) }),
    delete: vi.fn(async (k) => store.delete(key(k))),
    keys: async () => [...store.keys()].map((url) => ({ url })),
  }
}

function makeRequest(url, { method = 'GET', mode = 'navigate' } = {}) {
  return { url, method, mode }
}

function makeEvent(request) {
  const responded = []
  const waited = []
  return {
    request,
    responded,
    waited,
    respondWith: (p) => responded.push(p),
    waitUntil: (p) => waited.push(p),
  }
}

// Response stub used only by the offline stub page (sw.js constructs a real
// Response for it; the stub keeps the same surface the worker touches).
class StubResponse {
  constructor(body, init = {}) {
    this.body = body
    this.status = 200
    this.ok = true
    this.headers = new Map(Object.entries(init.headers || {}))
  }
}

function loadWorker() {
  listeners = {}
  cacheStore = new Map([
    [SHELL, makeCache()],
    [TILES, makeCache()],
  ])
  const selfMock = {
    addEventListener: (type, handler) => { listeners[type] = handler },
    location: { origin: ORIGIN },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  }
  const cachesMock = {
    open: async (name) => {
      if (!cacheStore.has(name)) cacheStore.set(name, makeCache())
      return cacheStore.get(name)
    },
    keys: async () => [...cacheStore.keys()],
    delete: async (name) => cacheStore.delete(name),
  }
  fetchMock = vi.fn()

  vi.stubGlobal('self', selfMock)
  vi.stubGlobal('caches', cachesMock)
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('Response', StubResponse)

  const source = readFileSync(resolve(publicDir, 'sw.js'), 'utf8')
  // The worker script only touches the four globals stubbed above; the
  // function parameters keep it from ever reaching the test realm's own.
  new Function('self', 'caches', 'fetch', 'Response', source)(selfMock, cachesMock, fetchMock, StubResponse)
  return selfMock
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('service worker (public/sw.js)', () => {
  it('serves navigations network-first and caches the served document', async () => {
    loadWorker()
    const net = makeResponse()
    fetchMock.mockResolvedValue(net)

    const event = makeEvent(makeRequest(`${ORIGIN}/events/5`))
    listeners.fetch(event)

    await expect(event.responded[0]).resolves.toBe(net)
    const shell = cacheStore.get(SHELL)
    // Stored under the visited URL and under '/' for offline deep links.
    expect(shell.store.has(`${ORIGIN}/events/5`)).toBe(true)
    expect(shell.store.has('/')).toBe(true)
    // Tiles stay out of the shell cache.
    expect(cacheStore.get(TILES).store.size).toBe(0)
  })

  it('falls back to the cached shell when offline, deep links included', async () => {
    loadWorker()
    fetchMock.mockRejectedValue(new Error('offline'))
    const shell = cacheStore.get(SHELL)
    const served = makeResponse()
    shell.store.set('/', served)

    const event = makeEvent(makeRequest(`${ORIGIN}/live/5`))
    listeners.fetch(event)

    await expect(event.responded[0]).resolves.toBe(served)
  })

  it('serves an offline stub page when nothing was ever cached', async () => {
    loadWorker()
    fetchMock.mockRejectedValue(new Error('offline'))

    const event = makeEvent(makeRequest(`${ORIGIN}/`))
    listeners.fetch(event)

    const stub = await event.responded[0]
    expect(stub.body).toContain('not cached on this device yet')
    expect(stub.headers.get('Content-Type')).toContain('text/html')
  })

  it('never touches cross-origin requests or non-GET methods', () => {
    loadWorker()

    const cases = [
      makeRequest('https://api.kickstat.onrender.com/api/events', { mode: 'cors' }),
      makeRequest('https://clerk.kickstat.com/v1/client', { mode: 'cors' }),
      makeRequest(`${ORIGIN}/api/anything`, { method: 'POST', mode: 'cors' }),
      // Geocoding shares api.mapbox.com with tiles — it must pass through.
      makeRequest('https://api.mapbox.com/geocoding/v5/mapbox.places/wits.json?access_token=pk', { mode: 'cors' }),
    ]
    for (const request of cases) {
      const event = makeEvent(request)
      listeners.fetch(event)
      expect(event.responded, request.url).toHaveLength(0)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes its own script through untouched', () => {
    loadWorker()

    const event = makeEvent(makeRequest(`${ORIGIN}/sw.js`))
    listeners.fetch(event)

    expect(event.responded).toHaveLength(0)
  })

  it('serves hashed assets stale-while-revalidate', async () => {
    loadWorker()
    const url = `${ORIGIN}/assets/index-abc123.js`
    const net = makeResponse()
    fetchMock.mockResolvedValueOnce(net)

    const first = makeEvent(makeRequest(url, { mode: 'cors' }))
    listeners.fetch(first)
    await expect(first.responded[0]).resolves.toBe(net)
    const shell = cacheStore.get(SHELL)
    expect(shell.store.has(url)).toBe(true)

    // Offline afterwards: the cached copy still serves, and the background
    // refresh failure is contained instead of failing the load.
    fetchMock.mockRejectedValue(new Error('offline'))
    const second = makeEvent(makeRequest(url, { mode: 'cors' }))
    listeners.fetch(second)
    await expect(second.responded[0]).resolves.toBe(shell.store.get(url))
    // The failed revalidation was parked on waitUntil, not thrown.
    await Promise.all(second.waited).catch(() => {})
  })

  it('caches map tiles cache-first, including opaque cross-origin ones', async () => {
    loadWorker()
    const url = 'https://api.mapbox.com/styles/v1/mapbox/navigation-night-v1/tiles/13/4205/2626@2x?access_token=pk.test'
    // Plain <img> tiles arrive as opaque responses (status 0) — still
    // cacheable and replayable.
    const tile = makeResponse({ ok: false, status: 0, type: 'opaque' })
    fetchMock.mockResolvedValueOnce(tile)

    const first = makeEvent(makeRequest(url, { mode: 'no-cors' }))
    listeners.fetch(first)
    await expect(first.responded[0]).resolves.toBe(tile)
    const stored = cacheStore.get(TILES).store.get(url)
    expect(stored).toBeTruthy()

    // Second hit comes from the cache; the network is never asked.
    fetchMock.mockClear()
    const second = makeEvent(makeRequest(url, { mode: 'no-cors' }))
    listeners.fetch(second)
    await expect(second.responded[0]).resolves.toBe(stored)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('evicts the oldest tiles once the cache passes its cap', async () => {
    loadWorker()
    const tiles = cacheStore.get(TILES)
    for (let i = 0; i < 250; i += 1) {
      tiles.store.set(`https://tile.openstreetmap.org/12/i/${i}.png`, makeResponse())
    }
    fetchMock.mockResolvedValue(makeResponse())

    const event = makeEvent(makeRequest('https://tile.openstreetmap.org/12/0/0.png', { mode: 'no-cors' }))
    listeners.fetch(event)
    await event.responded[0]

    // The longest-cached tile was evicted to make room for the new one.
    expect(tiles.store.has('https://tile.openstreetmap.org/12/i/0.png')).toBe(false)
    expect(tiles.store.has('https://tile.openstreetmap.org/12/0/0.png')).toBe(true)
    expect(tiles.store.size).toBe(250)
  })

  it('drops old cache versions on activate and claims existing clients', async () => {
    const selfMock = loadWorker()
    cacheStore.set('kickstat-shell-v0', makeCache())
    cacheStore.set('someone-elses-cache', makeCache())

    const waited = []
    listeners.activate({ waitUntil: (p) => waited.push(p) })
    await Promise.all(waited)

    expect(cacheStore.has('kickstat-shell-v0')).toBe(false)
    expect(cacheStore.has('someone-elses-cache')).toBe(false)
    expect(cacheStore.has(SHELL)).toBe(true)
    expect(cacheStore.has(TILES)).toBe(true)
    expect(selfMock.clients.claim).toHaveBeenCalled()
  })

  it('only skips waiting when explicitly asked', () => {
    const selfMock = loadWorker()

    listeners.message({ data: 'SKIP_WAITING' })
    expect(selfMock.skipWaiting).toHaveBeenCalled()

    listeners.message({ data: 'anything-else' })
    expect(selfMock.skipWaiting).toHaveBeenCalledTimes(1)
  })
})

describe('offline install (manifest + shell wiring)', () => {
  it('points only at icon files that actually ship in public/', () => {
    const manifest = JSON.parse(readFileSync(resolve(publicDir, 'manifest.webmanifest'), 'utf8'))

    expect(manifest.start_url).toBe('/')
    expect(manifest.scope).toBe('/')
    expect(manifest.display).toBe('standalone')
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2)
    expect(new Set(manifest.icons.map((i) => i.purpose))).toContain('maskable')
    for (const icon of manifest.icons) {
      expect(existsSync(resolve(publicDir, `.${icon.src}`)), `${icon.src} must exist in public/`).toBe(true)
    }
  })

  it('links the manifest and theme colour from index.html', () => {
    const html = readFileSync(resolve(frontendRoot, 'index.html'), 'utf8')
    expect(html).toContain('href="/manifest.webmanifest"')
    expect(html).toContain('name="theme-color"')
  })
})
