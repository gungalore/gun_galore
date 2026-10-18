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
// ⚠️ SCOPE (operator, 2026-10-17): WhatsApp carries SALES and DOCUMENT
// notifications only. Shipping/delivery tracking is sent by Bob Go directly,
// so no shipment template lives here any more. Do not reintroduce one.
//
// Everything here is STATIC, not env-driven. `metaName` is fixed by what
// Meta approved in WhatsApp Manager; only credentials (WHATSAPP_TOKEN etc.)
// are env. `render()` must mirror the approved body character for character.
//
// Most URL buttons resolve through `https://alloutdoor.co.za/t/<code>` —
// see `frontend/app/t/[code]/route.ts`. The courier sale template uses the
// approved static base `https://alloutdoor.co.za/a/` and its action token as
// the dynamic suffix, so it lands on the signed, one-use accept page.
//
// ⚠️ NEW OR CHANGED TEMPLATES ARE NOT LIVE UNTIL META APPROVES THEM. Until
// then Meta answers 132001 (non-retryable), the send is logged as FAILED and
// the caller falls back to SMS exactly as it does for any other miss.

export interface WhatsappTemplateDef {
  /** Internal lookup key, used by call sites and the message log. */
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
  /**
   * False = the approved Meta template's URL button is FULLY STATIC (no
   * `{{1}}` in it). A button component must NOT be sent for those — Meta
   * rejects a parameter count that does not match the template. Defaults to
   * true, because most buttons carry a per-instance suffix.
   */
  buttonParam?: boolean;
  /**
   * 'url' (default) → a URL button component is sent, filling `linkCode`.
   * 'quick_reply' → the buttons are baked into the approved Meta template
   * (e.g. the Private Arrangement "Item delivered / Item received / Dispute"
   * pair); NO button component is sent and `linkVars`/`linkCode` are unused.
   */
  buttonType?: 'url' | 'quick_reply';
  /** The exact approved body, for specs and operations reference. */
  render: (v: Record<string, string>) => string;
}

