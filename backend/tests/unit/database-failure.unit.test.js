// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
//
// Resilience contract: when the database is down, every API endpoint must
// answer with a clean JSON error. It must not crash the process, hang, or
// leak internals (stack traces, SQL, connection strings) to the browser.
//
// The routes are discovered from the routers themselves, so a newly added
// endpoint is covered automatically.
import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import request from 'supertest'
import express from 'express'

const require = createRequire(import.meta.url)
const routesDir = path.resolve(__dirname, '../../src/routes')
const pool = require('../../src/db.js')

// Files that are helpers or need a signed external payload, not plain routers.
// health.js is excluded on purpose: it never touches the database, so Render's
// health check and the keep-alive ping keep answering 200 during an outage.
const SKIP = new Set(['_squad.js', 'webhooks.js', 'health.js'])

const app = express()
app.use(express.json())
const endpoints = []
for (const file of readdirSync(routesDir).filter((f) => f.endsWith('.js') && !SKIP.has(f))) {
  // Loaded through Vitest (not a plain require) so these are the same module
  // instances the other tests use, and their coverage is merged, not split.
  const router = (await import(path.join(routesDir, file))).default
  const base = `/api/${file.replace(/\.js$/, '')}`
  app.use(base, router)
  for (const layer of router.stack || []) {
    if (!layer.route) continue
    for (const method of Object.keys(layer.route.methods)) {
      // Fill path parameters with a plausible id / value.
      const url = base + layer.route.path.replace(/:([A-Za-z_]+)/g, (_, name) =>
        name === 'kind' ? 'event' : name === 'token' ? 'tok_1' : '1')
      endpoints.push([method.toUpperCase(), url])
    }
  }
}

// Stack frames, raw SQL (upper-case keywords, so friendly words like
// "Failed to update" don't count), connection strings and socket errors.
const LEAKS = /at .+\(.*:\d+:\d+\)|\b(SELECT|INSERT INTO|UPDATE \w+ SET|DELETE FROM)\b|postgres(ql)?:\/\/|ECONNREFUSED|\d+\.\d+\.\d+\.\d+:\d+/

beforeAll(() => {
  const down = () => Promise.reject(Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), { code: 'ECONNREFUSED' }))
  vi.spyOn(pool, 'query').mockImplementation(down)
  vi.spyOn(pool, 'connect').mockImplementation(down)
  for (const m of ['error', 'warn', 'log']) vi.spyOn(console, m).mockImplementation(() => {})
})

afterAll(() => {
  vi.restoreAllMocks()
})

describe('every endpoint survives a database outage', () => {
  test('the routers expose a meaningful number of endpoints', () => {
    expect(endpoints.length).toBeGreaterThan(40)
  })

  test.each(endpoints)('%s %s answers a clean error', async (method, url) => {
    const query = 'from=2026-01-01&to=2026-12-31&a=1&b=2&location=x&period=7d'
    const res = await request(app)[method.toLowerCase()](`${url}?${query}`)
      .set('x-test-clerk-user-id', 'test_clerk_user')
      .send({ name: 'x', title: 'x', action_type: 'goal', athlete_id: 1, status: 'completed', role: 'coach' })

    // Either the request is rejected before the database (4xx) or the
    // failure is handled (5xx) — never a crash, never a hang.
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(600)
    expect(JSON.stringify(res.body ?? '') + (res.text ?? '')).not.toMatch(LEAKS)
  })
})
