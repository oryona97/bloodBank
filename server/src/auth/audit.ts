import type { Pool, PoolClient } from 'pg';
import type { User } from '../../../shared/apiTypes.js';

export async function audit(
  db: Pool | PoolClient,
  actor: Pick<User, 'id' | 'role'> | null,
  action: string,
  details: unknown = {},
) {
  await db.query(
    `INSERT INTO audit_logs(action, details, actor_id, actor_role, attribution)
     VALUES ($1, $2::jsonb, $3, $4, $5)`,
    [
      action,
      JSON.stringify(details),
      actor?.id ?? null,
      actor?.role ?? null,
      actor ? 'USER' : 'SYSTEM',
    ],
  );
}
