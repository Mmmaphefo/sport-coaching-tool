const { Pool } = require('pg');

// Single shared connection pool for the whole backend process.
//
// Every route/lib module used to create its own `new Pool(...)`. Each pool
// independently opens connections (up to its own `max`), so under production
// traffic the process held one pool's worth of connections per file, which
// eventually exceeded the hosted database's connection limit (Neon). Once the
// limit is hit, new queries do not fail fast: they queue inside the pool
// waiting for a client that never frees, so requests hang indefinitely (which
// surfaces on the frontend as "The server took too long to respond").
// Importing this single module everywhere keeps the process to one pool.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Hard cap on connections this process may hold.
  max: 10,
  // Release idle connections instead of holding them open forever.
  idleTimeoutMillis: 30000,
  // Fail fast (instead of hanging) if no connection becomes available.
  connectionTimeoutMillis: 10000,
  // Shows up in the provider's dashboard / pg_stat_activity.
  application_name: 'kickstat-backend',
});

// An idle client dying (network blip, provider restart) emits 'error' on the
// pool; without a listener that becomes an uncaught exception and crashes the
// server.
pool.on('error', (err) => {
  console.error('Unexpected error on idle database client:', err.message);
});

module.exports = pool;
