jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

// The deduction that actually moves money.
//
// sellerPayout is a point-of-sale snapshot and is never mutated, so a wasted
// courier charge only ever reaches the seller here, at payout time. If this is
// wrong, either a seller is short-paid or the platform eats a cost it was
// meant to recover.

import { netPayoutCents } from './manual-payments.service';

describe('netPayoutCents', () => {
  it('pays the full amount when nothing is owed', () => {
    expect(netPayoutCents({ sellerPayout: 50000 })).toBe(50000);
  });

  it('deducts a wasted courier charge the seller caused', () => {
    expect(
      netPayoutCents({ sellerPayout: 50000, failedShipmentChargeCents: 11495 }),
    ).toBe(38505);
  });

  it('deducts refund slices and the charge together', () => {
    expect(
      netPayoutCents({
        sellerPayout: 50000,
        failedShipmentChargeCents: 11495,
        refundChildren: [{ buyerTotal: 10000 }],
      }),
    ).toBe(28505);
  });

  it('never inverts into money owed to us', () => {
    // Recovering more than the sale is worth is a decision for a human, not
    // something a payout run should do by returning a negative.
    expect(
      netPayoutCents({ sellerPayout: 5000, failedShipmentChargeCents: 11495 }),
    ).toBe(0);
  });

  it('treats a missing charge as zero, not as NaN', () => {
    // The column is nullable on rows that predate it; NaN here would poison a
    // whole payout batch.
    expect(
      netPayoutCents({ sellerPayout: 50000, failedShipmentChargeCents: null }),
    ).toBe(50000);
  });
});
