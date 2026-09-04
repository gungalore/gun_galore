/**
 * THE DESK — one order, end to end.
 *
 * Wraps GET admin/transactions/:id/dossier (AdminService.getTransactionDossier)
 * for the Order drawer, which replaces the legacy /admin/transactions/[id] and
 * — through the parent Order this row belongs to — /admin/orders/[id].
 *
 * ⚠️ MONEY IS RENDERED, NEVER DERIVED. The platform has exactly one fee
 * builder, backend payments/fee-presentation.ts, because two economic models
 * write IDENTICAL columns and eight surfaces each guessed at them until a
 * receipt stopped footing against its own lines. This dossier endpoint does
 * NOT run that builder — it returns the raw columns — so this module hands the
 * drawer those columns AS RECORDED and computes nothing from them. No sums, no
 * percentages, no fee inferred from a price. Where the meaning of a column
 * depends on feeModel, we say which model the row ran under and quote what
 * that model means; we never restate it as arithmetic.
 *
 * ⚠️ CENTS IN, CENTS OUT — the same rule the backend builder keeps. Nothing
 * here formats money; the drawer renders with formatRand from the kit.
 * Formatting inside the data layer is how a rand float ends up 1c out on a row.
 *
 * 🚨 PRIVACY. The endpoint hands back far more about the two members than this
 * drawer has any business showing: buyer.email, buyer.phone, seller.email,
 * seller.phone, seller.bankName, seller.bankAccountHolder,
 * seller.bankAccountNumber, the buyer's deliveryAddress, and the seller-only
 * carrierDropoffPin. NONE of them are declared in the types below, so a later
 * edit that reaches for one is a compile error rather than a leak. The
 * decisions this drawer supports — is the money right, where is the parcel,
 * why is the payout stuck — need none of them. Payout readiness is expressed
 * as "bank verified: yes/no", which is the fact the operator needs without
 * putting an account number on a shared screen.
 */
import { deskFetch } from './desk-auth';

/* ────────────────────────────────────────────────────────────────────────
 * The shape of the dossier — only the fields this surface renders
 * ──────────────────────────────────────────────────────────────────────── */

export type FeeModel = 'BUYNOW_MARKUP' | 'SELLER_DEDUCT';

/**
 * A party to the sale.
 *
 * Username only, plus the facts that gate a payout. Deliberately no contact
 * details and no bank detail — see the privacy note at the top of the file.
 */
export interface OrderParty {
  id: string;
  username: string | null;
  kycStatus: string | null;
  sellerTier: string | null;
  /** Seller only. A timestamp we read as a yes/no; never the account itself. */
  bankVerifiedAt?: string | null;
  profileCompletedAt?: string | null;
}

export interface OrderListing {
  id: string;
  referenceNumber: string | null;
  title: string;
  listingType: string | null;
  isFirearm: boolean;
  images: { url: string }[];
}

/** The dealer a firearm is transferred through. A business, not a person. */
export interface OrderDealer {
  id: string;
  name: string;
  licenceNumber: string | null;
  city: string | null;
}

export interface OrderTrackingEvent {
  id: string;
  status: string;
  /** The carrier's own word for it, kept verbatim beside our enum. */
  rawStatus: string | null;
  source: string | null;
  message: string | null;
  occurredAt: string;
}

/** One line of the parent cart, for the "item N of M" parcel view. */
export interface OrderSiblingLine {
  id: string;
  paymentStatus: string;
  shippingMethod: string | null;
  shippingStatus: string | null;
  shipsWithId: string | null;
  buyerTotal: number;
  listing: { title: string; referenceNumber: string | null } | null;
}

export interface ParentOrder {
  id: string;
  orderReference: string;
  status: string;
  paidAt: string | null;
  buyerTotal: number;
  createdAt: string;
  _count: { lineItems: number };
  transactions: OrderSiblingLine[];
}

export interface OrderRating {
  id: string;
  stars: number;
  comment: string | null;
  createdAt: string;
}

export interface OrderComplaint {
  id: string;
  referenceNumber: string;
  category: string;
  subject: string;
  body: string;
  status: string;
  outcome: string | null;
  /** True when lodging it flipped the order to DISPUTED and froze the payout. */
  drovePayoutHold: boolean;
  createdAt: string;
  resolvedAt: string | null;
  user: { id: string; username: string | null } | null;
  photos: { id: string; url: string }[];
}

