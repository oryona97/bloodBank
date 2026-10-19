import { BLOOD_TYPES } from '../../shared/apiTypes.js';
import { createHash } from 'node:crypto';
import { createPool } from '../src/storage/database.js';
import { registerDonation } from '../src/services/inventoryService.js';
import { produceComponents, deriveCryo } from '../src/services/componentService.js';
import { recordResult, releaseDonation } from '../src/services/labService.js';
import { listComponents } from '../src/storage/componentsRepository.js';
if (process.env.DEMO_MODE !== 'true')
  throw new Error('Synthetic seeding requires explicit DEMO_MODE=true.');
const pool = createPool();
const counts = [8, 12, 6, 3, 4, 5, 2, 1];
const args = process.argv.slice(2);
const batch = args.length === 2 && args[0] === '--batch' ? args[1] : undefined;
if (args.length && (!batch || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(batch)))
  throw new Error(
    'Use --batch followed by a unique label such as 2026-10-19. Reuse a label to retry without duplicating stock.',
  );
const hashedKey = (value: string) => {
  const hash = createHash('sha256').update(`bloodbank-demo:${value}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};
const key = (i: number) =>
  batch ? hashedKey(`${batch}:${i}`) : `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const batchDonorOffset = batch
  ? (parseInt(createHash('sha256').update(batch).digest('hex').slice(0, 6), 16) % 100000) * 1000
  : 0;
try {
  const lab = (
    await pool.query("SELECT id FROM users WHERE username='demo_lab' AND role='LAB' AND active")
  ).rows[0];
  if (!lab) throw new Error('Run database migrations first to create synthetic demo accounts.');
  const context = {
    actor: 'synthetic-seed',
    source: 'seed' as const,
    userId: lab.id as string,
    role: 'LAB',
  };
  for (const [index, bloodType] of BLOOD_TYPES.entries())
    for (let n = 0; n < counts[index]!; n++) {
      const base = (index * 100 + n) * 20;
      const donorId = String(
        batch ? 700000000 + batchDonorOffset + index * 100 + n : 900000000 + index * 100 + n,
      );
      const donorFullName = batch
        ? `Synthetic ${batch} Donor ${index + 1}-${n + 1}`
        : `Synthetic Donor ${index + 1}-${n + 1}`;
      if (batch) {
        const found = (
          await pool.query('SELECT full_name FROM donors WHERE demo_identifier=$1', [donorId])
        ).rows[0];
        if (found && found.full_name !== donorFullName)
          throw new Error('Synthetic donor identifier collision. Use a different batch label.');
      }
      const existing = (
        await pool.query(
          "SELECT d.collected_at FROM operation_requests r JOIN donations d ON d.donation_id=(r.response->>'donationId')::uuid WHERE r.request_key=$1",
          [key(base)],
        )
      ).rows[0];
      const collectedAt =
        existing?.collected_at?.toISOString() ??
        new Date(Date.now() - (batch ? 3600000 : 86400000)).toISOString();
      // Stable keys return original receipts and never replenish previously issued stock.
      const donation = await registerDonation(
        pool,
        key(base),
        {
          bloodType,
          collectedAt,
          donationDate: batch
            ? new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Jerusalem',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
              }).format(new Date(collectedAt))
            : collectedAt.slice(0, 10),
          donorId,
          donorFullName,
        },
        context,
      );
      await produceComponents(
        pool,
        key(base + 1),
        donation.donationId,
        n % 3 === 0 ? 'PRBC_FFP_PLATELETS' : 'PRBC_FFP',
        context,
      );
      const baseline = ['ABO_RH', 'HIV', 'HBV', 'HCV', 'SYPHILIS'];
      const panel = (
        await pool.query(
          'SELECT t.code,t.result_kind FROM donations d JOIN lab_test_types t ON t.panel_version=d.required_panel_version WHERE d.donation_id=$1 ORDER BY t.code',
          [donation.donationId],
        )
      ).rows as { code: string; result_kind: string }[];
      const ordered = [
        ...baseline,
        ...panel.filter((t) => !baseline.includes(t.code)).map((t) => t.code),
      ];
      for (const [offset, testCode] of ordered.entries())
        await recordResult(
          pool,
          offset < baseline.length
            ? key(base + 2 + offset)
            : hashedKey(`${batch ?? 'legacy'}:${base}:result:${testCode}`),
          donation.donationId,
          {
            testCode,
            value:
              panel.find((t) => t.code === testCode)?.result_kind === 'TYPING'
                ? bloodType
                : 'NEGATIVE',
            performedAt: collectedAt,
          },
          context,
        );
      await releaseDonation(pool, key(base + 8), donation.donationId, context);
      if (n === 0) {
        const plasma = (
          await listComponents(pool, { donationId: donation.donationId })
        ).components.find((c) => c.productType === 'FFP');
        if (plasma) await deriveCryo(pool, key(base + 9), plasma.componentId, context);
      }
    }
  console.log(
    `Synthetic demonstration batch ${batch ?? 'original'} prepared. Existing records and expiry dates were preserved; rerunning this batch does not replenish stock.`,
  );
} finally {
  await pool.end();
}
