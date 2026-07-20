export type ListingType = 'BUY_NOW' | 'TAKE_A_SHOT' | 'AUCTION' | 'SWOP';
// Hunting Packages / Experiences (Phase E). An experience is NOT a new
// ListingType — it's a snapshot flag (Category.isExperience →
// Listing.isExperience) on a BUY_NOW or AUCTION listing, fulfilled
// on-site (ShippingMethod.ON_SITE_SERVICE, no courier/parcel). This is
// the package "shape": RANGE_DAY (shooting-range day) or PLAINS_GAME_HUNT
// (guided plains-game hunt, which also carries a speciesList).
export type ExperienceType = 'RANGE_DAY' | 'PLAINS_GAME_HUNT';
export type ListingStatus = 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'PAYMENT_PENDING' | 'SOLD' | 'CANCELLED' | 'EXPIRED';
export type Condition = 'NEW' | 'LIKE_NEW' | 'GOOD' | 'FAIR' | 'POOR';
export type SellerTier = 'NEW' | 'ESTABLISHED' | 'TRUSTED' | 'TOP_SELLER' | 'DEALER';
// Subscription tier — orthogonal to SellerTier. Drives the GG+ pill
// (MEMBER/PRO) rendered next to usernames site-wide per Phase E1
// (OD1 locked). FREE users don't get a pill.
export type SubscriptionTier = 'FREE' | 'MEMBER' | 'PRO';
export type Province =
  | 'EASTERN_CAPE'
  | 'FREE_STATE'
  | 'GAUTENG'
  | 'KWAZULU_NATAL'
  | 'LIMPOPO'
  | 'MPUMALANGA'
  | 'NORTH_WEST'
  | 'NORTHERN_CAPE'
  | 'WESTERN_CAPE';

export interface ListingImage {
  id: string;
  url: string;
  publicId: string;
  order: number;
  isPrimary: boolean;
}

// Per-category attribute definition (P4.1/P4.2). Returned by
// GET /categories/:id/attributes — the category's own attributes plus
// any inherited from its ancestors, already sorted leaf-first then by
// sortOrder. Drives the dynamic "Specifications" fields on the Sell
// form and the spec table on listing detail.
export interface CategoryAttributeDef {
  id: string;
  categoryId: string;
  // The key values are stored under on Listing.attributes.
  key: string;
  label: string;
  type: 'NUMBER' | 'SELECT' | 'TEXT' | 'BOOLEAN';
  unit: string | null;
  options: string[];
  required: boolean;
  filterable: boolean;
  sortOrder: number;
  isActive: boolean;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  isFirearm: boolean;
  // Hunting Packages / Experiences (Phase E) — categories whose listings are
  // future-dated on-site services (hunting packages / range days). Snapshotted
  // to Listing.isExperience at create; drives the experience sell flow,
  // detail panel, checkout attestations, and the browse "Experiences" chip.
  isExperience?: boolean;
  // Collection-only categories (e.g. trailers / caravans) — items are
  // collected in person from the seller, never couriered. Forces
  // shippingMethods = ['COLLECTION'] on the listing.
  collectionOnly?: boolean;
  // Requires a papers attestation at listing + checkout (e.g. trailers /
  // caravans need NaTIS registration + roadworthy handed over at
  // collection). Checkbox-only — no documents are collected.
  requiresPapers?: boolean;
  // P5.4 — electronics/appliance categories that show the optional
  // "tested & working" seller-attestation checkbox on the sell form.
  showTestedWorkingAttestation?: boolean;
  // Subset of isFirearm — categories that MUST ship via licensed-dealer
  // transfer (Firearms + Barrels under Gun Smithing).
  requiresLicence: boolean;
  // Whether this category appears on the used marketplace Sell form +
  // filters. False for live-ammo categories.
  availableSecondhand: boolean;
  // Whether this category appears on the dealer New Store (M3 phase).
  availableNewStore: boolean;
  parentId: string | null;
  sortOrder: number;
}

