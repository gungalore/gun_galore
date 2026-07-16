/**
 * Module drivers. Each function drives ONE money/fulfilment lifecycle end to
 * end via the REAL services, asserting state after each transition and money
 * conservation at the end. Failures are recorded (non-fatal) by the harness.
 */
import { Ctx, Actor, makeListing, DELIVERY_ADDRESS } from './seed';
import { check, checkAsync, assert, eq, Reporter } from './harness';
import {
  svc,
  assertConserves,
  ggRevenueOf,
  drainPayouts,
  waitFor,
  simulatePaid,
  simulateOrderPaid,
} from './money';
import { TransactionsService } from '../../src/payments/transactions.service';
import { FeeCalculator } from '../../src/payments/fee.calculator';
import { DealerVerificationService } from '../../src/payments/dealer-verification.service';
import { AuctionsService } from '../../src/auctions/auctions.service';
import { OffersService } from '../../src/offers/offers.service';
import { TasksService } from '../../src/tasks/tasks.service';
import { SubscriptionsService } from '../../src/subscriptions/subscriptions.service';
import { FeaturedService } from '../../src/featured/featured.service';
import { AskGgService } from '../../src/ask-gg/ask-gg.service';
import { RecommendedLoadsService } from '../../src/load-lab/recommended-loads.service';
import { PriceEstimateService } from '../../src/listings/price-estimate.service';
import { SwapProposalsService } from '../../src/swaps/swap-proposals.service';
import { SwapFundingService } from '../../src/swaps/swap-funding.service';
import { ShippingService } from '../../src/shipping/shipping.service';
import { ManualPaymentsService } from '../../src/manual-payments/manual-payments.service';
import { DealsService } from '../../src/deals/deals.service';
import { AdminService } from '../../src/admin/admin.service';
import {
  SWAP_SHIPPING_FEE_CENTS,
} from '../../src/payments/fee.calculator';

const tsvc = (ctx: Ctx) => svc(ctx, TransactionsService);
const P = (ctx: Ctx) => ctx.prisma as any;

async function tx(ctx: Ctx, id: string) {
  return P(ctx).transaction.findUnique({ where: { id } });
}

/**
 * Shared goods lifecycle: confirm payment → accept → dispatch → confirm
 * delivery → payout, with assertions at each hop. Returns the settled tx row.
 */
async function drivePaidGoodsSale(
  ctx: Ctx,
  txId: string,
  seller: Actor,
  buyer: Actor,
  label: string,
) {
  const rep = ctx.rep;
  const T = tsvc(ctx);

  await simulatePaid(ctx, txId);
  let row = await tx(ctx, txId);
  check(rep, `${label}: payment confirmed → HELD + paidAt + listing SOLD`, () => {
    eq(row.paymentStatus, 'HELD', 'paymentStatus');
    assert(row.paidAt, 'paidAt not set');
  });
  const listingAfterPay = await P(ctx).listing.findUnique({ where: { id: row.listingId } });
  check(rep, `${label}: listing flipped SOLD`, () => eq(listingAfterPay.status, 'SOLD', 'listing.status'));

  // idempotent re-confirm is a no-op
  await simulatePaid(ctx, txId);
  const reRow = await tx(ctx, txId);
  check(rep, `${label}: re-confirm payment is idempotent (paidAt unchanged)`, () =>
    eq(reRow.paidAt.getTime(), row.paidAt.getTime(), 'paidAt'),
  );

  await T.acceptTransaction(txId, seller.clerkId);
  row = await tx(ctx, txId);
  check(rep, `${label}: seller accepted (acceptedAt + dispatch deadline)`, () => {
    assert(row.acceptedAt, 'acceptedAt not set');
    assert(row.dispatchDeadlineAt, 'dispatchDeadlineAt not set');
  });

  await T.confirmDispatch(txId, seller.clerkId, {});
  row = await tx(ctx, txId);
  check(rep, `${label}: dispatched (dispatchedAt + shippingStatus COLLECTED)`, () => {
    assert(row.dispatchedAt, 'dispatchedAt not set');
    eq(row.shippingStatus, 'COLLECTED', 'shippingStatus');
  });

  await T.confirmDelivery(txId, buyer.clerkId);
  row = await tx(ctx, txId);
  check(rep, `${label}: buyer confirmed delivery → RELEASED (exactly once)`, () => {
    eq(row.paymentStatus, 'RELEASED', 'paymentStatus');
    assert(row.releasedAt, 'releasedAt not set');
    assert(row.confirmedDeliveryAt, 'confirmedDeliveryAt not set');
  });

  // exactly-once: a second confirm must NOT move money again
  const releasedAt = row.releasedAt.getTime();
  let doubleReleased = false;
  try {
    await T.confirmDelivery(txId, buyer.clerkId);
  } catch {
    /* expected: already released */
  }
  row = await tx(ctx, txId);
  if (row.releasedAt.getTime() !== releasedAt) doubleReleased = true;
  check(rep, `${label}: releasedAt is exactly-once (no double release)`, () =>
    assert(!doubleReleased, 'releasedAt changed on second confirmDelivery'),
  );

  check(rep, `${label}: money conserved on the settled transaction`, () => assertConserves(row));

  await drivePayoutAndLedger(ctx, txId, label);
  return tx(ctx, txId);
}

