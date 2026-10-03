import type { Pool, PoolClient } from 'pg';
import type { RecordDataset, RecordFilters, StoredRecord } from '../../../shared/apiTypes.js';
import { AppError } from '../errors.js';
import { writeAudit, type AuditContext } from './auditRepository.js';

// Only these fixed identifiers can enter SQL. All user-provided values are parameters.
const datasets: Record<
  RecordDataset,
  {
    from: string;
    select: string;
    date: string;
    id: string;
    order: string;
    deidentifiedFrom?: string;
  }
> = {
  auditLogs: {
    from: 'audit_logs r',
    select: 'r.*',
    date: 'r.created_at',
    id: 'r.id',
    order: 'r.created_at DESC, r.sequence DESC',
  },
  bloodUnits: {
    from: 'blood_units r',
    deidentifiedFrom: 'deidentified_blood_units r',
    select: 'r.*, r.donation_date::text AS donation_date',
    date: 'r.created_at',
    id: 'r.unit_id',
    order: 'r.created_at DESC, r.unit_id DESC',
  },
  dispenseEvents: {
    from: 'dispense_events r',
    select: 'r.*',
    date: 'r.issued_at',
    id: 'r.event_id',
    order: 'r.issued_at DESC, r.event_id DESC',
  },
  dispenseEventUnits: {
    from: 'dispense_event_units r JOIN dispense_events e ON e.event_id = r.event_id',
    select: 'r.*, e.issued_at',
    date: 'e.issued_at',
    id: 'r.unit_id',
    order: 'e.issued_at DESC, r.unit_id DESC',
  },
  operationRequests: {
    from: 'operation_requests r',
    select: 'r.*',
    date: 'r.created_at',
    id: 'r.request_key',
    order: 'r.created_at DESC, r.request_key DESC',
  },
};

function selection(filters: RecordFilters, context: AuditContext, ids?: string[]) {
  const config = datasets[filters.dataset];
  if (context.role === 'RESEARCHER' && filters.dataset === 'auditLogs') {
    throw new AppError(403, 'FORBIDDEN', 'Researchers are not allowed to view audit logs.');
  }
  let fromTable = config.from;

  if (context.role === 'RESEARCHER' && config.deidentifiedFrom) {
    fromTable = config.deidentifiedFrom;
  }

  const values: unknown[] = [];
  const clauses: string[] = [];
  const param = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (filters.search)
    clauses.push(`strpos(lower(to_jsonb(r)::text), lower(${param(filters.search)})) > 0`);
  // Date filters use whole calendar days in the bank's timezone, including the end date.
  if (filters.from)
    clauses.push(
      `${config.date} >= (${param(filters.from)}::date::timestamp AT TIME ZONE 'Asia/Jerusalem')`,
    );
  if (filters.to)
    clauses.push(
      `${config.date} < ((${param(filters.to)}::date + 1)::timestamp AT TIME ZONE 'Asia/Jerusalem')`,
    );
  if (filters.snapshotAt)
    clauses.push(`${config.date} <= ${param(filters.snapshotAt)}::timestamptz`);
  if (filters.action) clauses.push(`r.action = ${param(filters.action)}`);
  if (filters.outcome) clauses.push(`r.outcome = ${param(filters.outcome)}`);
  if (ids) clauses.push(`${config.id} = ANY(${param(ids)}::uuid[])`);
  return {
    ...config,
    from: fromTable,
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    values,
  };
}

async function timestamp(client: PoolClient): Promise<string> {
  const result = await client.query(
    "SELECT date_trunc('milliseconds', clock_timestamp()) AS timestamp",
  );
  return (result.rows[0].timestamp as Date).toISOString();
}

export async function getRecords(
  pool: Pool,
  filters: RecordFilters,
  page: number,
  pageSize: number,
  context: AuditContext,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const snapshotAt = filters.snapshotAt ?? (await timestamp(client));
    const query = selection({ ...filters, snapshotAt }, context);
    const total = await client.query(
      `SELECT count(*)::int AS total FROM ${query.from} ${query.where}`,
      query.values,
    );
    const records = await client.query<StoredRecord>(
      `SELECT ${query.select} FROM ${query.from} ${query.where} ORDER BY ${query.order} LIMIT $${query.values.length + 1} OFFSET $${query.values.length + 2}`,
      [...query.values, pageSize, (page - 1) * pageSize],
    );
    const actions =
      filters.dataset === 'auditLogs'
        ? (await client.query('SELECT DISTINCT action FROM audit_logs ORDER BY action')).rows.map(
            (row) => row.action as string,
          )
        : [];
    await writeAudit(
      client,
      'RECORDS_VIEWED',
      { filters: { ...filters, snapshotAt }, page, pageSize, total: total.rows[0].total },
      context,
    );
    await client.query('COMMIT');
    return {
      records: records.rows,
      total: total.rows[0].total as number,
      page,
      pageSize,
      snapshotAt,
      actions,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function exportRecords(
  pool: Pool,
  filters: RecordFilters,
  ids: string[] | undefined,
  context: AuditContext,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const exportedAt = await timestamp(client);
    const effectiveFilters = { ...filters, snapshotAt: filters.snapshotAt ?? exportedAt };
    const query = selection(effectiveFilters, context, ids);
    const result = await client.query<StoredRecord>(
      `SELECT ${query.select} FROM ${query.from} ${query.where} ORDER BY ${query.order}`,
      query.values,
    );
    if (ids && result.rows.length !== ids.length) {
      throw new AppError(
        409,
        'EXPORT_SELECTION_CHANGED',
        'Some selected records no longer match. Refresh the list and select them again.',
      );
    }
    const scope = ids ? 'selected' : 'filtered';
    await writeAudit(
      client,
      'RECORDS_EXPORTED',
      {
        format: 'JSON',
        scope,
        filters: effectiveFilters,
        recordIds: ids,
        recordCount: result.rows.length,
      },
      context,
    );
    await client.query('COMMIT');
    return {
      formatVersion: 1,
      exportedAt,
      dataset: filters.dataset,
      scope,
      filters: effectiveFilters,
      recordCount: result.rows.length,
      records: result.rows,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
