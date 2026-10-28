import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { AppError } from '../errors.js';
import { mutate } from './inventoryService.js';
import { writeAudit, type AuditContext } from '../storage/auditRepository.js';
import { BLOOD_TYPES } from '../../../shared/apiTypes.js';
import { DEFAULT_RELEASE_REASON } from '../../../shared/becsTypes.js';

export type LabResultInput = {
  testCode: string;
  value: string;
  performedAt: string;
  reason?: string;
};
export function recordResult(
  pool: Pool,
  key: string,
  donationId: string,
  input: LabResultInput,
  context: AuditContext,
) {
  return mutate(
    pool,
    key,
    'lab-result',
    { donationId, ...input },
    async (client) => {
      const donation = (
        await client.query('SELECT * FROM donations WHERE donation_id=$1 FOR UPDATE', [donationId])
      ).rows[0];
      if (!donation) throw new AppError(404, 'NOT_FOUND', 'Donation not found.');
      if (!donation.collected_at)
        throw new AppError(
          409,
          'COLLECTION_TIME_REQUIRED',
          'Record a verified collection time before laboratory work.',
        );
      if (Date.parse(input.performedAt) < donation.collected_at.getTime())
        throw new AppError(400, 'INVALID_TEST_TIME', 'A test cannot precede collection.');
      const type = (
        await client.query('SELECT * FROM lab_test_types WHERE code=$1 AND panel_version=$2', [
          input.testCode,
          donation.required_panel_version,
        ])
      ).rows[0];
      if (
        !type ||
        !(type.result_kind === 'TYPING'
          ? BLOOD_TYPES.includes(input.value as (typeof BLOOD_TYPES)[number])
          : ['NEGATIVE', 'REACTIVE', 'INDETERMINATE', 'PENDING'].includes(input.value))
      )
        throw new AppError(400, 'INVALID_RESULT', 'Select a valid result for this test.');
      const previous = (
        await client.query(
          'SELECT * FROM lab_results WHERE donation_id=$1 AND test_type_id=$2 ORDER BY revision DESC LIMIT 1',
          [donationId, type.test_type_id],
        )
      ).rows[0];
      if (previous && !input.reason?.trim())
        throw new AppError(400, 'CORRECTION_REASON_REQUIRED', 'Explain the correction.');
      const resultId = randomUUID();
      await client.query(
        'INSERT INTO lab_results(result_id,donation_id,test_type_id,value,revision,performed_at,recorded_by,replaces_result_id,reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          resultId,
          donationId,
          type.test_type_id,
          input.value,
          (previous?.revision ?? 0) + 1,
          input.performedAt,
          context.userId,
          previous?.result_id ?? null,
          input.reason ?? null,
        ],
      );
      if (donation.lab_status === 'RELEASED') {
        await client.query(
          "UPDATE donations SET lab_status='QUARANTINED',verified_type=NULL WHERE donation_id=$1",
          [donationId],
        );
        await client.query(
          "UPDATE blood_components SET status='QUARANTINED' WHERE donation_id=$1 AND status='AVAILABLE'",
          [donationId],
        );
        const issued = (
          await client.query(
            "SELECT component_id FROM blood_components WHERE donation_id=$1 AND status='DISPENSED'",
            [donationId],
          )
        ).rows.map((r) => r.component_id);
        await writeAudit(
          client,
          'LAB_RELEASE_INVALIDATED',
          {
            donationId,
            resultId,
            previousResultId: previous?.result_id,
            issuedComponentIds: issued,
          },
          context,
        );
      }
      await writeAudit(
        client,
        'LAB_RESULT_RECORDED',
        { donationId, resultId, testCode: input.testCode, revision: (previous?.revision ?? 0) + 1 },
        context,
      );
      return {
        resultId,
        donationId,
        testCode: input.testCode,
        value: input.value,
        revision: (previous?.revision ?? 0) + 1,
      };
    },
    context,
  );
}