export interface OrderAuditEvent {
  id: string;
  action: string;
  reason: string | null;
  createdAt: string;
  /** The admin who acted. Naming the actor is the entire point of an audit line. */
  adminUser: { email: string } | null;
}

export interface OrderTransaction {
  id: string;
  createdAt: string;
  quantity: number;

  // Money — every one of these is a stored column, rendered as recorded.
  feeModel: FeeModel;
  listingPrice: number;
  commissionZar: number;
  processingFee: number;
  shippingCost: number;
  shippingHandlingCents: number;
  buyerTotal: number;
  sellerPayout: number;
  passFeeToBuyer: boolean;
  refundedAmount: number;
  failedShipmentChargeCents: number;

  // Payment lifecycle
  paymentStatus: string;
  paidAt: string | null;
  acceptedAt: string | null;
  acceptDeadlineAt: string | null;
  rejectedAt: string | null;
  rejectedReason: string | null;
  cancelledByBuyerAt: string | null;
  cancelledReason: string | null;
  sellerKycClearedAt: string | null;
  releasedAt: string | null;
  paidOutAt: string | null;
  lastRefundAt: string | null;
  payoutHeldAt: string | null;
  payoutHoldReason: string | null;

  // Gateway — diagnostic identifiers, shown raw.
  peachCheckoutId: string | null;
  peachMerchantRef: string | null;
  peachPaymentId: string | null;
  peachPayoutId: string | null;
  peachResultCode: string | null;

  // Risk signals, computed after capture. Log-only; they never blocked payment.
  riskScore: number;
  riskFlags: string[];

  // Shipping
  shippingMethod: string | null;
  shippingStatus: string | null;
  shippingServiceCode: string | null;
  carrierProvider: string | null;
  trackingReference: string | null;
  shipmentBookedAt: string | null;
  dispatchedAt: string | null;
  dispatchDeadlineAt: string | null;
  estimatedDeliveryAt: string | null;
  deliveredAt: string | null;
  confirmedDeliveryAt: string | null;
  podReference: string | null;
  shipmentFailureReason: string | null;
  shipmentFailureNote: string | null;
  shipmentFailureAt: string | null;
  shipmentRebookCount: number;

  // Firearm transfer through a dealer
  dealerVerificationStatus: string | null;
  dealerVerifiedAt: string | null;
  dealerStockRegisterRef: string | null;
  /**
   * The evidence the dealer uploaded, and the model's read of it.
   *
   * 🚨 THESE WERE ALWAYS ON THE WIRE AND SIMPLY NOT DECLARED HERE.
   * getTransactionDossier uses Prisma `include` with no top-level `select`, so
   * every Transaction scalar has been arriving since the drawer was written —
   * the fold rendered a status with no way to see what the status was reached
   * FROM. An operator asked to override a machine verdict on a firearm payout
   * with none of the machine's inputs in front of them is being asked to
   * rubber-stamp it.
   */
  saps534PhotoUrl: string | null;
  stockRegisterPhotoUrl: string | null;
  firearmSerialPhotoUrl: string | null;
  dealerVerificationScore: number | null;
  dealerVerifyAttempts: number;

  /**
   * Zoho Books commission posting.
   *
   * ⚠️ ALSO ALREADY ON THE WIRE, ALSO NEVER RENDERED. A failed Books post is
   * money that left the platform without an invoice behind it, and until now
   * the Desk showed no sign of one — zohoSyncStatus 'FAILED' looked exactly
   * like a healthy sale. The backend's own comment describes a "ZohoSyncPanel
   * Retry button" that has never existed in any version of this frontend.
   */
  zohoCommissionInvoiceId: string | null;
  zohoCommissionPaymentId: string | null;
  zohoSyncStatus: string | null;
  zohoSyncError: string | null;
  zohoSyncLastAttemptAt: string | null;

  listing: OrderListing;
  buyer: OrderParty;
  seller: OrderParty;
  dealer: OrderDealer | null;
  trackingEvents: OrderTrackingEvent[];
  order: ParentOrder | null;
  rating: OrderRating | null;
}

export interface OrderDossier {
  transaction: OrderTransaction;
  auditEvents: OrderAuditEvent[];
  complaints: OrderComplaint[];
}

