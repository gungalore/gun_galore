import {
  consequencesForOfferReject,
  consequencesForSaleReject,
  applySellerRejectPenalty,
  SUSPEND_AT,
} from './seller-reject-policy';

describe('seller-reject-policy — consequence matrix', () => {
  it('OFFER_TOO_LOW is penalty-free for ordinary offers', () => {
    expect(consequencesForOfferReject('OFFER_TOO_LOW', false)).toEqual(['NONE']);
  });
  it('OFFER_TOO_LOW is a STRIKE when the offer met the auto-accept price', () => {
    expect(consequencesForOfferReject('OFFER_TOO_LOW', true)).toEqual(['STRIKE']);
  });
  it('CHANGED_MIND strikes and delists', () => {
    expect(consequencesForOfferReject('CHANGED_MIND', false)).toEqual([
      'STRIKE',
      'DELIST',
    ]);
  });
  it('availability/damage reasons delist without a strike', () => {
    expect(consequencesForOfferReject('ITEM_NO_LONGER_AVAILABLE', false)).toEqual(['DELIST']);
    expect(consequencesForOfferReject('ITEM_DAMAGED', true)).toEqual(['DELIST']);
  });
  it('suspicious-buyer and OTHER route to trust review, no strike', () => {
    expect(consequencesForOfferReject('BUYER_SUSPICIOUS', true)).toEqual(['TRUST']);
    expect(consequencesForOfferReject('OTHER', false)).toEqual(['TRUST']);
  });
  it('sale rejections: SOLD_ELSEWHERE strikes + delists; stock issue only delists; unknown/legacy → trust', () => {
    expect(consequencesForSaleReject('SOLD_ELSEWHERE')).toEqual(['STRIKE', 'DELIST']);
    expect(consequencesForSaleReject('STOCK_ISSUE')).toEqual(['DELIST']);
    expect(consequencesForSaleReject('CANT_FULFIL_SHIPPING')).toEqual(['NONE']);
    expect(consequencesForSaleReject('SOME_LEGACY_FREE_TEXT')).toEqual(['TRUST']);
  });
});

function mockPrisma(strikesAfterIncrement: number) {
  return {
    user: {
      update: jest
        .fn()
        .mockResolvedValueOnce({
          sellerRejectStrikes: strikesAfterIncrement,
          offersSuspendedAt: null,
          username: 'sam',
        })
        .mockResolvedValue({}),
    },
    adminAlert: { create: jest.fn().mockResolvedValue({}) },
    listing: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  } as never;
}

describe('applySellerRejectPenalty', () => {
  it('STRIKE increments and alerts, below threshold no suspension', async () => {
    const prisma = mockPrisma(1);
    const r = await applySellerRejectPenalty(prisma, {
      sellerId: 'U1',
      source: 'OFFER',
      reason: 'CHANGED_MIND',
      consequences: ['STRIKE'],
      referenceId: 'O1',
    });
    expect(r.struck).toBe(true);
    expect(r.totalStrikes).toBe(1);
    expect(r.suspended).toBe(false);
    const p = prisma as { adminAlert: { create: jest.Mock } };
    expect(p.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'SELLER_REJECT_STRIKE', urgent: false }),
      }),
    );
  });

  it(`suspends offers at ${SUSPEND_AT} strikes (urgent alert)`, async () => {
    const prisma = mockPrisma(SUSPEND_AT);
    const r = await applySellerRejectPenalty(prisma, {
      sellerId: 'U1',
      source: 'SALE',
      reason: 'SOLD_ELSEWHERE',
      consequences: ['STRIKE', 'DELIST'],
      listingId: 'L1',
      referenceId: 'TX1',
    });
    expect(r.suspended).toBe(true);
    expect(r.delisted).toBe(true);
    const p = prisma as {
      user: { update: jest.Mock };
      adminAlert: { create: jest.Mock };
      listing: { updateMany: jest.Mock };
    };
    // second user.update stamps offersSuspendedAt
    expect(p.user.update).toHaveBeenCalledTimes(2);
    expect(p.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ urgent: true }),
      }),
    );
    expect(p.listing.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'L1', status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      }),
    );
  });

  it('TRUST/NONE never touch strikes', async () => {
    const prisma = mockPrisma(99);
    const r = await applySellerRejectPenalty(prisma, {
      sellerId: 'U1',
      source: 'OFFER',
      reason: 'BUYER_SUSPICIOUS',
      consequences: ['TRUST'],
      referenceId: 'O1',
    });
    expect(r.struck).toBe(false);
    const p = prisma as { user: { update: jest.Mock }; adminAlert: { create: jest.Mock } };
    expect(p.user.update).not.toHaveBeenCalled();
    expect(p.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'SELLER_REJECT_REVIEW' }),
      }),
    );
  });
});