export async function resultHistory(pool: Pool, donationId: string) {
  const found = await pool.query('SELECT 1 FROM donations WHERE donation_id=$1', [donationId]);
  if (!found.rowCount) throw new AppError(404, 'NOT_FOUND', 'Donation not found.');
  const results = await pool.query(
    `SELECT r.result_id AS "resultId",t.code AS "testCode",r.value,r.revision,r.performed_at AS "performedAt",r.recorded_at AS "recordedAt",r.reason,r.replaces_result_id AS "replacesResultId" FROM lab_results r JOIN lab_test_types t USING(test_type_id) WHERE r.donation_id=$1 ORDER BY r.recorded_at,r.revision`,
    [donationId],
  );
  return { results: results.rows };
}

export async function latestResults(client: Pool | PoolClient, donationId: string) {
  return (
    await client.query(
      `SELECT t.code,t.result_kind,r.value,r.result_id,r.revision
    FROM donations d JOIN lab_test_types t ON t.panel_version=d.required_panel_version AND t.required
    LEFT JOIN LATERAL (SELECT * FROM lab_results WHERE donation_id=d.donation_id AND test_type_id=t.test_type_id ORDER BY revision DESC LIMIT 1) r ON true
    WHERE d.donation_id=$1 ORDER BY t.code`,
      [donationId],
    )
  ).rows;
}

export function releaseDonation(
  pool: Pool,
  key: string,
  donationId: string,
  context: AuditContext,
  input: { decision: 'APPROVE' | 'REJECT'; reason?: string } = { decision: 'APPROVE' },
) {
  return mutate(
    pool,
    key,
    'lab-release',
    { donationId, ...input },
    async (client) => {
      const donation = (
        await client.query('SELECT * FROM donations WHERE donation_id=$1 FOR UPDATE', [donationId])
      ).rows[0];
      if (!donation) throw new AppError(404, 'NOT_FOUND', 'Donation not found.');
      if (donation.lab_status === 'REJECTED')
        throw new AppError(409, 'LAB_REJECTED', 'A rejected donation cannot be released.');
      const results = await latestResults(client, donationId);
      if (input.decision === 'REJECT') {
        const releaseId = randomUUID();
        await client.query(
          "INSERT INTO release_decisions(release_id,donation_id,result_version_refs,decision,approved_by,reason) VALUES ($1,$2,$3,'REJECT',$4,$5)",
          [
            releaseId,
            donationId,
            results.filter((r) => r.result_id).map((r) => r.result_id),
            context.userId,
            input.reason,
          ],
        );
        await client.query(
          "UPDATE donations SET lab_status='REJECTED',verified_type=NULL WHERE donation_id=$1",
          [donationId],
        );
        await client.query(
          "UPDATE blood_components SET status='QUARANTINED' WHERE donation_id=$1 AND status='AVAILABLE'",
          [donationId],
        );
        await writeAudit(
          client,
          'LAB_REJECTED',
          { donationId, releaseId, reason: input.reason },
          context,
        );
        return { donationId, labStatus: 'REJECTED', releaseId };
      }
      if (
        !results.length ||
        results.some(
          (r) =>
            !r.value ||
            (r.result_kind === 'SCREENING' && r.value !== 'NEGATIVE') ||
            (r.result_kind === 'TYPING' && r.value !== donation.initial_type),
        )
      ) {
        throw new AppError(
          409,
          'LAB_NOT_CLEARED',
          'Complete acceptable screening results and matching blood typing are required.',
        );
      }
      const releaseId = randomUUID();
      const reason = input.reason ?? DEFAULT_RELEASE_REASON;
      await client.query(
        "INSERT INTO release_decisions(release_id,donation_id,result_version_refs,decision,approved_by,reason) VALUES ($1,$2,$3,'APPROVE',$4,$5)",
        [releaseId, donationId, results.map((r) => r.result_id), context.userId, reason],
      );
      await client.query(
        "UPDATE donations SET lab_status='RELEASED',verified_type=initial_type WHERE donation_id=$1",
        [donationId],
      );
      await client.query(
        "UPDATE blood_components SET status='AVAILABLE' WHERE donation_id=$1 AND status='QUARANTINED' AND expires_at > clock_timestamp() AND location_id IS NOT NULL",
        [donationId],
      );
      await writeAudit(
        client,
        'LAB_RELEASED',
        { donationId, releaseId, reason, resultIds: results.map((r) => r.result_id) },
        context,
      );
      return { donationId, labStatus: 'RELEASED', releaseId };
    },
    context,
  );
}
