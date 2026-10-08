require('dotenv').config()
const { Pool } = require('pg')
// Prefer TEST_DATABASE_URL if a dev has set one explicitly. Otherwise, fall
// back to DATABASE_URL — which CI already sets correctly to the Postgres
// service container's connection string, so this makes the same setup.js
// work in both CI and local dev without any CI-specific configuration.
// Only if neither is set at all does this fall back to the current local
// PostgreSQL user, so developers do not depend on another person's account.
const localTestDatabaseUser = encodeURIComponent(
  process.env.PGUSER || process.env.USER || 'postgres'
)
const localTestDatabaseUrl = `postgresql://${localTestDatabaseUser}@localhost:5432/sportcoach_test`

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || localTestDatabaseUrl

// Route files read process.env.DATABASE_URL at import time to build their
// own Pool — setting it here (before any route file is imported) redirects
// them at the test database instead of whatever it was pointed at before.
process.env.DATABASE_URL = TEST_DATABASE_URL

// connectionTimeoutMillis: on CI the Postgres service lives on a per-job
// docker network; a stalled connect would otherwise hang until the hook
// timeout with no hint of the cause. Fail fast with a clear error instead.
const pool = new Pool({
  connectionString: TEST_DATABASE_URL,
  connectionTimeoutMillis: 15000,
})

async function resetDatabase() {
  await pool.query(
    'TRUNCATE player_ratings, log_entries, events, invites, athletes, squads, users RESTART IDENTITY CASCADE'
  )
}

async function seedCoach(clerkId = 'test_clerk_user') {
  // Idempotent: if a previous (possibly timed-out) hook's insert lands
  // between this seed's TRUNCATE and this INSERT, ON CONFLICT reuses the
  // existing rows instead of crashing with a duplicate-key error.
  const userResult = await pool.query(
    "INSERT INTO users (clerk_id, role) VALUES ($1, 'coach') " +
      'ON CONFLICT (clerk_id) DO UPDATE SET role = EXCLUDED.role RETURNING id',
    [clerkId]
  )
  const userId = userResult.rows[0].id

  const squadResult = await pool.query(
    "INSERT INTO squads (coach_id, name) VALUES ($1, 'Test Squad') " +
      'ON CONFLICT (coach_id) DO UPDATE SET name = EXCLUDED.name RETURNING id',
    [userId]
  )

  return { userId, squadId: squadResult.rows[0].id }
}

// Marks athletes as available for an event — the rows the Saturday
// availability gate reads before a match may go live. Tests that start a
// match (via PATCH, a lineup save, or the auto-start sweep) call this with
// enough players to clear the squad's minimum.
async function seedAvailability(eventId, athletes, status = 'available') {
  for (const athlete of athletes) {
    await pool.query(
      `INSERT INTO event_rsvps (event_id, athlete_id, status)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id, athlete_id) DO UPDATE SET status = EXCLUDED.status`,
      [eventId, athlete.id, status]
    )
  }
}

module.exports = { pool, resetDatabase, seedCoach, seedAvailability }
