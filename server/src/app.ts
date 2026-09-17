import express, { type ErrorRequestHandler } from 'express';
import type { Pool } from 'pg';
import { ZodError } from 'zod';
import { donationSchema, requestSchema, confirmSchema, requestKeySchema } from './validation.js';
import { getInventory, getActivity } from './storage/inventoryRepository.js';
import { getFullExport } from './storage/exportRepository.js';
import {
  registerDonation,
  confirmDispensing,
  emergencyDispensing,
} from './services/inventoryService.js';
import { planAllocation } from './domain/allocation.js';
import { AppError } from './errors.js';
import { actor, adminRoutes, authenticate, authorize, authRoutes } from './auth/routes.js';
import { audit } from './auth/audit.js';
import { getResearchSummary } from './storage/researchRepository.js';

export function createApp(pool: Pool) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Frame-Options', 'DENY');
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/health', async (_req, res) => {
    await pool.query('SELECT id FROM inventory_lock WHERE id = 1');
    res.json({ status: 'ok' });
  });
  app.use('/api/auth', authRoutes(pool));
  app.use('/api', authenticate(pool));
  app.use('/api/admin', adminRoutes(pool));
  app.get(
    '/api/research/summary',
    authorize(pool, 'ADMIN', 'STAFF', 'RESEARCHER'),
    async (_req, res) => {
      res.json(await getResearchSummary(pool));
    },
  );
  app.get('/api/inventory', authorize(pool, 'ADMIN', 'STAFF'), async (_req, res) => {
    const [inventory, activity] = await Promise.all([getInventory(pool), getActivity(pool)]);
    res.json({ inventory, activity });
  });
  app.post('/api/donations', authorize(pool, 'ADMIN', 'STAFF'), async (req, res) => {
    const input = donationSchema.parse(req.body);
    res
      .status(201)
      .json(
        await registerDonation(
          pool,
          requestKeySchema.parse(req.get('Idempotency-Key')),
          input,
          actor(res),
        ),
      );
  });
  app.post('/api/dispensing/preview', authorize(pool, 'ADMIN', 'STAFF'), async (req, res) => {
    const input = requestSchema.parse(req.body);
    res.json(planAllocation(input.recipientType, input.quantity, await getInventory(pool)));
  });
  app.post('/api/dispensing/confirm', authorize(pool, 'ADMIN', 'STAFF'), async (req, res) => {
    const input = confirmSchema.parse(req.body);
    res.json(
      await confirmDispensing(
        pool,
        requestKeySchema.parse(req.get('Idempotency-Key')),
        input,
        actor(res),
      ),
    );
  });
  app.post('/api/dispensing/emergency', authorize(pool, 'ADMIN', 'STAFF'), async (req, res) => {
    res.json(
      await emergencyDispensing(
        pool,
        requestKeySchema.parse(req.get('Idempotency-Key')),
        actor(res),
      ),
    );
  });
  app.get('/api/export', authorize(pool, 'ADMIN'), async (_req, res) => {
    await audit(pool, actor(res), 'EXPORT_REQUESTED');
    const data = await getFullExport(pool);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="bloodbank_export.json"');
    res.json(data);
  });
  app.use('/api', (_req, res) => {
    res.status(404).json({ code: 'NOT_FOUND', error: 'API endpoint not found.' });
  });
  const onError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof ZodError) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        error: 'Please check the highlighted fields.',
        fields: Object.fromEntries(
          error.issues.map((issue) => [issue.path.join('.') || 'request', issue.message]),
        ),
      });
    } else if (error instanceof AppError) {
      res.status(error.status).json({ code: error.code, error: error.message });
    } else if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({ code: 'INVALID_JSON', error: 'The request must contain valid JSON.' });
    } else {
      // Database error messages can contain submitted PHI. Keep logs generic.
      console.error('Request failed: internal storage or service error.');
      res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        error: 'The database is temporarily unavailable. Retry the same action shortly.',
      });
    }
  };
  app.use(onError);
  return app;
}
