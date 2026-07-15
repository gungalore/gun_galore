// `meilisearch` ships ESM that ts-jest won't transform; SearchService (pulled
// in transitively) only needs the symbol to exist for these unit tests.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { NotFoundException } from '@nestjs/common';
import { ListingsService, PUBLIC_LISTING_SELECT } from './listings.service';

/**
 * Unit tests for the browse filter wiring + brand facet added in Phase 1.
 * We instantiate the service with light mocks (only Prisma + Search matter
 * for these paths) and drive the public `browse` / `listBrands` methods.
 * With search disconnected, `browse` routes through the Prisma path so we
 * can assert the exact `where` clause it builds.
 */
describe('ListingsService — browse filters & brand facet', () => {
  let prisma: {
    listing: {
      findMany: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
    };
  };
  let service: ListingsService;

  beforeEach(() => {
    prisma = {
      listing: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn(),
      },
    };
    const search = { isConnected: false };
    service = new ListingsService(
      prisma as never,
      search as never,
      {} as never, // cloudinary
      {} as never, // moderation
      {} as never, // settings
      {} as never, // referenceNumbers
      {} as never, // firearmLicence
      {} as never, // categories
      {} as never, // wishlistAlerts (P5.2)
    );
  });

  it('passes the make filter into the Prisma where clause', async () => {
    await service.browse({ make: 'Glock' } as never);
    expect(prisma.listing.findMany).toHaveBeenCalledTimes(1);
    const arg = prisma.listing.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ status: 'ACTIVE', make: 'Glock' });
  });

  it('combines make with a price range', async () => {
    await service.browse({
      make: 'CZ',
      minPrice: 100000,
      maxPrice: 500000,
    } as never);
    const arg = prisma.listing.findMany.mock.calls[0][0];
    expect(arg.where.make).toBe('CZ');
    expect(arg.where.price).toEqual({ gte: 100000, lte: 500000 });
  });

  it('omits make from the where clause when not supplied', async () => {
    await service.browse({} as never);
    const arg = prisma.listing.findMany.mock.calls[0][0];
    expect(arg.where.make).toBeUndefined();
    expect(arg.where).toMatchObject({ status: 'ACTIVE' });
  });

  it('listBrands returns distinct makes (most-listed first), dropping blanks/null', async () => {
    prisma.listing.groupBy.mockResolvedValue([
      { make: 'Glock', _count: { make: 9 } },
      { make: 'CZ', _count: { make: 5 } },
      { make: '   ', _count: { make: 2 } },
      { make: null, _count: { make: 1 } },
    ]);
    const brands = await service.listBrands();
    expect(brands).toEqual(['Glock', 'CZ']);
    const arg = prisma.listing.groupBy.mock.calls[0][0];
    expect(arg.where).toMatchObject({ status: 'ACTIVE' });
    expect(arg.orderBy).toEqual({ _count: { make: 'desc' } });
  });
});

/**
 * Regression guard for the public listing-detail leak (2026-07): the
 * unauthenticated GET /listings/:id must not hand out the seller's hidden
 * reserve / auto-accept threshold, the current bidder, the firearm serial +
 * licence-holder real name, the pickup address, or the admin/model moderation
 * internals. The seller (identified by a Clerk token) still gets the fields
 * their edit form + moderation banner need.
 */
