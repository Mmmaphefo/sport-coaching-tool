require('dotenv').config();
const pool = require('./src/db');

async function main() {
  const result = await pool.query("DELETE FROM invites WHERE status = 'pending' RETURNING id, email");
  console.log('Deleted:', result.rows);
  process.exit(0);
}

main();
