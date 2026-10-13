import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { DonationInput } from '../../../shared/apiTypes.js';
import { AppError } from '../errors.js';
import { writeAudit, type AuditContext } from '../storage/auditRepository.js';

export async function mutate<T>(
  pool: Pool,
  key: string,
  operation: string,
  payload: unknown,
  action: (client: PoolClient) => Promise<T>,
  context?: AuditContext,
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
      await writeAudit(
        client,
        'REQUEST_REPLAYED',
        { operation, response: previous.rows[0].response },
        context,
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

export function registerDonation(
  pool: Pool,
  key: string,
  input: DonationInput,
  context?: AuditContext,
) {
  return mutate(
    pool,
    key,
    'donation',
    input,
    async (client) => {
      const donationId = randomUUID();
      const donor = await client.query<{ donor_id: string }>(
        'INSERT INTO donors(donor_id,demo_identifier,full_name) VALUES ($1,$2,$3) ON CONFLICT(demo_identifier) DO UPDATE SET full_name=EXCLUDED.full_name RETURNING donor_id',
        [randomUUID(), input.donorId, input.donorFullName],
      );
      await client.query(
        "INSERT INTO donations(donation_id,donor_id,donation_date,collected_at,initial_type) VALUES ($1,$2,$3,COALESCE($5::timestamptz,$3::date::timestamp AT TIME ZONE 'Asia/Jerusalem'),$4)",
        [
          donationId,
          donor.rows[0]!.donor_id,
          input.donationDate,
          input.bloodType,
          input.collectedAt ?? null,
        ],
      );
      await writeAudit(
        client,
        'DONATION',
        { donationId, bloodType: input.bloodType, labStatus: 'QUARANTINED' },
        context,
      );
      return { donationId, bloodType: input.bloodType, labStatus: 'QUARANTINED' };
    },
    context,
  );
}
