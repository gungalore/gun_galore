import {
  bobgoToShippingStatus,
  isKnownBobGoStatus,
  toShippingStatus,
  STATUS_LABEL,
} from './status-map';

describe('bobgoToShippingStatus', () => {
  it('maps the lifecycle Bob Go documents in tracking_steps', () => {
    expect(bobgoToShippingStatus('created')).toBe('PENDING');
    expect(bobgoToShippingStatus('pending-collection')).toBe('PENDING');
    expect(bobgoToShippingStatus('collected')).toBe('COLLECTED');
    expect(bobgoToShippingStatus('in-transit')).toBe('IN_TRANSIT');
    expect(bobgoToShippingStatus('out-for-delivery')).toBe('OUT_FOR_DELIVERY');
    expect(bobgoToShippingStatus('delivered')).toBe('DELIVERED');
  });

  it('normalises case and separators', () => {
    expect(bobgoToShippingStatus('In Transit')).toBe('IN_TRANSIT');
    expect(bobgoToShippingStatus('OUT_FOR_DELIVERY')).toBe('OUT_FOR_DELIVERY');
  });

  it('maps ready-for-pickup (STORE_PICKUP) to a distinct status', () => {
    // With a Pargo counter as a delivery option, "ready for pickup" is a real
    // state — deliberately NOT out-for-delivery. Vocabulary still unverified.
    expect(bobgoToShippingStatus('ready-for-pickup')).toBe('READY_FOR_PICKUP');
    expect(bobgoToShippingStatus('ready-for-collection')).toBe('READY_FOR_PICKUP');
    expect(isKnownBobGoStatus('ready-for-pickup')).toBe(true);
  });

  it('maps a receiver collection to DELIVERED', () => {
    expect(bobgoToShippingStatus('collected-by-customer')).toBe('DELIVERED');
    expect(bobgoToShippingStatus('picked_up')).toBe('DELIVERED');
  });

  it('does NOT map expired — far too destructive to guess', () => {
    expect(bobgoToShippingStatus('expired')).toBeNull();
  });

  it('returns null for anything unobserved so the caller leaves the order alone', () => {
    for (const s of ['', 'at-locker', 'on-hold', 'floor-check', 'whatever-next']) {
      expect(bobgoToShippingStatus(s)).toBeNull();
      expect(isKnownBobGoStatus(s)).toBe(false);
    }
  });

  it('reports known statuses positively', () => {
    expect(isKnownBobGoStatus('in-transit')).toBe(true);
    expect(isKnownBobGoStatus('Delivered')).toBe(true);
  });
});

describe('toShippingStatus (collapsed internal → Prisma)', () => {
  it.each([
    ['COLLECTED', 'COLLECTED'],
    ['IN_TRANSIT', 'IN_TRANSIT'],
    ['OUT_FOR_DELIVERY', 'OUT_FOR_DELIVERY'],
    ['READY_FOR_PICKUP', 'READY_FOR_PICKUP'],
    ['DELIVERED', 'DELIVERED'],
    ['DELIVERY_FAILED', 'DELIVERY_FAILED'],
    ['RETURNED', 'RETURNED'],
  ])('%s → %s', (collapsed, expected) => {
    expect(toShippingStatus(collapsed)).toBe(expected);
  });

  it('returns null for internal milestones so shippingStatus is untouched', () => {
    for (const s of [
      'PAYMENT_RECEIVED',
      'SELLER_DISPATCHED',
      'DEALER_HANDOVER_STARTED',
      'UNKNOWN',
    ]) {
      expect(toShippingStatus(s)).toBeNull();
    }
  });
});

describe('STATUS_LABEL', () => {
  it('labels every collapsed status toShippingStatus can roll forward', () => {
    for (const s of [
      'COLLECTED',
      'IN_TRANSIT',
      'OUT_FOR_DELIVERY',
      'READY_FOR_PICKUP',
      'DELIVERED',
      'DELIVERY_FAILED',
      'RETURNED',
    ]) {
      expect(STATUS_LABEL[s]).toBeDefined();
    }
  });

  it('labels the firearm dealer hand-over without courier wording', () => {
    // The DT buyer must never be told a parcel or courier is carrying their
    // firearm — the DEALER_HANDOVER_STARTED event is the DT counterpart of
    // SELLER_DISPATCHED and says "dealer", not "parcel"/"courier".
    expect(STATUS_LABEL.DEALER_HANDOVER_STARTED).toBeDefined();
    expect(STATUS_LABEL.DEALER_HANDOVER_STARTED.toLowerCase()).toContain(
      'dealer',
    );
    expect(STATUS_LABEL.DEALER_HANDOVER_STARTED.toLowerCase()).not.toContain(
      'parcel',
    );
    expect(STATUS_LABEL.DEALER_HANDOVER_STARTED.toLowerCase()).not.toContain(
      'courier',
    );
  });
});
