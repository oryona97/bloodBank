import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createApp } from '../src/app.js';
import { createPool } from '../src/storage/database.js';
import { migrate } from '../src/storage/migrate.js';

const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  !new URL(connection).pathname.endsWith('_test') ||
  connection === process.env.DATABASE_URL
) {
  throw new Error('Use a separate TEST_DATABASE_URL ending in _test.');
}
const schema = `becs_${randomUUID().replaceAll('-', '')}`;
const owner = createPool(connection);
const pool = new Pool({ connectionString: connection, options: `-c search_path=${schema}` });
let clock = new Date();
const app = createApp(pool, { now: () => clock });
beforeEach(() => {
  clock = new Date();
});
const tokens: Record<string, string> = {};
const userIds: Record<string, string> = {};
const post = (role: string, path: string, body: Record<string, unknown>, key = randomUUID()) =>
  request(app)
    .post(`/api${path}`)
    .set('Authorization', `Bearer ${tokens[role]}`)
    .set('Idempotency-Key', key)
    .send(body);
const get = (role: string, path: string) =>
  request(app).get(`/api${path}`).set('Authorization', `Bearer ${tokens[role]}`);
async function intake(bloodType = 'A+', daysAgo = 1) {
  const collectedAt = new Date(Date.now() - daysAgo * 86400000).toISOString();
  const response = await post('OPERATOR', '/donations', {
    bloodType,
    donationDate: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(collectedAt)),
    collectedAt,
    donorId: '000000018',
    donorFullName: 'Synthetic Donor',
  });
  expect(response.status).toBe(201);
  return response.body.donationId as string;
}
async function clear(id: string, bloodType = 'A+') {
  for (const [testCode, value] of [
    ['ABO_RH', bloodType],
    ['HIV', 'NEGATIVE'],
    ['HBV', 'NEGATIVE'],
    ['HCV', 'NEGATIVE'],
    ['SYPHILIS', 'NEGATIVE'],
  ]) {
    const response = await post('LAB', `/donations/${id}/lab-results`, {
      testCode,
      value,
      performedAt: new Date().toISOString(),
    });
    expect(response.status).toBe(201);
  }
  return post('LAB', `/donations/${id}/release`, { decision: 'APPROVE' });
}

