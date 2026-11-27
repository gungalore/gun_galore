// ────────────────────────────────────────────────────────────────────
// /orders/[id] — THE PURE HALF.
//
// Multi-item checkout made the ORDER the buyer's unit: one payment, one page,
// many lines across sellers and delivery classes. This module turns the order
// payload into what the page renders — seller blocks, delivery class, one
// shipping row per seller accessories group, and the aggregated totals — so
// every branch is unit-tested without an authenticated page render.
//
// ⚠️ DEFENSIVE AGAINST AN OLDER PAYLOAD. The backend grows `lineItems[]`
// (sellerId, seller, deliveryClass, transaction.shippingCost) and adds
// `shippingGroups`/`canRemove` in parallel. Every read here falls back to what
// the pre-existing payload carried, because a page that crashes on a
// half-deployed API is worse than one that shows a slightly coarser grouping.
// ────────────────────────────────────────────────────────────────────

import { deliveryLabel } from './delivery-methods';
import { SHIPPING_STATUS, resolveStatus } from './status-labels';
import type { CartItem } from './cart-store';
import type { OrderSellerEntry } from './order-seller-ratings';

export type OrderDeliveryClass = 'GOODS' | 'FIREARM';

export interface OrderLineTransaction {
  id: string;
  paymentStatus: string;
  shippingStatus: string | null;
  shippingMethod: string | null;
  buyerTotal?: number;
  processingFee?: number;
  shippingCost?: number;
}

export interface OrderLineItem {
  id: string;
  /** Prisma scalar on OrderLineItem — always present on current payloads. */
  listingId?: string;
  sellerId?: string;
  seller?: { id: string; username: string | null } | null;
  deliveryClass?: OrderDeliveryClass;
  quantity: number;
  unitPrice: number;
  lineSubtotal: number;
  listing: { id: string; title: string; images?: { url: string }[] | null };
  transaction: OrderLineTransaction | null;
}

/** One seller accessories group's courier charge. */
export interface OrderShippingGroup {
  key: string;
  sellerId: string;
  sellerUsername: string | null;
  class: OrderDeliveryClass;
  transactionId: string;
  method: string;
  shippingCents: number;
}

export interface OrderDetail {
  id: string;
  status: string;
  orderReference: string | null;
  itemsSubtotal: number;
  shippingSubtotal: number;
  /** Retired delivery margin; folded into Delivery for historical rows. */
  handlingSubtotal?: number;
  processingFee?: number;
  buyerTotal: number;
  paidAt: string | null;
  createdAt: string;
  lineItems: OrderLineItem[];
  /** New in the multi-item payload — absent until the backend is live. */
  shippingGroups?: OrderShippingGroup[] | null;
  canRemove?: boolean;
  /** One entry per seller, with the rating that belongs to them. */
  sellers?: OrderSellerEntry[] | null;
}

export interface OrderSellerLines {
  sellerId: string;
  sellerName: string;
  goods: OrderLineItem[];
  firearms: OrderLineItem[];
  shipping: OrderShippingGroup[];
}

const UNKNOWN_SELLER = 'Anonymous seller';

/** The listing id a line points at (current scalar, or the joined row). */
export function orderLineListingId(line: OrderLineItem): string {
  return line.listingId ?? line.listing?.id ?? '';
}

/**
 * Goods vs firearm. Current payloads carry `deliveryClass`; older ones only
 * know the shipping method, so a DEALER_TRANSFER line is inferred as a firearm.
 */
export function orderLineDeliveryClass(
  line: OrderLineItem,
): OrderDeliveryClass {
  if (line.deliveryClass === 'GOODS' || line.deliveryClass === 'FIREARM') {
    return line.deliveryClass;
  }
  return line.transaction?.shippingMethod === 'DEALER_TRANSFER'
    ? 'FIREARM'
    : 'GOODS';
}

/** The member-facing delivery label for a line: Courier / Private / Dealer Stock. */
export function orderLineDeliveryLabel(line: OrderLineItem): string {
  const method =
    line.transaction?.shippingMethod ??
    (orderLineDeliveryClass(line) === 'FIREARM'
      ? 'DEALER_TRANSFER'
      : 'COURIER');
  return deliveryLabel(method);
}

