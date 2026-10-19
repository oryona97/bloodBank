import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { Pool } from 'pg';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { createPool } from '../src/storage/database.js';
import { migrate } from '../src/storage/migrate.js';
import type { BloodType } from '../../shared/apiTypes.js';
import type { BecsAllocation } from '../../shared/becsTypes.js';

const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  !new URL(connection).pathname.endsWith('_test') ||
  connection === process.env.DATABASE_URL
)
  throw new Error('Use a separate test database ending in _test.');
const schema = `regression_${randomUUID().replaceAll('-', '')}`,
  owner = createPool(connection);
const pool = new Pool({ connectionString: connection, options: `-c search_path=${schema}` });
const secret = 'regression-signing-secret-with-more-than-32-characters';
const app = createApp(pool, { jwtSecret: secret });
const tokens: Record<string, string> = {};
const post = (role: string, path: string, body: object, key = randomUUID()) =>
  request(app)
    .post(`/api${path}`)
    .set('Authorization', `Bearer ${tokens[role]}`)
    .set('Idempotency-Key', key)
    .send(body);
const get = (role: string, path: string) =>
  request(app).get(`/api${path}`).set('Authorization', `Bearer ${tokens[role]}`);
const intakeBody = (bloodType: BloodType = 'A+') => {
  const collectedAt = new Date(Date.now() - 86400000).toISOString();
  return {
    bloodType,
    collectedAt,
    donationDate: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(collectedAt)),
    donorId: '000000018',
    donorFullName: 'Synthetic Regression Donor',
  };
};
async function usable(bloodType: BloodType = 'A+') {
  const donation = await post('OPERATOR', '/donations', intakeBody(bloodType));
  expect(donation.status).toBe(201);
  const id = donation.body.donationId as string;
  expect(
    (await post('OPERATOR', `/donations/${id}/components`, { template: 'PRBC_FFP' })).status,
  ).toBe(201);
  for (const [testCode, value] of [
    ['ABO_RH', bloodType],
    ['HIV', 'NEGATIVE'],
    ['HBV', 'NEGATIVE'],
    ['HCV', 'NEGATIVE'],
    ['SYPHILIS', 'NEGATIVE'],
  ])
    expect(
      (
        await post('LAB', `/donations/${id}/lab-results`, {
          testCode,
          value,
          performedAt: new Date().toISOString(),
        })
      ).status,
    ).toBe(201);
  expect((await post('LAB', `/donations/${id}/release`, { decision: 'APPROVE' })).status).toBe(200);
  return id;
}
async function preview(type: BloodType, quantity = 1) {
  const response = await post('DISPENSER', '/dispensing/preview', {
    productType: 'PRBC',
    recipientType: type,
    quantity,
  });
  expect(response.status).toBe(200);
  return response.body as BecsAllocation;
}
const confirm = (plan: BecsAllocation, key = randomUUID()) =>
  post(
    'DISPENSER',
    '/dispensing/confirm',
    {
      productType: plan.productType,
      recipientType: plan.recipientType,
      quantity: plan.quantity,
      lines: plan.lines,
      componentIds: plan.componentIds,
      recipientReference: 'DEMO-REGRESSION',
    },
    key,
  );
async function components(id: string) {
  return (await get('DISPENSER', `/components?donationId=${id}`)).body.components as {
    componentId: string;
    productType: string;
    status: string;
  }[];
}

beforeAll(async () => {
  await owner.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  const hash = await bcrypt.hash('test-password', 4);
  for (const role of ['ADMIN', 'OPERATOR', 'LAB', 'DISPENSER', 'RESEARCHER']) {
    await pool.query('INSERT INTO users(id,username,password_hash,role) VALUES ($1,$2,$3,$4)', [
      randomUUID(),
      role,
      hash,
      role,
    ]);
    tokens[role] = (
      await request(app).post('/api/auth/login').send({ username: role, password: 'test-password' })
    ).body.token;
  }
});
afterAll(async () => {
  await pool.end();
  try {
    await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    await owner.end();
  }
});

