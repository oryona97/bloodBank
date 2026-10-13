import type { BloodType, Inventory, AllocationLine } from './apiTypes.js';
export const PRODUCTS = ['PRBC', 'FFP', 'Platelets', 'Cryoprecipitate'] as const;
export type Product = (typeof PRODUCTS)[number];
export const ROLES = ['ADMIN', 'OPERATOR', 'LAB', 'DISPENSER', 'RESEARCHER'] as const;
export type Role = (typeof ROLES)[number];
export type SessionUser = { username: string; role: string };
export type DonationRecord = {
  donationId: string;
  bloodType: BloodType;
  verifiedType: BloodType | null;
  labStatus: string;
  collectedAt: string | null;
  donationDate: string;
  processedAt: string | null;
  panelVersion: number;
  donorFullName?: string;
  donorId?: string;
};
export type ComponentRecord = {
  componentId: string;
  donationId: string;
  productType: Product | 'LEGACY';
  bloodType: BloodType;
  status: string;
  labStatus: string;
  expiresAt: string | null;
  policyVersion: number;
  sourceComponentId: string | null;
  storageLocation: string | null;
  discardReason: string | null;
};
export type BecsInventory = {
  inventory: Inventory;
  products: Record<Product, Inventory>;
  statusCounts: Record<Product | 'LEGACY', Record<string, number>>;
};
export type BecsAllocation = {
  productType: Product;
  recipientType: BloodType;
  quantity: number;
  lines: AllocationLine[];
  componentIds: string[];
  available: number;
  shortfall: number;
  canFulfill: boolean;
};
export type ResultRecord = {
  resultId: string;
  testCode: string;
  value: string;
  revision: number;
  performedAt: string;
  recordedAt: string;
  reason: string | null;
};
export type Catalogue = {
  products: {
    code: Product;
    policy_version: number;
    expiry_days: number;
    storage_class: string;
    min_c: number | null;
    max_c: number | null;
    agitation: boolean;
  }[];
  locations: { location_id: string; label: string; storage_class: string }[];
  tests: { code: string; panel_version: number; result_kind: string; required: boolean }[];
};
