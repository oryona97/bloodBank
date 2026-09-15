import { describe, expect, it } from 'vitest';
import { BLOOD_TYPES, emptyInventory, type BloodType } from '../../../shared/apiTypes.js';
import { isCompatible } from './compatibility.js';
import { planAllocation } from './allocation.js';

// Independent donor-to-recipient fixture transcribed from the assignment.
const recipients: Record<BloodType, BloodType[]> = {
  'A+': ['A+', 'AB+'],
  'O+': ['O+', 'A+', 'B+', 'AB+'],
  'B+': ['B+', 'AB+'],
  'AB+': ['AB+'],
  'A-': ['A+', 'A-', 'AB+', 'AB-'],
  'O-': ['A+', 'O+', 'B+', 'AB+', 'A-', 'O-', 'B-', 'AB-'],
  'B-': ['B+', 'B-', 'AB+', 'AB-'],
  'AB-': ['AB+', 'AB-'],
};
describe('assignment compatibility matrix', () => {
  for (const donor of BLOOD_TYPES)
    for (const recipient of BLOOD_TYPES) {
      it(`${donor} → ${recipient}`, () =>
        expect(isCompatible(donor, recipient)).toBe(recipients[donor].includes(recipient)));
    }
});
describe('allocation', () => {
  it('uses exact type, common alternatives, then O-negative', () => {
    const inventory = { ...emptyInventory(), 'A+': 1, 'O+': 2, 'A-': 2, 'O-': 5 };
    const original = { ...inventory };
    expect(planAllocation('A+', 4, inventory).lines).toEqual([
      { bloodType: 'A+', quantity: 1 },
      { bloodType: 'O+', quantity: 2 },
      { bloodType: 'A-', quantity: 1 },
    ]);
    expect(inventory).toEqual(original);
  });
  it('prefers rare exact stock over common alternatives', () => {
    expect(planAllocation('AB-', 1, { ...emptyInventory(), 'AB-': 1, 'A-': 9 }).lines).toEqual([
      { bloodType: 'AB-', quantity: 1 },
    ]);
  });
  it('preserves O-negative even before rarer B-negative', () => {
    expect(planAllocation('B+', 2, { ...emptyInventory(), 'B-': 2, 'O-': 9 }).lines).toEqual([
      { bloodType: 'B-', quantity: 2 },
    ]);
  });
  it('uses O-negative when it is the only compatible choice', () => {
    expect(planAllocation('A+', 2, { ...emptyInventory(), 'B+': 99, 'O-': 2 }).lines).toEqual([
      { bloodType: 'O-', quantity: 2 },
    ]);
  });
  it('reports shortages without incompatible stock', () => {
    expect(planAllocation('O-', 3, { ...emptyInventory(), 'O+': 99, 'O-': 1 })).toMatchObject({
      canFulfill: false,
      available: 1,
      shortfall: 2,
    });
  });
  it.each([0, -1, 1.5, NaN, Infinity])('rejects quantity %s', (quantity) => {
    expect(() => planAllocation('A+', quantity, emptyInventory())).toThrow();
  });
});
