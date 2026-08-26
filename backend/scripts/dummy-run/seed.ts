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

/**
 * DD-F5 — the args captured from a stubbed TcgService.createShipment() call.
 * Loosely typed (only `from` is asserted on) so the stub can record the whole
 * booking payload without coupling to the service's exact input shape.
 */
export interface TcgShipmentCapture {
  serviceCode?: string;
  from?: {
    streetAddress?: string;
    suburb?: string;
    city?: string;
    postalCode?: string;
    province?: string;
    company?: string;
    [k: string]: unknown;
  };
  to?: Record<string, unknown>;
  [k: string]: unknown;
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
  // DD-F5 — optional: the captured JIT supplier collection bookings. installStubs
  // both returns this array and stashes it on the TcgService instance, so the
  // module can resolve it via capturedTcgShipments() even if the harness entry
  // never hangs it here.
  tcgShipments?: TcgShipmentCapture[];
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
    'transaction', // self-refs (refundOf / shipsWith) resolve within one delete
    // DD-F5 — Daily Deals JIT fulfilment. DealPurchaseOrder holds an FK to Deal
    // (child → before deal). Supplier is pointed-to by Deal via the OPTIONAL
    // Deal.supplierId (default ON DELETE SET NULL), so wiping it first just
    // nulls any lingering deal link before the deal row itself is deleted below.
    'dealPurchaseOrder',
    'supplier',
    'deal', // DD-2 — cascade-deletes with listing anyway, but explicit is safer
    'listing',
    'order',
    'payoutBatch',
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
export function installStubs(app: INestApplicationContext): TcgShipmentCapture[] {
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
  // DD-F5 — capture (never fire) the JIT supplier collection booking. Unlike the
  // rate lookups above, createShipment is the ONE booking call the deal
  // stock-ready flow actually makes, and we need to assert it collects FROM the
  // supplier warehouse. Record each createShipment() arg object, then return a
  // deterministic booked result so bookForTransaction stamps shipmentBookedAt +
  // trackingReference exactly as a real booking would. The array is stashed on
  // the (singleton) TcgService instance so capturedTcgShipments() can resolve it
  // from the Ctx, and also returned so the harness entry can hang it on the Ctx.
  const capturedShipments: TcgShipmentCapture[] = [];
  tcg.createShipment = async (input: TcgShipmentCapture) => {
    capturedShipments.push(input);
    return {
      carrier: 'TCG',
      shipmentId: 'STUB-1',
      trackingReference: 'TCGSTUB001',
    };
  };
  (tcg as { __capturedShipments?: TcgShipmentCapture[] }).__capturedShipments =
    capturedShipments;
  return capturedShipments;
}

/**
 * DD-F5 — resolve the captured JIT supplier collection bookings. Prefers the
 * array the harness entry hung on the Ctx; falls back to the copy installStubs
 * stashed on the TcgService singleton, so the module's assertions work whether
 * or not the (optional) Ctx wiring was applied.
 */
export function capturedTcgShipments(ctx: Ctx): TcgShipmentCapture[] {
  if (ctx.tcgShipments) return ctx.tcgShipments;
  const tcg = ctx.app.get(TcgService, { strict: false }) as unknown as {
    __capturedShipments?: TcgShipmentCapture[];
  };
  return tcg.__capturedShipments ?? [];
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
  return actors;
}

/**
 * DD-2 — seed the Daily Deals house seller (mirrors prisma/seed-house-seller.ts)
 * + the Setting the DealsService resolves it from. Seeded on the STABLE clerkId
 * 'system_house_seller' (NOT dr_-prefixed) so it survives cleanup()'s user wipe
 * and its Setting stays valid across runs; its prior listings/deals/transactions
 * are still wiped by the table sweep. Carries a real phone + email so the
 * auto-accept courier booking (bookForTransaction) doesn't fail-safe.
 */
export async function seedHouseSeller(prisma: PrismaService): Promise<Actor> {
  const clerkId = 'system_house_seller';
  const email = 'deals@dummyrun.local';
  const username = 'gungalore_official';
  const now = new Date();
  const user = await (prisma as any).user.upsert({
    where: { clerkId },
    create: {
      clerkId,
      email,
      username,
      firstName: 'Gun Galore',
      phone: '+27820000001',
      phoneVerified: true,
      sellerTier: 'DEALER',
      kycStatus: 'VERIFIED',
      kycVerifiedAt: now,
      profileCompletedAt: now,
    },
    // Keep contactability valid across re-runs; don't clobber email/username.
    update: { phone: '+27820000001', phoneVerified: true },
  });
  await (prisma as any).setting.upsert({
    where: { key: 'house_seller_user_id' },
    create: { key: 'house_seller_user_id', value: user.id },
    update: { value: user.id },
  });
  return { id: user.id, clerkId, email: user.email, username: user.username };
}

/**
 * DD-F5 — the Daily Deals JIT fulfilment supplier's warehouse. Deliberately a
 * DISTINCT city + postal code from every buyer/seller address in the harness
 * (buyers ship to Pretoria/0002, listings collect from Pretoria/0002) so that a
 * booked deal collection whose origin is Cape Town/8001 UNAMBIGUOUSLY proves it
 * was sourced from the SUPPLIER, not the buyer's delivery or a default pickup.
 */
export const DUMMY_SUPPLIER_ID = 'system_dummy_supplier';
export const DUMMY_SUPPLIER_WAREHOUSE = {
  street: '7 Warehouse Way',
  suburb: 'Montague Gardens',
  city: 'Cape Town',
  province: 'WESTERN_CAPE' as const,
  postalCode: '8001',
  lat: -33.9249,
  lng: 18.4241,
};

/**
 * DD-F5 — seed the Daily Deals JIT fulfilment Supplier (mirrors seedHouseSeller).
 * Carries a COMPLETE warehouse address (street/suburb/city/province/postalCode/
 * lat/lng) + phone + email + contactPerson so The Courier Guy always has a
 * collectable, phoneable origin (bookForTransaction fails-safe without them).
 * Seeded on the STABLE id DUMMY_SUPPLIER_ID (idempotent upsert) so a deal can
 * link to it deterministically; active:true so DealsService.requireActive
 * passes. cleanup() wipes + this re-seeds it each run.
 *
 * Returns an Actor-shaped adaptor (only `.id` is meaningful — a Supplier is not
 * a User) so the harness entry can wire it exactly like `actors.house`.
 */
export async function seedSupplier(prisma: PrismaService): Promise<Actor> {
  const w = DUMMY_SUPPLIER_WAREHOUSE;
  const data = {
    name: 'Dummy Run Supplier Co',
    contactPerson: 'Dummy Warehouse Manager',
    email: 'supplier@dummyrun.local',
    phone: '+27820000002',
    warehouseStreet: w.street,
    warehouseSuburb: w.suburb,
    warehouseCity: w.city,
    warehouseProvince: w.province,
    warehousePostalCode: w.postalCode,
    warehouseLat: w.lat,
    warehouseLng: w.lng,
    active: true,
  };
  const supplier = await (prisma as any).supplier.upsert({
    where: { id: DUMMY_SUPPLIER_ID },
    create: { id: DUMMY_SUPPLIER_ID, ...data },
    update: data,
  });
  return {
    id: supplier.id,
    clerkId: DUMMY_SUPPLIER_ID,
    email: supplier.email,
    username: supplier.name,
  };
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
