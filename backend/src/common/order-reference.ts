// The order reference shown to a human — buyer, seller, dealer counter staff.
//
// There is no `orderNumber` column. `Transaction.orderReference` is only set
// when a real EFT/manual-reconciliation path allocated one (see the `⚠️`
// notes beside `orderReference` in schema.prisma); everything else falls
// back to the last 8 characters of the cuid, uppercased, which is what the
// codebase already did in two places before this file existed
// (`transactions.service.ts` at the SAP 534 email assembly and the SAP 534
// re-download endpoint) — this just gives that fallback one name and one
// definition instead of two copies that could drift.
//
// ⚠️ WHY THIS MATTERS MORE NOW THAN IT DID. A WhatsApp message may never
// name the listed item (operator instruction + Meta commerce-policy
// mitigation — see whatsapp-templates.ts) — only this reference. On every
// other channel it is one line among several (email shows the item title,
// SMS shows a truncated title, the inbox row links straight to the
// transaction). On WhatsApp it is the ONLY thing that identifies which order
// a message is about. A bug here is not a cosmetic mismatch on one channel;
// it is the one identifying detail on a channel that has been deliberately
// stripped of every other one.
//
// Dependency-free, like account-standing.ts and seller-reject-policy.ts —
// a pure function, no Prisma import needed beyond the shape it reads.

/** The minimal shape `orderRef` needs — a Transaction (or Order) row, or a
 *  loose object carrying just its id and orderReference. */
export interface HasOrderReference {
  id: string;
  orderReference?: string | null;
}

/**
 * The reference to show a human for this order: the real `orderReference`
 * when one was allocated, else the last 8 characters of the id, uppercased.
 */
export function orderRef(tx: HasOrderReference): string {
  return tx.orderReference ?? tx.id.slice(-8).toUpperCase();
}
