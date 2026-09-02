import { planShippingGroups, type ShippingLineMeta } from './consolidation';

/**
 * Grouping is shared by the delivery MENU and the checkout RE-QUOTE, so these
 * assertions are really about one property: the buyer is quoted for exactly
 * the parcels they will be charged for.
 */

const ADDR = {
  streetAddress: '44 Stanley Ave',
  suburb: 'Milpark',
  city: 'Johannesburg',
  postalCode: '2092',
};

function meta(entries: Array<[string, Partial<ShippingLineMeta>]>) {
  return new Map<string, ShippingLineMeta>(
    entries.map(([id, m]) => [
      id,
      { sellerId: m.sellerId ?? 'S1', isFirearm: m.isFirearm ?? false },
    ]),
  );
}

describe('planShippingGroups', () => {
  it('puts two same-seller courier lines to one address in ONE parcel', () => {
    const groups = planShippingGroups(
      [
        { listingId: 'L1', shippingMethod: 'TCG', deliveryAddress: ADDR },
        { listingId: 'L2', shippingMethod: 'TCG', deliveryAddress: ADDR },
      ],
      meta([['L1', {}], ['L2', {}]]),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].listingIds.sort()).toEqual(['L1', 'L2']);
    expect(groups[0].consolidated).toBe(true);
  });

  it('splits different sellers — they ship from different places', () => {
    const groups = planShippingGroups(
      [
        { listingId: 'L1', shippingMethod: 'TCG', deliveryAddress: ADDR },
        { listingId: 'L2', shippingMethod: 'TCG', deliveryAddress: ADDR },
      ],
      meta([['L1', { sellerId: 'S1' }], ['L2', { sellerId: 'S2' }]]),
    );
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.consolidated === false)).toBe(true);
  });

  it('never pulls a firearm into a parcel, even carrying a courier method', () => {
    // A firearm moves via a licensed dealer. A tampered payload that puts a
    // courier method on one must still not consolidate it.
    const groups = planShippingGroups(
      [
        { listingId: 'F1', shippingMethod: 'TCG', deliveryAddress: ADDR },
        { listingId: 'L1', shippingMethod: 'TCG', deliveryAddress: ADDR },
      ],
      meta([['F1', { isFirearm: true }], ['L1', {}]]),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].listingIds).toEqual(['L1']);
  });

  it('excludes non-courier methods entirely', () => {
    const groups = planShippingGroups(
      [
        { listingId: 'C1', shippingMethod: 'COLLECTION' },
        { listingId: 'E1', shippingMethod: 'ON_SITE_SERVICE' },
        { listingId: 'D1', shippingMethod: 'DEALER_TRANSFER' },
        { listingId: 'P1', shippingMethod: 'PRIVATE_ARRANGE' },
      ],
      meta([['C1', {}], ['E1', {}], ['D1', {}], ['P1', {}]]),
    );
    expect(groups).toEqual([]);
  });

  it('separates collection-point groups by the chosen point', () => {
    // Two different points are two different destinations, so two waybills.
    const groups = planShippingGroups(
      [
        { listingId: 'L1', shippingMethod: 'PUDO', pickupPointId: 545 },
        { listingId: 'L2', shippingMethod: 'PUDO', pickupPointId: 900 },
      ],
      meta([['L1', {}], ['L2', {}]]),
    );
    expect(groups).toHaveLength(2);
  });

  it('ignores a line whose listing metadata is missing', () => {
    const groups = planShippingGroups(
      [{ listingId: 'GHOST', shippingMethod: 'TCG', deliveryAddress: ADDR }],
      meta([]),
    );
    expect(groups).toEqual([]);
  });
});