// Returned by GET /categories/with-counts — the active taxonomy plus a
// rolled-up active-listing count per category (a parent's count already
// includes its children). Only the fields the discovery surfaces need are
// typed here; the endpoint is a lean projection, not the full Category row.
export interface CategoryWithCount {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  isActive: boolean;
  sortOrder: number;
  count: number;
}

export interface ListingSeller {
  id: string;
  clerkId: string;
  // Public-facing handle. Gun Galore platform policy: we DON'T
  // display real names anywhere on public listings. Use this in
  // listing-detail / card / Q&A / seller-profile views. firstName/
  // lastName are kept on the payload for internal flows (order
  // confirmation chips, KYC banner) but should not surface on
  // public pages.
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  sellerTier: SellerTier;
  totalSales: number;
  createdAt: string;
  // Phase E1 — Ask GG badges rendered next to username site-wide.
  // OD1 locked: subscriptionTier MEMBER/PRO → GG+ pill.
  // OD2 locked: isVerifiedExpert → verified-expert badge.
  // Browse cards omit expertBadgeReason (smaller payload); listing-
  // detail + seller profile include it so the badge tooltip can
  // show the public rationale the admin entered.
  subscriptionTier?: SubscriptionTier;
  isVerifiedExpert?: boolean;
  expertBadgeReason?: string | null;
  // UX-1b — seller-level rating shown on cards + near the PDP title.
  // averageRating is a cached denormalised field (null until the seller
  // has any rating); _count.ratingsReceived is the review count. Both are
  // populated by the browse + listing-detail selections.
  averageRating?: number | null;
  _count?: { ratingsReceived?: number };
}

// Public seller profile (GET /sellers/:clerkId). Superset of the
// inline ListingSeller — adds avgRating + verifiedExpertAt for the
// profile page header. Powers the /sellers/[clerkId] surface so
// the badge tooltip can show when the badge was granted.
export interface PublicSellerProfile {
  id: string;
  clerkId: string;
  username: string | null;
  avatarUrl: string | null;
  sellerTier: SellerTier;
  totalSales: number;
  averageRating: number | null;
  createdAt: string;
  subscriptionTier: SubscriptionTier;
  isVerifiedExpert: boolean;
  verifiedExpertAt: string | null;
  expertBadgeReason: string | null;
  // Identity (KYC) verified — boolean trust tick, no PII.
  idVerified?: boolean;
}

export interface Address {
  id: string;
  label: string | null;
  building: string | null;
  street: string;
  address2: string | null;
  suburb: string | null;
  city: string;
  postalCode: string;
  province: Province;
  lat: number | null;
  lng: number | null;
  isDefault: boolean;
}

