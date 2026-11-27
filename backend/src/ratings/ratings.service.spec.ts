import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RatingsService } from './ratings.service';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE RATINGS SERVICE (audit, 2026-11-27).
 *
 * What is pinned here: the dashboard serves the REAL trust components (and they
 * reconcile to the score), the public review list is capped and stripped of
 * internal ids, a duplicate-create race is a 409 not a 500, public free text is
 * profanity-masked before the contact filter, and the daily sweep reaches quiet
 * sellers who only have a listing or an old transaction.
 * ────────────────────────────────────────────────────────────────────────────
 */

const NOW = new Date('2026-11-27T12:00:00Z');
const OLD_ACCOUNT = new Date('2022-01-01T00:00:00Z');
const PAID = new Date('2026-11-01T08:00:00Z');

function sellerUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'seller',
    createdAt: OLD_ACCOUNT,
    totalSales: 12,
    sellerTier: 'ESTABLISHED',
    trustScore: 0,
    averageRating: 4.5,
    sellerTransactions: [
      {
        paymentStatus: 'RELEASED',
        shippingStatus: 'DELIVERED',
        paidAt: PAID,
        dispatchedAt: new Date(PAID.getTime() + 20 * 3_600_000),
        swapId: null,
        rating: { stars: 5 },
      },
    ],
    listings: [{ claudeConfidence: 1 }],
    ...overrides,
  };
}

function shapeRating(id: string) {
  return {
    id,
    transactionId: `tx-${id}`,
    raterId: 'buyer',
    ratedId: 'seller',
    stars: 5,
    comment: 'Good sale',
    sellerResponse: null,
    sellerRespondedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    rater: {
      username: 'buyer-handle',
      phoneVerified: true,
      emailVerifiedAt: NOW,
      kycIdVerifiedAt: null,
    },
    transaction: { listing: { title: 'Rifle scope' } },
  };
}

function build(overrides: {
  transaction?: Record<string, jest.Mock>;
  user?: Record<string, jest.Mock>;
  rating?: Record<string, jest.Mock>;
} = {}) {
  // The service takes PrismaService; a plain object of jest mocks is the harness
  // every other service spec in this repo uses. `any` keeps the mock-call
  // introspection (`mock.calls[0][0]`) readable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: Record<string, any> = {
    user: {
      findUnique: jest.fn(async () => sellerUser()),
      update: jest.fn(async () => ({})),
      ...(overrides.user ?? {}),
    },
    transaction: {
      findUnique: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      ...(overrides.transaction ?? {}),
    },
    listing: { findMany: jest.fn(async () => []) },
    rating: {
      create: jest.fn(async () => ({ id: 'rating-1' })),
      update: jest.fn(async () => ({ id: 'rating-1' })),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 3),
      findUnique: jest.fn(async () => null),
      delete: jest.fn(async () => ({})),
      ...(overrides.rating ?? {}),
    },
  };
  const contactFilter = {
    check: jest.fn(async () => ({ allowed: true })),
  };
  const notifications = { ratingReceived: jest.fn() };
  const audit = { record: jest.fn(async () => undefined) };
  const svc = new RatingsService(
    prisma as never,
    contactFilter as never,
    notifications as never,
    audit as never,
  );
  return { svc, prisma, contactFilter, notifications, audit };
}

function rateableTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-1',
    swapId: null,
    paymentStatus: 'RELEASED',
    rating: null,
    buyerId: 'buyer',
    sellerId: 'seller',
    buyer: { id: 'buyer', username: 'buyer-handle' },
    seller: {
      id: 'seller',
      email: 'seller@example.com',
      firstName: 'Sam',
      username: 'seller-handle',
    },
    ...overrides,
  };
}