export function fetchOrderDossier(transactionId: string): Promise<OrderDossier> {
  return deskFetch<OrderDossier>(
    `/admin/transactions/${encodeURIComponent(transactionId)}/dossier`,
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Identity
 * ──────────────────────────────────────────────────────────────────────── */

export interface OrderReference {
  value: string;
  /** Which identifier this actually is, so the operator can search on it. */
  source: 'order' | 'gateway' | 'transaction';
}

/**
 * The reference to put in the drawer header.
 *
 * ⚠️ A CART CHILD HAS NO REFERENCE OF ITS OWN. The buyer-facing GG-ORD number
 * lives on the parent Order; a single-item sale has no Order row at all and is
 * known to the gateway only by its short merchant ref. Falling back through
 * the three in this order is what makes one header work for both shapes — and
 * naming which one we landed on is what stops an operator pasting a
 * transaction cuid into a search that only knows order numbers.
 */
export function orderReferenceOf(tx: OrderTransaction): OrderReference {
  if (tx.order?.orderReference) return { value: tx.order.orderReference, source: 'order' };
  if (tx.peachMerchantRef) return { value: tx.peachMerchantRef, source: 'gateway' };
  return { value: tx.id, source: 'transaction' };
}

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';

/** The payment state, toned. Colour is state here, never decoration. */
export function paymentTone(status: string): Tone {
  switch (status) {
    case 'RELEASED':
      return 'ok';
    case 'DISPUTED':
      return 'bad';
    case 'REFUNDED':
    case 'PENDING_ADMIN_VERIFICATION':
      return 'warn';
    case 'HELD':
      return 'info';
    default:
      return 'neutral';
  }
}

/** "2 Sep, 14:32". An em dash for a stamp that was never set. */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    // SAST explicitly, matching desk-listing.ts's stamp() and desk-site.ts's.
    // Without it this rendered in the BROWSER's zone, so the same event
    // showed one time on this surface and another on those — and an
    // operator abroad, or on a machine with a wrong clock, read every
    // Desk timestamp shifted. The Desk is one product; a timestamp has to
    // mean the same thing on all five surfaces.
    year: 'numeric',
    hour12: false,
    timeZone: 'Africa/Johannesburg',
  });
}

