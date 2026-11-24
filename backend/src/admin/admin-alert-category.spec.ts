import {
  adminAlertGroup,
  categorizeAdminAlert,
  groupOfAlertType,
} from './admin-alert-category';

/**
 * Pins the families that used to be mixed in one flat inbox (2026-11-24):
 * money/account work must never be classified as system noise, and cron/webhook
 * noise must never badge the money tab.
 */
describe('admin alert categories', () => {
  it('classifies payment, payout, dispute and refund alerts as MONEY', () => {
    for (const type of [
      'PEACH_PAYOUT_FAILED',
      'PEACH_PAYOUT_FLOAT_SHORTAGE',
      'PEACH_WEBHOOK_MARKPAID_REJECTED',
      'OZOW_PAYOUT_PARTIAL',
      'TRANSACTION_DISPUTED',
      'PRIVATE_ARRANGE_DISPUTED',
      'CHARGEBACK_OPENED',
      'REFUND_LISTING_REVERSAL_FAILED',
      'STUCK_HELD_FUNDS_BUYER_UNCONFIRMED',
      'MOTIVATION_PAYMENT_TEST_MODE',
      'SALE_REJECT_REFUND_FAILED',
      'ZOHO_SYNC_UNCERTAIN',
    ]) {
      expect(categorizeAdminAlert(type)).toBe('MONEY');
      expect(adminAlertGroup(categorizeAdminAlert(type))).toBe('CORE');
    }
  });

  it('classifies KYC, banking, dealer and member alerts as ACCOUNT', () => {
    for (const type of [
      'KYC_REVIEW',
      'BANK_VERIFY_MISMATCH',
      'DEALER_VERIFICATION_NEEDS_REVIEW',
      'COMPLAINT_LODGED',
      'MOTIVATION_GENERATION_FAILED',
      'SAPS_TRACKER_UNREADABLE',
      'USER_BANNED',
      'SUPPORT_TICKET_OPENED',
    ]) {
      expect(categorizeAdminAlert(type)).toBe('ACCOUNT');
      expect(adminAlertGroup(categorizeAdminAlert(type))).toBe('CORE');
    }
  });

  it('keeps its own MARKETPLACE family for listings, posts and sellers', () => {
    for (const type of [
      'LISTING_REPORTED',
      'POST_REPORTED',
      'SELLER_REJECT_STRIKE',
      'BIDDER_AUCTION_STRIKES_THRESHOLD',
      'COMMENT_REPORTED',
    ]) {
      expect(categorizeAdminAlert(type)).toBe('MARKETPLACE');
      expect(adminAlertGroup(categorizeAdminAlert(type))).toBe('MARKETPLACE');
    }
  });

  it('sends crons, webhooks and channels to SYSTEM, never to CORE', () => {
    for (const type of [
      'CRON_STALE',
      'BACKUP_FAILED',
      'WEBHOOK_SIGNATURE_INVALID',
      'YOCO_WEBHOOK_SIGNATURE_INVALID',
      'SMS_OUTAGE',
      'WHATSAPP_OUTAGE',
      'SHIPMENT_BOOKING_FAILED',
    ]) {
      expect(categorizeAdminAlert(type)).toBe('SYSTEM');
      expect(adminAlertGroup(categorizeAdminAlert(type))).toBe('SYSTEM');
    }
  });

  it('treats an unknown type as OTHER/SYSTEM so it cannot badge money work', () => {
    expect(categorizeAdminAlert('SOMETHING_NEW')).toBe('OTHER');
    expect(groupOfAlertType('SOMETHING_NEW')).toBe('SYSTEM');
    // Money/account prefixes are matched case-insensitively.
    expect(groupOfAlertType('peach_payout_failed')).toBe('CORE');
    expect(groupOfAlertType('  kyc_review  ')).toBe('CORE');
  });
});
