import { escapeIdentifier } from 'pg';
import type { PoolClient } from 'pg';

// Run with the schema owner connection, never the runtime connection.
export async function grantRuntimePrivileges(db: PoolClient, role: string) {
  const name = escapeIdentifier(role);
  await db.query(`GRANT USAGE ON SCHEMA public TO ${name}`);
  await db.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${name}`);
  await db.query(
    `GRANT SELECT ON inventory_lock, blood_units, dispense_events, dispense_event_units, operation_requests, audit_logs, users, sessions, login_limits, research_snapshots TO ${name}`,
  );
  await db.query(
    `GRANT INSERT ON blood_units, dispense_events, dispense_event_units, operation_requests, audit_logs, users, sessions, login_limits, research_snapshots TO ${name}`,
  );
  await db.query(
    `GRANT UPDATE ON inventory_lock, blood_units, users, sessions, login_limits TO ${name}`,
  );
  await db.query(`GRANT DELETE ON sessions TO ${name}`);
}
