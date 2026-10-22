import {
  AI_OUTAGE_RULES,
  TX_ALERT_RULES,
  USER_ALERT_RULES,
  type TxAlertState,
  type UserAlertState,
} from './admin-alert-reconciler.service';

/**
 * THE PREDICATES, NOT THE QUERIES.
 *
 * The reconciler's risk is not a failed query — it is a rule that closes an
 * alert a human still needed. So each rule is asserted in both directions:
 * the state that proves recovery clears it, and the one that looks similar but
 * does not is left open. The service's own IO is deliberately not mocked here.
 */

const tx = (over: Partial<TxAlertState> = {}): TxAlertState => ({
  id: 'tx_1',
  paymentStatus: 'HELD',
  paidAt: new Date('2026-10-01T10:00:00Z'),
  paidOutAt: null,
  shipmentBookedAt: null,
  deliveredAt: null,
  shippingStatus: null,
  dealerVerificationStatus: null,
  ...over,
});

const user = (over: Partial<UserAlertState> = {}): UserAlertState => ({
  id: 'u_1',
  kycStatus: 'PENDING',
  sellerRejectStrikes: 0,
  sellingBannedAt: null,
  dispatchStrikes: 0,
  auctionStrikes: 0,
  ...over,
});

function txRule(name: string) {
  const rule = TX_ALERT_RULES.find((r) => r.rule === name);
  if (!rule) throw new Error(`missing tx rule ${name}`);
  return rule;
}

function userRule(name: string) {
  const rule = USER_ALERT_RULES.find((r) => r.rule === name);
  if (!rule) throw new Error(`missing user rule ${name}`);
  return rule;
}

describe('transaction alert rules', () => {
  it('closes a held-funds stall only once the money left HELD', () => {
    const rule = txRule('tx-out-of-held');
    expect(rule.types).toEqual(
      expect.arrayContaining(['STUCK_HELD_FUNDS_BUYER_UNCONFIRMED']),
    );
    expect(rule.clear(tx())).toBe(false);
    expect(rule.clear(tx({ paymentStatus: 'RELEASED' }))).toBe(true);
    expect(rule.clear(tx({ paymentStatus: 'REFUNDED' }))).toBe(true);
    expect(rule.clear(tx({ paymentStatus: 'DISPUTED' }))).toBe(false);
  });

  it('closes a booking failure only when a shipment was actually booked', () => {
    const rule = txRule('shipment-booked');
    expect(rule.clear(tx())).toBe(false);
    expect(rule.clear(tx({ shipmentBookedAt: new Date() }))).toBe(true);
  });

  it('closes a transit stall on delivery, not on any other status', () => {
    const rule = txRule('shipment-arrived');
    expect(rule.clear(tx({ shippingStatus: 'IN_TRANSIT' }))).toBe(false);
    expect(rule.clear(tx({ shippingStatus: 'OUT_FOR_DELIVERY' }))).toBe(false);
    expect(rule.clear(tx({ shippingStatus: 'DELIVERED' }))).toBe(true);
    expect(rule.clear(tx({ shippingStatus: 'COLLECTED' }))).toBe(true);
    expect(rule.clear(tx({ deliveredAt: new Date() }))).toBe(true);
  });

  it('closes a failed/returned parcel only after a human settled the money', () => {
    const rule = txRule('shipment-decided');
    expect(rule.clear(tx({ shippingStatus: 'RETURNED' }))).toBe(false);
    expect(rule.clear(tx({ shippingStatus: 'RETURNED', paymentStatus: 'REFUNDED' }))).toBe(true);
    expect(rule.clear(tx({ shippingStatus: 'DELIVERY_FAILED', paymentStatus: 'RELEASED' }))).toBe(true);
  });

  it('closes dealer review only on a verdict or a settled sale', () => {
    const rule = txRule('dealer-decided');
    expect(rule.clear(tx({ dealerVerificationStatus: 'PENDING_ADMIN_REVIEW' }))).toBe(false);
    expect(rule.clear(tx({ dealerVerificationStatus: 'PENDING_CLAUDE' }))).toBe(false);
    expect(rule.clear(tx({ dealerVerificationStatus: 'APPROVED' }))).toBe(true);
    expect(rule.clear(tx({ dealerVerificationStatus: 'REJECTED' }))).toBe(true);
    expect(rule.clear(tx({ paymentStatus: 'RELEASED' }))).toBe(true);
    expect(rule.clear(tx({ paymentStatus: 'REFUNDED' }))).toBe(true);
  });

  it('closes a refused mark-paid only when the order is actually paid', () => {
    const rule = txRule('markpaid-recovered');
    expect(rule.clear(tx({ paidAt: null }))).toBe(false);
    expect(rule.clear(tx())).toBe(true);
  });

  it('closes a failed payout only when the payout completed', () => {
    const rule = txRule('payout-completed');
    expect(rule.clear(tx({ paymentStatus: 'RELEASED' }))).toBe(false);
    expect(rule.clear(tx({ paymentStatus: 'RELEASED', paidOutAt: new Date() }))).toBe(true);
  });

  it('closes a refund failure only on REFUNDED — a release is not a refund', () => {
    const rule = txRule('refund-landed');
    expect(rule.clear(tx({ paymentStatus: 'HELD' }))).toBe(false);
    expect(rule.clear(tx({ paymentStatus: 'RELEASED' }))).toBe(false);
    expect(rule.clear(tx({ paymentStatus: 'REFUNDED' }))).toBe(true);
  });

  it('closes a dispute only when it was resolved either way', () => {
    const rule = txRule('dispute-closed');
    expect(rule.clear(tx({ paymentStatus: 'DISPUTED' }))).toBe(false);
    expect(rule.clear(tx({ paymentStatus: 'RELEASED' }))).toBe(true);
    expect(rule.clear(tx({ paymentStatus: 'REFUNDED' }))).toBe(true);
  });

  it('closes an "approved but unpaid" alert once funded or settled', () => {
    const rule = txRule('dealer-unpaid-recovered');
    expect(rule.clear(tx({ paidAt: null, paymentStatus: 'HELD' }))).toBe(false);
    expect(rule.clear(tx({ paidAt: new Date(), paymentStatus: 'HELD' }))).toBe(true);
    expect(rule.clear(tx({ paidAt: null, paymentStatus: 'REFUNDED' }))).toBe(true);
  });
});

