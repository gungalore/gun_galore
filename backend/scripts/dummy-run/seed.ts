/**
 * Idempotent test-data seeding for the dummy run:
 *   - cleanup(): wipes all transactional data (keeps base categories/dealers/
 *     admin) so repeated runs are deterministic.
 *   - installStubs(): neutralises the two OUTBOUND courier-rate calls (the only
 *     external calls on the money happy-paths that can't be a pure no-op) so the
 *     REAL transaction/fee code path still runs offline.
 *   - seedActors(): creates the cast, all KYC-VERIFIED + bank + profile so
 *     payouts aren't skipped.
 *   - makeListing(): a flexible Listing factory.
 */
import type { INestApplicationContext } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PudoService } from '../../src/shipping/pudo.service';
import { TcgService } from '../../src/shipping/tcg.service';
import { Reporter } from './harness';

export interface Actor {
  id: string;
  clerkId: string;
  email: string;
  username: string;
}

export interface Ctx {
  app: INestApplicationContext;
  prisma: PrismaService;
  rep: Reporter;
  actors: Record<string, Actor>;
  cats: {
    normal: string;
    firearm: string;
    experience: string;
    collection: string;
  };
}

const CLERK_PREFIX = 'dr_';

/**
 * Wipe every transactional table (children → parents), leaving the base seed
 * (Category / Dealer / AdminUser / Setting / FeaturedSlotConfig) untouched. The
 * throwaway DB is only ever written by this harness, so a full table wipe is
 * both correct and the most robust form of idempotency.
 */
export async function cleanup(prisma: PrismaService) {
  const p = prisma as any;
  // Order matters: delete rows that hold FKs before the rows they point at.
  const order: string[] = [
    'trackingEvent',
    'orderLineItem',
    'offer',
    'bid',
    'auctionWatch',
    'watchedListing',
    'listingQuestion',
    'contactDetailRejection',
    'rating',
    'message',
    'ticket',
    'postalEntry',
    'raffleWinner',
    'raffleSellerApplication',
    'raffleAuditEvent',
    'featuredSlotBid',
    'featuredSlotAuditEvent',
    'featuredSlotBidderBan',
    'swapProposal',
    'subscriptionCharge',
    'subscription',
    'transaction', // self-refs (refundOf / shipsWith) resolve within one delete
    'featuredAuction',
    'featuredSlot',
    'listing',
    'order',
    'swap',
    'payoutBatch',
    'raffle',
    'notification',
    'pushSubscription',
    'savedSearch',
    'actionToken',
    'askGgUsage',
    'askGgMessage',
    'askGgConversation',
    'askGgKbEntry',
    'rangeEstimate',
    'adminAlert',
    'smsLog',
    'statementUpload',
    'manualPayment',
    'crossSellMiss',
    'address',
    'supportTicketReply',
    'supportTicket',
  ];
  for (const model of order) {
    if (!p[model]?.deleteMany) continue;
    try {
      await p[model].deleteMany({});
    } catch (e) {
      console.warn(`[cleanup] ${model}.deleteMany failed: ${(e as Error).message}`);
    }
  }
  // Finally the cast — scoped to dr_ clerkIds (belt & braces; nothing else
  // creates Users on this DB anyway).
  await p.user.deleteMany({ where: { clerkId: { startsWith: CLERK_PREFIX } } });
}

/**
 * Replace the two live courier-rate calls with deterministic in-memory quotes.
 * Keys are BLANK so the real methods return null (no network), which would dead-
 * end a courier checkout with "parcel too large". This stubs ONLY the external
 * rate lookup — every line of the transaction + fee-calculator code under test
 * still runs. Booking (bookForTransaction) is left as its real fire-and-forget
 * no-op (it self-guards on the blank keys and only logs).
 */
export function installStubs(app: INestApplicationContext) {
  const pudo = app.get(PudoService, { strict: false }) as any;
  const tcg = app.get(TcgService, { strict: false }) as any;
  pudo.quoteL2L = async () => ({
    serviceCode: 'L2LXS-ECO',
    serviceName: 'Locker to Locker XS (stub)',
    priceCents: 6500,
    boxName: 'XS',
  });
  pudo.quoteD2D = async () => ({
    serviceCode: 'D2DM-ECO',
    serviceName: 'Door to Door M (stub)',
    priceCents: 12400,
  });
  tcg.getQuote = async () => ({
    serviceCode: 'ECO',
    serviceName: 'Economy (stub)',
    priceCents: 12400,
    estimatedDays: 3,
  });
}

const BANK = {
  bankName: 'FNB',
  bankBranchCode: '250655',
  bankAccountType: 'cheque',
};

