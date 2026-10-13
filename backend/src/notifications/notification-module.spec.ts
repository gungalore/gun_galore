import { moduleForNotification } from './notification-module';

describe('moduleForNotification', () => {
  it('splits offers by perspective (buyer vs seller)', () => {
    expect(moduleForNotification('offer_received', 'SELLER')).toBe('/offers/received');
    expect(moduleForNotification('offer_accepted', 'BUYER')).toBe('/my/offers');
    expect(moduleForNotification('offer_rejected', 'BUYER')).toBe('/my/offers');
    expect(moduleForNotification('counter_accepted', 'BUYER')).toBe('/my/offers');
    expect(moduleForNotification('offer_withdrawn', 'SELLER')).toBe('/offers/received');
  });

  it('routes bids/auctions to /my/bids', () => {
    expect(moduleForNotification('bid_outbid', 'BUYER')).toBe('/my/bids');
    expect(moduleForNotification('auction_won', 'BUYER')).toBe('/my/bids');
    expect(moduleForNotification('auction_win_lapsed', 'BUYER')).toBe('/my/bids');
  });

  it('routes seller sale lifecycle to /my/sales', () => {
    expect(moduleForNotification('new_sale', 'SELLER')).toBe('/my/sales');
    expect(moduleForNotification('sale_rejected', 'SELLER')).toBe('/my/sales');
    expect(moduleForNotification('sale_accept_reminder', 'SELLER')).toBe('/my/sales');
    expect(moduleForNotification('sap534_required', 'SELLER')).toBe('/my/sales');
    expect(moduleForNotification('dealer_verification_rejected', 'SELLER')).toBe('/my/sales');
  });

  it('routes buyer sale lifecycle to /my/orders, never the seller module', () => {
    expect(moduleForNotification('sale_accepted', 'BUYER')).toBe('/my/orders');
    expect(moduleForNotification('sale_rejected', 'BUYER')).toBe('/my/orders');
  });

  it('routes shipping/courier + firearm-transfer lifecycle to /shipping', () => {
    expect(moduleForNotification('dispatch_nudge', 'SELLER')).toBe('/shipping');
    expect(moduleForNotification('shipment_collected', 'SELLER')).toBe('/shipping');
    expect(moduleForNotification('shipment_delivered_seller', 'SELLER')).toBe('/shipping');
    expect(moduleForNotification('order_dispatched', 'BUYER')).toBe('/shipping');
    expect(moduleForNotification('shipping_delivered', 'BUYER')).toBe('/shipping');
    expect(moduleForNotification('shipping_ready_for_pickup', 'BUYER')).toBe('/shipping');
    expect(moduleForNotification('collection_confirm_nudge', 'BUYER')).toBe('/shipping');
    expect(moduleForNotification('dealer_transfer_stall_nudge', 'BUYER')).toBe('/shipping');
    expect(moduleForNotification('private_arrange_delivered', 'BUYER')).toBe('/shipping');
    expect(moduleForNotification('private_arrange_reminder', 'BUYER')).toBe('/shipping');
  });

  it('routes buyer refunds and order actions to /my/orders', () => {
    expect(moduleForNotification('refund_issued', 'BUYER')).toBe('/my/orders');
    expect(moduleForNotification('confirm_receipt_nudge', 'BUYER')).toBe('/my/orders');
    expect(moduleForNotification('cancellation_requested_buyer', 'BUYER')).toBe('/my/orders');
  });

  it('routes complaint updates to the Complaints module', () => {
    expect(moduleForNotification('complaint_status_changed', 'ACCOUNT')).toBe('/complaints');
  });

  it('routes the Licence Centre documents (tracker + motivations) to /licence-centre', () => {
    expect(moduleForNotification('licence_centre_expiry_T30', 'ACCOUNT')).toBe('/licence-centre');
    expect(moduleForNotification('tracked_application_changed', 'ACCOUNT')).toBe('/licence-centre');
    expect(moduleForNotification('motivation_ready', 'ACCOUNT')).toBe('/licence-centre');
  });

  it('routes listings, banking, subscription, payout by their module', () => {
    expect(moduleForNotification('listing_approved', 'SELLER')).toBe('/my/listings');
    expect(moduleForNotification('listing_photos_missing', 'SELLER')).toBe('/my/listings');
    expect(moduleForNotification('listing_stale_nudge', 'SELLER')).toBe('/my/listings');
    expect(moduleForNotification('listing_expired_stale', 'SELLER')).toBe('/my/listings');
    expect(moduleForNotification('firearm_licence_expiring', 'SELLER')).toBe('/my/listings');
    expect(moduleForNotification('bank_verify_failed', 'ACCOUNT')).toBe('/profile');
    expect(moduleForNotification('refund_needs_bank_details', 'BUYER')).toBe('/profile');
    expect(moduleForNotification('subscription_expiring', 'ACCOUNT')).toBe('/subscribe');
    expect(moduleForNotification('payment_released', 'SELLER')).toBe('/my/earnings');
    expect(moduleForNotification('payment_released', 'BUYER')).toBe('/my/orders');
  });

  it('rating lands on sale for seller, order for buyer', () => {
    expect(moduleForNotification('rating_received', 'SELLER')).toBe('/my/sales');
    expect(moduleForNotification('rating_received', 'BUYER')).toBe('/my/orders');
  });

  it('experiences/dealer/raffle go to the dashboard', () => {
    expect(moduleForNotification('experience_pre_event_reminder', 'BUYER')).toBe('/dashboard');
    expect(moduleForNotification('raffle_winner', 'ACCOUNT')).toBe('/dashboard');
  });

  it('returns null for an unknown type (still counts in the bell total)', () => {
    expect(moduleForNotification('some_future_event', 'ACCOUNT')).toBeNull();
  });
});