describe('the trust dashboard', () => {
  it('serves the real components, and they reconcile to the score', async () => {
    const { svc } = build({
      rating: { count: jest.fn(async () => 3) },
    });

    const dashboard = await svc.getTrustDashboard('seller');

    // One completed courier sale, 5★, dispatched in 20h, full-quality listing,
    // account older than two years.
    expect(dashboard.components).toEqual({
      sales: 1,
      rating: 25,
      delivery: 20,
      dispatch: 15,
      quality: 10,
      age: 5,
    });
    expect(dashboard.completedSales).toBe(1);
    expect(dashboard.trustScore).toBe(76);
    const total = Object.values(dashboard.components).reduce(
      (sum, value) => sum + value,
      0,
    );
    expect(Math.round(total)).toBe(dashboard.trustScore);
    // Computed from the same rule as recalcSeller — not the client's bars.
    expect(dashboard.sellerTier).toBe('NEW');
    expect(dashboard.averageRating).toBe(5);
    expect(dashboard.totalRatings).toBe(3);
    expect(dashboard.totalSales).toBe(12);
  });

  it('is READ-ONLY — viewing the dashboard never writes the seller row', async () => {
    const { svc, prisma } = build();
    await svc.getTrustDashboard('seller');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('rating create — the duplicate race', () => {
  it('maps a P2002 on the unique transactionId to a 409, not a 500', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'x',
    });
    const { svc, prisma, notifications } = build({
      transaction: {
        findUnique: jest.fn(async () => rateableTransaction()),
      },
      rating: {
        // Two concurrent POSTs both passed the `tx.rating` check; the loser hits
        // the database's unique constraint.
        create: jest.fn(async () => {
          throw conflict;
        }),
      },
    });

    await expect(
      svc.create('tx-1', 'buyer', { stars: 5, comment: 'Great' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      svc.create('tx-1', 'buyer', { stars: 5, comment: 'Great' }),
    ).rejects.toThrow(/already has a rating/i);
    // Nothing downstream of the insert ran.
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(notifications.ratingReceived).not.toHaveBeenCalled();
  });

  it('still refuses a rated transaction before the write', async () => {
    const { svc, prisma } = build({
      transaction: {
        findUnique: jest.fn(async () =>
          rateableTransaction({ rating: { id: 'existing' } }),
        ),
      },
    });
    await expect(
      svc.create('tx-1', 'buyer', { stars: 4 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.rating.create).not.toHaveBeenCalled();
  });
});

describe('public free text is masked before it is published', () => {
  it('masks profanity in a rating comment, then runs the contact filter', async () => {
    const { svc, prisma, contactFilter } = build({
      transaction: {
        findUnique: jest.fn(async () => rateableTransaction()),
      },
      rating: { create: jest.fn(async () => ({ id: 'rating-1' })) },
    });

    await svc.create('tx-1', 'buyer', {
      stars: 5,
      comment: '  This is fucking brilliant  ',
    });

    const created = prisma.rating.create.mock.calls[0][0] as {
      data: { comment: string | null };
    };
    expect(created.data.comment).toBe('This is f****** brilliant');    expect(contactFilter.check).toHaveBeenCalledWith(
      'This is f****** brilliant',
      'rating-comment',
      'buyer',
    );
  });

  it('stores null for an empty comment, and does not run the filter', async () => {
    const { svc, prisma, contactFilter } = build({
      transaction: {
        findUnique: jest.fn(async () => rateableTransaction()),
      },
    });
    await svc.create('tx-1', 'buyer', { stars: 5, comment: '   ' });
    const created = prisma.rating.create.mock.calls[0][0] as {
      data: { comment: string | null };
    };
    expect(created.data.comment).toBeNull();
    expect(contactFilter.check).not.toHaveBeenCalled();
  });

  it('masks a seller reply the same way', async () => {
    const { svc, prisma, contactFilter } = build({
      rating: {
        findUnique: jest.fn(async () => ({
          id: 'rating-1',
          rated: { id: 'seller' },
          sellerRespondedAt: null,
        })),
        update: jest.fn(async () => ({ id: 'rating-1' })),
      },
    });

    await svc.respond('rating-1', 'seller', 'That is a load of bullshit');

    const updated = prisma.rating.update.mock.calls[0][0] as {
      data: { sellerResponse: string };
    };
    expect(updated.data.sellerResponse).toBe('That is a load of b*******');
    expect(contactFilter.check).toHaveBeenCalledWith(
      'That is a load of b*******',
      'rating-response',
      'seller',
    );
  });
});

describe('the public review list', () => {
  it('caps at 50 and strips the internal ids', async () => {
    const { svc, prisma } = build({
      user: { findUnique: jest.fn(async () => ({ id: 'seller' })) },
      rating: {
        findMany: jest.fn(async () =>
          Array.from({ length: 50 }, (_, i) => shapeRating(`r${i}`)),
        ),
      },
    });

    const rows = await svc.findForSeller('seller');

    expect(prisma.rating.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
    expect(rows).toHaveLength(50);
    for (const row of rows) {
      expect(row).not.toHaveProperty('raterId');
      expect(row).not.toHaveProperty('ratedId');
      expect(row).not.toHaveProperty('transactionId');
      // What the seller page renders is still there.
      expect(row).toHaveProperty('stars');
      expect(row).toHaveProperty('comment');
      expect((row.rater as { username: string }).username).toBe('buyer-handle');
      expect(
        (row.transaction as { listing: { title: string } }).listing.title,
      ).toBe('Rifle scope');
    }
  });
});

describe('the daily sweep', () => {
  it('refreshes a quiet seller who only has a listing or an old transaction', async () => {
    const updated: string[] = [];
    const { svc, prisma } = build({
      user: {
        findUnique: jest.fn(async (args: { where: { id: string } }) =>
          sellerUser({ id: args.where.id }),
        ),
        update: jest.fn(async (args: { where: { id: string } }) => {
          updated.push(args.where.id);
          return {};
        }),
      },
    });
    prisma.transaction.findMany = jest
      .fn()
      // Recent-activity pass: one busy seller.
      .mockResolvedValueOnce([{ sellerId: 'recent-seller' }])
      // Every-seller pass: someone whose only sale is old.
      .mockResolvedValueOnce([{ sellerId: 'quiet-seller' }]);
    prisma.listing.findMany = jest.fn(async () => [
      { sellerId: 'listing-seller' },
    ]);

    const count = await svc.recalcRecentSellers();

    expect(count).toBe(3);
    expect(new Set(updated)).toEqual(
      new Set(['recent-seller', 'quiet-seller', 'listing-seller']),
    );
  });

  it('is bounded at 500 seller ids', async () => {
    const updated: string[] = [];
    const { svc, prisma } = build({
      user: {
        findUnique: jest.fn(async (args: { where: { id: string } }) =>
          sellerUser({ id: args.where.id }),
        ),
        update: jest.fn(async (args: { where: { id: string } }) => {
          updated.push(args.where.id);
          return {};
        }),
      },
    });
    prisma.transaction.findMany = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(
        Array.from({ length: 900 }, (_, i) => ({ sellerId: `s${i}` })),
      );
    prisma.listing.findMany = jest.fn(async () => []);

    const count = await svc.recalcRecentSellers();

    expect(count).toBe(500);
    expect(updated).toHaveLength(500);
  });
});
