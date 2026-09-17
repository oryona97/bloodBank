import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import type { Role, User } from '../../shared/apiTypes.js';
import { hashPassword } from '../src/auth/password.js';
import { publicUserColumns } from '../src/auth/routes.js';

export const testPassword = 'Synthetic-Test-Password-42';
let passwordHash: string | undefined;
export async function testUser(
  pool: Pool,
  role: Role,
  username = role.toLowerCase(),
): Promise<User> {
  passwordHash ??= await hashPassword(testPassword);
  return (
    await pool.query<User>(
      `INSERT INTO users(username,display_name,password_hash,role,must_change_password) VALUES ($1,$2,$3,$4,false) RETURNING ${publicUserColumns}`,
      [username, `Test ${role}`, passwordHash, role],
    )
  ).rows[0]!;
}
export async function login(app: Express, username: string, password = testPassword) {
  const agent = request.agent(app);
  const response = await agent
    .post('/api/auth/login')
    .set('X-Requested-With', 'BloodBank')
    .send({ username, password });
  if (response.status !== 200) throw new Error(`Test login failed: ${response.status}`);
  agent.set('X-CSRF-Token', response.body.csrfToken);
  return { agent, response };
}
export async function resetTestData(pool: Pool) {
  await pool.query(
    'TRUNCATE operation_requests, dispense_event_units, dispense_events, blood_units, audit_logs, sessions, users, login_limits, research_snapshots',
  );
}
