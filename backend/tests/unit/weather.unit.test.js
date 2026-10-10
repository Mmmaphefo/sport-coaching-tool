// AI assistance: drafted with Claude (Opus 5.5) via claude.ai; reviewed and tested by the project team.
//
// The weather route against a fake Open-Meteo, so the failure paths (service
// down, error responses, rate limiting) are tested without the network.
// Each test uses its own coordinates/location because the route caches.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import weatherRouter from '../../src/routes/weather'

const app = express()
app.use('/api/weather', weatherRouter)

const forecast = {
  current_weather: { temperature: 18.4, windspeed: 12, weathercode: 61, time: '2026-10-10T12:00' },
  daily: {
    time: ['2026-10-10', '2026-10-11', '2026-10-12'],
    temperature_2m_max: [20, 21, 22],
    temperature_2m_min: [10, 11, 12],
    weathercode: [61, 3, 0],
    precipitation_probability_max: [80, 20, 0],
  },
}
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

let n = 0
const coords = () => { n += 1; return `lat=${(-33 - n / 100).toFixed(2)}&lng=${(18 + n / 100).toFixed(2)}` }

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('GET /api/weather with a fake weather service', () => {
  test('returns the current weather and a three-day forecast', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(forecast)))
    const res = await request(app).get(`/api/weather?${coords()}&location=Wits`)
    expect(res.status).toBe(200)
    expect(JSON.stringify(res.body)).toContain('18')
    expect(res.body.daily).toHaveLength(3)
  })

  test('serves a repeat request for the same place from the cache', async () => {
    const fetch = vi.fn(async () => json(forecast))
    vi.stubGlobal('fetch', fetch)
    const where = coords()
    await request(app).get(`/api/weather?${where}`)
    await request(app).get(`/api/weather?${where}`)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test('falls back to placeholder weather when rate-limited', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 429)))
    const res = await request(app).get(`/api/weather?${coords()}`)
    expect(res.status).toBe(200)
    expect(res.body.daily).toHaveLength(3)
  })

  test('reports the service as unavailable on an error response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 500)))
    const res = await request(app).get(`/api/weather?${coords()}`)
    expect(res.status).toBe(503)
  })

  test('reports the service as unavailable when it cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const res = await request(app).get(`/api/weather?${coords()}`)
    expect(res.status).toBe(503)
  })

  test('geocodes a typed location, then fetches its forecast', async () => {
    const fetch = vi.fn(async (url) =>
      String(url).includes('geocoding')
        ? json({ results: [{ name: 'Braamfontein', latitude: -26.19, longitude: 28.03, country: 'South Africa' }] })
        : json(forecast)
    )
    vi.stubGlobal('fetch', fetch)
    const res = await request(app).get('/api/weather?location=Braamfontein%20test%201')
    expect(res.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  test('404s a location the geocoder cannot find', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ results: [] })))
    expect((await request(app).get('/api/weather?location=Nowhere%20test%202')).status).toBe(404)
  })

  test('503s when the geocoder errors or is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 500)))
    expect((await request(app).get('/api/weather?location=Somewhere%20test%203')).status).toBe(503)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    expect((await request(app).get('/api/weather?location=Somewhere%20test%204')).status).toBe(503)
  })

  test('requires a location or coordinates', async () => {
    expect((await request(app).get('/api/weather')).status).toBe(400)
    expect((await request(app).get('/api/weather?lat=999&lng=0')).status).toBe(400)
  })
})
