import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { Pool } from 'pg';
import { beforeAll, afterAll, it, expect, describe } from 'vitest';
import { createApp } from '../src/app.js';
import { createPool } from '../src/storage/database.js';
import { migrate } from '../src/storage/migrate.js';

const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  !new URL(connection).pathname.endsWith('_test') ||
  connection === process.env.DATABASE_URL
)
  throw new Error('Use a separate test database ending in _test.');
const schema = `roles_${randomUUID().replaceAll('-', '')}`,
  owner = createPool(connection);
const pool = new Pool({ connectionString: connection, options: `-c search_path=${schema}` }),
  app = createApp(pool);
const tokens: Record<string, string> = {};
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
    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: role, password: 'test-password' });
    expect(response.status).toBe(200);
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
describe('Role separation and authentication', () => {
  it('I13 rejects a correctly signed token whose expiry has passed', async () => {
    const secret = 'expired-token-test-secret-longer-than-32-characters';
    const configured = createApp(pool, { jwtSecret: secret });
    const login = await request(configured)
      .post('/api/auth/login')
      .send({ username: 'LAB', password: 'test-password' });
    expect(login.status).toBe(200);
    const expired = jwt.sign({ id: login.body.user.id, username: 'LAB', role: 'LAB' }, secret, {
      expiresIn: -1,
    });
    expect(
      (await request(configured).get('/api/inventory').set('Authorization', `Bearer ${expired}`))
        .status,
    ).toBe(401);
  });
  it('I12 enforces every denied role and protected-route combination before processing payloads', async () => {
    const id = randomUUID();
    const operations: [string, string, string[]][] = [
      ['GET', '/donations', ['ADMIN', 'OPERATOR', 'LAB']],
      ['GET', '/components', ['ADMIN', 'OPERATOR', 'LAB', 'DISPENSER']],
      ['GET', '/catalog', ['ADMIN', 'OPERATOR', 'LAB', 'DISPENSER']],
      ['GET', '/export', ['ADMIN']],
      ['GET', '/records?dataset=donations', ['ADMIN']],
      ['GET', '/users', ['ADMIN']],
      ['GET', `/donations/${id}/lab-results`, ['LAB']],
      ['POST', '/users', ['ADMIN']],
      ['POST', `/users/${id}`, ['ADMIN']],
      ['POST', '/catalog/products', ['ADMIN']],
      ['POST', '/catalog/panels', ['ADMIN']],
      ['POST', '/records/export', ['ADMIN']],
      ['POST', '/donations', ['OPERATOR']],
      ['POST', `/donations/${id}/components`, ['OPERATOR']],
      ['POST', `/components/${id}/process`, ['OPERATOR']],
      ['POST', `/components/${id}/legacy-details`, ['OPERATOR']],
      ['POST', `/components/${id}/discard`, ['OPERATOR', 'LAB']],
      ['POST', `/donations/${id}/lab-results`, ['LAB']],
      ['POST', `/donations/${id}/release`, ['LAB']],
      ['POST', '/dispensing/preview', ['DISPENSER']],
      ['POST', '/dispensing/confirm', ['DISPENSER']],
      ['POST', '/dispensing/emergency', ['DISPENSER']],
      ['POST', '/activities/cancel', ['DISPENSER']],
    ];
    for (const role of ['ADMIN', 'OPERATOR', 'LAB', 'DISPENSER', 'RESEARCHER'])
      for (const [method, path, allowed] of operations)
        if (!allowed.includes(role)) {
          const call =
            method === 'GET'
              ? request(app).get('/api' + path)
              : request(app)
                  .post('/api' + path)
                  .send({});
          const response = await call
            .set('Authorization', `Bearer ${tokens[role]}`)
            .set('Idempotency-Key', randomUUID());
          expect(response.status, `${role} ${method} ${path}`).toBe(403);
        }
  });
  it('does not create an account when its success audit cannot be saved', async () => {
    await pool.query(
      "CREATE FUNCTION fail_user_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='USER_CREATED' THEN RAISE EXCEPTION 'simulated audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_user_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_user_audit()",
    );
    try {
      const response = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${tokens.ADMIN}`)
        .send({ username: 'rollback-account', password: 'test-password', role: 'RESEARCHER' });
      expect(response.status).toBe(503);
      const users = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${tokens.ADMIN}`);
      expect(users.body.some((u: { username: string }) => u.username === 'rollback-account')).toBe(
        false,
      );
    } finally {
      await pool.query(
        'DROP TRIGGER fail_user_audit ON audit_logs; DROP FUNCTION fail_user_audit()',
      );
    }
  });
  it('records successful sign-in attribution without exposing credentials', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'LAB', password: 'test-password' });
    expect(response.status).toBe(200);
    const records = await request(app)
      .get('/api/records?dataset=auditLogs&action=LOGIN_SUCCEEDED')
      .set('Authorization', `Bearer ${tokens.ADMIN}`);
    expect(records.body.records).toContainEqual(
      expect.objectContaining({
        actor: 'LAB',
        details: expect.objectContaining({ role: 'LAB' }),
        context: expect.objectContaining({ userId: response.body.user.id, role: 'LAB' }),
      }),
    );
    expect(JSON.stringify(records.body.records)).not.toContain('test-password');
    expect(JSON.stringify(records.body.records)).not.toContain(response.body.token);
  });
  it('requires a valid, signed, unexpired token', async () => {
    for (const token of ['', 'invalid.jwt.value'])
      expect(
        (await request(app).get('/api/inventory').set('Authorization', `Bearer ${token}`)).status,
      ).toBe(401);
  });
  it('rejects malformed sign-in payloads', async () => {
    for (const body of [
      { username: [] as string[], password: 'x' },
      { username: 'ADMIN' },
      { username: 'ADMIN', password: 'x', role: 'ADMIN' },
    ])
      expect((await request(app).post('/api/auth/login').send(body)).status).toBe(400);
  });
  it.each([
    ['ADMIN', '/donations'],
    ['ADMIN', '/dispensing/preview'],
    ['ADMIN', '/dispensing/emergency'],
    ['OPERATOR', '/dispensing/confirm'],
    ['OPERATOR', `/donations/${randomUUID()}/release`],
    ['OPERATOR', `/donations/${randomUUID()}/lab-results`],
    ['LAB', '/donations'],
    ['LAB', '/dispensing/emergency'],
    ['LAB', '/users'],
    ['DISPENSER', '/donations'],
    ['DISPENSER', `/donations/${randomUUID()}/release`],
    ['DISPENSER', '/catalog/products'],
    ['RESEARCHER', '/donations'],
    ['RESEARCHER', '/dispensing/emergency'],
    ['RESEARCHER', '/records/export'],
  ])('denies %s writing %s', async (role, path) => {
    const response = await request(app)
      .post(`/api${path}`)
      .set('Authorization', `Bearer ${tokens[role]}`)
      .set('Idempotency-Key', randomUUID())
      .send({});
    expect(response.status).toBe(403);
  });
  it.each([
    '/export',
    '/records?dataset=donations',
    '/components',
    '/donations',
    '/users',
    '/catalog',
  ])('gives a researcher no identifiable records at %s', async (path) => {
    expect(
      (await request(app).get(`/api${path}`).set('Authorization', `Bearer ${tokens.RESEARCHER}`))
        .status,
    ).toBe(403);
  });
  it('requires a new sign-in after a role change', async () => {
    const users = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${tokens.ADMIN}`);
    const target = users.body.find((u: { role: string }) => u.role === 'DISPENSER');
    const changed = await request(app)
      .post(`/api/users/${target.id}`)
      .set('Authorization', `Bearer ${tokens.ADMIN}`)
      .set('Idempotency-Key', randomUUID())
      .send({ role: 'OPERATOR' });
    expect(changed.status).toBe(200);
    expect(
      (await request(app).get('/api/inventory').set('Authorization', `Bearer ${tokens.DISPENSER}`))
        .status,
    ).toBe(401);
  });
});
