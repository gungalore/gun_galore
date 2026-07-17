jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { BadRequestException } from '@nestjs/common';
import { AdminService } from './admin.service';

function makeService(rows: Record<string, unknown>[]) {
  const prisma = {
    transaction: { findMany: jest.fn().mockResolvedValue(rows) },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new AdminService(
    prisma as never,
    {} as never, // notifications
    {} as never, // listings
    audit as never,
    {} as never, // zohoBooks
    {} as never, // stitch
    {} as never, // transactions (P5.2) — unused by export
    {} as never, // sms — unused by export
  );
  return { service, prisma, audit };
}

const row = () => ({
  orderReference: 'GG-ORD-1',
  createdAt: new Date('2026-06-10T08:00:00Z'),
  paidAt: new Date('2026-06-10T09:00:00Z'),
  releasedAt: new Date('2026-06-12T09:00:00Z'),
  paymentStatus: 'RELEASED',
  listingPrice: 100_000,
  commissionZar: 8_000,
  processingFee: 3_000,
  shippingCost: 9_900,
  buyerTotal: 109_900,
  sellerPayout: 89_000,
  refundedAmount: 0,
  listing: { title: 'Scope, with comma' },
  buyer: { username: 'buyer1', email: 'b@x.co' },
  seller: { username: 'seller1', email: 's@x.co' },
});

describe('AdminService.exportTransactionsCsv', () => {
  it('builds a CSV with header + rows + escapes commas; logs an audit row', async () => {
    const { service, audit } = makeService([row()]);
    const { csv, filename } = await service.exportTransactionsCsv({}, 'admin1');
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toContain('Order ref,Created');
    expect(lines[1]).toContain('"Scope, with comma"'); // comma escaped
    expect(lines[1]).toContain('890.00'); // net payout rands
    expect(filename).toMatch(/^gungalore-orders-/);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'TRANSACTIONS_EXPORT' }),
    );
  });

  it('never includes bank / clerk / SA-ID columns', async () => {
    const { service } = makeService([row()]);
    const { csv } = await service.exportTransactionsCsv({}, 'admin1');
    const header = csv.split('\r\n')[0].toLowerCase();
    expect(header).not.toContain('bank');
    expect(header).not.toContain('account');
    expect(header).not.toContain('clerk');
    expect(header).not.toContain('id number');
  });

  it('rejects from > to', async () => {
    const { service } = makeService([]);
    await expect(
      service.exportTransactionsCsv({ fromISO: '2026-06-30', toISO: '2026-06-01' }, 'a'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a range over 180 days', async () => {
    const { service } = makeService([]);
    await expect(
      service.exportTransactionsCsv({ fromISO: '2025-01-01', toISO: '2026-01-01' }, 'a'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
