import { BLOOD_TYPES } from '../../shared/apiTypes.js';
import { createPool } from '../src/storage/database.js';
import { registerDonation } from '../src/services/inventoryService.js';
import { produceComponents, deriveCryo } from '../src/services/componentService.js';
import { recordResult, releaseDonation } from '../src/services/labService.js';
import { listComponents } from '../src/storage/componentsRepository.js';
if (process.env.DEMO_MODE !== 'true')
  throw new Error('Synthetic seeding requires explicit DEMO_MODE=true.');
const pool = createPool();
const counts = [8, 12, 6, 3, 4, 5, 2, 1];
const key = (i: number) => `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
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
      const existing = (
        await pool.query(
          "SELECT d.collected_at FROM operation_requests r JOIN donations d ON d.donation_id=(r.response->>'donationId')::uuid WHERE r.request_key=$1",
          [key(base)],
        )
      ).rows[0];
      const collectedAt =
        existing?.collected_at?.toISOString() ?? new Date(Date.now() - 86400000).toISOString();
      // Stable keys return original receipts and never replenish previously issued stock.
      const donation = await registerDonation(
        pool,
        key(base),
        {
          bloodType,
          collectedAt,
          donationDate: collectedAt.slice(0, 10),
          donorId: String(900000000 + index * 100 + n),
          donorFullName: `Synthetic Donor ${index + 1}-${n + 1}`,
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
      for (const [offset, testCode] of ['ABO_RH', 'HIV', 'HBV', 'HCV', 'SYPHILIS'].entries())
        await recordResult(
          pool,
          key(base + 2 + offset),
          donation.donationId,
          {
            testCode,
            value: testCode === 'ABO_RH' ? bloodType : 'NEGATIVE',
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
    'Synthetic component demonstration records prepared; existing issued components were not replenished.',
  );
} finally {
  await pool.end();
}
