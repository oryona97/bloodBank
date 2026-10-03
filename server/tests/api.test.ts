import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { createApp } from '../src/app.js';
import { createPool } from '../src/storage/database.js';
import { migrate } from '../src/storage/migrate.js';
import { mutate } from '../src/services/inventoryService.js';
import { getFullExport } from '../src/storage/exportRepository.js';
import { writeAudit } from '../src/storage/auditRepository.js';
import { emptyInventory, type Allocation, type BloodType } from '../../shared/apiTypes.js';

const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  !new URL(connection).pathname.endsWith('_test') ||
  connection === process.env.DATABASE_URL
) {
  throw new Error(
    'Set TEST_DATABASE_URL to a separate database whose name ends in _test. These tests clear its application tables.',
  );
}
// Keep migrations, fixtures, and retained audit history out of existing schemas.
const schema = `review_${randomUUID().replaceAll('-', '')}`;
const adminPool = createPool(connection);
const poolOptions = {
  connectionString: connection,
  options: `-c search_path=${schema}`,
  connectionTimeoutMillis: 5000,
};
const pool = new Pool(poolOptions);
const app = createApp(pool);
const donation = (bloodType: BloodType = 'A+') => ({
  bloodType,
  donationDate: '2026-01-01',
  donorId: '000000018',
  donorFullName: 'Synthetic Test Donor',
});
let token = '';

function add(type: BloodType = 'A+', key = randomUUID()) {
  return request(app).post('/api/donations').set('Idempotency-Key', key).set('Authorization', `Bearer ${token}`).send(donation(type));
}
async function preview(recipientType: BloodType, quantity: number): Promise<Allocation> {
  const response = await request(app)
    .post('/api/dispensing/preview')
    .set('Authorization', `Bearer ${token}`)
    .send({ recipientType, quantity });
  expect(response.status).toBe(200);
  return response.body as Allocation;
}
function confirm(plan: Allocation, key = randomUUID()) {
  return request(app)
    .post('/api/dispensing/confirm')
    .set('Idempotency-Key', key)
    .set('Authorization', `Bearer ${token}`)
    .send({ recipientType: plan.recipientType, quantity: plan.quantity, lines: plan.lines });
}
function emergency(key = randomUUID()) {
  return request(app).post('/api/dispensing/emergency').set('Idempotency-Key', key).set('Authorization', `Bearer ${token}`).send({});
}
async function inventory() {
  return (await request(app).get('/api/inventory').set('Authorization', `Bearer ${token}`)).body.inventory;
}

async function auditFor(response: { headers: Record<string, string> }) {
  return (
    await pool.query('SELECT * FROM audit_logs WHERE request_id = $1 ORDER BY sequence', [
      response.headers['x-request-id'],
    ])
  ).rows;
}

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  await pool.query(`INSERT INTO users (id, username, password_hash, role) VALUES ($1, 'admin1', 'hashed_pw', 'ADMIN')`, [randomUUID()]);
  const loginRes = await request(app).post('/api/auth/login').send({ username: 'admin1', password: 'password123' });
  token = loginRes.body.token;
});
beforeEach(async () => {
  await pool.query(
    'TRUNCATE operation_requests, dispense_event_units, dispense_events, blood_units',
  );
});
afterAll(async () => {
  await pool.end();
  try {
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    await adminPool.end();
  }
});

