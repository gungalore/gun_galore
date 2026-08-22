// meilisearch is ESM and breaks ts-jest if imported for real (AdminService
// → ListingsService → SearchService pulls it in transitively).
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { BadRequestException } from '@nestjs/common';
import { AdminService } from './admin.service';

// P5.3 regression tests for AdminService.releaseTransaction. The critical
// invariant (from the pre-deploy adversarial review): HELD is the DEFAULT
// status at creation with paidAt=null, so a courier order sits HELD-unpaid
// for the whole 24h EFT window BEFORE any money arrives. Releasing such a row
// would queue a real seller payout in the FNB batch for money never received.
// releaseTransaction must refuse anything the buyer hasn't actually funded
// (paidAt is the proof-of-payment marker on both rails), and the atomic CAS
// must carry the same paid-only predicate.

function makeService(overrides: {
  tx: Record<string, unknown> | null;
  claimCount?: number;
}) {
  const txc = {
    transaction: {
      updateMany: jest
        .fn()
        .mockResolvedValue({ count: overrides.claimCount ?? 1 }),
    },
    user: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: jest.fn(
      async (fn: (t: typeof txc) => Promise<unknown>) => fn(txc),
    ),
    transaction: {
      findUnique: jest.fn().mockResolvedValue(overrides.tx),
    },
  };
  const zohoBooks = {
    createCommissionInvoice: jest.fn().mockResolvedValue(undefined),
  };
  const service = new AdminService(
    prisma as never,
    // The KYC dossier reads the identity document out of the encrypted store.
    { read: jest.fn(async () => Buffer.from([0xff, 0xd8])) } as never,
    {} as never, // notifications — unused by release
    {} as never, // listings — unused
    {} as never, // audit — unused
    zohoBooks as never,
    {} as never, // peach — manual rail, never called
    {} as never, // transactions — unused
    {} as never, // sms — unused by release
    {} as never, // account closures — unused by release
  );
  return { service, prisma, txc, zohoBooks };
}

const paidHeldTx = {
  id: 'TX1',
  sellerId: 'S1',
  paymentStatus: 'HELD',
  paidAt: new Date('2026-06-01T10:00:00Z'), // funded
  shippingMethod: 'PUDO',
  dealerVerificationStatus: null,
  seller: {
    id: 'S1',
    email: 's@x.co',
    profileCompletedAt: new Date('2026-05-01T10:00:00Z'),
    bankVerifiedAt: null,
    kycStatus: 'VERIFIED',
  },
  listing: { isFirearm: false },
};

describe('AdminService.releaseTransaction (P5.3 money gate)', () => {
  it('REFUSES to release an unpaid HELD order (paidAt null) — no payout ever queued', async () => {
    const { service, prisma, zohoBooks } = makeService({
      tx: { ...paidHeldTx, paidAt: null },
    });
    await expect(
      service.releaseTransaction('TX1', 'admin1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    // The atomic CAS must never run for an unfunded order.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(zohoBooks.createCommissionInvoice).not.toHaveBeenCalled();
  });

  it('releases a PAID, onboarded HELD order and carries the paid-only predicate in the CAS', async () => {
    const { service, txc, zohoBooks } = makeService({ tx: { ...paidHeldTx } });
    const result = await service.releaseTransaction('TX1', 'admin1');
    expect(result).toEqual({ id: 'TX1', paymentStatus: 'RELEASED' });
    // Belt-and-braces: the atomic claim gates on paidAt not-null too.
    const claim = txc.transaction.updateMany.mock.calls[0][0];
    expect(claim.where.paidAt).toEqual({ not: null });
    expect(claim.data.paymentStatus).toBe('RELEASED');
    // Exactly-once side effects.
    expect(txc.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { totalSales: { increment: 1 } } }),
    );
    expect(zohoBooks.createCommissionInvoice).toHaveBeenCalledWith('TX1');
  });

  it('refuses a paid order whose seller has not completed onboarding', async () => {
    const { service, prisma } = makeService({
      tx: { ...paidHeldTx, seller: { ...paidHeldTx.seller, profileCompletedAt: null } },
    });
    await expect(
      service.releaseTransaction('TX1', 'admin1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a non-releasable status (RELEASED) outright', async () => {
    const { service, prisma } = makeService({
      tx: { ...paidHeldTx, paymentStatus: 'RELEASED' },
    });
    await expect(
      service.releaseTransaction('TX1', 'admin1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