export interface Me {
  id: string;
  email: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  phoneVerified: boolean;
  avatarUrl: string | null;
  sellerTier: SellerTier;
  kycStatus: 'NONE' | 'PENDING' | 'VERIFIED' | 'REJECTED' | 'UNDER_REVIEW';
  kycVerifiedAt: string | null;
  // Set by the backend when the seller's first sale triggers verification.
  // The in-app KYC banner reads this to decide whether to surface.
  kycRequiredAt: string | null;
  // Computed server-side. Buyers: name/phone/address at ~33% each.
  // Sellers (≥1 listing or kycRequiredAt): five sections at 20% each,
  // adding banking + the two identity-verification stages. Render
  // defensively — skip unknown keys so old clients never crash when the
  // backend grows the union.
  profileCompleteness: {
    percent: number; // 0–100
    missing: (
      | 'name'
      | 'phone'
      | 'address'
      | 'banking'
      | 'identity'
      | 'verification'
    )[];
    // 'seller' = the 5×20% shape (drives the verification progress bar);
    // may be absent on older backend deploys — treat missing as 'buyer'.
    shape?: 'buyer' | 'seller';
  };
  trustScore: number;
  averageRating: number | null;
  totalSales: number;
  createdAt: string;
  // Personal / shipping address — distinct from per-listing pickup.
  addrBuilding: string | null;
  addrStreet: string | null;
  addrAddress2: string | null;
  addrSuburb: string | null;
  addrCity: string | null;
  addrPostalCode: string | null;
  addrProvince: Province | null;
  addrLat: number | null;
  addrLng: number | null;
  // Address book (Phase 2) — multiple saved delivery addresses. The
  // legacy single address above stays as the fallback default.
  savedAddresses?: Address[];
  // Per-channel notification mute (Phase 2). Default true.
  notifyEmailEnabled?: boolean;
  notifySmsEnabled?: boolean;
  // Seller default parcel size (Phase 6 P6.3) — pre-fills the sell form.
  defaultWeightGrams?: number | null;
  defaultLengthCm?: number | null;
  defaultWidthCm?: number | null;
  defaultHeightCm?: number | null;
  // Set by POST /users/me/profile-complete (the post-publish modal).
  // Null = the seller still owes us the profile-completion step;
  // payout flow is gated on this being non-null.
  profileCompletedAt: string | null;
  // Banking — collected on the profile-completion modal. Account
  // number is returned masked client-side (we don't show the raw
  // value back); the other fields show in /profile/edit so the
  // seller can confirm what we have on file.
  bankVerifiedAt: string | null;
  bankName: string | null;
  bankAccountHolder: string | null;
  bankAccountNumber: string | null;
  bankBranchCode: string | null;
  bankAccountType: string | null;
}