export const WHATSAPP_TEMPLATES: Record<string, WhatsappTemplateDef> = {
  // ── Sales — offers and auctions ────────────────────────────────────
  // These are the notifications that move a deal forward. Bodies are static
  // (no amount, no title) and the button lands on the member's own list, so
  // nothing sensitive reaches a lock screen.
  offer_received_seller: {
    key: 'offer_received_seller',
    metaName: 'offer_received_seller',
    lang: 'en',
    requiredVars: [],
    linkVars: [],
    linkCode: () => 'r',
    buttonParam: false,
    render: () =>
      `You have a new offer on one of your listings. Open it to accept, reject or counter.`,
  },
  offer_accepted_buyer: {
    key: 'offer_accepted_buyer',
    metaName: 'offer_accepted_buyer',
    lang: 'en',
    requiredVars: [],
    linkVars: [],
    linkCode: () => 'y',
    buttonParam: false,
    render: () =>
      `An offer you made was accepted. Pay within 24 hours to secure the item.`,
  },
  offer_countered_buyer: {
    key: 'offer_countered_buyer',
    metaName: 'offer_countered_buyer',
    lang: 'en',
    requiredVars: [],
    linkVars: [],
    linkCode: () => 'y',
    buttonParam: false,
    render: () =>
      `The seller countered your offer. Review it and respond within 24 hours.`,
  },
  bid_outbid_buyer: {
    key: 'bid_outbid_buyer',
    metaName: 'bid_outbid_buyer',
    lang: 'en',
    requiredVars: [],
    linkVars: [],
    linkCode: () => 'w',
    buttonParam: false,
    render: () =>
      `You have been outbid on an auction. Bid again before it closes.`,
  },
  auction_won_buyer: {
    key: 'auction_won_buyer',
    metaName: 'auction_won_buyer',
    lang: 'en',
    requiredVars: [],
    linkVars: [],
    linkCode: () => 'w',
    buttonParam: false,
    render: () => `You won an auction. Pay within 24 hours to secure it.`,
  },

  // ── Sales — paid sale lifecycle ────────────────────────────────────
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
  // Sellers get the date/time picker from the URL button. The Meta
  // template's static URL is https://alloutdoor.co.za/a/{{1}}; `acceptToken`
  // is the one-use TRANSACTION_ACCEPT credential minted at payment. Decline
  // is a Quick Reply handled by WhatsappWebhookController; the webhook then
  // returns a reason-picker link inside Meta's 24h service window.
  new_sale_seller_courier: {
    key: 'new_sale_seller_courier',
    metaName: 'new_sale_seller_courier',
    lang: 'en',
    requiredVars: ['ref'],
    linkVars: ['acceptToken'],
    linkCode: (v) => v.acceptToken,
    render: (v) =>
      `You have a sale. Order ${v.ref} is paid. Accept to choose a courier collection date and time.`,
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
    render: (v) =>
      `A refund has been issued for order ${v.ref}. Please allow a few days for it to clear.`,
  },
  dealer_collection_ready_buyer: {
    key: 'dealer_collection_ready_buyer',
    metaName: 'dealer_collection_ready_buyer',
    lang: 'en',
    requiredVars: ['ref'],
    linkVars: ['txId'],
    linkCode: (v) => `t${v.txId}`,
    render: (v) =>
      `Order ${v.ref} is ready for collection at your chosen dealer. Bring your identity document and your licence paperwork.`,
  },

  // ── Private Arrangement handover (quick-reply buttons) ──────────────
  // Funds are HELD after payment. The button TAPS are handled by
  // WhatsappWebhookController (message.button.text) → the private-arrange
  // endpoints. Bodies carry only the order reference, never a title.
  private_arrange_seller_handover: {
    key: 'private_arrange_seller_handover',
    metaName: 'private_arrange_seller_handover',
    lang: 'en',
    requiredVars: ['ref'],
    linkVars: [],
    buttonType: 'quick_reply',
    linkCode: () => '',
    render: (v) =>
      `Order ${v.ref}. If you've handed the item to the buyer, tap Item delivered. If there's a problem, tap Dispute.`,
  },
  private_arrange_buyer_confirm: {
    key: 'private_arrange_buyer_confirm',
    metaName: 'private_arrange_buyer_confirm',
    lang: 'en',
    requiredVars: ['ref'],
    linkVars: [],
    buttonType: 'quick_reply',
    linkCode: () => '',
    render: (v) =>
      `Order ${v.ref}. Once you've received your item, tap Item received to release the seller's payment. If there's a problem, tap Dispute.`,
  },
  private_arrange_buyer_reminder: {
    key: 'private_arrange_buyer_reminder',
    metaName: 'private_arrange_buyer_reminder',
    lang: 'en',
    requiredVars: ['ref'],
    linkVars: [],
    buttonType: 'quick_reply',
    linkCode: () => '',
    render: (v) =>
      `Reminder for order ${v.ref}. Please confirm you received your item, or tap Dispute. Payment auto-releases to the seller 5 days after payment.`,
  },

  // ── Licence Centre — motivations ───────────────────────────────────
  // Same lock-screen rule as the motivation inbox/SMS copy: the MO reference
  // is the ONLY identifier. Never the firearm, calibre or licence section.
  motivation_ready_applicant: {
    key: 'motivation_ready_applicant',
    metaName: 'motivation_ready_applicant',
    lang: 'en',
    requiredVars: ['ref'],
    linkVars: ['motivationId'],
    linkCode: (v) => `m${v.motivationId}`,
    render: (v) =>
      `Document ${v.ref} is ready. Open it to read it through and download the pack.`,
  },
  motivation_needs_info_applicant: {
    key: 'motivation_needs_info_applicant',
    metaName: 'motivation_needs_info_applicant',
    lang: 'en',
    requiredVars: ['ref'],
    linkVars: ['motivationId'],
    linkCode: (v) => `m${v.motivationId}`,
    render: (v) =>
      `Document ${v.ref} needs a bit more detail. Open it to add what is missing.`,
  },
  motivation_failed_applicant: {
    key: 'motivation_failed_applicant',
    metaName: 'motivation_failed_applicant',
    lang: 'en',
    requiredVars: ['ref'],
    linkVars: ['motivationId'],
    linkCode: (v) => `m${v.motivationId}`,
    render: (v) =>
      `We could not finish document ${v.ref}. Nothing is lost and nothing has been charged. Open it and try again.`,
  },

  // ── Welcome ─────────────────────────────────────────────────────────
  welcome_complete_profile: {
    key: 'welcome_complete_profile',
    metaName: 'welcome_complete_profile',
    lang: 'en',
    requiredVars: [],
    // Nothing to fill in: the profile page is the same page for everyone.
    // ⚠️ The approved Meta template's button is `…/t/{{1}}`, NOT a static
    // `…/t/p` — so the button parameter MUST be sent (buttonParam defaults
    // true). The class of 2026-10-18 verified this against the live template.
    linkVars: [],
    linkCode: () => 'p',
    render: () =>
      `Welcome to All Outdoor. Finish setting up your profile so you can buy, sell and get your order updates here.`,
  },
};