describe('PostgreSQL-backed API', () => {
  it('returns all eight zero counts and health status', async () => {
    expect(await inventory()).toEqual(emptyInventory());
    expect((await request(app).get('/api/health')).status).toBe(200);
  });
  it('records multiple donations from the same donor and preserves leading zeros', async () => {
    expect((await add()).status).toBe(201);
    expect((await add()).status).toBe(201);
    expect((await inventory())['A+']).toBe(2);
    expect(
      (await pool.query('SELECT donor_id FROM blood_units')).rows.map((row) => row.donor_id),
    ).toEqual(['000000018', '000000018']);
  });
  it('rejects invalid donors, blood types, calendar dates and future dates', async () => {
    for (const change of [
      { donorId: '123' },
      { bloodType: 'C+' },
      { donationDate: '2026-02-30' },
      { donationDate: '2999-01-01' },
      { donorFullName: ' ' },
    ]) {
      const response = await request(app)
        .post('/api/donations')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ ...donation(), ...change });
      expect(response.status).toBe(400);
      expect(response.body.fields).toBeDefined();
    }
    expect(await inventory()).toEqual(emptyInventory());
  });
  it('rejects invalid quantities and missing request keys', async () => {
    for (const quantity of [0, -1, 1.2, '2']) {
      expect(
        (await request(app).post('/api/dispensing/preview').set('Authorization', `Bearer ${token}`).send({ recipientType: 'A+', quantity }))
          .status,
      ).toBe(400);
    }
    expect((await request(app).post('/api/donations').set('Authorization', `Bearer ${token}`).send(donation())).status).toBe(400);
  });
  it('does not mutate stock on preview and uses oldest donation first', async () => {
    const first = await add();
    await request(app)
      .post('/api/donations')
      .set('Idempotency-Key', randomUUID())
      .set('Authorization', `Bearer ${token}`)
      .send({ ...donation(), donationDate: '2025-01-01' });
    const plan = await preview('A+', 1);
    expect((await inventory())['A+']).toBe(2);
    expect((await confirm(plan)).status).toBe(200);
    expect((await inventory())['A+']).toBe(1);
    expect(
      (await pool.query('SELECT status FROM blood_units WHERE unit_id = $1', [first.body.unitId]))
        .rows[0].status,
    ).toBe('AVAILABLE');
  });
  it('fulfills the mixed allocation example and preserves O-negative', async () => {
    for (const type of ['A+', 'O+', 'O+', 'A-', 'A-', 'O-'] as BloodType[]) await add(type);
    const plan = await preview('A+', 4);
    expect(plan.lines).toEqual([
      { bloodType: 'A+', quantity: 1 },
      { bloodType: 'O+', quantity: 2 },
      { bloodType: 'A-', quantity: 1 },
    ]);
    expect((await confirm(plan)).status).toBe(200);
    expect(await inventory()).toEqual({ ...emptyInventory(), 'A-': 1, 'O-': 1 });
  });
  it('reports a shortage and rejects a forged partial or incompatible allocation', async () => {
    await add('A+');
    await add('B+');
    const plan = await preview('A+', 2);
    expect(plan).toMatchObject({ shortfall: 1, canFulfill: false });
    expect((await confirm(plan)).status).toBe(409);
    const forged = { ...plan, lines: [{ bloodType: 'B+' as const, quantity: 2 }] };
    expect((await confirm(forged)).status).toBe(409);
    expect((await inventory())['A+']).toBe(1);
    expect((await pool.query('SELECT * FROM dispense_events')).rowCount).toBe(0);
  });
  it('rejects a stale allocation after stock changes', async () => {
    await add('O-');
    const plan = await preview('A+', 1);
    await emergency();
    const response = await confirm(plan);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('STOCK_CHANGED');
  });
  it('drains only O-negative and rejects a new release when empty', async () => {
    await add('O-');
    await add('O-');
    await add('A+');
    expect((await emergency()).body.quantity).toBe(2);
    expect(await inventory()).toEqual({ ...emptyInventory(), 'A+': 1 });
    expect((await emergency()).status).toBe(409);
    expect((await pool.query('SELECT * FROM dispense_events')).rowCount).toBe(1);
  });
  it('deduplicates retries and rejects reusing a key for a different payload', async () => {
    const key = randomUUID();
    const first = await add('A+', key);
    expect((await add('A+', key)).body).toEqual(first.body);
    expect((await add('O+', key)).status).toBe(409);
    expect((await inventory())['A+']).toBe(1);
    const plan = await preview('A+', 1);
    const issueKey = randomUUID();
    const issued = await confirm(plan, issueKey);
    expect((await confirm(plan, issueKey)).body).toEqual(issued.body);
    expect((await pool.query('SELECT * FROM dispense_events')).rowCount).toBe(1);
  });
  it('returns the original emergency receipt on retry even after new donations', async () => {
    await add('O-');
    const key = randomUUID();
    const issued = await emergency(key);
    await add('O-');
    expect((await emergency(key)).body).toEqual(issued.body);
    expect((await inventory())['O-']).toBe(1);
  });
  it('serializes simultaneous routine and emergency releases', async () => {
    await add('O-');
    const plan = await preview('A+', 1);
    const results = await Promise.all([confirm(plan), emergency()]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect((await inventory())['O-']).toBe(0);
    expect((await pool.query('SELECT * FROM dispense_event_units')).rowCount).toBe(1);
  });
  it('deduplicates simultaneous requests with the same key', async () => {
    const key = randomUUID();
    const results = await Promise.all([add('A+', key), add('A+', key)]);
    expect(results[0].body).toEqual(results[1].body);
    expect((await inventory())['A+']).toBe(1);
  });
  it('rolls back inventory changes and events if a transaction fails', async () => {
    const unit = await add();
    const key = randomUUID();
    await expect(
      mutate(pool, key, 'failure-test', {}, async (client) => {
        await client.query("UPDATE blood_units SET status = 'DISPENSED'");
        await client.query("INSERT INTO dispense_events(event_id, mode) VALUES ($1, 'EMERGENCY')", [
          randomUUID(),
        ]);
        throw new Error('Simulated failure after writes');
      }),
    ).rejects.toThrow('Simulated failure');
    expect((await inventory())['A+']).toBe(1);
    expect(
      (await pool.query('SELECT status FROM blood_units WHERE unit_id = $1', [unit.body.unitId]))
        .rows[0].status,
    ).toBe('AVAILABLE');
    expect((await pool.query('SELECT * FROM dispense_events')).rowCount).toBe(0);
    expect(
      (await pool.query('SELECT * FROM operation_requests WHERE request_key = $1', [key])).rowCount,
    ).toBe(0);
  });
  it('enforces database type constraints and unique issuance', async () => {
    const unit = await add();
    await expect(
      pool.query("UPDATE blood_units SET blood_type = 'C+' WHERE unit_id = $1", [unit.body.unitId]),
    ).rejects.toMatchObject({ code: '23514' });
    const result = await confirm(await preview('A+', 1));
    await expect(
      pool.query('INSERT INTO dispense_event_units(event_id, unit_id) VALUES ($1, $2)', [
        result.body.eventId,
        unit.body.unitId,
      ]),
    ).rejects.toMatchObject({ code: '23505' });
  });
  it('retains inventory through a fresh application/database connection', async () => {
    await add('B-');
    const freshPool = new Pool(poolOptions);
    try {
      expect((await request(createApp(freshPool)).get('/api/inventory').set('Authorization', `Bearer ${token}`)).body.inventory['B-']).toBe(
        1,
      );
    } finally {
      await freshPool.end();
    }
  });
});

