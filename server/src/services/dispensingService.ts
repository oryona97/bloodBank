import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { BloodType } from '../../../shared/apiTypes.js';
import { planComponentAllocation, type ComponentAllocation } from '../domain/components.js';
import { componentStock } from '../storage/componentsRepository.js';
import { writeAudit, type AuditContext } from '../storage/auditRepository.js';
import { AppError } from '../errors.js';
import { mutate } from './inventoryService.js';

export type Confirmation = Pick<
  ComponentAllocation,
  'productType' | 'recipientType' | 'quantity' | 'componentIds' | 'lines'
> & { recipientReference: string };
async function issueComponents(
  client: PoolClient,
  plan: ComponentAllocation,
  mode: 'ROUTINE' | 'EMERGENCY',
  recipientReference: string,
  context: AuditContext,
) {
  const eventId = randomUUID();
  await client.query(
    'INSERT INTO dispense_events(event_id,mode,recipient_blood_type,requested_quantity,product_type,recipient_reference,issued_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [
      eventId,
      mode,
      mode === 'ROUTINE' ? plan.recipientType : null,
      plan.quantity,
      plan.productType,
      recipientReference,
      context.userId,
    ],
  );
  const updated = await client.query(
    "UPDATE blood_components SET status='DISPENSED' WHERE component_id=ANY($1::uuid[]) AND status='AVAILABLE'",
    [plan.componentIds],
  );
  if (updated.rowCount !== plan.componentIds.length)
    throw new AppError(409, 'STOCK_CHANGED', 'Components changed. Preview again.');
  await client.query(
    'INSERT INTO dispense_event_components(event_id,component_id) SELECT $1::uuid,unnest($2::uuid[])',
    [eventId, plan.componentIds],
  );
  const receipt = {
    eventId,
    mode,
    productType: plan.productType,
    quantity: plan.quantity,
    lines: plan.lines,
    componentIds: plan.componentIds,
  };
  await writeAudit(client, `DISPENSE_${mode}`, { ...receipt, recipientReference }, context);
  return receipt;
}
export function confirmComponents(
  pool: Pool,
  key: string,
  input: Confirmation,
  context: AuditContext,
  now: () => Date,
) {
  return mutate(
    pool,
    key,
    'routine-components',
    input,
    async (client) => {
      const plan = planComponentAllocation(
        input.productType,
        input.recipientType,
        input.quantity,
        await componentStock(client),
        now(),
      );
      if (
        !plan.canFulfill ||
        JSON.stringify(plan.componentIds) !== JSON.stringify(input.componentIds) ||
        JSON.stringify(plan.lines) !== JSON.stringify(input.lines)
      )
        throw new AppError(
          409,
          'STOCK_CHANGED',
          'Allocation changed or is no longer eligible. Preview again.',
        );
      return issueComponents(client, plan, 'ROUTINE', input.recipientReference, context);
    },
    context,
  );
}
export function emergencyComponents(
  pool: Pool,
  key: string,
  input: { quantity: number; recipientReference: string },
  context: AuditContext,
  now: () => Date,
) {
  return mutate(
    pool,
    key,
    'emergency-components',
    input,
    async (client) => {
      const plan = planComponentAllocation(
        'PRBC',
        'O-',
        input.quantity,
        await componentStock(client),
        now(),
      );
      if (!plan.canFulfill)
        throw new AppError(
          409,
          'INSUFFICIENT_EMERGENCY_STOCK',
          'There are not enough cleared, unexpired O-negative red cells.',
        );
      return issueComponents(client, plan, 'EMERGENCY', input.recipientReference, context);
    },
    context,
  );
}
