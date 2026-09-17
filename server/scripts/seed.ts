import { BLOOD_TYPES } from '../../shared/apiTypes.js';
import { createPool } from '../src/storage/database.js';
import { registerDonation } from '../src/services/inventoryService.js';
import { publicUserColumns } from '../src/auth/routes.js';
import type { User } from '../../shared/apiTypes.js';
const pool = createPool();
const counts = [8, 12, 6, 3, 4, 5, 2, 1];
try {
  const admin = (
    await pool.query<User>(
      `SELECT ${publicUserColumns} FROM users WHERE role='ADMIN' AND active ORDER BY created_at LIMIT 1`,
    )
  ).rows[0];
  if (!admin) throw new Error('Bootstrap an administrator before running the synthetic seed.');
  for (const [index, bloodType] of BLOOD_TYPES.entries()) {
    for (let n = 0; n < counts[index]!; n++) {
      // Fixed keys make seeding repeatable without refilling previously issued units.
      const key = `00000000-0000-4000-8000-${String(index * 100 + n).padStart(12, '0')}`;
      // Keep historical seed receipts, including those created before accounts existed.
      if (
        (await pool.query('SELECT request_key FROM operation_requests WHERE request_key=$1', [key]))
          .rowCount
      )
        continue;
      await registerDonation(
        pool,
        key,
        {
          bloodType,
          donationDate: '2026-01-15',
          donorId: String(900000000 + index * 100 + n),
          donorFullName: `Demo Donor ${index + 1}-${n + 1}`,
        },
        admin,
      );
    }
  }
  console.log('Synthetic demo seed applied (41 units on first run).');
} finally {
  await pool.end();
}