describe('Audit trail and record copies', () => {
  it('links each donation to its unit and distinguishes retries from new donations', async () => {
    const key = randomUUID();
    const first = await add('A+', key);
    const second = await add('A+');
    expect(await auditFor(first)).toMatchObject([
      {
        action: 'DONATION',
        outcome: 'SUCCESS',
        actor: 'admin1',
        source: 'api',
        request_key: key,
        context: { method: 'POST', path: '/api/donations' },
        details: { ...donation(), unitId: first.body.unitId },
      },
    ]);
    expect((await auditFor(second))[0].details.unitId).toBe(second.body.unitId);
    expect(second.body.unitId).not.toBe(first.body.unitId);
    const retry = await add('A+', key);
    expect(retry.body).toEqual(first.body);
    expect(await auditFor(retry)).toMatchObject([
      { action: 'REQUEST_REPLAYED', details: { operation: 'donation' } },
    ]);
    expect((await pool.query('SELECT * FROM blood_units')).rowCount).toBe(2);
  });

  it('links routine and emergency audit events to the exact issued units', async () => {
    const routineUnit = await add('A+');
    const emergencyUnit = await add('O-');
    const routine = await confirm(await preview('A+', 1));
    const urgent = await emergency();
    expect(await auditFor(routine)).toMatchObject([
      {
        action: 'DISPENSE_ROUTINE',
        details: {
          eventId: routine.body.eventId,
          recipientType: 'A+',
          unitIds: [routineUnit.body.unitId],
        },
      },
    ]);
    expect(await auditFor(urgent)).toMatchObject([
      {
        action: 'DISPENSE_EMERGENCY',
        details: { eventId: urgent.body.eventId, unitIds: [emergencyUnit.body.unitId] },
      },
    ]);
  });

  it('records reads, health checks, shortages, and cancellations without issuing stock', async () => {
    const unit = await add();
    const viewed = await request(app).get('/api/inventory').set('Authorization', `Bearer ${token}`);
    expect(await auditFor(viewed)).toMatchObject([{ action: 'INVENTORY_VIEWED' }]);
    const health = await request(app).get('/api/health');
    expect(await auditFor(health)).toMatchObject([{ action: 'HEALTH_CHECKED' }]);
    const planned = await request(app)
      .post('/api/dispensing/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ recipientType: 'A+', quantity: 2 });
    expect(await auditFor(planned)).toMatchObject([
      { action: 'ALLOCATION_PREVIEWED', details: { canFulfill: false, shortfall: 1 } },
    ]);
    for (const body of [
      { operation: 'ROUTINE', recipientType: 'A+', quantity: 2 },
      { operation: 'EMERGENCY' },
    ]) {
      const cancelled = await request(app).post('/api/activities/cancel').set('Authorization', `Bearer ${token}`).send(body);
      expect(cancelled.status).toBe(200);
      expect(await auditFor(cancelled)).toMatchObject([
        { action: 'DISPENSING_CANCELLED', details: body },
      ]);
    }
    expect(
      (await pool.query('SELECT status FROM blood_units WHERE unit_id = $1', [unit.body.unitId]))
        .rows[0].status,
    ).toBe('AVAILABLE');
    expect((await pool.query('SELECT * FROM dispense_events')).rowCount).toBe(0);
  });

  it('retains rejected requests after rollback, including conflicts and invalid JSON', async () => {
    const empty = await emergency();
    expect(empty.status).toBe(409);
    expect(await auditFor(empty)).toMatchObject([
      { outcome: 'REJECTED', details: { code: 'EMPTY_EMERGENCY_STOCK', status: 409 } },
    ]);
    const invalid = await request(app).post('/api/donations').set('Authorization', `Bearer ${token}`).send({ donorId: 'bad' });
    expect(invalid.status).toBe(400);
    expect(await auditFor(invalid)).toMatchObject([
      { action: 'REQUEST_FAILED', details: { code: 'VALIDATION_ERROR' } },
    ]);
    const malformed = await request(app)
      .post('/api/donations')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send('{');
    expect(malformed.status).toBe(400);
    expect(await auditFor(malformed)).toMatchObject([{ details: { code: 'INVALID_JSON' } }]);
    const oversized = await request(app)
      .post('/api/donations')
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 'x'.repeat(17000) });
    expect(oversized.status).toBe(413);
    expect(await auditFor(oversized)).toMatchObject([{ details: { code: 'PAYLOAD_TOO_LARGE' } }]);
    const missing = await request(app).get('/api/missing').set('Authorization', `Bearer ${token}`);
    expect(missing.status).toBe(404);
    expect(await auditFor(missing)).toMatchObject([{ details: { code: 'NOT_FOUND' } }]);
    const key = randomUUID();
    await add('O-', key);
    const reused = await add('A+', key);
    expect(await auditFor(reused)).toMatchObject([{ details: { code: 'REQUEST_KEY_REUSED' } }]);
    const stale = await preview('A+', 1);
    await emergency();
    const conflict = await confirm(stale);
    expect(await auditFor(conflict)).toMatchObject([{ details: { code: 'STOCK_CHANGED' } }]);
  });

  it('rolls back both inventory writes and success audit entries on transaction failure', async () => {
    const marker = randomUUID();
    await expect(
      mutate(pool, randomUUID(), 'rollback-test', {}, async (client) => {
        await client.query(
          'INSERT INTO blood_units(unit_id, blood_type, donation_date, donor_id, donor_full_name) VALUES ($1, $2, $3, $4, $5)',
          [marker, 'A+', '2026-01-01', '000000018', 'Synthetic Donor'],
        );
        await writeAudit(client, 'DONATION', { unitId: marker });
        throw new Error('Rollback after audit');
      }),
    ).rejects.toThrow('Rollback after audit');
    expect(
      (await pool.query('SELECT * FROM blood_units WHERE unit_id = $1', [marker])).rowCount,
    ).toBe(0);
    expect(
      (await pool.query("SELECT * FROM audit_logs WHERE details->>'unitId' = $1", [marker]))
        .rowCount,
    ).toBe(0);
  });

  it('rejects the inventory transaction if its success audit cannot be stored', async () => {
    await pool.query(`CREATE FUNCTION fail_donation_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action = 'DONATION' THEN RAISE EXCEPTION 'Simulated audit failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER fail_donation_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_donation_audit()`);
    try {
      const result = await add();
      expect(result.status).toBe(503);
      expect(await auditFor(result)).toMatchObject([
        { action: 'REQUEST_FAILED', outcome: 'ERROR' },
      ]);
      expect((await pool.query('SELECT * FROM blood_units')).rowCount).toBe(0);
      expect((await pool.query('SELECT * FROM operation_requests')).rowCount).toBe(0);
    } finally {
      await pool.query(
        'DROP TRIGGER fail_donation_audit ON audit_logs; DROP FUNCTION fail_donation_audit()',
      );
    }
  });

  it('blocks UPDATE, DELETE and TRUNCATE of the audit history', async () => {
    const result = await add();
    const rows = await auditFor(result);
    for (const sql of [
      "UPDATE audit_logs SET action = 'CHANGED'",
      'DELETE FROM audit_logs',
      'TRUNCATE audit_logs',
    ]) {
      await expect(pool.query(sql)).rejects.toMatchObject({ code: '42501' });
    }
    expect(await auditFor(result)).toEqual(rows);
  });

  it('downloads every stored record and log, including its own export event', async () => {
    for (let i = 0; i < 10; i++) await add('A+');
    await confirm(await preview('A+', 1));
    const response = await request(app).get('/api/export').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="bloodbank_export.json"',
    );
    const data = response.body;
    expect(data.formatVersion).toBe(1);
    expect(Number.isFinite(Date.parse(data.exportedAt))).toBe(true);
    expect(data.bloodUnits).toHaveLength(10);
    expect(data.bloodUnits[0]).toMatchObject({
      donation_date: '2026-01-01',
      donor_id: '000000018',
    });
    expect(data.dispenseEvents).toHaveLength(1);
    expect(data.dispenseEventUnits).toHaveLength(1);
    expect(data.operationRequests).toHaveLength(11);
    expect(data.schemaMigrations).toHaveLength(4);
    expect(data.inventoryLock).toEqual([{ id: 1 }]);
    expect(data.inventory).toHaveLength(8);
    expect(
      data.inventory.find((row: { blood_type: string }) => row.blood_type === 'A+').count,
    ).toBe(9);
    expect(data.auditLogs).toHaveLength((await pool.query('SELECT * FROM audit_logs')).rowCount!);
    expect(
      data.auditLogs.filter(
        (row: { request_id: string }) => row.request_id === response.headers['x-request-id'],
      ),
    ).toMatchObject([{ action: 'RECORDS_EXPORTED' }]);
    const times = data.auditLogs.map((row: { created_at: string }) => Date.parse(row.created_at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('keeps the entire export at one snapshot when a donation commits between reads', async () => {
    await add('A+');
    const client = await pool.connect();
    let interleaved = false;
    // A real second connection commits after the inventory SELECT, before the remaining SELECTs.
    const exportPool = {
      connect: async () => ({
        query: async (sql: string, values?: unknown[]) => {
          const result = await client.query(sql, values);
          if (sql.includes('GROUP BY blood_type')) {
            const added = await add('O-');
            expect(added.status).toBe(201);
            interleaved = true;
          }
          return result;
        },
        release: () => client.release(),
      }),
    } as unknown as Pool;
    const data = await getFullExport(exportPool);
    expect(interleaved).toBe(true);
    expect(data.bloodUnits).toHaveLength(1);
    expect(data.operationRequests).toHaveLength(1);
    expect(data.inventory.find((row) => row.blood_type === 'O-')!.count).toBe(0);
    expect((await pool.query('SELECT * FROM blood_units')).rowCount).toBe(2);
    const latestO = (await pool.query("SELECT unit_id FROM blood_units WHERE blood_type = 'O-' "))
      .rows[0].unit_id;
    expect(data.auditLogs.some((row) => row.details.unitId === latestO)).toBe(false);
  });
});

describe('Record dashboard and selective exports', () => {
  it('filters audit records by action, outcome and literal search, and audits access', async () => {
    const marker = `${randomUUID()}_%`;
    await writeAudit(pool, 'DONATION', { marker });
    await writeAudit(pool, 'REQUEST_FAILED', { marker }, undefined, 'REJECTED');
    const response = await request(app).get('/api/records').set('Authorization', `Bearer ${token}`).query({
      dataset: 'auditLogs',
      search: marker,
      action: 'REQUEST_FAILED',
      outcome: 'REJECTED',
    });
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.records).toMatchObject([
      { action: 'REQUEST_FAILED', outcome: 'REJECTED', details: { marker } },
    ]);
    expect(response.body.actions).toContain('DONATION');
    expect(await auditFor(response)).toMatchObject([
      { action: 'RECORDS_VIEWED', details: { total: 1 } },
    ]);
    const noMatches = await request(app)
      .get('/api/records')
      .set('Authorization', `Bearer ${token}`)
      .query({ dataset: 'auditLogs', search: "' OR true --", action: 'DONATION' });
    expect(noMatches.body.total).toBe(0);
  });

  it('treats date ranges as inclusive Jerusalem calendar days', async () => {
    const marker = randomUUID();
    for (const created of [
      '2026-01-01T21:59:59Z',
      '2026-01-01T22:00:00Z',
      '2026-01-02T21:59:59Z',
      '2026-01-02T22:00:00Z',
    ]) {
      await pool.query('INSERT INTO audit_logs(action, details, created_at) VALUES ($1, $2, $3)', [
        'DATE_TEST',
        JSON.stringify({ marker }),
        created,
      ]);
    }
    const response = await request(app).get('/api/records').set('Authorization', `Bearer ${token}`).query({
      dataset: 'auditLogs',
      search: marker,
      action: 'DATE_TEST',
      from: '2026-01-02',
      to: '2026-01-02',
    });
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(2);
    expect(response.body.records.map((row: { created_at: string }) => row.created_at)).toEqual([
      '2026-01-02T21:59:59.000Z',
      '2026-01-01T22:00:00.000Z',
    ]);
  });

  it('keeps pagination stable as new audit entries arrive', async () => {
    const marker = randomUUID();
    for (let i = 0; i < 5; i++) await writeAudit(pool, 'PAGE_TEST', { marker, i });
    const filters = { dataset: 'auditLogs', action: 'PAGE_TEST', search: marker, pageSize: 2 };
    const first = await request(app).get('/api/records').set('Authorization', `Bearer ${token}`).query(filters);
    expect(first.body.total).toBe(5);
    await writeAudit(pool, 'PAGE_TEST', { marker, i: 5 });
    const second = await request(app)
      .get('/api/records')
      .set('Authorization', `Bearer ${token}`)
      .query({ ...filters, snapshotAt: first.body.snapshotAt, page: 2 });
    expect(second.body.total).toBe(5);
    expect(first.body.records.map((row: { details: { i: number } }) => row.details.i)).toEqual([
      4, 3,
    ]);
    expect(second.body.records.map((row: { details: { i: number } }) => row.details.i)).toEqual([
      2, 1,
    ]);
    const emptyPage = await request(app)
      .get('/api/records')
      .set('Authorization', `Bearer ${token}`)
      .query({ ...filters, snapshotAt: first.body.snapshotAt, page: 4 });
    expect(emptyPage.body.total).toBe(5);
    expect(emptyPage.body.records).toEqual([]);
  });

  it('exports exactly the checked records, including selections across pages, as pretty JSON', async () => {
    const first = await add();
    await add();
    const third = await add();
    const response = await request(app)
      .post('/api/records/export')
      .set('Authorization', `Bearer ${token}`)
      .send({ filters: { dataset: 'bloodUnits' }, ids: [first.body.unitId, third.body.unitId] });
    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain('bloodbank_bloodUnits_selected.json');
    expect(response.text).toContain('\n  "formatVersion": 1,\n');
    expect(response.body.recordCount).toBe(2);
    expect(response.body.records.map((row: { unit_id: string }) => row.unit_id).sort()).toEqual(
      [first.body.unitId, third.body.unitId].sort(),
    );
    expect(response.body.records[0].donation_date).toBe('2026-01-01');
    expect(await auditFor(response)).toMatchObject([
      {
        action: 'RECORDS_EXPORTED',
        details: {
          scope: 'selected',
          recordCount: 2,
          recordIds: [first.body.unitId, third.body.unitId],
        },
      },
    ]);
    const missing = await request(app)
      .post('/api/records/export')
      .set('Authorization', `Bearer ${token}`)
      .send({ filters: { dataset: 'bloodUnits' }, ids: [randomUUID()] });
    expect(missing.status).toBe(409);
    expect(missing.body.code).toBe('EXPORT_SELECTION_CHANGED');
  });

  it('exports every match beyond the displayed page while respecting its snapshot', async () => {
    for (let i = 0; i < 4; i++) await add('O+');
    await add('A+');
    const page = await request(app)
      .get('/api/records')
      .set('Authorization', `Bearer ${token}`)
      .query({ dataset: 'bloodUnits', search: 'O+', pageSize: 2 });
    expect(page.body.records).toHaveLength(2);
    expect(page.body.total).toBe(4);
    await add('O+');
    const exported = await request(app)
      .post('/api/records/export')
      .set('Authorization', `Bearer ${token}`)
      .send({ filters: { dataset: 'bloodUnits', search: 'O+', snapshotAt: page.body.snapshotAt } });
    expect(exported.status).toBe(200);
    expect(exported.body.scope).toBe('filtered');
    expect(exported.body.recordCount).toBe(4);
    expect(
      exported.body.records.every((row: { blood_type: string }) => row.blood_type === 'O+'),
    ).toBe(true);
    const full = await request(app).get('/api/export').set('Authorization', `Bearer ${token}`);
    expect(full.text).toContain('\n  "formatVersion": 1,\n');
    expect(full.body.bloodUnits).toHaveLength(6);
  });

  it('browses and exports dispensing records, issued units and saved request receipts', async () => {
    await add();
    const issued = await confirm(await preview('A+', 1));
    for (const dataset of ['dispenseEvents', 'dispenseEventUnits', 'operationRequests']) {
      const response = await request(app)
        .get('/api/records')
        .set('Authorization', `Bearer ${token}`)
        .query({ dataset, search: issued.body.eventId });
      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      const record = response.body.records[0];
      const id = record.unit_id ?? record.event_id ?? record.request_key;
      const exported = await request(app)
        .post('/api/records/export')
        .set('Authorization', `Bearer ${token}`)
        .send({ filters: { dataset }, ids: [id] });
      expect(exported.status).toBe(200);
      expect(exported.body.records).toEqual([record]);
    }
  });

  it('rejects invalid collections, filters, pages and selections', async () => {
    for (const change of [
      { dataset: 'audit_logs; DROP TABLE blood_units' },
      { from: '2026-02-30' },
      { from: '2026-02-01', to: '2026-01-01' },
      { page: 0 },
      { pageSize: 101 },
      { dataset: 'bloodUnits', action: 'DONATION' },
      { outcome: 'UNKNOWN' },
      { search: 'x'.repeat(201) },
      { snapshotAt: 'yesterday' },
    ]) {
      expect(
        (
          await request(app)
            .get('/api/records')
            .set('Authorization', `Bearer ${token}`)
            .query({ dataset: 'auditLogs', ...change })
        ).status,
      ).toBe(400);
    }
    const id = randomUUID();
    for (const ids of [
      [],
      ['invalid'],
      [id, id],
      Array.from({ length: 201 }, () => randomUUID()),
    ]) {
      expect(
        (
          await request(app)
            .post('/api/records/export')
            .set('Authorization', `Bearer ${token}`)
            .send({ filters: { dataset: 'auditLogs' }, ids })
        ).status,
      ).toBe(400);
    }
  });
});
