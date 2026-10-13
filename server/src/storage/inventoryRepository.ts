import type { Pool, PoolClient } from 'pg';
import {
  emptyInventory,
  type BloodType,
  type Inventory,
  type Activity,
} from '../../../shared/apiTypes.js';
type Connection = Pool | PoolClient;
export async function getProductInventory(db: Connection, now = new Date()) {
  const rows = (
    await db.query(
      `SELECT t.code,COALESCE(d.verified_type,d.initial_type) AS blood_type,
    CASE WHEN c.status IN ('AVAILABLE','QUARANTINED') AND c.expires_at <= $1 THEN 'EXPIRED'
      WHEN c.status='AVAILABLE' AND (d.lab_status<>'RELEASED' OR c.expires_at IS NULL OR l.storage_class IS DISTINCT FROM t.storage_class) THEN 'QUARANTINED'
      ELSE c.status END AS status,count(*)::int AS count
    FROM blood_components c JOIN component_types t USING(type_id) JOIN donations d USING(donation_id)
    LEFT JOIN storage_locations l USING(location_id) GROUP BY 1,2,3`,
      [now],
    )
  ).rows;
  const products: Record<string, Inventory> = Object.fromEntries(
    ['PRBC', 'FFP', 'Platelets', 'Cryoprecipitate'].map((p) => [p, emptyInventory()]),
  );
  const statusCounts: Record<string, Record<string, number>> = Object.fromEntries(
    ['PRBC', 'FFP', 'Platelets', 'Cryoprecipitate', 'LEGACY'].map((p) => [
      p,
      { AVAILABLE: 0, QUARANTINED: 0, EXPIRED: 0, DISPENSED: 0, PROCESSED: 0, DISCARDED: 0 },
    ]),
  );
  for (const row of rows) {
    statusCounts[row.code]![row.status] = (statusCounts[row.code]![row.status] ?? 0) + row.count;
    if (row.status === 'AVAILABLE' && products[row.code])
      products[row.code]![row.blood_type as BloodType] += row.count;
  }
  return { inventory: products.PRBC!, products, statusCounts };
}
export async function getInventory(db: Connection, now = new Date()): Promise<Inventory> {
  return (await getProductInventory(db, now)).inventory;
}
export async function getActivity(db: Connection): Promise<Activity[]> {
  const result = await db.query(`
    SELECT donation_id AS id, 'DONATION' AS kind, created_at AS "createdAt", 1 AS quantity, initial_type AS "bloodType"
    FROM donations
    UNION ALL
    SELECT e.event_id AS id, e.mode AS kind, e.issued_at AS "createdAt", count(l.component_id)::int AS quantity, e.recipient_blood_type AS "bloodType"
    FROM dispense_events e JOIN dispense_event_components l ON l.event_id = e.event_id
    GROUP BY e.event_id
    ORDER BY "createdAt" DESC, id DESC LIMIT 8
  `);
  return result.rows as Activity[];
}
