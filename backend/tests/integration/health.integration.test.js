// AI assistance: drafted with Claude (Sonnet 5) via claude.ai; reviewed and tested by the project team.
import { describe, test, expect } from 'vitest'
import request from 'supertest'
import express from 'express'
import healthRouter from '../../src/routes/health'

// No ./setup import on purpose: /api/health is deliberately database-free
// (a cheap liveness signal for Render's deploy health check and the
// keepalive ping — see routes/health.js), so this suite needs no Postgres
// and runs even where the rest of the integration suite cannot.
const app = express()
app.use('/api/health', healthRouter)

describe('GET /api/health', () => {
  test('answers 200 { status: "ok" } without authentication', async () => {
    const res = await request(app).get('/api/health')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })
})
