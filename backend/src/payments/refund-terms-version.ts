/**
 * Version of the no-refund acknowledgement a buyer ticked at checkout.
 *
 * Stamped onto Transaction.buyerTermsAckVersion SERVER-side. Never sent by the
 * client: User.consentPolicyVersion is client-supplied and overwritable, and a
 * version the client can choose is not evidence of anything.
 *
 * BUMP THIS whenever the acknowledgement copy in
 * frontend/components/buyer-terms-ack.tsx changes, or when Refund & Dispute
 * Policy paragraph 5 changes. If it goes stale, every dispute after the change
 * points at wording the buyer never saw — which is exactly how
 * POLICY_VERSION ended up frozen at 2026-07-17 while /terms and /privacy both
 * moved underneath it.
 */
export const REFUND_TERMS_VERSION = '2026-08-16';
