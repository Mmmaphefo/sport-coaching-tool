require('dotenv').config();
const pool = require('./src/db');

async function main() {
  const result = await pool.query('SELECT id, email, status, created_at FROM invites ORDER BY created_at DESC LIMIT 5');
  console.table(result.rows);
  process.exit(0);
}

main();
