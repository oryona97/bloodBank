import { createPool } from '../src/storage/database.js';
import { createUserSchema, transaction } from '../src/auth/routes.js';
import { hashPassword } from '../src/auth/password.js';
import { audit } from '../src/auth/audit.js';

const pool = createPool(process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL);
try {
  const input = createUserSchema.parse({
    username: process.env.ADMIN_USERNAME,
    displayName: process.env.ADMIN_DISPLAY_NAME ?? 'Administrator',
    password: process.env.ADMIN_PASSWORD,
    role: 'ADMIN',
  });
  const hash = await hashPassword(input.password);
  await transaction(pool, async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(81263002)');
    if ((await db.query("SELECT id FROM users WHERE role='ADMIN' AND active")).rowCount)
      throw new Error('An active administrator already exists. Use user management.');
    const created = await db.query(
      "INSERT INTO users(username,display_name,password_hash,role,must_change_password) VALUES ($1,$2,$3,'ADMIN',true) RETURNING id",
      [input.username, input.displayName, hash],
    );
    await audit(db, null, 'ADMIN_BOOTSTRAPPED', { userId: created.rows[0].id });
  });
  console.log('Administrator created. Change the temporary password on first login.');
} catch (error) {
  // Validation errors must never serialize password input.
  console.error(error instanceof Error ? error.message : 'Administrator setup failed.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
