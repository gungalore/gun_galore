import {
  consequencesForOfferReject,
  consequencesForSaleReject,
  applySellerRejectPenalty,
  BAN_AT,
} from './seller-reject-policy';

describe('seller-reject-policy — FIRM consequence matrix', () => {
  it('every offer reason strikes — including plain OFFER_TOO_LOW', () => {
    expect(consequencesForOfferReject('OFFER_TOO_LOW', false)).toEqual(['STRIKE']);
    expect(consequencesForOfferReject('OFFER_TOO_LOW', true)).toEqual(['STRIKE']);
    expect(consequencesForOfferReject('LISTING_ERROR', false)).toEqual(['STRIKE']);
  });
  it('availability/damage/changed-mind strike AND delist (keep listings accurate)', () => {
    expect(consequencesForOfferReject('ITEM_NO_LONGER_AVAILABLE', false)).toEqual(['STRIKE', 'DELIST']);
    expect(consequencesForOfferReject('ITEM_DAMAGED', true)).toEqual(['STRIKE', 'DELIST']);
    expect(consequencesForOfferReject('CHANGED_MIND', false)).toEqual(['STRIKE', 'DELIST']);
  });
  it('BUYER_SUSPICIOUS is the ONLY strike-free route (goes to admin review)', () => {
    expect(consequencesForOfferReject('BUYER_SUSPICIOUS', true)).toEqual(['TRUST']);
    expect(consequencesForSaleReject('BUYER_SUSPICIOUS')).toEqual(['TRUST']);
  });
  it('OTHER strikes AND goes to review (note lets admin clear a legit one)', () => {
    expect(consequencesForOfferReject('OTHER', false)).toEqual(['STRIKE', 'TRUST']);
    expect(consequencesForSaleReject('OTHER')).toEqual(['STRIKE', 'TRUST']);
  });
  it('sale rejections all strike (paid commitment): sold-elsewhere/stock delist too', () => {
    expect(consequencesForSaleReject('SOLD_ELSEWHERE')).toEqual(['STRIKE', 'DELIST']);
    expect(consequencesForSaleReject('STOCK_ISSUE')).toEqual(['STRIKE', 'DELIST']);
    expect(consequencesForSaleReject('CANT_FULFIL_SHIPPING')).toEqual(['STRIKE']);
    expect(consequencesForSaleReject('SOME_LEGACY_FREE_TEXT')).toEqual(['STRIKE', 'TRUST']);
  });
});

function mockPrisma(strikesAfterIncrement: number) {
  return {
    user: {
      update: jest
        .fn()
        .mockResolvedValueOnce({
          sellerRejectStrikes: strikesAfterIncrement,
          sellingBannedAt: null,
          username: 'sam',
        })
        .mockResolvedValue({}),
    },
    adminAlert: { create: jest.fn().mockResolvedValue({}) },
    listing: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  } as never;
}

describe('applySellerRejectPenalty', () => {
  it('STRIKE increments and alerts, below threshold no ban', async () => {
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
    expect(r.banned).toBe(false);
    const p = prisma as { adminAlert: { create: jest.Mock }; listing: { updateMany: jest.Mock } };
    expect(p.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'SELLER_REJECT_STRIKE', urgent: false }),
      }),
    );
    expect(p.listing.updateMany).not.toHaveBeenCalled();
  });

  it(`bans SELLING at ${BAN_AT} strikes: stamps sellingBannedAt + cancels ALL the seller's ACTIVE listings (urgent alert)`, async () => {
    const prisma = mockPrisma(BAN_AT);
    const r = await applySellerRejectPenalty(prisma, {
      sellerId: 'U1',
      source: 'SALE',
      reason: 'SOLD_ELSEWHERE',
      consequences: ['STRIKE', 'DELIST'],
      listingId: 'L1',
      referenceId: 'TX1',
    });
    expect(r.banned).toBe(true);
    expect(r.delisted).toBe(true);
    const p = prisma as {
      user: { update: jest.Mock };
      adminAlert: { create: jest.Mock };
      listing: { updateMany: jest.Mock };
    };
    // second user.update stamps sellingBannedAt
    expect(p.user.update).toHaveBeenCalledTimes(2);
    // ban sweep cancels ALL their ACTIVE listings…
    expect(p.listing.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sellerId: 'U1', status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      }),
    );
    // …and the specific listing delist CAS also ran
    expect(p.listing.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'L1', status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      }),
    );
    expect(p.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ urgent: true }) }),
    );
  });

  it('TRUST never touches strikes', async () => {
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