export interface Listing {
  id: string;
  // Human-trackable code shown to sellers + buyers. Prefix encodes
  // listingType: UM = BUY_NOW, AU = AUCTION, TS = TAKE_A_SHOT.
  // Nullable for legacy rows that haven't been back-filled.
  referenceNumber: string | null;
  title: string;
  description: string;
  price: number | null; // ZAR cents; null for TAKE_A_SHOT
  // UX-7 — optional compare-at / "was" price (ZAR cents). Display-only discount
  // signal (strikethrough + "% off"); BUY_NOW only, > price, ≤ 4× price.
  compareAtPriceZarCents?: number | null;
  listingType: ListingType;
  // Shipping methods the seller offered in the Sell form. Subset of
  // [PUDO, TCG] for non-firearms or [DEALER_TRANSFER, PRIVATE_ARRANGE]
  // for firearms. Empty array means "any legal option" (legacy).
  // Firearm listings ALWAYS include DEALER_TRANSFER (mandatory per
  // platform policy 2026-05-26 + SAPS regs); PRIVATE_ARRANGE is the
  // optional additional offer the seller can include.
  shippingMethods: ShippingMethod[];
  // Optional free-text hint of where the seller plans to dealer-stock
  // a firearm (e.g. "Pretoria Arms, Centurion"). Shown to buyers on
  // listing detail so a buyer near that dealer can factor it into
  // their decision. Null for non-firearms or when the seller didn't
  // fill it in. Seller is not bound to this dealer — the actual
  // stocking dealer is captured later at dealer-verification time.
  plannedDealerLocation: string | null;
  // Structured planned dealer-stock parts (mandatory for firearms since
  // 2026-07-13). plannedDealerLocation above is the composed display string.
  plannedDealerName: string | null;
  plannedDealerProvince: string | null;
  plannedDealerArea: string | null;
  status: ListingStatus;
  condition: Condition;
  province: Province;
  isFirearm: boolean;
  // DD-3 — true for a first-party Daily Deal listing. Present on the public
  // GET /listings/:id payload so the generic PDP can redirect to the
  // deal-chrome /deals/[id] page. Absent (undefined) on browse payloads.
  isDealListing?: boolean;
  // Collection-only — this item is collected in person from the seller
  // (no courier). Mirrors the category flag; forces shippingMethods to
  // ['COLLECTION']. Payment is held until the buyer confirms collection.
  collectionOnly?: boolean;
  // Requires a papers attestation (trailers / caravans). Seller attests
  // they hold valid registration + roadworthy at listing time; the buyer
  // acknowledges at checkout. Checkbox-only — no documents are collected.
  requiresPapers?: boolean;
  // P5.4 — set (ISO string) when the seller made the optional "tested &
  // working" claim at listing. The SELLER'S own statement (CPA s41), shown as
  // a "Seller attests: tested & working" badge on the detail page.
  testedWorkingAttestedAt?: string | null;
  // ── Hunting Packages / Experiences (Phase E) ──────────────────────────
  // isExperience is snapshotted from Category.isExperience at create (like
  // isFirearm). When true the listing is a future-dated on-site SERVICE —
  // BUY_NOW or AUCTION only, fulfilled via ShippingMethod.ON_SITE_SERVICE
  // (no courier / no parcel), funds held until the buyer confirms it
  // happened. The experience-panel + checkout attestations + order-page CPA
  // cancel quote all gate on this flag. All the metadata below is null on a
  // non-experience listing.
  isExperience?: boolean;
  experienceType?: ExperienceType | null;
  eventStartDate?: string | null; // scheduled date / window start (ISO)
  eventEndDate?: string | null; // null = single day; set = multi-day window
  eventProvince?: Province | null;
  locationText?: string | null; // property / area, free text (no exact address)
  capacitySlots?: number | null; // hunters / guests the package accommodates
  durationText?: string | null; // e.g. "3 nights / 2 hunting days"
  speciesList?: string[]; // for PLAINS_GAME_HUNT
  whatsIncluded?: string | null; // accommodation, PH/guide, field prep…
  rifleProvided?: boolean; // rifle provided vs bring-your-own
  supplierRegistrationNumber?: string | null;
  // Inventory / quantity (Phase 8a). trackInventory=false for single items.
  trackInventory?: boolean;
  quantityAvailable?: number;
  quantityReserved?: number;
  make: string | null;
  model: string | null;
  calibre: string | null;
  // Per-category structured attributes (P4.2) — keyed by
  // CategoryAttributeDef.key. Values are number | string | boolean.
  // Null / absent when the category has no attributes or none were
  // filled. Join against GET /categories/:id/attributes for labels +
  // units to render the specifications table.
  attributes?: Record<string, unknown> | null;
  passFeeToBuyer: boolean;
  // Owner-only: the hidden auto-accept/auto-decline thresholds are
  // returned by GET /listings/:id ONLY to the seller (edit-form
  // prefill), so they're optional on the shared type — absent from the
  // public/anonymous payload.
  autoAcceptThreshold?: number | null;
  autoDeclineThreshold?: number | null;
  // SWOP honest-value anchor (public by design — negotiation display).
  declaredValueCents?: number | null;
  // Claude moderation fields. decision/reasons/autoFixApplied come back ONLY
  // to the owner (their moderation banner); confidence/reviewedAt/
  // originalDescription are admin-only and never on this endpoint. All
  // optional — absent from the public payload.
  claudeDecision?:
    | 'APPROVE'
    | 'AUTO_FIX_AND_APPROVE'
    | 'REJECT'
    | 'HUMAN_REVIEW'
    | null;
  claudeConfidence?: number | null;
  claudeReasons?: string[];
  claudeReviewedAt?: string | null;
  claudeAutoFixApplied?: boolean;
  claudeOriginalDescription?: string | null;
  // Auction fields
  // Owner-only hidden reserve (edit-form prefill); never in the public payload.
  reservePrice?: number | null;
  buyNowPrice: number | null;
  isFeatured: boolean;
  currentBid: number | null;
  // Never exposed publicly (reveals the current high bidder's identity).
  currentBidderId?: string | null;
  bidCount: number;
  reserveMet: boolean;
  startTime: string | null;
  endTime: string | null;
  durationDays: number | null;
  endedAt: string | null;
  categoryId: string;
  sellerId: string;
  category: Category;
  seller: ListingSeller;
  images: ListingImage[];
  createdAt: string;
  updatedAt: string;
  /** Aggregated social-proof — how many users have saved this listing
   * to their wishlist. Set by ListingsService.findById via Prisma's
   * `_count: { wishlistedBy: true }`. Only present on listing detail
   * responses (browse responses omit it for the smaller payload). */
  _count?: { wishlistedBy?: number };
}

