import { createPool } from '../src/storage/database.js';
import { migrate } from '../src/storage/migrate.js';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';

const pool = createPool();
try {
  await migrate(pool);
  console.log('Database migrations applied.');

  const users: { username: string; password: string; role: string }[] = [];
  if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
    if (process.env.ADMIN_PASSWORD.length < 8)
      throw new Error('Use an initial administrator password of at least 8 characters.');
    users.push({
      username: process.env.ADMIN_USERNAME,
      password: process.env.ADMIN_PASSWORD,
      role: 'ADMIN',
    });
  }
  if (process.env.DEMO_MODE === 'true') {
    for (const role of ['ADMIN', 'OPERATOR', 'LAB', 'DISPENSER', 'RESEARCHER'])
      users.push({
        username: `demo_${role.toLowerCase()}`,
        password: `Demo${role.charAt(0) + role.slice(1).toLowerCase()}123!`,
        role,
      });
  }

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
