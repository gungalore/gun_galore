import { PROVINCE_LABELS } from '@/lib/utils';
import type { Province } from '@/lib/types';

/**
 * The vicinity a buyer is shown before paying: town + province.
 *
 * DELIBERATELY NOT IN A `'use client'` MODULE. This lives here, in a plain
 * module, because it is called during SERVER render on the product page and
 * the offer-checkout page, and from CLIENT components on the checkout form and
 * the cart. It originally sat in components/buyer-terms-ack.tsx — which is
 * `'use client'` — and calling it from a Server Component blew up the whole
 * product page at runtime:
 *
 *   ⨯ Attempted to call vicinityLabel() from the server but vicinityLabel is
 *     on the client. It's not possible to invoke a client function from the
 *     server, it can only be rendered as a Component or passed to props of a
 *     Client Component.
 *
 * Next.js surfaces that to the user as an opaque digest (e.g. "2082116920")
 * with no message, so it reads as a mystery error rather than an import
 * mistake. A Server Component may import from a plain module freely; it may
 * not reach into a client module for a value or a function.
 *
 * The server has its own copy of this logic in
 * backend/src/common/province-labels.ts, because the exact string is also
 * snapshotted onto Transaction.buyerLocationShown as evidence of what the
 * buyer was told. The two must agree — change one, change the other.
 */
export function vicinityLabel(listing: {
  isFirearm?: boolean;
  plannedDealerLocation?: string | null;
  publicLocality?: string | null;
  province?: Province;
}): string {
  // A firearm never moves from the seller's address — it goes to a licensed
  // dealer — so the meaningful location is the planned dealer.
  if (listing.isFirearm && listing.plannedDealerLocation) {
    return listing.plannedDealerLocation;
  }
  // A payload that did not select province must never render "undefined" at a
  // buyer who is about to agree they were told where the item is.
  const province = listing.province ? PROVINCE_LABELS[listing.province] : null;
  if (listing.publicLocality && province) {
    return `${listing.publicLocality}, ${province}`;
  }
  return listing.publicLocality ?? province ?? 'the seller’s area';
}
