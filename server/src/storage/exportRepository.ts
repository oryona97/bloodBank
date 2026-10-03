import type { Pool } from 'pg';
import { BLOOD_TYPES } from '../../../shared/apiTypes.js';
import { writeAudit, type AuditContext } from './auditRepository.js';
import { getInventory } from './inventoryRepository.js';

export async function getFullExport(pool: Pool, context?: AuditContext) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const timestamp = await client.query('SELECT transaction_timestamp() AS exported_at');
    // Records generation of the copy, not confirmed delivery to the browser.
    await writeAudit(client, 'RECORDS_EXPORTED', { format: 'JSON', version: 1 }, context);
    const inventory = await getInventory(client);
    const bloodUnits = await client.query(
      'SELECT *, donation_date::text AS donation_date FROM blood_units ORDER BY created_at, unit_id',
    );
    const dispenseEvents = await client.query(
      'SELECT * FROM dispense_events ORDER BY issued_at, event_id',
    );
    const dispenseEventUnits = await client.query(
      'SELECT * FROM dispense_event_units ORDER BY event_id, unit_id',
    );
    const operationRequests = await client.query(
      'SELECT * FROM operation_requests ORDER BY created_at, request_key',
    );
    const schemaMigrations = await client.query('SELECT * FROM schema_migrations ORDER BY name');
    const inventoryLock = await client.query('SELECT * FROM inventory_lock ORDER BY id');
    const auditLogs = await client.query('SELECT * FROM audit_logs ORDER BY created_at, sequence');
    const data = {
      formatVersion: 1,
      exportedAt: timestamp.rows[0].exported_at,
      inventory: BLOOD_TYPES.map((blood_type) => ({ blood_type, count: inventory[blood_type] })),
      bloodUnits: bloodUnits.rows,
      dispenseEvents: dispenseEvents.rows,
      dispenseEventUnits: dispenseEventUnits.rows,
      operationRequests: operationRequests.rows,
      schemaMigrations: schemaMigrations.rows,
      inventoryLock: inventoryLock.rows,
      auditLogs: auditLogs.rows,
    };
    await client.query('COMMIT');
    return data;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
