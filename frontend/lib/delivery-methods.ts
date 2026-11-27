// ────────────────────────────────────────────────────────────────────
// THE TWO DELIVERY CLASSES, AND THE WORDS THE MEMBER READS.
//
// ⚠️ ONE VOCABULARY ACROSS CATALOG, CHECKOUT, SELL AND CART. The backend's enum
// is untouched — COURIER, PRIVATE_ARRANGE, COLLECTION, DEALER_TRANSFER all keep
// their exact meaning on the wire — but the member sees only three labels:
//
//   COURIER          → Courier
//   PRIVATE_ARRANGE  → Private   (meet in person / arrange privately)
//   COLLECTION       → Private   (collection only is still a private handover)
//   DEALER_TRANSFER  → Dealer Stock
//
// ⚠️ GOODS ARE Courier/Private; FIREARMS ARE Dealer Stock/Private. Never offer a
// firearm a courier option — the regulated-goods rule makes that promise
// impossible — and never offer Dealer Stock on an airgun or an accessory. A
// collection-only listing is Private only.
//
// This module is deliberately dependency-free so every surface (and the cart
// agent's own components) can import the same mapping.
// ────────────────────────────────────────────────────────────────────

/** The two legal buckets an item's delivery falls into. */
export type DeliveryClass = 'GOODS' | 'FIREARM';

/** The labels the member sees. There are no other labels. */
export type DeliveryLabel = 'Courier' | 'Private' | 'Dealer Stock';

export interface DeliveryMethodOption {
  /** The stored enum value — send THIS, not the label. */
  method: string;
  label: DeliveryLabel;
  /** One sentence, shown under the label where the surface has room. */
  description?: string;
}

/**
 * The label for a stored shipping method.
 *
 * ⚠️ DEPRECATED STRINGS STILL MAP. Rows written before the vocabulary settled
 * carry "meet in person", "arrange privately" and "collection only" spellings;
 * they are the member's Private, not a fourth label.
 */
export function deliveryLabel(method: string): string {
  const key = (method ?? '').trim().toUpperCase();
  if (!key) return 'Private';
  if (key === 'COURIER' || key === 'SHIPPING' || key === 'SHIP') {
    return 'Courier';
  }
  if (
    key === 'DEALER_TRANSFER' ||
    key === 'DEALER' ||
    key === 'DEALER_STOCK' ||
    key === 'TRANSFER'
  ) {
    return 'Dealer Stock';
  }
  if (
    key === 'PRIVATE_ARRANGE' ||
    key === 'PRIVATE' ||
    key === 'COLLECTION' ||
    key === 'COLLECTION_ONLY' ||
    key === 'MEET_IN_PERSON' ||
    key === 'ARRANGE_PRIVATELY'
  ) {
    return 'Private';
  }
  // Anything new the backend adds: humanise it rather than show an enum.
  return key
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/** Which legal bucket this item's delivery belongs to. */
export function deliveryClassFor(item: { isFirearm?: boolean }): DeliveryClass {
  return item.isFirearm ? 'FIREARM' : 'GOODS';
}

const DESCRIPTIONS: Record<DeliveryLabel, string> = {
  Courier: 'Delivered to your door by courier.',
  Private: 'Handed over in person, arranged privately with the seller.',
  'Dealer Stock': 'Transferred through a licensed dealer.',
};

function optionFor(method: string): DeliveryMethodOption {
  const label = deliveryLabel(method) as DeliveryLabel;
  return { method, label, description: DESCRIPTIONS[label] };
}

/**
 * The item's legal delivery pair, in display order.
 *
 * ⚠️ THE SERVER'S `shippingMethods` NARROWS, NEVER WIDENS. A listing that only
 * offers one method gets one option; a listing without the field falls back to
 * the class's full pair. `collectionOnly` is Private only.
 */
export function methodsForItem(item: {
  isFirearm?: boolean;
  shippingMethods?: string[] | null;
  collectionOnly?: boolean;
}): DeliveryMethodOption[] {
  if (item.collectionOnly) {
    return [optionFor('COLLECTION')];
  }

  const firearm = deliveryClassFor(item) === 'FIREARM';
  const preferred = firearm
    ? ['DEALER_TRANSFER', 'PRIVATE_ARRANGE']
    : ['COURIER', 'PRIVATE_ARRANGE'];

  const offered = (item.shippingMethods ?? []).filter(
    (method): method is string => typeof method === 'string' && !!method.trim(),
  );
  const pool = offered.length ? offered : preferred;

  const options: DeliveryMethodOption[] = [];
  const seenLabels = new Set<DeliveryLabel>();
  const push = (method: string) => {
    const option = optionFor(method);
    if (seenLabels.has(option.label)) return;
    seenLabels.add(option.label);
    options.push(option);
  };

  // Preferred order first, then anything else the server offered, mapped to its
  // label. COLLECTION and PRIVATE_ARRANGE both read Private, so one of them
  // stands for the member and the first in preference order wins.
  for (const method of preferred) {
    if (pool.some((offeredMethod) => offeredMethod === method)) push(method);
  }
  for (const method of pool) {
    if (preferred.includes(method)) continue;
    push(method);
  }

  // Defensive: an item narrowed to something unreadable still gets one option.
  if (!options.length) {
    options.push(optionFor(firearm ? 'DEALER_TRANSFER' : 'COURIER'));
  }
  return options;
}
