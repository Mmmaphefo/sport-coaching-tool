/* KickStat service worker — the offline half of offline-first logging.
 *
 * What this worker owns:
 *   1. The app shell — index.html plus the hashed /assets/* bundles — so the
 *      app still boots with no connection at all. A coach pitch-side with a
 *      dead signal can open KickStat, reach the live match page, and keep
 *      logging: the queue in src/lib/offlineQueue.js holds their entries
 *      until the signal returns and replays them.
 *   2. Map tiles (Mapbox + the OpenStreetMap fallback), so the venue map
 *      and its pin keep rendering offline.
 *
 * What it deliberately does NOT touch:
 *   - The API on Render and Clerk's auth: every non-GET and every
 *     cross-origin request that isn't a tile passes straight through, so
 *     data is never served stale and the offline queue keeps ownership of
 *     every write.
 *
 * Strategies (kept boring on purpose — a service worker that surprises a
 * running match page is worse than no service worker):
 *   - Navigations: network-first, so a deploy is picked up on the next
 *     load; the served HTML is cached so it stands in when offline.
 *   - Same-origin GETs (hashed bundles, logo/hero images): stale-while-
 *     revalidate — hashed filenames are immutable, so the cached copy is
 *     always safe to serve while a fresh one loads in the background.
 *   - Tiles: cache-first, capped, oldest entries evicted first.
 *
 * There is no build-time precache manifest on purpose: hashed filenames
 * only exist after `vite build`, and a hand-maintained list would drift out
 * of date immediately. The first online visit fills the caches through
 * normal traffic instead — after one online load, the app works offline.
 *
 * Updates wait their turn: a newly installed worker takes over only once
 * every KickStat tab has closed (no automatic skipWaiting — swapping asset
 * bundles under an open live-match page is riskier than serving one
 * version a little longer).
 */

const SHELL_CACHE = 'kickstat-shell-v1'
const TILE_CACHE = 'kickstat-tiles-v1'
const CURRENT_CACHES = [SHELL_CACHE, TILE_CACHE]

// Tiles are ~10-40KB each; 250 covers a city's worth of pitch hunting
// while keeping the storage footprint predictable.
const TILE_CACHE_LIMIT = 250

function isTileRequest(url) {
  if (url.hostname === 'tile.openstreetmap.org') return true
  // Mapbox serves both tiles (/styles/v1/.../tiles/...) and geocoding
  // (/geocoding/v5/...) from api.mapbox.com — only the tiles may be cached;
  // geocode results must never be served stale.
  return url.hostname === 'api.mapbox.com' && url.pathname.includes('/tiles/')
}

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Writes are never cached — the offline queue owns offline writes.
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return

  if (isTileRequest(url)) {
    event.respondWith(cacheFirstTile(event))
    return
  }

  // Everything cross-origin that isn't a tile (the API, Clerk, Mapbox
  // geocoding) is none of this worker's business.
  if (url.origin !== self.location.origin) return

  // The worker's own script must pass through untouched: the browser's
  // update check is the one fetch that should never be served from a cache.
  if (url.pathname === '/sw.js') return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(event))
    return
  }

  event.respondWith(staleWhileRevalidate(event))
})

// Network-first for the document itself: deploys are noticed on the next
// load, and the served HTML is kept so an offline reload still boots the
// app — the router then resolves the deep link client-side.
async function networkFirstShell(event) {
  const { request } = event
  try {
    const fresh = await fetch(request)
    if (fresh && fresh.ok) {
      const cache = await caches.open(SHELL_CACHE)
      // Keep the document under its own URL …
      await cache.put(request, fresh.clone())
      // … and under '/', so a deep link opened offline falls back to the
      // last-served shell instead of the stub page below.
      await cache.put('/', fresh.clone())
    }
    return fresh
  } catch {
    const cache = await caches.open(SHELL_CACHE)
    const cached =
      (await cache.match(request)) ||
      (await cache.match('/')) ||
      (await cache.match('/index.html'))
    return cached || offlineStub()
  }
}

// Stale-while-revalidate for hashed bundles and public files: filenames
// are content-hashed, so serving the cached copy is always correct while
// the fresh one loads in the background.
async function staleWhileRevalidate(event) {
  const { request } = event
  const cache = await caches.open(SHELL_CACHE)
  const cached = await cache.match(request)

  const refresh = fetch(request).then((fresh) => {
    if (fresh && fresh.ok) cache.put(request, fresh.clone())
    return fresh
  })

  if (cached) {
    event.waitUntil(refresh.catch(() => {}))
    return cached
  }
  return refresh
}

// Cache-first for tiles: they never change, and pitch-side usage is
// exactly when the connection is weakest.
async function cacheFirstTile(event) {
  const { request } = event
  const cache = await caches.open(TILE_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached

  const fresh = await fetch(request)
  // Mapbox tiles are fetched as plain images, so they can arrive as opaque
  // cross-origin responses (status 0) — still safe to cache and replay.
  if (fresh && (fresh.ok || fresh.type === 'opaque')) {
    await trimTiles(cache)
    await cache.put(request, fresh.clone())
  }
  return fresh
}

// Keeps the tile cache under TILE_CACHE_LIMIT by evicting the
// longest-cached entries first (Cache keys come back oldest-first).
async function trimTiles(cache) {
  const keys = await cache.keys()
  const excess = keys.length - TILE_CACHE_LIMIT + 1
  for (let i = 0; i < excess; i += 1) {
    await cache.delete(keys[i])
  }
}

// Absolute last resort: the app has never loaded on this device while
// online. One online visit is all it takes to never see this again.
function offlineStub() {
  return new Response(
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<title>KickStat — offline</title>' +
      '<style>body{background:#0B1B33;color:#D0FF41;font:16px/1.6 system-ui;padding:40px;max-width:480px}' +
      'h1{color:#fff;font-size:20px}</style></head><body>' +
      '<h1>KickStat is not cached on this device yet</h1>' +
      '<p>Connect to the internet once and reload — after that, KickStat keeps working offline, and match logging queues until the signal returns.</p>' +
      '</body></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

// Cache versions from previous deploys are dropped on activation.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((name) => !CURRENT_CACHES.includes(name))
          .map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

// Manual escape hatch: a future "Update now" button can post this message
// to make a waiting worker take over immediately. Nothing sends it yet —
// see the header comment for why updates otherwise wait their turn.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})
