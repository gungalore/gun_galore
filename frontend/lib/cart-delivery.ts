// ────────────────────────────────────────────────────────────────────
// THE CART'S DELIVERY GROUPS — ONE TOGGLE PER SELLER + CLASS.
//
// Operator decision, 2026-11-27: a cart groups its lines by SELLER, then by
// DELIVERY CLASS:
//
//   Accessories (goods)  →  Courier / Private
//   Firearms             →  Dealer Stock / Private
//
// Exactly ONE toggle per group controls every line in it. A seller with both
// goods and a firearm shows TWO independent groups/toggles. There is no
// per-item delivery control anywhere.
//
// ⚠️ THIS GROUPING IS PRESENTATION ONLY. It decides what the buyer picks and
// what the cart sends; the backend groups the same way and refuses a group
// whose lines disagree, so this module must never invent a method an item
// cannot use. The picked method is persisted in localStorage per
// seller|class, so a reload remembers the toggle instead of resetting it.
//
// ⚠️ PRIVATE IS TWO WIRE VALUES. A plain accessories/firearm line handed over
// in person sends PRIVATE_ARRANGE; a collection-only listing sends COLLECTION.
// The member reads "Private" for both (lib/delivery-methods.ts), but the
// backend's gate is exact, so the toggle options are intersected on the METHOD,
// not the label. A seller mixing a collection-only line with a courier line has
// no single legal method for the goods group — that group is `conflicted` and
// the cart blocks it by name rather than silently charging the wrong rail.
// ────────────────────────────────────────────────────────────────────

import type { CartItem } from './cart-store';
import {
  deliveryClassFor,
  deliveryLabel,
  methodsForItem,
  type DeliveryClass,
  type DeliveryMethodOption,
} from './delivery-methods';

const CHOICES_KEY = 'gg:cartDelivery';

/** A line's delivery class, from the flag the add-to-cart writer stored. */
export function itemDeliveryClass(item: {
  isFirearm?: boolean;
}): DeliveryClass {
  return deliveryClassFor(item);
}

/** True when the line must be collected/handed over in person, never couriered. */
export function isCollectionOnlyItem(item: {
  collectionOnly?: boolean;
  shippingMethods?: string[] | null;
}): boolean {
  if (item.collectionOnly === true) return true;
  return (item.shippingMethods ?? []).includes('COLLECTION');
}

/** The legal methods for one cart line, through the shared vocabulary. */
export function itemDeliveryOptions(item: CartItem): DeliveryMethodOption[] {
  return methodsForItem({
    isFirearm: item.isFirearm,
    shippingMethods: item.shippingMethods,
    collectionOnly: isCollectionOnlyItem(item),
  });
}

/** `sellerId:GOODS` / `sellerId:FIREARM` — the persistence + React key. */
export function cartGroupKey(
  sellerId: string,
  deliveryClass: DeliveryClass,
): string {
  return `${sellerId}:${deliveryClass}`;
}

/** One seller's goods OR firearm group — exactly one toggle for all its lines. */
export interface CartClassGroup {
  key: string;
  sellerId: string;
  sellerName: string;
  deliveryClass: DeliveryClass;
  items: CartItem[];
  /**
   * Methods every line in this group can use, in the class's display order.
   * A single-option group renders a label, not a two-way toggle.
   */
  options: DeliveryMethodOption[];
  /** The stored enum sent to the backend for every line in this group. */
  method: string;
  /**
   * True when the lines have NO single legal method in common (a
   * collection-only trailer beside a courier accessory from one seller).
   * The cart names it and blocks Pay rather than choosing a method the
   * backend will reject.
   */
  conflicted: boolean;
  /** Every line must be collected in person — no courier quote for this group. */
  collectionOnly: boolean;
}

/** A seller's block: their goods group and/or their firearm group. */
export interface CartSellerGroup {
  sellerId: string;
  sellerName: string;
  classes: CartClassGroup[];
}

function sellerNameFor(item: CartItem): string {
  // Display text only. Identity is sellerId, which is always present; a
  // nameless seller is written as a literal by the add-to-cart writers, so
  // 'Anonymous seller' only covers a cart row with no key at all.
  return item.sellerUsername?.trim() || 'Anonymous seller';
}

