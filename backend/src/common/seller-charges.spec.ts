import type { PrismaClient } from '@prisma/client';
import {
  raiseSellerCharge,
  outstandingSellerChargeCents,
  reserveSellerChargesForPayout,
  settleSellerChargeRecoveries,
  releaseSellerChargeRecoveries,
  waiveSellerCharge,
  listSellerCharges,
} from './seller-charges';

/**
 * Minimal in-memory Prisma stand-in for the ledger. The money rules are pure
 * arithmetic over rows, so a fake is a better test than a database: it pins
 * the behaviour (idempotency, FIFO, release) without any migration risk.
 */
function fakeDb() {
  let seq = 0;
  const charges: any[] = [];
  const recoveries: any[] = [];

  const counted = (chargeId: string) =>
    recoveries.filter(
      (r) => r.chargeId === chargeId && r.status !== 'RELEASED',
    );

  const db: any = {
    charges,
    recoveries,
    sellerCharge: {
      findUnique: async ({ where }: any) => {
        const key = where.transactionId_kind;
        if (!key) {
          return charges.find((c) => c.id === where.id) ?? null;
        }
        return (
          charges.find(
            (c) =>
              c.transactionId === key.transactionId &&
              c.kind === key.kind,
          ) ?? null
        );
      },
      create: async ({ data }: any) => {
        const row = {
          id: `c${++seq}`,
          createdAt: new Date(2026, 0, seq),
          waivedAt: null,
          waivedById: null,
          waivedReason: null,
          ...data,
        };
        charges.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = charges.find((c) => c.id === where.id);
        Object.assign(row, data);
        return row;
      },
      findMany: async ({ where, orderBy }: any) => {
        let rows = charges.filter((c) => c.sellerId === where.sellerId);
        if (where.waivedAt === null) {
          rows = rows.filter((c) => c.waivedAt === null);
        }
        if (orderBy?.createdAt === 'asc') {
          rows = [...rows].sort(
            (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
          );
        }
        return rows.map((c) => ({
          ...c,
          recoveries: counted(c.id).map((r) => ({
            amountCents: r.amountCents,
            status: r.status,
          })),
        }));
      },
    },
    sellerChargeRecovery: {
      create: async ({ data }: any) => {
        const row = {
          id: `r${++seq}`,
          status: 'RESERVED',
          createdAt: new Date(),
          settledAt: null,
          releasedAt: null,
          ...data,
        };
        recoveries.push(row);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const r of recoveries) {
          if (where.chargeId && r.chargeId !== where.chargeId) continue;
          if (where.transactionId && r.transactionId !== where.transactionId) {
            continue;
          }
          if (where.status && r.status !== where.status) continue;
          Object.assign(r, data);
          count += 1;
        }
        return { count };
      },
    },
    $transaction: async (fn: any) => fn(db),
  };
  return db;
}

const prisma = (db: any) => db as PrismaClient;

const charge = (over: Record<string, unknown> = {}) => ({
  sellerId: 'seller-1',
  transactionId: 'tx-1',
  kind: 'NO_DISPATCH' as const,
  reason: 'Never dispatched',
  refundedTotalCents: 118_690,
  shipmentCommitted: true,
  shippingCost: 7_900,
  ...over,
});

