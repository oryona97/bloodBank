import { randomUUID, randomBytes } from 'node:crypto';
import express, { type ErrorRequestHandler, type Response } from 'express';
import type { Pool } from 'pg';
import { ZodError } from 'zod';
import {
  donationSchema,
  requestSchema,
  confirmSchema,
  requestKeySchema,
  cancellationSchema,
  recordsQuerySchema,
  recordsExportSchema,
  userSchema,
} from './validation.js';
import bcrypt from 'bcrypt';
import type { ApiErrorBody } from '../../shared/apiTypes.js';
import { writeAudit, type AuditContext } from './storage/auditRepository.js';
import { getActivity, getProductInventory } from './storage/inventoryRepository.js';
import { getFullExport } from './storage/exportRepository.js';
import { getRecords, exportRecords } from './storage/recordsRepository.js';
import { registerDonation, mutate } from './services/inventoryService.js';
import { AppError } from './errors.js';
import { login, requireAuth, requireRoles } from './auth.js';
import { z } from 'zod';
import {
  produceComponents,
  deriveCryo,
  discardComponent,
  completeLegacyDetails,
} from './services/componentService.js';
import { listComponents, componentStock } from './storage/componentsRepository.js';
import { planComponentAllocation, PRODUCT_TYPES } from './domain/components.js';
import { confirmComponents, emergencyComponents } from './services/dispensingService.js';
import { releaseDonation, recordResult, resultHistory } from './services/labService.js';
import { listDonations } from './storage/donationsRepository.js';
import { catalog, reviseProduct } from './services/catalogService.js';

const auditContext = (res: Response) => res.locals.audit as AuditContext;