/**
 * The courier progress for a line, or null. Only COURIER carries a parcel to
 * track; an in-person / dealer hand-over has no courier status to print.
 */
export function orderLineShippingStatus(line: OrderLineItem): string | null {
  if (line.transaction?.shippingMethod !== 'COURIER') return null;
  if (!line.transaction?.shippingStatus) return null;
  return resolveStatus(SHIPPING_STATUS, line.transaction.shippingStatus).label;
}

/** Full line subtitle: delivery class + (courier only) parcel progress. */
export function orderLineDeliveryText(line: OrderLineItem): string {
  const label = orderLineDeliveryLabel(line);
  const shipping = orderLineShippingStatus(line);
  return shipping ? `${label} · ${shipping}` : label;
}

/** The seller a line belongs to, with old-payload fallbacks. */
export function orderLineSellerId(
  line: OrderLineItem,
  sellerByTransaction?: Map<string, string>,
): string {
  if (line.sellerId) return line.sellerId;
  if (line.seller?.id) return line.seller.id;
  if (line.transaction?.id) {
    return sellerByTransaction?.get(line.transaction.id) ?? 'unknown';
  }
  return 'unknown';
}

/** The buyer-facing order reference (orderReference, else the id tail). */
export function orderReference(order: {
  id: string;
  orderReference?: string | null;
}): string {
  return (
    order.orderReference?.trim() ||
    order.id.slice(-8).toUpperCase()
  );
}

/** Units across the order — a 3-box line counts 3, not 1. */
export function orderItemCount(order: {
  lineItems?: Array<{ quantity?: number }> | null;
}): number {
  return (order.lineItems ?? []).reduce(
    (sum, line) => sum + Math.max(1, line.quantity ?? 1),
    0,
  );
}

/**
 * Group the order's lines into seller blocks, each split by delivery class.
 *
 * ⚠️ ONE TOGGLE = ONE SELLER+CLASS. The cart sold it that way, so the order
 * must read it back the same way: a seller with an accessory and a firearm is
 * two blocks with their own delivery words, never one blended list.
 */
export function orderSellerGroups(order: OrderDetail): OrderSellerLines[] {
  const sellerByTransaction = new Map<string, string>();
  const usernameBySeller = new Map<string, string>();
  for (const seller of order.sellers ?? []) {
    if (seller.transactionId) {
      sellerByTransaction.set(seller.transactionId, seller.sellerId);
    }
    if (seller.username) usernameBySeller.set(seller.sellerId, seller.username);
  }
  for (const group of order.shippingGroups ?? []) {
    if (group.sellerUsername) {
      usernameBySeller.set(group.sellerId, group.sellerUsername);
    }
  }

  const blocks = new Map<string, OrderSellerLines>();
  for (const line of order.lineItems ?? []) {
    const sellerId = orderLineSellerId(line, sellerByTransaction);
    const block = blocks.get(sellerId) ?? {
      sellerId,
      sellerName:
        line.seller?.username ||
        usernameBySeller.get(sellerId) ||
        UNKNOWN_SELLER,
      goods: [],
      firearms: [],
      shipping: [],
    };
    if (!block.sellerName || block.sellerName === UNKNOWN_SELLER) {
      const named =
        line.seller?.username || usernameBySeller.get(sellerId) || '';
      if (named) block.sellerName = named;
    }
    if (orderLineDeliveryClass(line) === 'FIREARM') {
      block.firearms.push(line);
    } else {
      block.goods.push(line);
    }
    blocks.set(sellerId, block);
  }

  for (const group of order.shippingGroups ?? []) {
    const block = blocks.get(group.sellerId);
    if (block) block.shipping.push(group);
  }

  return [...blocks.values()];
}

export interface OrderShippingRow {
  key: string;
  sellerId: string | null;
  sellerName: string;
  label: string;
  shippingCents: number;
}

/**
 * The delivery rows on the order page.
 *
 * ⚠️ ONE ROW PER SELLER ACCESSORIES GROUP, price included — the cart showed
 * one combined courier charge per seller and the order charges the same one.
 * Private/firearm groups contribute no row. A payload without `shippingGroups`
 * (older order, or backend not yet live) still shows ONE honest Delivery total
 * when the order recorded a shipping subtotal, instead of hiding money.
 */