describe('Approved workflow regressions at the HTTP seam', () => {
  it('requires an explicit collection timestamp without creating an inferred donation', async () => {
    const { collectedAt: _omitted, ...body } = intakeBody();
    const before = (await get('ADMIN', '/records?dataset=donations')).body.total;
    const response = await post('OPERATOR', '/donations', body);
    expect(response.status).toBe(400);
    expect((await get('ADMIN', '/records?dataset=donations')).body.total).toBe(before);
  });
  it('rejects invalid donor data and impossible calendar dates', async () => {
    const base = intakeBody();
    for (const invalid of [
      { ...base, donorId: '18' },
      { ...base, bloodType: 'X+' },
      { ...base, donationDate: '2026-02-30' },
      { ...base, donationDate: '2999-01-01' },
      { ...base, collectedAt: '2999-01-01T00:00:00Z' },
    ])
      expect((await post('OPERATOR', '/donations', invalid)).status).toBe(400);
  });
  it('requires UUID request keys and whole positive quantities', async () => {
    expect(
      (
        await request(app)
          .post('/api/donations')
          .set('Authorization', `Bearer ${tokens.OPERATOR}`)
          .send(intakeBody())
      ).status,
    ).toBe(400);
    for (const quantity of [0, -1, 1.5, 1001])
      expect(
        (
          await post('DISPENSER', '/dispensing/preview', {
            productType: 'PRBC',
            recipientType: 'A+',
            quantity,
          })
        ).status,
      ).toBe(400);
  });
  it('makes preview and cancellation leave all components unchanged', async () => {
    const id = await usable('A+'),
      before = await components(id);
    await preview('A+');
    await post('DISPENSER', '/activities/cancel', {
      operation: 'ROUTINE',
      recipientType: 'A+',
      quantity: 1,
    });
    expect(await components(id)).toEqual(before);
  });
  it('rejects a forged incompatible component selection without issuing it', async () => {
    const id = await usable('B+');
    const component = (await components(id)).find((c) => c.productType === 'PRBC')!;
    const response = await post('DISPENSER', '/dispensing/confirm', {
      productType: 'PRBC',
      recipientType: 'O-',
      quantity: 1,
      lines: [{ bloodType: 'B+', quantity: 1 }],
      componentIds: [component.componentId],
      recipientReference: 'DEMO-FORGED',
    });
    expect(response.status).toBe(409);
    expect(
      (await components(id)).find((c) => c.componentId === component.componentId)?.status,
    ).toBe('AVAILABLE');
  });
  it('rejects a stale component preview after the stock was issued', async () => {
    await usable('A-');
    const plan = await preview('A-');
    expect((await confirm(plan)).status).toBe(200);
    expect((await confirm(plan)).status).toBe(409);
  });
  it('deduplicates a retry and rejects reuse with different contents', async () => {
    const body = intakeBody('AB+'),
      key = randomUUID();
    const first = await post('OPERATOR', '/donations', body, key),
      retry = await post('OPERATOR', '/donations', body, key);
    expect(retry.body).toEqual(first.body);
    expect((await post('OPERATOR', '/donations', { ...body, bloodType: 'AB-' }, key)).status).toBe(
      409,
    );
    const audit = await get('ADMIN', `/records?dataset=auditLogs&search=${key}`);
    expect(audit.body.records).toContainEqual(
      expect.objectContaining({
        outcome: 'REJECTED',
        request_key: key,
        details: expect.objectContaining({ code: 'REQUEST_KEY_REUSED' }),
      }),
    );
  });
  it('deduplicates simultaneous stock requests with the same key', async () => {
    await usable('B-');
    const plan = await preview('B-'),
      key = randomUUID();
    const results = await Promise.all([confirm(plan, key), confirm(plan, key)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results[0]!.body).toEqual(results[1]!.body);
  });
  it('serializes routine and emergency attempts for the same red cell', async () => {
    await usable('O-');
    const plan = await preview('O-');
    const results = await Promise.all([
      confirm(plan),
      post('DISPENSER', '/dispensing/emergency', {
        quantity: 1,
        recipientReference: 'DEMO-CONCURRENT',
      }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  it('returns the original emergency receipt after new donations arrive', async () => {
    await usable('O-');
    const key = randomUUID(),
      body = { quantity: 1, recipientReference: 'DEMO-RETRY' };
    const first = await post('DISPENSER', '/dispensing/emergency', body, key);
    await usable('O-');
    expect((await post('DISPENSER', '/dispensing/emergency', body, key)).body).toEqual(first.body);
  });
  it('rolls back a stock change when its success audit cannot be stored', async () => {
    const id = await usable('AB-'),
      plan = await preview('AB-');
    // Inject a database-boundary fault; observe recovery only through the API.
    await pool.query(
      "CREATE FUNCTION fail_issue_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='DISPENSE_ROUTINE' THEN RAISE EXCEPTION 'simulated audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_issue_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_issue_audit()",
    );
    try {
      expect((await confirm(plan)).status).toBe(503);
      expect((await components(id)).find((c) => c.productType === 'PRBC')?.status).toBe(
        'AVAILABLE',
      );
    } finally {
      await pool.query(
        'DROP TRIGGER fail_issue_audit ON audit_logs; DROP FUNCTION fail_issue_audit()',
      );
    }
  });
  it('retains stock across a fresh application connection', async () => {
    const id = await usable('O+');
    const second = new Pool({ connectionString: connection, options: `-c search_path=${schema}` });
    try {
      const response = await request(createApp(second, { jwtSecret: secret }))
        .get(`/api/components?donationId=${id}`)
        .set('Authorization', `Bearer ${tokens.DISPENSER}`);
      expect(response.body.components).toHaveLength(2);
    } finally {
      await second.end();
    }
  });
  it('audits denied requests without recording malformed payloads', async () => {
    const response = await post('RESEARCHER', '/donations', {
      password: 'do-not-copy-this-malformed-payload',
    });
    const records = await get(
      'ADMIN',
      `/records?dataset=auditLogs&search=${response.headers['x-request-id']}`,
    );
    expect(records.body.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'REQUEST_FAILED',
          outcome: 'REJECTED',
          actor: 'RESEARCHER',
        }),
      ]),
    );
    expect(JSON.stringify(records.body.records)).not.toContain(
      'do-not-copy-this-malformed-payload',
    );
  });
  it('keeps audit pagination at the requested snapshot', async () => {
    const initial = await get(
      'ADMIN',
      '/records?dataset=auditLogs&pageSize=2&action=INVENTORY_VIEWED',
    );
    await get('RESEARCHER', '/inventory');
    const same = await get(
      'ADMIN',
      `/records?dataset=auditLogs&pageSize=2&action=INVENTORY_VIEWED&snapshotAt=${encodeURIComponent(initial.body.snapshotAt)}`,
    );
    expect(same.body.records).toEqual(initial.body.records);
  });
  it('exports all filter matches beyond one record page', async () => {
    const ids = [];
    for (let i = 0; i < 3; i++)
      ids.push((await post('OPERATOR', '/donations', intakeBody())).body.donationId);
    const page = await get('ADMIN', '/records?dataset=donations&pageSize=1');
    const exported = await post('ADMIN', '/records/export', {
      filters: { dataset: 'donations', snapshotAt: page.body.snapshotAt },
    });
    expect(exported.body.recordCount).toBeGreaterThan(page.body.records.length);
    expect(
      ids.every((id) =>
        exported.body.records.some((r: { donation_id: string }) => r.donation_id === id),
      ),
    ).toBe(true);
  });
  it('rejects invalid collections, date ranges, pages and duplicate export IDs', async () => {
    for (const path of [
      '/records?dataset=unknown',
      '/records?dataset=donations&page=0',
      '/records?dataset=donations&from=2026-10-02&to=2026-10-01',
    ])
      expect((await get('ADMIN', path)).status).toBe(400);
    const id = randomUUID();
    expect(
      (
        await post('ADMIN', '/records/export', {
          filters: { dataset: 'bloodComponents' },
          ids: [id, id],
        })
      ).status,
    ).toBe(400);
  });
});
