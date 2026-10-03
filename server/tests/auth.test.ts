import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
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
  throw new Error('Set TEST_DATABASE_URL to a separate database whose name ends in _test.');
}

const schema = `auth_review_${randomUUID().replaceAll('-', '')}`;
const adminPool = createPool(connection);
const poolOptions = {
  connectionString: connection,
  options: `-c search_path=${schema}`,
  connectionTimeoutMillis: 5000,
};
const pool = new Pool(poolOptions);
const app = createApp(pool);

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);

  // Seed users for testing
  await pool.query(
    `
    INSERT INTO users (id, username, password_hash, role)
    VALUES 
      ($1, 'admin1', 'hashed_pw', 'ADMIN'),
      ($2, 'worker1', 'hashed_pw', 'WORKER'),
      ($3, 'researcher1', 'hashed_pw', 'RESEARCHER')
  `,
    [randomUUID(), randomUUID(), randomUUID()],
  );
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

describe('Authentication and RBAC', () => {
  it('issues a JWT for valid credentials', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin1', password: 'password123' }); // assume a mock or bypass for test pw

    // We expect a 200 and a token
    expect(response.status).toBe(200);
    expect(response.body.token).toBeDefined();
  });

  it('rejects unauthenticated requests to protected endpoints', async () => {
    const response = await request(app).get('/api/inventory');
    expect(response.status).toBe(401);
  });
});

describe('Database Layer PHI De-identification for Researchers', () => {
  it('scrubs donor_id and donor_full_name for RESEARCHER role when fetching records', async () => {
    // 1. Insert a blood unit directly
    await pool.query(
      'INSERT INTO blood_units (unit_id, blood_type, donation_date, donor_id, donor_full_name) VALUES ($1, $2, $3, $4, $5)',
      [randomUUID(), 'A+', '2026-01-01', '000000018', 'Synthetic Donor'],
    );

    // 2. Login as Researcher
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'researcher1', password: 'password123' });
    const token = loginRes.body.token;

    // 3. Query records
    const response = await request(app)
      .get('/api/records')
      .query({ dataset: 'bloodUnits' })
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.records).toHaveLength(1);

    const record = response.body.records[0];
    expect(record.blood_type).toBe('A+');

    // Crucial: PHI must be missing or redacted (null/undefined) due to DB view filtering
    expect(record.donor_id).toBeUndefined();
    expect(record.donor_full_name).toBeUndefined();
  });
});
