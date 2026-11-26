// Auction pricing rules (operator 2026-11):
//   • the seller sets ONLY the reserve — the starting bid is always DERIVED as
//     floor(reserve × 0.7), and a client-supplied auction `price` is ignored;
//   • a new auction requires a reserve (no-reserve auctions are retired);
//   • the reserve gates the allowed duration band (3/5/7/14-day floors), and a
//     larger reserve may choose any SHORTER duration;
//   • the derived opening bid is fixed after publish — a PATCH trying to change
//     it is rejected.
//
// The two rules themselves are exported pure helpers so they can be pinned
// without a full create() harness; the harness below then proves the create()
// and update() paths actually use them.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

// class-validator/class-transformer decorators need the metadata polyfill.
import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { FeeCalculator } from '../payments/fee.calculator';
import { CreateListingDto } from './dto/create-listing.dto';
import {
  AUCTION_MIN_VALUE_CENTS,
  ListingsService,
  auctionReserveMeetsDurationFloor,
  deriveAuctionStartingBidCents,
} from './listings.service';

// ═══════════════════════════════════════════════════════════════════════
// The rules, pinned directly.
// ═══════════════════════════════════════════════════════════════════════

describe('deriveAuctionStartingBidCents', () => {
  it.each([
    [250_000, 175_000], // 3-day floor → R1,750 opening bid
    [300_000, 210_000],
    [333_333, 233_333], // floors the fractional cent
    [1_000_000, 700_000], // 14-day floor → R7,000 opening bid
    [100, 70],
  ])(
    'derives 70%% of a %i-cent reserve → %i cents',
    (reserveCents, expectedCents) => {
      expect(deriveAuctionStartingBidCents(reserveCents)).toBe(expectedCents);
    },
  );

  it('always opens strictly below the reserve and above zero', () => {
    for (const reserveCents of [100, 250_000, 333_333, 1_000_000]) {
      const startingBid = deriveAuctionStartingBidCents(reserveCents);
      expect(startingBid).toBeGreaterThan(0);
      expect(startingBid).toBeLessThan(reserveCents);
    }
  });
});

