import { BLOOD_TYPES, type BloodType } from '../../../shared/apiTypes.js';

// Assignment-supplied model, indexed by recipient. Not a clinical protocol.
export const COMPATIBILITY: Record<BloodType, readonly BloodType[]> = {
  'A+': ['A+', 'A-', 'O+', 'O-'],
  'O+': ['O+', 'O-'],
  'B+': ['B+', 'B-', 'O+', 'O-'],
  'AB+': BLOOD_TYPES,
  'A-': ['A-', 'O-'],
  'O-': ['O-'],
  'B-': ['B-', 'O-'],
  'AB-': ['AB-', 'A-', 'B-', 'O-'],
};
export const POPULATION_SHARE: Record<BloodType, number> = {
  'A+': 34,
  'O+': 32,
  'B+': 17,
  'AB+': 7,
  'A-': 4,
  'O-': 3,
  'B-': 2,
  'AB-': 1,
};
export function isCompatible(donor: BloodType, recipient: BloodType): boolean {
  return COMPATIBILITY[recipient].includes(donor);
}
