import { BLOOD_TYPES } from '../../shared/apiTypes.js';
import { createPool } from '../src/storage/database.js';
import { registerDonation } from '../src/services/inventoryService.js';
const pool = createPool();
const counts = [8, 12, 6, 3, 4, 5, 2, 1];
try {
  for (const [index, bloodType] of BLOOD_TYPES.entries()) {
    for (let n = 0; n < counts[index]!; n++) {
      // Fixed keys make seeding repeatable without refilling previously issued units.
      const key = `00000000-0000-4000-8000-${String(index * 100 + n).padStart(12, '0')}`;
      await registerDonation(pool, key, {
        bloodType,
        donationDate: '2026-01-15',
        donorId: String(900000000 + index * 100 + n),
        donorFullName: `Demo Donor ${index + 1}-${n + 1}`,
      });
    }
  }
  console.log('Synthetic demo seed applied (41 units on first run).');
} finally {
  await pool.end();
}
