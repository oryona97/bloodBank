import { createHash, randomBytes } from 'node:crypto';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { ROLES, type Role, type User } from '../../../shared/apiTypes.js';
import { AppError } from '../errors.js';
import { hashPassword, verifyPassword } from './password.js';
import { audit } from './audit.js';

const cookieName = 'bloodbank_session';
const passwordSchema = z.string().min(12).max(128);
const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.-]{3,64}$/);
export const createUserSchema = z
  .object({
    username: usernameSchema,
    displayName: z.string().trim().min(2).max(120),
    password: passwordSchema,
    role: z.enum(ROLES),
  })
  .strict();
export const publicUserColumns = `id, username, display_name AS "displayName", role, active, must_change_password AS "mustChangePassword"`;
type Session = { user: User; hash: string; csrfToken: string; expiresAt: string };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function session(res: Response): Session {
  return res.locals.session as Session;
}
export function actor(res: Response): User {
  return session(res).user;
}
function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true',
    path: '/',
  };
}
function tokenFrom(req: Request): string {
  const value =
    req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1) ?? '';
  return /^[a-f0-9]{64}$/.test(value) ? value : '';
}
export async function transaction<T>(
  pool: Pool,
  action: (db: PoolClient) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await action(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
export function authenticate(pool: Pool): RequestHandler {
  return async (req, res, next) => {
    const token = tokenFrom(req);
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in.');
    const hash = digest(token);
    const result = await pool.query(
      `SELECT u.id, u.username, u.display_name AS "displayName", u.role, u.active,
       u.must_change_password AS "mustChangePassword", s.csrf_token, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1
       AND u.active AND s.expires_at > now() AND s.last_seen_at > now() - interval '15 minutes'`,
      [hash],
    );
    const row = result.rows[0];
    if (!row) throw new AppError(401, 'UNAUTHENTICATED', 'Your session expired. Please sign in.');
    const user: User = {
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      role: row.role,
      active: row.active,
      mustChangePassword: row.mustChangePassword,
    };
    res.locals.session = {
      user,
      hash,
      csrfToken: row.csrf_token,
      expiresAt: row.expires_at.toISOString(),
    } satisfies Session;
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.get('X-CSRF-Token') !== row.csrf_token
    ) {
      await audit(pool, user, 'ACCESS_DENIED', { reason: 'CSRF', method: req.method });
      throw new AppError(403, 'CSRF_INVALID', 'Refresh the page and try again.');
    }
    await pool.query('UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1', [hash]);
    next();
  };
}
export function authorize(pool: Pool, ...roles: Role[]): RequestHandler {
  return async (req, res, next) => {
    const user = actor(res);
    if (user.mustChangePassword)
      throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your temporary password first.');
    if (!roles.includes(user.role)) {
      await audit(pool, user, 'ACCESS_DENIED', { method: req.method, reason: 'ROLE' });
      throw new AppError(403, 'FORBIDDEN', 'You do not have permission for this action.');
    }
    next();
  };
}
export function authRoutes(pool: Pool): Router {
  const router = Router();
  // A custom header prevents cross-origin form login; no CORS access is granted.
  router.post('/login', async (req, res) => {
    if (req.get('X-Requested-With') !== 'BloodBank')
      throw new AppError(403, 'CSRF_INVALID', 'Use the sign-in form.');
    const input = z
      .object({ username: usernameSchema, password: z.string().min(1).max(128) })
      .strict()
      .parse(req.body);
    for (const [bucket, max] of [
      [`ip:${digest(req.ip ?? 'unknown')}`, 100],
      [`user:${digest(input.username)}`, 10],
    ] as const) {
      const limit = await pool.query(
        `INSERT INTO login_limits(bucket, attempts) VALUES ($1, 1)
        ON CONFLICT (bucket) DO UPDATE SET
        attempts = CASE WHEN login_limits.window_start < now() - interval '15 minutes' THEN 1 ELSE login_limits.attempts + 1 END,
        window_start = CASE WHEN login_limits.window_start < now() - interval '15 minutes' THEN now() ELSE login_limits.window_start END
        RETURNING attempts`,
        [bucket],
      );
      if (limit.rows[0].attempts > max) {
        await audit(pool, null, 'LOGIN_THROTTLED');
        res.set('Retry-After', '900');
        throw new AppError(429, 'LOGIN_THROTTLED', 'Too many attempts. Try again in 15 minutes.');
      }
    }
    const found = await pool.query(
      `SELECT ${publicUserColumns}, password_hash FROM users WHERE username = $1`,
      [input.username],
    );
    const row = found.rows[0];
    // Same scrypt work for absent users; the dummy key is never a real account.
    const valid = await verifyPassword(
      input.password,
      row?.password_hash ?? `scrypt-v1:${'0'.repeat(32)}:${'0'.repeat(128)}`,
    );
    if (!row || !valid || !row.active) {
      await audit(pool, null, 'LOGIN_FAILED');
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
    }
    const token = randomBytes(32).toString('hex');
    const csrfToken = randomBytes(32).toString('hex');
    const result = await transaction(pool, async (db) => {
      // Lock against a simultaneous reset/disable after password verification.
      const current = (
        await db.query(
          `SELECT ${publicUserColumns}, password_hash FROM users WHERE id = $1 FOR UPDATE`,
          [row.id],
        )
      ).rows[0];
      if (!current.active || current.password_hash !== row.password_hash)
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
      await db.query('DELETE FROM sessions WHERE token_hash = $1 OR expires_at < now()', [
        digest(tokenFrom(req)),
      ]);
      const inserted = await db.query(
        'INSERT INTO sessions(token_hash, user_id, csrf_token) VALUES ($1, $2, $3) RETURNING expires_at',
        [digest(token), row.id, csrfToken],
      );
      await audit(db, current, 'LOGIN');
      const { password_hash: _password, ...user } = current;
      return { user, csrfToken, expiresAt: inserted.rows[0].expires_at.toISOString() };
    });
    res.cookie(cookieName, token, { ...cookieOptions(), maxAge: 8 * 60 * 60 * 1000 });
    res.json(result);
  });
  router.use(authenticate(pool));
  router.get('/me', (_req, res) => {
    const s = session(res);
    res.json({ user: s.user, csrfToken: s.csrfToken, expiresAt: s.expiresAt });
  });
  router.post('/logout', async (_req, res) => {
    await transaction(pool, async (db) => {
      await db.query('DELETE FROM sessions WHERE token_hash = $1', [session(res).hash]);
      await audit(db, actor(res), 'LOGOUT');
    });
    res.clearCookie(cookieName, cookieOptions());
    res.json({ ok: true });
  });
  router.post('/password', async (req, res) => {
    const input = z
      .object({ currentPassword: z.string().min(1).max(128), password: passwordSchema })
      .strict()
      .parse(req.body);
    const hash = await hashPassword(input.password);
    await transaction(pool, async (db) => {
      const row = (
        await db.query('SELECT password_hash FROM users WHERE id = $1 FOR UPDATE', [actor(res).id])
      ).rows[0];
      if (!(await verifyPassword(input.currentPassword, row.password_hash)))
        throw new AppError(400, 'PASSWORD_INVALID', 'Current password is incorrect.');
      if (input.password === input.currentPassword)
        throw new AppError(400, 'PASSWORD_UNCHANGED', 'Choose a different password.');
      await db.query(
        'UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2',
        [hash, actor(res).id],
      );
      await db.query('DELETE FROM sessions WHERE user_id = $1', [actor(res).id]);
      await audit(db, actor(res), 'PASSWORD_CHANGED');
    });
    res.clearCookie(cookieName, cookieOptions());
    res.json({ ok: true });
  });
  return router;
}
export function adminRoutes(pool: Pool): Router {
  const router = Router();
  router.use(authorize(pool, 'ADMIN'));
  router.get('/users', async (_req, res) => {
    res.json((await pool.query(`SELECT ${publicUserColumns} FROM users ORDER BY username`)).rows);
  });
  router.post('/users', async (req, res) => {
    const input = createUserSchema.parse(req.body);
    const hash = await hashPassword(input.password);
    const user = await transaction(pool, async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(81263002)');
      if ((await db.query('SELECT id FROM users WHERE username = $1', [input.username])).rowCount)
        throw new AppError(409, 'USERNAME_TAKEN', 'Username is already in use.');
      const created = (
        await db.query(
          `INSERT INTO users(username, display_name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING ${publicUserColumns}`,
          [input.username, input.displayName, hash, input.role],
        )
      ).rows[0];
      await audit(db, actor(res), 'USER_CREATED', { userId: created.id, role: created.role });
      return created;
    });
    res.status(201).json(user);
  });
  router.post('/users/:id', async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const input = z
      .object({
        role: z.enum(ROLES).optional(),
        active: z.boolean().optional(),
        password: passwordSchema.optional(),
      })
      .strict()
      .refine((v) => Object.keys(v).length > 0)
      .parse(req.body);
    const hash = input.password ? await hashPassword(input.password) : null;
    const user = await transaction(pool, async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(81263002)');
      const old = (
        await db.query(`SELECT ${publicUserColumns} FROM users WHERE id=$1 FOR UPDATE`, [id])
      ).rows[0];
      if (!old) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
      const role = input.role ?? old.role;
      const active = input.active ?? old.active;
      if (old.active && old.role === 'ADMIN' && (!active || role !== 'ADMIN')) {
        const count = await db.query(
          "SELECT count(*)::int AS count FROM users WHERE active AND role='ADMIN'",
        );
        if (count.rows[0].count <= 1)
          throw new AppError(409, 'LAST_ADMIN', 'Keep at least one active administrator.');
      }
      const updated = (
        await db.query(
          `UPDATE users SET role=$2, active=$3, password_hash=COALESCE($4,password_hash), must_change_password=CASE WHEN $4::text IS NULL THEN must_change_password ELSE true END WHERE id=$1 RETURNING ${publicUserColumns}`,
          [id, role, active, hash],
        )
      ).rows[0];
      await db.query('DELETE FROM sessions WHERE user_id=$1', [id]);
      await audit(db, actor(res), 'USER_UPDATED', {
        userId: id,
        before: { role: old.role, active: old.active },
        after: { role, active },
        passwordReset: Boolean(hash),
      });
      return updated;
    });
    res.json(user);
  });
  router.get('/audit', async (req, res) => {
    const page = z.coerce
      .number()
      .int()
      .min(0)
      .max(100000)
      .parse(req.query.page ?? 0);
    res.json(
      (
        await pool.query(
          'SELECT id, action, details, actor_id, actor_role, attribution, created_at FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 50 OFFSET $1',
          [page * 50],
        )
      ).rows,
    );
  });
  return router;
}
