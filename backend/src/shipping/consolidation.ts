/**
 * How cart lines are grouped into parcels.
 *
 * WHY THIS IS ITS OWN PURE MODULE. Two call sites must agree exactly: the
 * delivery MENU the buyer is shown before paying, and the RE-QUOTE at
 * checkout that decides what they are charged. If those group differently
 * even once, the price shown and the price charged diverge — and the buyer
 * has already ticked "I've seen where this is" against the first one. Sharing
 * one function makes that divergence structurally impossible instead of a
 * thing reviewers have to notice.
 *
 * Pure and I/O-free on purpose: it takes pre-fetched metadata rather than
 * touching Prisma, so the menu endpoint and the checkout path can each fetch
 * once and group identically.
 *
 * The frontend must NOT compute these keys. Grouping depends on server-side
 * listing metadata (seller, firearm flag) the cart payload does not carry, so
 * a client-side guess would mis-count parcels and quote one waybill where two
 * are booked.
 */

/** The two courier shapes. Everything else is a non-courier hand-over. */
export type CourierSlot = 'PUDO' | 'TCG';

export interface ShippingLineInput {
  listingId: string;
  shippingMethod: string;
  quantity?: number;
  /** Bob Go collection-point id (or a legacy Pudo terminal code). */
  pickupPointId?: string | number | null;
  deliveryAddress?: {
    streetAddress?: string;
    suburb?: string;
    city?: string;
    postalCode?: string;
  } | null;
}

export interface ShippingLineMeta {
  sellerId: string;
  isFirearm: boolean;
}

export interface ShippingGroup {
  groupKey: string;
  /** The seller the parcel ships from. */
  owner: string;
  slot: CourierSlot;
  listingIds: string[];
  /** True when this group ships as ONE waybill covering several listings. */
  consolidated: boolean;
}

/**
 * Group courier lines into the parcels they will actually ship as.
 *
 * Exact port of the grouping that createOrderCheckout has always used, so the
 * `shipsWithId` semantics that the downstream consumers depend on (booking
 * skip, buyer cancel, seller reject, dispatch, delivery release, admin refund
 * and the unbooked-shipment metric) are unchanged.
 *
 * Excluded, deliberately:
 *  - firearms, which move via a licensed dealer and never join a parcel — the
 *    method check would already exclude DEALER_TRANSFER / PRIVATE_ARRANGE, but
 *    a mis-routed firearm line carrying a courier method must never be pulled
 *    into one either;
 *  - any non-courier method (COLLECTION, ON_SITE_SERVICE, and the two firearm
 *    hand-overs).
 */
export function planShippingGroups(
  lines: ShippingLineInput[],
  meta: Map<string, ShippingLineMeta>,
): ShippingGroup[] {
  const groups = new Map<string, { owner: string; slot: CourierSlot; listingIds: string[] }>();

  for (const line of lines) {
    const m = meta.get(line.listingId);
    if (!m) continue;
    if (m.isFirearm) continue;
    if (line.shippingMethod !== 'PUDO' && line.shippingMethod !== 'TCG') continue;

    const owner = m.sellerId;
    const a = line.deliveryAddress;
    // The destination is part of the key: two lines only share a waybill if
    // they are going to the same place.
    const destKey =
      line.shippingMethod === 'PUDO'
        ? `L:${line.pickupPointId ?? ''}`
        : `A:${a?.streetAddress ?? ''}|${a?.suburb ?? ''}|${a?.city ?? ''}|${a?.postalCode ?? ''}`;
    const groupKey = `${owner}|${line.shippingMethod}|${destKey}`;

    const existing = groups.get(groupKey);
    if (existing) {
      existing.listingIds.push(line.listingId);
    } else {
      groups.set(groupKey, {
        owner,
        slot: line.shippingMethod,
        listingIds: [line.listingId],
      });
    }
  }

  return [...groups.entries()].map(([groupKey, g]) => ({
    groupKey,
    owner: g.owner,
    slot: g.slot,
    listingIds: g.listingIds,
    consolidated: g.listingIds.length > 1,
  }));
}