export interface BrowseResponse {
  listings: Listing[];
  total: number;
  page: number;
  limit: number;
}

// ── Daily Deals (DD-3) ────────────────────────────────────────────────
// The buyer-facing projection returned by the public GET /deals[/:id] API
// (DealsService.publicShape). Deliberately carries NO cost / margin / revenue
// / supplier fields — those are admin-only. Money in ZAR cents. `seller` is
// username-only (the house account). `buyable` is the checkout truth the PDP
// uses to switch the CTA to an ended / sold-out state.
export interface DealPublic {
  id: string;
  status:
    | 'LIVE'
    | 'EXTENDED'
    | 'ENDED'
    | 'SOLD_OUT'
    | 'DRAFT'
    | 'SCHEDULED'
    | 'CANCELLED';
  listingId: string;
  referenceNumber: string | null;
  title: string;
  description: string;
  condition: Condition;
  province: Province;
  make: string | null;
  model: string | null;
  calibre: string | null;
  shippingMethods: ShippingMethod[];
  images: ListingImage[];
  category: { name: string; slug: string } | null;
  seller: { clerkId: string; username: string | null } | null;
  // Money (cents)
  dealPriceCents: number;
  wasPriceCents: number;
  savePct: number;
  // Scarcity
  trackInventory: boolean;
  quantityAvailable: number;
  initialStock: number;
  perCustomerCap: number;
  shipsInDaysMin: number;
  shipsInDaysMax: number;
  // Lifecycle + countdown (ISO strings from the API)
  listingStatus: ListingStatus;
  buyable: boolean;
  soldOut: boolean;
  ended: boolean;
  startsAt: string | null;
  endsAt: string | null;
  liveAt: string | null;
  soldOutAt: string | null;
}

// Public storefront index response. `enabled:false` (with an empty list) is
// what the API returns while the `deals_enabled` killswitch is off — the
// storefront renders its "no live deals" state, keeping DD-3 inert.
export interface DealsResponse {
  enabled: boolean;
  deals: DealPublic[];
}

// P5.6 — sold-price comps for a category. Only `count` is guaranteed; the
// price fields are present only when count >= the server's min-comps gate
// (below that the range is withheld for POPIA + statistical honesty). All
// amounts are ZAR cents, per-unit. Aggregates only — the API never returns
// individual sale rows (that would enable competitor re-identification).
export interface SoldComps {
  count: number;
  low?: number;
  high?: number;
  median?: number;
}

// P5.7 — a brand that clears the min-listings gate and gets its own landing
// page. `slug` powers /brand/[slug]; `label` is the display casing.
export interface BrandSummary {
  slug: string;
  label: string;
  count: number;
}

export type PaymentStatus = 'HELD' | 'PENDING_ADMIN_VERIFICATION' | 'RELEASED' | 'DISPUTED' | 'REFUNDED';
export type ShippingMethod =
  | 'PUDO'              // Pudo locker-to-locker (non-firearm)
  | 'TCG'               // The Courier Guy door-to-door (non-firearm)
  | 'DEALER_TRANSFER'   // Routed through a SAPS-licensed dealer (firearm)
  | 'PRIVATE_ARRANGE'   // Buyer + seller arrange in-person transfer at a dealer
  | 'COLLECTION'        // In-person collection from the seller — no courier
  | 'ON_SITE_SERVICE';  // Hunting Packages / Experiences — future-dated on-site
                        // service. No courier, no parcel; the buyer attends on
                        // the event date. Invisible to every courier sweep.
export type ShippingStatus = 'PENDING' | 'COLLECTED' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'DELIVERY_FAILED' | 'RETURNED';

