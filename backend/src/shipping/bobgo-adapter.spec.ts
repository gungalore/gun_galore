import {
  cheapestDoorRate,
  cheapestPickupPointRate,
  doorRates,
  fastestDoorRate,
  isDoorRate,
  pickupPointRates,
  randToCents,
  rateToQuote,
} from './bobgo-adapter';
import type { BobGoRate } from './bobgo.types';

const rate = (over: Partial<BobGoRate>): BobGoRate => ({
  id: 1,
  serviceName: 'Standard shipping',
  serviceCode: 'bobgo_1_1_0',
  totalPrice: 100,
  baseRate: 100,
  currency: 'ZAR',
  type: 'door',
  serviceLevelCode: 'ECO',
  providerSlug: 'demo',
  liabilityCoverPrice: 0,
  surchargeTotal: 0,
  ...over,
});

describe('isDoorRate', () => {
  it('is true for door rates and false for pickup-point rates', () => {
    expect(isDoorRate(rate({ type: 'door' }))).toBe(true);
    expect(isDoorRate(rate({ type: 'pickup-point' }))).toBe(false);
  });
});

describe('randToCents', () => {
  it('converts the real sandbox prices exactly', () => {
    expect(randToCents(114.95)).toBe(11495);
    expect(randToCents(64.43)).toBe(6443);
  });

  it('rounds rather than truncating, so we never under-collect', () => {
    // 0.1 + 0.2 style float error must not cost a cent on every order.
    expect(randToCents(10.005)).toBe(1001);
    expect(randToCents(19.999)).toBe(2000);
  });
});

describe('rateToQuote', () => {
  it('carries provider and service level through for the booking replay', () => {
    // Without these two the booking days later cannot reconstruct the rate.
    const q = rateToQuote(
      rate({
        serviceCode: 'bobgo_3082_34_0',
        providerSlug: 'sandbox',
        serviceLevelCode: 'ECO',
        totalPrice: 114.95,
      }),
    );
    expect(q).toEqual({
      serviceCode: 'bobgo_3082_34_0',
      serviceName: 'Standard shipping',
      priceCents: 11495,
      providerSlug: 'sandbox',
      serviceLevelCode: 'ECO',
    });
  });
});

describe('cheapestDoorRate', () => {
  const door1 = rate({ id: 1, type: 'door', totalPrice: 150 });
  const door2 = rate({ id: 2, type: 'door', totalPrice: 114.95 });
  const pp = rate({
    id: 3,
    type: 'pickup-point',
    totalPrice: 64.43,
    pickupPointLocationId: 545,
    pickupPointDistanceKm: 0.05,
  });

  it('picks the cheapest door rate and ignores cheaper pickup points', () => {
    // The pickup point is R50 cheaper but delivery is door-only.
    expect(cheapestDoorRate([door1, pp, door2])?.id).toBe(2);
  });

  it('returns null when there is no door rate at all', () => {
    expect(cheapestDoorRate([pp])).toBeNull();
  });

  it('returns null on an empty rate list', () => {
    expect(cheapestDoorRate([])).toBeNull();
  });
});

describe('fastestDoorRate', () => {
  it('prefers the fewest business days, then the cheapest', () => {
    // tcg/LSP is same-day (0d), ie is 1d, citylogistics is 3d.
    const sameDay = rate({ id: 1, providerSlug: 'tcg', serviceLevelCode: 'LSP', totalPrice: 500 });
    const express = rate({ id: 2, providerSlug: 'ie', serviceLevelCode: 'LX', totalPrice: 120 });
    const slow = rate({ id: 3, providerSlug: 'citylogistics', totalPrice: 90 });
    expect(fastestDoorRate([slow, express, sameDay])?.id).toBe(1);
  });

  it('breaks a speed tie on price', () => {
    const a = rate({ id: 1, providerSlug: 'ie', serviceLevelCode: 'LX', totalPrice: 200 });
    const b = rate({ id: 2, providerSlug: 'ie', serviceLevelCode: 'LECO', totalPrice: 120 });
    expect(fastestDoorRate([a, b])?.id).toBe(2);
  });

  it('prefers Bob Go route-specific delivery dates over the fallback table', () => {
    const later = rate({
      id: 1,
      providerSlug: 'ie',
      serviceLevelCode: 'LECO',
      minDeliveryDate: '2026-09-29',
      totalPrice: 90,
    });
    const earlier = rate({
      id: 2,
      providerSlug: 'citylogistics',
      serviceLevelCode: 'ECOR',
      minDeliveryDate: '2026-09-26',
      totalPrice: 200,
    });
    expect(fastestDoorRate([later, earlier])?.id).toBe(2);
  });

  it('ignores pickup points and returns null with no door rate', () => {
    const pp = rate({ id: 9, type: 'pickup-point', totalPrice: 50 });
    expect(fastestDoorRate([pp])).toBeNull();
  });
});

describe('cheapestPickupPointRate', () => {
  it('picks the cheapest pickup point, ignoring door rates', () => {
    const door = rate({ id: 1, type: 'door', totalPrice: 60 });
    const pp1 = rate({ id: 2, type: 'pickup-point', totalPrice: 98.39, pickupPointLocationId: 107 });
    const pp2 = rate({ id: 3, type: 'pickup-point', totalPrice: 80, pickupPointLocationId: 108 });
    expect(cheapestPickupPointRate([door, pp1, pp2])?.id).toBe(3);
  });

  it('returns null when there is no pickup point', () => {
    expect(cheapestPickupPointRate([rate({ type: 'door' })])).toBeNull();
    expect(cheapestPickupPointRate([])).toBeNull();
  });
});

describe('doorRates / pickupPointRates', () => {
  it('partitions the quote', () => {
    const door = rate({ id: 1, type: 'door' });
    const pp = rate({ id: 2, type: 'pickup-point' });
    expect(doorRates([door, pp]).map((r) => r.id)).toEqual([1]);
    expect(pickupPointRates([door, pp]).map((r) => r.id)).toEqual([2]);
  });
});
