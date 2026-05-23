export type ListingType = 'BUY_NOW' | 'TAKE_A_SHOT' | 'AUCTION';
export type ListingStatus = 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'PAYMENT_PENDING' | 'SOLD' | 'CANCELLED' | 'EXPIRED';
export type Condition = 'NEW' | 'LIKE_NEW' | 'GOOD' | 'FAIR' | 'POOR';
export type SellerTier = 'NEW' | 'ESTABLISHED' | 'TRUSTED' | 'TOP_SELLER' | 'DEALER';
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

export interface Category {
  id: string;
  name: string;
  slug: string;
  isFirearm: boolean;
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
  kycStatus: 'NONE' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  kycVerifiedAt: string | null;
  // Set by the backend when the seller's first sale triggers VerifyNow.
  // The in-app KYC banner reads this to decide whether to surface.
  kycRequiredAt: string | null;
  // Computed server-side from name + verified phone + address-with-coords.
  // Drives the nav completion ring + JIT prompts.
  profileCompleteness: {
    percent: number; // 0 | 33 | 67 | 100
    missing: ('name' | 'phone' | 'address')[];
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
  listingType: ListingType;
  // Shipping methods the seller offered in the Sell form. Subset of
  // [PUDO, TCG] for non-firearms or [DEALER_TRANSFER, PRIVATE_ARRANGE]
  // for firearms. Empty array means "any legal option" (legacy).
  shippingMethods: ShippingMethod[];
  status: ListingStatus;
  condition: Condition;
  province: Province;
  isFirearm: boolean;
  make: string | null;
  model: string | null;
  calibre: string | null;
  passFeeToBuyer: boolean;
  autoAcceptThreshold: number | null;
  // Claude moderation fields
  claudeDecision:
    | 'APPROVE'
    | 'AUTO_FIX_AND_APPROVE'
    | 'REJECT'
    | 'HUMAN_REVIEW'
    | null;
  claudeConfidence: number | null;
  claudeReasons: string[];
  claudeReviewedAt: string | null;
  claudeAutoFixApplied: boolean;
  claudeOriginalDescription: string | null;
  // Auction fields
  reservePrice: number | null;
  buyNowPrice: number | null;
  isFeatured: boolean;
  currentBid: number | null;
  currentBidderId: string | null;
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
}

export interface BrowseResponse {
  listings: Listing[];
  total: number;
  page: number;
  limit: number;
}

export type PaymentStatus = 'HELD' | 'PENDING_ADMIN_VERIFICATION' | 'RELEASED' | 'DISPUTED' | 'REFUNDED';
export type ShippingMethod =
  | 'PUDO'              // Pudo locker-to-locker (non-firearm)
  | 'TCG'               // The Courier Guy door-to-door (non-firearm)
  | 'DEALER_TRANSFER'   // Routed through a SAPS-licensed dealer (firearm)
  | 'PRIVATE_ARRANGE';  // Buyer + seller arrange in-person transfer at a dealer
export type ShippingStatus = 'PENDING' | 'COLLECTED' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'DELIVERY_FAILED' | 'RETURNED';

export interface Transaction {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  listingPrice: number;
  commissionZar: number;
  processingFee: number;
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
  dealerId: string | null;
  confirmedDeliveryAt: string | null;
  // PRIVATE_ARRANGE — set when the buyer accepted the hard-consent
  // screen at checkout. Used by the order page to gate the
  // contact-reveal card.
  privateArrangeAcceptedAt: string | null;
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

// ----- Raffles / Competitions ----------------------------------------------

export type RaffleStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'CLOSED_AWAITING_DRAW'
  | 'DRAWN'
  | 'CLAIMED'
  | 'CANCELLED_MIN_NOT_MET'
  | 'CANCELLED_BY_ADMIN'
  | 'EXPIRED_UNCLAIMED';

export interface RaffleImage {
  id: string;
  url: string;
  order: number;
  isPrimary: boolean;
}

export interface Raffle {
  id: string;
  referenceNumber: string | null;
  title: string;
  description: string;
  imageUrl: string | null;
  itemValueCents: number;
  itemCostCents: number;
  // Derived on the backend as ceil(itemValueCents / ticketPriceCents);
  // kept on the row so the progress bar / sold-out trigger don't have
  // to recompute it.
  targetTicketCount: number;
  ticketPriceCents: number;
  ticketsSoldPaid: number;
  ticketsSoldPostal: number;
  // Multiple-choice question (C is always the correct answer; the
  // correct-answer field is intentionally NOT exposed by the API).
  question: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  startTime: string;
  drawAt: string | null;
  drawnAt: string | null;
  status: RaffleStatus;
  images: RaffleImage[];
}

export interface AdminRaffleRow extends Raffle {
  drawSeed: string | null;
  drawSeedHash: string | null;
  winningTicketId: string | null;
  parentRaffleId: string | null;
  relistGeneration: number;
  createdAt: string;
  updatedAt: string;
  _count: { tickets: number; winners: number };
  // Mini-summary of every winner so the competitions list can render
  // Drawn / Needs-dispatch tabs without a per-row second fetch.
  // PII-safe: only username + state timestamps; real names live behind
  // the per-raffle /admin/raffles/:id/winners dossier endpoint.
  winners: {
    id: string;
    position: number;
    claimedAt: string | null;
    forfeitedAt: string | null;
    prizeDispatchedAt: string | null;
    user: { username: string | null } | null;
  }[];
}

// Full winner dossier returned by GET /admin/raffles/:id/winners.
// Contains the high-PII shipping fields admins need — keep this off
// any buyer-facing surface.
export interface AdminRaffleWinnerDossier {
  raffle: {
    id: string;
    title: string;
    referenceNumber: string | null;
    status: string;
  };
  winners: {
    id: string;
    raffleId: string;
    userId: string | null;
    ticketId: string;
    position: number;
    claimDeadline: string;
    claimedAt: string | null;
    forfeitedAt: string | null;
    prizeDispatchedAt: string | null;
    prizeTrackingRef: string | null;
    prizeCarrierLabel: string | null;
    prizeDispatchedByAdminId: string | null;
    prizeDispatchNote: string | null;
    createdAt: string;
    user: {
      id: string;
      username: string | null;
      firstName: string | null;
      lastName: string | null;
      email: string;
      phone: string | null;
      addrBuilding: string | null;
      addrStreet: string | null;
      addrAddress2: string | null;
      addrSuburb: string | null;
      addrCity: string | null;
      addrProvince: string | null;
      addrPostalCode: string | null;
    } | null;
  }[];
}

export interface DrawProof {
  id: string;
  title: string;
  referenceNumber: string | null;
  drawSeed: string | null;
  drawSeedHash: string | null;
  drawnAt: string | null;
  winningTicketId: string | null;
  ticketsSoldPaid: number;
  ticketsSoldPostal: number;
}

export interface RaffleAuditEvent {
  id: string;
  raffleId: string;
  eventType: string;
  payloadJson: string | null;
  actorUserId: string | null;
  actorAdminId: string | null;
  createdAt: string;
}

export interface MyTicket {
  id: string;
  ticketNumber: number;
  referenceCode: string;
  status: 'PENDING_PAYMENT' | 'CONFIRMED' | 'REFUNDED' | 'POSTAL';
  amountCents: number;
  paidAt: string | null;
  createdAt: string;
  raffle: {
    id: string;
    title: string;
    imageUrl: string | null;
    status: RaffleStatus;
    drawAt: string | null;
  };
}

export interface MyWin {
  id: string;
  raffleId: string;
  ticketId: string;
  position: number;
  claimDeadline: string;
  claimedAt: string | null;
  forfeitedAt: string | null;
  createdAt: string;
  raffle: {
    id: string;
    title: string;
    imageUrl: string | null;
    itemValueCents: number;
    status: RaffleStatus;
    drawnAt: string | null;
  };
}
