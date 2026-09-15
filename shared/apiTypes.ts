export const BLOOD_TYPES = ['A+', 'O+', 'B+', 'AB+', 'A-', 'O-', 'B-', 'AB-'] as const;
export type BloodType = (typeof BLOOD_TYPES)[number];
export type Inventory = Record<BloodType, number>;
export type AllocationLine = { bloodType: BloodType; quantity: number };
export type Allocation = {
  recipientType: BloodType;
  quantity: number;
  lines: AllocationLine[];
  available: number;
  shortfall: number;
  canFulfill: boolean;
};
export type DonationInput = {
  bloodType: BloodType;
  donationDate: string;
  donorId: string;
  donorFullName: string;
};
export type DispenseReceipt = {
  eventId: string;
  mode: 'ROUTINE' | 'EMERGENCY';
  quantity: number;
  lines: AllocationLine[];
};
export type Activity = {
  id: string;
  kind: 'DONATION' | 'ROUTINE' | 'EMERGENCY';
  createdAt: string;
  quantity: number;
  bloodType: BloodType | null;
};
export type InventoryResponse = { inventory: Inventory; activity: Activity[] };
export type ApiErrorBody = { error: string; code: string; fields?: Record<string, string> };
export function emptyInventory(): Inventory {
  return Object.fromEntries(BLOOD_TYPES.map((type) => [type, 0])) as Inventory;
}