describe('seller charge ledger', () => {
  it('creates the 4% + committed courier charge', async () => {
    const db = fakeDb();
    const row = await raiseSellerCharge(prisma(db), charge());
    expect(row).toMatchObject({
      handlingCents: 4_748,
      shippingCents: 7_900,
      amountCents: 12_648,
    });
  });

  it('is idempotent for the same failed sale', async () => {
    const db = fakeDb();
    await raiseSellerCharge(prisma(db), charge());
    await raiseSellerCharge(prisma(db), charge());
    expect(db.charges).toHaveLength(1);
    expect(db.charges[0].amountCents).toBe(12_648);
  });

  it('follows the cumulative refund, but charges shipping only once', async () => {
    const db = fakeDb();
    await raiseSellerCharge(prisma(db), charge({ refundedTotalCents: 50_000 }));
    await raiseSellerCharge(prisma(db), charge({ refundedTotalCents: 100_000 }));
    expect(db.charges).toHaveLength(1);
    // 4% of 100 000 = 4 000, shipping still 7 900 once.
    expect(db.charges[0]).toMatchObject({
      handlingCents: 4_000,
      shippingCents: 7_900,
      amountCents: 11_900,
    });
  });

  it('never creates a zero charge', async () => {
    const db = fakeDb();
    const row = await raiseSellerCharge(
      prisma(db),
      charge({
        refundedTotalCents: 0,
        shipmentCommitted: false,
        shippingCost: 0,
      }),
    );
    expect(row).toBeNull();
    expect(db.charges).toHaveLength(0);
  });

  it('reports the outstanding balance net of reserved and settled slices', async () => {
    const db = fakeDb();
    await raiseSellerCharge(prisma(db), charge());
    expect(await outstandingSellerChargeCents(prisma(db), 'seller-1')).toBe(
      12_648,
    );
    await reserveSellerChargesForPayout(prisma(db), {
      sellerId: 'seller-1',
      transactionId: 'later-sale',
      availableCents: 5_000,
    });
    expect(await outstandingSellerChargeCents(prisma(db), 'seller-1')).toBe(
      7_648,
    );
  });

  it('reserves oldest charge first and carries the rest', async () => {
    const db = fakeDb();
    await raiseSellerCharge(prisma(db), charge({ transactionId: 'tx-old' }));
    await raiseSellerCharge(
      prisma(db),
      charge({
        transactionId: 'tx-new',
        refundedTotalCents: 50_000,
        shipmentCommitted: false,
        shippingCost: 0,
      }),
    );

    const applied = await reserveSellerChargesForPayout(prisma(db), {
      sellerId: 'seller-1',
      transactionId: 'payout-1',
      availableCents: 13_000,
    });
    // 12 648 on the old charge, 352 on the new one.
    expect(applied).toBe(13_000);
    expect(db.recoveries.map((r: any) => [r.chargeId, r.amountCents])).toEqual([
      ['c1', 12_648],
      ['c2', 352],
    ]);
  });

  it('releases a failed payout so the next one can recover it', async () => {
    const db = fakeDb();
    await raiseSellerCharge(prisma(db), charge());
    await reserveSellerChargesForPayout(prisma(db), {
      sellerId: 'seller-1',
      transactionId: 'payout-failed',
      availableCents: 12_648,
    });
    expect(await outstandingSellerChargeCents(prisma(db), 'seller-1')).toBe(0);

    await releaseSellerChargeRecoveries(prisma(db), 'payout-failed');
    expect(await outstandingSellerChargeCents(prisma(db), 'seller-1')).toBe(
      12_648,
    );
  });

  it('settles a completed payout permanently', async () => {
    const db = fakeDb();
    await raiseSellerCharge(prisma(db), charge());
    await reserveSellerChargesForPayout(prisma(db), {
      sellerId: 'seller-1',
      transactionId: 'payout-ok',
      availableCents: 12_648,
    });
    await settleSellerChargeRecoveries(prisma(db), 'payout-ok');
    await releaseSellerChargeRecoveries(prisma(db), 'payout-ok');
    expect(await outstandingSellerChargeCents(prisma(db), 'seller-1')).toBe(0);
  });

  it('waives a charge and releases any reserved slice', async () => {
    const db = fakeDb();
    const row = await raiseSellerCharge(prisma(db), charge());
    await reserveSellerChargesForPayout(prisma(db), {
      sellerId: 'seller-1',
      transactionId: 'payout-1',
      availableCents: 5_000,
    });
    await waiveSellerCharge(prisma(db), {
      chargeId: row!.id,
      adminId: 'admin-1',
      reason: 'Courier charge reclaimed in the Bob Go portal',
    });
    expect(await outstandingSellerChargeCents(prisma(db), 'seller-1')).toBe(0);
    expect(db.recoveries[0].status).toBe('RELEASED');
  });

  it('excludes waived charges from the outstanding balance', async () => {
    const db = fakeDb();
    const row = await raiseSellerCharge(prisma(db), charge());
    await waiveSellerCharge(prisma(db), {
      chargeId: row!.id,
      adminId: 'admin-1',
      reason: 'Not the seller fault',
    });
    expect(await outstandingSellerChargeCents(prisma(db), 'seller-1')).toBe(0);
  });

  it('lists a seller charges newest first with their recoveries', async () => {
    const db = fakeDb();
    await raiseSellerCharge(prisma(db), charge({ transactionId: 'tx-1' }));
    await raiseSellerCharge(prisma(db), charge({ transactionId: 'tx-2' }));
    const rows = await listSellerCharges(prisma(db), 'seller-1');
    expect(rows).toHaveLength(2);
  });
});
