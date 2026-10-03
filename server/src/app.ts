import { randomUUID } from 'node:crypto';
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
} from './validation.js';
import type { ApiErrorBody } from '../../shared/apiTypes.js';
import { writeAudit, type AuditContext } from './storage/auditRepository.js';
import { getInventory, getActivity } from './storage/inventoryRepository.js';
import { getFullExport } from './storage/exportRepository.js';
import { getRecords, exportRecords } from './storage/recordsRepository.js';
import {
  registerDonation,
  confirmDispensing,
  emergencyDispensing,
} from './services/inventoryService.js';
import { planAllocation } from './domain/allocation.js';
import { AppError } from './errors.js';

const auditContext = (res: Response) => res.locals.audit as AuditContext;

export function createApp(pool: Pool) {
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
  app.use('/api', express.json({ limit: '16kb' }));
  app.get('/api/health', async (_req, res) => {
    await pool.query('SELECT id FROM inventory_lock WHERE id = 1');
    await writeAudit(pool, 'HEALTH_CHECKED', {}, auditContext(res));
    res.json({ status: 'ok' });
  });
  app.get('/api/inventory', async (_req, res) => {
    const [inventory, activity] = await Promise.all([getInventory(pool), getActivity(pool)]);
    await writeAudit(pool, 'INVENTORY_VIEWED', { inventory }, auditContext(res));
    res.json({ inventory, activity });
  });
  app.post('/api/donations', async (req, res) => {
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
  app.post('/api/dispensing/preview', async (req, res) => {
    const input = requestSchema.parse(req.body);
    const plan = planAllocation(input.recipientType, input.quantity, await getInventory(pool));
    await writeAudit(pool, 'ALLOCATION_PREVIEWED', plan, auditContext(res));
    res.json(plan);
  });
  app.post('/api/dispensing/confirm', async (req, res) => {
    const input = confirmSchema.parse(req.body);
    res.json(
      await confirmDispensing(
        pool,
        requestKeySchema.parse(req.get('Idempotency-Key')),
        input,
        auditContext(res),
      ),
    );
  });
  app.post('/api/dispensing/emergency', async (req, res) => {
    res.json(
      await emergencyDispensing(
        pool,
        requestKeySchema.parse(req.get('Idempotency-Key')),
        auditContext(res),
      ),
    );
  });
  app.post('/api/activities/cancel', async (req, res) => {
    const input = cancellationSchema.parse(req.body);
    await writeAudit(pool, 'DISPENSING_CANCELLED', input, auditContext(res));
    res.json({ recorded: true });
  });
  app.get('/api/export', async (_req, res) => {
    const data = await getFullExport(pool, auditContext(res));
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="bloodbank_export.json"');
    res.send(JSON.stringify(data, null, 2) + '\n');
  });
  app.get('/api/records', async (req, res) => {
    const { page, pageSize, ...filters } = recordsQuerySchema.parse(req.query);
    res.json(await getRecords(pool, filters, page, pageSize, auditContext(res)));
  });
  app.post('/api/records/export', async (req, res) => {
    const { filters, ids } = recordsExportSchema.parse(req.body);
    const data = await exportRecords(pool, filters, ids, auditContext(res));
    res.type('application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="bloodbank_${filters.dataset}_${data.scope}.json"`,
    );
    res.send(JSON.stringify(data, null, 2) + '\n');
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
      body = { code: 'PAYLOAD_TOO_LARGE', error: 'The request exceeds the 16 KB limit.' };
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
