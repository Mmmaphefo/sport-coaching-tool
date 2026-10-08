// AI assistance: drafted with Claude (Sonnet 5) via claude.ai; reviewed and tested by the project team.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerSW } from './registerSW'

// jsdom has no serviceWorker API — each test installs a fake as an own
// property on navigator and the afterEach deletes it again.
function installServiceWorkerApi({ register, controller = null } = {}) {
  const api = { register, controller }
  Object.defineProperty(window.navigator, 'serviceWorker', { configurable: true, value: api })
  return api
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  delete window.navigator.serviceWorker
  vi.restoreAllMocks()
})

describe('registerSW', () => {
  it('never registers in dev', async () => {
    const register = vi.fn()
    installServiceWorkerApi({ register })

    await registerSW({ enabled: false })

    expect(register).not.toHaveBeenCalled()
  })

  it('is a no-op on browsers without service worker support', async () => {
    // navigator.serviceWorker is left undefined, as in jsdom.
    await expect(registerSW({ enabled: true })).resolves.toBe(null)
  })

  it('registers /sw.js at the root scope in production', async () => {
    const registration = { addEventListener: vi.fn() }
    const register = vi.fn().mockResolvedValue(registration)
    installServiceWorkerApi({ register })

    const result = await registerSW({ enabled: true })

    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' })
    expect(result).toBe(registration)
  })

  it('swallows registration failures so the app still boots', async () => {
    const register = vi.fn().mockRejectedValue(new Error('The operation is insecure'))
    installServiceWorkerApi({ register })

    await expect(registerSW({ enabled: true })).resolves.toBe(null)
    expect(console.warn).toHaveBeenCalledWith(
      '[sw] Service worker registration failed:',
      'The operation is insecure',
    )
  })

  it('explains in the console when an update is installed but still waiting', async () => {
    const regHandlers = {}
    const workerHandlers = {}
    const worker = {
      state: 'installing',
      addEventListener: (type, handler) => { workerHandlers[type] = handler },
    }
    const registration = {
      addEventListener: (type, handler) => { regHandlers[type] = handler },
      get installing() { return worker },
    }
    installServiceWorkerApi({ register: vi.fn().mockResolvedValue(registration), controller: {} })

    await registerSW({ enabled: true })

    // A deploy lands: the browser installs the new worker while this tab
    // still runs the old one.
    regHandlers.updatefound()
    worker.state = 'installed'
    workerHandlers.statechange()

    expect(console.info).toHaveBeenCalledWith(
      '[sw] A new version of KickStat is ready — it takes over once all KickStat tabs are closed.',
    )
  })
})
