import {
  failedShipmentChargeCents,
  isShipmentFailureReason,
  requiresRemeasure,
  sellerPaysFor,
  SHIPMENT_FAILURE_LABEL,
  SHIPMENT_FAILURE_REASONS,
} from './shipment-failure-policy';

describe('shipment failure policy', () => {
  it('labels every reason', () => {
    // A missing label renders a raw enum value to an admin.
    for (const r of SHIPMENT_FAILURE_REASONS) {
      expect(SHIPMENT_FAILURE_LABEL[r]).toBeTruthy();
    }
  });

  describe('who pays', () => {
    it('charges the seller for what the seller controls', () => {
      expect(sellerPaysFor('PARCEL_TOO_LARGE')).toBe(true);
      expect(sellerPaysFor('PARCEL_OVERWEIGHT')).toBe(true);
      expect(sellerPaysFor('SELLER_UNAVAILABLE')).toBe(true);
      expect(sellerPaysFor('COLLECTION_ADDRESS_WRONG')).toBe(true);
      expect(sellerPaysFor('PARCEL_NOT_READY')).toBe(true);
    });

    it('does NOT charge the seller for a full collection point', () => {
      // Looks like a parcel that did not fit, but a full locker is the
      // network's problem and the seller could not have prevented it.
      expect(sellerPaysFor('COLLECTION_POINT_FULL')).toBe(false);
    });

    it('does not charge for buyer-side or carrier failures', () => {
      expect(sellerPaysFor('BUYER_UNREACHABLE')).toBe(false);
      expect(sellerPaysFor('DELIVERY_ADDRESS_WRONG')).toBe(false);
      expect(sellerPaysFor('CARRIER_ERROR')).toBe(false);
      expect(sellerPaysFor('PARCEL_LOST_OR_DAMAGED')).toBe(false);
    });

    it('never charges on OTHER', () => {
      // OTHER is what gets picked when nobody is sure. Money should not move
      // on an unexplained failure.
      expect(sellerPaysFor('OTHER')).toBe(false);
    });
  });

  describe('the charge', () => {
    it('is the carrier rate the buyer was quoted', () => {
      expect(failedShipmentChargeCents({ shippingCost: 11495 })).toBe(11495);
    });

    it('is never negative, and copes with a missing cost', () => {
      expect(failedShipmentChargeCents({ shippingCost: null })).toBe(0);
      expect(failedShipmentChargeCents({ shippingCost: -100 })).toBe(0);
    });
  });

  describe('rebooking', () => {
    it('demands new measurements only where measurements were the problem', () => {
      expect(requiresRemeasure('PARCEL_TOO_LARGE')).toBe(true);
      expect(requiresRemeasure('PARCEL_OVERWEIGHT')).toBe(true);
      // Nothing to re-measure — the seller just needs to be there next time.
      expect(requiresRemeasure('SELLER_UNAVAILABLE')).toBe(false);
      expect(requiresRemeasure('CARRIER_ERROR')).toBe(false);
    });
  });

  it('rejects a reason that is not on the ticklist', () => {
    expect(isShipmentFailureReason('PARCEL_TOO_LARGE')).toBe(true);
    expect(isShipmentFailureReason('MADE_UP')).toBe(false);
    expect(isShipmentFailureReason(null)).toBe(false);
  });
});