export interface Transaction {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  listingPrice: number;
  commissionZar: number;
  processingFee: number;
  shippingCost: number;
  shippingHandlingCents: number;
  passFeeToBuyer: boolean;
  buyerTotal: number;
  sellerPayout: number;
  paymentStatus: PaymentStatus;
  peachCheckoutId: string | null;
  paidAt: string | null;
  releasedAt: string | null;
  shippingMethod: ShippingMethod | null;
  shippingStatus: ShippingStatus | null;
  trackingReference: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  // P5.2 platform-arranged dispatch — set when the platform books the
  // courier on seller-accept. carrierDropoffPin is the Pudo locker PIN
  // (seller-only; blanked for the buyer). shipmentBookedAt present ⇒ a real
  // waybill exists and the seller can print the label.
  carrierShipmentId: string | null;
  carrierDropoffPin: string | null;
  shipmentBookedAt: string | null;
  // P6.2 — per-seller shipping consolidation. When this line is a SIBLING of a
  // consolidated parcel, shipsWithId points at the "carrier" (main item) line
  // that owns the combined shipping fee, the booked waybill/PIN and the
  // tracking. Siblings mirror the carrier's dispatch/delivery status but carry
  // no waybill of their own (trackingReference stays null). shipsWith surfaces
  // just enough of the carrier for the order page to link across to it. Both
  // are null on a normal (non-consolidated) line and on the carrier itself.
  shipsWithId: string | null;
  shipsWith?: {
    id: string;
    trackingReference: string | null;
    shippingStatus: ShippingStatus | null;
  } | null;
  // Phase 5 — fulfilment. estimatedDeliveryAt = best-effort window set at
  // dispatch (null for non-courier). podReference = auto-captured carrier
  // delivery event; podProofUrl = optional uploaded delivery photo.
  estimatedDeliveryAt: string | null;
  podReference: string | null;
  podProofUrl: string | null;
  // TOK-7 — seller accept→dispatch state machine. acceptDeadlineAt =
  // paidAt + 48h (stamped at payment), dispatchDeadlineAt = acceptedAt
  // + 5d (stamped at accept). rejectedAt + rejectedReason set when
  // the seller declines the sale (triggers buyer refund).
  // acceptEscalatedAt is set by the 48h-no-accept escalation cron.
  acceptedAt: string | null;
  acceptDeadlineAt: string | null;
  dispatchDeadlineAt: string | null;
  rejectedAt: string | null;
  rejectedReason: string | null;
  acceptEscalatedAt: string | null;
  dealerId: string | null;
  confirmedDeliveryAt: string | null;
  // PRIVATE_ARRANGE — set when the buyer accepted the hard-consent
  // screen at checkout. Used by the order page to gate the
  // contact-reveal card.
  privateArrangeAcceptedAt: string | null;
  // ── Hunting Packages / Experiences (Phase E) ──────────────────────────
  // An experience booking (listing.isExperience, shippingMethod
  // ON_SITE_SERVICE): the buyer picks an eventDate within the listing's
  // window + a partySize (≤ capacitySlots), and payment stays HELD until the
  // buyer confirms the experience happened (or a CPA-s17 cancellation runs).
  // These drive the order-page experience panel. Null on every other flow.
  eventDate?: string | null; // the scheduled date the buyer chose (ISO)
  eventEndDate?: string | null; // copy of the listing window end for multi-day
  partySize?: number | null; // hunters / guests on this booking
  // Outfitter (seller) accepts / declines the booking, then the buyer
  // confirms it happened on/after the event date.
  bookingConfirmedAt?: string | null;
  bookingDeclinedAt?: string | null;
  eventCompletedConfirmedAt?: string | null;
  // Dealer stock-in verification (firearm DEALER_TRANSFER only).
  // See backend/src/payments/dealer-verification.service.ts for the
  // lifecycle. Null on every other shipping method.
  dealerVerificationStatus:
    | 'PENDING_UPLOAD'
    | 'PENDING_CLAUDE'
    | 'PENDING_ADMIN_REVIEW'
    | 'APPROVED'
    | 'REJECTED'
    | null;
  dealerVerificationScore: number | null;
  dealerVerifiedAt: string | null;
  // Stocked-at dealer contact — captured at upload time, sent to
  // the buyer on APPROVED (per the new auto-payout flow). Null
  // until the seller uploads verification with the contact filled in.
  stockedAtDealerName: string | null;
  stockedAtDealerAddress: string | null;
  stockedAtDealerPhone: string | null;
  createdAt: string;
  updatedAt: string;
  listing: Listing;
  // Phone + the seller-side email are only populated on a paid
  // PRIVATE_ARRANGE — the backend blanks them on every other path so
  // a curious party can't pluck them out of the JSON.
  buyer: {
    // Public surfaces (order page chips, etc.) show @username per
    // platform policy. firstName/lastName remain for KYC-related
    // flows and shipping labels where the real name is required.
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    email?: string | null;
    phone?: string | null;
  };
  seller: {
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    email?: string | null;
    phone?: string | null;
  };
  dealer: { id: string; name: string; city: string } | null;
}

