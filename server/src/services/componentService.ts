import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { AppError } from '../errors.js';
import type { AuditContext } from '../storage/auditRepository.js';
import { writeAudit } from '../storage/auditRepository.js';
import { mutate } from './inventoryService.js';
import { calculateProfileExpiry } from '../domain/components.js';

export function produceComponents(
  pool: Pool,
  key: string,
  donationId: string,
  template: 'PRBC_FFP' | 'PRBC_FFP_PLATELETS',
  context: AuditContext,
) {
  return mutate(
    pool,
    key,
    'produce-components',
    { donationId, template },
    async (client) => {
      const found = await client.query('SELECT * FROM donations WHERE donation_id=$1 FOR UPDATE', [
        donationId,
      ]);
      const donation = found.rows[0];
      if (!donation) throw new AppError(404, 'NOT_FOUND', 'Donation not found.');
      if (donation.processed_at || !donation.collected_at || donation.lab_status === 'REJECTED')
        throw new AppError(409, 'PROCESSING_BLOCKED', 'This donation cannot be processed.');
      const products = template === 'PRBC_FFP' ? ['PRBC', 'FFP'] : ['PRBC', 'FFP', 'Platelets'];
      const componentIds: string[] = [];
      for (const product of products) {
        const profile = (
          await client.query(
            'SELECT * FROM component_types WHERE code=$1 ORDER BY policy_version DESC LIMIT 1',
            [product],
          )
        ).rows[0];
        const location = (
          await client.query(
            'SELECT location_id FROM storage_locations WHERE storage_class=$1 ORDER BY label LIMIT 1',
            [profile.storage_class],
          )
        ).rows[0];
        if (!location)
          throw new AppError(409, 'STORAGE_REQUIRED', 'A suitable storage location is required.');
        const id = randomUUID();
        componentIds.push(id);
        const expiresAt = calculateProfileExpiry(profile, donation.collected_at.toISOString());
        await client.query(
          'INSERT INTO blood_components(component_id,donation_id,type_id,location_id,produced_at,expires_at,status) VALUES ($1,$2,$3,$4,clock_timestamp(),$5,$6)',
          [
            id,
            donationId,
            profile.type_id,
            location.location_id,
            expiresAt,
            donation.lab_status === 'RELEASED' && Date.parse(expiresAt) > Date.now()
              ? 'AVAILABLE'
              : 'QUARANTINED',
          ],
        );
      }
      await client.query(
        'UPDATE donations SET processed_at=clock_timestamp() WHERE donation_id=$1',
        [donationId],
      );
      await writeAudit(
        client,
        'COMPONENTS_PRODUCED',
        { donationId, template, componentIds },
        context,
      );
      return { donationId, componentIds };
    },
    context,
  );
}
export function deriveCryo(pool: Pool, key: string, componentId: string, context: AuditContext) {
  return mutate(
    pool,
    key,
    'derive-cryo',
    { componentId },
    async (client) => {
      const source = (
        await client.query(
          `SELECT c.*,t.code,d.collected_at,d.lab_status FROM blood_components c JOIN component_types t USING(type_id) JOIN donations d USING(donation_id) WHERE c.component_id=$1 FOR UPDATE OF c,d`,
          [componentId],
        )
      ).rows[0];
      if (!source) throw new AppError(404, 'NOT_FOUND', 'Source component not found.');
      if (
        source.code !== 'FFP' ||
        !['AVAILABLE', 'QUARANTINED'].includes(source.status) ||
        source.lab_status === 'REJECTED' ||
        !source.expires_at ||
        source.expires_at.getTime() <= Date.now()
      )
        throw new AppError(
          409,
          'PROCESSING_BLOCKED',
          'Only an unissued, unexpired plasma source can be processed.',
        );
      const profile = (
        await client.query(
          "SELECT * FROM component_types WHERE code='Cryoprecipitate' ORDER BY policy_version DESC LIMIT 1",
        )
      ).rows[0];
      const location = (
        await client.query(
          "SELECT location_id FROM storage_locations WHERE storage_class='FROZEN' ORDER BY label LIMIT 1",
        )
      ).rows[0];
      if (!location) throw new AppError(409, 'STORAGE_REQUIRED', 'A suitable freezer is required.');
      const id = randomUUID();
      await client.query(
        'INSERT INTO blood_components(component_id,donation_id,type_id,source_component_id,location_id,produced_at,expires_at,status) VALUES ($1,$2,$3,$4,$5,clock_timestamp(),$6,$7)',
        [
          id,
          source.donation_id,
          profile.type_id,
          componentId,
          location.location_id,
          calculateProfileExpiry(
            profile,
            source.collected_at.toISOString(),
            source.expires_at.toISOString(),
          ),
          source.lab_status === 'RELEASED' ? 'AVAILABLE' : 'QUARANTINED',
        ],
      );
      await client.query("UPDATE blood_components SET status='PROCESSED' WHERE component_id=$1", [
        componentId,
      ]);
      await writeAudit(
        client,
        'COMPONENT_PROCESSED',
        { sourceComponentId: componentId, componentId: id, donationId: source.donation_id },
        context,
      );
      return { componentId: id, sourceComponentId: componentId };
    },
    context,
  );
}
export function discardComponent(
  pool: Pool,
  key: string,
  componentId: string,
  reason: string,
  context: AuditContext,
) {
  return mutate(
    pool,
    key,
    'discard-component',
    { componentId, reason },
    async (client) => {
      const component = (
        await client.query('SELECT * FROM blood_components WHERE component_id=$1 FOR UPDATE', [
          componentId,
        ])
      ).rows[0];
      if (!component) throw new AppError(404, 'NOT_FOUND', 'Component not found.');
      if (!['AVAILABLE', 'QUARANTINED'].includes(component.status))
        throw new AppError(409, 'DISCARD_BLOCKED', 'This component has already left usable stock.');
      await client.query(
        "UPDATE blood_components SET status='DISCARDED',discard_reason=$2 WHERE component_id=$1",
        [componentId, reason],
      );
      await writeAudit(
        client,
        'COMPONENT_DISCARDED',
        { componentId, donationId: component.donation_id, reason },
        context,
      );
      return { componentId, status: 'DISCARDED', discardReason: reason };
    },
    context,
  );
}
export function completeLegacyDetails(
  pool: Pool,
  key: string,
  componentId: string,
  input: { productType: 'PRBC' | 'FFP' | 'Platelets'; collectedAt: string; reason: string },
  context: AuditContext,
) {
  return mutate(
    pool,
    key,
    'legacy-details',
    { componentId, ...input },
    async (client) => {
      const component = (
        await client.query(
          `SELECT c.*,t.code,d.lab_status,d.donation_date::text AS donation_date FROM blood_components c JOIN component_types t USING(type_id) JOIN donations d USING(donation_id) WHERE c.component_id=$1 FOR UPDATE OF c,d`,
          [componentId],
        )
      ).rows[0];
      if (!component) throw new AppError(404, 'NOT_FOUND', 'Component not found.');
      if (
        component.code !== 'LEGACY' ||
        component.status !== 'QUARANTINED' ||
        component.lab_status !== 'QUARANTINED'
      )
        throw new AppError(
          409,
          'LEGACY_CHANGE_BLOCKED',
          'Only unissued, quarantined legacy records can be completed.',
        );
      const localDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jerusalem',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(input.collectedAt));
      if (localDate !== component.donation_date)
        throw new AppError(
          400,
          'INVALID_COLLECTION_TIME',
          'Verified collection time must match the preserved donation date.',
        );
      const profile = (
        await client.query(
          'SELECT * FROM component_types WHERE code=$1 ORDER BY policy_version DESC LIMIT 1',
          [input.productType],
        )
      ).rows[0];
      const location = (
        await client.query(
          'SELECT location_id FROM storage_locations WHERE storage_class=$1 ORDER BY label LIMIT 1',
          [profile.storage_class],
        )
      ).rows[0];
      if (!location)
        throw new AppError(409, 'STORAGE_REQUIRED', 'A suitable storage location is required.');
      await client.query(
        'UPDATE donations SET collected_at=$2,processed_at=clock_timestamp() WHERE donation_id=$1',
        [component.donation_id, input.collectedAt],
      );
      await client.query(
        'UPDATE blood_components SET type_id=$2,location_id=$3,expires_at=$4 WHERE component_id=$1',
        [
          componentId,
          profile.type_id,
          location.location_id,
          calculateProfileExpiry(profile, input.collectedAt),
        ],
      );
      await writeAudit(
        client,
        'LEGACY_DETAILS_VERIFIED',
        { componentId, donationId: component.donation_id, ...input },
        context,
      );
      return { componentId, status: 'QUARANTINED' };
    },
    context,
  );
}
