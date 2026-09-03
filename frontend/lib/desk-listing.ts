/**
 * THE DESK — the listing dossier and the moderation decision.
 *
 * ⚠️ THIS MODULE MODELS LESS THAN THE ENDPOINT SENDS, ON PURPOSE.
 * admin/listings/:id/dossier does `include: { seller: … }` with no `select`
 * on the listing itself, so the wire carries every scalar column on the row —
 * the seller's email, the name vision read off the firearm licence, the
 * seller's street, suburb and postcode. None of those are inputs to "should
 * this listing go live", so none of them are typed here. A field that has no
 * type cannot be rendered by accident, and a reviewer reading this file can
 * see at a glance what the Desk decided it needed. If a future decision
 * genuinely needs one of them, add it here with the reason it is needed.
 *
 * The one identity-bearing thing that IS reachable is the licence photo, and
 * it is reachable only as a link the operator clicks — see LICENCE_PHOTO_NOTE.
 */
import { deskFetch } from './desk-auth';

/* ────────────────────────────────────────────────────────────────────────
 * The wire
 * ──────────────────────────────────────────────────────────────────────── */

export type ListingStatusWire =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'ACTIVE'
  | 'PAYMENT_PENDING'
  | 'SOLD'
  | 'CANCELLED'
  | 'EXPIRED';

/** Prisma's ClaudeDecision. The model's call, never the listing's status. */
export type ModelDecisionWire = 'APPROVE' | 'AUTO_FIX_AND_APPROVE' | 'REJECT' | 'HUMAN_REVIEW';

export interface DossierImage {
  id: string;
  url: string;
  order: number;
  isPrimary: boolean;
}

/**
 * The seller, as the moderation decision needs them.
 *
 * ⚠️ NO EMAIL. The endpoint sends one; a listing is approved or rejected on
 * what is in the listing, and a mail address on screen is a contact detail
 * the decision never consults. The seller is identified by username here and
 * everywhere else on the Desk.
 */
export interface DossierSeller {
  id: string;
  username: string | null;
  sellerTier: string | null;
  kycStatus: string | null;
  trustScore: number | null;
}

export interface DossierCategory {
  id: string;
  name: string;
  /** The category's own flag. Listing.isFirearm is the snapshot of it. */
  isFirearm: boolean;
}

export interface DossierListing {
  id: string;
  referenceNumber: string | null;
  title: string;
  description: string;
  status: ListingStatusWire;
  listingType: string;
  condition: string;
  createdAt: string;

  /** ZAR cents. What the buyer pays; null on a swap or a price-less type. */
  price: number | null;
  /** ZAR cents the seller receives on a marked-up BUY_NOW. Null otherwise. */
  sellerAskCents: number | null;

  province: string;
  /** Town/city only — the coarse vicinity a buyer is shown. */
  publicLocality: string | null;

  /* Regulated snapshots, taken off the category at create time. */
  isFirearm: boolean;
  publicVisible: boolean;
  collectionOnly: boolean;
  requiresPapers: boolean;
  papersAttestedAt: string | null;
  isExperience: boolean;

  make: string | null;
  model: string | null;
  calibre: string | null;

  /* SAP 534 capture. Present only on licence-controlled listings. */
  firearmType: string | null;
  serialNumber: string | null;
  serialPhotoUrl: string | null;
  licencePhotoUrl: string | null;
  licenceExpiresAt: string | null;
  plannedDealerLocation: string | null;
  privateArrangeConsentAt: string | null;
  shippingMethods: string[];

  /* The model's read of the listing at create time. Advisory, always. */
  claudeDecision: ModelDecisionWire | null;
  claudeConfidence: number | null;
  claudeReasons: string[];
  claudeReviewedAt: string | null;
  claudeOriginalDescription: string | null;
  claudeAutoFixApplied: boolean;

  /* The last human decision on this row, if there was one. */
  adminReviewedAt: string | null;
  adminOverrideReason: string | null;

