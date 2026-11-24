/**
 * AdminAlert → category.
 *
 * ⚠️ WHY THIS EXISTS. The ops inbox mixed a cron refusing to run, a chargeback
 * and a KYC failure in one flat list, ordered only by urgency. On 2026-11-24 the
 * panel was "full of cron errors and other things" that buried the money and
 * account work. The inbox now groups by category: MONEY and ACCOUNT are the
 * things an operator must act on with money/members, MARKETPLACE is listings
 * and content, and SYSTEM covers crons/webhooks/channels/infra. OTHER is the
 * honest fallback for a type this table has not been taught yet.
 *
 * ⚠️ ADD NEW ALERT TYPES HERE WHEN YOU ADD THEM. An unclassified type lands in
 * OTHER (shown under "System & other"), never in the money/account badge — a
 * noisy cron must not be able to badge the tab, but a new MONEY type that is not
 * listed here will not badge it either. The classifier has a spec that pins the
 * known families; extend it at the same time.
 */

export type AdminAlertCategory =
  | 'MONEY'
  | 'ACCOUNT'
  | 'MARKETPLACE'
  | 'SYSTEM'
  | 'OTHER';

/** The three groups the inbox renders (MONEY + ACCOUNT stay together). */
export type AdminAlertGroup = 'CORE' | 'MARKETPLACE' | 'SYSTEM';

const MONEY_PREFIXES = [
  'PAYMENT',
  'PEACH_PAYMENT',
  'PEACH_PAYOUT',
  'PEACH_WEBHOOK',
  'OZOW_PAYOUT',
  'OZOW_WEBHOOK',
  'PAYOUT',
  'REFUND',
  'CHARGEBACK',
  'DISPUTE',
  'TRANSACTION',
  'PRIVATE_ARRANGE',
  'PAID_LISTING',
  'SALE_ACCEPT',
  'SALE_REJECT',
  'BUYER_CANCEL',
  'CANCELLATION',
  'STUCK_HELD',
  'SELLER_CHARGE',
  'SHIPPING_CHARGE',
  'STALE_CHECKOUT',
  'STORE_PICKUP',
  'DISPATCH_SLA',
  'ADMIN_REFUND',
  'MOTIVATION_PAYMENT',
  'MOTIVATION_DOUBLE_PAYMENT',
  'ZOHO',
  'INVOICE',
  'COMMISSION',
  'ESCROW',
  'FEE_',
] as const;

const ACCOUNT_PREFIXES = [
  'KYC',
  'BANK_VERIFY',
  'BANV',
  'DEALER_',
  'USER_',
  'ACCOUNT_',
  'COMPLAINT',
  'SUPPORT',
  'ADMIN_ACTION',
  'SAPS_',
  'DOCUMENT_',
  'SMART_ID',
  'MOTIVATION_',
  'LOGIN',
  'PASSWORD',
] as const;

const MARKETPLACE_PREFIXES = [
  'LISTING',
  'SELLER_',
  'POST_',
  'COMMENT_',
  'MESSAGE_',
  'BIDDER_',
  'OFFER_',
  'RATING',
  'FEED_',
] as const;

const SYSTEM_PREFIXES = [
  'CRON',
  'TASK_',
  'BACKUP',
  'WEBHOOK',
  // Yoco is the motivation paygate only; its alerts are webhook/config ones
  // (payment failures surface as MOTIVATION_PAYMENT_*, which are MONEY).
  'YOCO_',
  'SMS_',
  'WHATSAPP_',
  'EMAIL_',
  'MAIL_',
  'SHIPMENT_',
  'PARCEL_',
  'CARRIER_',
  'MONITOR',
  'HEALTH',
  'STORAGE',
  'DISK',
  'MEMORY',
  'SEED',
  'INTEGRATION',
  'SEARCH_',
  'CACHE',
  'DAEMON',
  'WARDEN',
  'ALERT_',
] as const;

function startsWithAny(type: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => type.startsWith(prefix));
}

export function categorizeAdminAlert(type: string): AdminAlertCategory {
  const t = (type ?? '').trim().toUpperCase();
  if (!t) return 'OTHER';
  // Order matters: PEACH_PAYOUT/PEACH_WEBHOOK are money even though they also
  // look payment-shaped, and MOTIVATION_PAYMENT* is money while the rest of
  // MOTIVATION_* is an account/document service.
  if (startsWithAny(t, MONEY_PREFIXES)) return 'MONEY';
  if (startsWithAny(t, ACCOUNT_PREFIXES)) return 'ACCOUNT';
  if (startsWithAny(t, MARKETPLACE_PREFIXES)) return 'MARKETPLACE';
  if (startsWithAny(t, SYSTEM_PREFIXES)) return 'SYSTEM';
  return 'OTHER';
}

export function adminAlertGroup(category: AdminAlertCategory): AdminAlertGroup {
  switch (category) {
    case 'MONEY':
    case 'ACCOUNT':
      return 'CORE';
    case 'MARKETPLACE':
      return 'MARKETPLACE';
    default:
      // SYSTEM and OTHER share the "noise" tab — an unclassified type must not
      // be able to badge the money/account tab.
      return 'SYSTEM';
  }
}

export function groupOfAlertType(type: string): AdminAlertGroup {
  return adminAlertGroup(categorizeAdminAlert(type));
}
