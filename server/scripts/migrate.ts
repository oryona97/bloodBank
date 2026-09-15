import { createPool } from '../src/storage/database.js';
import { migrate } from '../src/storage/migrate.js';
const pool = createPool();
try {
  await migrate(pool);
  console.log('Database migrations applied.');
} finally {
  await pool.end();
}
