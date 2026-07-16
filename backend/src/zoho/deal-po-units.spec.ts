// DD-F5 (L3) — deterministic coverage for createDealPurchaseOrder's unit
// counting + idempotency, the two properties the dummy-run only exercises
// non-deterministically:
//
//   1. unitsOrdered = units actually SOLD (paid, not refunded / rejected /
//      buyer-cancelled / manually-cancelled) — the P&L counting filter. A PO
//      that over-counts orders (and pays for) stock GG can't sell on; one that
//      under-counts strands paid buyers with no stock.
//   2. Zero-sale deals get the TERMINAL CANCELLED/OK row (no supplier order,
//      nothing for the retry sweep to churn on).
//   3. Placement-keyed idempotency: once zohoPurchaseOrderId is stamped the
//      method must NOT touch the row again (no second order, ever).
//
// ZOHO_BOOKS_ENABLED is unset under jest → isEnabled() is false → the method
// stops right after writing the local row, so every assertion here is about
// LOCAL writes only; no HTTP surface is reachable. That mirrors the offline
// dummy-run environment exactly.

import { ZohoBooksService } from './zoho-books.service';

type Mocks = {
  prisma: {
    deal: { findUnique: jest.Mock };
    transaction: { aggregate: jest.Mock };
    dealPurchaseOrder: { upsert: jest.Mock; updateMany: jest.Mock; update: jest.Mock };
  };
  settings: { get: jest.Mock };
};

function makeService(over: {
  quantity?: number | null;
  existingPo?: { zohoPurchaseOrderId: string | null } | null;
}): { svc: ZohoBooksService; m: Mocks } {
  const m: Mocks = {
    prisma: {
      deal: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'D1',
          listingId: 'L1',
          costPriceCents: 5000,
          supplierRef: null,
          listing: { title: 'Deal item', referenceNumber: 'GG-REF-1' },
          supplier: { id: 'S1', email: 's@x.co' },
          purchaseOrder: over.existingPo ?? null,
        }),
      },
      transaction: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { quantity: over.quantity ?? null } }),
      },
      dealPurchaseOrder: {
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
    },
    settings: { get: jest.fn().mockResolvedValue(false) },
  };
  const svc = new ZohoBooksService(m.prisma as never, m.settings as never);
  return { svc, m };
}

describe('DD-F createDealPurchaseOrder — units + idempotency (Books off)', () => {
  it('orders EXACTLY the paid-non-refunded unit count (Σ quantity), priced at cost', async () => {
    const { svc, m } = makeService({ quantity: 7 });
    await svc.createDealPurchaseOrder('D1');

    // The counting filter is the P&L one: paid, not a refund row, not
    // REFUNDED, not rejected, not buyer/manually cancelled.
    const aggWhere = m.prisma.transaction.aggregate.mock.calls[0][0].where;
    expect(aggWhere).toMatchObject({
      listingId: 'L1',
      paidAt: { not: null },
      refundOfId: null,
      rejectedAt: null,
      cancelledByBuyerAt: null,
      manualCancelledAt: null,
    });

    // Local PO row: 7 units × R50.00 cost.
    expect(m.prisma.dealPurchaseOrder.upsert).toHaveBeenCalledTimes(1);
    const upsert = m.prisma.dealPurchaseOrder.upsert.mock.calls[0][0];
    expect(upsert.create).toMatchObject({
      dealId: 'D1',
      unitsOrdered: 7,
      unitCostCents: 5000,
      totalCents: 35000,
      status: 'DRAFT',
    });
    // Books is OFF → stop after the local row; the placement claim (the only
    // gate to a real POST /purchaseorders) must never fire.
    expect(m.prisma.dealPurchaseOrder.updateMany).not.toHaveBeenCalled();
  });

  it('zero units sold → TERMINAL CANCELLED/OK row, no claim, no order', async () => {
    const { svc, m } = makeService({ quantity: null });
    await svc.createDealPurchaseOrder('D1');

    const upsert = m.prisma.dealPurchaseOrder.upsert.mock.calls[0][0];
    expect(upsert.create).toMatchObject({
      dealId: 'D1',
      unitsOrdered: 0,
      totalCents: 0,
      status: 'CANCELLED',
      zohoSyncStatus: 'OK',
    });
    expect(m.prisma.dealPurchaseOrder.updateMany).not.toHaveBeenCalled();
  });

  it('placement-keyed idempotency: an existing Zoho PO id short-circuits BEFORE any write', async () => {
    const { svc, m } = makeService({
      quantity: 7,
      existingPo: { zohoPurchaseOrderId: 'ZPO-123' },
    });
    await svc.createDealPurchaseOrder('D1');

    // Neither the DRAFT upsert nor the claim may run — the order is placed;
    // a second call must be a pure no-op (never a second supplier order).
    expect(m.prisma.dealPurchaseOrder.upsert).not.toHaveBeenCalled();
    expect(m.prisma.dealPurchaseOrder.updateMany).not.toHaveBeenCalled();
  });
});
