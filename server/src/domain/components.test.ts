import { describe, expect, it } from 'vitest';
import { calculateExpiry, planComponentAllocation } from './components.js';

describe('Component product policies', () => {
  it('uses the approved product shelf lives and never extends a cryo source expiry', () => {
    const collectedAt = '2026-10-01T09:00:00.000Z';
    expect([
      calculateExpiry('PRBC', collectedAt),
      calculateExpiry('FFP', collectedAt),
      calculateExpiry('Platelets', collectedAt),
      calculateExpiry('Cryoprecipitate', collectedAt, '2026-12-01T09:00:00.000Z'),
    ]).toEqual([
      '2026-11-12T09:00:00.000Z',
      '2027-10-01T09:00:00.000Z',
      '2026-10-06T09:00:00.000Z',
      '2026-12-01T09:00:00.000Z',
    ]);
  });
  it('uses plasma compatibility rather than the red-cell compatibility matrix', () => {
    const stock = ['O-', 'AB+'].map((bloodType, i) => ({
      componentId: String(i),
      productType: 'FFP',
      bloodType,
      status: 'AVAILABLE',
      labStatus: 'RELEASED',
      expiresAt: '2026-11-01T00:00:00Z',
      collectedAt: '2026-10-01T00:00:00Z',
    }));
    const plan = planComponentAllocation('FFP', 'AB+', 2, stock, new Date('2026-10-12T00:00:00Z'));
    expect({
      canFulfill: plan.canFulfill,
      available: plan.available,
      componentIds: plan.componentIds,
    }).toEqual({ canFulfill: false, available: 1, componentIds: ['1'] });
  });
  it('blocks incomplete component data as well as quarantine and expiry', () => {
    const base = {
      productType: 'PRBC',
      bloodType: 'A+',
      status: 'AVAILABLE',
      labStatus: 'RELEASED',
      expiresAt: '2026-11-01T00:00:00Z',
      collectedAt: '2026-10-01T00:00:00Z',
    };
    const stock = [
      { ...base, componentId: 'valid' },
      { ...base, componentId: 'missing', collectedAt: null },
      { ...base, componentId: 'quarantine', labStatus: 'QUARANTINED' },
      { ...base, componentId: 'expired', expiresAt: '2026-10-12T00:00:00Z' },
    ];
    expect(
      planComponentAllocation('PRBC', 'A+', 2, stock, new Date('2026-10-12T00:00:00Z')).available,
    ).toBe(1);
  });
  it('requires a known plasma expiry before calculating cryoprecipitate expiry', () => {
    expect(() => calculateExpiry('Cryoprecipitate', '2026-10-01T00:00:00Z')).toThrow(
      'source expiry',
    );
  });
  it('uses nearest expiry within one blood type before the older collection', () => {
    const common = {
      productType: 'PRBC',
      bloodType: 'A+',
      status: 'AVAILABLE',
      labStatus: 'RELEASED',
    };
    const stock = [
      {
        ...common,
        componentId: 'older-collection',
        collectedAt: '2026-10-01T00:00:00Z',
        expiresAt: '2026-11-01T00:00:00Z',
      },
      {
        ...common,
        componentId: 'nearest-expiry',
        collectedAt: '2026-10-02T00:00:00Z',
        expiresAt: '2026-10-20T00:00:00Z',
      },
    ];
    expect(
      planComponentAllocation('PRBC', 'A+', 1, stock, new Date('2026-10-12T00:00:00Z'))
        .componentIds,
    ).toEqual(['nearest-expiry']);
  });
  it('preserves exact type priority and leaves O-negative last among red-cell alternatives', () => {
    const stock = ['O-', 'A-', 'O+', 'A+'].map((bloodType, i) => ({
      componentId: String(i),
      productType: 'PRBC',
      bloodType,
      status: 'AVAILABLE',
      labStatus: 'RELEASED',
      collectedAt: '2026-10-01T00:00:00Z',
      expiresAt: '2026-11-01T00:00:00Z',
    }));
    expect(
      planComponentAllocation('PRBC', 'A+', 3, stock, new Date('2026-10-12T00:00:00Z'))
        .componentIds,
    ).toEqual(['3', '2', '1']);
  });
  it('enforces the limited platelet and cryo policies in the approved simulation', () => {
    const common = {
      status: 'AVAILABLE',
      labStatus: 'RELEASED',
      collectedAt: '2026-10-01T00:00:00Z',
      expiresAt: '2026-11-01T00:00:00Z',
    };
    const stock = [
      { ...common, componentId: 'platelets', productType: 'Platelets', bloodType: 'A-' },
      { ...common, componentId: 'cryo', productType: 'Cryoprecipitate', bloodType: 'A-' },
    ];
    expect(
      planComponentAllocation('Platelets', 'A+', 1, stock, new Date('2026-10-12T00:00:00Z'))
        .available,
    ).toBe(0);
    expect(
      planComponentAllocation('Cryoprecipitate', 'A+', 1, stock, new Date('2026-10-12T00:00:00Z'))
        .componentIds,
    ).toEqual(['cryo']);
  });
});
