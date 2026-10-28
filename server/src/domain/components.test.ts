import { describe, expect, it } from 'vitest';
import { calculateExpiry, calculateProfileExpiry, planComponentAllocation } from './components.js';
import { BLOOD_TYPES } from '../../../shared/apiTypes.js';

describe('Component product policies', () => {
  it('calculates expiry from the retained profile basis and never extends a source expiry', () => {
    expect(
      calculateProfileExpiry(
        { expiry_days: 5, expiry_basis: 'COLLECTION' },
        '2026-10-01T09:00:00Z',
      ),
    ).toBe('2026-10-06T09:00:00.000Z');
    expect(
      calculateProfileExpiry(
        { expiry_days: 365, expiry_basis: 'SOURCE_EXPIRY' },
        '2026-10-01T09:00:00Z',
        '2026-12-01T09:00:00Z',
      ),
    ).toBe('2026-12-01T09:00:00.000Z');
    expect(() =>
      calculateProfileExpiry(
        { expiry_days: 365, expiry_basis: 'SOURCE_EXPIRY' },
        '2026-10-01T09:00:00Z',
      ),
    ).toThrow('source expiry');
  });
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

describe('Approved allocation boundary cases U03 U04 U10 U11 U12 U14 U15 U17', () => {
  const now = new Date('2026-10-12T00:00:00.000Z');
  const component = {
    componentId: 'a',
    productType: 'PRBC',
    bloodType: 'A+',
    status: 'AVAILABLE',
    labStatus: 'RELEASED',
    collectedAt: '2026-10-01T00:00:00Z',
    expiresAt: '2026-10-13T00:00:00Z',
  };
  it('permits the instant before expiry and blocks the exact expiry boundary', () => {
    const stock = [{ ...component, expiresAt: now.toISOString() }];
    expect(
      planComponentAllocation('PRBC', 'A+', 1, stock, new Date('2026-10-11T23:59:59.999Z'))
        .canFulfill,
    ).toBe(true);
    expect(planComponentAllocation('PRBC', 'A+', 1, stock, now).canFulfill).toBe(false);
  });
  it.each([
    { expiresAt: null },
    { expiresAt: 'invalid' },
    { collectedAt: null },
    { productType: 'LEGACY' },
    { status: 'PROCESSED' },
    { status: 'DISCARDED' },
  ])('blocks incomplete or terminal stock %j while retaining a valid neighbor', (change) => {
    const stock = [
      { ...component, ...change, componentId: 'blocked' },
      { ...component, componentId: 'valid' },
    ];
    expect(planComponentAllocation('PRBC', 'A+', 2, stock, now).componentIds).toEqual(['valid']);
  });
  it('uses collection time and then component ID to break equal expiry ties', () => {
    const stock = [
      { ...component, componentId: 'z', collectedAt: '2026-10-02T00:00:00Z' },
      { ...component, componentId: 'b' },
      { ...component, componentId: 'a' },
    ];
    expect(planComponentAllocation('PRBC', 'A+', 3, stock, now).componentIds).toEqual([
      'a',
      'b',
      'z',
    ]);
  });
  it('applies every approved PRBC donor-recipient combination in the component engine', () => {
    const donors = {
      'A+': ['A+', 'A-', 'O+', 'O-'],
      'O+': ['O+', 'O-'],
      'B+': ['B+', 'B-', 'O+', 'O-'],
      'AB+': [...BLOOD_TYPES],
      'A-': ['A-', 'O-'],
      'O-': ['O-'],
      'B-': ['B-', 'O-'],
      'AB-': ['AB-', 'A-', 'B-', 'O-'],
    };
    for (const recipient of BLOOD_TYPES)
      for (const bloodType of BLOOD_TYPES)
        expect(
          planComponentAllocation('PRBC', recipient, 1, [{ ...component, bloodType }], now)
            .canFulfill,
          `${bloodType} to ${recipient}`,
        ).toBe(donors[recipient].includes(bloodType));
  });
  it('applies every plasma ABO combination independently of Rh and prioritizes identical ABO', () => {
    const donors: Record<string, string[]> = {
      A: ['A', 'AB'],
      B: ['B', 'AB'],
      AB: ['AB'],
      O: ['O', 'A', 'B', 'AB'],
    };
    for (const recipient of BLOOD_TYPES)
      for (const bloodType of BLOOD_TYPES)
        expect(
          planComponentAllocation(
            'FFP',
            recipient,
            1,
            [{ ...component, productType: 'FFP', bloodType }],
            now,
          ).canFulfill,
          `${bloodType} plasma to ${recipient}`,
        ).toBe(donors[recipient.slice(0, -1)]!.includes(bloodType.slice(0, -1)));
    expect(
      planComponentAllocation(
        'FFP',
        'A+',
        1,
        [
          { ...component, productType: 'FFP', bloodType: 'AB+', componentId: 'alternative' },
          { ...component, productType: 'FFP', bloodType: 'A-', componentId: 'exact' },
        ],
        now,
      ).componentIds,
    ).toEqual(['exact']);
  });
  it('permits exact platelets and rejects a different cryoprecipitate ABO group', () => {
    expect(
      planComponentAllocation(
        'Platelets',
        'A+',
        1,
        [{ ...component, productType: 'Platelets' }],
        now,
      ).canFulfill,
    ).toBe(true);
    expect(
      planComponentAllocation(
        'Cryoprecipitate',
        'B+',
        1,
        [{ ...component, productType: 'Cryoprecipitate' }],
        now,
      ).canFulfill,
    ).toBe(false);
  });
  it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid component quantity %s', (quantity) => {
    expect(() => planComponentAllocation('PRBC', 'A+', quantity, [component], now)).toThrow();
  });
});
