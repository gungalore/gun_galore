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

  // Banking / profile actions.
  if (type.startsWith('bank_verify') || type === 'refund_needs_bank_details') {
    return '/profile';
  }

  // Seller's listings — moderation results, delisting, licence expiry, and
  // the listing hygiene nudges (stale / expired / missing photos) whose own
  // url already points at /my/listings.
  if (
    type === 'listing_approved' ||
    type === 'listing_rejected' ||
    type === 'firearm_listing_delisted' ||
    type === 'firearm_licence_expiring' ||
    type === 'listing_stale_nudge' ||
    type === 'listing_expired_stale' ||
    type === 'listing_photos_missing'
  ) {
    return '/my/listings';
  }

  // The member's OWN document vault. Distinct from firearm_licence_expiring
  // above, which is about a LISTING's licence and belongs on /my/listings —
  // the prefix cannot collide with that exact match. The SAPS application
  // tracker and motivation documents also live under the Licence Centre.
  if (
    type.startsWith('licence_centre_') ||
    type === 'tracked_application_changed' ||
    type.startsWith('motivation_')
  ) {
    return '/licence-centre';
  }

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
    type === 'shipping_ready_for_pickup' ||
    type === 'collection_confirm_nudge' ||
    type === 'shipment_failed' ||
    type === 'dealer_transfer_stall_nudge' ||
    type === 'private_arrange_handover' ||
    type === 'private_arrange_delivered' ||
    type === 'private_arrange_reminder'
  ) {
    return '/shipping';
  }

  // Buyer sale lifecycle — the accept/cancel notices a buyer reads on their
  // Orders surface. The category split is what keeps a BUYER row off the
  // SELLER module: `sale_rejected` is emitted to both sides of a sale, and a
  // blanket `startsWith('sale_')` used to badge the buyer's own cancellation
  // under the seller-only /my/sales entry.
  if (
    (type === 'sale_accepted' || type === 'sale_rejected') &&
    category !== 'SELLER'
  ) {
    return '/my/orders';
  }

  // Seller sale lifecycle — new sale, accept reminder/escalation, the
  // action-required SAPS 534 upload, and dealer-verification reshoots.
  if (
    type === 'new_sale' ||
    type.startsWith('sale_') ||
    type === 'sap534_required' ||
    type === 'dealer_verification_rejected'
  ) {
    return '/my/sales';
  }

  // Buyer order lifecycle — refunds, delivery-confirmation nudges and
  // cancellation requests (all surfaced on the buyer's Orders page; live
  // delivery/tracking rows live in Shipping above).
  if (
    type === 'refund_issued' ||
    type === 'confirm_receipt_nudge' ||
    type === 'cancellation_requested_buyer'
  ) {
    return '/my/orders';
  }

  // Complaints — the member's own dispute cases. The row's url already points
  // at /complaints, which is now an account-menu entry, so the badge lands.
  if (type === 'complaint_status_changed') return '/complaints';

  // Payout release — seller's earnings; for a buyer it's an order event.
  if (type === 'payment_released') {
    return category === 'SELLER' ? '/my/earnings' : '/my/orders';
  }

  // Buyer↔seller message thread — the row's own url is the transaction, but
  // the account-menu badge belongs on the order/sale module for the side the
  // member is on.
  if (type === 'new_message') {
    return category === 'SELLER' ? '/my/sales' : '/my/orders';
  }

  // Community feed — likes, replies and follows all live on /community.
  if (
    type === 'post_liked' ||
    type === 'comment_reply' ||
    type === 'new_follower' ||
    type === 'post_published' ||
    type === 'post_rejected'
  ) {
    return '/community';
  }

  return null;
}
