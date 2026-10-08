import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import { pool, resetDatabase } from './setup'

import weatherRouter from '../../src/routes/weather'

const app = express()
app.use(express.json())
app.use('/api/weather', weatherRouter)

beforeAll(async () => {
  try {
    await pool.query('SELECT 1')
  } catch (err) {
    throw new Error(
      'Could not reach the test database. Create it and run migrations against it first.\n' +
        `Original error: ${err.message}`,
      { cause: err }
    )
  }
  await resetDatabase()
})

afterAll(async () => {
  await pool.end()
})

describe('US18 — venue weather forecast', () => {
  test(
    'AC: a real venue name returns current weather from a public weather API',
    async () => {
      const res = await request(app)
        .get('/api/weather')
        .query({ location: 'Johannesburg' })
        .set('x-test-clerk-user-id', 'test_clerk_user')

      // If the third-party service is temporarily unreachable from the CI
      // runner, skip rather than fail — the route already returns 503.
      if (res.status === 503) {
        console.warn('Open-Meteo unavailable in CI — skipping live weather test')
        return
      }

      expect(res.status).toBe(200)
      expect(res.body.resolvedLocation).toMatch(/Johannesburg/i)
      expect(typeof res.body.current.temperatureC).toBe('number')
      expect(typeof res.body.current.description).toBe('string')
      expect(Array.isArray(res.body.daily)).toBe(true)
      expect(res.body.daily.length).toBeGreaterThan(0)
    },
    15000
  )

  test('rejects a request with no location', async () => {
    const res = await request(app)
      .get('/api/weather')
      .set('x-test-clerk-user-id', 'test_clerk_user')

    expect(res.status).toBe(400)
  })

  test('a pinned venue map point skips geocoding and keeps the venue name', async () => {
    const res = await request(app)
      .get('/api/weather')
      .query({ location: 'Main Oval', lat: -26.2041, lng: 28.0473 })
      .set('x-test-clerk-user-id', 'test_clerk_user')

    // If Open-Meteo is unreachable, skip rather than fail.
    if (res.status === 503) {
      console.warn('Open-Meteo unavailable in CI — skipping pinned weather test')
      return
    }

    expect(res.status).toBe(200)
    // The name the coach saved, not the geocoder's nearest town.
    expect(res.body.resolvedLocation).toBe('Main Oval')
    expect(res.body.latitude).toBeCloseTo(-26.2041, 4)
    expect(res.body.longitude).toBeCloseTo(28.0473, 4)
    expect(typeof res.body.current.temperatureC).toBe('number')
  })

  test('coordinates alone still return a forecast', async () => {
    const res = await request(app)
      .get('/api/weather')
      .query({ lat: -26.2041, lng: 28.0473 })
      .set('x-test-clerk-user-id', 'test_clerk_user')

    if (res.status === 503) {
      console.warn('Open-Meteo unavailable in CI — skipping pinned weather test')
      return
    }

    expect(res.status).toBe(200)
    expect(res.body.resolvedLocation).toBe('Pinned location')
  })

  test('returns 404 for a location that cannot be resolved', async () => {
    const res = await request(app)
      .get('/api/weather')
      .query({ location: 'zzzznotarealplacezzzz123' })
      .set('x-test-clerk-user-id', 'test_clerk_user')

    // If Open-Meteo is unreachable, skip rather than fail.
    if (res.status === 503) {
      console.warn('Open-Meteo unavailable in CI — skipping 404 weather test')
      return
    }

    expect(res.status).toBe(404)
  })
})
