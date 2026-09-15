import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type {
  AllocationLine,
  BloodType,
  DispenseReceipt,
  DonationInput,
} from '../../../shared/apiTypes.js';
import { planAllocation } from '../domain/allocation.js';
import { AppError } from '../errors.js';
import { getInventory } from '../storage/inventoryRepository.js';

export async function mutate<T>(
  pool: Pool,
  key: string,
  operation: string,
  payload: unknown,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ operation, payload }))
    .digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query('SELECT id FROM inventory_lock WHERE id = 1 FOR UPDATE');
    const previous = await client.query(
      'SELECT fingerprint, response FROM operation_requests WHERE request_key = $1',
      [key],
    );
    if (previous.rowCount) {
      if (previous.rows[0].fingerprint !== fingerprint)
        throw new AppError(
          409,
          'REQUEST_KEY_REUSED',
          'This request key was already used for a different operation.',
        );
      await client.query('COMMIT');
      return previous.rows[0].response as T;
    }
    const response = await action(client);
    await client.query(
      'INSERT INTO operation_requests(request_key, fingerprint, response) VALUES ($1, $2, $3::jsonb)',
      [key, fingerprint, JSON.stringify(response)],
    );
    await client.query('COMMIT');
    return response;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function registerDonation(pool: Pool, key: string, input: DonationInput) {
  return mutate(pool, key, 'donation', input, async (client) => {
    const unitId = randomUUID();
    await client.query(
      'INSERT INTO blood_units(unit_id, blood_type, donation_date, donor_id, donor_full_name) VALUES ($1, $2, $3, $4, $5)',
      [unitId, input.bloodType, input.donationDate, input.donorId, input.donorFullName],
    );
    return { unitId, bloodType: input.bloodType };
  });
}

async function issue(
  client: PoolClient,
  mode: DispenseReceipt['mode'],
  recipientType: BloodType | null,
  quantity: number | null,
  lines: AllocationLine[],
): Promise<DispenseReceipt> {
  const eventId = randomUUID();
  await client.query(
    'INSERT INTO dispense_events(event_id, mode, recipient_blood_type, requested_quantity) VALUES ($1, $2, $3, $4)',
    [eventId, mode, recipientType, quantity],
  );
  for (const line of lines) {
    const units = await client.query<{ unit_id: string }>(
      "SELECT unit_id FROM blood_units WHERE status = 'AVAILABLE' AND blood_type = $1 ORDER BY donation_date, unit_id LIMIT $2 FOR UPDATE",
      [line.bloodType, line.quantity],
    );
    if (units.rows.length !== line.quantity)
      throw new AppError(409, 'STOCK_CHANGED', 'Stock changed. Request a new allocation.');
    const ids = units.rows.map((row) => row.unit_id);
    await client.query(
      "UPDATE blood_units SET status = 'DISPENSED' WHERE unit_id = ANY($1::uuid[])",
      [ids],
    );
    await client.query(
      'INSERT INTO dispense_event_units(event_id, unit_id) SELECT $1::uuid, unnest($2::uuid[])',
      [eventId, ids],
    );
  }
  return { eventId, mode, quantity: lines.reduce((sum, line) => sum + line.quantity, 0), lines };
}

export function confirmDispensing(
  pool: Pool,
  key: string,
  input: { recipientType: BloodType; quantity: number; lines: AllocationLine[] },
) {
  return mutate(pool, key, 'routine', input, async (client) => {
    const plan = planAllocation(input.recipientType, input.quantity, await getInventory(client));
    if (!plan.canFulfill || JSON.stringify(plan.lines) !== JSON.stringify(input.lines)) {
      throw new AppError(
        409,
        'STOCK_CHANGED',
        'The allocation has changed. Preview the request again before dispensing.',
      );
    }
    return issue(client, 'ROUTINE', input.recipientType, input.quantity, plan.lines);
  });
}

export function emergencyDispensing(pool: Pool, key: string) {
  return mutate(pool, key, 'emergency', {}, async (client) => {
    const quantity = (await getInventory(client))['O-'];
    if (!quantity)
      throw new AppError(
        409,
        'EMPTY_EMERGENCY_STOCK',
        'No O-negative units are available for emergency dispensing.',
      );
    return issue(client, 'EMERGENCY', null, null, [{ bloodType: 'O-', quantity }]);
  });
}
