// Registers the offline-shell service worker (public/sw.js).
//
// Production only: a caching worker under `vite dev` serves stale bundles
// against the HMR pipeline and makes local development miserable, so dev
// never registers one. Registration failures are logged and swallowed —
// offline support degrades, the app itself must not.
export function registerSW({ enabled = import.meta.env.PROD } = {}) {
  if (!enabled) return Promise.resolve(null)
  if (!('serviceWorker' in navigator)) return Promise.resolve(null)

  return navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((registration) => {
      // A new deploy byte-diffs sw.js and the browser installs the new
      // worker — which then waits (by design, see public/sw.js) for every
      // KickStat tab to close before taking over. Say so in the console
      // instead of leaving anyone wondering why an update isn't live yet.
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            console.info(
              '[sw] A new version of KickStat is ready — it takes over once all KickStat tabs are closed.',
            )
          }
        })
      })
      return registration
    })
    .catch((err) => {
      console.warn('[sw] Service worker registration failed:', err?.message || err)
      return null
    })
}
