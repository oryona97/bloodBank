import type { Pool } from 'pg';

export async function getFullExport(pool: Pool) {
  const [inventory, bloodUnits, dispenseEvents, dispenseEventUnits, auditLogs] = await Promise.all([
    pool.query("SELECT blood_type, count(*)::int AS count FROM blood_units WHERE status = 'AVAILABLE' GROUP BY blood_type"),
    pool.query("SELECT * FROM blood_units"),
    pool.query("SELECT * FROM dispense_events"),
    pool.query("SELECT * FROM dispense_event_units"),
    pool.query("SELECT * FROM audit_logs ORDER BY created_at ASC")
  ]);

  return {
    exportedAt: new Date().toISOString(),
    inventory: inventory.rows,
    bloodUnits: bloodUnits.rows,
    dispenseEvents: dispenseEvents.rows,
    dispenseEventUnits: dispenseEventUnits.rows,
    auditLogs: auditLogs.rows
  };
}
