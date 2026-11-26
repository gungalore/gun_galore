// The buyer's courier delivery instructions must reach Bob Go's delivery label
// (and nowhere else): persisted sanitised + capped at checkout, then forwarded
// as `instructions_delivery` at booking. Non-courier sales must never carry it.
//
// Exercised through reserveAndCreateLine (the shared single-item / cart / order
// seam) and the exported sanitiser, rather than create(), which sits behind the
// payments-live gate — same convention as the sibling firearm-attestation suite.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { TransactionsService, sanitizeDeliveryInstructions } from './transactions.service';
import { FeeCalculator } from './fee.calculator';
import { CreateTransactionDto } from './dto/create-transaction.dto';

const ADDRESS = {
  streetAddress: '1 Main Road',
  suburb: 'Milpark',
  city: 'Johannesburg',
  postalCode: '2092',
  province: 'GAUTENG',
  lat: -26.18,
  lng: 28.01,
};

function makeListing(over: Record<string, unknown> = {}) {
  return {
    id: 'L1',
    sellerId: 'S1',
    listingType: 'BUY_NOW',
    status: 'ACTIVE',
    isFirearm: false,
    collectionOnly: false,
    requiresPapers: false,
    isExperience: false,
    isDealListing: false,
    price: 1_500_000,
    currentBid: null,
    currentBidderId: null,
    endedAt: null,
    expiresAt: null,
    trackInventory: false,
    quantityAvailable: 1,
    quantityReserved: 0,
    passFeeToBuyer: true,
    shippingMethods: [],
    seller: { sellerTier: 'STANDARD', kycStatus: 'VERIFIED' },
    ...over,
  };
}

function makeService(listing: Record<string, unknown> = makeListing()) {
  const created: { data: Record<string, unknown> } = { data: {} };
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'B1',
        isBanned: false,
        email: 'b@x.co',
        username: 'buyer',
        phone: '+27821234567',
        phoneVerified: true,
        emailVerifiedAt: new Date(),
      }),
    },
    listing: {
      findUnique: jest.fn().mockResolvedValue(listing),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    transaction: {
      create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
        created.data = args.data;
        return Promise.resolve({ id: 'TX1', ...args.data });
      }),
    },
  };
  const kyc = {
    triggerSellerVerification: jest.fn().mockResolvedValue(undefined),
    maybeUpgradeKycTier: jest.fn().mockResolvedValue(undefined),
  };
  const shipping = {
    quoteForSelection: jest.fn().mockResolvedValue({
      priceCents: 5_000,
      serviceCode: 'bobgo_door',
      providerSlug: 'sandbox',
      serviceLevelCode: 'ECO',
    }),
  };

  const service = new TransactionsService(
    prisma as never,
    new FeeCalculator() as never,
    {} as never, // notifications
    {} as never, // ozow
    kyc as never,
    shipping as never,
    {} as never, // tracking
    {} as never, // tokens
    {} as never, // referenceNumbers
    {} as never, // fraudRisk
    {} as never, // cloudinary
    {} as never, // zohoBooks
    {} as never, // wishlistAlerts
    {} as never, // saps534
  );
  const reserve = (dto: CreateTransactionDto) =>
    (
      service as unknown as {
        reserveAndCreateLine: (
          c: string,
          d: CreateTransactionDto,
        ) => Promise<unknown>;
      }
    ).reserveAndCreateLine('user_b', dto);

  return { reserve, created };
}

function courierDto(
  over: Partial<CreateTransactionDto> = {},
): CreateTransactionDto {
  return {
    listingId: 'L1',
    shippingMethod: 'COURIER',
    buyerTermsAccepted: true,
    deliveryAddress: ADDRESS,
    ...over,
  } as CreateTransactionDto;
}

describe('sanitizeDeliveryInstructions', () => {
  it('trims, collapses control characters/newlines, and empties to null', () => {
    expect(sanitizeDeliveryInstructions('  Gate code 1234 \n', 'COURIER')).toBe(
      'Gate code 1234',
    );
    expect(
      sanitizeDeliveryInstructions('Leave at reception\r\n\tCall first', 'COURIER'),
    ).toBe('Leave at reception Call first');
    expect(sanitizeDeliveryInstructions('   \n\t ', 'COURIER')).toBeNull();
    expect(sanitizeDeliveryInstructions(undefined, 'COURIER')).toBeNull();
    expect(sanitizeDeliveryInstructions('x', 'DEALER_TRANSFER')).toBeNull();
  });

  it('caps at 120 characters', () => {
    const out = sanitizeDeliveryInstructions('x'.repeat(500), 'COURIER');
    expect(out).toHaveLength(120);
  });
});

describe('TransactionsService — courier delivery instructions', () => {
  it('persists sanitised instructions on a courier checkout', async () => {
    const { reserve, created } = makeService();

    await reserve(
      courierDto({ deliveryInstructions: '  Leave with security\n at gate  ' }),
    );

    expect(created.data.deliveryInstructions).toBe('Leave with security at gate');
  });

  it('caps an over-long value at 120 characters before it reaches the column', async () => {
    const { reserve, created } = makeService();

    await reserve(courierDto({ deliveryInstructions: 'y'.repeat(200) }));

    expect(created.data.deliveryInstructions).toHaveLength(120);
  });

  it('stores null for a non-courier sale even when the client sends a value', async () => {
    const { reserve, created } = makeService(makeListing({ isFirearm: true }));

    await reserve({
      listingId: 'L1',
      shippingMethod: 'DEALER_TRANSFER',
      firearmAttestation18Plus: true,
      buyerTermsAccepted: true,
      deliveryInstructions: 'Ignore me — there is no label',
    } as CreateTransactionDto);

    expect(created.data.deliveryInstructions).toBeNull();
  });
});
