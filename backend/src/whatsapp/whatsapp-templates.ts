// ─── WhatsApp template registry — THE ONE REVIEWED FILE ────────────────────
//
// 🚨 HARD RULE, ENFORCED HERE STRUCTURALLY: a WhatsApp message may NEVER
// contain the listed item's title or description — only the order
// reference. This is an operator instruction AND a Meta commerce-policy
// survival measure: the platform sells firearms, and Meta has already
// restricted the site twice for regulated goods. `requiredVars` below may
// only ever name `ref` / `waybill` / `pin` / `txId` — never `title`,
// `listingTitle`, `item` or `name`. `whatsapp-templates.spec.ts` asserts this
// across the whole registry, and a `render()` output is checked against a
// fixture listing title to catch a body that quietly leaks it.
//
// Everything here is STATIC, not env-driven. `metaName` is fixed by what
// Meta approved in WhatsApp Manager; only credentials (WHATSAPP_TOKEN etc.)
// are env. `render()` must mirror the approved body character for character
// — it is what the Desk preview shows an admin before a reply goes out, and
// what the spec pins against Meta's own grammar rules (no leading/trailing
// variable, no two adjacent variables, one URL button, one variable in its
// suffix).
//
// The URL button always resolves to `https://alloutdoor.co.za/t/<code>` —
// see `frontend/app/t/[code]/route.ts` for what each one-letter prefix does.
// `linkCode` builds the suffix (everything after `/t/`) from the SAME `vars`
// object `render` gets, which is why `vars` may carry `txId` even on
// templates whose body has no variables at all (`welcome_complete_profile`).

export interface WhatsappTemplateDef {
  /** Internal lookup key, used by call sites and by the Desk drawer. */
  key: string;
  /** The exact name submitted to and approved by Meta — snake_case. */
  metaName: string;
  lang: 'en';
  /**
   * Ordered body variables ({{1}}, {{2}}, …). NEVER contains a title —
   * see the file header. Empty for a template with no body placeholders.
   */
  requiredVars: readonly string[];
  /**
   * Variables `linkCode` needs — declared separately from `requiredVars`
   * because they never reach the body, only the URL-button suffix.
   *
   * ⚠️ THEY ARE STILL VALIDATED BEFORE A SEND. A missing `txId` would build
   * the suffix `tundefined`, which `resolveShortCode` rejects and redirects
   * to the home page — a live WhatsApp button that silently goes nowhere,
   * and a sent message cannot be recalled. Declaring them here is what lets
   * `sendTemplate` refuse before anything leaves.
   */
  linkVars: readonly string[];
  /** The URL-button suffix appended to `https://alloutdoor.co.za/t/`. */
  linkCode: (v: Record<string, string>) => string;
  /** The exact approved body, for the Desk preview and for specs. */
  render: (v: Record<string, string>) => string;
}

