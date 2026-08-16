// M33 — the firearm 18+/SAPS-competency attestation is statutory evidence, so
// it has to survive on the Transaction row, not only in the application log.
// These cases lock the column to the gate: attested firearm → timestamp,
// non-firearm → null (not applicable), no attestation → no row at all.
//
// Exercised through reserveAndCreateLine rather than create(), because create()
// calls assertPaymentsLive() first and PAYMENTS_LIVE is false — the same reason
// the sibling experience-checkout suite is skipped. The reserve-and-create core
// is where the stamp is written and is shared by single-item and cart checkout.
//
// TransactionsService transitively imports modules that pull ESM-only
// meilisearch; stub it so ts-jest doesn't choke (same as the sibling specs).
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { BadRequestException } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { FeeCalculator } from './fee.calculator';
import { CreateTransactionDto } from './dto/create-transaction.dto';

function makeListing(over: Record<string, unknown> = {}) {
  return {
    id: 'L1',
    sellerId: 'S1',
    listingType: 'BUY_NOW',
    status: 'ACTIVE',
    isFirearm: true,
    collectionOnly: false,
    requiresPapers: false,
    isExperience: false,
    isDealListing: false,
    price: 1_500_000, // R15,000
    currentBid: null,
    currentBidderId: null,
    endedAt: null,
    expiresAt: null,
    trackInventory: false,
    quantityAvailable: 1,
    quantityReserved: 0,
    passFeeToBuyer: true,
    shippingMethods: [], // empty = any legal method for this class
    seller: { sellerTier: 'STANDARD', kycStatus: 'VERIFIED' },
    ...over,
  };
}

function makeService(listing: Record<string, unknown>) {
  const created: { data: Record<string, unknown> } = { data: {} };
  const prisma = {
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'B1', isBanned: false, email: 'b@x.co', username: 'buyer' }),
    },
    listing: {
      findUnique: jest.fn().mockResolvedValue(listing),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }), // reserve CAS succeeds
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
  // Only the non-firearm case reaches the quote — a dealer transfer has no
  // courier rate and skips the call entirely.
  const shipping = {
    quoteForListing: jest
      .fn()
      .mockResolvedValue({ priceCents: 5_000, serviceCode: 'PUDO_L2L' }),
  };

  const service = new TransactionsService(
    prisma as never,
    new FeeCalculator() as never, // real fee calc
    {} as never, // notifications
    {} as never, // peach
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
  // reserveAndCreateLine is private; the checkout callers are the only public
  // way in and they sit behind the payments-live gate.
  const reserve = (dto: CreateTransactionDto) =>
    (
      service as unknown as {
        reserveAndCreateLine: (c: string, d: CreateTransactionDto) => Promise<unknown>;
      }
    ).reserveAndCreateLine('clerk_b', dto);

  return { service, prisma, reserve, created };
}

function firearmDto(over: Partial<CreateTransactionDto> = {}): CreateTransactionDto {
  return {
    listingId: 'L1',
    shippingMethod: 'DEALER_TRANSFER',
    firearmAttestation18Plus: true,
    // Unconditional on every checkout — see the gate in reserveAndCreateLine.
    // This fixture is about the FIREARM attestation, so the location
    // acknowledgement is just table stakes for reaching that code.
    buyerTermsAccepted: true,
    ...over,
  } as CreateTransactionDto;
}

describe('M33 firearm attestation evidence', () => {
  it('stamps firearmAttestationAcceptedAt on an attested firearm checkout', async () => {
    const { reserve, created } = makeService(makeListing());

    await reserve(firearmDto());

    expect(created.data.firearmAttestationAcceptedAt).toBeInstanceOf(Date);
  });

  it('leaves the stamp null on a non-firearm checkout even if the flag is sent', async () => {
    // NULL here means "not applicable", not "not attested" — the gate only
    // applies to firearms, so a courier item must never look like it carries
    // firearm evidence.
    const { reserve, created } = makeService(
      makeListing({ isFirearm: false, shippingMethods: [] }),
    );

    await reserve(
      firearmDto({ shippingMethod: 'PUDO', pudoPickupLockerId: 'LCK1' }),
    );

    expect(created.data.firearmAttestationAcceptedAt).toBeNull();
  });

  it('creates no transaction at all when a firearm checkout omits the attestation', async () => {
    // The hard gate fires before the reserve, so there is no row to stamp and
    // no orphaned hold on the listing.
    const { reserve, prisma } = makeService(makeListing());

    await expect(
      reserve(firearmDto({ firearmAttestation18Plus: undefined })),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.listing.updateMany).not.toHaveBeenCalled();
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });
});
