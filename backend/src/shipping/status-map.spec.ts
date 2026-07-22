import {
  mapPudoStatus,
  mapTcgStatus,
  toShippingStatus,
  shiplogicToShippingStatus,
  STATUS_LABEL,
} from './status-map';

describe('status-map (Shiplogic — shared by webhook + Pudo poll)', () => {
  describe('shiplogicToShippingStatus — raw slug → Prisma ShippingStatus', () => {
    it.each([
      ['collected', 'COLLECTED'],
      ['dropped-off', 'COLLECTED'],
      ['in-transit', 'IN_TRANSIT'],
      ['at-hub', 'IN_TRANSIT'],
      ['at-destination-hub', 'IN_TRANSIT'],
      ['manifested', 'IN_TRANSIT'],
      ['delivery-exception', 'IN_TRANSIT'],
      ['out-for-delivery', 'OUT_FOR_DELIVERY'],
      ['ready-for-collection', 'OUT_FOR_DELIVERY'],
      ['arrived-at-locker', 'OUT_FOR_DELIVERY'],
      ['delivered', 'DELIVERED'],
      ['collected-by-recipient', 'DELIVERED'],
      ['delivery-failed-attempt', 'DELIVERY_FAILED'],
      ['undeliverable', 'DELIVERY_FAILED'],
      ['expired', 'DELIVERY_FAILED'],
      ['returned-to-sender', 'RETURNED'],
    ])('%s → %s', (raw, expected) => {
      expect(shiplogicToShippingStatus(raw)).toBe(expected);
    });

    it.each([
      'collection-assigned',
      'collection-unassigned',
      'awaiting-dropoff',
      'submitted',
      'created',
      'on-hold',
      'floor-check',
      'cancelled',
      'deposit-pending',
      'unknown-future-status',
      '',
    ])('ignores non-actionable / unknown status: %s', (raw) => {
      expect(shiplogicToShippingStatus(raw)).toBeNull();
    });

    // ── the fixes: these previously fell through to null (poll) ──
    it('delivery-failed-attempt now rolls to DELIVERY_FAILED (was missed)', () => {
      expect(shiplogicToShippingStatus('delivery-failed-attempt')).toBe(
        'DELIVERY_FAILED',
      );
    });
    it('returned-to-sender now rolls to RETURNED (was missed)', () => {
      expect(shiplogicToShippingStatus('returned-to-sender')).toBe('RETURNED');
    });

    // ── SAFETY: nothing in-transit or failed may reach DELIVERED ──
    it('out-for-delivery is NEVER DELIVERED', () => {
      expect(shiplogicToShippingStatus('out-for-delivery')).not.toBe('DELIVERED');
    });
    it('delivery-failed-attempt is NEVER DELIVERED', () => {
      expect(shiplogicToShippingStatus('delivery-failed-attempt')).not.toBe(
        'DELIVERED',
      );
    });

    it('is formatting-robust (case / separators)', () => {
      expect(shiplogicToShippingStatus('IN_TRANSIT')).toBe('IN_TRANSIT');
      expect(shiplogicToShippingStatus('In Transit')).toBe('IN_TRANSIT');
      expect(shiplogicToShippingStatus('Delivered')).toBe('DELIVERED');
    });
  });

  describe('collapsed layer (timeline) — mapPudoStatus / mapTcgStatus', () => {
    it('both carriers share ONE Shiplogic map', () => {
      expect(mapPudoStatus).toBe(mapTcgStatus);
    });
    it.each([
      ['collected', 'PARCEL_COLLECTED'],
      ['in-transit', 'PARCEL_IN_TRANSIT'],
      ['at-hub', 'AT_HUB'],
      ['ready-for-collection', 'AT_LOCKER'],
      ['collected-by-recipient', 'COLLECTED_BY_BUYER'],
      ['delivery-failed-attempt', 'DELIVERY_FAILED'],
      ['returned-to-sender', 'RETURN_INITIATED'],
    ])('%s → collapsed %s', (raw, collapsed) => {
      expect(mapPudoStatus(raw)).toBe(collapsed);
      // every collapsed status the poll can produce must have a timeline label
      expect(STATUS_LABEL[mapPudoStatus(raw)]).toBeDefined();
    });
    it('collapsed → prisma stays consistent with the one-hop helper', () => {
      for (const raw of [
        'collected',
        'in-transit',
        'out-for-delivery',
        'delivered',
        'delivery-failed-attempt',
        'returned-to-sender',
      ]) {
        expect(toShippingStatus(mapPudoStatus(raw))).toBe(
          shiplogicToShippingStatus(raw),
        );
      }
    });
  });
});