async function upsertUser(
  prisma: PrismaService,
  key: string,
  opts: { topSeller?: boolean; subscriptionTier?: string } = {},
): Promise<Actor> {
  const clerkId = `${CLERK_PREFIX}${key}`;
  const email = `${clerkId}@dummyrun.local`;
  const username = `dr_${key}`;
  const now = new Date();
  const data: any = {
    clerkId,
    email,
    username,
    firstName: key.charAt(0).toUpperCase() + key.slice(1),
    lastName: 'Tester',
    phone: '+27820000000',
    phoneVerified: true,
    kycStatus: 'VERIFIED',
    kycVerifiedAt: now,
    profileCompletedAt: now,
    sellerTier: opts.topSeller ? 'TOP_SELLER' : 'ESTABLISHED',
    subscriptionTier: opts.subscriptionTier ?? 'FREE',
    bankAccountHolder: `${username} Tester`,
    bankAccountNumber: `62${Math.floor(1e9 + Math.random() * 8e9)}`,
    bankVerifiedAt: now,
    ...BANK,
  };
  const user = await (prisma as any).user.upsert({
    where: { clerkId },
    create: data,
    update: data,
  });
  return { id: user.id, clerkId, email, username };
}

export async function seedActors(prisma: PrismaService): Promise<Record<string, Actor>> {
  const actors: Record<string, Actor> = {};
  actors.buyer = await upsertUser(prisma, 'buyer');
  actors.seller = await upsertUser(prisma, 'seller', { topSeller: true }); // exercise TOP_SELLER discount
  actors.seller2 = await upsertUser(prisma, 'seller2'); // 2nd seller for multi-seller cart
  actors.outfitter = await upsertUser(prisma, 'outfitter');
  actors.dealerbuyer = await upsertUser(prisma, 'dealerbuyer');
  actors.bidderA = await upsertUser(prisma, 'bidderA');
  actors.bidderB = await upsertUser(prisma, 'bidderB');
  actors.swapA = await upsertUser(prisma, 'swapA');
  actors.swapB = await upsertUser(prisma, 'swapB');
  actors.member = await upsertUser(prisma, 'member', { subscriptionTier: 'MEMBER' }); // raffle auto-enter + subscription
  return actors;
}

/** Resolve category ids for each behaviour class from the base seed. */
export async function resolveCategories(prisma: PrismaService): Promise<Ctx['cats']> {
  const p = prisma as any;
  const pick = async (where: any, label: string) => {
    const c = await p.category.findFirst({ where });
    if (!c) throw new Error(`No category found for ${label}`);
    return c.id as string;
  };
  return {
    normal: await pick(
      { isFirearm: false, isExperience: false, collectionOnly: false, isActive: true, parentId: { not: null } },
      'normal',
    ),
    firearm: await pick({ isFirearm: true, parentId: { not: null } }, 'firearm'),
    experience: await pick({ isExperience: true }, 'experience'),
    collection: await pick({ collectionOnly: true }, 'collection'),
  };
}

let listingSeq = 0;

/** Flexible Listing factory. Sensible courier-ready defaults; override freely. */
export async function makeListing(
  prisma: PrismaService,
  opts: {
    seller: Actor;
    categoryId: string;
    listingType: 'BUY_NOW' | 'AUCTION' | 'TAKE_A_SHOT' | 'SWOP';
    status?: string;
    price?: number | null;
    isFirearm?: boolean;
    isExperience?: boolean;
    title?: string;
    extra?: Record<string, any>;
  },
): Promise<any> {
  listingSeq += 1;
  const courierReady = !opts.isFirearm && !opts.isExperience;
  const base: any = {
    sellerId: opts.seller.id,
    categoryId: opts.categoryId,
    title: opts.title ?? `Dummy ${opts.listingType} #${listingSeq}`,
    description: `Auto-seeded ${opts.listingType} listing for the dummy run. Item number ${listingSeq}.`,
    listingType: opts.listingType,
    status: opts.status ?? 'ACTIVE',
    condition: 'GOOD',
    province: 'GAUTENG',
    price: opts.price === undefined ? 250_000 : opts.price,
    isFirearm: !!opts.isFirearm,
    isExperience: !!opts.isExperience,
    listedAt: new Date(),
  };
  if (courierReady) {
    Object.assign(base, {
      shippingMethods: ['PUDO', 'TCG'],
      weightGrams: 1500,
      lengthCm: 25,
      widthCm: 20,
      heightCm: 15,
      pickupStreet: '1 Test Road',
      pickupSuburb: 'Central',
      pickupCity: 'Pretoria',
      pickupPostalCode: '0002',
      pickupLat: -25.7461,
      pickupLng: 28.1881,
    });
  }
  if (opts.isFirearm) {
    Object.assign(base, {
      shippingMethods: ['DEALER_TRANSFER'],
      make: 'Test Arms',
      model: 'DR-9',
      serialNumber: `SN${listingSeq}${Date.now() % 100000}`,
      calibre: '9mm',
    });
  }
  Object.assign(base, opts.extra ?? {});
  return (prisma as any).listing.create({ data: base });
}

/** Buyer-side courier delivery address (for TCG checkouts). */
export const DELIVERY_ADDRESS = {
  streetAddress: '99 Buyer Avenue',
  suburb: 'Sunnyside',
  city: 'Pretoria',
  province: 'GAUTENG',
  postalCode: '0002',
  lat: -25.7545,
  lng: 28.19,
};
