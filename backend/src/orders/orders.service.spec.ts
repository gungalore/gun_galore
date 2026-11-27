import { OrdersService } from './orders.service';

/**
 * ────────────────────────────────────────────────────────────────────────────
 * MULTI-SELLER ORDERS: EACH SELLER IS RATED ONCE (operator, 2026-11-27).
 *
 * A rating hangs off one Transaction (one cart line), so a seller with two lines
 * could be rated twice and a multi-seller order had no single place to rate each
 * seller. `GET /orders/:id` now groups the lines by seller and serves, per
 * seller, where to rate them, whether they can be rated yet, and the rating if
 * one exists on any line.
 * ────────────────────────────────────────────────────────────────────────────
 */

type PaymentStatus = 'HELD' | 'RELEASED';

function line(
  sellerId: string,
  paymentStatus: PaymentStatus | null,
  transactionId?: string,
) {
  const id = transactionId ?? `tx-${sellerId}-${Math.random().toString(36).slice(2)}`;
  return {
    id: `line-${id}`,
    sellerId,
    transactionId: paymentStatus ? id : null,
    transaction: paymentStatus
      ? { id, paymentStatus, shippingStatus: null }
      : null,
  };
}

function build(opts: {
  lineItems: ReturnType<typeof line>[];
  sellers?: { id: string; username: string | null }[];
  ratings?: {
    id: string;
    stars: number;
    comment: string | null;
    sellerResponse: string | null;
    sellerRespondedAt: Date | null;
    createdAt: Date;
    transactionId: string;
    ratedId: string;
  }[];
  buyerId?: string;
}) {
  const prisma = {
    user: {
      findUnique: jest.fn(async () => ({ id: opts.buyerId ?? 'buyer' })),
      findMany: jest.fn(async () => opts.sellers ?? []),
    },
    order: {
      findUnique: jest.fn(async () => ({
        id: 'order-1',
        buyerId: opts.buyerId ?? 'buyer',
        lineItems: opts.lineItems,
      })),
    },
    rating: {
      findMany: jest.fn(async () => opts.ratings ?? []),
    },
  };
  const svc = new OrdersService(
    prisma as never,
    {} as never,
    {} as never,
  );
  return { svc, prisma };
}

describe('order detail — sellers and their ratings', () => {
  it('groups lines by seller and offers each released seller once', async () => {
    const { svc, prisma } = build({
      lineItems: [
        line('seller-a', 'RELEASED', 'tx-a1'),
        line('seller-a', 'RELEASED', 'tx-a2'), // two lines, one seller
        line('seller-b', 'RELEASED', 'tx-b1'),
      ],
      sellers: [
        { id: 'seller-a', username: 'alpha' },
        { id: 'seller-b', username: 'bravo' },
      ],
    });

    const order = await svc.getOrder('order-1', 'buyer');

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['seller-a', 'seller-b'] } },
      }),
    );
    expect(order.sellers).toHaveLength(2);
    expect(order.sellers[0]).toMatchObject({
      sellerId: 'seller-a',
      username: 'alpha',
      transactionId: 'tx-a1',
      canRate: true,
      rating: null,
    });
    expect(order.sellers[1]).toMatchObject({
      sellerId: 'seller-b',
      username: 'bravo',
      transactionId: 'tx-b1',
      canRate: true,
    });
    // Existing keys survive.
    expect(order).toHaveProperty('lineItems');
    expect(order.bankDetails).toBeNull();
  });

  it('a seller with one outstanding line cannot be rated, but the other sellers can', async () => {
    const { svc } = build({
      lineItems: [
        line('seller-a', 'RELEASED', 'tx-a1'),
        line('seller-b', 'HELD', 'tx-b1'),
        line('seller-c', 'RELEASED', 'tx-c1'),
        line('seller-c', 'HELD', 'tx-c2'),
      ],
      sellers: [
        { id: 'seller-a', username: 'alpha' },
        { id: 'seller-b', username: 'bravo' },
        { id: 'seller-c', username: 'charlie' },
      ],
    });

    const order = await svc.getOrder('order-1', 'buyer');
    const byId = Object.fromEntries(
      order.sellers.map((seller) => [seller.sellerId, seller]),
    );

    expect(byId['seller-a'].canRate).toBe(true);
    // Nothing of theirs has been released → nowhere to hang a rating.
    expect(byId['seller-b'].canRate).toBe(false);
    expect(byId['seller-b'].transactionId).toBeNull();
    // Partly released: still not rateable, but the released line is offered.
    expect(byId['seller-c'].canRate).toBe(false);
    expect(byId['seller-c'].transactionId).toBe('tx-c1');
  });

  it('returns an existing rating on whichever line it was left', async () => {
    const { svc } = build({
      lineItems: [
        line('seller-a', 'RELEASED', 'tx-a1'),
        line('seller-a', 'RELEASED', 'tx-a2'),
        line('seller-b', 'RELEASED', 'tx-b1'),
      ],
      sellers: [
        { id: 'seller-a', username: 'alpha' },
        { id: 'seller-b', username: 'bravo' },
      ],
      ratings: [
        {
          id: 'rating-a',
          stars: 4,
          comment: 'As described.',
          sellerResponse: 'Thank you.',
          sellerRespondedAt: new Date('2026-11-20T10:00:00Z'),
          createdAt: new Date('2026-11-19T10:00:00Z'),
          transactionId: 'tx-a2',
          ratedId: 'seller-a',
        },
      ],
    });

    const order = await svc.getOrder('order-1', 'buyer');
    const alpha = order.sellers.find((seller) => seller.sellerId === 'seller-a')!;
    expect(alpha.canRate).toBe(false);
    expect(alpha.rating).toEqual({
      id: 'rating-a',
      stars: 4,
      comment: 'As described.',
      sellerResponse: 'Thank you.',
      sellerRespondedAt: new Date('2026-11-20T10:00:00Z'),
      createdAt: new Date('2026-11-19T10:00:00Z'),
      transactionId: 'tx-a2',
    });
    const bravo = order.sellers.find((seller) => seller.sellerId === 'seller-b')!;
    expect(bravo.canRate).toBe(true);
    expect(bravo.rating).toBeNull();
  });

  it('single-line orders still expose one rateable seller', async () => {
    const { svc } = build({
      lineItems: [line('seller-a', 'RELEASED', 'tx-a1')],
      sellers: [{ id: 'seller-a', username: 'alpha' }],
    });

    const order = await svc.getOrder('order-1', 'buyer');
    expect(order.sellers).toEqual([
      {
        sellerId: 'seller-a',
        username: 'alpha',
        transactionId: 'tx-a1',
        canRate: true,
        rating: null,
      },
    ]);
  });

  it('falls back to the anonymous handle when a seller username is gone', async () => {
    const { svc } = build({
      lineItems: [line('seller-closed', 'RELEASED', 'tx-c1')],
      sellers: [], // closed accounts are scrubbed out of the public picks
    });
    const order = await svc.getOrder('order-1', 'buyer');
    expect(order.sellers[0].username).toBe('A member');
  });
});