describe('auctionReserveMeetsDurationFloor', () => {
  it.each([3, 5, 7, 14])(
    'enforces the %i-day floor exactly (the floor passes, one cent under fails)',
    (durationDays) => {
      const floorCents = AUCTION_MIN_VALUE_CENTS[durationDays];
      expect(auctionReserveMeetsDurationFloor(floorCents, durationDays)).toBe(
        true,
      );
      expect(
        auctionReserveMeetsDurationFloor(floorCents - 1, durationDays),
      ).toBe(false);
    },
  );

  it('lets a larger reserve choose any shorter duration', () => {
    for (const durationDays of [3, 5, 7, 14]) {
      expect(auctionReserveMeetsDurationFloor(1_000_000, durationDays)).toBe(
        true,
      );
    }
  });

  it('does not let the R2,500 reserve buy a longer run', () => {
    expect(auctionReserveMeetsDurationFloor(250_000, 3)).toBe(true);
    expect(auctionReserveMeetsDurationFloor(250_000, 5)).toBe(false);
    expect(auctionReserveMeetsDurationFloor(250_000, 7)).toBe(false);
    expect(auctionReserveMeetsDurationFloor(250_000, 14)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// The create/update paths. Light positional mocks in the pattern the other
// listings specs use; only the fields these paths reach are real.
// ═══════════════════════════════════════════════════════════════════════

const CATEGORY = {
  id: 'cat-reload',
  slug: 'reloading-components',
  name: 'Reloading Components',
  parent: null,
  parentId: null,
  isActive: true,
  availableSecondhand: true,
  isFirearm: false,
  collectionOnly: false,
  requiresPapers: false,
  showTestedWorkingAttestation: false,
  publicVisible: true,
};

// A live 14-day auction with the R10,000 floor reserve: opening bid R7,000.
const AUCTION_LISTING = {
  id: 'L-auction',
  sellerId: 'u1',
  categoryId: 'cat-reload',
  status: 'ACTIVE',
  listingType: 'AUCTION',
  bidCount: 0,
  acceptsOffers: true,
  title: 'Leupold VX-3i 4.5-14x40 scope',
  description: 'Boxed, excellent condition, includes original mounts.',
  isFirearm: false,
  collectionOnly: false,
  isDealListing: false,
  publicVisible: true,
  price: 700_000,
  reservePrice: 1_000_000,
  durationDays: 14,
  compareAtPriceZarCents: null,
  declaredValueCents: null,
  autoAcceptThreshold: null,
  autoDeclineThreshold: null,
  privateArrangeConsentAt: null,
  priceDropNotifiedAt: null,
  province: 'Gauteng',
  pickupProvince: 'Gauteng',
  pickupCity: 'Pretoria',
  pickupSuburb: null,
  pickupPostalCode: '0002',
  pickupLat: null,
  pickupLng: null,
  attributes: null,
  make: null,
  model: null,
  calibre: null,
  serialNumber: null,
  serialPhotoUrl: null,
  licencePhotoUrl: null,
  shippingMethods: [],
  listedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeHarness() {
  // What the service asked Prisma to persist — typed as unknown so the
  // assertions stay lint-clean while pinning the exact stored numbers.
  const captured: {
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  } = { create: {}, update: {} };
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'u1',
        userId: 'user_1',
        isBanned: false,
        sellingBannedAt: null,
        accountClosedAt: null,
        firstName: 'Ada',
        lastName: 'Botha',
        phone: '+27821234567',
        phoneVerified: true,
        email: 'ada@example.com',
        emailVerifiedAt: new Date(),
      }),
    },
    category: { findUnique: jest.fn().mockResolvedValue(CATEGORY) },
    listing: {
      findUnique: jest.fn().mockResolvedValue(AUCTION_LISTING),
      create: jest.fn(),
      update: jest.fn(),
    },
    offer: { findFirst: jest.fn().mockResolvedValue(null) },
    checkoutHold: { count: jest.fn().mockResolvedValue(0) },
    transaction: { count: jest.fn().mockResolvedValue(0) },
  };
  prisma.listing.create.mockImplementation(
    (args: { data: Record<string, unknown> }) => {
      captured.create = args.data;
      return Promise.resolve({
        id: 'L-new',
        ...args.data,
        images: [],
        category: CATEGORY,
      });
    },
  );
  prisma.listing.update.mockImplementation(
    (args: { data: Record<string, unknown> }) => {
      captured.update = args.data;
      return Promise.resolve({
        ...AUCTION_LISTING,
        ...args.data,
        images: [],
        category: CATEGORY,
      });
    },
  );

  const settings = {
    get: jest.fn().mockImplementation((flag: { key?: string }) => {
      if (flag?.key === 'dg_lithium_wh_threshold') return Promise.resolve(100);
      // claude_moderation_enabled (and every other flag) is off.
      return Promise.resolve(false);
    }),
  };
  const search = {
    isConnected: false,
    addDocuments: jest.fn().mockResolvedValue(undefined),
    deleteDocument: jest.fn().mockResolvedValue(undefined),
  };
  const moderation = {
    isEnabled: false,
    moderate: jest.fn(),
    stripContactInfo: jest.fn((s: string) => ({ cleaned: s })),
  };

  const service = new ListingsService(
    prisma as never,
    search as never,
    {} as never, // cloudinary
    moderation as never,
    settings as never,
    { allocateForListing: jest.fn().mockResolvedValue('AU-000001') } as never,
    {} as never, // firearmLicence — not a firearm category
    { getEffectiveAttributes: jest.fn().mockResolvedValue([]) } as never,
    { notifyPriceDrop: jest.fn().mockResolvedValue(undefined) } as never,
    { record: jest.fn() } as never, // activity
    new FeeCalculator(),
    { resolveByEntity: jest.fn() } as never, // notifications
    { offerAtListingLive: jest.fn().mockResolvedValue(undefined) } as never, // kyc
  );
  return { service, prisma, search, settings, captured };
}

const AUCTION_DRAFT = {
  categoryId: 'cat-reload',
  listingType: 'AUCTION',
  title: 'Leupold VX-3i 4.5-14x40 scope',
  description: 'Boxed, excellent condition, includes original mounts.',
  condition: 'USED_GOOD',
  province: 'Gauteng',
  pickupStreet: '12 Test Street',
  pickupCity: 'Pretoria',
  pickupPostalCode: '0002',
  passFeeToBuyer: false,
  reservePrice: 250_000,
  durationDays: 3,
  imageCount: 1,
};

describe('create — auction reserve rules', () => {
  it('requires a reserve on a new auction (no-reserve auctions are retired)', async () => {
    const { service } = makeHarness();
    await expect(
      service.create('user_1', {
        ...AUCTION_DRAFT,
        reservePrice: undefined,
        price: 150_000, // an old client's starting bid does not stand in for one
      } as never),
    ).rejects.toThrow('Set a reserve price for the auction.');
  });

  it('derives the opening bid at 30% below the reserve and ignores the client price', async () => {
    const { service, captured } = makeHarness();
    const listing = await service.create('user_1', {
      ...AUCTION_DRAFT,
      reservePrice: 250_000,
      price: 999_999, // never trusted
    } as never);

    expect(listing.price).toBe(175_000);
    expect(captured.create.price).toBe(175_000);
    expect(captured.create.reservePrice).toBe(250_000);
    expect(captured.create.durationDays).toBe(3);
  });

  it('accepts an auction with no price at all — the opening bid is derived', async () => {
    const { service } = makeHarness();
    const listing = await service.create('user_1', {
      ...AUCTION_DRAFT,
    } as never);
    expect(listing.price).toBe(175_000);
  });

  it('rejects a reserve below the duration floor', async () => {
    const { service } = makeHarness();
    await expect(
      service.create('user_1', {
        ...AUCTION_DRAFT,
        reservePrice: 249_999,
        durationDays: 3,
      } as never),
    ).rejects.toThrow('A 3-day auction needs a reserve of at least R2,500.');

    await expect(
      service.create('user_1', {
        ...AUCTION_DRAFT,
        reservePrice: 999_999,
        durationDays: 14,
      } as never),
    ).rejects.toThrow('A 14-day auction needs a reserve of at least R10,000.');
  });

  it('lets a larger reserve choose a shorter duration', async () => {
    const { service, captured } = makeHarness();
    const listing = await service.create('user_1', {
      ...AUCTION_DRAFT,
      reservePrice: 1_000_000,
      durationDays: 3,
    } as never);

    expect(listing.price).toBe(700_000);
    expect(captured.create.durationDays).toBe(3);
  });

  it('still rejects the retired buyNowPrice on an auction', async () => {
    const { service } = makeHarness();
    await expect(
      service.create('user_1', {
        ...AUCTION_DRAFT,
        buyNowPrice: 300_000,
      } as never),
    ).rejects.toThrow(/Marketplace is not available on auctions/);
  });

  it('requires a price on a Marketplace listing', async () => {
    const { service } = makeHarness();
    await expect(
      service.create('user_1', {
        ...AUCTION_DRAFT,
        listingType: 'BUY_NOW',
        price: undefined,
        reservePrice: undefined,
        durationDays: undefined,
      } as never),
    ).rejects.toThrow('Price is required for Marketplace listings');
  });
});

describe('previewDraft — auction pricing', () => {
  it('previews an auction with no client price', async () => {
    const { service } = makeHarness();
    const result = await service.previewDraft('user_1', {
      ...AUCTION_DRAFT,
    } as never);
    expect(result.canPublish).toBe(true);
  });

  it('still requires a price for a Marketplace preview', async () => {
    const { service } = makeHarness();
    await expect(
      service.previewDraft('user_1', {
        ...AUCTION_DRAFT,
        listingType: 'BUY_NOW',
        reservePrice: undefined,
        durationDays: undefined,
      } as never),
    ).rejects.toThrow('Price is required for Marketplace listings');
  });
});

describe('update — the derived opening bid is fixed after publish', () => {
  it('rejects an auction price edit', async () => {
    const { service } = makeHarness();
    await expect(
      service.update('L-auction', 'user_1', { price: 800_000 }),
    ).rejects.toThrow(
      'The opening bid is set automatically at 30% below your reserve and cannot be edited — cancel and relist to change it.',
    );
  });

  it('allows a verbatim resubmission of the derived price (full-form PATCH)', async () => {
    const { service, prisma } = makeHarness();
    const updated = await service.update('L-auction', 'user_1', {
      price: AUCTION_LISTING.price,
    });
    expect(prisma.listing.update).toHaveBeenCalledTimes(1);
    expect(updated.price).toBe(AUCTION_LISTING.price);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// DTO layer — a price is required on BUY_NOW only.
// ═══════════════════════════════════════════════════════════════════════

describe('CreateListingDto — price field', () => {
  const baseDto = {
    categoryId: 'cat-reload',
    listingType: 'AUCTION',
    title: 'Leupold VX-3i 4.5-14x40 scope',
    description: 'Boxed, excellent condition, includes original mounts.',
    condition: 'GOOD',
    province: 'GAUTENG',
    passFeeToBuyer: false,
    imageCount: 1,
  };

  const priceErrors = async (payload: object) => {
    const errors = await validate(plainToInstance(CreateListingDto, payload));
    return errors.filter((e) => e.property === 'price');
  };

  it('does not require a price on an auction', async () => {
    expect(await priceErrors(baseDto)).toHaveLength(0);
  });

  it('requires a price on a Marketplace listing', async () => {
    expect(
      await priceErrors({ ...baseDto, listingType: 'BUY_NOW' }),
    ).toHaveLength(1);
  });

  it('still type-checks an auction price a legacy client sends', async () => {
    expect(
      await priceErrors({ ...baseDto, price: 'not-a-number' }),
    ).toHaveLength(1);
    expect(await priceErrors({ ...baseDto, price: 999_999 })).toHaveLength(0);
  });

  it('type-checks a price on an update-style partial payload', async () => {
    const partial = plainToInstance(CreateListingDto, {
      price: 'not-a-number',
    });
    const errors = await validate(partial, { skipMissingProperties: true });
    expect(errors.map((e) => e.property)).toContain('price');
  });
});