// Mirror of backend/src/shipping/pudo.service.ts → ShippingQuote.
// Returned by POST /shipping/quote — the checkout breakdown reads
// priceCents and serviceName to render the line item.
export interface ShippingQuote {
  serviceCode: string;
  serviceName: string;
  priceCents: number;
  boxName?: string;
}

export interface FeeBreakdown {
  listingPrice: number;
  // ZAR cents. Courier rate locked at checkout time; 0 for firearm
  // listings (DEALER_TRANSFER / PRIVATE_ARRANGE don't use Pudo).
  shippingCost: number;
  commissionZar: number;
  processingFee: number;
  buyerTotal: number;
  sellerPayout: number;
}

export interface Rating {
  id: string;
  transactionId: string;
  stars: number;
  comment: string | null;
  // Seller's single public reply (null until they respond).
  sellerResponse: string | null;
  createdAt: string;
  // Username-only on public review surfaces (platform policy — real
  // names never on public-facing screens). Backend ratings.service.ts
  // selects only username.
  rater: { username: string | null };
  transaction: { listing: { title: string } };
}

export interface TrustDashboard {
  trustScore: number;
  sellerTier: SellerTier;
  totalSales: number;
  averageRating: number | null;
  recentRatings: Rating[];
}

export type OfferStatus =
  | 'PENDING'
  | 'COUNTERED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'EXPIRED'
  | 'CONVERTED';

export interface Offer {
  id: string;
  listingId: string;
  buyerId: string;
  offerAmount: number;
  counterAmount: number | null;
  buyerNote: string | null;
  sellerNote: string | null;
  status: OfferStatus;
  expiresAt: string;
  transactionId: string | null;
  createdAt: string;
  updatedAt: string;
  listing: {
    id: string;
    title: string;
    images: { url: string; isPrimary: boolean }[];
    // Drives the offer-checkout form's shipping routing. A firearm offer
    // must go DEALER_TRANSFER; the form hides courier options for it.
    isFirearm?: boolean;
    shippingMethods?: ShippingMethod[];
    // Collection-only listing — collected in person, no courier. When
    // set the form forces shippingMethods = ['COLLECTION'].
    collectionOnly?: boolean;
    // Requires a papers attestation at checkout (trailers / caravans).
    requiresPapers?: boolean;
    // Public-facing offer surfaces — username only per platform policy.
    // Backend offers.service.ts selects username + clerkId only.
    seller: { username: string | null; clerkId: string };
  };
  buyer?: {
    username: string | null;
    clerkId: string;
    totalSales: number;
  };
}

export interface Message {
  id: string;
  transactionId: string;
  senderClerkId: string;
  content: string;
  wasModerated: boolean;
  readAt: string | null;
  createdAt: string;
}

