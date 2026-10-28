import { BLOOD_TYPES, type BloodType, type AllocationLine } from '../../../shared/apiTypes.js';
import { PRODUCTS, type Product } from '../../../shared/becsTypes.js';
import { COMPATIBILITY, POPULATION_SHARE } from './compatibility.js';
export const PRODUCT_TYPES = PRODUCTS;
export type ProductType = Product;
export const PRODUCT_POLICIES = {
  PRBC: { days: 42, minC: 1, maxC: 6, agitation: false, storageClass: 'REFRIGERATED' },
  FFP: { days: 365, minC: null, maxC: -18, agitation: false, storageClass: 'FROZEN' },
  Platelets: { days: 5, minC: 20, maxC: 24, agitation: true, storageClass: 'AGITATED' },
  Cryoprecipitate: { days: 365, minC: null, maxC: -18, agitation: false, storageClass: 'FROZEN' },
} as const;

export function calculateProfileExpiry(
  profile: { expiry_days: number; expiry_basis: 'COLLECTION' | 'SOURCE_EXPIRY' },
  collectedAt: string,
  sourceExpiresAt?: string,
): string {
  if (
    !Number.isSafeInteger(profile.expiry_days) ||
    profile.expiry_days <= 0 ||
    !Number.isFinite(Date.parse(collectedAt))
  )
    throw new Error('A complete expiry profile and collection time are required.');
  if (
    profile.expiry_basis === 'SOURCE_EXPIRY' &&
    (!sourceExpiresAt || !Number.isFinite(Date.parse(sourceExpiresAt)))
  )
    throw new Error('A known source expiry is required.');
  if (!['COLLECTION', 'SOURCE_EXPIRY'].includes(profile.expiry_basis))
    throw new Error('A valid expiry basis is required.');
  const calculated = Date.parse(collectedAt) + profile.expiry_days * 86400000;
  return new Date(
    profile.expiry_basis === 'SOURCE_EXPIRY'
      ? Math.min(calculated, Date.parse(sourceExpiresAt!))
      : calculated,
  ).toISOString();
}

export function calculateExpiry(
  product: ProductType,
  collectedAt: string,
  sourceExpiresAt?: string,
): string {
  return calculateProfileExpiry(
    {
      expiry_days: PRODUCT_POLICIES[product].days,
      expiry_basis: product === 'Cryoprecipitate' ? 'SOURCE_EXPIRY' : 'COLLECTION',
    },
    collectedAt,
    sourceExpiresAt,
  );
}

export type ComponentStock = {
  componentId: string;
  productType: string;
  bloodType: string;
  status: string;
  labStatus: string;
  expiresAt: string | null;
  collectedAt: string | null;
};
export type ComponentAllocation = {
  productType: ProductType;
  recipientType: BloodType;
  quantity: number;
  lines: AllocationLine[];
  componentIds: string[];
  available: number;
  shortfall: number;
  canFulfill: boolean;
};
const abo = (type: string) => type.replace(/[+-]$/, '');
const PLASMA: Record<string, string[]> = {
  A: ['A', 'AB'],
  B: ['B', 'AB'],
  AB: ['AB'],
  O: ['O', 'A', 'B', 'AB'],
};
export function productCompatible(product: ProductType, donor: BloodType, recipient: BloodType) {
  if (product === 'PRBC') return COMPATIBILITY[recipient].includes(donor);
  if (product === 'FFP') return PLASMA[abo(recipient)]!.includes(abo(donor));
  if (product === 'Platelets') return donor === recipient;
  return abo(donor) === abo(recipient);
}
export function planComponentAllocation(
  productType: ProductType,
  recipientType: BloodType,
  quantity: number,
  stock: ComponentStock[],
  now: Date,
): ComponentAllocation {
  if (
    !PRODUCT_TYPES.includes(productType) ||
    !BLOOD_TYPES.includes(recipientType) ||
    !Number.isSafeInteger(quantity) ||
    quantity <= 0
  )
    throw new Error('Select a valid product, recipient and positive whole-number quantity.');
  const eligible = stock.filter(
    (c) =>
      c.productType === productType &&
      c.status === 'AVAILABLE' &&
      c.labStatus === 'RELEASED' &&
      c.collectedAt &&
      Number.isFinite(Date.parse(c.collectedAt)) &&
      c.expiresAt &&
      Date.parse(c.expiresAt) > now.getTime() &&
      BLOOD_TYPES.includes(c.bloodType as BloodType) &&
      productCompatible(productType, c.bloodType as BloodType, recipientType),
  );
  const priority = (type: BloodType) => {
    if (productType !== 'PRBC')
      return abo(type) === abo(recipientType) ? 0 : 1 + ['O', 'A', 'B', 'AB'].indexOf(abo(type));
    return type === recipientType ? 0 : type === 'O-' ? 1000 : 100 - POPULATION_SHARE[type];
  };
  eligible.sort(
    (a, b) =>
      priority(a.bloodType as BloodType) - priority(b.bloodType as BloodType) ||
      Date.parse(a.expiresAt!) - Date.parse(b.expiresAt!) ||
      Date.parse(a.collectedAt ?? '') - Date.parse(b.collectedAt ?? '') ||
      a.componentId.localeCompare(b.componentId),
  );
  const selected = eligible.slice(0, quantity);
  const lines: AllocationLine[] = [];
  for (const c of selected) {
    const line = lines.find((l) => l.bloodType === c.bloodType);
    if (line) line.quantity++;
    else lines.push({ bloodType: c.bloodType as BloodType, quantity: 1 });
  }
  return {
    productType,
    recipientType,
    quantity,
    lines,
    componentIds: selected.map((c) => c.componentId),
    available: eligible.length,
    shortfall: Math.max(0, quantity - eligible.length),
    canFulfill: eligible.length >= quantity,
  };
}