export function orderShippingRows(order: OrderDetail): OrderShippingRow[] {
  const groups = order.shippingGroups ?? [];
  if (groups.length > 0) {
    return groups
      .filter((group) => group.shippingCents > 0)
      .map((group) => ({
        key: group.key,
        sellerId: group.sellerId,
        sellerName: group.sellerUsername ?? UNKNOWN_SELLER,
        label: deliveryLabel(group.method),
        shippingCents: group.shippingCents,
      }));
  }
  const legacyTotal =
    Math.max(0, order.shippingSubtotal ?? 0) +
    Math.max(0, order.handlingSubtotal ?? 0);
  if (legacyTotal > 0) {
    return [
      {
        key: 'legacy-delivery',
        sellerId: null,
        sellerName: '',
        label: 'Delivery',
        shippingCents: legacyTotal,
      },
    ];
  }
  return [];
}

export interface OrderTotals {
  itemsCents: number;
  shippingCents: number;
  platformFeeCents: number;
  totalCents: number;
}

/**
 * Order totals. Items + Delivery + the ONE Platform Fee = Total.
 *
 * The fee is read from `processingFee` (the order snapshot); the leftover
 * derivation is only a fallback for a payload where that column is absent, and
 * it uses the same identity so the column can never contradicted the total.
 */
export function orderTotals(order: OrderDetail): OrderTotals {
  const items = Math.max(0, order.itemsSubtotal ?? 0);
  const shipping =
    Math.max(0, order.shippingSubtotal ?? 0) +
    Math.max(0, order.handlingSubtotal ?? 0);
  const total = Math.max(0, order.buyerTotal ?? 0);
  const recordedFee =
    typeof order.processingFee === 'number'
      ? Math.max(0, order.processingFee)
      : 0;
  const fee =
    recordedFee > 0
      ? recordedFee
      : Math.max(0, total - items - shipping);
  return {
    itemsCents: items,
    shippingCents: shipping,
    platformFeeCents: fee,
    totalCents: total > 0 ? total : items + shipping + fee,
  };
}

/** Sum of the per-seller courier rows (must equal the order's shipping column). */
export function orderShippingRowTotal(order: OrderDetail): number {
  return orderShippingRows(order).reduce(
    (sum, row) => sum + row.shippingCents,
    0,
  );
}

/**
 * Map an order's lines onto cart lines after the backend returns the trimmed
 * order from a line removal.
 *
 * The cart is localStorage-only, so after the server changes an order the cart
 * must be re-written from the server's authoritative lines. Fields the order
 * payload does not carry (shippingMethods, collection flags) are preserved from
 * the previous cart line; everything money/title/quantity related comes from
 * the order.
 */
export function cartItemsFromOrder(
  order: OrderDetail,
  previous: CartItem[] = [],
): CartItem[] {
  const previousById = new Map(
    previous.map((item) => [item.listingId, item]),
  );
  const lines = order.lineItems ?? [];
  return lines.map((line) => {
    const listingId = orderLineListingId(line);
    const prev = previousById.get(listingId);
    const deliveryClass = orderLineDeliveryClass(line);
    const isFirearm = deliveryClass === 'FIREARM';
    const shippingMethods =
      prev?.shippingMethods ??
      (isFirearm
        ? ['DEALER_TRANSFER', 'PRIVATE_ARRANGE']
        : ['COURIER', 'PRIVATE_ARRANGE']);
    return {
      listingId,
      title: line.listing?.title ?? prev?.title ?? 'Item',
      price: Math.max(0, line.unitPrice ?? 0),
      imageUrl: line.listing?.images?.[0]?.url ?? prev?.imageUrl,
      sellerId:
        line.sellerId ?? line.seller?.id ?? prev?.sellerId ?? 'unknown',
      sellerUsername:
        line.seller?.username ?? prev?.sellerUsername ?? null,
      isFirearm,
      shippingMethods,
      quantity: Math.max(1, line.quantity ?? 1),
      ...(prev?.listingType ? { listingType: prev.listingType } : {}),
      ...(prev?.collectionOnly !== undefined
        ? { collectionOnly: prev.collectionOnly }
        : {}),
      ...(prev?.requiresPapers !== undefined
        ? { requiresPapers: prev.requiresPapers }
        : {}),
    } satisfies CartItem;
  });
}
