import { escapeIdentifier, escapeLiteral } from 'pg';
import { createPool } from '../src/storage/database.js';
import { transaction } from '../src/auth/routes.js';
import { grantRuntimePrivileges } from '../src/storage/runtimePrivileges.js';

const role = process.env.RUNTIME_DB_USER ?? 'bloodbank_runtime';
const password = process.env.RUNTIME_DB_PASSWORD;
if (!/^[a-z][a-z0-9_]{2,62}$/.test(role) || !password || password.length < 16)
  throw new Error('Set RUNTIME_DB_USER and a RUNTIME_DB_PASSWORD of at least 16 characters.');
const pool = createPool(process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL);
try {
  await transaction(pool, async (db) => {
    const existing = await db.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role]);
    if (existing.rowCount)
      throw new Error(
        'Role already exists. Use a new dedicated role name; this command does not modify existing roles.',
      );
    await db.query(
      `CREATE ROLE ${escapeIdentifier(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD ${escapeLiteral(password)}`,
    );
    await grantRuntimePrivileges(db, role);
  });
  console.log(
    'Restricted runtime role created. Set DATABASE_URL to this role; keep the owner URL as MIGRATION_DATABASE_URL for setup commands only.',
  );
} catch {
  // Never echo SQL containing a password, or a database error that includes it.
  console.error(
    'Runtime role setup failed. Check owner privileges, configuration and whether the role already exists.',
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