describe('ListingsService — findById projection & owner-awareness', () => {
  let prisma: { listing: { findUnique: jest.Mock } };
  let service: ListingsService;

  // Only the fields the service actually reads matter here; the mock stands in
  // for whatever the (allow-listed) select would return.
  const publicRow = (over: Record<string, unknown> = {}) => ({
    id: 'l1',
    status: 'ACTIVE',
    title: 'Test listing',
    seller: { clerkId: 'seller_1' },
    ...over,
  });

  beforeEach(() => {
    prisma = { listing: { findUnique: jest.fn() } };
    service = new ListingsService(
      prisma as never,
      { isConnected: false } as never, // search
      {} as never, // cloudinary
      {} as never, // moderation
      {} as never, // settings
      {} as never, // referenceNumbers
      {} as never, // firearmLicence
      {} as never, // categories
      {} as never, // wishlistAlerts
    );
  });

  it('the public allowlist never selects hidden/private columns', () => {
    const sel = PUBLIC_LISTING_SELECT as Record<string, unknown>;
    for (const forbidden of [
      'reservePrice',
      'autoAcceptThreshold',
      'currentBidderId',
      'serialNumber',
      'serialPhotoUrl',
      'licencePhotoUrl',
      'licenceHolderName',
      'firearmType',
      'pickupStreet',
      'pickupCity',
      'pickupLat',
      'pickupLng',
      'adminOverrideReason',
      'claudeConfidence',
      'claudeReasons',
      'claudeDecision',
      'claudeOriginalDescription',
      'supplierInsuranceUrl',
      'supplierRegistrationDocUrl',
      'priceDropNotifiedAt',
    ]) {
      expect(sel[forbidden]).toBeUndefined();
    }
    // …but it DOES expose the safe derived signal + public price fields.
    expect(sel.reserveMet).toBe(true);
    expect(sel.currentBid).toBe(true);
    expect(sel.price).toBe(true);
  });

  it('serves an anonymous caller the public projection and no reservePrice', async () => {
    prisma.listing.findUnique.mockResolvedValueOnce(publicRow());

    const result = await service.findById('l1');

    expect(prisma.listing.findUnique).toHaveBeenCalledTimes(1);
    const call = prisma.listing.findUnique.mock.calls[0][0];
    // The single query uses the shared public allowlist by reference.
    expect(call.select).toBe(PUBLIC_LISTING_SELECT);
    expect(Object.prototype.hasOwnProperty.call(result, 'reservePrice')).toBe(
      false,
    );
  });

  it('adds the owner-only fields for the seller viewing their own listing', async () => {
    prisma.listing.findUnique
      .mockResolvedValueOnce(publicRow())
      .mockResolvedValueOnce({
        reservePrice: 500000,
        autoAcceptThreshold: null,
        claudeDecision: 'APPROVE',
        claudeReasons: [],
        claudeAutoFixApplied: false,
      });

    const result = (await service.findById('l1', 'seller_1')) as {
      reservePrice?: number;
    };

    expect(prisma.listing.findUnique).toHaveBeenCalledTimes(2);
    const extrasSelect = prisma.listing.findUnique.mock.calls[1][0].select;
    expect(extrasSelect.reservePrice).toBe(true);
    expect(extrasSelect.autoAcceptThreshold).toBe(true);
    expect(extrasSelect.claudeReasons).toBe(true);
    expect(result.reservePrice).toBe(500000);
  });

  it('does NOT add owner fields for a signed-in NON-owner', async () => {
    prisma.listing.findUnique.mockResolvedValueOnce(publicRow());

    const result = await service.findById('l1', 'some_other_user');

    expect(prisma.listing.findUnique).toHaveBeenCalledTimes(1); // no extras query
    expect(Object.prototype.hasOwnProperty.call(result, 'reservePrice')).toBe(
      false,
    );
  });

  it('404s a non-public status (PENDING_REVIEW) for a non-owner', async () => {
    prisma.listing.findUnique.mockResolvedValueOnce(
      publicRow({ status: 'PENDING_REVIEW' }),
    );

    await expect(service.findById('l1', 'some_other_user')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lets the owner view their own non-public (PENDING_REVIEW) listing', async () => {
    prisma.listing.findUnique
      .mockResolvedValueOnce(publicRow({ status: 'PENDING_REVIEW' }))
      .mockResolvedValueOnce({
        reservePrice: null,
        autoAcceptThreshold: null,
        claudeDecision: 'HUMAN_REVIEW',
        claudeReasons: ['flagged for review'],
        claudeAutoFixApplied: false,
      });

    const result = (await service.findById('l1', 'seller_1')) as {
      status: string;
      claudeReasons?: string[];
    };

    expect(result.status).toBe('PENDING_REVIEW');
    expect(result.claudeReasons).toEqual(['flagged for review']);
  });

  it('404s a missing listing', async () => {
    prisma.listing.findUnique.mockResolvedValueOnce(null);
    await expect(service.findById('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
