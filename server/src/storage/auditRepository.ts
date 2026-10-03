import type { Pool, PoolClient } from 'pg';

export type AuditContext = {
  actor: string;
  source: 'api' | 'seed' | 'system';
  requestId?: string;
  requestKey?: string;
  method?: string;
  path?: string;
};

export async function writeAudit(
  db: Pool | PoolClient,
  action: string,
  details: unknown,
  context: AuditContext = { actor: 'system', source: 'system' },
  outcome: 'SUCCESS' | 'REJECTED' | 'ERROR' = 'SUCCESS',
) {
  await db.query(
    `INSERT INTO audit_logs(action, details, actor, source, request_id, request_key, outcome, context)
     VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      action,
      JSON.stringify(details),
      context.actor,
      context.source,
      context.requestId ?? null,
      context.requestKey ?? null,
      outcome,
      JSON.stringify({ method: context.method, path: context.path }),
    ],
  );
}