/** Enum to prose: DELIVERY_FAILED becomes "Delivery failed". */
export function humanise(value: string | null | undefined): string {
  if (!value) return '—';
  const words = value.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/* ────────────────────────────────────────────────────────────────────────
 * Money — as recorded, and nothing else
 * ──────────────────────────────────────────────────────────────────────── */

export interface RecordedAmount {
  label: string;
  /** Integer cents, straight off the column. The drawer formats it. */
  cents: number;
  /** Provenance — what the column is. Never a calculation. */
  note?: string;
}

export interface OrderMoney {
  buyerPaidCents: number;
  sellerReceivesCents: number;
  refundedCents: number;
  wastedCourierCents: number;
  feeModel: FeeModel;
  /** One sentence naming where our fee sat, per the model on the row. */
  feeModelNote: string;
  /** Short label for the model — for a tag. */
  feeModelLabel: string;
  recorded: RecordedAmount[];
}

/**
 * The money on this sale, exactly as the row stores it.
 *
 * ⚠️ NOTHING IS ADDED UP HERE, ON PURPOSE. Under BUYNOW_MARKUP the commission
 * and the gateway fee are ALREADY INSIDE listingPrice, so an "item + fee"
 * line would double-count our own cut; under SELLER_DEDUCT they sit outside
 * it, and whether the buyer or the seller carried the gateway fee depends on
 * passFeeToBuyer. Both models write the same columns, which is why the
 * platform keeps one builder for the buyer's receipt and the seller's
 * statement (backend payments/fee-presentation.ts) and why this admin surface
 * refuses to become a ninth guess. buyerTotal and sellerPayout are the two
 * numbers that were actually charged and actually owed; everything else is
 * shown as a labelled column with the model stated beside it.
 *
 * The sentences below are the model's meaning as fee-presentation.ts itself
 * words it — a restatement of a stored enum, not a derivation.
 */
export function orderMoney(tx: OrderTransaction): OrderMoney {
  const markup = tx.feeModel === 'BUYNOW_MARKUP';

  const recorded: RecordedAmount[] = [
    {
      label: 'Item price',
      cents: tx.listingPrice,
      note: tx.quantity > 1 ? `${tx.quantity} units — line total` : undefined,
    },
  ];

  // The carrier rate and our handling margin are stored apart because they are
  // different obligations at payout time. The BUYER only ever sees one
  // delivery figure; the operator settling with a carrier needs them split.
  if (tx.shippingCost > 0) {
    recorded.push({
      label: 'Carrier rate',
      cents: tx.shippingCost,
      note: 'remitted to the carrier',
    });
  }
  if (tx.shippingHandlingCents > 0) {
    recorded.push({
      label: 'Handling',
      cents: tx.shippingHandlingCents,
      note: 'we keep this — the buyer saw one delivery figure',
    });
  }
  if (tx.commissionZar > 0) {
    recorded.push({
      label: 'Commission',
      cents: tx.commissionZar,
      note: markup ? 'inside the item price' : 'off the seller',
    });
  }
  if (tx.processingFee > 0) {
    recorded.push({
      label: 'Gateway fee',
      cents: tx.processingFee,
      // passFeeToBuyer is MEANINGLESS on a markup row — the fee was never a
      // separate charge there — so read feeModel first, always.
      note: markup
        ? 'inside the item price'
        : tx.passFeeToBuyer
          ? 'charged to the buyer'
          : 'off the seller',
    });
  }

  return {
    buyerPaidCents: tx.buyerTotal,
    sellerReceivesCents: tx.sellerPayout,
    refundedCents: tx.refundedAmount,
    wastedCourierCents: tx.failedShipmentChargeCents,
    feeModel: tx.feeModel,
    feeModelLabel: markup ? 'Fees in the price' : 'Fees off the seller',
    feeModelNote: markup
      ? 'Our commission and the gateway fee were built into the listed price. The buyer paid the listed number; the seller receives their full ask and nothing was deducted from them.'
      : tx.passFeeToBuyer
        ? 'Fees sit outside the listed price. The buyer was charged the gateway fee; our commission comes off the sale price.'
        : 'Fees sit outside the listed price. Our commission and the gateway fee both come off the sale price.',
    recorded,
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * Timelines
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Structurally the kit's TimelineStep.
 *
 * Declared here rather than imported so a data module never depends on a
 * 'use client' component file; the shapes are identical, so these still pass
 * straight into Timeline.
 */
export interface OrderStep {
  title: string;
  sub?: string;
  state: 'done' | 'now' | 'bad' | 'todo';
}

interface Stamped extends OrderStep {
  at: string;
}

function line(at: string, ...rest: (string | null | undefined)[]): string {
  return [formatWhen(at), ...rest.filter(Boolean)].join(' · ');
}

const overdue = (deadline: string | null): boolean =>
  !!deadline && new Date(deadline).getTime() < Date.now();

function sortAndStrip(stamped: Stamped[]): OrderStep[] {
  return [...stamped]
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .map(({ title, sub, state }) => ({ title, sub, state }));
}

/**
 * What has happened to the money, oldest first, then where it is waiting.
 *
 * ⚠️ ONLY STAMPS THAT EXIST ARE DRAWN. A milestone with no timestamp did not
 * happen, and a grey placeholder for every one of them buries the three lines
 * that matter under nine that do not. The single trailing step is the
 * exception: the operator's real question is "what is this waiting on", and a
 * stuck order should say so in the timeline rather than by omission.
 */
export function paymentTimeline(tx: OrderTransaction): OrderStep[] {
  const events: Stamped[] = [];
  const done = (title: string, at: string | null, sub?: string | null) => {
    if (at) events.push({ title, sub: line(at, sub), state: 'done', at });
  };
  const bad = (title: string, at: string | null, sub?: string | null) => {
    if (at) events.push({ title, sub: line(at, sub), state: 'bad', at });
  };

  done('Order created', tx.createdAt);
  done('Buyer paid', tx.paidAt);
  bad('Buyer cancelled', tx.cancelledByBuyerAt, tx.cancelledReason);
  done('Seller accepted', tx.acceptedAt);
  bad('Seller rejected', tx.rejectedAt, tx.rejectedReason);
  done('Seller KYC cleared', tx.sellerKycClearedAt);
  bad('Refunded', tx.lastRefundAt, 'amount under Money');
  bad('Payout held', tx.payoutHeldAt, tx.payoutHoldReason);
  done('Funds released to seller', tx.releasedAt);
  done('Payout settled', tx.paidOutAt);

  const steps = sortAndStrip(events);
  const waiting = paymentWaitingOn(tx);
  if (waiting) steps.push(waiting);
  return steps;
}

function paymentWaitingOn(tx: OrderTransaction): OrderStep | null {
  if (tx.rejectedAt || tx.cancelledByBuyerAt) return null;
  if (!tx.paidAt) return { title: 'Awaiting payment', state: 'now' };
  if (!tx.acceptedAt) {
    const late = overdue(tx.acceptDeadlineAt);
    return {
      title: 'Awaiting seller accept',
      sub: `${late ? 'overdue since' : 'due'} ${formatWhen(tx.acceptDeadlineAt)}`,
      state: late ? 'bad' : 'now',
    };
  }
  if (tx.payoutHeldAt) return { title: 'Payout held by an admin', state: 'bad' };
  if (!tx.releasedAt) return { title: 'Funds held', state: 'now' };
  if (!tx.paidOutAt) return { title: 'Payout due', state: 'now' };
  return null;
}

/** Carrier-less methods: nothing books, nothing tracks, nobody dispatches. */
const NO_CARRIER = new Set([
  'DEALER_TRANSFER',
  'PRIVATE_ARRANGE',
  'COLLECTION',
  'ON_SITE_SERVICE',
]);

/**
 * Where the item is.
 *
 * ⚠️ THE CARRIER'S OWN WORD IS KEPT BESIDE OURS. rawStatus is what the courier
 * actually said; our enum is a mapping of it. When a parcel is wedged, the
 * difference between the two is usually the whole answer.
 */
export function shippingTimeline(tx: OrderTransaction): OrderStep[] {
  const events: Stamped[] = [];
  const done = (title: string, at: string | null, sub?: string | null) => {
    if (at) events.push({ title, sub: line(at, sub), state: 'done', at });
  };

  done('Shipment booked', tx.shipmentBookedAt, tx.carrierProvider);
  done('Dispatched', tx.dispatchedAt);

  for (const e of tx.trackingEvents) {
    const failed = e.status === 'DELIVERY_FAILED' || e.status === 'RETURNED';
    events.push({
      title: humanise(e.status),
      sub: line(e.occurredAt, e.rawStatus, e.source, e.message),
      state: failed ? 'bad' : 'done',
      at: e.occurredAt,
    });
  }

  if (tx.shipmentFailureAt) {
    events.push({
      title: 'Shipment failed',
      sub: line(
        tx.shipmentFailureAt,
        humanise(tx.shipmentFailureReason),
        tx.shipmentFailureNote,
      ),
      state: 'bad',
      at: tx.shipmentFailureAt,
    });
  }

  done('Dealer stock-in verified', tx.dealerVerifiedAt, tx.dealerStockRegisterRef);
  done('Delivered', tx.deliveredAt, tx.podReference);
  done('Buyer confirmed', tx.confirmedDeliveryAt);

  const steps = sortAndStrip(events);
  const waiting = shippingWaitingOn(tx);
  if (waiting) steps.push(waiting);
  return steps;
}

function shippingWaitingOn(tx: OrderTransaction): OrderStep | null {
  if (!tx.paidAt || tx.rejectedAt || tx.cancelledByBuyerAt) return null;
  if (tx.confirmedDeliveryAt) return null;

  if (NO_CARRIER.has(tx.shippingMethod ?? '')) {
    // No courier leg exists on these, so the only honest waiting-line is the
    // hand-over itself — which for a firearm is the dealer's stock-in.
    if (tx.shippingMethod === 'DEALER_TRANSFER' && tx.dealerVerificationStatus !== 'APPROVED') {
      return {
        title: 'Awaiting dealer stock-in verification',
        sub: humanise(tx.dealerVerificationStatus ?? 'not started'),
        state: 'now',
      };
    }
    if (tx.deliveredAt) return { title: 'Awaiting buyer confirmation', state: 'now' };
    return { title: 'Awaiting hand-over', state: 'now' };
  }

  if (!tx.dispatchedAt) {
    const late = overdue(tx.dispatchDeadlineAt);
    return {
      title: 'Awaiting dispatch',
      sub: tx.dispatchDeadlineAt
        ? `${late ? 'overdue since' : 'due'} ${formatWhen(tx.dispatchDeadlineAt)}`
        : undefined,
      state: late ? 'bad' : 'now',
    };
  }
  if (!tx.deliveredAt) {
    return {
      title: 'In transit',
      sub: tx.estimatedDeliveryAt
        ? `expected by ${formatWhen(tx.estimatedDeliveryAt)}`
        : undefined,
      state: 'now',
    };
  }
  return { title: 'Awaiting buyer confirmation', state: 'now' };
}

/* ────────────────────────────────────────────────────────────────────────
 * Gateway result codes
 * ──────────────────────────────────────────────────────────────────────── */

export type ResultBucket = 'success' | 'pending' | 'rejected' | 'none';

/**
 * ⚠️ MIRRORS backend payments/peach-signature.ts, classifyResultCode. Those
 * three patterns are the OPPWA standard set and they are what the platform
 * itself acted on when this payment came in — so they are the only honest
 * "meaning" to put beside the code. If that file's patterns change, change
 * these with them; better still, have the dossier return the bucket and
 * delete this block (see the handover note).
 */
const SUCCESS = /^(000\.000\.|000\.100\.1|000\.[36]0)/;
const SUCCESS_MANUAL_REVIEW = /^(000\.400\.0[^3]|000\.400\.100)/;
const PENDING = /^(000\.200|800\.400\.5|100\.400\.500)/;

export interface ResultCodeReading {
  code: string | null;
  bucket: ResultBucket;
  /** What the platform took the code to mean. NEVER a friendlier rewording. */
  meaning: string;
}

/**
 * ⚠️ NOT PARAPHRASED. A gateway code is diagnostic: the operator reads it to a
 * support line or pastes it into the gateway's own docs, so the raw string is
 * the payload and this sentence is only the classification our own code
 * applied to it. Never invent a customer-facing phrasing for one of these.
 */
export function readResultCode(code: string | null): ResultCodeReading {
  if (!code) {
    // ⚠️ AN ABSENT CODE IS NOT EVIDENCE OF AN ABSENT ATTEMPT. This once read
    // "this sale never reached the gateway", which is false for the single
    // most interesting row that lands here: transactions.service.ts writes
    // peachResultCode ONLY on the successful-capture claim, while
    // peachCheckoutId is written when the checkout is created — so a payment
    // the gateway DECLINED reaches this branch with a checkout id sitting
    // right beside it in the identifier list. State the absence; let the
    // identifiers say whether anything was attempted.
    return {
      code: null,
      bucket: 'none',
      meaning:
        'No result code recorded. The platform stores one only alongside a successful capture, so a declined or abandoned checkout also shows nothing here — check the identifiers below for whether one was ever created.',
    };
  }
  if (SUCCESS.test(code) || SUCCESS_MANUAL_REVIEW.test(code)) {
    return {
      code,
      bucket: 'success',
      meaning: 'Classified by the platform as a successful payment.',
    };
  }
  if (PENDING.test(code)) {
    return { code, bucket: 'pending', meaning: 'Classified by the platform as pending.' };
  }
  return {
    code,
    bucket: 'rejected',
    meaning:
      'Classified by the platform as rejected. Anything the success and pending patterns do not match falls here, an unrecognised code included.',
  };
}

export function resultTone(bucket: ResultBucket): Tone {
  if (bucket === 'success') return 'ok';
  if (bucket === 'pending') return 'warn';
  if (bucket === 'rejected') return 'bad';
  return 'neutral';
}

export interface GatewayIdentifier {
  label: string;
  value: string;
}

/** The identifiers, in the order support asks for them. Nulls are dropped. */
export function gatewayIdentifiers(tx: OrderTransaction): GatewayIdentifier[] {
  const rows: { label: string; value: string | null }[] = [
    { label: 'Merchant ref', value: tx.peachMerchantRef },
    { label: 'Checkout ID', value: tx.peachCheckoutId },
    { label: 'Payment ID', value: tx.peachPaymentId },
    { label: 'Payout ID', value: tx.peachPayoutId },
    { label: 'Transaction ID', value: tx.id },
  ];
  return rows.filter((r): r is GatewayIdentifier => r.value !== null);
}

/* ────────────────────────────────────────────────────────────────────────
 * Parcel
 * ──────────────────────────────────────────────────────────────────────── */

export interface ParcelPosition {
  index: number;
  total: number;
}

/**
 * "Item 2 of 3" — where this line sits in its parent cart.
 *
 * Null for a single-item sale, which is every Phase 1–7 checkout: those have
 * no Order row at all, and drawing "item 1 of 1" on them is noise.
 */
export function parcelPosition(tx: OrderTransaction): ParcelPosition | null {
  const order = tx.order;
  if (!order || order._count.lineItems <= 1) return null;
  const index = order.transactions.findIndex((t) => t.id === tx.id);
  // ⚠️ NO POSITION RATHER THAN A GUESSED ONE. The dossier selects every one of
  // the parent's lines unfiltered, so this line is always among them and the
  // branch is unreachable today — but it previously fell back to "item 1 of
  // N", which is a specific claim about where a parcel sits, invented at the
  // exact moment we have stopped being able to tell.
  if (index < 0) return null;
  return { index: index + 1, total: order._count.lineItems };
}

/**
 * The line a money lever acts on, and the lines it does not.
 */
export interface ActingLine {
  title: string;
  index: number;
  total: number;
}

/** One row of a money confirm — a label and the words under it. */
export interface ConfirmRow {
  k: string;
  v: string;
}

/**
 * Put the LINE into a money confirm, and say what the act leaves alone.
 *
 * 🚨 THE CONFIRM IS THE SAFETY RAIL AND IT WAS MISSING ITS SUBJECT. Money on
 * an order is per-LINE, never per-order: the server refuses a full refund of
 * a consolidated carrier line while its siblings are still held, in an order
 * the operator cannot predict from the screen. That is why there is no
 * "refund the order" button anywhere — you pick a line first.
 *
 * But the confirm then named the amount and the recipient and never the line,
 * so on a three-line cart every lever read identically whichever line was
 * selected. The operator's last chance to notice they are about to refund the
 * scope instead of the rifle said nothing about either.
 *
 * ⚠️ THE 'Then' ROW IS EXTENDED, NOT REPLACED. It already says what follows;
 * what it never said is what does NOT follow. "The other two lines are
 * untouched" is the half an operator needs to act quickly without being
 * reckless — and it is the exact wording the artboard specifies.
 *
 * Null `line` is a single-line sale. Nothing is added: "1 of 1" and "the
 * other 0 lines are untouched" are both noise, and noise on a money confirm
 * is how people learn to tap through them.
 */
export function withLineContext(rows: ConfirmRow[], line: ActingLine | null): ConfirmRow[] {
  if (!line) return rows;

  const siblings = Math.max(0, line.total - 1);
  const untouched =
    siblings === 0
      ? ''
      : siblings === 1
        ? ' The other line is untouched.'
        : ` The other ${siblings} lines are untouched.`;

  const out = [...rows];
  const lineRow: ConfirmRow = {
    k: 'Line',
    v: `${line.title} — ${line.index} of ${line.total}`,
  };

  const thenAt = out.findIndex((r) => r.k === 'Then');
  if (thenAt < 0) {
    out.push(lineRow);
    return out;
  }
  // The line is stated BEFORE the consequence: what is being acted on, then
  // what follows from it.
  out.splice(thenAt, 0, lineRow);
  const then = out[thenAt + 1];
  out[thenAt + 1] = { ...then, v: `${then.v}${untouched}` };
  return out;
}

/* ── Actions ────────────────────────────────────────────────────────────
 *
 * 🚨 THESE MOVE REAL MONEY, AND NONE OF THEM UNDOES. Every one is a POST the
 * legacy admin already exposes — this is parity, not a new money path — and
 * every one writes an audit row against the acting admin.
 *
 * ⚠️ THE AMOUNT IS NEVER COMPUTED HERE. A refund either clears the remaining
 * balance (send no amount) or clears a figure the operator typed. Nothing in
 * this module derives an amount from a price, a fee or a percentage: the
 * platform has one fee presenter and this is not it.
 */

/** Reasons shorter than this are refused by the server, so refuse them here. */
export const MIN_REASON_CHARS = 5;

export function reasonIsUsable(reason: string): boolean {
  return reason.trim().length >= MIN_REASON_CHARS;
}

/** Release the held funds to the seller. */
export function releaseOrder(txId: string, note: string): Promise<unknown> {
  return deskFetch(`/admin/transactions/${encodeURIComponent(txId)}/release`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

/** Release funds as the resolution of a dispute — a different audit trail. */
export function resolveDisputeRelease(txId: string, note: string): Promise<unknown> {
  return deskFetch(
    `/admin/transactions/${encodeURIComponent(txId)}/resolve-dispute-release`,
    { method: 'POST', body: JSON.stringify({ note }) },
  );
}

/**
 * Refund the buyer.
 *
 * ⚠️ OMITTING THE AMOUNT MEANS A FULL REFUND OF THE REMAINING BALANCE — that is
 * the server's rule, not a default this module invents. Pass cents only for a
 * deliberate partial, and never a figure derived from another column.
 */
export function refundOrder(
  txId: string,
  note: string,
  amountZarCents?: number,
): Promise<unknown> {
  return deskFetch(`/admin/transactions/${encodeURIComponent(txId)}/refund`, {
    method: 'POST',
    body: JSON.stringify(
      amountZarCents === undefined ? { note } : { note, amountZarCents },
    ),
  });
}

/** Withhold a payout that is due but not yet in a bank batch. */
export function holdPayout(txId: string, reason: string): Promise<unknown> {
  return deskFetch(`/admin/transactions/${encodeURIComponent(txId)}/hold-payout`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

/** Lift a payout hold, letting the next sweep pick the row up again. */
export function releasePayoutHold(txId: string, reason: string): Promise<unknown> {
  return deskFetch(
    `/admin/transactions/${encodeURIComponent(txId)}/release-payout-hold`,
    { method: 'POST', body: JSON.stringify({ reason }) },
  );
}

/**
 * Override the dealer stock-in verdict on a firearm transfer.
 *
 * 🚨 THIS IS THE LEVER THAT UNSTICKS A FIREARM PAYOUT. releaseTransaction
 * refuses any isFirearm + DEALER_TRANSFER sale whose dealerVerificationStatus
 * is not APPROVED, and the automated check is a model reading three uploaded
 * photos. When it says no and it is wrong, this is the only way the seller
 * ever gets paid — and it had a live endpoint that nothing in this frontend
 * called, so the money simply stopped.
 *
 * ⚠️ APPROVING DOES MORE THAN CLEAR A FLAG. The backend's adminOverride emails
 * and SMSes the seller the same outcome message the automated verdict would
 * have sent, and on APPROVE it also force-releases the held funds and sends
 * the buyer the dealer's contact details. It is a payout, not a tick.
 *
 * The reason is stored on the row and shown in the audit trail. Minimum five
 * characters, enforced here and again by the server.
 */
export function overrideDealerVerification(
  txId: string,
  decision: 'APPROVE' | 'REJECT',
  reason: string,
): Promise<unknown> {
  return deskFetch(
    `/admin/transactions/${encodeURIComponent(txId)}/dealer-verification/override`,
    { method: 'POST', body: JSON.stringify({ decision, reason }) },
  );
}

/**
 * Re-post a failed commission invoice to Zoho Books.
 *
 * Idempotent on the server — it creates the invoice only if absent and marks
 * it paid only if unpaid — so pressing it on a healthy sale is a no-op rather
 * than a double-post. That is what makes it safe to offer without a confirm.
 */
export function retryZohoPost(txId: string): Promise<unknown> {
  return deskFetch(`/admin/transactions/${encodeURIComponent(txId)}/zoho-retry`, {
    method: 'POST',
  });
}

/**
 * Is the Books posting in a state a human should act on?
 *
 * ⚠️ NULL IS NOT A FAILURE. A sale that has never needed a commission invoice
 * — not yet released, refunded before release — has no sync status at all, and
 * treating that as broken would put a red flag on most of the ledger. Only an
 * explicit FAILED is a failure; anything else unrecognised is reported as
 * itself rather than guessed at.
 */
export function zohoNeedsAttention(status: string | null): boolean {
  return (status ?? '').toUpperCase() === 'FAILED';
}
