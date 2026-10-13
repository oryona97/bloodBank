import type { Pool } from 'pg';
export async function listDonations(pool: Pool, role: string, search = '', labStatus?: string) {
  const identifying =
    role === 'OPERATOR' ? ',p.full_name AS "donorFullName",p.demo_identifier AS "donorId"' : '';
  const result = await pool.query(
    `SELECT d.donation_id AS "donationId",d.initial_type AS "bloodType",d.verified_type AS "verifiedType",d.collected_at AS "collectedAt",d.donation_date::text AS "donationDate",d.lab_status AS "labStatus",d.processed_at AS "processedAt",d.required_panel_version AS "panelVersion",d.created_at AS "createdAt" ${identifying}
    FROM donations d JOIN donors p USING(donor_id)
    WHERE ($2::text IS NULL OR d.lab_status=$2) AND (strpos(lower(d.donation_id::text),lower($1))>0 ${role === 'OPERATOR' ? 'OR strpos(lower(p.full_name),lower($1))>0 OR strpos(p.demo_identifier,$1)>0' : ''})
    ORDER BY d.created_at DESC,d.donation_id DESC LIMIT 500`,
    [search, labStatus ?? null],
  );
  return { donations: result.rows };
}
