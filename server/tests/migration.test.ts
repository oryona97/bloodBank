import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Pool, escapeIdentifier } from 'pg';
import { expect, it } from 'vitest';
import { migrate } from '../src/storage/migrate.js';

const connection = process.env.TEST_DATABASE_URL;
if (!connection || !new URL(connection).pathname.endsWith('_test') || connection === process.env.DATABASE_URL) throw new Error('Configure a separate _test database.');

it('upgrades the old schema without changing donor records, receipts or audit details', async () => {
  const schema = `migration_test_${randomUUID().replaceAll('-', '')}`;
  const owner = new Pool({ connectionString: connection });
  const upgraded = new Pool({ connectionString: connection, options: `-c search_path=${schema}` });
  try {
    await owner.query(`CREATE SCHEMA ${escapeIdentifier(schema)}`);
    await upgraded.query('CREATE TABLE schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of ['001_initial.sql', '002_audit_trail.sql']) {
      await upgraded.query(await readFile(`server/migrations/${name}`, 'utf8'));
      await upgraded.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
    }
    const unit = randomUUID(); const key = randomUUID();
    await upgraded.query("INSERT INTO blood_units(unit_id,blood_type,donation_date,donor_id,donor_full_name) VALUES ($1,'A+','2025-01-01','000000018','Historical synthetic donor')", [unit]);
    await upgraded.query("INSERT INTO audit_logs(action,details) VALUES ('DONATION',$1)", [JSON.stringify({ unitId: unit, donorId: '000000018' })]);
    await upgraded.query("INSERT INTO operation_requests(request_key,fingerprint,response) VALUES ($1,'old-fingerprint',$2)", [key, JSON.stringify({ unitId: unit })]);
    const before = (await upgraded.query('SELECT * FROM blood_units')).rows;
    await migrate(upgraded);
    await migrate(upgraded); // Idempotent restart after a completed migration.
    expect((await upgraded.query('SELECT * FROM blood_units')).rows).toEqual(before);
    expect((await upgraded.query('SELECT attribution,actor_id,details FROM audit_logs')).rows[0]).toEqual({ attribution: 'LEGACY', actor_id: null, details: { unitId: unit, donorId: '000000018' } });
    expect((await upgraded.query('SELECT response,actor_id FROM operation_requests')).rows[0]).toEqual({ response: { unitId: unit }, actor_id: null });
    expect((await upgraded.query('SELECT * FROM users')).rowCount).toBe(0);
  } finally {
    await upgraded.end();
    await owner.query(`DROP SCHEMA IF EXISTS ${escapeIdentifier(schema)} CASCADE`);
    await owner.end();
  }
});
