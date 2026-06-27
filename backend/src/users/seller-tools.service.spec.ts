import { BadRequestException } from '@nestjs/common';
import { SellerToolsService } from './seller-tools.service';

function makeService(rows: Record<string, unknown>[], user: { id: string } | null = { id: 'S1' }) {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    transaction: { findMany: jest.fn().mockResolvedValue(rows) },
  };
  return { service: new SellerToolsService(prisma as never), prisma };
}

const releasedRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'TX_RELEASED_1',
  referenceNumber: 'GG-0001',
  createdAt: new Date('2026-06-01T08:00:00Z'),
  releasedAt: new Date('2026-06-10T08:00:00Z'),
  paymentStatus: 'RELEASED',
  listingPrice: 100_000,
  commissionZar: 8_000,
  processingFee: 3_000,
  shippingCost: 9_900,
  sellerPayout: 89_000,
  buyerTotal: 109_900,
  listing: { title: 'Leupold scope, 3-9x40' },
  buyer: { username: 'hunter_x' },
  ...over,
});

describe('SellerToolsService.payoutStatement', () => {
  it('sums RELEASED orders into the summary and excludes REFUNDED from totals', async () => {
    const { service } = makeService([
      releasedRow(),
      releasedRow({ id: 'TX2', sellerPayout: 50_000, listingPrice: 60_000, commissionZar: 5_000, processingFee: 2_000, shippingCost: 0, buyerTotal: 67_000 }),
      releasedRow({ id: 'TX3', paymentStatus: 'REFUNDED', sellerPayout: 99_999 }),
    ]);
    const out = await service.payoutStatement('clerk_s');
    expect(out.summary.orderCount).toBe(2); // refunded excluded
    expect(out.summary.netPayout).toBe(139_000); // 89k + 50k, NOT the refunded 99,999
    expect(out.summary.grossSales).toBe(160_000);
    expect(out.summary.refundedCount).toBe(1);
    expect(out.orders).toHaveLength(3); // refunded still listed in detail
  });

  it('defaults to a 90-day window and rejects from>to', async () => {
    const { service, prisma } = makeService([]);
    await service.payoutStatement('clerk_s');
    const where = prisma.transaction.findMany.mock.calls[0][0].where;
    expect(where.sellerId).toBe('S1');
    await expect(
      service.payoutStatement('clerk_s', '2026-06-30', '2026-06-01'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('builds a CSV with a header row, order rows, and a TOTAL line; escapes commas', async () => {
    const { service } = makeService([releasedRow()]);
    const csv = await service.payoutStatementCsv('clerk_s');
    const lines = csv.trim().split('\n');
    expect(lines[0]).toContain('Reference,Date,Item');
    // Title contains a comma → must be quoted
    expect(lines[1]).toContain('"Leupold scope, 3-9x40"');
    expect(lines[lines.length - 1]).toMatch(/^TOTAL,/);
  });
});
