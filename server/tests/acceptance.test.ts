import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { Pool } from 'pg';
import { beforeEach, afterEach, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { migrate } from '../src/storage/migrate.js';

const connection = process.env.TEST_DATABASE_URL;
if (
  !connection ||
  !new URL(connection).pathname.endsWith('_test') ||
  connection === process.env.DATABASE_URL
)
  throw new Error('A separate _test database is required.');
let schema: string, pool: Pool, owner: Pool, app: ReturnType<typeof createApp>, clock: Date;
let tokens: Record<string, string>;
const post = (role: string, path: string, body: object, key = randomUUID()) =>
  request(app)
    .post('/api' + path)
    .set('Authorization', 'Bearer ' + tokens[role])
    .set('Idempotency-Key', key)
    .send(body);
const get = (role: string, path: string) =>
  request(app)
    .get('/api' + path)
    .set('Authorization', 'Bearer ' + tokens[role]);
beforeEach(async () => {
  schema = 'acceptance_' + randomUUID().replaceAll('-', '');
  owner = new Pool({ connectionString: connection });
  await owner.query('CREATE SCHEMA ' + schema);
  pool = new Pool({
    connectionString: connection,
    application_name: schema,
    options: '-c search_path=' + schema,
  });
  await migrate(pool);
  clock = new Date();
  app = createApp(pool, {
    now: () => clock,
    jwtSecret: 'acceptance-secret-longer-than-32-characters',
  });
  tokens = {};
  const hash = await bcrypt.hash('test-password', 4);
  for (const role of ['ADMIN', 'OPERATOR', 'LAB', 'DISPENSER', 'RESEARCHER']) {
    await pool.query('INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,$3,$4)', [
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
afterEach(async () => {
  await pool?.end();
  try {
    if (schema) await owner.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
  } finally {
    await owner?.end();
  }
});
async function intake(type = 'O-', daysAgo = 1, produce = true) {
  const collectedAt = new Date(Date.now() - daysAgo * 86400000).toISOString();
  const donationDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(collectedAt));
  const result = await post('OPERATOR', '/donations', {
    bloodType: type,
    collectedAt,
    donationDate,
    donorId: '000000018',
    donorFullName: 'Synthetic Acceptance Donor',
  });
  expect(result.status).toBe(201);
  const id = result.body.donationId as string;
  if (produce)
    expect(
      (await post('OPERATOR', `/donations/${id}/components`, { template: 'PRBC_FFP_PLATELETS' }))
        .status,
    ).toBe(201);
  return id;
}
async function panel(id: string, type = 'O-', override: Record<string, string> = {}) {
  for (const [testCode, normal] of [
    ['ABO_RH', type],
    ['HIV', 'NEGATIVE'],
    ['HBV', 'NEGATIVE'],
    ['HCV', 'NEGATIVE'],
    ['SYPHILIS', 'NEGATIVE'],
  ])
    expect(
      (
        await post('LAB', `/donations/${id}/lab-results`, {
          testCode,
          value: override[testCode!] ?? normal,
          performedAt: new Date().toISOString(),
        })
      ).status,
    ).toBe(201);
}
const approve = (id: string) =>
  post('LAB', `/donations/${id}/release`, {
    decision: 'APPROVE',
    reason: 'Required panel and typing reviewed',
  });
const components = async (id: string) =>
  (await get('OPERATOR', '/components?donationId=' + id)).body.components as {
    componentId: string;
    productType: string;
    status: string;
    expiresAt: string;
  }[];
async function usable() {
  const id = await intake();
  await panel(id);
  expect((await approve(id)).status).toBe(200);
  return id;
}
const preview = async (quantity = 1) =>
  (
    await post('DISPENSER', '/dispensing/preview', {
      productType: 'PRBC',
      recipientType: 'O-',
      quantity,
    })
  ).body;
const confirm = (
  plan: { quantity: number; lines: unknown[]; componentIds: string[] },
  key = randomUUID(),
) =>
  post(
    'DISPENSER',
    '/dispensing/confirm',
    {
      productType: 'PRBC',
      recipientType: 'O-',
      quantity: plan.quantity,
      lines: plan.lines,
      componentIds: plan.componentIds,
      recipientReference: 'SYNTHETIC-ACCEPTANCE',
    },
    key,
  );
async function expectNoIssue() {
  const exported = (await get('ADMIN', '/export')).body;
  expect(exported.dispenseEvents).toEqual([]);
  expect(exported.dispenseEventComponents).toEqual([]);
  expect(
    exported.auditLogs.filter(
      (a: { action: string; outcome: string }) =>
        a.action.startsWith('DISPENSE_') && a.outcome === 'SUCCESS',
    ),
  ).toEqual([]);
}

it.each(['PENDING', 'INDETERMINATE', 'REACTIVE', 'TYPING_MISMATCH'])(
  'U05 U06 U07 blocks a complete panel containing %s',
  async (value) => {
    const id = await intake();
    await panel(id, 'O-', value === 'TYPING_MISMATCH' ? { ABO_RH: 'A+' } : { HIV: value });
    expect((await approve(id)).status).toBe(409);
    expect((await components(id)).every((c) => c.status === 'QUARANTINED')).toBe(true);
    await expectNoIssue();
  },
);
it('U07 accepts a reasoned typing correction only after a new explicit approval', async () => {
  const id = await intake();
  await panel(id, 'O-', { ABO_RH: 'A+' });
  expect((await approve(id)).status).toBe(409);
  expect(
    (
      await post('LAB', `/donations/${id}/lab-results`, {
        testCode: 'ABO_RH',
        value: 'O-',
        performedAt: new Date().toISOString(),
        reason: 'Verified corrected synthetic typing report',
      })
    ).status,
  ).toBe(201);
  expect((await preview()).canFulfill).toBe(false);
  expect((await approve(id)).status).toBe(200);
  expect((await preview()).canFulfill).toBe(true);
});
it('U08 I02 keeps complete acceptable results quarantined until an explicit release', async () => {
  const id = await intake();
  await panel(id);
  const cell = (await components(id)).find((c) => c.productType === 'PRBC')!;
  expect((await preview()).canFulfill).toBe(false);
  expect(
    (
      await confirm({
        quantity: 1,
        componentIds: [cell.componentId],
        lines: [{ bloodType: 'O-', quantity: 1 }],
      })
    ).status,
  ).toBe(409);
  await expectNoIssue();
  expect((await approve(id)).status).toBe(200);
  expect((await preview()).canFulfill).toBe(true);
});
it.each(['quarantined', 'expired'])(
  'U16 I03 rejects emergency issue when O-negative red cells are %s',
  async (state) => {
    const id = await intake('O-', state === 'expired' ? 50 : 1);
    if (state === 'expired') {
      await panel(id);
      await approve(id);
    }
    expect(
      (
        await post('DISPENSER', '/dispensing/emergency', {
          quantity: 1,
          recipientReference: 'SYNTHETIC-EMERGENCY',
        })
      ).status,
    ).toBe(409);
    await expectNoIssue();
  },
);
it('U15 issues nothing when only part of a requested quantity is eligible', async () => {
  const id = await usable();
  const plan = await preview(2);
  expect(plan).toMatchObject({ canFulfill: false, available: 1, shortfall: 1 });
  expect((await confirm(plan)).status).toBe(409);
  expect((await components(id)).find((c) => c.productType === 'PRBC')!.status).toBe('AVAILABLE');
  await expectNoIssue();
});
it('I05 rejects a forged selection containing the wrong product', async () => {
  const id = await usable();
  const plasma = (await components(id)).find((c) => c.productType === 'FFP')!;
  expect(
    (
      await confirm({
        quantity: 1,
        componentIds: [plasma.componentId],
        lines: [{ bloodType: 'O-', quantity: 1 }],
      })
    ).status,
  ).toBe(409);
  await expectNoIssue();
});
it('U17 I16 blocks issuance and repeated processing of consumed plasma', async () => {
  const id = await usable();
  const plasma = (await components(id)).find((c) => c.productType === 'FFP')!;
  expect(
    (
      await post('OPERATOR', `/components/${plasma.componentId}/process`, {
        productType: 'Cryoprecipitate',
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await post('OPERATOR', `/components/${plasma.componentId}/process`, {
        productType: 'Cryoprecipitate',
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await post('DISPENSER', '/dispensing/confirm', {
        productType: 'FFP',
        recipientType: 'O-',
        quantity: 1,
        componentIds: [plasma.componentId],
        lines: [{ bloodType: 'O-', quantity: 1 }],
        recipientReference: 'SYNTHETIC-SOURCE',
      })
    ).status,
  ).toBe(409);
  await expectNoIssue();
});
async function waitForLockWaiters(count: number) {
  for (let i = 0; i < 200; i++) {
    const waiting = await owner.query(
      "SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM inventory_lock%'",
      [schema],
    );
    if (waiting.rows[0].count >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Requests did not reach the inventory-lock barrier.');
}
it('I07 prevents a waiting issue after a preceding laboratory correction invalidates release', async () => {
  const id = await usable(),
    plan = await preview();
  const barrier = await pool.connect();
  await barrier.query('BEGIN');
  await barrier.query('SELECT id FROM inventory_lock WHERE id=1 FOR UPDATE');
  let correction: Promise<request.Response> | undefined,
    issue: Promise<request.Response> | undefined;
  try {
    correction = post('LAB', `/donations/${id}/lab-results`, {
      testCode: 'HIV',
      value: 'REACTIVE',
      performedAt: new Date().toISOString(),
      reason: 'Corrected screening report',
    }).then((r) => r);
    await waitForLockWaiters(1);
    issue = confirm(plan).then((r) => r);
    await waitForLockWaiters(2);
    await barrier.query('COMMIT');
    expect((await correction).status).toBe(201);
    expect((await issue).status).toBe(409);
    await expectNoIssue();
  } finally {
    await barrier.query('ROLLBACK');
    barrier.release();
    await Promise.allSettled([correction, issue].filter(Boolean));
  }
});
it('checks the current time after waiting for the inventory lock', async () => {
  const id = await usable(),
    plan = await preview();
  const cell = (await components(id)).find((c) => c.productType === 'PRBC')!;
  const barrier = await pool.connect();
  await barrier.query('BEGIN');
  await barrier.query('SELECT id FROM inventory_lock WHERE id=1 FOR UPDATE');
  let issue: Promise<request.Response> | undefined;
  try {
    issue = confirm(plan).then((r) => r);
    await waitForLockWaiters(1);
    clock = new Date(cell.expiresAt);
    await barrier.query('COMMIT');
    expect((await issue).status).toBe(409);
    await expectNoIssue();
  } finally {
    await barrier.query('ROLLBACK');
    barrier.release();
    if (issue) await issue;
  }
});
it('I11 rolls back component status, event, links and retry receipt when saving an issue link fails', async () => {
  const id = await usable(),
    plan = await preview(),
    key = randomUUID();
  await pool.query(
    "CREATE FUNCTION fail_issue_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated issue-link failure'; END $$; CREATE TRIGGER fail_issue_link BEFORE INSERT ON dispense_event_components FOR EACH ROW EXECUTE FUNCTION fail_issue_link()",
  );
  try {
    expect((await confirm(plan, key)).status).toBe(503);
  } finally {
    await pool.query(
      'DROP TRIGGER fail_issue_link ON dispense_event_components; DROP FUNCTION fail_issue_link()',
    );
  }
  expect((await components(id)).find((c) => c.productType === 'PRBC')!.status).toBe('AVAILABLE');
  await expectNoIssue();
  expect((await confirm(plan, key)).status).toBe(200);
});
it('I15 retains issued components and flags them when a later correction quarantines the remaining components', async () => {
  const id = await usable(),
    plan = await preview();
  expect((await confirm(plan)).status).toBe(200);
  expect(
    (
      await post('LAB', `/donations/${id}/lab-results`, {
        testCode: 'HIV',
        value: 'REACTIVE',
        performedAt: new Date().toISOString(),
        reason: 'Amended laboratory report',
      })
    ).status,
  ).toBe(201);
  expect((await components(id)).map((c) => [c.productType, c.status]).sort()).toEqual([
    ['FFP', 'QUARANTINED'],
    ['PRBC', 'DISPENSED'],
    ['Platelets', 'QUARANTINED'],
  ]);
  const audit = await get('ADMIN', '/records?dataset=auditLogs&action=LAB_RELEASE_INVALIDATED');
  expect(audit.body.records[0].details.issuedComponentIds).toEqual(plan.componentIds);
  const history = (await get('LAB', `/donations/${id}/lab-results`)).body.results;
  expect(
    history
      .filter((r: { testCode: string }) => r.testCode === 'HIV')
      .map((r: { value: string }) => r.value),
  ).toEqual(['NEGATIVE', 'REACTIVE']);
});
it('U02 preserves expiry after delayed approval', async () => {
  const id = await intake('O-', 50);
  const before = await components(id);
  await panel(id);
  expect((await approve(id)).status).toBe(200);
  expect((await components(id)).map((c) => c.expiresAt)).toEqual(before.map((c) => c.expiresAt));
  expect((await components(id)).find((c) => c.productType === 'PRBC')!.status).toBe('EXPIRED');
});
it('blocks expired products produced after the donation has already been approved', async () => {
  const id = await intake('O-', 50, false);
  await panel(id);
  expect((await approve(id)).status).toBe(200);
  expect(
    (await post('OPERATOR', `/donations/${id}/components`, { template: 'PRBC_FFP' })).status,
  ).toBe(201);
  expect((await components(id)).map((c) => [c.productType, c.status]).sort()).toEqual([
    ['FFP', 'AVAILABLE'],
    ['PRBC', 'EXPIRED'],
  ]);
  expect((await preview()).canFulfill).toBe(false);
});
it.each(['missing expiry', 'incompatible storage'])(
  'U04 blocks an otherwise released component with %s',
  async (problem) => {
    const id = await usable();
    const cell = (await components(id)).find((c) => c.productType === 'PRBC')!;
    if (problem === 'missing expiry')
      await pool.query('UPDATE blood_components SET expires_at=NULL WHERE component_id=$1', [
        cell.componentId,
      ]);
    else
      await pool.query(
        "UPDATE blood_components SET location_id=(SELECT location_id FROM storage_locations WHERE storage_class='FROZEN' LIMIT 1) WHERE component_id=$1",
        [cell.componentId],
      );
    expect((await preview()).canFulfill).toBe(false);
    expect(
      (
        await confirm({
          quantity: 1,
          componentIds: [cell.componentId],
          lines: [{ bloodType: 'O-', quantity: 1 }],
        })
      ).status,
    ).toBe(409);
    await expectNoIssue();
  },
);
for (const table of [
  'lab_results',
  'release_decisions',
  'component_types',
  'lab_panels',
  'lab_test_types',
])
  it.each(['UPDATE', 'DELETE'])(
    `keeps ${table} immutable when a database-boundary fault attempts %s during an API mutation`,
    async (operation) => {
      const id = await usable();
      const catalogue = (await get('ADMIN', '/catalog')).body;
      const tests = catalogue.tests
        .filter((t: { panel_version: number }) => t.panel_version === 1)
        .map((t: { code: string; result_kind: string }) => ({
          code: t.code,
          resultKind: t.result_kind,
          required: true,
        }));
      const read = async () => {
        if (table === 'lab_results')
          return (await get('LAB', `/donations/${id}/lab-results`)).body.results;
        if (table === 'release_decisions')
          return (await get('ADMIN', '/records?dataset=releaseDecisions')).body.records;
        return (await get('ADMIN', '/catalog')).body[
          table === 'component_types' ? 'products' : table === 'lab_panels' ? 'panels' : 'tests'
        ];
      };
      const before = await read();
      const column =
        table === 'lab_results'
          ? 'value'
          : table === 'release_decisions' || table === 'lab_panels'
            ? 'reason'
            : 'code';
      const attempted =
        operation === 'DELETE' ? `DELETE FROM ${table}` : `UPDATE ${table} SET ${column}=${column}`;
      await pool.query(
        `CREATE FUNCTION attempt_history_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${attempted}; RETURN NEW; END $$; CREATE TRIGGER attempt_history_change BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION attempt_history_change()`,
      );
      try {
        const response =
          table === 'lab_results'
            ? await post('LAB', `/donations/${id}/lab-results`, {
                testCode: 'HIV',
                value: 'NEGATIVE',
                performedAt: new Date().toISOString(),
                reason: 'Synthetic correction',
              })
            : table === 'release_decisions'
              ? await approve(id)
              : table === 'component_types'
                ? await post('ADMIN', '/catalog/products', { productType: 'PRBC', expiryDays: 35 })
                : await post('ADMIN', '/catalog/panels', {
                    tests,
                    reason: 'Revised synthetic panel',
                  });
        expect(response.status).toBe(503);
        expect(await read()).toEqual(before);
      } finally {
        await pool.query(
          `DROP TRIGGER attempt_history_change ON ${table}; DROP FUNCTION attempt_history_change()`,
        );
      }
    },
  );