export function createApp(pool: Pool, options: { now?: () => Date; jwtSecret?: string } = {}) {
  const now = options.now ?? (() => new Date());
  const secret =
    options.jwtSecret ??
    (process.env.JWT_SECRET || undefined) ??
    (process.env.NODE_ENV === 'test' || process.env.DEMO_MODE === 'true'
      ? randomBytes(32).toString('hex')
      : '');
  if (secret.length < 32)
    throw new Error(
      'Set JWT_SECRET to a random secret of at least 32 characters, or explicitly enable DEMO_MODE for local synthetic demonstrations.',
    );
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', (req, res, next) => {
    const context: AuditContext = {
      actor: 'anonymous',
      source: 'api',
      requestId: randomUUID(),
      requestKey: req.get('Idempotency-Key')?.slice(0, 128),
      method: req.method,
      path: req.originalUrl.split('?')[0]!.slice(0, 512),
    };
    res.locals.audit = context;
    res.set('X-Request-Id', context.requestId!);
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', express.json({ limit: '128kb' }));
  app.get('/api/health', async (_req, res) => {
    await pool.query('SELECT id FROM inventory_lock WHERE id = 1');
    await writeAudit(pool, 'HEALTH_CHECKED', {}, auditContext(res));
    res.json({ status: 'ok' });
  });
  const failedLogins = new Map<string, { count: number; until: number }>();
  app.post('/api/auth/login', async (req, res) => {
    const input = z
      .object({ username: z.string().min(1).max(50), password: z.string().min(1).max(100) })
      .strict()
      .parse(req.body);
    req.body = input;
    const current = Date.now();
    const keys = [`account:${req.ip}:${input.username}`, `address:${req.ip}`];
    for (const [key, value] of failedLogins) if (value.until <= current) failedLogins.delete(key);
    if (keys.some((key, i) => (failedLogins.get(key)?.count ?? 0) >= (i === 0 ? 10 : 100)))
      throw new AppError(429, 'LOGIN_LIMIT', 'Too many failed sign-ins. Try again in 15 minutes.');
    try {
      await login(pool, req, res, secret);
      failedLogins.delete(keys[0]!);
    } catch (error) {
      if (error instanceof AppError && error.status === 401) {
        for (const key of keys) {
          const previous = failedLogins.get(key);
          failedLogins.set(key, {
            count: (previous?.count ?? 0) + 1,
            until: previous?.until ?? current + 15 * 60000,
          });
        }
      }
      throw error;
    }
  });
  app.use('/api', requireAuth(pool, secret));
  app.post('/api/components/:id/legacy-details', requireRoles('OPERATOR'), async (req, res) => {
    const input = z
      .object({
        productType: z.enum(['PRBC', 'FFP', 'Platelets']),
        collectedAt: z.iso
          .datetime({ offset: true })
          .refine((v) => Date.parse(v) <= Date.now(), 'Collection cannot be in the future.'),
        reason: z.string().trim().min(3).max(500),
      })
      .strict()
      .parse(req.body);
    res.json(
      await completeLegacyDetails(
        pool,
        requestKeySchema.parse(req.get('Idempotency-Key')),
        z.uuid().parse(req.params.id),
        input,
        auditContext(res),
      ),
    );
  });
  app.get(
    '/api/catalog',
    requireRoles('ADMIN', 'OPERATOR', 'LAB', 'DISPENSER'),
    async (_req, res) => {
      const result = await catalog(pool);
      await writeAudit(pool, 'CATALOG_VIEWED', {}, auditContext(res));
      res.json(result);
    },
  );
  app.post('/api/catalog/products', requireRoles('ADMIN'), async (req, res) => {
    const input = z
      .object({
        productType: z.enum(PRODUCT_TYPES),
        expiryDays: z.number().int().positive().max(3650),
      })
      .strict()
      .parse(req.body);
    res
      .status(201)
      .json(
        await reviseProduct(
          pool,
          requestKeySchema.parse(req.get('Idempotency-Key')),
          input,
          auditContext(res),
        ),
      );
  });
  app.post('/api/components/:id/discard', requireRoles('OPERATOR', 'LAB'), async (req, res) => {
    const { reason } = z
      .object({ reason: z.string().trim().min(3).max(500) })
      .strict()
      .parse(req.body);
    res.json(
      await discardComponent(
        pool,
        requestKeySchema.parse(req.get('Idempotency-Key')),
        z.uuid().parse(req.params.id),
        reason,
        auditContext(res),
      ),
    );
  });
  app.get('/api/donations', requireRoles('OPERATOR', 'LAB', 'ADMIN'), async (req, res) => {
    const query = z
      .object({
        search: z.string().max(200).optional(),
        labStatus: z.enum(['QUARANTINED', 'RELEASED', 'REJECTED']).optional(),
      })
      .strict()
      .parse(req.query);
    const result = await listDonations(
      pool,
      auditContext(res).role!,
      query.search,
      query.labStatus,
    );
    await writeAudit(
      pool,
      'DONATIONS_VIEWED',
      { count: result.donations.length },
      auditContext(res),
    );
    res.json(result);
  });
  app.post('/api/users/:id', requireRoles('ADMIN'), async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const input = z
      .object({ active: z.boolean().optional(), role: userSchema.shape.role.optional() })
      .strict()
      .refine((v) => v.active !== undefined || v.role !== undefined, 'Choose a change.')
      .parse(req.body);
    res.json(
      await mutate(
        pool,
        requestKeySchema.parse(req.get('Idempotency-Key')),
        'user-updated',
        { id, ...input },
        async (client) => {
          if (id === auditContext(res).userId)
            throw new AppError(
              409,
              'SELF_CHANGE_BLOCKED',
              'Use a different administrator to change your own access.',
            );
          const updated = await client.query(
            'UPDATE users SET active=COALESCE($2,active),role=COALESCE($3,role) WHERE id=$1 RETURNING id,username,role,active',
            [id, input.active ?? null, input.role ?? null],
          );
          if (!updated.rowCount) throw new AppError(404, 'NOT_FOUND', 'User not found.');
          await writeAudit(client, 'USER_UPDATED', { userId: id, ...input }, auditContext(res));
          return updated.rows[0];
        },
        auditContext(res),
      ),
    );
  });
  app.post('/api/components/:id/process', requireRoles('OPERATOR'), async (req, res) => {
    z.object({ productType: z.literal('Cryoprecipitate') })
      .strict()
      .parse(req.body);
    res
      .status(201)
      .json(
        await deriveCryo(
          pool,
          requestKeySchema.parse(req.get('Idempotency-Key')),
          z.uuid().parse(req.params.id),
          auditContext(res),
        ),
      );
  });
  app.get('/api/donations/:id/lab-results', requireRoles('LAB'), async (req, res) => {
    const donationId = z.uuid().parse(req.params.id);
    const result = await resultHistory(pool, donationId);
    await writeAudit(
      pool,
      'LAB_RESULTS_VIEWED',
      { donationId, count: result.results.length },
      auditContext(res),
    );
    res.json(result);
  });
  app.post('/api/donations/:id/lab-results', requireRoles('LAB'), async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const input = z
      .object({
        testCode: z.string().min(1).max(40),
        value: z.string().min(1).max(40),
        performedAt: z.iso
          .datetime({ offset: true })
          .refine((v) => new Date(v).getTime() <= Date.now(), 'Test time cannot be in the future.'),
        reason: z.string().trim().min(3).max(500).optional(),
      })
      .strict()
      .parse(req.body);
    res
      .status(201)
      .json(
        await recordResult(
          pool,
          requestKeySchema.parse(req.get('Idempotency-Key')),
          id,
          input,
          auditContext(res),
        ),
      );
  });
  app.post('/api/donations/:id/release', requireRoles('LAB'), async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const input = z
      .discriminatedUnion('decision', [
        z.object({ decision: z.literal('APPROVE') }).strict(),
        z
          .object({ decision: z.literal('REJECT'), reason: z.string().trim().min(3).max(500) })
          .strict(),
      ])
      .parse(req.body);
    res.json(
      await releaseDonation(
        pool,
        requestKeySchema.parse(req.get('Idempotency-Key')),
        id,
        auditContext(res),
        input,
      ),
    );
  });
  app.post('/api/donations/:id/components', requireRoles('OPERATOR'), async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const { template } = z
      .object({ template: z.enum(['PRBC_FFP', 'PRBC_FFP_PLATELETS']) })
      .strict()
      .parse(req.body);
    res
      .status(201)
      .json(
        await produceComponents(
          pool,
          requestKeySchema.parse(req.get('Idempotency-Key')),
          id,
          template,
          auditContext(res),
        ),
      );
  });
  app.get(
    '/api/components',
    requireRoles('ADMIN', 'OPERATOR', 'LAB', 'DISPENSER'),
    async (req, res) => {
      const query = z
        .object({
          donationId: z.uuid().optional(),
          productType: z.enum([...PRODUCT_TYPES, 'LEGACY']).optional(),
          bloodType: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
          status: z
            .enum(['QUARANTINED', 'AVAILABLE', 'EXPIRED', 'DISCARDED', 'DISPENSED', 'PROCESSED'])
            .optional(),
          expiresBefore: z.iso.datetime({ offset: true }).optional(),
          search: z.string().max(200).optional(),
          page: z.coerce.number().int().min(1).max(1000000).optional(),
        })
        .strict()
        .parse(req.query);
      const result = await listComponents(pool, query, now());
      await writeAudit(
        pool,
        'COMPONENTS_VIEWED',
        { filters: query, count: result.components.length },
        auditContext(res),
      );
      res.json(result);
    },
  );
  app.get('/api/inventory', async (_req, res) => {
    const snapshot = await getProductInventory(pool, now());
    const activity = auditContext(res).role === 'RESEARCHER' ? [] : await getActivity(pool);
    await writeAudit(pool, 'INVENTORY_VIEWED', { products: snapshot.products }, auditContext(res));
    res.json({ ...snapshot, activity });
  });
  app.post('/api/donations', requireRoles('OPERATOR'), async (req, res) => {
    const input = donationSchema.parse(req.body);
    res
      .status(201)
      .json(
        await registerDonation(
          pool,
          requestKeySchema.parse(req.get('Idempotency-Key')),
          input,
          auditContext(res),
        ),
      );
  });
  app.post('/api/dispensing/preview', requireRoles('DISPENSER'), async (req, res) => {
    const input = requestSchema.parse(req.body);
    const plan = planComponentAllocation(
      input.productType,
      input.recipientType,
      input.quantity,
      await componentStock(pool),
      now(),
    );
    await writeAudit(pool, 'ALLOCATION_PREVIEWED', plan, auditContext(res));
    res.json(plan);
  });
  app.post('/api/dispensing/confirm', requireRoles('DISPENSER'), async (req, res) => {
    const input = confirmSchema.parse(req.body);
    res.json(
      await confirmComponents(
        pool,
        requestKeySchema.parse(req.get('Idempotency-Key')),
        input,
        auditContext(res),
        now,
      ),
    );
  });
  app.post('/api/dispensing/emergency', requireRoles('DISPENSER'), async (req, res) => {
    const input = z
      .object({
        quantity: z.number().int().positive().max(1000),
        recipientReference: z.string().trim().min(3).max(120),
      })
      .strict()
      .parse(req.body);
    res.json(
      await emergencyComponents(
        pool,
        requestKeySchema.parse(req.get('Idempotency-Key')),
        input,
        auditContext(res),
        now,
      ),
    );
  });
  app.post('/api/activities/cancel', requireRoles('DISPENSER'), async (req, res) => {
    const input = cancellationSchema.parse(req.body);
    await writeAudit(pool, 'DISPENSING_CANCELLED', input, auditContext(res));
    res.json({ recorded: true });
  });
  app.get('/api/export', requireRoles('ADMIN'), async (_req, res) => {
    const data = await getFullExport(pool, auditContext(res));
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="bloodbank_export.json"');
    res.send(JSON.stringify(data, null, 2) + '\n');
  });
  app.get('/api/records', requireRoles('ADMIN'), async (req, res) => {
    const { page, pageSize, ...filters } = recordsQuerySchema.parse(req.query);
    res.json(await getRecords(pool, filters, page, pageSize, auditContext(res)));
  });
  app.post('/api/records/export', requireRoles('ADMIN'), async (req, res) => {
    const { filters, ids } = recordsExportSchema.parse(req.body);
    const data = await exportRecords(pool, filters, ids, auditContext(res));
    res.type('application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="bloodbank_${filters.dataset}_${data.scope}.json"`,
    );
    res.send(JSON.stringify(data, null, 2) + '\n');
  });
  app.get('/api/users', async (req, res) => {
    if (auditContext(res).role !== 'ADMIN') {
      throw new AppError(403, 'FORBIDDEN', 'Only admins can view users.');
    }
    const result = await pool.query(
      'SELECT id, username, role, active, created_at FROM users ORDER BY created_at DESC',
    );
    res.json(result.rows);
  });
  app.post('/api/users', async (req, res) => {
    if (auditContext(res).role !== 'ADMIN') {
      throw new AppError(403, 'FORBIDDEN', 'Only admins can create users.');
    }
    const input = userSchema.parse(req.body);
    const hash = await bcrypt.hash(input.password, 10);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO users(id, username, password_hash, role) VALUES ($1, $2, $3, $4)',
        [randomUUID(), input.username, hash, input.role],
      );
      await writeAudit(
        client,
        'USER_CREATED',
        { username: input.username, role: input.role },
        auditContext(res),
      );
      await client.query('COMMIT');
      res.status(201).json({ success: true });
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err.code === '23505') {
        throw new AppError(409, 'CONFLICT', 'Username already exists.');
      }
      throw err;
    } finally {
      client.release();
    }
  });
  app.use('/api', () => {
    throw new AppError(404, 'NOT_FOUND', 'API endpoint not found.');
  });
  const onError: ErrorRequestHandler = async (error: unknown, _req, res, _next) => {
    let status: number;
    let body: ApiErrorBody;
    if (error instanceof ZodError) {
      status = 400;
      body = {
        code: 'VALIDATION_ERROR',
        error: 'Please check the highlighted fields.',
        fields: Object.fromEntries(
          error.issues.map((issue) => [issue.path.join('.') || 'request', issue.message]),
        ),
      };
    } else if (error instanceof AppError) {
      status = error.status;
      body = { code: error.code, error: error.message };
    } else if (error instanceof SyntaxError && 'body' in error) {
      status = 400;
      body = { code: 'INVALID_JSON', error: 'The request must contain valid JSON.' };
    } else if (error instanceof Error && 'type' in error && error.type === 'entity.too.large') {
      status = 413;
      body = { code: 'PAYLOAD_TOO_LARGE', error: 'The request exceeds the 128 KB limit.' };
    } else {
      console.error('Request failed:', error instanceof Error ? error.message : 'Unknown error');
      status = 503;
      body = {
        code: 'SERVICE_UNAVAILABLE',
        error: 'The database is temporarily unavailable. Retry the same action shortly.',
      };
    }
    try {
      await writeAudit(
        pool,
        'REQUEST_FAILED',
        { status, code: body.code, fields: body.fields },
        auditContext(res),
        status < 500 ? 'REJECTED' : 'ERROR',
      );
    } catch (auditError) {
      console.error(
        'Audit recording failed:',
        auditError instanceof Error ? auditError.message : 'Unknown error',
      );
      res.status(503).json({
        code: 'AUDIT_UNAVAILABLE',
        error: 'The action could not be audited. Retry shortly.',
      });
      return;
    }
    res.status(status).json(body);
  };
  app.use(onError);
  return app;
}
