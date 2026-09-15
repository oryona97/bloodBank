import type { Pool, PoolClient } from 'pg';
import {
  emptyInventory,
  type BloodType,
  type Inventory,
  type Activity,
} from '../../../shared/apiTypes.js';
type Connection = Pool | PoolClient;
export async function getInventory(db: Connection): Promise<Inventory> {
  const result = await db.query<{ blood_type: BloodType; count: number }>(
    "SELECT blood_type, count(*)::int AS count FROM blood_units WHERE status = 'AVAILABLE' GROUP BY blood_type",
  );
  const inventory = emptyInventory();
  for (const row of result.rows) inventory[row.blood_type] = row.count;
  return inventory;
}
export async function getActivity(db: Connection): Promise<Activity[]> {
  const result = await db.query(`
    SELECT unit_id AS id, 'DONATION' AS kind, created_at AS "createdAt", 1 AS quantity, blood_type AS "bloodType"
    FROM blood_units
    UNION ALL
    SELECT e.event_id AS id, e.mode AS kind, e.issued_at AS "createdAt", count(l.unit_id)::int AS quantity, e.recipient_blood_type AS "bloodType"
    FROM dispense_events e JOIN dispense_event_units l ON l.event_id = e.event_id
    GROUP BY e.event_id
    ORDER BY "createdAt" DESC, id DESC LIMIT 8
  `);
  return result.rows as Activity[];
}
