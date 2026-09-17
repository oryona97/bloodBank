import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createPool } from '../src/storage/database.js';
import { migrate } from '../src/storage/migrate.js';
import { login, testUser, resetTestData } from './authHelpers.js';
import type { User } from '../../shared/apiTypes.js';
import { mutate } from '../src/services/inventoryService.js';
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
const pool = createPool(connection);
const app = createApp(pool);
let client: Awaited<ReturnType<typeof login>>['agent'];
let staff: User;
const donation = (bloodType: BloodType = 'A+') => ({
  bloodType,
  donationDate: '2026-01-01',
  donorId: '000000018',
  donorFullName: 'Synthetic Test Donor',
});
function add(type: BloodType = 'A+', key = randomUUID()) {
  return client.post('/api/donations').set('Idempotency-Key', key).send(donation(type));
}
async function preview(recipientType: BloodType, quantity: number): Promise<Allocation> {
  const response = await client.post('/api/dispensing/preview').send({ recipientType, quantity });
  expect(response.status).toBe(200);
  return response.body as Allocation;
}
function confirm(plan: Allocation, key = randomUUID()) {
  return client
    .post('/api/dispensing/confirm')
    .set('Idempotency-Key', key)
    .send({ recipientType: plan.recipientType, quantity: plan.quantity, lines: plan.lines });
}
function emergency(key = randomUUID()) {
  return client.post('/api/dispensing/emergency').set('Idempotency-Key', key).send({});
}
async function inventory() {
  return (await client.get('/api/inventory')).body.inventory;
}

beforeAll(async () => {
  await migrate(pool);
});
beforeEach(async () => {
  await resetTestData(pool);
  staff = await testUser(pool, 'STAFF');
  client = (await login(app, staff.username)).agent;
});
afterAll(async () => {
  await pool.end();
});

describe('PostgreSQL-backed API', () => {
  it('returns all eight zero counts and health status', async () => {
    expect(await inventory()).toEqual(emptyInventory());
    expect((await client.get('/api/health')).status).toBe(200);
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
      const response = await client
        .post('/api/donations')
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
        (await client.post('/api/dispensing/preview').send({ recipientType: 'A+', quantity }))
          .status,
      ).toBe(400);
    }
    expect((await client.post('/api/donations').send(donation())).status).toBe(400);
  });
  it('does not mutate stock on preview and uses oldest donation first', async () => {
    const first = await add();
    await client
      .post('/api/donations')
      .set('Idempotency-Key', randomUUID())
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
      mutate(
        pool,
        key,
        'failure-test',
        {},
        async (client) => {
          await client.query("UPDATE blood_units SET status = 'DISPENSED'");
          await client.query(
            "INSERT INTO dispense_events(event_id, mode) VALUES ($1, 'EMERGENCY')",
            [randomUUID()],
          );
          throw new Error('Simulated failure after writes');
        },
        staff,
      ),
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
    const freshPool = createPool(connection);
    try {
      const freshClient = (await login(createApp(freshPool), staff.username)).agent;
      expect((await freshClient.get('/api/inventory')).body.inventory['B-']).toBe(1);
    } finally {
      await freshPool.end();
    }
  });
});