/**
 * Methods available to EVERY line in a group, in the first line's order.
 *
 * Intersection (never union): one toggle must be legal for all lines, or the
 * backend refuses the group. COLLECTION and PRIVATE_ARRANGE share the label
 * "Private" but are different wire values, so they do not satisfy each other.
 */
function intersectMethods(items: CartItem[]): DeliveryMethodOption[] {
  if (items.length === 0) return [];
  const first = itemDeliveryOptions(items[0]);
  return first.filter((option) =>
    items.every((item) =>
      itemDeliveryOptions(item).some((other) => other.method === option.method),
    ),
  );
}

function defaultMethod(
  options: DeliveryMethodOption[],
  stored: string | undefined,
): string {
  if (stored && options.some((option) => option.method === stored)) {
    return stored;
  }
  // methodsForItem orders the class's preferred pair first (Courier, then
  // Private; Dealer Stock, then Private), so options[0] is the sensible
  // default — and it is the ONLY option for collection-only groups.
  return options[0]?.method ?? 'PRIVATE_ARRANGE';
}

/**
 * Group a cart by seller, then delivery class.
 *
 * `choices` is the persisted `groupKey → method` map (see
 * readCartDeliveryChoices); an invalid or missing choice falls back to the
 * group's default, so a stale localStorage entry can never force an illegal
 * method.
 */
export function groupCartBySellerAndClass(
  items: CartItem[],
  choices: Record<string, string> = {},
): CartSellerGroup[] {
  const sellers = new Map<string, CartSellerGroup>();

  for (const item of items) {
    const seller = sellers.get(item.sellerId) ?? {
      sellerId: item.sellerId,
      sellerName: sellerNameFor(item),
      classes: [],
    };
    const deliveryClass = itemDeliveryClass(item);
    const key = cartGroupKey(item.sellerId, deliveryClass);
    let group = seller.classes.find((entry) => entry.key === key);
    if (!group) {
      group = {
        key,
        sellerId: item.sellerId,
        sellerName: seller.sellerName,
        deliveryClass,
        items: [],
        options: [],
        method: '',
        conflicted: false,
        collectionOnly: true,
      };
      seller.classes.push(group);
    }
    group.items.push(item);
    sellers.set(item.sellerId, seller);
  }

  for (const seller of sellers.values()) {
    // Stable display order: Accessories first, then Firearms.
    seller.classes.sort((a, b) =>
      a.deliveryClass === b.deliveryClass
        ? 0
        : a.deliveryClass === 'GOODS'
          ? -1
          : 1,
    );
    for (const group of seller.classes) {
      const options = intersectMethods(group.items);
      group.conflicted = options.length === 0;
      group.options = group.conflicted
        ? itemDeliveryOptions(group.items[0])
        : options;
      group.method = defaultMethod(group.options, choices[group.key]);
      group.collectionOnly =
        group.deliveryClass === 'GOODS' &&
        group.items.every((item) => isCollectionOnlyItem(item));
    }
  }

  return [...sellers.values()];
}

/** Flat class groups, in seller order then class order. */
export function cartClassGroups(
  items: CartItem[],
  choices: Record<string, string> = {},
): CartClassGroup[] {
  return groupCartBySellerAndClass(items, choices).flatMap(
    (seller) => seller.classes,
  );
}

/** The class group a listing belongs to, or undefined when it is not carted. */
export function classGroupForListing(
  groups: CartSellerGroup[],
  listingId: string,
): CartClassGroup | undefined {
  for (const seller of groups) {
    for (const group of seller.classes) {
      if (group.items.some((item) => item.listingId === listingId)) {
        return group;
      }
    }
  }
  return undefined;
}

/**
 * The buyer's chosen method for a class group. Derived from the group itself
 * (which already applied the persisted choice + legality fallback).
 */
export function groupMethodLabel(group: CartClassGroup): string {
  return deliveryLabel(group.method);
}

