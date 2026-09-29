// Email → invite → role linking. KickStat decides what a signed-in account
// is (coach / assistant / athlete) from the email it uses: invites are the
// only way a role/squad gets assigned outside plain coach signup, and every
// invite is addressed to an email. So when an account's email matches a
// pending invite, the account inherits that invite's role and squad.
//
// This is what makes the player flow work end-to-end: the coach creates a
// Clerk account (with a generated password) for a player, the player signs
// in with it directly instead of clicking the invite link, and the login
// reconcile in _squad.js still finds the invite by email and links them as
// an athlete — never as a default coach.

// Test seam: NODE_ENV=test has no Clerk, so integration tests register the
// email a given fake Clerk id should resolve to. The map lives on globalThis
// because Vitest can load this module twice (the route files reach it via
// native require, the test via the transformed import graph) — both copies
// must share one map or registrations from the test are invisible to routes.
const testEmails =
  globalThis.__kickstatTestClerkEmails || (globalThis.__kickstatTestClerkEmails = new Map())

function __testSetClerkEmail(clerkUserId, email) {
  if (email == null) {
    testEmails.delete(clerkUserId)
  } else {
    testEmails.set(clerkUserId, email)
  }
}

function __testClearClerkEmails() {
  testEmails.clear()
}

// Resolve the primary email for a Clerk user. Never throws — a linking
// failure must not break the request; the caller falls back to the previous
// behaviour (a plain coach row) in the worst case.
async function fetchClerkEmail(clerkUserId) {
  if (!clerkUserId) return null
  if (process.env.NODE_ENV === 'test') {
    return testEmails.get(clerkUserId) || null
  }
  try {
    const { clerkClient } = require('@clerk/express')
    const clerkUser = await clerkClient.users.getUser(clerkUserId)
    return clerkUser.primaryEmailAddress?.emailAddress || null
  } catch (err) {
    console.error('Failed to resolve Clerk email for linking:', err?.message || err)
    return null
  }
}

// Find the invite an email belongs to and link the account to it.
//   linked: true  → users row now carries the invite's role/squad (+ athlete)
//   linked: false → no invite matched, or the existing row was protected
// Returns { linked, userId?, role?, squadId?, athleteId?, reason? }; only
// real database errors are thrown.
async function linkUserToInvite(pool, { clerkUserId, email }) {
  if (!clerkUserId || !email) return { linked: false, reason: 'missing-input' }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Latest pending invite wins; assistant invites land here too — that's
    // how an invited assistant's fresh signup picks up its role.
    let target = await client.query(
      `SELECT id, role, squad_id, athlete_id FROM invites
       WHERE LOWER(email) = LOWER($1) AND status = 'pending'
       ORDER BY id DESC LIMIT 1`,
      [email]
    )

    if (target.rows.length === 0) {
      // A player invite that was superseded by a re-invite to a new address
      // sits as 'cancelled', not 'pending', so fall back to matching the
      // athlete row itself — as long as that athlete is still unlinked.
      target = await client.query(
        `SELECT i.id, i.role, i.squad_id, i.athlete_id FROM invites i
         JOIN athletes a ON a.id = i.athlete_id
         WHERE LOWER(i.email) = LOWER($1) AND i.role = 'athlete' AND a.user_id IS NULL
         ORDER BY i.id DESC LIMIT 1`,
        [email]
      )
    }

    if (target.rows.length === 0) {
      await client.query('COMMIT')
      return { linked: false, reason: 'no-invite' }
    }

    const invite = target.rows[0]

    // Never silently re-role an established account: a real coach (anyone
    // who already runs a squad with athletes in it) or anyone who already
    // holds a non-coach role keeps it. Coaches can be invited by other
    // coaches, and that must not turn them into a player.
    const existing = await client.query('SELECT id, role FROM users WHERE clerk_id = $1', [clerkUserId])
    if (existing.rows.length > 0) {
      const row = existing.rows[0]
      let isProtected = row.role !== 'coach'
      if (!isProtected) {
        const team = await client.query(
          `SELECT 1 FROM squads s JOIN athletes a ON a.squad_id = s.id
           WHERE s.coach_id = $1 LIMIT 1`,
          [row.id]
        )
        isProtected = team.rows.length > 0
      }
      if (isProtected) {
        await client.query('COMMIT')
        return { linked: false, reason: 'protected', userId: row.id }
      }
    }

    const userResult = await client.query(
      `INSERT INTO users (clerk_id, email, role, squad_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (clerk_id) DO UPDATE
         SET role = EXCLUDED.role,
             squad_id = EXCLUDED.squad_id,
             email = COALESCE(users.email, EXCLUDED.email)
       RETURNING id`,
      [clerkUserId, email, invite.role, invite.squad_id]
    )
    const userId = userResult.rows[0].id

    if (invite.role === 'athlete' && invite.athlete_id) {
      await client.query(
        `UPDATE athletes SET user_id = $1
         WHERE id = $2 AND squad_id = $3 AND (user_id IS NULL OR user_id = $1)`,
        [userId, invite.athlete_id, invite.squad_id]
      )
    }

    await client.query("UPDATE invites SET status = 'accepted' WHERE id = $1 AND status = 'pending'", [
      invite.id,
    ])

    await client.query('COMMIT')
    return {
      linked: true,
      userId,
      role: invite.role,
      squadId: invite.squad_id,
      athleteId: invite.athlete_id || undefined,
    }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

module.exports = { fetchClerkEmail, linkUserToInvite, __testSetClerkEmail, __testClearClerkEmails }