/** Settle via the FNB batch, then assert the row is paid out + record ledger. */
async function drivePayoutAndLedger(ctx: Ctx, txId: string, label: string) {
  const rep = ctx.rep;
  const before = await tx(ctx, txId);
  await drainPayouts(ctx);
  const row = await tx(ctx, txId);
  check(rep, `${label}: payout settled the seller (paidOutAt)`, () => {
    assert(row.paidOutAt, 'paidOutAt not set');
  });
  rep.money({
    label,
    buyerPaid: before.buyerTotal,
    sellerPaid: before.sellerPayout,
    ggRevenue: ggRevenueOf(before),
    carrier: before.shippingCost,
    refunded: 0,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// MODULE: Marketplace BUY_NOW (+ collection + private-arrange variants)
// ─────────────────────────────────────────────────────────────────────────
export async function moduleBuyNow(ctx: Ctx) {
  const rep = ctx.rep;
  const { seller, buyer } = ctx.actors;
  const T = tsvc(ctx);
  const fc = svc(ctx, FeeCalculator);

  // ── Variant A: courier (PUDO) ─────────────────────────────────────────
  const listingA = await makeListing(ctx.prisma, {
    seller,
    categoryId: ctx.cats.normal,
    listingType: 'BUY_NOW',
    price: 250_000,
    title: 'BUY_NOW courier item',
  });
  const createdA: any = await T.create(
    buyer.clerkId,
    { listingId: listingA.id, shippingMethod: 'PUDO', pudoPickupLockerId: 'L-TEST-001' } as any,
    'http://localhost',
  );
  check(rep, 'PUDO: checkout created a manual-EFT transaction', () => {
    assert(createdA.transactionId, 'no transactionId');
    assert(createdA.manual === true, 'not manual mode');
    assert(createdA.orderReference, 'no order reference');
  });
  // cross-check the fee breakdown the service persisted against FeeCalculator
  const rowA0 = await tx(ctx, createdA.transactionId);
  const expected = fc.breakdown(250_000, listingA.passFeeToBuyer, true /*TOP_SELLER*/, 6500, 'manual', 1500);
  check(rep, 'PUDO: persisted fee breakdown matches FeeCalculator', () => {
    eq(rowA0.commissionZar, expected.commissionZar, 'commission');
    eq(rowA0.processingFee, expected.processingFee, 'processingFee');
    eq(rowA0.shippingCost, expected.shippingCost, 'shippingCost');
    eq(rowA0.shippingHandlingCents, expected.shippingHandlingCents, 'handling');
    eq(rowA0.buyerTotal, expected.buyerTotal, 'buyerTotal');
    eq(rowA0.sellerPayout, expected.sellerPayout, 'sellerPayout');
  });
  await drivePaidGoodsSale(ctx, createdA.transactionId, seller, buyer, 'PUDO');

  // ── Variant B: in-person COLLECTION (no courier, no handling) ──────────
  const listingB = await makeListing(ctx.prisma, {
    seller,
    categoryId: ctx.cats.collection,
    listingType: 'BUY_NOW',
    price: 180_000,
    title: 'BUY_NOW collection item',
    extra: { collectionOnly: true, shippingMethods: ['COLLECTION'] },
  });
  const createdB: any = await T.create(
    buyer.clerkId,
    { listingId: listingB.id, shippingMethod: 'COLLECTION' } as any,
    'http://localhost',
  );
  const rowB0 = await tx(ctx, createdB.transactionId);
  check(rep, 'COLLECTION: no shipping cost + no handling margin', () => {
    eq(rowB0.shippingCost, 0, 'shippingCost');
    eq(rowB0.shippingHandlingCents, 0, 'handling');
  });
  await drivePaidGoodsSale(ctx, createdB.transactionId, seller, buyer, 'COLLECTION');

  // ── Variant C: firearm PRIVATE_ARRANGE (immediate release at payment) ──
  const listingC = await makeListing(ctx.prisma, {
    seller,
    categoryId: ctx.cats.firearm,
    listingType: 'BUY_NOW',
    price: 900_000,
    title: 'BUY_NOW firearm private-arrange',
    isFirearm: true,
    extra: { shippingMethods: ['DEALER_TRANSFER', 'PRIVATE_ARRANGE'] },
  });
  const createdC: any = await T.create(
    buyer.clerkId,
    {
      listingId: listingC.id,
      shippingMethod: 'PRIVATE_ARRANGE',
      privateArrangeConsent: true,
      firearmAttestation18Plus: true,
    } as any,
    'http://localhost',
  );
  await simulatePaid(ctx, createdC.transactionId);
  // maybeImmediatePayout fires fire-and-forget inside markPaid; give it a tick.
  await settleTick();
  let rowC = await tx(ctx, createdC.transactionId);
  check(rep, 'PRIVATE_ARRANGE: released immediately at payment (no delivery step)', () => {
    eq(rowC.paymentStatus, 'RELEASED', 'paymentStatus');
    assert(rowC.releasedAt, 'releasedAt not set');
    assert(rowC.privateArrangeAcceptedAt, 'privateArrangeAcceptedAt not set');
  });
  check(rep, 'PRIVATE_ARRANGE: money conserved', () => assertConserves(rowC));
  await drivePayoutAndLedger(ctx, createdC.transactionId, 'PRIVATE_ARRANGE');
}

/** Let fire-and-forget void side-effects (maybeImmediatePayout etc.) flush. */
export function settleTick(ms = 150): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** True if the error is a Prisma interactive-transaction timeout / expiry. */
export function isTxTimeout(msg: string): boolean {
  return /expired transaction|cannot be executed on an expired|interactive transaction timeout/i.test(msg);
}

/** Run one step as a reported check that never throws; returns pass + error. */
async function safeStep(
  rep: Reporter,
  desc: string,
  fn: () => Promise<void>,
): Promise<{ ok: boolean; err?: string }> {
  try {
    await fn();
    rep.pass(desc);
    return { ok: true };
  } catch (e) {
    const err = (e as Error).message;
    rep.fail(desc, err.split('\n')[0]);
    return { ok: false, err };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// MODULE: Firearm DEALER_TRANSFER (release gated on SAPS-534 dealer approval)
// ─────────────────────────────────────────────────────────────────────────
export async function moduleFirearm(ctx: Ctx) {
  const rep = ctx.rep;
  const { seller, dealerbuyer: buyer } = ctx.actors;
  const T = tsvc(ctx);
  const dv = svc(ctx, DealerVerificationService);

  const listing = await makeListing(ctx.prisma, {
    seller,
    categoryId: ctx.cats.firearm,
    listingType: 'BUY_NOW',
    price: 1_200_000,
    title: 'Firearm dealer-transfer rifle',
    isFirearm: true,
    extra: { shippingMethods: ['DEALER_TRANSFER'] },
  });
  const created: any = await T.create(
    buyer.clerkId,
    { listingId: listing.id, shippingMethod: 'DEALER_TRANSFER', firearmAttestation18Plus: true } as any,
    'http://localhost',
  );
  await simulatePaid(ctx, created.transactionId);
  let row = await tx(ctx, created.transactionId);
  check(rep, 'DEALER_TRANSFER: paid → HELD, no shipping/handling', () => {
    eq(row.paymentStatus, 'HELD', 'paymentStatus');
    eq(row.shippingCost, 0, 'shippingCost');
    eq(row.shippingHandlingCents, 0, 'handling');
  });

  // Buyer cannot confirm delivery before dealer verification is APPROVED.
  let blocked = false;
  try {
    await T.confirmDelivery(created.transactionId, buyer.clerkId);
  } catch {
    blocked = true;
  }
  check(rep, 'DEALER_TRANSFER: confirm-delivery blocked until dealer verify APPROVED', () =>
    assert(blocked, 'confirmDelivery should have thrown pre-approval'),
  );

  // Admin approves the SAPS-534 dealer stock-in → auto-releases (fire-and-forget).
  await dv.adminOverride(created.transactionId, 'APPROVE', 'dummy-run-admin', 'stock-in verified (dummy run)');
  row = await waitFor(
    () => tx(ctx, created.transactionId),
    (r) => r.paymentStatus === 'RELEASED',
  );
  check(rep, 'DEALER_TRANSFER: admin APPROVE released funds (HELD→RELEASED)', () => {
    eq(row.dealerVerificationStatus, 'APPROVED', 'dealerVerificationStatus');
    eq(row.paymentStatus, 'RELEASED', 'paymentStatus');
    assert(row.releasedAt, 'releasedAt not set');
  });
  check(rep, 'DEALER_TRANSFER: money conserved', () => assertConserves(row));
  await drivePayoutAndLedger(ctx, created.transactionId, 'DEALER_TRANSFER');
}

// ─────────────────────────────────────────────────────────────────────────
// MODULE: Auctions (bid → finalize → winner pays → settle; + no-bids EXPIRED)
// ─────────────────────────────────────────────────────────────────────────
export async function moduleAuctions(ctx: Ctx) {
  const rep = ctx.rep;
  const { seller, bidderA, bidderB } = ctx.actors;
  const T = tsvc(ctx);
  const auctions = svc(ctx, AuctionsService);
  const future = new Date(Date.now() + 3_600_000);
  const past = new Date(Date.now() - 3_600_000);

  // Winning auction: 2 bidders, no reserve (always met).
  const winAuction = await makeListing(ctx.prisma, {
    seller,
    categoryId: ctx.cats.normal,
    listingType: 'AUCTION',
    price: 10_000, // starting bid
    title: 'Auction with bids',
    extra: { startTime: past, endTime: future, durationDays: 3, reservePrice: null },
  });
  await auctions.placeBid(bidderA.clerkId, winAuction.id, { maxAmount: 15_000, isOneShot: true } as any);
  const afterA = await P(ctx).listing.findUnique({ where: { id: winAuction.id } });
  await auctions.placeBid(bidderB.clerkId, winAuction.id, { maxAmount: 25_000, isOneShot: true } as any);
  const afterB = await P(ctx).listing.findUnique({ where: { id: winAuction.id } });
  check(rep, 'AUCTION: two bids registered, high bidder + bidCount tracked', () => {
    eq(afterA.currentBidderId, bidderA.id, 'currentBidderId after A');
    eq(afterB.currentBidderId, bidderB.id, 'currentBidderId after B');
    assert(afterB.currentBid >= 25_000, `currentBid ${afterB.currentBid} < 25000`);
    assert(afterB.bidCount >= 2, `bidCount ${afterB.bidCount} < 2`);
  });

  // No-bids auction → should EXPIRE on finalize.
  const deadAuction = await makeListing(ctx.prisma, {
    seller,
    categoryId: ctx.cats.normal,
    listingType: 'AUCTION',
    price: 50_000,
    title: 'Auction with no bids',
    extra: { startTime: past, endTime: future, durationDays: 3, reservePrice: null },
  });

  // Force both auctions past their end, then run the real end-cron entrypoint.
  await P(ctx).listing.updateMany({
    where: { id: { in: [winAuction.id, deadAuction.id] } },
    data: { endTime: past },
  });
  await auctions.endStale();

  const winFinal = await P(ctx).listing.findUnique({ where: { id: winAuction.id } });
  check(rep, 'AUCTION: winning auction finalised → PAYMENT_PENDING for high bidder', () => {
    eq(winFinal.status, 'PAYMENT_PENDING', 'status');
    eq(winFinal.currentBidderId, bidderB.id, 'winner');
    assert(winFinal.endedAt, 'endedAt not set');
    assert(winFinal.expiresAt, 'expiresAt (pay window) not set');
  });
  const deadFinal = await P(ctx).listing.findUnique({ where: { id: deadAuction.id } });
  check(rep, 'AUCTION: no-bids auction → EXPIRED', () => {
    eq(deadFinal.status, 'EXPIRED', 'status');
    assert(deadFinal.endedAt, 'endedAt not set');
  });

  // Winner checkout (auction-win branch) → full goods lifecycle → payout.
  const created: any = await T.create(
    bidderB.clerkId,
    { listingId: winAuction.id, shippingMethod: 'PUDO', pudoPickupLockerId: 'L-TEST-002' } as any,
    'http://localhost',
  );
  const row0 = await tx(ctx, created.transactionId);
  check(rep, 'AUCTION: winner checkout priced at winning bid', () =>
    eq(row0.listingPrice, winFinal.currentBid, 'listingPrice == winning bid'),
  );
  await drivePaidGoodsSale(ctx, created.transactionId, seller, bidderB, 'AUCTION');
}

// ─────────────────────────────────────────────────────────────────────────
// MODULE: Take-a-Shot offers (submit → counter → accept → checkout → settle)
// ─────────────────────────────────────────────────────────────────────────
export async function moduleOffers(ctx: Ctx) {
  const rep = ctx.rep;
  const { seller, buyer, dealerbuyer: rival } = ctx.actors;
  const T = tsvc(ctx);
  const offers = svc(ctx, OffersService);

  const listing = await makeListing(ctx.prisma, {
    seller,
    categoryId: ctx.cats.normal,
    listingType: 'TAKE_A_SHOT',
    price: null,
    title: 'Take-a-Shot item',
    extra: { autoAcceptThreshold: null },
  });

  const { offer } = (await offers.submit(buyer.clerkId, {
    listingId: listing.id,
    offerAmount: 200_000,
  } as any)) as any;
  check(rep, 'OFFER: buyer offer submitted → PENDING', () => eq(offer.status, 'PENDING', 'status'));

  // A rival offer that must be auto-rejected once the winner pays.
  const rivalOffer = (await offers.submit(rival.clerkId, {
    listingId: listing.id,
    offerAmount: 190_000,
  } as any)) as any;

  const countered = (await offers.counter(seller.clerkId, offer.id, {
    counterAmount: 230_000,
  } as any)) as any;
  check(rep, 'OFFER: seller countered → COUNTERED w/ counterAmount', () => {
    eq(countered.status, 'COUNTERED', 'status');
    eq(countered.counterAmount, 230_000, 'counterAmount');
  });

  const accepted = (await offers.acceptCounter(buyer.clerkId, offer.id)) as any;
  check(rep, 'OFFER: buyer accepted counter → ACCEPTED', () => eq(accepted.status, 'ACCEPTED', 'status'));

  // Checkout the accepted offer (offerId branch): pays the counter amount.
  const created: any = await T.create(
    buyer.clerkId,
    {
      listingId: listing.id,
      offerId: offer.id,
      shippingMethod: 'PUDO',
      pudoPickupLockerId: 'L-TEST-003',
    } as any,
    'http://localhost',
  );
  const row0 = await tx(ctx, created.transactionId);
  const convertedOffer = await P(ctx).offer.findUnique({ where: { id: offer.id } });
  check(rep, 'OFFER: checkout priced at counter + offer → CONVERTED', () => {
    eq(row0.listingPrice, 230_000, 'listingPrice == counterAmount');
    eq(convertedOffer.status, 'CONVERTED', 'offer.status');
  });

  await simulatePaid(ctx, created.transactionId);
  await settleTick();
  const rival2 = await P(ctx).offer.findUnique({ where: { id: rivalOffer.offer.id } });
  check(rep, 'OFFER: sibling offer auto-rejected on sale (markPaid)', () =>
    eq(rival2.status, 'REJECTED', 'rival offer status'),
  );

  // Finish the goods lifecycle from the accept step onward.
  await T.acceptTransaction(created.transactionId, seller.clerkId);
  await T.confirmDispatch(created.transactionId, seller.clerkId, {});
  await T.confirmDelivery(created.transactionId, buyer.clerkId);
  const settled = await tx(ctx, created.transactionId);
  check(rep, 'OFFER: released after delivery + money conserved', () => {
    eq(settled.paymentStatus, 'RELEASED', 'paymentStatus');
    assertConserves(settled);
  });
  await drivePayoutAndLedger(ctx, created.transactionId, 'OFFER (Take-a-Shot)');
}

// ─────────────────────────────────────────────────────────────────────────
// MODULE: Cart / Orders (multi-seller fan-out → rollup → settle)
// ─────────────────────────────────────────────────────────────────────────
export async function moduleOrders(ctx: Ctx) {
  const rep = ctx.rep;
  const { seller, seller2, buyer } = ctx.actors;
  const T = tsvc(ctx);
  const tasks = svc(ctx, TasksService);

  const l1 = await makeListing(ctx.prisma, {
    seller,
    categoryId: ctx.cats.normal,
    listingType: 'BUY_NOW',
    price: 120_000,
    title: 'Cart line — seller 1',
  });
  const l2 = await makeListing(ctx.prisma, {
    seller: seller2,
    categoryId: ctx.cats.normal,
    listingType: 'BUY_NOW',
    price: 90_000,
    title: 'Cart line — seller 2',
  });

  const order: any = await T.createOrderCheckout(
    buyer.clerkId,
    {
      lines: [
        { listingId: l1.id, shippingMethod: 'PUDO', pudoPickupLockerId: 'L-TEST-010' },
        { listingId: l2.id, shippingMethod: 'PUDO', pudoPickupLockerId: 'L-TEST-011' },
      ],
    } as any,
    'http://localhost',
  );
  check(rep, 'ORDER: multi-seller checkout created (1 order, 2 lines)', () => {
    assert(order.orderId, 'no orderId');
    eq(order.itemCount, 2, 'itemCount');
  });

  await simulateOrderPaid(ctx, order.orderId);
  await settleTick();
  const orderRow = await P(ctx).order.findUnique({
    where: { id: order.orderId },
    include: { transactions: true },
  });
  check(rep, 'ORDER: confirm → Order PAID, both children HELD', () => {
    eq(orderRow.status, 'PAID', 'order.status');
    assert(orderRow.paidAt, 'order.paidAt not set');
    eq(orderRow.transactions.length, 2, 'child count');
    assert(orderRow.transactions.every((t: any) => t.paymentStatus === 'HELD'), 'not all children HELD');
    assert(orderRow.transactions.every((t: any) => t.paidAt), 'child paidAt missing');
  });
  check(rep, 'ORDER: order total equals sum of child buyerTotals', () =>
    eq(orderRow.buyerTotal, orderRow.transactions.reduce((s: number, t: any) => s + t.buyerTotal, 0), 'order total'),
  );

  // Per-child accept → dispatch → confirm delivery (each by its own seller).
  const sellerByChild: Record<string, Actor> = {};
  for (const child of orderRow.transactions) {
    sellerByChild[child.id] = child.sellerId === seller.id ? seller : seller2;
  }
  for (const child of orderRow.transactions) {
    const s = sellerByChild[child.id];
    await T.acceptTransaction(child.id, s.clerkId);
    await T.confirmDispatch(child.id, s.clerkId, {});
    await T.confirmDelivery(child.id, buyer.clerkId);
  }
  const childrenReleased = await P(ctx).transaction.findMany({ where: { orderId: order.orderId } });
  check(rep, 'ORDER: all children RELEASED after delivery + conserved', () => {
    assert(childrenReleased.every((t: any) => t.paymentStatus === 'RELEASED'), 'not all RELEASED');
    childrenReleased.forEach((t: any) => assertConserves(t));
  });

  // Order rollup sweep → Order COMPLETED.
  await tasks.orderStatusRollupSweep();
  const rolled = await P(ctx).order.findUnique({ where: { id: order.orderId } });
  check(rep, 'ORDER: rollup sweep advanced Order → COMPLETED', () => eq(rolled.status, 'COMPLETED', 'order.status'));

  // Settle both sellers' payouts.
  const before = await P(ctx).transaction.findMany({ where: { orderId: order.orderId } });
  await drainPayouts(ctx);
  const after = await P(ctx).transaction.findMany({ where: { orderId: order.orderId } });
  check(rep, 'ORDER: both children paid out', () =>
    assert(after.every((t: any) => t.paidOutAt), 'not all children paid out'),
  );
  for (const t of before) {
    rep.money({
      label: `ORDER child ${t.sellerId === seller.id ? 'seller1' : 'seller2'}`,
      buyerPaid: t.buyerTotal,
      sellerPaid: t.sellerPayout,
      ggRevenue: ggRevenueOf(t),
      carrier: t.shippingCost,
      refunded: 0,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// MODULE: Experiences (ON_SITE_SERVICE — held until post-event confirm)
// ─────────────────────────────────────────────────────────────────────────
export async function moduleExperiences(ctx: Ctx) {
  const rep = ctx.rep;
  const { outfitter, buyer } = ctx.actors;
  const T = tsvc(ctx);
  const now = Date.now();

  const listing = await makeListing(ctx.prisma, {
    seller: outfitter,
    categoryId: ctx.cats.experience,
    listingType: 'BUY_NOW',
    price: 350_000,
    title: 'Guided plains-game hunt',
    isExperience: true,
    extra: {
      experienceType: 'PLAINS_GAME_HUNT',
      eventStartDate: new Date(now - 3_600_000),
      eventEndDate: new Date(now + 2 * 24 * 3_600_000),
      capacitySlots: 5,
      eventProvince: 'LIMPOPO',
    },
  });
  const created: any = await T.create(
    buyer.clerkId,
    {
      listingId: listing.id,
      shippingMethod: 'ON_SITE_SERVICE',
      eventDate: new Date(now + 3_600_000).toISOString(),
      partySize: 2,
      experienceBuyerAttested18Plus: true,
      experienceHuntingLicenceOrSupervisionAccepted: true,
      experienceIntermediaryAcknowledged: true,
      experienceCancellationPolicyAccepted: true,
      experienceRisksAccepted: true,
    } as any,
    'http://localhost',
  );
  await simulatePaid(ctx, created.transactionId);
  let row = await tx(ctx, created.transactionId);
  check(rep, 'EXPERIENCE: booked + paid → HELD, ON_SITE_SERVICE, no shipping', () => {
    eq(row.paymentStatus, 'HELD', 'paymentStatus');
    eq(row.shippingMethod, 'ON_SITE_SERVICE', 'shippingMethod');
    eq(row.shippingCost, 0, 'shippingCost');
    assert(row.eventDate, 'eventDate not persisted');
  });

  // Cannot settle through the goods delivery path.
  let blocked = false;
  try {
    await T.confirmDelivery(created.transactionId, buyer.clerkId);
  } catch {
    blocked = true;
  }
  check(rep, 'EXPERIENCE: goods confirm-delivery refused for on-site service', () =>
    assert(blocked, 'confirmDelivery should throw for ON_SITE_SERVICE'),
  );

  await T.acceptExperienceBooking(created.transactionId, outfitter.clerkId);
  row = await tx(ctx, created.transactionId);
  check(rep, 'EXPERIENCE: outfitter accepted booking (bookingConfirmedAt)', () =>
    assert(row.bookingConfirmedAt, 'bookingConfirmedAt not set'),
  );

  // Cannot confirm completion before the event date.
  let earlyBlocked = false;
  try {
    await T.confirmExperienceCompleted(created.transactionId, buyer.clerkId);
  } catch {
    earlyBlocked = true;
  }
  check(rep, 'EXPERIENCE: completion refused before the event date', () =>
    assert(earlyBlocked, 'confirmExperienceCompleted should throw pre-event'),
  );

  // Backdate the event so completion is now valid (mirrors "event just past").
  await P(ctx).transaction.update({
    where: { id: created.transactionId },
    data: { eventDate: new Date(now - 60_000) },
  });
  await T.confirmExperienceCompleted(created.transactionId, buyer.clerkId);
  row = await tx(ctx, created.transactionId);
  check(rep, 'EXPERIENCE: post-event confirm → RELEASED + conserved', () => {
    eq(row.paymentStatus, 'RELEASED', 'paymentStatus');
    assert(row.eventCompletedConfirmedAt, 'eventCompletedConfirmedAt not set');
    assertConserves(row);
  });
  await drivePayoutAndLedger(ctx, created.transactionId, 'EXPERIENCE');
}

// ─────────────────────────────────────────────────────────────────────────
// MODULE: Subscriptions (checkout → confirm → ACTIVE + tier set)
// ─────────────────────────────────────────────────────────────────────────
export async function moduleSubscriptions(ctx: Ctx) {
  const rep = ctx.rep;
  const { buyer } = ctx.actors; // buyer starts FREE
  const subs = svc(ctx, SubscriptionsService);

  await subs.checkout(buyer.clerkId, 'MEMBER');
  const sub = await P(ctx).subscription.findUnique({ where: { userId: buyer.id } });
  check(rep, 'SUBSCRIPTION: checkout created a subscription (SUSPENDED) + PENDING charge', () => {
    assert(sub, 'no subscription row');
    eq(sub.status, 'SUSPENDED', 'status');
  });
  const charge = await P(ctx).subscriptionCharge.findFirst({
    where: { subscriptionId: sub.id, status: 'PENDING' },
    orderBy: { chargedAt: 'desc' },
  });
  check(rep, 'SUBSCRIPTION: a PENDING EFT charge was allocated', () => assert(charge, 'no PENDING charge'));

  await subs.confirmPayment(charge.id);
  const subActive = await P(ctx).subscription.findUnique({ where: { userId: buyer.id } });
  const userAfter = await P(ctx).user.findUnique({ where: { id: buyer.id } });
  const chargeAfter = await P(ctx).subscriptionCharge.findUnique({ where: { id: charge.id } });
  check(rep, 'SUBSCRIPTION: confirm → ACTIVE, tier MEMBER on subscription + user', () => {
    eq(subActive.status, 'ACTIVE', 'subscription.status');
    eq(subActive.tier, 'MEMBER', 'subscription.tier');
    eq(userAfter.subscriptionTier, 'MEMBER', 'user.subscriptionTier');
    eq(chargeAfter.status, 'SUCCEEDED', 'charge.status');
  });
}

// ─────────────────────────────────────────────────────────────────────────
// MODULE: Featured slots (open → bid → close → bind → pay → OCCUPIED)
// ─────────────────────────────────────────────────────────────────────────
export async function moduleFeatured(ctx: Ctx) {
  const rep = ctx.rep;
  const { seller } = ctx.actors;
  const featured = svc(ctx, FeaturedService);

  // Let earlier modules' fire-and-forget side-effects flush + pre-warm the
  // lazily-created config row, so the money-critical bind transaction (5s
  // interactive-tx budget) isn't fighting a starved connection pool.
  await settleTick(800);
  await (featured as any).getConfig();

  const slot = await P(ctx).featuredSlot.create({ data: { slotNumber: 1, status: 'VACANT' } });
  const listing = await makeListing(ctx.prisma, {
    seller,
    categoryId: ctx.cats.normal,
    listingType: 'BUY_NOW',
    price: 500_000,
    title: 'Listing to feature',
  });

  await featured.openAuction(slot.id);
  let slotRow = await P(ctx).featuredSlot.findUnique({ where: { id: slot.id } });
  check(rep, 'FEATURED: auction opened → slot AUCTION_RUNNING', () => {
    eq(slotRow.status, 'AUCTION_RUNNING', 'slot.status');
    assert(slotRow.currentAuctionId, 'no currentAuctionId');
  });

  await featured.placeBid(seller.clerkId, slot.id, 20_000);
  const bidsAfter = await P(ctx).featuredSlotBid.findMany({ where: { auctionId: slotRow.currentAuctionId } });
  check(rep, 'FEATURED: bid registered (ACTIVE)', () => {
    assert(bidsAfter.length >= 1, 'no bid');
    eq(bidsAfter[0].status, 'ACTIVE', 'bid.status');
  });

  await featured.closeAuction(slotRow.currentAuctionId);
  const auctionClosed = await P(ctx).featuredAuction.findUnique({ where: { id: slotRow.currentAuctionId } });
  slotRow = await P(ctx).featuredSlot.findUnique({ where: { id: slot.id } });
  check(rep, 'FEATURED: auction closed → CLOSED_AWARDED, slot BIND_WINDOW', () => {
    eq(auctionClosed.status, 'CLOSED_AWARDED', 'auction.status');
    assert(auctionClosed.winningBidId, 'no winningBidId');
    eq(slotRow.status, 'BIND_WINDOW', 'slot.status');
  });

  const bindRes: any = await featured.bindListingToSlot(seller.clerkId, slot.id, listing.id);
  check(rep, 'FEATURED: bind on manual rail → awaiting payment (bid WON)', () =>
    assert(bindRes.awaitingPayment === true, 'expected awaitingPayment'),
  );

  const payRes: any = await featured.confirmSlotPayment(auctionClosed.winningBidId);
  slotRow = await P(ctx).featuredSlot.findUnique({ where: { id: slot.id } });
  const bidFinal = await P(ctx).featuredSlotBid.findUnique({ where: { id: auctionClosed.winningBidId } });

  if (slotRow.status === 'OCCUPIED') {
    check(rep, 'FEATURED: payment confirmed → slot OCCUPIED + featuredUntil', () => {
      eq(slotRow.currentListingId, listing.id, 'currentListingId');
      assert(slotRow.featuredUntil, 'featuredUntil not set');
      assert(bidFinal.paidAt, 'bid.paidAt not set');
    });
  } else {
    // PRODUCT BUG surfaced by the harness — see rep.bug below.
    rep.fail(
      'FEATURED: payment confirmed → slot OCCUPIED',
      `slot stuck at ${slotRow.status}; confirmSlotPayment returned bound=${payRes?.bound}. bid.paidAt=${!!bidFinal?.paidAt} (money captured, slot NOT bound)`,
    );
    check(rep, 'FEATURED: (impact) money was captured despite the failed bind', () =>
      assert(bidFinal.paidAt, 'bid.paidAt should be set — money captured'),
    );
    rep.bug(
      'src/featured/featured.service.ts:683 (tx.featuredSlot.update) + :693/:698 (this.recordEvent) inside bindListingToSlot occupy $transaction',
      'On the MANUAL EFT rail (production rail), confirmSlotPayment captures the slot fee (bid.paidAt set) but the occupy step self-deadlocks and never binds the slot. Inside the interactive $transaction, bindListingToSlot first runs tx.featuredSlot.update({ status: OCCUPIED, currentListingId, ... }) — updating the @unique currentListingId column takes a key-level row lock on the slot — and then awaits this.recordEvent() (LISTING_BOUND / FEATURED_LIVE, lines 693/698), which writes FeaturedSlotAuditEvent via the BASE this.prisma client on a SEPARATE connection, FK-referencing that same locked slot row. The audit INSERT blocks on the key lock while the outer transaction awaits it → self-deadlock resolved only when the 5000ms interactive-transaction timeout fires, rolling the whole bind back. Net effect: the winning bidder is charged but their slot never reaches OCCUPIED (reproduced deterministically at ~5009ms); a manual re-bind hits the same path. PrismaService uses the same @prisma/adapter-pg driver adapter in production. Fix: write the audit rows with the tx client (inside the transaction), or move recordEvent outside it.',
      'slot.status expected OCCUPIED, got BIND_WINDOW — Prisma "A query/commit cannot be executed on an expired transaction (5000 ms)"',
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// MODULE: Content smoke (AI-off read paths must not throw)
// ─────────────────────────────────────────────────────────────────────────
export async function moduleContentSmoke(ctx: Ctx) {
  const rep = ctx.rep;
  const { buyer } = ctx.actors;
  const askGg = svc(ctx, AskGgService);
  const loads = svc(ctx, RecommendedLoadsService);
  const priceEst = svc(ctx, PriceEstimateService);

  await checkAsync(rep, 'CONTENT: Ask-GG quota read returns without AI', async () => {
    const q: any = await askGg.getQuota(buyer.clerkId);
    assert(q, 'no quota response');
  });
  await checkAsync(rep, 'CONTENT: Load-Lab recommended-loads returns gracefully', async () => {
    const r: any = await loads.recommend('.308 Winchester', 150);
    assert(r, 'no loads response');
  });
  await checkAsync(rep, 'CONTENT: price-estimate returns gracefully (no Anthropic)', async () => {
    const e: any = await priceEst.estimate({ title: 'Test scope', condition: 'GOOD' } as any);
    assert(e, 'no estimate response');
  });
}

// ─────────────────────────────────────────────────────────────────────────
// MODULE: Swop / Trade (propose → fund → lock → deliver → release cash child)
// ─────────────────────────────────────────────────────────────────────────
const SWAP_ADDR = {
  street: '5 Trade Street',
  suburb: 'Central',
  city: 'Pretoria',
  postalCode: '0002',
  province: 'GAUTENG',
  lat: -25.75,
  lng: 28.19,
};

export async function moduleSwap(ctx: Ctx) {
  const rep = ctx.rep;
  const { swapA, swapB } = ctx.actors;
  const proposals = svc(ctx, SwapProposalsService);
  const funding = svc(ctx, SwapFundingService);
  const shipping = svc(ctx, ShippingService);
  const fc = svc(ctx, FeeCalculator);
  const CASH = 150_000; // initiator pays R1,500 cash top-up (excess over R1,000 allowance → commission)

  const offered = await makeListing(ctx.prisma, {
    seller: swapA,
    categoryId: ctx.cats.normal,
    listingType: 'SWOP',
    price: null,
    title: 'Swap item A (initiator gives)',
  });
  const wanted = await makeListing(ctx.prisma, {
    seller: swapB,
    categoryId: ctx.cats.normal,
    listingType: 'SWOP',
    price: null,
    title: 'Swap item B (owner gives)',
  });

  const proposal: any = await proposals.propose(swapA.clerkId, {
    listingId: wanted.id,
    offeredListingId: offered.id,
    cashAmount: CASH,
    cashDirection: 'INITIATOR_GIVES',
  } as any);
  check(rep, 'SWAP: proposal created → PENDING', () => eq(proposal.status, 'PENDING', 'status'));

  await proposals.acceptProposal(swapB.clerkId, proposal.id);
  const swap = await P(ctx).swap.findFirst({ where: { initiatorId: swapA.id, ownerId: swapB.id } });
  check(rep, 'SWAP: accepted → Swap parent (AWAITING_FUNDING) + 2 legs', () => {
    assert(swap, 'no swap');
    eq(swap.status, 'AWAITING_FUNDING', 'swap.status');
    eq(swap.cashAmount, CASH, 'cashAmount');
    eq(swap.cashPayerId, swapA.id, 'cashPayerId (initiator)');
  });
  const legs = await P(ctx).transaction.findMany({ where: { swapId: swap.id, swapRole: { not: null } } });
  check(rep, 'SWAP: two zero-money proof legs created', () => {
    eq(legs.length, 2, 'leg count');
    assert(legs.every((l: any) => l.buyerTotal === 0 && l.sellerPayout === 0), 'legs not zero-money');
    assert(legs.every((l: any) => l.swapProofCode), 'legs missing proof code');
  });

  // Stub the Proof-of-Possession gate (Anthropic off): APPROVE both legs.
  await P(ctx).transaction.updateMany({
    where: { swapId: swap.id, swapRole: { not: null } },
    data: { swapProofStatus: 'APPROVED', swapProofVerifiedAt: new Date() },
  });

  // Both parties submit the delivery address for the leg they receive; the
  // second submit triggers funding setup (proof APPROVED + both addresses).
  await funding.submitDeliveryAddress(swapA.clerkId, swap.id, SWAP_ADDR as any);
  await funding.submitDeliveryAddress(swapB.clerkId, swap.id, SWAP_ADDR as any);
  const funded = await P(ctx).swap.findUnique({ where: { id: swap.id } });
  check(rep, 'SWAP: funding set up — per-party amounts priced', () => {
    assert(funded.fundingSetUpAt, 'fundingSetUpAt not set');
    const expInit = fc.breakdownSwapLeg(funded.initiatorCourierCents, CASH, false, 'manual').partyTotal;
    const expOwner = fc.breakdownSwapLeg(funded.ownerCourierCents, 0, false, 'manual').partyTotal;
    eq(funded.initiatorFundingAmount, expInit, 'initiatorFundingAmount');
    eq(funded.ownerFundingAmount, expOwner, 'ownerFundingAmount');
  });

  // Both parties fund → LOCKED → onSwapLocked → IN_TRANSIT.
  await funding.confirmSwapFunding(swap.id, 'INITIATOR');
  await funding.confirmSwapFunding(swap.id, 'OWNER');
  const locked = await waitFor(
    () => P(ctx).swap.findUnique({ where: { id: swap.id } }),
    (s: any) => s.status === 'IN_TRANSIT' || s.status === 'LOCKED',
  );
  check(rep, 'SWAP: both funded → LOCKED (both verified stamped)', () => {
    assert(locked.initiatorVerifiedAt, 'initiatorVerifiedAt not set');
    assert(locked.ownerVerifiedAt, 'ownerVerifiedAt not set');
    assert(locked.lockedAt, 'lockedAt not set');
    assert(['LOCKED', 'IN_TRANSIT'].includes(locked.status), `status ${locked.status}`);
  });
  const inTransit = await waitFor(
    () => P(ctx).swap.findUnique({ where: { id: swap.id } }),
    (s: any) => s.status === 'IN_TRANSIT',
  );
  check(rep, 'SWAP: onSwapLocked advanced LOCKED → IN_TRANSIT', () => eq(inTransit.status, 'IN_TRANSIT', 'status'));

  // Mark both legs delivered; the second delivery rolls up to AWAITING_VERIFICATION.
  await shipping.applyShippingUpdate(legs[0].id, 'DELIVERED' as any);
  await shipping.applyShippingUpdate(legs[1].id, 'DELIVERED' as any);
  const awaiting = await P(ctx).swap.findUnique({ where: { id: swap.id } });
  check(rep, 'SWAP: both legs delivered → AWAITING_VERIFICATION + 48h window', () => {
    eq(awaiting.status, 'AWAITING_VERIFICATION', 'status');
    assert(awaiting.verificationDeadlineAt, 'verificationDeadlineAt not set');
  });

  // Backdate the verification window, then run the real release sweep.
  await P(ctx).swap.update({
    where: { id: swap.id },
    data: { verificationDeadlineAt: new Date(Date.now() - 60_000) },
  });
  await funding.sweepSwapVerification();
  const completed = await P(ctx).swap.findUnique({ where: { id: swap.id } });
  check(rep, 'SWAP: verification sweep → COMPLETED + cashReleasedAt (exactly once)', () => {
    eq(completed.status, 'COMPLETED', 'status');
    assert(completed.cashReleasedAt, 'cashReleasedAt not set');
    assert(completed.settlementTxId, 'settlementTxId not set');
  });

  const settlement = await tx(ctx, completed.settlementTxId);
  const cashCommission = fc.swapCashCommission(CASH);
  check(rep, 'SWAP: RELEASED cash child pays the recipient net of cash commission', () => {
    eq(settlement.paymentStatus, 'RELEASED', 'settlement.paymentStatus');
    eq(settlement.sellerId, swapB.id, 'cash recipient = owner');
    eq(settlement.sellerPayout, CASH - cashCommission, 'sellerPayout');
    eq(settlement.commissionZar, cashCommission, 'commissionZar');
  });

  // Swap money conservation (funding EFTs live on the Swap, not tx rows):
  //   initiatorFunding + ownerFunding == recipientCash + carriers + 2×flatFee + cashCommission
  check(rep, 'SWAP: money conserved across both funding EFTs', () => {
    const totalIn = completed.initiatorFundingAmount + completed.ownerFundingAmount;
    const carriers = completed.initiatorCourierCents + completed.ownerCourierCents;
    const rhs = settlement.sellerPayout + carriers + 2 * SWAP_SHIPPING_FEE_CENTS + cashCommission;
    eq(totalIn, rhs, 'funding total vs recipient+carriers+fees+commission');
  });

  // Settle the cash recipient via the FNB batch.
  await drainPayouts(ctx);
  const settledChild = await tx(ctx, completed.settlementTxId);
  check(rep, 'SWAP: cash recipient settled (paidOutAt)', () =>
    assert(settledChild.paidOutAt, 'cash child not paid out'),
  );
  rep.money({
    label: 'SWAP (cash top-up)',
    buyerPaid: completed.initiatorFundingAmount + completed.ownerFundingAmount,
    sellerPaid: settlement.sellerPayout,
    ggRevenue: 2 * SWAP_SHIPPING_FEE_CENTS + cashCommission,
    carrier: completed.initiatorCourierCents + completed.ownerCourierCents,
    refunded: 0,
    note: 'two funding legs; cash child pays recipient',
  });
}

// ─────────────────────────────────────────────────────────────────────────
// MODULE: Daily Deals (DD-2) — first-party house money path
// ─────────────────────────────────────────────────────────────────────────
// GG is the seller. Asserts: (1) full cycle pay → AUTO-ACCEPT (no seller
// tap) → dispatch → deliver → RELEASED with sellerPayout=0 + commissionZar=0
// and the payout batch SKIPPING the house row; (2) the per-customer cap
// rejects an over-limit second buy; (3) SOLD_OUT sync when stock exhausts;
// (4) a refund mints the buyer's synthetic child + conserves. Money is
// conserved on a house-aware basis (buyerTotal = carrier + GG-retained).

/** House-deal conservation: no seller cut, GG keeps everything bar the carrier. */
function assertHouseConserves(tx: {
  buyerTotal: number;
  sellerPayout: number;
  commissionZar: number;
  shippingCost: number;
}) {
  assert(tx.sellerPayout === 0, `house deal sellerPayout must be 0, got ${tx.sellerPayout}`);
  assert(tx.commissionZar === 0, `house deal commissionZar must be 0, got ${tx.commissionZar}`);
  const ggRetained = tx.buyerTotal - tx.shippingCost;
  assert(ggRetained >= 0, `house GG-retained went negative: buyerTotal ${tx.buyerTotal} - carrier ${tx.shippingCost}`);
}

/** Create a Daily Deal via the REAL DealsService (create + go-live). */
async function makeDeal(
  ctx: Ctx,
  opts: {
    dealPriceCents: number;
    wasPriceCents: number;
    costPriceCents: number;
    initialStock: number;
    perCustomerCap: number;
    categoryId?: string;
  },
): Promise<{ dealId: string; listingId: string }> {
  const deals = svc(ctx, DealsService);
  const admin = await P(ctx).adminUser.findFirst();
  assert(admin, 'no seeded AdminUser for the dummy run');
  const created: any = await deals.create(admin.id, {
    title: 'Dummy Daily Deal',
    categoryId: opts.categoryId ?? ctx.cats.normal,
    description: 'Auto-seeded Daily Deal for the dummy run.',
    province: 'GAUTENG',
    shippingMethods: ['PUDO', 'TCG'],
    dealPriceCents: opts.dealPriceCents,
    wasPriceCents: opts.wasPriceCents,
    costPriceCents: opts.costPriceCents,
    initialStock: opts.initialStock,
    perCustomerCap: opts.perCustomerCap,
  } as any);
  await deals.goLive(admin.id, created.id);
  return { dealId: created.id, listingId: created.listingId };
}

export async function moduleDailyDeals(ctx: Ctx) {
  const rep = ctx.rep;
  const { buyer, house } = ctx.actors;
  const T = tsvc(ctx);

  // DD-2 — go-live is gated on the master dealsEnabled killswitch. Arm it.
  await P(ctx).setting.upsert({
    where: { key: 'deals_enabled' },
    create: { key: 'deals_enabled', value: 'true' },
    update: { value: 'true' },
  });

  // ── (1) Full released cycle ──────────────────────────────────────────
  const d1 = await makeDeal(ctx, {
    dealPriceCents: 250_000,
    wasPriceCents: 400_000,
    costPriceCents: 150_000,
    initialStock: 5,
    perCustomerCap: 10,
  });
  const listing1 = await P(ctx).listing.findUnique({ where: { id: d1.listingId } });
  check(rep, 'go-live: deal listing is ACTIVE + isDealListing (buyable, still browse-excluded)', () => {
    eq(listing1.status, 'ACTIVE', 'listing.status');
    assert(listing1.isDealListing === true, 'isDealListing not true');
    assert(listing1.sellerId === house.id, 'listing not filed under house seller');
  });

  const created1: any = await T.create(
    buyer.clerkId,
    { listingId: d1.listingId, shippingMethod: 'PUDO', pudoPickupLockerId: 'L-TEST-001' } as any,
    'http://localhost',
  );
  const row1a = await tx(ctx, created1.transactionId);
  check(rep, 'house deal: sellerPayout=0 + commissionZar=0 at checkout', () => {
    eq(row1a.sellerPayout, 0, 'sellerPayout');
    eq(row1a.commissionZar, 0, 'commissionZar');
    assert(row1a.buyerTotal > 0, 'buyerTotal should be > 0');
  });

  await simulatePaid(ctx, created1.transactionId);
  // Auto-accept fires fire-and-forget inside markPaid — wait for acceptedAt.
  const row1 = await waitFor(
    () => tx(ctx, created1.transactionId),
    (r) => !!r?.acceptedAt,
    { tries: 60, gap: 50 },
  );
  check(rep, 'house deal: AUTO-ACCEPTED at payment (no acceptTransaction call)', () => {
    assert(row1.acceptedAt, 'acceptedAt not set — auto-accept did not fire');
    assert(row1.dispatchDeadlineAt, 'dispatchDeadlineAt not set');
    eq(row1.paymentStatus, 'HELD', 'paymentStatus');
  });

  // GG (the house seller) dispatches + buyer confirms delivery → RELEASED.
  await T.confirmDispatch(created1.transactionId, house.clerkId, {});
  await T.confirmDelivery(created1.transactionId, buyer.clerkId);
  const row1r = await tx(ctx, created1.transactionId);
  check(rep, 'house deal: released after delivery', () => {
    eq(row1r.paymentStatus, 'RELEASED', 'paymentStatus');
    assert(row1r.releasedAt, 'releasedAt not set');
  });
  check(rep, 'house deal: money conserved (GG keeps all bar carrier; no seller cut)', () =>
    assertHouseConserves(row1r),
  );

  // Payout batch MUST skip the house row (sellerPayout=0 → excluded).
  await drainPayouts(ctx);
  const row1p = await tx(ctx, created1.transactionId);
  check(rep, 'house deal: payout SKIPPED (GG never pays itself)', () => {
    assert(row1p.paidOutAt === null, 'paidOutAt should stay null for a house deal');
  });
  rep.money({
    label: 'Daily Deal (released)',
    buyerPaid: row1r.buyerTotal,
    sellerPaid: 0,
    ggRevenue: row1r.buyerTotal - row1r.shippingCost,
    carrier: row1r.shippingCost,
    refunded: 0,
  });

  // ── (2) Per-customer cap rejection ───────────────────────────────────
  const d2 = await makeDeal(ctx, {
    dealPriceCents: 120_000,
    wasPriceCents: 200_000,
    costPriceCents: 80_000,
    initialStock: 5, // ample stock — the CAP, not inventory, must reject
    perCustomerCap: 1,
  });
  await T.create(
    buyer.clerkId,
    { listingId: d2.listingId, shippingMethod: 'PUDO', pudoPickupLockerId: 'L-TEST-001' } as any,
    'http://localhost',
  );
  const cap = await safeStep(rep, 'per-customer cap: 2nd purchase over the cap is rejected', async () => {
    let threw = false;
    try {
      await T.create(
        buyer.clerkId,
        { listingId: d2.listingId, shippingMethod: 'PUDO', pudoPickupLockerId: 'L-TEST-001' } as any,
        'http://localhost',
      );
    } catch {
      threw = true;
    }
    assert(threw, 'second over-cap purchase should have thrown');
  });
  void cap;

  // ── (3) SOLD_OUT sync when stock exhausts ────────────────────────────
  const d3 = await makeDeal(ctx, {
    dealPriceCents: 90_000,
    wasPriceCents: 150_000,
    costPriceCents: 50_000,
    initialStock: 1, // single unit → sells out on the first sale
    perCustomerCap: 10,
  });
  const created3: any = await T.create(
    buyer.clerkId,
    { listingId: d3.listingId, shippingMethod: 'PUDO', pudoPickupLockerId: 'L-TEST-001' } as any,
    'http://localhost',
  );
  await simulatePaid(ctx, created3.transactionId);
  await settleTick(); // syncDealSoldOut fires fire-and-forget in markPaid
  const listing3 = await P(ctx).listing.findUnique({ where: { id: d3.listingId } });
  const deal3 = await P(ctx).deal.findUnique({ where: { id: d3.dealId } });
  check(rep, 'sold-out sync: last unit → listing SOLD + Deal SOLD_OUT', () => {
    eq(listing3.status, 'SOLD', 'listing.status');
    eq(deal3.status, 'SOLD_OUT', 'deal.status');
    assert(deal3.soldOutAt, 'soldOutAt not stamped');
  });
  // Close out the sold-out sale (it auto-accepted at payment) so it settles
  // and doesn't linger as held client funds in the final ledger.
  await waitFor(() => tx(ctx, created3.transactionId), (r) => !!r?.acceptedAt, { tries: 60, gap: 50 });
  await T.confirmDispatch(created3.transactionId, house.clerkId, {});
  await T.confirmDelivery(created3.transactionId, buyer.clerkId);
  const row3r = await tx(ctx, created3.transactionId);
  await drainPayouts(ctx);
  rep.money({
    label: 'Daily Deal (sold-out unit)',
    buyerPaid: row3r.buyerTotal,
    sellerPaid: 0,
    ggRevenue: row3r.buyerTotal - row3r.shippingCost,
    carrier: row3r.shippingCost,
    refunded: 0,
  });

  // ── (4) Refund → synthetic child + conservation (Zoho credit-note no-op) ──
  const d4 = await makeDeal(ctx, {
    dealPriceCents: 130_000,
    wasPriceCents: 220_000,
    costPriceCents: 90_000,
    initialStock: 5,
    perCustomerCap: 10,
  });
  const created4: any = await T.create(
    buyer.clerkId,
    { listingId: d4.listingId, shippingMethod: 'PUDO', pudoPickupLockerId: 'L-TEST-001' } as any,
    'http://localhost',
  );
  await simulatePaid(ctx, created4.transactionId);
  await settleTick();
  const admin = await P(ctx).adminUser.findFirst();
  const parent4 = await tx(ctx, created4.transactionId);
  await svc(ctx, AdminService).refundTransaction(
    created4.transactionId,
    admin.id,
    'Daily Deal dummy-run refund',
  );
  const parent4r = await tx(ctx, created4.transactionId);
  const children4 = await P(ctx).transaction.findMany({ where: { refundOfId: created4.transactionId } });
  check(rep, 'house-deal refund: parent REFUNDED + synthetic child minted for the buyer', () => {
    eq(parent4r.paymentStatus, 'REFUNDED', 'parent paymentStatus');
    assert(children4.length === 1, `expected 1 refund child, got ${children4.length}`);
    eq(children4[0].buyerTotal, parent4.buyerTotal, 'child buyerTotal');
    eq(children4[0].sellerPayout, 0, 'child sellerPayout');
  });
  // Settle the refund so the buyer is paid exactly once + no lingering liability.
  await drainPayouts(ctx);
  rep.money({
    label: 'Daily Deal (refunded)',
    buyerPaid: parent4.buyerTotal,
    sellerPaid: 0,
    ggRevenue: 0,
    carrier: 0,
    refunded: parent4.buyerTotal,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// FINAL: held-funds ledger must balance (everything settled → 0 client funds)
// ─────────────────────────────────────────────────────────────────────────
export async function moduleFinalLedger(ctx: Ctx) {
  const rep = ctx.rep;
  const mp = svc(ctx, ManualPaymentsService);

  // Drain anything still due, then assert the held-funds report balances.
  await settleTick(400);
  await drainPayouts(ctx);
  await settleTick(200);
  const report: any = await mp.getHeldFundsReport();
  console.log(
    `  [held-funds] held=${report.heldAwaitingRelease.cents} owedSellers=${report.owedToSellers.cents} ` +
      `owedRefunds=${report.owedToBuyerRefunds.cents} swapCash=${report.swapCashHeld.cents} ` +
      `swapFunding=${report.swapFundingInFlight.cents} TOTAL=${report.totalClientFundsCents}`,
  );
  check(rep, 'HELD-FUNDS: no funds left owed to sellers after settlement', () =>
    eq(report.owedToSellers.cents, 0, 'owedToSellers'),
  );
  check(rep, 'HELD-FUNDS: no swap cash / funding left in flight', () => {
    eq(report.swapCashHeld.cents, 0, 'swapCashHeld');
    eq(report.swapFundingInFlight.cents, 0, 'swapFundingInFlight');
  });
  check(rep, 'HELD-FUNDS: total client funds fully settled to 0', () =>
    eq(report.totalClientFundsCents, 0, 'totalClientFundsCents'),
  );
  rep.money({
    label: 'HELD-FUNDS closing balance',
    buyerPaid: 0,
    sellerPaid: 0,
    ggRevenue: 0,
    carrier: 0,
    refunded: 0,
    note: `getHeldFundsReport totalClientFundsCents = ${report.totalClientFundsCents}`,
  });
}
