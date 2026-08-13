import {
  pickupPointOptions,
  randToCents,
  rateToQuote,
  selectRateForSlot,
  slotForRate,
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

describe('slotForRate', () => {
  it('maps door onto the TCG slot and pickup-point onto the PUDO slot', () => {
    expect(slotForRate(rate({ type: 'door' }))).toBe('TCG');
    expect(slotForRate(rate({ type: 'pickup-point' }))).toBe('PUDO');
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

  it('carries the locker id on a pickup-point rate', () => {
    const q = rateToQuote(
      rate({ type: 'pickup-point', pickupPointLocationId: 545 }),
    );
    expect(q.pickupPointLocationId).toBe(545);
  });

  it('omits the locker id entirely on a door rate', () => {
    expect('pickupPointLocationId' in rateToQuote(rate({}))).toBe(false);
  });
});

describe('selectRateForSlot', () => {
  const door1 = rate({ id: 1, type: 'door', totalPrice: 150 });
  const door2 = rate({ id: 2, type: 'door', totalPrice: 114.95 });
  const pp545 = rate({
    id: 3,
    type: 'pickup-point',
    totalPrice: 64.43,
    pickupPointLocationId: 545,
    pickupPointDistanceKm: 0.05,
  });
  const pp999 = rate({
    id: 4,
    type: 'pickup-point',
    totalPrice: 59.0,
    pickupPointLocationId: 999,
    pickupPointDistanceKm: 12,
  });
  const all = [door1, door2, pp545, pp999];

  it('picks the cheapest door rate, matching what TCG always did', () => {
    expect(selectRateForSlot(all, 'TCG')?.id).toBe(2);
  });

  it('never returns a pickup-point rate for the door slot', () => {
    expect(selectRateForSlot([pp545, pp999], 'TCG')).toBeNull();
  });

  it('honours the buyer\'s chosen locker even when another is cheaper', () => {
    // pp999 is R5 cheaper. Sending the parcel there would put it 12km from
    // where the buyer said to send it.
    expect(selectRateForSlot(all, 'PUDO', { lockerId: 545 })?.id).toBe(3);
  });

  it('returns null when the chosen locker is not served, rather than substituting', () => {
    expect(selectRateForSlot(all, 'PUDO', { lockerId: 12345 })).toBeNull();
  });

  it('falls back to cheapest-then-nearest with no locker chosen', () => {
    expect(selectRateForSlot(all, 'PUDO')?.id).toBe(4);
  });

  it('breaks a price tie on distance', () => {
    const near = rate({ id: 7, type: 'pickup-point', totalPrice: 70, pickupPointDistanceKm: 1 });
    const far = rate({ id: 8, type: 'pickup-point', totalPrice: 70, pickupPointDistanceKm: 30 });
    expect(selectRateForSlot([far, near], 'PUDO')?.id).toBe(7);
  });

  it('returns null on an empty rate list', () => {
    expect(selectRateForSlot([], 'TCG')).toBeNull();
    expect(selectRateForSlot([], 'PUDO')).toBeNull();
  });
});

describe('pickupPointOptions', () => {
  const pp = (id: number, loc: number, price: number, km: number): BobGoRate =>
    rate({
      id,
      type: 'pickup-point',
      totalPrice: price,
      pickupPointLocationId: loc,
      pickupPointDistanceKm: km,
    });

  it('shows each location once, keeping its cheapest rate', () => {
    // Bob Go returned locker #545 twice in one /locations response; rates are
    // generated per location, so the picker inherits the same duplicate.
    const out = pickupPointOptions([pp(1, 545, 80, 0.1), pp(2, 545, 64.43, 0.1)]);
    expect(out).toHaveLength(1);
    expect(out[0].totalPrice).toBe(64.43);
  });

  it('orders nearest first, which is what a picker wants', () => {
    const out = pickupPointOptions([pp(1, 10, 50, 12), pp(2, 20, 90, 0.5)]);
    expect(out.map((r) => r.pickupPointLocationId)).toEqual([20, 10]);
  });

  it('drops door rates', () => {
    expect(pickupPointOptions([rate({ type: 'door' })])).toEqual([]);
  });

  it('drops a pickup point with no location id, which could not be booked', () => {
    const orphan = rate({ type: 'pickup-point', pickupPointLocationId: undefined });
    expect(pickupPointOptions([orphan, pp(9, 77, 60, 1)])).toHaveLength(1);
  });
});
