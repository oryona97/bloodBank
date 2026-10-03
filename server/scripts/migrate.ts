import { createPool } from '../src/storage/database.js';
import { migrate } from '../src/storage/migrate.js';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';

const pool = createPool();
try {
  await migrate(pool);
  console.log('Database migrations applied.');

  const users = [
    {
      username: process.env.ADMIN_USERNAME || 'admin',
      password: process.env.ADMIN_PASSWORD || 'admin',
      role: 'ADMIN',
    },
    { username: 'worker', password: 'worker', role: 'WORKER' },
    { username: 'researcher', password: 'researcher', role: 'RESEARCHER' },
  ];

  for (const u of users) {
    const res = await pool.query('SELECT 1 FROM users WHERE username = $1', [u.username]);
    if (res.rowCount === 0) {
      const hash = await bcrypt.hash(u.password, 10);
      await pool.query(
        'INSERT INTO users(id, username, password_hash, role) VALUES ($1, $2, $3, $4)',
        [randomUUID(), u.username, hash, u.role],
      );
      console.log(`Seeded user: ${u.username}`);
    }
  }
} finally {
  await pool.end();
}
