// Ask GG Everywhere — Wave 4 spec: page-context sanitize + ownership
// fuzz + PII discipline + cache-safety of the system tail.
//
// meilisearch is ESM-only and reaches this spec transitively through
// ask-gg-claude.service (→ listings → search.service) — same mock as
// the wave-1 spec.
jest.mock('meilisearch', () => ({
  Meilisearch: class {},
  MeilisearchApiError: class extends Error {},
}));

import { AskGgContextService } from './ask-gg-context.service';
import { buildSystemBlocks } from './ask-gg-claude.service';
import type { PrismaService } from '../prisma/prisma.service';

type Mock = jest.Mock;

function makeSvc() {
  const prisma = {
    listing: { findUnique: jest.fn() },
    transaction: { findUnique: jest.fn() },
    order: { findUnique: jest.fn() },
    category: { findUnique: jest.fn() },
  };
  const svc = new AskGgContextService(prisma as unknown as PrismaService);
  return { svc, prisma };
}

describe('AskGgContextService.sanitize (untrusted input fuzz)', () => {
  const { svc } = makeSvc();

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['string', 'hello'],
    ['number', 42],
    ['array', [{ path: '/x' }]],
    ['missing path', { listingId: 'abc' }],
    ['path not absolute', { path: 'listings/1' }],
    ['path too long', { path: '/' + 'a'.repeat(400) }],
  ])('drops %s → undefined', (_label, raw) => {
    expect(svc.sanitize(raw)).toBeUndefined();
  });

  it('keeps path but drops malformed ids (injection strings)', () => {
    const out = svc.sanitize({
      path: '/listings/x',
      listingId: 'abc; DROP TABLE listings;--',
      transactionId: 'a b',
      orderId: 'x'.repeat(65),
      categorySlug: 'sc opes!',
    });
    expect(out).toEqual({ path: '/listings/x' });
  });

  it('keeps valid ids and discards unknown keys', () => {
    const out = svc.sanitize({
      path: '/listings/ckm123',
      listingId: 'ckm123',
      role: 'ignore me',
      isAdmin: true,
    });
    expect(out).toEqual({ path: '/listings/ckm123', listingId: 'ckm123' });
    expect(Object.keys(out!)).toEqual(['path', 'listingId']);
  });
});

