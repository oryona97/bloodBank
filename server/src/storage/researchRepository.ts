import type { Pool } from 'pg';
import { BLOOD_TYPES, type ResearchSummary } from '../../../shared/apiTypes.js';
import { transaction } from '../auth/routes.js';

export async function getResearchSummary(pool: Pool): Promise<ResearchSummary> {
  const throughYear = new Date().getUTCFullYear() - 1;
  return transaction(pool, async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(81263003)');
    const saved = await db.query('SELECT summary FROM research_snapshots WHERE through_year=$1', [
      throughYear,
    ]);
    if (saved.rowCount) return saved.rows[0].summary as ResearchSummary;
    const previous = await db.query(
      'SELECT summary FROM research_snapshots ORDER BY through_year DESC LIMIT 1',
    );
    const prior = previous.rows[0]?.summary as ResearchSummary | undefined;
    const result = await db.query(
      `SELECT extract(year FROM donation_date)::int AS year, blood_type, count(*)::int AS count, count(DISTINCT donor_id)::int AS donors
      FROM blood_units WHERE extract(year FROM donation_date) <= $1 AND extract(year FROM donation_date) > $2
      GROUP BY 1,2 ORDER BY 1,2`,
      [throughYear, prior?.throughYear ?? 0],
    );
    const years = [...new Set<number>(result.rows.map((row) => row.year))];
    const rows: ResearchSummary['rows'] = [...(prior?.rows ?? [])];
    for (const year of years)
      for (const bloodType of BLOOD_TYPES) {
        const group = result.rows.find((row) => row.year === year && row.blood_type === bloodType);
        rows.push({ year, bloodType, donations: group && group.donors >= 5 ? group.count : null });
      }
    const summary: ResearchSummary = { throughYear, minimumGroupSize: 5, rows };
    await db.query('INSERT INTO research_snapshots(through_year, summary) VALUES ($1,$2::jsonb)', [
      throughYear,
      JSON.stringify(summary),
    ]);
    return summary;
  });
}