/** GROUPS that need a courier quote: goods, Courier, not conflicted. */
export function courierClassGroups(
  groups: CartSellerGroup[],
): CartClassGroup[] {
  return groups
    .flatMap((seller) => seller.classes)
    .filter(
      (group) =>
        group.deliveryClass === 'GOODS' &&
        !group.conflicted &&
        group.method === 'COURIER',
    );
}

// ── Courier quote groups (server-owned) ─────────────────────────────
//
// The quote endpoint groups the courier lines itself — the client must not
// compute parcel keys. All this layer does is match the server's group back to
// the seller|class toggle group it belongs to, by first listing.

export interface CartQuoteGroupLike {
  groupKey: string;
  listingIds: string[];
  unavailableReason?: string;
}

/** The server quote group that prices this seller's courier group. */
export function quoteGroupForClassGroup<Q extends CartQuoteGroupLike>(
  group: CartClassGroup,
  quotes: Q[],
): Q | null {
  const ownIds = new Set(group.items.map((item) => item.listingId));
  return (
    quotes.find((quote) =>
      quote.listingIds.some((listingId) => ownIds.has(listingId)),
    ) ?? null
  );
}

export interface CartShippingChoiceLike {
  priceCents: number;
  label: string;
}

/** One shipping row/price per seller accessories group when Courier. */
export interface CartShippingRow {
  /** `sellerId:GOODS` — the toggle group this row belongs to. */
  classGroupKey: string;
  sellerId: string;
  sellerName: string;
  /** Server quote group key, when the quote has landed. */
  quoteGroupKey: string | null;
  label: string;
  /** Chosen courier price, or null while it is still unpriced. */
  shippingCents: number | null;
  unavailableReason?: string;
}

/**
 * The delivery rows the cart sidebar and order summary render.
 *
 * ⚠️ ONE ROW PER SELLER ACCESSORIES GROUP, not one per item. Private and
 * firearm groups contribute NOTHING: there is no delivery charge on a
 * hand-over, and inventing a R0 row would suggest the seller ships for free.
 */
export function cartShippingRows(
  groups: CartSellerGroup[],
  quotes: CartQuoteGroupLike[],
  chosen: Record<string, CartShippingChoiceLike>,
): CartShippingRow[] {
  return courierClassGroups(groups).map((group) => {
    const quote = quoteGroupForClassGroup(group, quotes);
    const choice = quote ? chosen[quote.groupKey] : undefined;
    return {
      classGroupKey: group.key,
      sellerId: group.sellerId,
      sellerName: group.sellerName,
      quoteGroupKey: quote?.groupKey ?? null,
      label: 'Courier',
      shippingCents: choice?.priceCents ?? null,
      unavailableReason: quote?.unavailableReason,
    };
  });
}

/** Sum of the chosen courier prices for the whole cart, in cents. */
export function shippingTotalCents(
  groups: CartSellerGroup[],
  quotes: CartQuoteGroupLike[],
  chosen: Record<string, CartShippingChoiceLike>,
): number {
  return cartShippingRows(groups, quotes, chosen).reduce(
    (sum, row) => sum + (row.shippingCents ?? 0),
    0,
  );
}

/** True when any line needs the collection-papers acknowledgement. */
export function needsCollectionPapersAck(groups: CartSellerGroup[]): boolean {
  return groups.some((seller) =>
    seller.classes.some((group) =>
      group.items.some(
        (item) =>
          group.method === 'COLLECTION' && item.requiresPapers === true,
      ),
    ),
  );
}

/** True when a group's lines cannot share one delivery method. */
export function hasConflictedGroup(groups: CartSellerGroup[]): boolean {
  return groups.some((seller) =>
    seller.classes.some((group) => group.conflicted),
  );
}

// ── Persistence: the buyer's picked toggle ──────────────────────────
//
// localStorage (not sessionStorage): the toggle is a preference about the
// whole cart, like the cart itself, and should survive the gateway round-trip.

