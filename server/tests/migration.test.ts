import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import bcrypt from 'bcrypt';
import { Pool } from 'pg';
import request from 'supertest';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { createPool } from '../src/storage/database.js';
import { migrate } from '../src/storage/migrate.js';
import { createApp } from '../src/app.js';

const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  !new URL(connection).pathname.endsWith('_test') ||
  connection === process.env.DATABASE_URL
)
  throw new Error('Use a separate test database ending in _test.');
const schema = `legacy_${randomUUID().replaceAll('-', '')}`,
  owner = createPool(connection);
const pool = new Pool({ connectionString: connection, options: `-c search_path=${schema}` });
const availableId = randomUUID(),
  issuedId = randomUUID(),
  eventId = randomUUID();
const secret = 'migration-test-signing-secret-longer-than-32-characters';
const app = createApp(pool, { jwtSecret: secret });
let token = '';
let operatorToken = '';
beforeAll(async () => {
  await owner.query(`CREATE SCHEMA ${schema}`);
  await pool.query(
    'CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())',
  );
  for (const name of [
    '001_initial.sql',
    '002_audit_trail.sql',
    '003_complete_audit.sql',
    '004_auth_and_rbac.sql',
  ]) {
    await pool.query(await readFile(`server/migrations/${name}`, 'utf8'));
    await pool.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
  }
  await pool.query(
    "INSERT INTO blood_units(unit_id,blood_type,donation_date,donor_id,donor_full_name,status) VALUES ($1,'A+','2026-01-01','000000018','Synthetic Legacy Donor','AVAILABLE'),($2,'O-','2026-01-02','000000018','Synthetic Legacy Donor','DISPENSED')",
    [availableId, issuedId],
  );
  await pool.query("INSERT INTO dispense_events(event_id,mode) VALUES($1,'EMERGENCY')", [eventId]);
  await pool.query('INSERT INTO dispense_event_units(event_id,unit_id) VALUES($1,$2)', [
    eventId,
    issuedId,
  ]);
  await pool.query(
    "INSERT INTO audit_logs(action,details,actor,source) VALUES('LEGACY_MARKER','{}','legacy-test','system')",
  );
  const hash = await bcrypt.hash('test-password', 4);
  await pool.query(
    "INSERT INTO users(id,username,password_hash,role) VALUES($1,'legacy-admin',$2,'ADMIN'),($3,'legacy-worker',$2,'WORKER')",
    [randomUUID(), hash, randomUUID()],
  );
  await migrate(pool);
  await migrate(pool);
  await pool.query(
    "INSERT INTO users(id,username,password_hash,role) VALUES($1,'migration-operator',$2,'OPERATOR')",
    [randomUUID(), hash],
  );
  operatorToken = (
    await request(app)
      .post('/api/auth/login')
      .send({ username: 'migration-operator', password: 'test-password' })
  ).body.token;
  token = (
    await request(app)
      .post('/api/auth/login')
      .send({ username: 'legacy-admin', password: 'test-password' })
  ).body.token;
});
afterAll(async () => {
  await pool.end();
  try {
    await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    await owner.end();
  }
});
const get = (path: string) =>
  request(app).get(`/api${path}`).set('Authorization', `Bearer ${token}`);
it('quarantines unknown historic products without inventing expiry or clearance', async () => {
  const result = await get(`/components?donationId=${availableId}`);
  expect(result.body.components[0]).toMatchObject({
    componentId: availableId,
    productType: 'LEGACY',
    status: 'QUARANTINED',
    expiresAt: null,
    labStatus: 'QUARANTINED',
  });
  expect((await get('/inventory')).body.inventory['A+']).toBe(0);
});
it('preserves legacy issuance links and audit history across repeatable migration', async () => {
  const issued = await get(`/records?dataset=issuedComponents&search=${issuedId}`);
  expect(issued.body.records).toEqual([
    expect.objectContaining({ component_id: issuedId, event_id: eventId }),
  ]);
  const audit = await get('/records?dataset=auditLogs&action=LEGACY_MARKER');
  expect(audit.body.records).toHaveLength(1);
  expect((await get(`/components?donationId=${issuedId}`)).body.components[0].status).toBe(
    'DISPENSED',
  );
});
it('disables a legacy combined worker role until an administrator assigns a specific role', async () => {
  expect(
    (
      await request(app)
        .post('/api/auth/login')
        .send({ username: 'legacy-worker', password: 'test-password' })
    ).status,
  ).toBe(401);
});
it('accepts explicitly verified legacy product details while retaining quarantine and the original identifier', async () => {
  const response = await request(app)
    .post(`/api/components/${availableId}/legacy-details`)
    .set('Authorization', `Bearer ${operatorToken}`)
    .set('Idempotency-Key', randomUUID())
    .send({
      productType: 'FFP',
      collectedAt: '2026-01-01T10:00:00Z',
      reason: 'Verified synthetic historical record',
    });
  expect(response.status).toBe(200);
  const component = (await get(`/components?donationId=${availableId}`)).body.components[0];
  expect(component).toMatchObject({
    componentId: availableId,
    productType: 'FFP',
    status: 'QUARANTINED',
    labStatus: 'QUARANTINED',
    expiresAt: '2027-01-01T10:00:00.000Z',
  });
});
