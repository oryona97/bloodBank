// Manual QA only. Never uses the development/production database.
import 'dotenv/config';
import express from 'express';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPool } from '../src/storage/database.js';
import { migrate } from '../src/storage/migrate.js';
import { createApp } from '../src/app.js';
import { resetTestData, testUser } from './authHelpers.js';
import { registerDonation } from '../src/services/inventoryService.js';

const connection = process.env.TEST_DATABASE_URL;
if (!connection || !new URL(connection).pathname.endsWith('_test') || connection === process.env.DATABASE_URL) throw new Error('A separate _test database is required.');
const pool = createPool(connection);
await migrate(pool);
await resetTestData(pool);
await testUser(pool, 'ADMIN');
const worker = await testUser(pool, 'STAFF');
await testUser(pool, 'RESEARCHER');
for (let i=0; i<6; i++) await registerDonation(pool, randomUUID(), { bloodType: i===5 ? 'O-' : 'A+', donationDate: '2025-01-01', donorId: String(800000000+i), donorFullName: `Synthetic Preview ${i}` }, worker);
const app = createApp(pool);
app.use(express.static(resolve('dist/client')));
app.get('/{*path}', (_req,res) => res.sendFile(resolve('dist/client/index.html')));
const server = app.listen(3012, '127.0.0.1', () => console.log('Synthetic QA preview: http://127.0.0.1:3012; accounts admin/staff/researcher use the test password in authHelpers.ts.'));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => { void pool.end().then(() => process.exit(0)); }));
