// Public erasure on account closure (build plan §3, Phase 2).
//
// The operator's requirement in one line: a member who closes their account
// disappears from the public side, while everything that proves what they did
// stays behind. These tests cover the disappearing half — the surfaces that
// belong to US and must go dark the moment `accountClosedAt` is set.
//
// The window these guard is real and not brief: closure sets accountClosedAt
// inside the DB transaction, but the Clerk delete (step 3) and the clerkId
// tombstone the webhook writes (step 4) both land afterwards, outside it. Any
// filter that relies on the tombstone alone serves a closed member's profile
// for as long as that takes — and forever if the webhook never arrives.

import { NotFoundException } from '@nestjs/common';
import { SellersPublicController } from './sellers-public.controller';
import { RatingsService } from '../ratings/ratings.service';
import { isReservedUsername } from './username-policy';

const LIVE_SELLER = {
  id: 'U1',
  clerkId: 'clerk_live',
  username: 'karoo_kudu',
  avatarUrl: null,
  sellerTier: 'TRUSTED',
  totalSales: 14,
  averageRating: 4.8,
  createdAt: new Date('2026-01-01'),
  subscriptionTier: 'PRO',
  isVerifiedExpert: false,
  verifiedExpertAt: null,
  expertBadgeReason: null,
  kycStatus: 'VERIFIED',
};

describe('SellersPublicController — closed accounts have no public profile', () => {
  function make(row: unknown) {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(row) } };
    return {
      controller: new SellersPublicController(prisma as never),
      prisma,
    };
  }

  it('narrows the lookup with accountClosedAt: null', async () => {
    const { controller, prisma } = make(LIVE_SELLER);
    await controller.getSellerProfile('clerk_live');
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clerkId: 'clerk_live', accountClosedAt: null },
      }),
    );
  });

  it('404s when the row is filtered out by the closure', async () => {
    // A closed row still EXISTS — every financial FK points at it — so the
    // only thing standing between an old profile link and a live storefront
    // header is the where-clause above returning null.
    const { controller } = make(null);
    await expect(controller.getSellerProfile('clerk_closed')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('still serves a live seller, and never leaks kycStatus itself', async () => {
    // The badge is a boolean. Closure deliberately does NOT clear kycStatus
    // (SAP 534 Section C is assembled live off the seller row), so the 404 is
    // the only thing retiring the verified tick — worth pinning that the tick
    // is all we ever publish.
    const { controller } = make(LIVE_SELLER);
    const res = await controller.getSellerProfile('clerk_live');
    expect(res).toMatchObject({ username: 'karoo_kudu', idVerified: true });
    expect(res).not.toHaveProperty('kycStatus');
  });
});

describe('RatingsService.findForSeller — reviews received follow the profile', () => {
  function make(row: unknown) {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(row) },
      rating: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new RatingsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, prisma };
  }

  it('404s for a closed seller instead of republishing their reviews', async () => {
    // GET /ratings/seller/:clerkId is its own public route. /sellers/[clerkId]
    // notFound()s on either call failing, but this endpoint is reachable on
    // its own — and every row it returns carries a reviewer handle and the
    // LISTING TITLE, which is the members-only detail the closure took down.
    const { service, prisma } = make(null);
    await expect(service.findForSeller('clerk_closed')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { clerkId: 'clerk_closed', accountClosedAt: null },
    });
    expect(prisma.rating.findMany).not.toHaveBeenCalled();
  });

  it('selects the rater by username only, so a closed REVIEWER degrades to null', async () => {
    // The other direction: a review a closed member WROTE stays on the
    // seller's profile (deleting it would silently move another seller's
    // average). Nothing here needs to change for that — the select has only
    // ever asked for `username`, which closure sets to null, and every render
    // site already falls back. This test is what stops someone "helpfully"
    // adding firstName to the include later.
    const { service, prisma } = make({ id: 'U1' });
    await service.findForSeller('clerk_live');
    const args = prisma.rating.findMany.mock.calls[0][0];
    expect(args.include.rater).toEqual({ select: { username: true } });
  });
});

describe('reserved handles — the de-identification fallbacks', () => {
  // Closure RELEASES the username. If the literal a surface falls back to is
  // itself claimable, the next signup can take it and inherit a closed
  // member's bid history and Q&A by sight.
  it.each(['seller', 'a_member', 'anonymous'])('reserves %s', (u) => {
    expect(isReservedUsername(u)).toBe(true);
  });

  it('leaves ordinary handles alone', () => {
    expect(isReservedUsername('karoo_kudu')).toBe(false);
  });
});
