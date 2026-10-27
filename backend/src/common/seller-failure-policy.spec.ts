import {
  SELLER_FAILURE_HANDLING_RATE,
  sellerFailureChargeCents,
  sellerFailureHandlingCents,
  sellerFailureShippingCents,
  sellerPaysForSaleReject,
} from './seller-failure-policy';

describe('seller failure policy', () => {
  it('keeps the 4% gateway slice', () => {
    expect(SELLER_FAILURE_HANDLING_RATE).toBe(0.04);
  });

  it('rounds the 4% of the cumulative refund', () => {
    expect(sellerFailureHandlingCents(100_000)).toBe(4_000);
    expect(sellerFailureHandlingCents(1_250)).toBe(50);
    // 4% of 1 237 = 49.48 → 49
    expect(sellerFailureHandlingCents(1_237)).toBe(49);
  });

  it('is idempotent: the same refunded total gives the same slice', () => {
    expect(sellerFailureHandlingCents(87_654)).toBe(
      sellerFailureHandlingCents(87_654),
    );
  });

  it('never charges shipping when no waybill was booked', () => {
    expect(
      sellerFailureShippingCents({
        kind: 'NO_DISPATCH',
        shipmentCommitted: false,
        shippingCost: 14_500,
      }),
    ).toBe(0);
  });

  it('charges the carrier rate when a waybill is committed', () => {
    expect(
      sellerFailureShippingCents({
        kind: 'NOT_DELIVERED',
        shipmentCommitted: true,
        shippingCost: 14_500,
      }),
    ).toBe(14_500);
  });

  it('treats a missing/negative cost as zero, never NaN', () => {
    expect(
      sellerFailureShippingCents({
        kind: 'SELLER_CANCELLED',
        shipmentCommitted: true,
        shippingCost: null,
      }),
    ).toBe(0);
    expect(
      sellerFailureShippingCents({
        kind: 'SELLER_CANCELLED',
        shipmentCommitted: true,
        shippingCost: -100,
      }),
    ).toBe(0);
  });

  it('adds the two recoveries', () => {
    expect(
      sellerFailureChargeCents({
        kind: 'NO_DISPATCH',
        refundedTotalCents: 118_690,
        shipmentCommitted: true,
        shippingCost: 7_900,
      }),
    ).toEqual({
      handlingCents: 4_748,
      shippingCents: 7_900,
      amountCents: 12_648,
    });
  });

  it('charges only reasons that also earn a strike', () => {
    expect(sellerPaysForSaleReject('STOCK_ISSUE')).toBe(true);
    expect(sellerPaysForSaleReject('SOLD_ELSEWHERE')).toBe(true);
    expect(sellerPaysForSaleReject('OTHER')).toBe(true);
    // Trust review, not the seller's fault — no bill.
    expect(sellerPaysForSaleReject('BUYER_SUSPICIOUS')).toBe(false);
  });
});
