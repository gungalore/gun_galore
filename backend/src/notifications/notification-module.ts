// Maps a notification (type + category) to the ACCOUNT-MENU MODULE it
// belongs to — i.e. the menu href where the user would act on it. Drives
// the per-module red count badges in the account dropdown / drawer / PWA
// "More" sheet (frontend AccountMenuList). Returns null for notifications
// that don't belong to a specific badge-able module (they still count in
// the overall bell total).
//
// The returned strings MUST match the `href`s in
// frontend/lib/account-menu-data.tsx — keep the two in sync.
//
// `category` (BUYER | SELLER | ACCOUNT) is the perspective discriminator:
// the same offer/transaction fires a BUYER notification to one party and a
// SELLER one to the other, and they belong to different menu modules.

export function moduleForNotification(
  type: string,
  category: string,
): string | null {
  // Offers — the buyer manages their OWN offers on /my/offers; the seller
  // manages INCOMING offers on /offers/received. Includes counter_* (the
  // single counter round of the same offer negotiation).
  if (type.startsWith('offer_') || type.startsWith('counter_')) {
    return category === 'SELLER' ? '/offers/received' : '/my/offers';
  }

  // Auction bids — always the bidder (buyer) side.
  if (type.startsWith('bid_') || type.startsWith('auction_')) return '/my/bids';

  // Swaps — both parties act on /my/swaps.
  if (type.startsWith('swap_')) return '/my/swaps';

  // Banking / profile actions.
  if (type.startsWith('bank_verify') || type === 'refund_needs_bank_details') {
    return '/profile';
  }

  // Subscription (AO PRO).
  if (type.startsWith('subscription_')) return '/subscribe';

  // Seller's listings — moderation results, delisting, licence expiry,
  // featured-slot payment.
  if (
    type === 'listing_approved' ||
    type === 'listing_rejected' ||
    type === 'firearm_listing_delisted' ||
    type === 'firearm_licence_expiring' ||
    type === 'featured_payment_received'
  ) {
    return '/my/listings';
  }

  // The member's OWN document vault. Distinct from firearm_licence_expiring
  // above, which is about a LISTING's licence and belongs on /my/listings —
  // the prefix cannot collide with that exact match.
  if (type.startsWith('licence_centre_')) return '/licence-centre';

  // A rating lands on the sale (seller) or the order (buyer).
  if (type === 'rating_received') {
    return category === 'SELLER' ? '/my/sales' : '/my/orders';
  }

  // Shipping / courier + firearm-transfer lifecycle → the Shipping module
  // (incoming + outgoing shipments, dealer-transfer / private-arrangement
  // hand-off). Both buyer- and seller-side courier events live here.
  if (
    type === 'dispatch_nudge' ||
    type === 'shipment_booked' ||
    type === 'shipment_booking_failed' ||
    type === 'shipment_collected' ||
    type === 'shipment_delivered_seller' ||
    type === 'order_dispatched' ||
    type === 'shipping_dispatched' ||
    type === 'shipping_delivered' ||
    type === 'collection_confirm_nudge' ||
    type === 'dealer_transfer_stall_nudge'
  ) {
    return '/shipping';
  }

  // Seller sale lifecycle — new sale, accept/reject/escalate.
  if (type === 'new_sale' || type.startsWith('sale_')) {
    return '/my/sales';
  }

  // Buyer order lifecycle — refunds (delivery/tracking now live in Shipping).
  if (type === 'refund_issued') {
    return '/my/orders';
  }

  // Payout release — seller's earnings; for a buyer it's an order event.
  if (type === 'payment_released') {
    return category === 'SELLER' ? '/my/earnings' : '/my/orders';
  }

  // Experiences, dealer verification, prize draw → the dashboard hub.
  if (
    type.startsWith('experience_') ||
    type === 'dealer_verification_rejected' ||
    type === 'raffle_winner'
  ) {
    return '/dashboard';
  }

  return null;
}
