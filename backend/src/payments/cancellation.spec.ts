import {
  CANCELLATION_HANDLING_RATE,
  cancellationRefundableCents,
  isShipmentCommitted,
} from './cancellation';

describe('cancellationRefundableCents', () => {
  const base = {
    buyerTotal: 100_000,
    processingFee: 3_395,
    shippingCost: 12_000,
    shippingHandlingCents: 1_200,
    shipmentCommitted: false,
  };

  it('retains a flat 4% handling fee and refunds the Platform Fee + delivery', () => {
    const r = cancellationRefundableCents(base);
    // 4% of (R1,000 − R33.95 platform fee) = R38.64
    expect(CANCELLATION_HANDLING_RATE).toBe(0.04);
    expect(r.retainedCents).toBe(3_864);
    expect(r.refundableCents).toBe(96_136);
    expect(r.retained.handlingFeeCents).toBe(3_864);
    expect(r.retained.shippingCents).toBe(0);
  });

  it('retains the carrier cost AND our delivery margin once the parcel is committed', () => {
    const r = cancellationRefundableCents({ ...base, shipmentCommitted: true });
    expect(r.retainedCents).toBe(3_864 + 12_000 + 1_200);
    expect(r.refundableCents).toBe(100_000 - 17_064);
    expect(r.retained.shippingCents).toBe(13_200);
  });

  it('never charges the 4% on the Platform Fee itself', () => {
    const r = cancellationRefundableCents({
      buyerTotal: 50_000,
      processingFee: 1_690,
      shippingCost: 0,
      shipmentCommitted: true,
    });
    // 4% of (50,000 − 1,690) = 1,932.4 → 1,932
    expect(r.retainedCents).toBe(1_932);
    expect(r.refundableCents).toBe(48_068);
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
    expect(r.retained.handlingFeeCents).toBe(0);
    expect(r.retained.shippingCents).toBe(1_000);
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