beforeAll(async () => {
  await owner.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  const hash = await bcrypt.hash('test-password', 4);
  for (const role of ['ADMIN', 'RESEARCHER', 'OPERATOR', 'LAB', 'DISPENSER']) {
    userIds[role] = randomUUID();
    await pool.query('INSERT INTO users(id, username, password_hash, role) VALUES ($1,$2,$3,$4)', [
      userIds[role],
      role,
      hash,
      role,
    ]);
    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: role, password: 'test-password' });
    tokens[role] = response.body.token;
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

describe('Approved BECS workflows', () => {
  it('audits laboratory result-history access with its donation and actor', async () => {
    const id = await intake();
    expect((await get('LAB', `/donations/${id}/lab-results`)).status).toBe(200);
    const audit = await get('ADMIN', '/records?dataset=auditLogs&action=LAB_RESULTS_VIEWED');
    expect(audit.body.records).toContainEqual(
      expect.objectContaining({
        actor: 'LAB',
        details: expect.objectContaining({ donationId: id }),
      }),
    );
  });
  it('does not allow a researcher to register donations', async () => {
    const response = await request(app)
      .post('/api/donations')
      .set('Authorization', `Bearer ${tokens.RESEARCHER}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        bloodType: 'A+',
        donationDate: '2026-10-01',
        donorId: '000000018',
        donorFullName: 'Synthetic Donor',
      });
    expect(response.status).toBe(403);
  });
  it('allows an administrator to create an operator account', async () => {
    await post('ADMIN', '/users', {
      username: 'operator-test',
      password: 'test-password',
      role: 'OPERATOR',
    });
    const response = await get('ADMIN', '/users');
    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ username: 'operator-test', role: 'OPERATOR' }),
      ]),
    );
  });
  it('separates administrative, laboratory and dispensing authority at the API', async () => {
    const requests = [
      post('ADMIN', '/donations', {}),
      post('LAB', '/donations', {}),
      post('OPERATOR', '/dispensing/preview', {}),
      post('LAB', '/dispensing/emergency', {}),
      get('RESEARCHER', '/export'),
      get('OPERATOR', '/records?dataset=auditLogs'),
    ];
    expect((await Promise.all(requests)).map((r) => r.status)).toEqual([
      403, 403, 403, 403, 403, 403,
    ]);
  });
  it('keeps a newly registered donation out of available inventory', async () => {
    const receipt = await post('OPERATOR', '/donations', {
      bloodType: 'O-',
      donationDate: '2026-10-01',
      donorId: '000000018',
      donorFullName: 'Synthetic Donor',
    });
    const response = await get('DISPENSER', '/inventory');
    expect({ created: receipt.status, stock: response.body.inventory['O-'] }).toEqual({
      created: 201,
      stock: 0,
    });
  });
  it('lets an operator produce distinct quarantined components linked to one donation', async () => {
    const id = await intake();
    const created = await post('OPERATOR', `/donations/${id}/components`, {
      template: 'PRBC_FFP_PLATELETS',
    });
    expect(created.status).toBe(201);
    const response = await get('OPERATOR', `/components?donationId=${id}`);
    expect(
      response.body.components
        .map((c: { productType: string; status: string; donationId: string }) => [
          c.productType,
          c.status,
          c.donationId,
        ])
        .sort(),
    ).toEqual([
      ['FFP', 'QUARANTINED', id],
      ['PRBC', 'QUARANTINED', id],
      ['Platelets', 'QUARANTINED', id],
    ]);
    expect(
      new Set(response.body.components.map((c: { componentId: string }) => c.componentId)).size,
    ).toBe(3);
  });
  it('blocks laboratory release while required results are missing', async () => {
    const id = await intake();
    const response = await post('LAB', `/donations/${id}/release`, { decision: 'APPROVE' });
    expect(response.status).toBe(409);
  });
  it('makes valid components available only after explicit laboratory approval', async () => {
    const id = await intake();
    await post('OPERATOR', `/donations/${id}/components`, { template: 'PRBC_FFP_PLATELETS' });
    expect((await clear(id)).status).toBe(200);
    const response = await get('DISPENSER', `/components?donationId=${id}`);
    expect(response.body.components.map((c: { status: string }) => c.status)).toEqual([
      'AVAILABLE',
      'AVAILABLE',
      'AVAILABLE',
    ]);
  });
  it('preserves a corrected result and immediately withdraws the previous release', async () => {
    const id = await intake();
    await post('OPERATOR', `/donations/${id}/components`, { template: 'PRBC_FFP' });
    await clear(id);
    await post('LAB', `/donations/${id}/lab-results`, {
      testCode: 'HIV',
      value: 'REACTIVE',
      performedAt: new Date().toISOString(),
      reason: 'Corrected laboratory report',
    });
    const components = await get('DISPENSER', `/components?donationId=${id}`);
    expect(components.body.components.map((c: { status: string }) => c.status)).toEqual([
      'QUARANTINED',
      'QUARANTINED',
    ]);
    const history = await get('LAB', `/donations/${id}/lab-results`);
    expect(
      history.body.results
        .filter((r: { testCode: string }) => r.testCode === 'HIV')
        .map((r: { value: string }) => r.value),
    ).toEqual(['NEGATIVE', 'REACTIVE']);
    expect((await post('LAB', `/donations/${id}/release`, { decision: 'APPROVE' })).status).toBe(
      409,
    );
  });
  it('dispenses an explicitly previewed released component once', async () => {
    const id = await intake('B-');
    await post('OPERATOR', `/donations/${id}/components`, { template: 'PRBC_FFP' });
    await clear(id, 'B-');
    const preview = await post('DISPENSER', '/dispensing/preview', {
      productType: 'PRBC',
      recipientType: 'B-',
      quantity: 1,
    });
    expect(preview.status).toBe(200);
    const response = await post('DISPENSER', '/dispensing/confirm', {
      productType: 'PRBC',
      recipientType: 'B-',
      quantity: 1,
      lines: preview.body.lines,
      componentIds: preview.body.componentIds,
      recipientReference: 'DEMO-RECIPIENT',
    });
    expect(response.status).toBe(200);
    const components = await get('DISPENSER', `/components?donationId=${id}`);
    expect(
      components.body.components.find((c: { productType: string }) => c.productType === 'PRBC')
        .status,
    ).toBe('DISPENSED');
  });
  it('issues only the requested quantity of cleared O-negative red cells in an emergency', async () => {
    const first = await intake('O-');
    const second = await intake('O-');
    for (const id of [first, second]) {
      await post('OPERATOR', `/donations/${id}/components`, { template: 'PRBC_FFP' });
      await clear(id, 'O-');
    }
    const response = await post('DISPENSER', '/dispensing/emergency', {
      quantity: 1,
      recipientReference: 'DEMO-EMERGENCY',
    });
    expect({
      status: response.status,
      productType: response.body.productType,
      quantity: response.body.quantity,
    }).toEqual({ status: 200, productType: 'PRBC', quantity: 1 });
    const components = (
      await Promise.all(
        [first, second].map((id) => get('DISPENSER', `/components?donationId=${id}`)),
      )
    ).flatMap((r) => r.body.components);
    expect(
      components.filter(
        (c: { productType: string; status: string }) =>
          c.productType === 'PRBC' && c.status === 'AVAILABLE',
      ),
    ).toHaveLength(1);
  });
  it('consumes a plasma source when producing cryoprecipitate without extending its expiry', async () => {
    const id = await intake();
    await post('OPERATOR', `/donations/${id}/components`, { template: 'PRBC_FFP' });
    const source = (await get('OPERATOR', `/components?donationId=${id}`)).body.components.find(
      (c: { productType: string }) => c.productType === 'FFP',
    );
    const created = await post('OPERATOR', `/components/${source.componentId}/process`, {
      productType: 'Cryoprecipitate',
    });
    expect(created.status).toBe(201);
    const result = (await get('OPERATOR', `/components?donationId=${id}`)).body.components;
    expect(
      result.find((c: { componentId: string }) => c.componentId === source.componentId).status,
    ).toBe('PROCESSED');
    expect(
      result.find((c: { productType: string }) => c.productType === 'Cryoprecipitate'),
    ).toMatchObject({
      sourceComponentId: source.componentId,
      expiresAt: source.expiresAt,
      status: 'QUARANTINED',
    });
    expect(
      (
        await post('OPERATOR', `/components/${source.componentId}/process`, {
          productType: 'Cryoprecipitate',
        })
      ).status,
    ).toBe(409);
  });
  it('rechecks expiry at confirmation and reports expiry immediately without a background job', async () => {
    const id = await intake('AB-');
    await post('OPERATOR', `/donations/${id}/components`, { template: 'PRBC_FFP' });
    await clear(id, 'AB-');
    const plan = (
      await post('DISPENSER', '/dispensing/preview', {
        productType: 'PRBC',
        recipientType: 'AB-',
        quantity: 1,
      })
    ).body;
    const component = (await get('DISPENSER', `/components?donationId=${id}`)).body.components.find(
      (c: { productType: string }) => c.productType === 'PRBC',
    );
    clock = new Date(component.expiresAt);
    const response = await post('DISPENSER', '/dispensing/confirm', {
      productType: 'PRBC',
      recipientType: 'AB-',
      quantity: 1,
      componentIds: plan.componentIds,
      lines: plan.lines,
      recipientReference: 'DEMO-EXPIRED',
    });
    expect(response.status).toBe(409);
    const expired = (await get('DISPENSER', `/components?donationId=${id}`)).body.components.find(
      (c: { productType: string }) => c.productType === 'PRBC',
    );
    expect(expired.status).toBe('EXPIRED');
    expect((await get('DISPENSER', '/inventory')).body.inventory['AB-']).toBe(0);
  });
  it('revokes an existing token when an administrator disables its account', async () => {
    await post('ADMIN', '/users', {
      username: 'revoked-user',
      password: 'test-password',
      role: 'DISPENSER',
    });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'revoked-user', password: 'test-password' });
    const user = (await get('ADMIN', '/users')).body.find(
      (u: { username: string }) => u.username === 'revoked-user',
    );
    expect((await post('ADMIN', `/users/${user.id}`, { active: false })).status).toBe(200);
    const response = await request(app)
      .get('/api/inventory')
      .set('Authorization', `Bearer ${login.body.token}`);
    expect(response.status).toBe(401);
  });
  it('rejects the legacy test-only password bypass', async () => {
    await pool.query('INSERT INTO users(id,username,password_hash,role) VALUES ($1,$2,$3,$4)', [
      randomUUID(),
      'invalid-hash-user',
      'hashed_pw',
      'DISPENSER',
    ]);
    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'invalid-hash-user', password: 'password123' });
    expect(response.status).toBe(401);
  });
  it('limits repeated failed sign-ins for one account', async () => {
    for (let i = 0; i < 10; i++)
      await request(app)
        .post('/api/auth/login')
        .send({ username: 'brute-force-test', password: 'wrong-password' });
    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'brute-force-test', password: 'wrong-password' });
    expect(response.status).toBe(429);
  });
  it('exports the expanded records and their audit trail without password hashes', async () => {
    const id = await intake();
    await post('OPERATOR', `/donations/${id}/components`, { template: 'PRBC_FFP' });
    await clear(id);
    const response = await get('ADMIN', '/export');
    expect(response.body.donations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ donation_id: id, lab_status: 'RELEASED' }),
      ]),
    );
    expect(
      response.body.bloodComponents.filter((c: { donation_id: string }) => c.donation_id === id),
    ).toHaveLength(2);
    expect(
      response.body.labResults.filter((r: { donation_id: string }) => r.donation_id === id),
    ).toHaveLength(5);
    expect(response.body.users.every((u: Record<string, unknown>) => !('password_hash' in u))).toBe(
      true,
    );
    expect(response.body.auditLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'LAB_RELEASED',
          details: expect.objectContaining({ donationId: id }),
        }),
      ]),
    );
  });
  it('does not accept tokens signed with the known fallback secret when a secret is configured', async () => {
    const configured = createApp(pool, {
      jwtSecret: 'configured-test-secret-with-more-than-32-characters',
    });
    const forged = jwt.sign(
      { id: userIds.ADMIN, username: 'ADMIN', role: 'ADMIN' },
      'fallback-secret-for-development-only',
    );
    const response = await request(configured)
      .get('/api/inventory')
      .set('Authorization', `Bearer ${forged}`);
    expect(response.status).toBe(401);
  });
  it('reports available stock and quarantine counts separately for each product', async () => {
    const id = await intake('B+');
    await post('OPERATOR', `/donations/${id}/components`, { template: 'PRBC_FFP_PLATELETS' });
    await clear(id, 'B+');
    const response = await get('RESEARCHER', '/inventory');
    expect(
      ['PRBC', 'FFP', 'Platelets', 'Cryoprecipitate'].map((p) => response.body.products[p]['B+']),
    ).toEqual([1, 1, 1, 0]);
    expect(response.body.activity).toEqual([]);
    expect(response.body.statusCounts.PRBC.AVAILABLE).toBeGreaterThan(0);
  });
  it('lets operators and laboratory staff resume donation work with role-appropriate information', async () => {
    const id = await intake('O+');
    const operator = await get('OPERATOR', `/donations?search=${id}`);
    expect(operator.body.donations).toEqual([
      expect.objectContaining({
        donationId: id,
        donorFullName: 'Synthetic Donor',
        labStatus: 'QUARANTINED',
      }),
    ]);
    const lab = await get('LAB', `/donations?search=${id}`);
    expect(lab.body.donations[0]).toMatchObject({ donationId: id, labStatus: 'QUARANTINED' });
    expect(lab.body.donations[0].donorFullName).toBeUndefined();
    expect((await get('RESEARCHER', '/donations')).status).toBe(403);
  });
  it('records a laboratory rejection and prevents later approval of that donation', async () => {
    const id = await intake('A-');
    await clear(id, 'A-');
    const rejected = await post('LAB', `/donations/${id}/release`, {
      decision: 'REJECT',
      reason: 'Sample handling failure',
    });
    expect(rejected.status).toBe(200);
    expect((await get('LAB', `/donations?search=${id}`)).body.donations[0].labStatus).toBe(
      'REJECTED',
    );
    expect((await post('LAB', `/donations/${id}/release`, { decision: 'APPROVE' })).status).toBe(
      409,
    );
  });
  it('allows a reasoned component discard without making it available on later lab approval', async () => {
    const id = await intake();
    await post('OPERATOR', `/donations/${id}/components`, { template: 'PRBC_FFP' });
    const component = (await get('OPERATOR', `/components?donationId=${id}`)).body.components[0];
    expect(
      (
        await post('OPERATOR', `/components/${component.componentId}/discard`, {
          reason: 'Damaged demonstration bag',
        })
      ).status,
    ).toBe(200);
    await clear(id);
    const discarded = (await get('OPERATOR', `/components?donationId=${id}`)).body.components.find(
      (c: { componentId: string }) => c.componentId === component.componentId,
    );
    expect(discarded).toMatchObject({
      status: 'DISCARDED',
      discardReason: 'Damaged demonstration bag',
    });
  });
  it('filters component stock by product, blood type, status and an expiry horizon', async () => {
    const id = await intake('O+');
    await post('OPERATOR', `/donations/${id}/components`, { template: 'PRBC_FFP_PLATELETS' });
    await clear(id, 'O+');
    const horizon = new Date(Date.now() + 7 * 86400000).toISOString();
    const response = await get(
      'OPERATOR',
      `/components?donationId=${id}&productType=Platelets&bloodType=O%2B&status=AVAILABLE&expiresBefore=${encodeURIComponent(horizon)}`,
    );
    expect(response.body.components).toEqual([
      expect.objectContaining({
        donationId: id,
        productType: 'Platelets',
        bloodType: 'O+',
        status: 'AVAILABLE',
      }),
    ]);
  });
  it('keeps shelf-life instants independent of the database daylight-saving timezone', async () => {
    const zonedPool = new Pool({
      connectionString: connection,
      options: `-c search_path=${schema} -c TimeZone=Asia/Jerusalem`,
    });
    const zonedApp = createApp(zonedPool);
    try {
      const login = await request(zonedApp)
        .post('/api/auth/login')
        .send({ username: 'OPERATOR', password: 'test-password' });
      const authorization = `Bearer ${login.body.token}`;
      const donation = await request(zonedApp)
        .post('/api/donations')
        .set('Authorization', authorization)
        .set('Idempotency-Key', randomUUID())
        .send({
          bloodType: 'A+',
          donationDate: '2026-10-10',
          collectedAt: '2026-10-10T08:00:00Z',
          donorId: '000000018',
          donorFullName: 'Synthetic Timezone Donor',
        });
      await request(zonedApp)
        .post(`/api/donations/${donation.body.donationId}/components`)
        .set('Authorization', authorization)
        .set('Idempotency-Key', randomUUID())
        .send({ template: 'PRBC_FFP' });
      const components = await request(zonedApp)
        .get(`/api/components?donationId=${donation.body.donationId}`)
        .set('Authorization', authorization);
      expect(
        components.body.components.find((c: { productType: string }) => c.productType === 'PRBC')
          .expiresAt,
      ).toBe('2026-11-21T08:00:00.000Z');
    } finally {
      await zonedPool.end();
    }
  });
  it('versions product policies without changing an existing component expiry', async () => {
    const id = await intake();
    await post('OPERATOR', `/donations/${id}/components`, { template: 'PRBC_FFP' });
    const before = (await get('OPERATOR', `/components?donationId=${id}`)).body.components.find(
      (c: { productType: string }) => c.productType === 'PRBC',
    );
    const changed = await post('ADMIN', '/catalog/products', {
      productType: 'PRBC',
      expiryDays: 35,
    });
    expect(changed.status).toBe(201);
    const after = (await get('OPERATOR', `/components?donationId=${id}`)).body.components.find(
      (c: { productType: string }) => c.productType === 'PRBC',
    );
    expect({ expiry: after.expiresAt, version: after.policyVersion }).toEqual({
      expiry: before.expiresAt,
      version: before.policyVersion,
    });
    const catalogue = await get('ADMIN', '/catalog');
    expect(catalogue.body.products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PRBC', policy_version: 2, expiry_days: 35 }),
      ]),
    );
  });
  it('browses and selectively exports the new component records', async () => {
    const id = await intake();
    await post('OPERATOR', `/donations/${id}/components`, { template: 'PRBC_FFP' });
    const browsed = await get('ADMIN', `/records?dataset=bloodComponents&search=${id}`);
    expect(browsed.status).toBe(200);
    expect(browsed.body.records).toHaveLength(2);
    const selected = browsed.body.records[0].component_id;
    const exported = await post('ADMIN', '/records/export', {
      filters: { dataset: 'bloodComponents', search: id },
      ids: [selected],
    });
    expect(exported.body.records.map((r: { component_id: string }) => r.component_id)).toEqual([
      selected,
    ]);
  });
  it('rejects laboratory test timestamps earlier than the collection', async () => {
    const id = await intake();
    const response = await post('LAB', `/donations/${id}/lab-results`, {
      testCode: 'HIV',
      value: 'NEGATIVE',
      performedAt: '2000-01-01T00:00:00Z',
    });
    expect(response.status).toBe(400);
  });
  it('rejects a collection timestamp that disagrees with the recorded calendar date', async () => {
    const response = await post('OPERATOR', '/donations', {
      bloodType: 'A+',
      donationDate: '2026-01-01',
      collectedAt: '2026-10-01T09:00:00Z',
      donorId: '000000018',
      donorFullName: 'Synthetic Donor',
    });
    expect(response.status).toBe(400);
  });
  it('accepts the documented maximum component selection size before checking stock', async () => {
    const response = await post('DISPENSER', '/dispensing/confirm', {
      productType: 'PRBC',
      recipientType: 'A+',
      quantity: 1000,
      componentIds: Array.from({ length: 1000 }, () => randomUUID()),
      lines: [{ bloodType: 'A+', quantity: 1000 }],
      recipientReference: 'DEMO-LARGE-REQUEST',
    });
    expect(response.status).toBe(409);
  });
});
