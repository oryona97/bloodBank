import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import type { Request, Response, NextFunction } from 'express';
import type { Pool } from 'pg';
import { AppError } from './errors.js';
import { writeAudit, type AuditContext } from './storage/auditRepository.js';

export type JwtPayload = {
  id: string;
  username: string;
  role: string;
};

export async function login(pool: Pool, req: Request, res: Response, secret: string) {
  const { username, password } = req.body;
  if (!username || !password) {
    throw new AppError(400, 'BAD_REQUEST', 'Username and password are required');
  }

  const result = await pool.query(
    'SELECT id, username, password_hash, role, active FROM users WHERE username = $1',
    [username],
  );
  const user = result.rows[0];

  if (!user || !user.active || !(await bcrypt.compare(password, user.password_hash))) {
    throw new AppError(401, 'UNAUTHORIZED', 'Invalid username or password');
  }

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, secret, {
    expiresIn: '8h',
  });
  const context = res.locals.audit as AuditContext;
  context.actor = user.username;
  context.userId = user.id;
  context.role = user.role;
  await writeAudit(pool, 'LOGIN_SUCCEEDED', { userId: user.id, role: user.role }, context);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
}

export function requireAuth(pool: Pool, secret: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing or invalid authorization header');
    }

    const token = authHeader.split(' ')[1];
    try {
      const payload = jwt.verify(token as string, secret, {
        algorithms: ['HS256'],
      }) as unknown as JwtPayload;
      const found = await pool.query('SELECT username,role,active FROM users WHERE id=$1', [
        payload.id,
      ]);
      const user = found.rows[0];
      if (!user?.active || user.role !== payload.role)
        throw new AppError(401, 'UNAUTHORIZED', 'Account disabled or role changed. Sign in again.');
      const auditContext = res.locals.audit as AuditContext;
      auditContext.actor = user.username;
      auditContext.userId = payload.id;
      auditContext.role = payload.role;
      next();
    } catch (error) {
      throw new AppError(401, 'UNAUTHORIZED', 'Invalid or expired token');
    }
  };
}

export function requireRoles(...roles: string[]) {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (!roles.includes((res.locals.audit as AuditContext).role ?? '')) {
      throw new AppError(403, 'FORBIDDEN', 'Your role cannot perform this action.');
    }
    next();
  };
}