describe('user alert rules', () => {
  it('closes a KYC review only when it left UNDER_REVIEW', () => {
    const rule = userRule('kyc-review-closed');
    expect(rule.clear(user({ kycStatus: 'UNDER_REVIEW' }))).toBe(false);
    expect(rule.clear(user({ kycStatus: 'VERIFIED' }))).toBe(true);
    expect(rule.clear(user({ kycStatus: 'REJECTED' }))).toBe(true);
  });

  it('closes repeated failures only on VERIFIED', () => {
    const rule = userRule('kyc-verified');
    expect(rule.clear(user({ kycStatus: 'PENDING' }))).toBe(false);
    expect(rule.clear(user({ kycStatus: 'REJECTED' }))).toBe(false);
    expect(rule.clear(user({ kycStatus: 'VERIFIED' }))).toBe(true);
  });

  it('closes strike alerts only when the strikes are gone', () => {
    const rule = userRule('reject-strikes-cleared');
    expect(rule.clear(user({ sellerRejectStrikes: 1 }))).toBe(false);
    expect(rule.clear(user({ sellerRejectStrikes: 0, sellingBannedAt: new Date() }))).toBe(false);
    expect(rule.clear(user({ sellerRejectStrikes: 0, sellingBannedAt: null }))).toBe(true);
  });

  it('closes threshold alerts only at zero, the one value below every threshold', () => {
    expect(userRule('dispatch-strikes-cleared').clear(user({ dispatchStrikes: 1 }))).toBe(false);
    expect(userRule('dispatch-strikes-cleared').clear(user({ dispatchStrikes: 0 }))).toBe(true);
    expect(userRule('auction-strikes-cleared').clear(user({ auctionStrikes: 1 }))).toBe(false);
    expect(userRule('auction-strikes-cleared').clear(user({ auctionStrikes: 0 }))).toBe(true);
  });
});

describe('AI outage rules', () => {
  it('proves recovery from a successful call on the same rail, and names that rail', () => {
    const writer = AI_OUTAGE_RULES.find((r) => r.type === 'motivation-writer-down');
    expect(writer?.purposes).toEqual(
      expect.arrayContaining(['motivation.generate', 'motivation.repair']),
    );
    const kyc = AI_OUTAGE_RULES.find((r) => r.type === 'kyc-claude-outage');
    expect(kyc?.purposes).toEqual(expect.arrayContaining(['KYC_VERIFY']));
    const firearm = AI_OUTAGE_RULES.find(
      (r) => r.type === 'firearm-licence-verifier-down',
    );
    expect(firearm?.purposes).toEqual(
      expect.arrayContaining(['listing.licence-read']),
    );
  });
});
