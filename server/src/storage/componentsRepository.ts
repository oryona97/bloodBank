import type { Pool, PoolClient } from 'pg';
import type { ComponentStock } from '../domain/components.js';

export async function componentStock(pool: Pool | PoolClient): Promise<ComponentStock[]> {
  const rows = (
    await pool.query(
      `SELECT c.component_id AS "componentId",t.code AS "productType",COALESCE(d.verified_type,d.initial_type) AS "bloodType",c.status,d.lab_status AS "labStatus",c.expires_at AS "expiresAt",d.collected_at AS "collectedAt" FROM blood_components c JOIN component_types t USING(type_id) JOIN donations d USING(donation_id) JOIN storage_locations l USING(location_id) WHERE l.storage_class=t.storage_class AND d.collected_at IS NOT NULL`,
    )
  ).rows;
  return rows.map((r) => ({
    ...r,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    collectedAt: r.collectedAt?.toISOString() ?? null,
  }));
}

export type ComponentFilters = {
  donationId?: string;
  productType?: string;
  bloodType?: string;
  status?: string;
  expiresBefore?: string;
  search?: string;
  page?: number;
};
export async function listComponents(pool: Pool, filters: ComponentFilters = {}, now = new Date()) {
  const result = await pool.query(
    `WITH records AS (SELECT c.component_id AS "componentId",c.donation_id AS "donationId",t.code AS "productType",t.policy_version AS "policyVersion",CASE WHEN c.status IN ('QUARANTINED','AVAILABLE') AND c.expires_at <= $2 THEN 'EXPIRED' ELSE c.status END AS status,c.expires_at AS "expiresAt",c.produced_at AS "producedAt",c.source_component_id AS "sourceComponentId",c.location_id AS "locationId",l.label AS "storageLocation",COALESCE(d.verified_type,d.initial_type) AS "bloodType",d.lab_status AS "labStatus",c.discard_reason AS "discardReason",c.created_at AS "createdAt"
    FROM blood_components c JOIN component_types t USING(type_id) JOIN donations d USING(donation_id)
    LEFT JOIN storage_locations l USING(location_id)
    WHERE ($1::uuid IS NULL OR c.donation_id=$1))
    SELECT *,count(*) OVER()::int AS total FROM records WHERE
    ($3::text IS NULL OR "productType"=$3) AND ($4::text IS NULL OR "bloodType"=$4) AND ($5::text IS NULL OR status=$5)
    AND ($6::timestamptz IS NULL OR ("expiresAt" > $2 AND "expiresAt" <= $6 AND status IN ('AVAILABLE','QUARANTINED') AND "labStatus" <> 'REJECTED'))
    AND (strpos("componentId"::text,$7)>0 OR strpos("donationId"::text,$7)>0)
    ORDER BY "createdAt","componentId" LIMIT 100 OFFSET $8`,
    [
      filters.donationId ?? null,
      now,
      filters.productType ?? null,
      filters.bloodType ?? null,
      filters.status ?? null,
      filters.expiresBefore ?? null,
      filters.search ?? '',
      ((filters.page ?? 1) - 1) * 100,
    ],
  );
  return {
    components: result.rows,
    total: result.rows[0]?.total ?? 0,
    page: filters.page ?? 1,
    pageSize: 100,
  };
}
