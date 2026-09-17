import { createPool } from '../src/storage/database.js';
import { migrate } from '../src/storage/migrate.js';
const pool = createPool(process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL);
try {
  await migrate(pool);
  console.log('Database migrations applied.');
} finally {
  await pool.end();
}