  seller: DossierSeller;
  category: DossierCategory;
  images: DossierImage[];
  _count: { offers: number; bids: number; watchers: number };
}

export interface DossierAuditEvent {
  id: string;
  action: string;
  reason: string | null;
  createdAt: string;
  /**
   * The staff account that acted. A work address, not a member's — it is
   * here because "who rejected this last time" is a question the operator
   * asks before overriding a colleague, and a decision with no actor is not
   * an audit trail.
   */
  adminUser: { email: string } | null;
}

export interface DossierQuestion {
  id: string;
  question: string;
  answer: string | null;
  status: string;
  reportedCount: number;
  createdAt: string;
}

/**
 * The whole response.
 *
 * offers / bids / watchers / transactions come down too. This drawer is the
 * moderation decision, and a listing awaiting review has none of them, so it
 * renders the counts the listing already carries rather than the rows. The
 * rows belong to whatever surface is about a live listing's trading history.
 */
export interface ListingDossier {
  listing: DossierListing;
  auditEvents: DossierAuditEvent[];
  questions: DossierQuestion[];
}

export function fetchListingDossier(listingId: string): Promise<ListingDossier> {
  return deskFetch<ListingDossier>(
    `/admin/listings/${encodeURIComponent(listingId)}/dossier`,
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Regulated categories
 * ──────────────────────────────────────────────────────────────────────── */

export interface RegulatedFlag {
  key: string;
  /** Short enough to sit on a band beside its detail line. */
  label: string;
  detail: string;
  tone: 'bad' | 'warn' | 'info';
}

/**
 * What makes this listing regulated, in the order it matters.
 *
 * ⚠️ THIS IS COMPLIANCE, NOT A BADGE. The drawer renders these as a band the
 * operator cannot collapse, above everything else, because approving a
 * firearm listing is a different act from approving a camp chair and the
 * difference has to land before the button does — not in a section that
 * opens on click, and not as a tag competing with four other tags.
 *
 * Every flag is a snapshot the listing took off its category at create time,
 * so this reads the listing and never re-derives from the category: if the
 * category was re-flagged yesterday, the listing was still created under the
 * rules it carries.
 */
export function regulatedFlags(l: DossierListing): RegulatedFlag[] {
  const flags: RegulatedFlag[] = [];

  if (l.isFirearm) {
    flags.push({
      key: 'firearm',
      label: 'Firearm — licence-controlled',
      detail:
        'Approving this publishes a licence-controlled item. Dealer transfer is compulsory; private arrangement needs the seller’s consent on file.',
      tone: 'bad',
    });
  }

  if (l.isExperience) {
    flags.push({
      key: 'experience',
      label: 'On-site experience',
      detail:
        'A dated on-site service, not a parcel. The supplier’s registration and insurance documents are part of this decision.',
      tone: 'warn',
    });
  }

  if (l.requiresPapers) {
    flags.push({
      key: 'papers',
      label: 'Papers change hands',
      detail: l.papersAttestedAt
        ? 'The seller attested they hold the registration papers.'
        : 'No papers attestation on file — the category requires one.',
      tone: l.papersAttestedAt ? 'info' : 'warn',
    });
  }

  if (l.collectionOnly) {
    flags.push({
      key: 'collection',
      label: 'Collection only',
      detail: 'No courier is quoted. The buyer collects in person and funds stay held until they confirm.',
      tone: 'info',
    });
  }

  if (!l.publicVisible) {
    flags.push({
      key: 'members-only',
      label: 'Members only',
      detail:
        'A gated category: signed-out visitors never see this listing. That gate is what keeps the regulated catalogue off third-party crawlers.',
      tone: 'info',
    });
  }

  return flags;
}

/* ────────────────────────────────────────────────────────────────────────
 * Licence standing
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * ⚠️ 'none' AND 'unknown' ARE NOT THE SAME THING AND MUST NOT SHARE A VALUE.
 * 'none' is "this is not a firearm, there is no licence to stand anywhere".
 * 'unknown' is "this IS a firearm and nothing on the row says when its licence
 * runs out" — the weakest evidence of any firearm case, and the one that most
 * needs saying. They were one value once; the compliance band filtered
 * `state !== 'none'` to mean "not a firearm" and silently swallowed every
 * missing-expiry warning with it.
 */
export type LicenceState = 'none' | 'unknown' | 'expired' | 'blocked' | 'warning' | 'ok';

export interface LicenceStanding {
  state: LicenceState;
  label: string;
  tone: 'bad' | 'warn' | 'ok' | 'info';
  /** Whole days until expiry. Negative once it has passed. */
  days: number | null;
}

/**
 * How the firearm licence on this listing stands today.
 *
 * ⚠️ THE THRESHOLDS ARE THE BACKEND'S, NOT THE DESK'S. The listing gate and
 * the daily auto-delist cron both treat "expired or thirty days out" as
 * unlistable and 31–90 days as a warning. If the operator approves inside
 * thirty days the cron delists it within the day, which reads to the seller
 * as the Desk contradicting itself — so the drawer says so before the press.
 */
export function licenceStanding(l: DossierListing): LicenceStanding {
  if (!l.isFirearm) return { state: 'none', label: 'Not applicable', tone: 'info', days: null };
  if (!l.licenceExpiresAt) {
    return { state: 'unknown', label: 'No expiry captured', tone: 'warn', days: null };
  }
  const days = Math.floor((new Date(l.licenceExpiresAt).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { state: 'expired', label: `Expired ${Math.abs(days)}d ago`, tone: 'bad', days };
  if (days <= 30) {
    return { state: 'blocked', label: `Expires in ${days}d — unlistable`, tone: 'bad', days };
  }
  if (days <= 90) return { state: 'warning', label: `Expires in ${days}d`, tone: 'warn', days };
  return { state: 'ok', label: `Expires in ${days}d`, tone: 'ok', days };
}

/**
 * Whether this licence has to be said out loud — in the band the operator
 * cannot collapse, and again on the confirm under their cursor.
 *
 * ⚠️ ONE PREDICATE, BECAUSE TWO SURFACES ASK THE SAME QUESTION. The band and
 * the approve confirm each used to spell this out inline, and they disagreed:
 * the band asked `state !== 'none'` and the confirm asked `tone === 'bad'`, so
 * a firearm whose licence expires in 45 days reached the band and never
 * reached the press. A rule that has to hold in two places lives in one.
 */
export function licenceNeedsSaying(s: LicenceStanding | null | undefined): boolean {
  return !!s && s.state !== 'none' && s.tone !== 'ok';
}

/* ────────────────────────────────────────────────────────────────────────
 * What the seller's number means
 * ──────────────────────────────────────────────────────────────────────── */

export interface SellerTake {
  /** The row's key. It names what the figure IS, and never overstates it. */
  label: string;
  /** ZAR cents, straight off the column. Nothing is computed here. */
  cents: number;
  /** The sentence under the row, or null when the label is the whole truth. */
  note: string | null;
  tone?: 'warn';
}

/**
 * ⚠️ sellerAskCents IS NOT ALWAYS WHAT THE SELLER RECEIVES, AND A MODERATION
 * SCREEN THAT SAYS IT IS HAS JOINED THE LIST OF SURFACES THAT GUESSED.
 *
 * listings.service.priceFieldsFor sets sellerAskCents on EVERY BUY_NOW with a
 * price and marks Listing.price up over it — experiences included. But
 * payments/fee-presentation.feeModelFor sends an experience down SELLER_DEDUCT
 * (`!isExperience && isMarkedUpBuyNow`), so checkout deducts commission off the
 * already-marked-up price and ignores sellerAskCents entirely. On that one
 * listing shape the column is a number nobody will ever be paid.
 *
 * The platform has one fee builder for exactly this class of bug, and it is
 * transaction-shaped — it reads feeModel, buyerTotal, commissionZar,
 * processingFee, none of which exist before a sale. So this mirrors the ONE
 * rule that builder branches on rather than inventing a second one, and it
 * computes no money: it decides what the stored cents may be CALLED.
 *
 * Null when there is no seller figure to show — an auction, a swap, or a
 * BUY_NOW created before the markup model.
 */
export function sellerTake(l: DossierListing): SellerTake | null {
  if (l.sellerAskCents === null) return null;

  if (l.isExperience) {
    return {
      label: 'Seller asked for',
      cents: l.sellerAskCents,
      tone: 'warn',
      note:
        'Not a payout. An experience checks out on the deduct model, so commission comes off the marked-up price above and this figure is not used. Query it before publishing.',
    };
  }

  return {
    label: 'Seller receives',
    cents: l.sellerAskCents,
    note: 'Our fees are inside the buyer’s price — nothing is deducted from the seller.',
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * The model's verdict
 * ──────────────────────────────────────────────────────────────────────── */

export interface ModelVerdict {
  decision: ModelDecisionWire;
  /** Prose, not the enum. */
  label: string;
  tone: 'ok' | 'warn' | 'bad' | 'info';
  /** 0–100, already rounded. Null when the model recorded no confidence. */
  confidencePct: number | null;
  reasons: string[];
  reviewedAt: string | null;
  /** The model rewrote the description; the seller's original is kept. */
  autoFixApplied: boolean;
  originalDescription: string | null;
}

const MODEL_LABEL: Record<ModelDecisionWire, { label: string; tone: ModelVerdict['tone'] }> = {
  APPROVE: { label: 'Would approve', tone: 'ok' },
  AUTO_FIX_AND_APPROVE: { label: 'Would approve after edits', tone: 'warn' },
  REJECT: { label: 'Would reject', tone: 'bad' },
  HUMAN_REVIEW: { label: 'Wants a human', tone: 'info' },
};

/**
 * ⚠️ AN OPINION, AND THE WORDING SAYS SO. Every label here is conditional —
 * "would approve", never "approved" — because the operator's decision
 * overrides the model's and a screen that states the model's call as a fact
 * about the listing quietly turns a review into a rubber stamp. Nothing on
 * this surface pre-selects a button from this value either.
 */
export function modelVerdict(l: DossierListing): ModelVerdict | null {
  if (!l.claudeDecision) return null;
  const { label, tone } = MODEL_LABEL[l.claudeDecision];
  return {
    decision: l.claudeDecision,
    label,
    tone,
    confidencePct:
      typeof l.claudeConfidence === 'number' ? Math.round(l.claudeConfidence * 100) : null,
    reasons: l.claudeReasons ?? [],
    reviewedAt: l.claudeReviewedAt,
    autoFixApplied: l.claudeAutoFixApplied,
    originalDescription: l.claudeOriginalDescription,
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * The decision
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * ⚠️ ONLY PENDING_REVIEW IS ACCEPTED SERVER-SIDE. reviewListing throws
 * "Listing is not pending review" on anything else, so the drawer has to say
 * which decision is available rather than offering a button that 400s.
 */
export function canReview(status: ListingStatusWire): boolean {
  return status === 'PENDING_REVIEW';
}

/** Take-down is for a listing that already went live. Nothing to take down otherwise. */
export function canTakeDown(status: ListingStatusWire): boolean {
  return status === 'ACTIVE' || status === 'PAYMENT_PENDING';
}

export interface ListingReason {
  value: string;
  /** The operator's shorthand, on the radio row. */
  label: string;
  /** The sentence the seller reads in the email. Shown under the label. */
  sellerText: string;
}

/**
 * ⚠️ A REJECTION IS A LETTER TO THE SELLER, SO THE REASON IS A TICKLIST AND
 * NOT AN EMPTY BOX.
 *
 * reviewListing emails the seller and refuses a reason under five characters
 * — the backend enforces that because a bare "your listing was rejected"
 * generated support tickets nobody could answer. A ticklist does two more
 * things a text box cannot: the same rejection is worded the same way by
 * every operator, and the operator can see the exact sentence the seller
 * will read before they send it.
 *
 * The free-text note is additive — it is appended to the sentence, never
 * instead of it.
 */
export const LISTING_REJECT_REASONS: ListingReason[] = [
  {
    value: 'PHOTOS',
    label: 'Photos don’t show the item',
    sellerText:
      'The photos don’t show the item clearly enough to list it. Please add clear, well-lit photos of the actual item.',
  },
  {
    value: 'DESCRIPTION',
    label: 'Description too thin',
    sellerText:
      'The description doesn’t say enough about the item’s condition and specifics. Please add the detail a buyer would need.',
  },
  {
    value: 'WRONG_CATEGORY',
    label: 'Wrong category',
    sellerText: 'This listing is in the wrong category. Please relist it under the correct one.',
  },
  {
    value: 'LICENCE_PROOF',
    label: 'Licence or serial proof doesn’t match',
    sellerText:
      'The licence or serial proof doesn’t match the listing. Please relist with photos of the licence and the serial on the item itself.',
  },
  {
    value: 'PROHIBITED',
    label: 'Item may not be sold here',
    sellerText: 'This item may not be sold on All Outdoor.',
  },
  {
    value: 'OFF_PLATFORM',
    label: 'Contact details or off-site link',
    sellerText:
      'The listing contains contact details or a link away from All Outdoor. Please remove them and relist.',
  },
  {
    value: 'PRICE',
    label: 'Price looks wrong',
    sellerText: 'The price looks like an error. Please check it and relist.',
  },
  {
    value: 'DUPLICATE',
    label: 'Duplicate of a live listing',
    sellerText: 'This duplicates a listing you already have live.',
  },
  { value: 'OTHER', label: 'Something else', sellerText: 'This listing can’t go live as it stands.' },
];

/**
 * Taking down a listing that already went live.
 *
 * Deliberately a separate list from the rejection reasons: the seller gets a
 * different email ("removed after going live" is not "rejected at review"),
 * and buyers may already have seen the item — so the reasons that matter here
 * are the ones that explain a disappearance, not a refusal.
 */
export const LISTING_TAKEDOWN_REASONS: ListingReason[] = [
  {
    value: 'SAFETY',
    label: 'Safety or legal risk',
    sellerText: 'We removed this listing because it raises a safety or legal concern.',
  },
  {
    value: 'LICENCE_LAPSED',
    label: 'Licence lapsed or invalid',
    sellerText:
      'We removed this listing because the licence on file has lapsed or could not be verified.',
  },
  {
    value: 'MISREPRESENTED',
    label: 'Item misrepresented',
    sellerText: 'We removed this listing because the item is not as described.',
  },
  {
    value: 'PROHIBITED',
    label: 'Item may not be sold here',
    sellerText: 'We removed this listing because this item may not be sold on All Outdoor.',
  },
  {
    value: 'SELLER_REQUEST',
    label: 'Seller asked us to',
    sellerText: 'We removed this listing at your request.',
  },
  {
    value: 'COMPLAINT',
    label: 'Upheld complaint',
    sellerText: 'We removed this listing following a complaint we upheld.',
  },
  {
    value: 'OTHER',
    label: 'Something else',
    sellerText: 'We removed this listing.',
  },
];

/** The backend's own bounds on the reason, mirrored so we never post a 400. */
export const REASON_MIN_CHARS = 5;
export const REASON_MAX_CHARS = 500;

/**
 * Turn a ticked reason plus an optional note into the sentence the seller
 * reads. Trimmed to the column's 500 characters at this end, because the
 * alternative is a 400 the operator reads as "the Desk is broken".
 */
export function composeSellerReason(
  options: ListingReason[],
  value: string,
  note: string,
): string {
  const picked = options.find((o) => o.value === value);
  const base = picked?.sellerText ?? '';
  const extra = note.trim();
  const full = extra ? `${base} ${extra}` : base;
  return full.slice(0, REASON_MAX_CHARS);
}

/**
 * Approve or reject a listing awaiting review.
 *
 * ⚠️ REJECTION ALWAYS CARRIES A REASON. The server refuses an empty one and
 * so does this — not as a duplicate check but because the reason is the
 * whole content of the email the seller is about to receive.
 */
export function reviewListing(
  listingId: string,
  action: 'APPROVE' | 'REJECT',
  reason?: string,
): Promise<unknown> {
  if (action === 'REJECT' && (reason ?? '').trim().length < REASON_MIN_CHARS) {
    return Promise.reject(new Error('A rejection reason is required — the seller reads it.'));
  }
  return deskFetch(`/admin/listings/${encodeURIComponent(listingId)}/review`, {
    method: 'POST',
    body: JSON.stringify({ action, reason }),
  });
}

/** Pull a live listing down. Soft-delete to CANCELLED; the seller is emailed the reason. */
export function takeDownListing(listingId: string, reason: string): Promise<unknown> {
  if (reason.trim().length < REASON_MIN_CHARS) {
    return Promise.reject(new Error('A reason is required — the seller reads it.'));
  }
  return deskFetch(`/admin/listings/${encodeURIComponent(listingId)}/delete`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

/* ────────────────────────────────────────────────────────────────────────
 * Small readings
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * ⚠️ THE LICENCE PHOTO IS SOMEONE'S IDENTITY DOCUMENT. It is never rendered
 * inline with the item photos: a licence carries the holder's full name and
 * their identity number, and a moderation queue on a shared screen is the
 * last place either belongs by default. The drawer offers it as a labelled
 * link, so opening it is a deliberate second act by an operator who has
 * decided the decision needs it.
 */
export const LICENCE_PHOTO_NOTE =
  'Opens the licence document — it carries the holder’s name and ID number.';

export const STATUS_LABEL: Record<ListingStatusWire, string> = {
  DRAFT: 'Draft',
  PENDING_REVIEW: 'Awaiting review',
  ACTIVE: 'Live',
  PAYMENT_PENDING: 'Reserved for checkout',
  SOLD: 'Sold',
  CANCELLED: 'Taken down',
  EXPIRED: 'Expired',
};

/** Why no decision is on offer, in the words the gated button carries. */
export function noDecisionReason(status: ListingStatusWire): string {
  switch (status) {
    case 'DRAFT':
      return 'A draft has not been submitted for review yet.';
    case 'SOLD':
      return 'This listing is sold. Anything owed to either party runs through the order.';
    case 'CANCELLED':
      return 'This listing is already down.';
    case 'EXPIRED':
      return 'This listing expired. The seller relists it.';
    default:
      return 'No review decision applies to this listing.';
  }
}

/**
 * "2 Sep 09:14" — SAST, for a record you read rather than act on.
 *
 * Copied rather than imported from lib/desk-site: a listing drawer pulling in
 * the Site board's fetchers for one date format is a worse trade than nine
 * duplicated lines. If a third copy appears, that is the moment for a shared
 * lib/desk-format.
 */
export function stamp(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Johannesburg',
  });
}

/** "3d" · "22m" — how long this listing has been waiting on us. */
export function waitedFor(since: string | null): string {
  if (!since) return '—';
  const mins = (Date.now() - new Date(since).getTime()) / 60000;
  if (mins < 60) return `${Math.floor(mins)}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
}

/** "Good" from GOOD, "Like new" from LIKE_NEW — enums are not prose. */
export function humanise(value: string | null): string {
  if (!value) return '—';
  const words = value.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
