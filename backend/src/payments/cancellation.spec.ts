import {
  cancellationRefundableCents,
  isShipmentCommitted,
} from './cancellation';

describe('cancellationRefundableCents', () => {
  const base = {
    buyerTotal: 100_000,
    processingFee: 3_395,
    shippingCost: 12_000,
    shipmentCommitted: false,
  };

  it('always retains the Buyer Protection Fee, refunds the rest', () => {
    const r = cancellationRefundableCents(base);
    expect(r.refundableCents).toBe(96_605);
    expect(r.retainedCents).toBe(3_395);
    expect(r.retained.buyerProtectionFeeCents).toBe(3_395);
    expect(r.retained.shippingCents).toBe(0);
  });

  it('retains the carrier cost too once the parcel is committed', () => {
    const r = cancellationRefundableCents({ ...base, shipmentCommitted: true });
    expect(r.retainedCents).toBe(3_395 + 12_000);
    expect(r.refundableCents).toBe(100_000 - 15_395);
    expect(r.retained.shippingCents).toBe(12_000);
  });

  it('never retains the handling margin or markup (not passed in)', () => {
    // Only processingFee + committed shipping are ever subtracted.
    const r = cancellationRefundableCents({
      buyerTotal: 50_000,
      processingFee: 1_690,
      shippingCost: 0,
      shipmentCommitted: true,
    });
    expect(r.refundableCents).toBe(48_310);
  });

  it('clamps so a corrupt row can never over-retain or go negative', () => {
    const r = cancellationRefundableCents({
      buyerTotal: 1_000,
      processingFee: 5_000,
      shippingCost: 5_000,
      shipmentCommitted: true,
    });
    expect(r.refundableCents).toBe(0);
    expect(r.retainedCents).toBe(1_000);
    expect(r.retained.buyerProtectionFeeCents).toBe(1_000);
    expect(r.retained.shippingCents).toBe(0);
  });
});

describe('isShipmentCommitted', () => {
  it('is true when a waybill exists (Bob Go has no cancel API)', () => {
    expect(isShipmentCommitted({ carrierShipmentId: 'BG1' })).toBe(true);
  });
  it('is false when nothing was booked', () => {
    expect(isShipmentCommitted({ carrierShipmentId: null })).toBe(false);
    expect(isShipmentCommitted({})).toBe(false);
  });
});
