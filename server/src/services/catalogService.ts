import type { Pool } from 'pg';
import type { ProductType } from '../domain/components.js';
import { mutate } from './inventoryService.js';
import { writeAudit, type AuditContext } from '../storage/auditRepository.js';
export async function catalog(pool: Pool) {
  const products = (
    await pool.query(
      "SELECT * FROM component_types WHERE code<>'LEGACY' ORDER BY code,policy_version DESC",
    )
  ).rows;
  const locations = (await pool.query('SELECT * FROM storage_locations ORDER BY label')).rows;
  const tests = (
    await pool.query(
      'SELECT code,panel_version,result_kind,required FROM lab_test_types ORDER BY panel_version,code',
    )
  ).rows;
  return { products, locations, tests };
}
export function reviseProduct(
  pool: Pool,
  key: string,
  input: { productType: ProductType; expiryDays: number },
  context: AuditContext,
) {
  return mutate(
    pool,
    key,
    'product-policy',
    input,
    async (client) => {
      const previous = (
        await client.query(
          'SELECT * FROM component_types WHERE code=$1 ORDER BY policy_version DESC LIMIT 1',
          [input.productType],
        )
      ).rows[0];
      const created = (
        await client.query(
          'INSERT INTO component_types(code,policy_version,expiry_days,storage_class,min_c,max_c,agitation) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
          [
            input.productType,
            previous.policy_version + 1,
            input.expiryDays,
            previous.storage_class,
            previous.min_c,
            previous.max_c,
            previous.agitation,
          ],
        )
      ).rows[0];
      await writeAudit(
        client,
        'PRODUCT_POLICY_CREATED',
        {
          productType: input.productType,
          policyVersion: created.policy_version,
          expiryDays: input.expiryDays,
        },
        context,
      );
      return created;
    },
    context,
  );
}
