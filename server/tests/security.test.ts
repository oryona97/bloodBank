import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool } from '../src/storage/database.js';
import { migrate } from '../src/storage/migrate.js';
import { createApp } from '../src/app.js';
import { login, resetTestData, testPassword, testUser } from './authHelpers.js';
import { ROLES, type User } from '../../shared/apiTypes.js';
import { grantRuntimePrivileges } from '../src/storage/runtimePrivileges.js';

const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  !new URL(connection).pathname.endsWith('_test') ||
  connection === process.env.DATABASE_URL
)
  throw new Error('Configure a separate _test database.');
const pool = createPool(connection);
const app = createApp(pool);
let admin: User;
let staff: User;
let researcher: User;
const donation = {
  bloodType: 'A+',
  donationDate: '2025-01-01',
  donorId: '123456789',
  donorFullName: 'Synthetic Private Donor',
};
beforeAll(async () => {
  await migrate(pool);
});
beforeEach(async () => {
  await resetTestData(pool);
  admin = await testUser(pool, 'ADMIN');
  staff = await testUser(pool, 'STAFF');
  researcher = await testUser(pool, 'RESEARCHER');
});
afterAll(async () => {
  await pool.end();
});

describe('Identity and access boundaries', () => {
  it('denies anonymous reads and writes without leaking records', async () => {
    for (const path of [
      '/inventory',
      '/export',
      '/admin/users',
      '/admin/audit',
      '/research/summary',
    ])
      expect((await request(app).get(`/api${path}`)).status).toBe(401);
    expect((await request(app).post('/api/donations').send(donation)).status).toBe(401);
  });
  it('enforces every role on all operational endpoints, admin data and research', async () => {
    for (const role of ROLES) {
      const { agent } = await login(app, role.toLowerCase());
      expect((await agent.get('/api/research/summary')).status).toBe(200);
      expect((await agent.get('/api/inventory')).status).toBe(role === 'RESEARCHER' ? 403 : 200);
      for (const path of ['/export', '/admin/users', '/admin/audit'])
        expect((await agent.get(`/api${path}`)).status).toBe(role === 'ADMIN' ? 200 : 403);
      for (const path of [
        '/donations',
        '/dispensing/preview',
        '/dispensing/confirm',
        '/dispensing/emergency',
      ]) {
        const response = await agent.post(`/api${path}`).send({});
        expect(response.status).toBe(role === 'RESEARCHER' ? 403 : 400);
      }
      expect((await agent.post('/api/admin/users').send({})).status).toBe(
        role === 'ADMIN' ? 400 : 403,
      );
      expect(
        (await agent.post(`/api/admin/users/${staff.id}`).send({ active: false })).status,
      ).toBe(role === 'ADMIN' ? 200 : 403);
      // Restore the staff account after the admin iteration for this matrix.
      if (role === 'ADMIN')
        await pool.query('UPDATE users SET active=true WHERE id=$1', [staff.id]);
    }
  });
  it('rejects forged roles and missing CSRF; cookies are HttpOnly and session secrets stay out of DTOs', async () => {
    const signed = await login(app, researcher.username);
    expect(String(signed.response.headers['set-cookie']?.[0])).toContain('HttpOnly');
    expect(String(signed.response.headers['set-cookie']?.[0])).toContain('SameSite=Strict');
    expect(JSON.stringify(signed.response.body)).not.toMatch(/password_hash|token_hash/);
    expect(
      (await signed.agent.post('/api/donations').send({ ...donation, role: 'ADMIN' })).status,
    ).toBe(403);
    const staffLogin = await login(app, staff.username);
    expect(
      (await staffLogin.agent.post('/api/donations').set('X-CSRF-Token', '').send(donation)).status,
    ).toBe(403);
    expect((await pool.query('SELECT * FROM blood_units')).rowCount).toBe(0);
    expect(
      (
        await request(app)
          .post('/api/auth/login')
          .send({ username: 'admin', password: testPassword })
      ).status,
    ).toBe(403);
  });
  it('uses generic credential errors and rate limits login attempts', async () => {
    const attempt = (username: string) =>
      request(app)
        .post('/api/auth/login')
        .set('X-Requested-With', 'BloodBank')
        .send({ username, password: 'wrong-password' });
    expect((await attempt('missing')).body).toEqual((await attempt('staff')).body);
    for (let i = 0; i < 9; i++) expect((await attempt('staff')).status).toBe(401);
    expect((await attempt('staff')).status).toBe(429);
    expect(
      (await pool.query("SELECT id FROM audit_logs WHERE action='LOGIN_THROTTLED'")).rowCount,
    ).toBe(1);
  });
  it('expires idle and absolute sessions and revokes logout sessions', async () => {
    let signed = await login(app, staff.username);
    await pool.query("UPDATE sessions SET last_seen_at=now()-interval '16 minutes'");
    expect((await signed.agent.get('/api/auth/me')).status).toBe(401);
    signed = await login(app, staff.username);
    await pool.query("UPDATE sessions SET expires_at=now()-interval '1 second'");
    expect((await signed.agent.get('/api/auth/me')).status).toBe(401);
    signed = await login(app, staff.username);
    expect((await signed.agent.post('/api/auth/logout').send({})).status).toBe(200);
    expect((await signed.agent.get('/api/auth/me')).status).toBe(401);
  });
  it('creates accounts with hashed temporary passwords and forces a password change', async () => {
    const { agent } = await login(app, admin.username);
    const created = await agent
      .post('/api/admin/users')
      .send({
        username: 'New.User',
        displayName: 'New Researcher',
        role: 'RESEARCHER',
        password: testPassword,
      });
    expect(created.status).toBe(201);
    expect(created.body.username).toBe('new.user');
    expect(created.body).not.toHaveProperty('password_hash');
    const hash = (
      await pool.query('SELECT password_hash FROM users WHERE id=$1', [created.body.id])
    ).rows[0].password_hash;
    expect(hash).not.toBe(testPassword);
    expect(hash).toMatch(/^scrypt-v1:/);
    const signed = await login(app, 'new.user');
    expect((await signed.agent.get('/api/research/summary')).body.code).toBe(
      'PASSWORD_CHANGE_REQUIRED',
    );
    const nextPassword = 'A-Different-Password-42';
    expect(
      (
        await signed.agent
          .post('/api/auth/password')
          .send({ currentPassword: testPassword, password: nextPassword })
      ).status,
    ).toBe(200);
    expect((await signed.agent.get('/api/auth/me')).status).toBe(401);
    expect(
      (await (await login(app, 'new.user', nextPassword)).agent.get('/api/research/summary'))
        .status,
    ).toBe(200);
  });
  it('revokes sessions on role change, disable and password reset', async () => {
    const { agent } = await login(app, admin.username);
    for (const update of [
      { role: 'RESEARCHER' },
      { password: 'Reset-Password-1234' },
      { active: false },
    ]) {
      const password = 'active' in update ? 'Reset-Password-1234' : testPassword;
      const signed = await login(app, staff.username, password);
      expect((await agent.post(`/api/admin/users/${staff.id}`).send(update)).status).toBe(200);
      expect((await signed.agent.get('/api/auth/me')).status).toBe(401);
    }
  });
  it('preserves an active administrator under concurrent demotions', async () => {
    const other = await testUser(pool, 'ADMIN', 'admin2');
    const a = (await login(app, admin.username)).agent;
    const b = (await login(app, other.username)).agent;
    const results = await Promise.all([
      a.post(`/api/admin/users/${admin.id}`).send({ role: 'STAFF' }),
      b.post(`/api/admin/users/${other.id}`).send({ active: false }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await pool.query("SELECT id FROM users WHERE active AND role='ADMIN'")).rowCount).toBe(
      1,
    );
  });
  it('does not replay another actor or legacy request receipts', async () => {
    const a = (await login(app, admin.username)).agent;
    const s = (await login(app, staff.username)).agent;
    const key = randomUUID();
    expect((await a.post('/api/donations').set('Idempotency-Key', key).send(donation)).status).toBe(
      201,
    );
    expect((await s.post('/api/donations').set('Idempotency-Key', key).send(donation)).status).toBe(
      409,
    );
    await pool.query('UPDATE operation_requests SET actor_id=NULL WHERE request_key=$1', [key]);
    expect((await a.post('/api/donations').set('Idempotency-Key', key).send(donation)).status).toBe(
      409,
    );
    expect((await pool.query('SELECT * FROM blood_units')).rowCount).toBe(1);
  });
});

describe('Privacy, audit and record copies', () => {
  it('enforces restricted runtime privileges and prevents history truncation', async () => {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('CREATE ROLE bloodbank_security_test NOLOGIN NOSUPERUSER NOINHERIT');
      await grantRuntimePrivileges(db, 'bloodbank_security_test');
      await db.query('SET LOCAL ROLE bloodbank_security_test');
      await db.query(
        "INSERT INTO audit_logs(action,details,attribution) VALUES ('RUNTIME_TEST','{}','SYSTEM')",
      );
      await db.query('SELECT * FROM blood_units');
      for (const sql of [
        'TRUNCATE audit_logs',
        'DELETE FROM audit_logs',
        "UPDATE audit_logs SET action='bad'",
        'DELETE FROM research_snapshots',
        'ALTER TABLE audit_logs DISABLE TRIGGER ALL',
      ]) {
        await db.query('SAVEPOINT forbidden');
        await expect(db.query(sql)).rejects.toMatchObject({ code: '42501' });
        await db.query('ROLLBACK TO SAVEPOINT forbidden');
      }
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
  });
  it('suppresses repeated donations from fewer than five distinct donors', async () => {
    const worker = (await login(app, staff.username)).agent;
    for (let i = 0; i < 5; i++)
      await worker.post('/api/donations').set('Idempotency-Key', randomUUID()).send(donation);
    const result = await (await login(app, researcher.username)).agent.get('/api/research/summary');
    expect(result.body.rows.every((row: { donations: null }) => row.donations === null)).toBe(true);
  });
  it('returns only approved aggregate fields and freezes published years', async () => {
    const worker = (await login(app, staff.username)).agent;
    for (let i = 0; i < 5; i++)
      await worker
        .post('/api/donations')
        .set('Idempotency-Key', randomUUID())
        .send({ ...donation, donorId: String(123456780 + i) });
    const r = (await login(app, researcher.username)).agent;
    const first = await r.get('/api/research/summary');
    expect(Object.keys(first.body).sort()).toEqual(['minimumGroupSize', 'rows', 'throughYear']);
    expect(first.body.rows).toHaveLength(8);
    expect(first.body.rows.find((v: { bloodType: string }) => v.bloodType === 'A+').donations).toBe(
      5,
    );
    for (const row of first.body.rows)
      expect(Object.keys(row).sort()).toEqual(['bloodType', 'donations', 'year']);
    expect(JSON.stringify(first.body)).not.toMatch(
      /Synthetic|12345678|donor|unit_id|created_at|2025-01/,
    );
    await worker.post('/api/donations').set('Idempotency-Key', randomUUID()).send(donation);
    expect((await r.get('/api/research/summary?donorId=123456789')).body).toEqual(first.body);
  });
  it('suppresses small and zero groups without publishing a complementary total', async () => {
    const worker = (await login(app, staff.username)).agent;
    await worker.post('/api/donations').set('Idempotency-Key', randomUUID()).send(donation);
    const result = await (await login(app, researcher.username)).agent.get('/api/research/summary');
    expect(result.body.rows.every((row: { donations: null }) => row.donations === null)).toBe(true);
    expect(result.body).not.toHaveProperty('total');
  });
  it('exports records, actor identities and legacy history without authentication secrets', async () => {
    const worker = (await login(app, staff.username)).agent;
    const receipt = await worker
      .post('/api/donations')
      .set('Idempotency-Key', randomUUID())
      .send(donation);
    await pool.query("INSERT INTO audit_logs(action,details) VALUES ('OLD_EVENT','{}')");
    const response = await (await login(app, admin.username)).agent.get('/api/export');
    expect(response.status).toBe(200);
    expect(response.body.bloodUnits[0].donor_id).toBe(donation.donorId);
    expect(response.body.bloodUnits[0].donation_date).toBe('2025-01-01');
    const log = response.body.auditLogs.find((v: { action: string }) => v.action === 'DONATION');
    expect(log).toMatchObject({
      actor_id: staff.id,
      actor_role: 'STAFF',
      attribution: 'USER',
      details: { unitId: receipt.body.unitId },
    });
    expect(
      response.body.auditLogs.find((v: { action: string }) => v.action === 'OLD_EVENT').attribution,
    ).toBe('LEGACY');
    expect(response.body.users).toHaveLength(3);
    expect(JSON.stringify(response.body)).not.toMatch(
      /password_hash|scrypt-v1|csrf_token|token_hash/,
    );
  });
  it('rejects audit updates/deletes and rolls back donations when audit insertion fails', async () => {
    await expect(pool.query("UPDATE audit_logs SET action='TAMPERED'")).rejects.toThrow(
      'append-only',
    );
    await expect(pool.query('DELETE FROM audit_logs')).rejects.toThrow('append-only');
    const worker = (await login(app, staff.username)).agent;
    // A test-only constraint simulates an unavailable audit sink for donation events.
    await pool.query(
      "ALTER TABLE audit_logs ADD CONSTRAINT test_reject_donation CHECK (action <> 'DONATION')",
    );
    try {
      expect(
        (await worker.post('/api/donations').set('Idempotency-Key', randomUUID()).send(donation))
          .status,
      ).toBe(503);
      expect((await pool.query('SELECT * FROM blood_units')).rowCount).toBe(0);
      expect((await pool.query('SELECT * FROM operation_requests')).rowCount).toBe(0);
    } finally {
      await pool.query('ALTER TABLE audit_logs DROP CONSTRAINT test_reject_donation');
    }
  });
});