describe('buildContextBlock — ownership fuzz', () => {
  const tx = {
    id: 'tx1',
    buyerId: 'buyer-1',
    sellerId: 'seller-1',
    quantity: 1,
    listingPrice: 250_000,
    paymentStatus: 'HELD',
    shippingMethod: 'PUDO_L2L',
    trackingReference: 'PUD123456',
    paidAt: new Date('2026-07-01'),
    acceptedAt: new Date('2026-07-02'),
    dispatchedAt: null,
    deliveredAt: null,
    releasedAt: null,
    listing: { title: 'Vortex Viper 5-25x50', isFirearm: false },
  };

  it('includes the transaction for the BUYER', async () => {
    const { svc, prisma } = makeSvc();
    (prisma.transaction.findUnique as Mock).mockResolvedValue(tx);
    const block = await svc.buildContextBlock(
      { path: '/transactions/tx1', transactionId: 'tx1' },
      'buyer-1',
    );
    expect(block).toContain('BUYER');
    expect(block).toContain('Vortex Viper');
    expect(block).toContain('funds held');
  });

  it('includes the transaction for the SELLER', async () => {
    const { svc, prisma } = makeSvc();
    (prisma.transaction.findUnique as Mock).mockResolvedValue(tx);
    const block = await svc.buildContextBlock(
      { path: '/transactions/tx1', transactionId: 'tx1' },
      'seller-1',
    );
    expect(block).toContain('SELLER');
  });

  it('DROPS the transaction for a third party — nothing leaks', async () => {
    const { svc, prisma } = makeSvc();
    (prisma.transaction.findUnique as Mock).mockResolvedValue(tx);
    const block = await svc.buildContextBlock(
      { path: '/transactions/tx1', transactionId: 'tx1' },
      'attacker-9',
    );
    expect(block).toContain('/transactions/tx1'); // path line stays
    expect(block).not.toContain('Vortex');
    expect(block).not.toContain('PUD123456');
    expect(block).not.toContain('BUYER');
    expect(block).not.toContain('HELD');
  });

  it('DROPS an order the caller does not own', async () => {
    const { svc, prisma } = makeSvc();
    (prisma.order.findUnique as Mock).mockResolvedValue({
      id: 'o1',
      buyerId: 'buyer-1',
      status: 'PAID',
      orderReference: 'GG-1234',
      buyerTotal: 500_000,
      createdAt: new Date('2026-07-10'),
      _count: { lineItems: 2 },
    });
    const owned = await svc.buildContextBlock(
      { path: '/orders/o1', orderId: 'o1' },
      'buyer-1',
    );
    const foreign = await svc.buildContextBlock(
      { path: '/orders/o1', orderId: 'o1' },
      'someone-else',
    );
    expect(owned).toContain('GG-1234');
    expect(foreign).not.toContain('GG-1234');
    expect(foreign).not.toContain('PAID');
  });

  it('missing rows and prisma errors degrade to the path-only block', async () => {
    const { svc, prisma } = makeSvc();
    (prisma.listing.findUnique as Mock).mockRejectedValue(new Error('db down'));
    const block = await svc.buildContextBlock(
      { path: '/listings/gone', listingId: 'gone' },
      'u1',
    );
    expect(block).toContain('/listings/gone');
    expect(block).toContain('CURRENT PAGE CONTEXT');
  });
});

describe('buildContextBlock — listing PII + reserve discipline', () => {
  const listing = {
    id: 'l1',
    title: 'Tikka T3x Lite .308',
    price: 1_850_000,
    listingType: 'AUCTION',
    condition: 'GOOD',
    status: 'ACTIVE',
    province: 'GAUTENG',
    isFirearm: true,
    currentBid: 1_500_000,
    endTime: new Date('2026-08-01T18:00:00Z'),
    reservePrice: 1_700_000,
    quantityAvailable: 1,
    quantityReserved: 0,
    category: { name: 'Hunting Rifles' },
    seller: { username: 'buck_hunter' },
  };

  it('emits reserve-met status but NEVER the reserve figure', async () => {
    const { svc, prisma } = makeSvc();
    (prisma.listing.findUnique as Mock).mockResolvedValue(listing);
    const block = (await svc.buildContextBlock(
      { path: '/listings/l1', listingId: 'l1' },
      'u1',
    ))!;
    expect(block).toContain('reserve not met');
    expect(block).not.toContain('17'); // R17,000.00 in any formatting
    expect(block).toContain('R15');
    expect(block).toContain('@buck_hunter');
    expect(block).toContain('FIREARM');
  });

  it('caps the block at 1500 chars even with a huge title', async () => {
    const { svc, prisma } = makeSvc();
    (prisma.listing.findUnique as Mock).mockResolvedValue({
      ...listing,
      title: 'X'.repeat(5000),
    });
    const block = (await svc.buildContextBlock(
      { path: '/listings/l1', listingId: 'l1' },
      'u1',
    ))!;
    expect(block.length).toBeLessThanOrEqual(1500);
  });
});

describe('buildSystemBlocks cache safety with contextBlock', () => {
  it('block 1 is byte-identical with and without a context tail', () => {
    const bare = buildSystemBlocks(false);
    const withCtx = buildSystemBlocks(false, '## CURRENT PAGE CONTEXT\nx');
    expect(withCtx[0]).toEqual(bare[0]);
    const tail = withCtx[withCtx.length - 1] as { text: string };
    expect(tail.text).toContain('CURRENT PAGE CONTEXT');
  });
});
