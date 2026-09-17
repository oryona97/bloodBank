import type { Pool } from 'pg';

export async function getFullExport(pool: Pool) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const inventory = await db.query(
      "SELECT blood_type, count(*)::int AS count FROM blood_units WHERE status='AVAILABLE' GROUP BY blood_type",
    );
    const bloodUnits = await db.query(
      'SELECT unit_id, blood_type, donation_date::text AS donation_date, donor_id, donor_full_name, status, created_at FROM blood_units ORDER BY created_at, unit_id',
    );
    const dispenseEvents = await db.query(
      'SELECT event_id, mode, recipient_blood_type, requested_quantity, issued_at FROM dispense_events ORDER BY issued_at, event_id',
    );
    const dispenseEventUnits = await db.query(
      'SELECT event_id, unit_id FROM dispense_event_units ORDER BY event_id, unit_id',
    );
    const auditLogs = await db.query(
      'SELECT id, action, details, created_at, actor_id, actor_role, attribution FROM audit_logs ORDER BY created_at, id',
    );
    const users = await db.query(
      'SELECT id, username, display_name, role, active, created_at FROM users ORDER BY username',
    );
    const exportedAt = (
      await db.query('SELECT transaction_timestamp() AS time')
    ).rows[0].time.toISOString();
    await db.query('COMMIT');
    return {
      exportedAt,
      inventory: inventory.rows,
      bloodUnits: bloodUnits.rows,
      dispenseEvents: dispenseEvents.rows,
      dispenseEventUnits: dispenseEventUnits.rows,
      auditLogs: auditLogs.rows,
      users: users.rows,
    };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
