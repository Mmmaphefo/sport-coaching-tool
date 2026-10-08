const pool = require('../db');

async function getUserByClerkId(clerkId) {
  const result = await pool.query(
    'SELECT id, role, clerk_id FROM users WHERE clerk_id = $1',
    [clerkId]
  );
  return result.rows[0] || null;
}

async function cleanupUserRecords(client, userId) {
  // Invites sent by this user are no longer actionable once the user is gone.
  await client.query('DELETE FROM invites WHERE invited_by = $1', [userId]);

  // Remove the created_by reference so the user's own events can be cascaded
  // away when their squad is deleted.
  await client.query('UPDATE events SET created_by = NULL WHERE created_by = $1', [userId]);

  // Delete log entries authored by this user. For coaches this is redundant
  // because their squad's events will be cascaded, but for assistants/athletes
  // it is required because logged_by does not cascade.
  await client.query('DELETE FROM log_entries WHERE logged_by = $1', [userId]);
}

async function deleteClerkUser(clerkId) {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    // Tests run without a Clerk secret key; the local DB cleanup is enough there.
    console.warn('Skipping Clerk user deletion: CLERK_SECRET_KEY is not configured');
    return;
  }

  const res = await fetch(`https://api.clerk.com/v1/users/${clerkId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${secretKey}`,
    },
  });

  // 404 means the user was already deleted in Clerk.
  if (!res.ok && res.status !== 404) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Clerk user deletion failed: ${res.status}`);
  }
}

async function deleteUserByClerkId(clerkId) {
  // Delete the Clerk user first. If this fails we haven't touched the local DB yet.
  await deleteClerkUser(clerkId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const user = await client.query(
      'SELECT id FROM users WHERE clerk_id = $1 FOR UPDATE',
      [clerkId]
    );

    if (user.rows.length > 0) {
      const userId = user.rows[0].id;
      await cleanupUserRecords(client, userId);
      await client.query('DELETE FROM users WHERE id = $1', [userId]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  getUserByClerkId,
  deleteUserByClerkId,
  deleteClerkUser,
};