export const WHATSAPP_TEMPLATES: Record<string, WhatsappTemplateDef> = {
  // ── Ship first (the proving pair) ──────────────────────────────────
  order_confirmed_buyer: {
    key: 'order_confirmed_buyer',
    metaName: 'order_confirmed_buyer',
    lang: 'en',
    requiredVars: ['ref'],
    linkVars: ['txId'],
    linkCode: (v) => `t${v.txId}`,
    render: (v) =>
      `Order ${v.ref} is confirmed and your payment is protected. We'll message you again when it ships.`,
  },
  shipment_dispatched_buyer: {
    key: 'shipment_dispatched_buyer',
    metaName: 'shipment_dispatched_buyer',
    lang: 'en',
    requiredVars: ['ref'],
    linkVars: ['txId'],
    linkCode: (v) => `t${v.txId}`,
    render: (v) => `Order ${v.ref} has been collected by the courier and is on its way.`,
  },

  // ── Then, in approval order ────────────────────────────────────────
  new_sale_seller: {
    key: 'new_sale_seller',
    metaName: 'new_sale_seller',
    lang: 'en',
    requiredVars: ['ref'],
    linkVars: ['txId'],
    linkCode: (v) => `t${v.txId}`,
    render: (v) =>
      `You have a sale. Order ${v.ref} is paid and waiting for you to accept and arrange handover.`,
  },
  sale_accept_reminder_seller: {
    key: 'sale_accept_reminder_seller',
    metaName: 'sale_accept_reminder_seller',
    lang: 'en',
    requiredVars: ['ref'],
    linkVars: ['txId'],
    linkCode: (v) => `t${v.txId}`,
    render: (v) =>
      `Reminder: order ${v.ref} is still waiting for you to accept. The window closes soon.`,
  },
  shipment_booked_seller_locker: {
    key: 'shipment_booked_seller_locker',
    metaName: 'shipment_booked_seller_locker',
    lang: 'en',
    requiredVars: ['ref', 'waybill', 'pin'],
    linkVars: ['txId'],
    linkCode: (v) => `t${v.txId}`,
    render: (v) =>
      `Order ${v.ref} is booked. Waybill ${v.waybill} and your drop-off PIN is ${v.pin} — take both to the locker.`,
  },
  shipment_booked_seller_door: {
    key: 'shipment_booked_seller_door',
    metaName: 'shipment_booked_seller_door',
    lang: 'en',
    requiredVars: ['ref', 'waybill'],
    linkVars: ['txId'],
    linkCode: (v) => `t${v.txId}`,
    render: (v) =>
      `Order ${v.ref} is booked. Waybill ${v.waybill} — the courier will collect from your address.`,
  },
  dispatch_nudge_seller: {
    key: 'dispatch_nudge_seller',
    metaName: 'dispatch_nudge_seller',
    lang: 'en',
    requiredVars: ['ref'],
    linkVars: ['txId'],
    linkCode: (v) => `t${v.txId}`,
    render: (v) =>
      `Order ${v.ref} is still waiting to be dispatched. Please arrange it to keep the sale on track.`,
  },
  shipment_out_for_delivery_buyer: {
    key: 'shipment_out_for_delivery_buyer',
    metaName: 'shipment_out_for_delivery_buyer',
    lang: 'en',
    requiredVars: ['ref'],
    linkVars: ['txId'],
    linkCode: (v) => `t${v.txId}`,
    render: (v) => `Order ${v.ref} is out for delivery today.`,
  },
  shipment_delivered_buyer: {
    key: 'shipment_delivered_buyer',
    metaName: 'shipment_delivered_buyer',
    lang: 'en',
    requiredVars: ['ref'],
    linkVars: ['txId'],
    linkCode: (v) => `t${v.txId}`,
    render: (v) =>
      `Order ${v.ref} has been delivered. Please confirm receipt so the seller can be paid.`,
  },
  confirm_receipt_nudge_buyer: {
    key: 'confirm_receipt_nudge_buyer',
    metaName: 'confirm_receipt_nudge_buyer',
    lang: 'en',
    requiredVars: ['ref'],
    linkVars: ['txId'],
    linkCode: (v) => `t${v.txId}`,
    render: (v) => `Order ${v.ref} is still waiting for you to confirm receipt.`,
  },
  shipment_failed_buyer: {
    key: 'shipment_failed_buyer',
    metaName: 'shipment_failed_buyer',
    lang: 'en',
    requiredVars: ['ref'],
    linkVars: ['txId'],
    linkCode: (v) => `t${v.txId}`,
    render: (v) =>
      `There was a delivery problem with order ${v.ref}. Please open it to see what happens next.`,
  },
  parcel_delivered_seller: {
    key: 'parcel_delivered_seller',
    metaName: 'parcel_delivered_seller',
    lang: 'en',
    requiredVars: ['ref'],
    linkVars: ['txId'],
    linkCode: (v) => `t${v.txId}`,
    render: (v) =>
      `Order ${v.ref} has been delivered to the buyer. Payment is released once they confirm receipt.`,
  },
  payment_released_seller: {
    key: 'payment_released_seller',
    metaName: 'payment_released_seller',
    lang: 'en',
    requiredVars: ['ref'],
    linkVars: ['txId'],
    linkCode: (v) => `t${v.txId}`,
    render: (v) =>
      `Payment for order ${v.ref} has been released and is on its way to your bank account.`,
  },
  refund_issued_buyer: {
    key: 'refund_issued_buyer',
    metaName: 'refund_issued_buyer',
    lang: 'en',
    requiredVars: ['ref'],
    linkVars: ['txId'],
    linkCode: (v) => `t${v.txId}`,
    render: (v) => `A refund has been issued for order ${v.ref}.`,
  },
  firearm_ready_at_dealer_buyer: {
    key: 'firearm_ready_at_dealer_buyer',
    metaName: 'firearm_ready_at_dealer_buyer',
    lang: 'en',
    requiredVars: ['ref'],
    linkVars: ['txId'],
    linkCode: (v) => `t${v.txId}`,
    render: (v) =>
      `Order ${v.ref} is ready for collection at your chosen dealer. Bring your identity document and your licence paperwork.`,
  },

  // ── Welcome ─────────────────────────────────────────────────────────
  welcome_complete_profile: {
    key: 'welcome_complete_profile',
    metaName: 'welcome_complete_profile',
    lang: 'en',
    requiredVars: [],
    // Nothing to fill in: the profile page is the same page for everyone.
    linkVars: [],
    linkCode: () => 'p',
    render: () =>
      `Welcome to All Outdoor. Finish setting up your profile so you can buy, sell and get your order updates here.`,
  },
};