/** Read the persisted `groupKey → method` map (safe on the server). */
export function readCartDeliveryChoices(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(CHOICES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (typeof key === 'string' && typeof value === 'string' && value) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Persist ONE group's choice; returns the updated map. */
export function saveCartDeliveryChoice(
  groupKey: string,
  method: string,
): Record<string, string> {
  const next = { ...readCartDeliveryChoices(), [groupKey]: method };
  try {
    window.localStorage.setItem(CHOICES_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode — the in-memory choice still drives this render */
  }
  return next;
}

/** Drop choices for groups that no longer exist (a line was removed). */
export function pruneCartDeliveryChoices(
  validGroupKeys: string[],
): Record<string, string> {
  const valid = new Set(validGroupKeys);
  const current = readCartDeliveryChoices();
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(current)) {
    if (valid.has(key)) next[key] = value;
  }
  try {
    window.localStorage.setItem(CHOICES_KEY, JSON.stringify(next));
  } catch {
    /* best effort */
  }
  return next;
}

// ── Checkout payload ────────────────────────────────────────────────

export interface CartCheckoutAddress {
  building?: string;
  streetAddress: string;
  address2?: string;
  suburb: string;
  city: string;
  province: string;
  postalCode: string;
}

export interface CartQuoteChoice {
  /** DeliveryOption enum: DOOR_CHEAPEST / DOOR_FASTEST / STORE_PICKUP. */
  kind: string;
  pickupPointLocationId?: number;
}

export interface CartCheckoutLine {
  listingId: string;
  shippingMethod: string;
  quantity?: number;
  privateArrangeConsent?: boolean;
  collectionPapersAccepted?: boolean;
  deliveryAddress?: CartCheckoutAddress;
  deliveryOption?: string;
  pickupPointLocationId?: number;
}

/**
 * Map the grouped cart to `POST /orders/checkout` lines.
 *
 * Every line in a class group carries the SAME method the buyer toggled —
 * that is the contract the backend enforces per seller+class. Courier lines
 * additionally carry the destination and the chosen parcel option; private
 * hand-overs carry their consent flag; collection-only lines carry the papers
 * acknowledgement when the buyer ticked it.
 */
export function buildCartCheckoutLines(
  groups: CartSellerGroup[],
  options: {
    quoteForGroup: (group: CartClassGroup) => CartQuoteGroupLike | null;
    chosenQuotes: Record<string, CartQuoteChoice>;
    deliveryAddress?: CartCheckoutAddress | null;
    collectionPapersAccepted?: boolean;
  },
): CartCheckoutLine[] {
  const lines: CartCheckoutLine[] = [];
  for (const seller of groups) {
    for (const group of seller.classes) {
      for (const item of group.items) {
        const quantity = Math.max(1, item.quantity ?? 1);
        const units = quantity > 1 ? { quantity } : {};
        if (group.method === 'DEALER_TRANSFER') {
          lines.push({
            listingId: item.listingId,
            shippingMethod: 'DEALER_TRANSFER',
            ...units,
          });
          continue;
        }
        if (group.method === 'PRIVATE_ARRANGE') {
          lines.push({
            listingId: item.listingId,
            shippingMethod: 'PRIVATE_ARRANGE',
            privateArrangeConsent: true,
            ...units,
          });
          continue;
        }
        if (group.method === 'COLLECTION') {
          lines.push({
            listingId: item.listingId,
            shippingMethod: 'COLLECTION',
            ...(options.collectionPapersAccepted
              ? { collectionPapersAccepted: true }
              : {}),
            ...units,
          });
          continue;
        }
        // COURIER
        const quote = options.quoteForGroup(group);
        const choice = quote ? options.chosenQuotes[quote.groupKey] : undefined;
        lines.push({
          listingId: item.listingId,
          shippingMethod: 'COURIER',
          ...(choice ? { deliveryOption: choice.kind } : {}),
          ...(choice?.kind === 'STORE_PICKUP' &&
          choice.pickupPointLocationId != null
            ? { pickupPointLocationId: choice.pickupPointLocationId }
            : {}),
          ...(options.deliveryAddress
            ? { deliveryAddress: options.deliveryAddress }
            : {}),
          ...units,
        });
      }
    }
  }
  return lines;
}
