import {
  BLOOD_TYPES,
  type Allocation,
  type BloodType,
  type Inventory,
} from '../../../shared/apiTypes.js';
import { COMPATIBILITY, POPULATION_SHARE } from './compatibility.js';

export function planAllocation(
  recipientType: BloodType,
  quantity: number,
  inventory: Inventory,
): Allocation {
  if (!BLOOD_TYPES.includes(recipientType) || !Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error('A valid blood type and positive whole-number quantity are required.');
  }
  if (BLOOD_TYPES.some((type) => !Number.isSafeInteger(inventory[type]) || inventory[type] < 0)) {
    throw new Error('Inventory must contain nonnegative whole-number counts.');
  }
  const alternatives = COMPATIBILITY[recipientType]
    .filter((type) => type !== recipientType)
    .sort((a, b) => {
      if (a === 'O-') return 1;
      if (b === 'O-') return -1;
      return (
        POPULATION_SHARE[b] - POPULATION_SHARE[a] || BLOOD_TYPES.indexOf(a) - BLOOD_TYPES.indexOf(b)
      );
    });
  const available = COMPATIBILITY[recipientType].reduce((sum, type) => sum + inventory[type], 0);
  let remaining = quantity;
  const lines: Allocation['lines'] = [];
  for (const bloodType of [recipientType, ...alternatives]) {
    const count = Math.min(remaining, inventory[bloodType]);
    if (count) lines.push({ bloodType, quantity: count });
    remaining -= count;
  }
  return {
    recipientType,
    quantity,
    lines,
    available,
    shortfall: remaining,
    canFulfill: remaining === 0,
  };
}
