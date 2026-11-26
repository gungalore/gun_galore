// ⚠️ 2026-11 MARKETPLACE audit — accepted-offer CHECKOUT tokens.
//
// An accepted offer's "Pay now" link is a credential: the buyer may open it
// signed out, so /a/<token> must resolve the offer without a session and hand
// the checkout page a token-scoped offer+listing read. These tests pin the
// exact contract the frontend codes against.
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ActionTokensController } from './action-tokens.controller';

const FUTURE = new Date(Date.now() + 6 * 3_600_000);
const OFFER_EXPIRY = new Date(Date.now() + 3 * 3_600_000);

function token(over: Record<string, unknown> = {}) {
  return {
    id: 'T1',
    token: 'tok',
    purpose: 'CHECKOUT',
    targetType: 'offer',
    targetId: 'O1',
    authorisedUserId: 'B1',
    expiresAt: FUTURE,
    metadata: null,
    ...over,
  };
}

function offerRow(over: Record<string, unknown> = {}) {
  return {
    id: 'O1',
    status: 'ACCEPTED',
    offerAmount: 9_000,
    counterAmount: null,
    buyerId: 'B1',
    listingId: 'L1',
    expiresAt: OFFER_EXPIRY,
    listing: {
      id: 'L1',
      title: 'Lee-Enfield scope',
      price: 10_000,
      referenceNumber: 'GG-1001',
      status: 'PAYMENT_PENDING',
      images: [{ url: 'https://img.test/primary.jpg' }],
    },
    ...over,
  };
}

function makeController(over: {
  resolved?: Record<string, unknown>;
  offer?: Record<string, unknown> | null;
  listing?: Record<string, unknown> | null;
  listingRow?: Record<string, unknown> | null;
} = {}) {
  const tokens = {
    resolve: jest.fn().mockResolvedValue(token(over.resolved)),
    markInvalid: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'B1',
        username: 'buyer',
        firstName: 'Sam',
      }),
    },
    offer: {
      findUnique: jest
        .fn()
        .mockResolvedValue(over.offer === undefined ? offerRow() : over.offer),
    },
    listing: {
      findUnique: jest.fn().mockResolvedValue(
        over.listingRow === undefined
          ? {
              id: 'L1',
              title: 'Auction item',
              price: 50_000,
              referenceNumber: 'GG-2002',
              status: 'PAYMENT_PENDING',
              images: [],
            }
          : over.listingRow,
      ),
    },
  };
  const listings = {
    findById: jest.fn().mockResolvedValue(
      over.listing === undefined
        ? { id: 'L1', title: 'Lee-Enfield scope', listingType: 'BUY_NOW', seller: { username: 'seller' } }
        : over.listing,
    ),
  };
  const controller = new ActionTokensController(
    prisma as never,
    tokens as never,
    {} as never, // offers
    {} as never, // auctions
    {} as never, // transactions
    listings as never,
  );
  return { controller, prisma, tokens, listings };
}

describe('GET /actions/:token — CHECKOUT on an accepted offer', () => {
  it('resolves the offer + listing and redirects to the offer checkout with the token', async () => {
    const { controller } = makeController();

    const payload = await controller.resolve('tok');

    expect(payload).toEqual({
      kind: 'CHECKOUT',
      expiresAt: FUTURE.toISOString(),
      greeting: 'Sam',
      redirectTo: '/checkout/offer/O1?t=tok',
      listing: {
        id: 'L1',
        title: 'Lee-Enfield scope',
        listPrice: 10_000,
        reference: 'GG-1001',
        primaryImageUrl: 'https://img.test/primary.jpg',
        status: 'PAYMENT_PENDING',
      },
      offer: {
        id: 'O1',
        amount: 9_000,
        counterAmount: null,
        expiresAt: OFFER_EXPIRY.toISOString(),
        status: 'ACCEPTED',
      },
    });
  });

  it('404s on an offer that no longer exists', async () => {
    const { controller } = makeController({ offer: null });

    await expect(controller.resolve('tok')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('keeps the existing LISTING checkout behaviour untouched', async () => {
    const { controller, listings } = makeController({
      resolved: { targetType: 'listing', targetId: 'L1' },
    });

    const payload = await controller.resolve('tok');

    expect(payload).toMatchObject({
      kind: 'CHECKOUT',
      redirectTo: '/checkout/L1?t=tok',
      listing: { id: 'L1', listPrice: 50_000 },
    });
    expect(payload).not.toHaveProperty('offer');
    expect(listings.findById).not.toHaveBeenCalled();
  });
});

describe('GET /actions/:token/offer-checkout', () => {
  it('returns the offer snapshot + public listing projection without consuming the token', async () => {
    const { controller, listings, tokens } = makeController();

    const res = await controller.offerCheckout('tok');

    // The mocked Prisma row carries the listing relation too; the contract
    // fields are the subset selected by the endpoint.
    expect(res.offer).toMatchObject({
      id: 'O1',
      status: 'ACCEPTED',
      offerAmount: 9_000,
      counterAmount: null,
      expiresAt: OFFER_EXPIRY,
      buyerId: 'B1',
      listingId: 'L1',
    });
    // Public projection: findById is called without a userId (no owner extras).
    expect(listings.findById).toHaveBeenCalledWith('L1');
    // A read must never burn the only pay link the buyer has.
    expect(tokens).not.toHaveProperty('consume');
  });

  it('rejects a token whose buyer no longer matches the offer (404, no existence leak)', async () => {
    const { controller } = makeController({
      offer: offerRow({ buyerId: 'SOMEONE-ELSE' }),
    });

    await expect(controller.offerCheckout('tok')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects a non-CHECKOUT token as a 403 and counts the invalid attempt', async () => {
    const { controller, tokens } = makeController({
      resolved: { purpose: 'OFFER_DECISION' },
    });

    await expect(controller.offerCheckout('tok')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tokens.markInvalid).toHaveBeenCalledWith('tok');
  });

  it('404s when the listing is gone or not publicly visible', async () => {
    const { controller } = makeController({ listing: null });

    await expect(controller.offerCheckout('tok')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
