import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SearchService, INDEXES } from '../search/search.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { BrowseListingsDto } from './dto/browse-listings.dto';
import { Listing, ListingStatus, ListingType, Province, ShippingMethod } from '@prisma/client';
import {
  ListingModerationService,
  ListingModerationResult,
  hashAttempt,
  categorizeReason,
} from '../moderation/listing-moderation.service';
import { PreviewListingDto } from './dto/preview-listing.dto';
import { SettingsService, FLAGS } from '../settings/settings.service';
import { ReferenceNumberService } from '../common/reference-number.service';
import { assertAccountNotClosed } from '../common/account-standing';
import { FirearmLicenceService } from './firearm-licence.service';
import { inventoryEligible } from '../payments/inventory';
import { CategoriesService } from '../categories/categories.service';
import { WishlistAlertsService } from '../wishlist-alerts/wishlist-alerts.service';
import { ActivityService } from '../activity/activity.service';
import { validateAndCleanAttributes } from './attribute-validation';
import { toPublicLocality } from './locality';
import { Prisma } from '@prisma/client';
import { FeeCalculator } from '../payments/fee.calculator';

// Public-safe projection for the unauthenticated GET /listings/:id detail
// endpoint. This is an explicit ALLOWLIST: every field named here is safe to
// hand to an anonymous caller, and — crucially — any Listing column NOT named
// here is withheld by construction, so a newly-added column is private by
// default until someone deliberately exposes it.
//
// NEVER add to this list (they are leaked to the world otherwise):
//   • reservePrice / autoAcceptThreshold — hidden seller thresholds; the app
//     only ever exposes the derived `reserveMet` boolean.
//   • currentBidderId — reveals the identity of the current high bidder.
//   • serialNumber / serialPhotoUrl / licencePhotoUrl / licenceHolderName
//     (the seller's real name!) / licenceExpiresAt / licenceExpiryWarnedAt /
//     firearmType — SAP-534 firearm serial + licence capture.
//   • pickup* (building/street/address2/suburb/city/postalCode/lat/lng) +
//     pickupPudoLockerId — the seller's private pickup address & geolocation.
//   • adminReviewedById / adminReviewedAt / adminOverrideReason — internal
//     admin moderation notes.
//   • claudeConfidence / claudeReviewedAt / claudeOriginalDescription — model
//     moderation internals (the original, pre-auto-fix description especially).
//   • supplierRegistrationNumber / supplierRegistrationDocUrl /
//     supplierInsuranceUrl / supplierAttestedAt / supplierDocReview* — supplier
//     document URLs + internal review outcome.
//   • priceDropNotifiedAt — internal notification throttle bookkeeping.
// The owner (see findById) additionally receives reservePrice,
// autoAcceptThreshold, and the three claude* fields the moderation banner
// needs — via a separate, token-gated select.
export const PUBLIC_LISTING_SELECT = {
  id: true,
  referenceNumber: true,
  sellerId: true,
  categoryId: true,
  title: true,
  description: true,
  price: true,
  compareAtPriceZarCents: true,
  listingType: true,
  // SWOP honest-value anchor — PUBLIC BY DESIGN (it is the negotiation
  // display + dispute ceiling; unlike reserve/thresholds it must be seen
  // by the counterparty). Null for every non-SWOP listing.
  declaredValueCents: true,
  status: true,
  condition: true,
  province: true,
  // Town/city only — NEVER a street, unit, building or suburb. This is the
  // vicinity a buyer must see before paying, and it is the factual basis for
  // "location is not a refund ground". See listings/locality.ts for why the
  // granularity stops at town.
  publicLocality: true,
  isFirearm: true,
  // Needed by findById to decide whether an ANONYMOUS caller may see this row
  // at all (members-only categories 404 without a session). Harmless to
  // expose: by the time a caller holds this object they are either signed in
  // or looking at a publicly-visible listing anyway.
  publicVisible: true,
  // DD-3 — non-sensitive boolean flag. A first-party Daily Deal listing is
  // reachable by id on the generic PDP endpoint once ACTIVE; the frontend PDP
  // reads this to redirect to the deal-chrome /deals/:id page (canonical). Safe
  // to expose (it reveals nothing about cost/margin/reserve).
  isDealListing: true,
  collectionOnly: true,
  requiresPapers: true,
  papersAttestedAt: true,
  testedWorkingAttestedAt: true,
  make: true,
  model: true,
  calibre: true,
  attributes: true,
  weightGrams: true,
  lengthCm: true,
  widthCm: true,
  heightCm: true,
  trackInventory: true,
  quantityAvailable: true,
  quantityReserved: true,
  // Auction — the PUBLIC auction fields only (reservePrice/currentBidderId
  // are deliberately absent; reserveMet is the safe derived signal).
  buyNowPrice: true,
  isFeatured: true,
  currentBid: true,
  bidCount: true,
  reserveMet: true,
  startTime: true,
  endTime: true,
  durationDays: true,
  endedAt: true,
  // Legacy fee flag — checkout reads it to render the (locked-off) fee line.
  passFeeToBuyer: true,
  acceptsOffers: true,
  shippingMethods: true,
  // Planned dealer-stock hint — intentionally shown to buyers on the PDP.
  plannedDealerLocation: true,
  plannedDealerName: true,
  plannedDealerProvince: true,
  plannedDealerArea: true,
  expiresAt: true,
  soldAt: true,
  listedAt: true,
  createdAt: true,
  updatedAt: true,
  images: { orderBy: { order: 'asc' } },
  category: true,
  seller: {
    select: {
      id: true,
      clerkId: true,
      // Public-facing handle only. firstName/lastName are explicitly NOT
      // selected — listing detail must not leak the seller's real identity.
      username: true,
      avatarUrl: true,
      sellerTier: true,
      totalSales: true,
      createdAt: true,
      subscriptionTier: true,
      isVerifiedExpert: true,
      expertBadgeReason: true,
      averageRating: true,
      _count: { select: { ratingsReceived: true } },
    },
  },
  // Social-proof: how many people saved this listing (names never exposed).
  _count: { select: { wishlistedBy: true } },
} satisfies Prisma.ListingSelect;

// The extra fields the OWNER of a listing is allowed to see on top of the
// public projection: their own hidden reserve + auto-accept threshold (needed
// to pre-fill the edit form) and the three moderation-banner fields (so the
// seller sees "pending review" / "rejected" / "description edited" on their
// own listing). Kept as a separate token-gated select so these never reach a
// non-owner. claudeConfidence / claudeOriginalDescription stay admin-only.
const OWNER_LISTING_EXTRAS_SELECT = {
  // What the seller receives on a BUY_NOW sale. OWNER-ONLY, deliberately —
  // Listing.price is the marked-up figure buyers see, and exposing the ask
  // publicly would hand every shopper our exact margin on every item, plus
  // give competitors a live fee sheet. It belongs here for exactly one reason:
  // a relist has to seed the price field from the ASK, not from the marked-up
  // price, or republishing would mark the item up a second time.
  //
  // NEVER add this to PUBLIC_LISTING_SELECT.
  sellerAskCents: true,
  reservePrice: true,
  autoAcceptThreshold: true,
  autoDeclineThreshold: true,
  claudeDecision: true,
  claudeReasons: true,
  claudeAutoFixApplied: true,
} satisfies Prisma.ListingSelect;

// Statuses whose detail page is visible to the public. DRAFT /
// PENDING_REVIEW / CANCELLED are visible ONLY to the owner (below); this stops
// anonymous callers probing not-yet-approved or withdrawn listings by id.
// PAYMENT_PENDING is public: a single-item listing sits here while a buyer
// completes checkout and the "sale pending" PDP must still load.
const PUBLICLY_VISIBLE_STATUSES: ListingStatus[] = [
  ListingStatus.ACTIVE,
  ListingStatus.PAYMENT_PENDING,
  ListingStatus.SOLD,
  ListingStatus.EXPIRED,
];

// Listing types that carry NO listed sale price — the buyer names a price
// instead (TAKE_A_SHOT). The price guards below treat it accordingly: price
// must be omitted, not required.
const PRICELESS_LISTING_TYPES = new Set<ListingType>([
  ListingType.TAKE_A_SHOT,
]);

// P4.3a — attribute keys are snake_case and stable (matches the DB check
// on CategoryAttribute.key). Used both when flattening values into the
// Meili doc (`attr_<key>`) and when sanitizing client-supplied attr filters
// so an unsanitized key can never be interpolated into a filter string.
const ATTR_KEY_RE = /^[a-z][a-z0-9_]{0,48}$/;

// Sentinel `endTimeTs` for a listing with no close time (everything that
// isn't a live auction). Year 5138 — far enough out that a real auction can
// never collide with it, so ascending "ending soonest" always ranks genuine
// auctions above never-ending listings.
const NEVER_ENDS_TS = 99_999_999_999_999;

// P5.6 — a category's sold-price comps only render once this many settled
// sales exist, so a thin catalog can't reverse a range back to one seller's
// take (POPIA) and the number is statistically meaningful.
const SOLD_COMPS_MIN_COUNT = 5;

// P5.7 — a brand only earns its own `/brand/[slug]` landing page (and sitemap
// entry) once it has at least this many ACTIVE listings; below it the page is
// too thin to be worth indexing.
const BRAND_MIN_LISTINGS = 3;

// Brand-slug normaliser — mirrors the category slugify (admin-categories) so
// brand URLs read the same way. Folds casing/whitespace so "Front Runner",
// "front runner" and "FRONT RUNNER" all resolve to one brand page.
function brandSlugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─────────────────────────────────────────────────────────────────────────
// AMMUNITION BAN — platform policy, enforced in code (2026-08, rebuilt)
//
// All Outdoor does not sell ammunition. Live / loaded ammunition may never be
// listed, sold or traded here. This is a PERMANENT prohibition, not a
// paperwork step: no licence, permit or dealer arrangement unlocks it, so the
// error copy has to say so plainly or sellers just resubmit.
//
// WHAT IS STILL LISTABLE. prisma/seed.ts keeps the whole `ammo` tree
// isActive:false and creates exactly four component categories — Rifle
// Bullets, Rifle Brass Cases, Handgun Bullets, Handgun Brass Cases. So the
// permitted components are PROJECTILES / BULLETS and BRASS CASES, and nothing
// else: primers and propellant powder have no category at all and are NOT
// listable. Reloading EQUIPMENT (presses, dies, scales, powder measures,
// powder funnels, priming tools) is ordinary hardware and stays welcome —
// "powder measure" is a tool, not propellant.
//
// ── THE DISCRIMINATOR ────────────────────────────────────────────────────
// The old guard asked "is an ammunition noun present?". That is a weak
// signal and it failed in both directions: it missed every ad that names a
// calibre and a grain weight without ever saying "ammo", and it blocked the
// commonest honest sentence on this platform ("1200 rounds, one owner").
//
// The strong signal is the ABSENCE OF A COMPONENT NOUN combined with a SALE
// SIGNAL. A loaded-round ad prices per unit or per box, names a calibre, and
// never says "projectiles" or "brass" — because those are the words its buyer
// would search for. A bare round count with no sale signal is wear copy and
// defaults to PASS.
//
// Consequently every veto (component / carrier / equipment / wear /
// disclaimer) is scanned over the WHOLE field plus the sibling field, not a
// 40-character lookback — almost every historical false positive was a word
// sitting one comma outside that window. Negation and disclaimers are
// SENTENCE-scoped for the same reason: "Ammunition is not part of this sale"
// must never be read as an offer.
//
// Layers, all enforced on ALL THREE write paths — previewDraft(), create()
// and update(). A guard on create() alone is a bypass: the seller would
// preview clean, or publish something innocent and edit it into ammunition
// afterwards. update() additionally re-runs the Claude moderator (the
// deterministic guard is the floor, never the ceiling).
//   1. CATEGORY — nothing may be listed into a live-ammunition category.
//   2. TERMS    — the signal guard below, for live ammunition (and for
//                 primers / propellant) smuggled into an innocent category.
// ─────────────────────────────────────────────────────────────────────────

export const AMMUNITION_BAN_MESSAGE =
  'All Outdoor does not sell ammunition. Live ammunition may not be listed, sold or traded on this platform under any circumstances. ' +
  'This is a permanent platform rule, not a paperwork problem — there is no licence, permit or approval that unlocks it, so please do not resubmit this listing with the wording changed. ' +
  'Reloading components are still welcome: projectiles / bullets and brass cases can be listed under Reloading Components. ' +
  'Primers and propellant powder cannot be listed here either — there is no category for them. Reloading equipment (presses, dies, scales, powder measures) is fine.';

// Primers and propellant are a DIFFERENT prohibition from the ammunition ban
// and must not be described as ammunition — saying "you may not sell
// ammunition" to someone listing primers is simply untrue, and untrue error
// copy is how sellers learn to ignore the rules.
export const RELOADING_SUPPLY_BAN_MESSAGE =
  'Primers and propellant powder may not be listed, sold or traded on this platform. There is no category for them and no licence or permit unlocks it, so please do not resubmit this listing with the wording changed. ' +
  'The reloading components that CAN be listed are projectiles / bullets and brass cases. Reloading equipment — presses, dies, scales, powder measures, powder funnels, priming tools — is welcome as normal.';

// A category is a live-ammunition category when its own (or its parent's)
// name/slug says ammunition — UNLESS it is plainly an accessory that merely
// carries the word. "Ammo Boxes & Storage Cases" and "Ammo Pouch" are real,
// legitimate children of Shooting Accessories and must keep working.
const AMMO_CATEGORY_WORDS =
  /\b(ammo|ammos|ammunition|ammunisie|rounds|cartridges|patrone|shotshells|shot\s?shells)\b/i;
const AMMO_CATEGORY_ACCESSORY_WORDS =
  /\b(box|boxes|pouch|pouches|can|cans|crate|crates|case|cases|tin|tins|tray|trays|rack|racks|carrier|carriers|wallet|wallets|holder|holders|belt|belts|bandolier|storage|safe|safes|bag|bags|sleeve|sleeves|caddy)\b/i;

export function isLiveAmmunitionCategory(category: {
  slug?: string | null;
  name?: string | null;
  parent?: { slug?: string | null; name?: string | null } | null;
}): boolean {
  const saysAmmunition = (
    slug?: string | null,
    name?: string | null,
  ): boolean => {
    const words = `${(slug ?? '').replace(/-/g, ' ')} ${name ?? ''}`.toLowerCase();
    if (!AMMO_CATEGORY_WORDS.test(words)) return false;
    return !AMMO_CATEGORY_ACCESSORY_WORDS.test(words);
  };
  return (
    saysAmmunition(category.slug, category.name) ||
    saysAmmunition(category.parent?.slug, category.parent?.name)
  );
}


export type AmmunitionBanKind = 'AMMUNITION' | 'RELOADING_SUPPLY';

export interface AmmunitionTermHit {
  field: 'title' | 'description';
  rule: string;
  excerpt: string;
  ban: AmmunitionBanKind;
}

// Newlines are PRESERVED (only horizontal whitespace is collapsed): sellers
// write bullet lists, and a line break is the clause boundary between
// "• Rifle" and "• 500 rounds". Zero-width and homoglyph separators are
// stripped so an invisible character cannot break a banned word apart.
function normaliseForAmmoScan(text: string): string {
  return text
    .replace(/[​-‍﻿­]/g, '')
    .replace(/[‐-―]/g, '-')
    .replace(/[^\S\n]+/g, ' ')
    .trim();
}

// ── The scan ─────────────────────────────────────────────────────────────
//
// REWRITTEN 2026-08-12, third attempt, and the rewrite is the point.
//
// The previous versions tried to INFER intent — absence of a component noun,
// weighed against sale signals, per-unit-price proximity, bundle markers, wear
// context, product context, clause boundaries and a 40-character lookback.
// Twenty interacting regexes. Three adversarial rounds measured what that
// bought: "9mm rounds for sale, R6 each" walked straight through, while
// ammunition SAFES, brass, projectiles, load-development notes and primer
// seating tools — all lawful, several of them named as permitted in the ban
// message itself — were rejected. Cleverness failed in both directions at once.
//
// So this version is deliberately dumb, and it is biased. Two rules, in order:
//
//   1. NEVER accuse a lawful seller. A false positive tells someone selling an
//      ammo safe that they may not sell ammunition. They cannot fix it, because
//      there is nothing to fix, and the message tells them not to resubmit.
//   2. A miss is CHEAP. Claude moderation runs on all three write paths
//      (previewDraft, create, update), reads the whole advert, and is prompted
//      to reject ammunition. A regex miss is a handoff, not a hole.
//
// Every rule below therefore STANDS DOWN the moment the text is ambiguous.
// When you are tempted to close a gap by adding a condition, check first
// whether it can fire on an honest listing — if it can, leave the gap.

// A COUNTED, LOADED cartridge. Deliberately excludes the generic counters
// (pieces / pcs / stuks): those are how brass and projectiles are sold, and
// both are permitted components.
// Singular "rd" is ordinal-unsafe (3rd, 23rd), so it only counts when the
// preceding digit is not a 3 — "50rd boxes" yes, "23rd of the month" no.
const ROUND_NOUN =
  '(?:rounds?|rnds?|rds|shots?|cartridges?|shotshells?|shells?|patrone|patroon|skote|skoot|(?<![03])rd)';
// A count, in every shape a South African advert writes one: 1000, 1 000,
// 1.000, 1k, and the spelled-out forms. Kept as one token so every rule below
// accepts the same vocabulary — the previous guard had four divergent copies.
const COUNT =
  '(?:\\d{1,3}(?:[ ,.]\\d{3})+|\\d{1,4}(?:[.,]\\d+)?\\s?k\\b|\\d{1,6}|(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|fifty|hundred|thousand)(?:[\\s-](?:hundred|thousand|and|one|two|three|four|five|six|seven|eight|nine|ten))*)';
const CALIBRE =
  '(?:\\.?\\d{1,3}(?:[.,]\\d{1,3})?\\s?(?:mm|ga|gauge|cal|lr|acp|win|rem|nato|special|magnum|mag|luger|creedmoor|blackout)\\b|\\.\\d{2,3}\\b|\\b\\d{1,2}\\s?x\\s?\\d{2}\\b)';

// The listing is OFFERING the thing, not describing it.
const SALE_SIGNAL =
  /\b(?:for sale|selling|to sell|te koop|in stock|available|beskikbaar|bulk|per box|a box|per round|a round|each|elk|apiece|ea\b|price|prys|R\s?\d{2,})/i;
// A price attached to the UNIT — close to conclusive on a count of rounds.
const PER_UNIT_PRICE =
  /\bR\s?\d+(?:[.,]\d{1,2})?\s?(?:\/|per\s|a\s|each|elk|ea\b|p\/r\b)/i;

// ── Stand-downs. Any of these and the inference rules go quiet. ───────────
// This vocabulary is the entire safety margin, so it is generous on purpose.

// Containers, storage and load-bearing kit. An ammunition safe is the legally
// required storage product in South Africa and is the single most common
// accessory listing this guard will ever meet.
const CARRIER_WORD =
  /\b(?:safes?|bags?|pouch(?:es)?|wallets?|cans?|crates?|tins?|boxe?s?|cases?|lockers?|racks?|shelf|shelves|holders?|carriers?|belts?|bandoliers?|vests?|sleeves?|caddy|caddies|trays?|inserts?|dividers?|compartments?|organisers?|dump)\b/i;
// Capacity copy describes the container, not an offer. The verbs must be
// followed by a NUMBER: capacity is always quantified ("holds 1000 rounds"),
// whereas a bare "holds" is usually the classified boilerplate "no holds",
// which was standing the whole guard down.
const CAPACITY_WORD =
  /\b(?:holds?|fits|takes|stores?|room for)\s+\d|\bcapacity\b|\b(?:magazines?|mags?|clips?)\b/i;
// Permitted components, and the words a component advert always uses.
const COMPONENT_WORD =
  /\b(?:projectiles?|bullets?|koe[eë]ls?|brass|casings?|doppies|once[-\s]?fired|unprimed|deprimed|tumbled|annealed|components?)\b/i;
// Reloading and gunsmithing hardware — ordinary and welcome.
const EQUIPMENT_WORD =
  /\b(?:press(?:es)?|dies?|scales?|measures?|throwers?|tricklers?|funnels?|tumblers?|trimmers?|seat(?:er|ers|ing)|prim(?:er|ing)\s+tool|hand\s?prime|uniformers?|gauges?|calipers?|kits?|bench|data|manual|load\s?book|notes?|development|brush(?:es)?|cleaning|patch(?:es)?|jags?|rods?|solvents?)\b/i;
// Wear / provenance copy — the commonest sentence in a used-rifle advert.
const WEAR_WORD =
  /\b(?:fired|through it|through the|on the clock|shot count|barrel life|one owner|condition|as[-\s]?new|immaculate|worked up|load\s?development|grouped?|zeroed|has done|since new|later I|tested with|shot with|put through)\b|\b(?:only|under|about|approx(?:imately)?|roughly|around|less than|more than|over|maybe|estimated)\s+(?:\d|one|two|three|four|five|six|seven|eight|nine|ten)/i;
// A charge weight is not a saleable quantity of powder.
// Load development and sight-in copy: "zeroed with factory ammo" says what
// the seller SHOT, not what they are selling.
const TESTED_WITH =
  /\b(?:tested|zeroed|sighted|shot|grouped|developed|chrono(?:graphed)?|worked\s+up|ran|run)\b(?:\W+\w+){0,3}\W+(?:with|on|using)\b|\bzeroed\b/i;
const CHARGE_WEIGHT = /\b\d+(?:[.,]\d+)?\s*(?:gr|grains?)\b/i;
// The seller saying the opposite of an offer.
// The seller saying the opposite of an offer. Deliberately generous — every
// phrase here appears in HONEST adverts, and a false positive tells the seller
// they may not sell ammunition for saying they are not selling any.
const DISCLAIMER =
  /\b(?:no|not|never|without|zero|excludes?|excluding)\s+(?:\w+\s+){0,3}(?:ammunition|ammunisie|ammo|rounds?|cartridges?|patrone)\b/i;
const AMMO_NOT_OFFERED =
  /\b(?:ammunition|ammunisie|ammo)\b(?:[^.!?\n]{0,40})\b(?:not included|excluded|is extra|is the buyer|buyer'?s? (?:own|responsibility)|widely available|easy to (?:find|get|come by)|not part of|not supplied|is not|are not|never included)\b|\b(?:supply|supplies|supplying|bring|arrange|source|provide)\s+(?:their|your|his|her|its)\s+own\b|\bcheap to shoot\b/i;

// Two tiers, and the distinction is load-bearing.
//
// HARD — capacity, components, equipment, wear, disclaimers. Nothing overrides
// these. Every one of them describes a lawful listing, and the whole design
// bias is that we would rather miss than accuse.
//
// SOFT — the container word alone. "Box", "case" and "safe" are how a genuine
// ammunition seller describes their packaging as much as how an accessory
// seller names their product, so a per-unit price is allowed to see past it —
// but only when no hard stand-down is also present.
function hardStandDown(text: string): boolean {
  return (
    CAPACITY_WORD.test(text) ||
    COMPONENT_WORD.test(text) ||
    EQUIPMENT_WORD.test(text) ||
    WEAR_WORD.test(text) ||
    DISCLAIMER.test(text) ||
    AMMO_NOT_OFFERED.test(text)
  );
}

function standDown(text: string): boolean {
  return hardStandDown(text) || CARRIER_WORD.test(text);
}

// Phrases whose only meaning is loaded ammunition. No inference at all.
const LOADED_PHRASE = new RegExp(
  '\\b(?:live|loaded|factory|surplus|training|practice|match|reman(?:ufactured)?|lewendige|gelaaide)\\s+(?:\\w+\\s+){0,2}(?:ammunition|ammunisie|ammo|rounds?|cartridges?|patrone)\\b' +
    '|\\b(?:ammunition|ammunisie|ammo)\\s+(?:for sale|te koop|in stock|available)\\b',
  'i',
);

export function findLiveAmmunitionTerm(
  text: string | null | undefined,
  opts: { context?: string; isTitle?: boolean } = {},
): { rule: string; excerpt: string; ban: AmmunitionBanKind } | null {
  const raw = normaliseForAmmoScan(text ?? '');
  if (!raw.trim()) return null;
  // The seller writes ONE advert. Judge every rule against both fields, so a
  // container word in the title excuses a round count in the description.
  const whole = normaliseForAmmoScan(opts.context ?? '') || raw;

  // Obfuscation: "a m m u n i t i o n", "a.m.m.u.n.i.t.i.o.n", "4mmun1t10n".
  // Folded separately and only reported when the FOLDED form is a banned word
  // AND differs from the raw text, so ordinary prose can never trip it.
  const folded = raw
    .toLowerCase()
    .replace(/[\s.\-_*·•]/g, '')
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't');
  // Only when the banned word appears ONLY after folding. Without this the
  // rule fires on any prose containing "ammunition", because folding strips
  // the spaces around it — which is how it rejected the honest sentence
  // "Ammunition-adjacent phrasing a pattern cannot see."
  if (
    !/ammunition|ammunisie|ammo/i.test(raw) &&
    folded !== raw.toLowerCase() &&
    /(ammunition|ammunisie|liveammo|loadedammo)/.test(folded) &&
    !DISCLAIMER.test(whole) &&
    !AMMO_NOT_OFFERED.test(whole)
  ) {
    return {
      rule: 'obfuscated-ammunition',
      excerpt: raw.slice(0, 120).trim(),
      ban: 'AMMUNITION',
    };
  }

  const hit = (
    rule: string,
    m: RegExpExecArray,
    ban: AmmunitionBanKind = 'AMMUNITION',
  ) => ({
    rule,
    excerpt: raw
      .slice(Math.max(0, m.index - 40), m.index + m[0].length + 40)
      .trim(),
    ban,
  });

  // 1. Unambiguous loaded-ammunition phrasing. Fires even against a carrier
  //    word — "live ammunition" in a listing that also says "pouch" is still
  //    someone offering live ammunition. Only an explicit disclaimer excuses it.
  if (
    !DISCLAIMER.test(whole) &&
    !AMMO_NOT_OFFERED.test(whole) &&
    !TESTED_WITH.test(whole)
  ) {
    const m = LOADED_PHRASE.exec(raw);
    if (m) return hit('loaded-ammunition-phrase', m);
  }

  // 2. A title that IS the product name "ammo". Nobody titles a listing
  //    "9mm ammo" except to sell ammunition; a container listing always names
  //    the container, and that naming is the stand-down.
  //
  //    One override: a calibre AND a per-unit price beat the container word.
  //    "9mm ammo R450 a box" is an ammunition advert that happens to contain
  //    "box"; "Ammo box, R450" is a container, and it has no calibre and no
  //    price-per-unit. Both parts are required — either alone false-positives.
  const calibred = new RegExp(CALIBRE, 'i').test(whole);
  const pricedPerUnit = PER_UNIT_PRICE.test(whole);
  if (
    opts.isTitle &&
    (!standDown(whole) ||
      (calibred && pricedPerUnit && !hardStandDown(whole)))
  ) {
    const m = /\b(?:ammo|ammunition|ammunisie)\b/i.exec(raw);
    if (m) return hit('ammunition-title', m);
  }

  // 3. Rounds offered for sale: <count> rounds, or <calibre> rounds, plus a
  //    sale signal. Stands down on any container / component / equipment /
  //    wear word anywhere in the advert — UNLESS the rounds carry a per-unit
  //    price, which no honest capacity or wear sentence ever does. Components
  //    and disclaimers override even that: brass and projectiles are sold by
  //    the each, lawfully.
  const priced = PER_UNIT_PRICE.test(whole);
  const componentSafe =
    !COMPONENT_WORD.test(whole) &&
    !DISCLAIMER.test(whole) &&
    !AMMO_NOT_OFFERED.test(whole);
  if ((!standDown(whole) || (priced && !hardStandDown(whole))) && SALE_SIGNAL.test(whole)) {
    // A bare count with no per-unit price must find its CALIBRE IN THE SAME
    // FIELD. "500 rounds .223 Rem for sale" is a lot of ammunition; a used
    // rifle titled "Bergara B14 HMR .308 Win" whose description says
    // "R18000, 400 rounds, for sale" is a rifle — the calibre belongs to the
    // product in the title, not to the count in the description. A per-unit
    // price removes the ambiguity and lifts the requirement.
    if (priced || new RegExp(CALIBRE, 'i').test(raw)) {
      const counted = new RegExp(
        '\\b' + COUNT + '\\s?(?:x\\s?)?' + ROUND_NOUN + '\\b',
        'i',
      ).exec(raw);
      if (counted) return hit('rounds-offered', counted);
    }

    const bore = new RegExp(
      CALIBRE + '\\s+(?:\\w+\\s+){0,2}' + ROUND_NOUN + '\\b',
      'i',
    ).exec(raw);
    if (bore) return hit('rounds-offered', bore);

    // "10 boxes 9mm Luger, R450 each" — the count is of boxes, but a per-unit
    // price on boxes of a calibre is an ammunition advert.
    if (priced) {
      const boxes = new RegExp(
        '\\b\\d{1,4}\\s+(?:boxe?s|cases|packets|sleeves|bricks)\\s+(?:of\\s+)?' +
          CALIBRE,
        'i',
      ).exec(raw);
      if (boxes) return hit('rounds-offered', boxes);

      // The two shapes an ammunition advert takes when it never names a round:
      //   "box of 50 … R450 per box"      — packaged quantity
      //   "Bulk 5.56 - 1000 available, R9 each" — bare count offered
      // Both are gated on a calibre being present, and this whole branch
      // already requires a per-unit price and no component word, so brass and
      // projectiles sold by the each cannot reach here.
      if (new RegExp(CALIBRE, 'i').test(whole)) {
        const packaged =
          /\b(?:boxe?s|packets?|sleeves?|bricks?)\s+of\s+\d{2,4}\b/i.exec(raw) ??
          /\b\d{2,5}\s+(?:available|in stock|beskikbaar|op voorraad)\b/i.exec(raw);
        if (packaged) return hit('rounds-offered', packaged);
      }
    }
  }

  // 3a. Count + calibre + an EXPLICIT offer word, all inside one clause.
  //
  //     This is the only place a stand-down is overruled by something other
  //     than a per-unit price, and the clause scope is what makes it safe: the
  //     three signals have to sit together, between two commas, with nothing
  //     else claiming them. "500 rounds 9mm for sale, all in mint condition"
  //     is an ammunition advert with a condition note; "Tikka T3x .308, 1200
  //     rounds, one owner" keeps its count in a clause of its own, with no
  //     calibre and no offer word, and stays clear. A bare price does NOT
  //     count as an offer word here — "9mm ammo box, R450" is a container.
  const OFFER_WORD = /\b(?:for sale|te koop|selling|available|in stock|beskikbaar|op voorraad|bulk)\b/i;
  if (!COMPONENT_WORD.test(whole) && !DISCLAIMER.test(whole) && !AMMO_NOT_OFFERED.test(whole)) {
    for (const clause of raw.split(/[,;\n]|(?:\s[-–—]\s)/)) {
      if (!OFFER_WORD.test(clause)) continue;
      if (!new RegExp(CALIBRE, 'i').test(clause)) continue;
      const m = new RegExp(
        '\\b' + COUNT + '\\s?(?:x\\s?)?' + ROUND_NOUN + '\\b',
        'i',
      ).exec(clause);
      if (m) return hit('rounds-offered', m);
    }
  }

  // 3b. "<count> rounds OF <calibre>" — the one quantity idiom a container
  //     listing never uses. A carrier states its capacity ("holds 1000
  //     rounds", "30 rounds"); it does not say "1000 rounds of 9mm". That
  //     lets this rule see past the carrier stand-down, which otherwise lets
  //     "1000 rounds of 9mm in original factory boxes, R6500" through on the
  //     word "boxes". Component and wear copy still stand it down: "500 rounds
  //     of .308 through it" is a used rifle, not a lot of ammunition.
  if (!hardStandDown(whole) && SALE_SIGNAL.test(whole)) {
    const ofBore = new RegExp(
      '\\b' + COUNT + '\\s?' + ROUND_NOUN + '\\s+of\\s+(?:\\w+\\s+){0,2}' + CALIBRE,
      'i',
    ).exec(raw);
    if (ofBore) return hit('rounds-offered', ofBore);
  }

  // 4. Primers and propellant — a DIFFERENT prohibition with its own message.
  //    Telling a primer seller "you may not sell ammunition" is untrue, and
  //    untrue error copy is how sellers learn to ignore the rules. Stands down
  //    on equipment (a powder MEASURE is a tool) and on a charge weight
  //    ("42 grains of Varget" is load data, not stock).
  // No sale signal is required here, unlike rounds. There is NO category for
  // primers or propellant, so a listing whose subject is either one is banned
  // outright — whereas "rounds" has innocent uses (wear counts, capacities)
  // that need an offer signal to disambiguate. The tools are already excluded
  // by EQUIPMENT_WORD, and load-development copy by CHARGE_WEIGHT / wear.
  if (
    !EQUIPMENT_WORD.test(whole) &&
    !CHARGE_WEIGHT.test(whole) &&
    !WEAR_WORD.test(whole) &&
    !TESTED_WITH.test(whole) &&
    !DISCLAIMER.test(whole)
  ) {
    // Primers: the noun alone is enough once a sale signal is present. Unlike
    // "rounds", "primers" has no innocent use as a count in an advert — the
    // tools that seat them are already excluded by EQUIPMENT_WORD above.
    const m =
      /\bprimers?\b/i.exec(raw) ??
      // Propellant: by weight, or a named propellant with any quantity. "42
      // grains of Varget" is excluded above as a charge weight, not stock.
      /\b\d[\d\s.,]{0,6}\s?(?:kg|kgs|g|grams?|lbs?|pounds?|tubs?|tins?|jars?|bottles?|kegs?)\s*(?:of\s+)?(?:\w+\s+){0,2}(?:powder|propellant|kruit)\b/i.exec(
        raw,
      ) ??
      /\b(?:somchem|varget|vihtavuori|hodgdon|imr|accurate|reloder|benchmark|s3\d{2}|n1?\d{2,3}|h\d{3,4})\b[^.\n]{0,30}\b(?:powder|propellant|kruit)\b/i.exec(
        raw,
      ) ??
      /\b(?:powder|propellant|kruit)\b[^.\n]{0,20}\b(?:for sale|te koop|in stock|unopened|sealed)\b/i.exec(
        raw,
      );
    if (m) return hit('reloading-supply-offered', m, 'RELOADING_SUPPLY');
  }

  return null;
}

// Title + description in one pass, reporting which field tripped. BOTH fields
// are handed to each scan as context, so a veto in the title excuses the
// description and vice versa — the seller writes one advert, not two.
export function findLiveAmmunitionListing(
  title: string | null | undefined,
  description: string | null | undefined,
): AmmunitionTermHit | null {
  const context = `${title ?? ''}\n${description ?? ''}`;
  const inTitle = findLiveAmmunitionTerm(title, { context, isTitle: true });
  if (inTitle) return { field: 'title', ...inTitle };
  const inDescription = findLiveAmmunitionTerm(description, { context });
  if (inDescription) return { field: 'description', ...inDescription };
  return null;
}

// The message that matches a hit — the ammunition ban and the primer /
// propellant prohibition are different rules and are worded differently.
export function banMessageFor(kind: AmmunitionBanKind): string {
  return kind === 'RELOADING_SUPPLY'
    ? RELOADING_SUPPLY_BAN_MESSAGE
    : AMMUNITION_BAN_MESSAGE;
}

// P4.3b — dangerous-goods gate. A LOOSE lithium battery rated above the
// energy limit (Watt-hours, UN3480) can't be carried by our couriers (Pudo /
// TCG), so a listing whose `battery_wh` attribute exceeds it is forced
// COLLECTION-only (buyer collects in person) rather than entering the courier
// path. The limit is admin-tunable (FLAGS.dgLithiumWhThreshold, default 100 Wh
// — the standard loose-lithium threshold) so it can track carrier policy
// changes without a deploy; it fails open to 100 so the gate can never silently
// widen. (Closes the P3.3 lithium hole via a real attribute value instead of
// honour-system copy.)

// Shape returned by previewDraft() — the frontend uses this to render the
// soft-block preview screen. canPublish gates the "Confirm publish" button;
// hardBlocked overrides everything when the seller is on attempt 2+ with
// the same sin.
export interface PreviewResult {
  decision: 'APPROVE' | 'AUTO_FIX_AND_APPROVE' | 'REJECT' | 'HUMAN_REVIEW';
  confidence: number;
  reasons: string[];
  // Reason → sin category (so the UI can highlight prohibited content).
  reasonCategories: { reason: string; category: string }[];
  // Public-facing reason on REJECT.
  publicReason?: string;
  // AUTO_FIX cleaned description — UI shows a diff so the seller can accept.
  cleanedDescription?: string;
  // Stable hash of this attempt's sin categories. Client adds it to the
  // previousAttemptHashes array if it tries again.
  attemptHash: string;
  // True if this attempt's hash matches any previousAttemptHashes.
  isRepeatOffense: boolean;
  // True when the listing can be published as-is (APPROVE, AUTO_FIX, or
  // HUMAN_REVIEW — the latter goes to the admin queue but still "submits").
  canPublish: boolean;
  // True when we should refuse further self-publish attempts.
  hardBlocked: boolean;
};

@Injectable()
export class ListingsService {
  private readonly logger = new Logger(ListingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchService,
    private readonly cloudinary: CloudinaryService,
    private readonly moderation: ListingModerationService,
    private readonly settings: SettingsService,
    private readonly referenceNumbers: ReferenceNumberService,
    private readonly firearmLicence: FirearmLicenceService,
    private readonly categories: CategoriesService,
    private readonly wishlistAlerts: WishlistAlertsService,
    private readonly activity: ActivityService,
    // Appended LAST on purpose: the specs construct this service positionally,
    // so a new dependency inserted earlier would silently shift every argument
    // along and hand prisma to the wrong field.
    private readonly fees: FeeCalculator,
  ) {}

  // AMMUNITION BAN — the single chokepoint every write path calls
  // (previewDraft, create, update). The category layer and the term guard
  // both throw a permanent-prohibition message so the seller can never
  // conclude that a different category or different wording would let the
  // listing through. The MESSAGE follows the hit: live ammunition and
  // primers/propellant are two different rules, and telling a primer seller
  // "you may not sell ammunition" would simply be untrue. See the
  // AMMUNITION_BAN_MESSAGE block above for the component split.
  private assertNotLiveAmmunition(
    category: {
      slug?: string | null;
      name?: string | null;
      parent?: { slug?: string | null; name?: string | null } | null;
    },
    title: string | null | undefined,
    description: string | null | undefined,
  ): void {
    if (isLiveAmmunitionCategory(category)) {
      throw new BadRequestException(AMMUNITION_BAN_MESSAGE);
    }
    const hit = findLiveAmmunitionListing(title, description);
    if (hit) {
      this.logger.warn(
        `Ammunition ban tripped (${hit.rule}) in listing ${hit.field}: "${hit.excerpt}"`,
      );
      throw new BadRequestException(
        `${banMessageFor(hit.ban)} (Flagged in the ${hit.field}: "${hit.excerpt}".)`,
      );
    }
  }

  // Pre-upload the firearm serial + licence proof photos to Cloudinary
  // BEFORE create(), so create() can run the Claude-vision licence check
  // against their URLs. The Sell form calls this, then passes the returned
  // URLs (+ the typed serial) into POST /listings.
  async uploadFirearmDocs(
    clerkId: string,
    serial: Express.Multer.File | undefined,
    licence: Express.Multer.File | undefined,
  ): Promise<{ serialPhotoUrl: string; licencePhotoUrl: string }> {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new ForbiddenException('User not synced — try again in a moment');
    // ⚠️ Closed is checked BEFORE banned: a member who closed their own
    // account and came back to a stale tab must not be told they were
    // suspended. See common/account-standing.ts.
    assertAccountNotClosed(user);
    if (user.isBanned) throw new ForbiddenException('Account is suspended');
    if (!serial || !licence) {
      throw new BadRequestException(
        'Both a serial photo and a licence photo are required.',
      );
    }
    const [s, l] = await Promise.all([
      this.cloudinary.uploadImage(serial.buffer, `firearm-docs/${user.id}`),
      this.cloudinary.uploadImage(licence.buffer, `firearm-docs/${user.id}`),
    ]);
    return { serialPhotoUrl: s.url, licencePhotoUrl: l.url };
  }

  // Ask Claude to rewrite a draft description. Used by the "Enhance
  // wording" button on the Sell form before the user commits to publishing.
  // We don't write anything to the DB — this is a pure read-side helper.
  async enhanceDescription(
    description: string,
    context: {
      title?: string;
      categoryId?: string;
      make?: string;
      model?: string;
      calibre?: string;
      condition?: string;
      /** Staged photos, so the polish can cite what is visibly included. */
      imageUrls?: string[];
      imagesBase64?: { mediaType: string; data: string }[];
    },
  ) {
    if (!description?.trim()) {
      return { enhanced: '', changed: false, specsAdded: false, photosUsed: 0 };
    }
    let categoryName: string | undefined;
    let isFirearm = false;
    if (context.categoryId) {
      const c = await this.prisma.category.findUnique({
        where: { id: context.categoryId },
        select: { name: true, isFirearm: true },
      });
      if (c) {
        categoryName = c.name;
        isFirearm = c.isFirearm;
      }
    }
    return this.moderation.enhanceDescription(description, {
      title: context.title,
      categoryName,
      isFirearm,
      make: context.make,
      model: context.model,
      calibre: context.calibre,
      condition: context.condition,
      imageUrls: context.imageUrls,
      imagesBase64: context.imagesBase64 as never,
    });
  }

  // Dry-run a moderation pass against draft listing data WITHOUT writing
  // anything to the database. Powers the "Review listing" screen on the
  // Sell form — sellers see exactly what Claude saw and can fix issues
  // before they actually publish.
  //
  // Soft-block policy (per user spec, 2026-05):
  //   1st REJECT → canPublish=false, hardBlocked=false. Seller can edit.
  //   2nd REJECT with overlapping sin categories → hardBlocked=true.
  //   APPROVE / AUTO_FIX → canPublish=true (frontend shows the clean preview).
  //   HUMAN_REVIEW → canPublish=true but warn "will go to admin queue".
  async previewDraft(clerkId: string, dto: PreviewListingDto): Promise<PreviewResult> {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new ForbiddenException('User not synced — try again in a moment');
    assertAccountNotClosed(user);
    if (user.isBanned) throw new ForbiddenException('Account is suspended');

    const category = await this.prisma.category.findUnique({
      where: { id: dto.categoryId },
      include: { parent: { select: { slug: true, name: true } } },
    });
    if (!category) {
      throw new BadRequestException('Invalid category');
    }
    // AMMUNITION BAN — enforced on the PREVIEW path too, not just create().
    // The preview is what the seller trusts ("it passed review"), so letting
    // ammunition preview clean and fail at publish would be both confusing
    // and an invitation to probe the wording until it sticks. Runs BEFORE the
    // isActive / availableSecondhand checks so the seller reads the actual
    // rule instead of a generic "invalid category" they'd try to work around.
    this.assertNotLiveAmmunition(category, dto.title, dto.description);
    if (!category.isActive) {
      throw new BadRequestException('Invalid category');
    }
    // P0.1c — availableSecondhand was only ever a UI filter; enforce it
    // server-side so a crafted payload can't list into a new-store-only
    // (or otherwise closed) category.
    if (!category.availableSecondhand) {
      throw new BadRequestException(
        'This category is not available for marketplace listings.',
      );
    }

    if (!PRICELESS_LISTING_TYPES.has(dto.listingType) && !dto.price) {
      throw new BadRequestException('Price is required for BUY_NOW and AUCTION listings');
    }
    if (PRICELESS_LISTING_TYPES.has(dto.listingType) && dto.price) {
      throw new BadRequestException('Take a Shot listings must not have a listed price');
    }

    // UX-7 — compare-at ("was") price is DISPLAY-ONLY (strikethrough + "% off"),
    // never part of any fee/checkout calculation. When present, guard it:
    //  • BUY_NOW only (never auction bids / offers / swaps)
    //  • strictly greater than the sale price (it's a discount, not a markup)
    //  • capped at 4× the sale price so it can't fabricate an extreme anchor
    //    (CPA s41 anti-anchoring). The displayed % is further capped at 70%.
    if (dto.compareAtPriceZarCents != null) {
      if (dto.listingType !== 'BUY_NOW') {
        throw new BadRequestException(
          'A compare-at (original) price is only available on Buy Now listings.',
        );
      }
      // Validate against the price the BUYER WILL SEE, not the number the
      // seller typed. Under the markup model those differ by our commission
      // plus the card fee (~13.8%), so comparing to the raw ask would let a
      // seller set a "was" price BELOW their own listed price — a strikethrough
      // under the live figure, and a misleading discount claim under CPA s41.
      const salePrice =
        this.priceFieldsFor(
          dto.listingType,
          dto.price,
          user.sellerTier === 'TOP_SELLER',
        ).price ?? 0;
      if (dto.compareAtPriceZarCents <= salePrice) {
        throw new BadRequestException(
          'The original price must be higher than the sale price.',
        );
      }
      if (dto.compareAtPriceZarCents > salePrice * 4) {
        throw new BadRequestException(
          'The original price can be at most 4× the sale price.',
        );
      }
    }

    // Firearm listings MUST include DEALER_TRANSFER in shippingMethods
    // (operator decision 2026-05-26 — was previously seller's choice).
    // The seller can additionally offer PRIVATE_ARRANGE, but they
    // cannot list a firearm with PRIVATE_ARRANGE as the ONLY option.
    // SAPS regulation already requires every firearm transfer to flow
    // through a licensed dealer; this just enforces it at listing-
    // creation time so the buyer always has the dealer-stock fallback.
    if (
      category.isFirearm &&
      dto.shippingMethods &&
      !dto.shippingMethods.includes('DEALER_TRANSFER')
    ) {
      throw new BadRequestException(
        'Firearm listings must include "Dealer-stocked transfer" as a shipping option.',
      );
    }

    const moderationEnabled = await this.settings.get(FLAGS.claudeModerationEnabled);

    let moderation: ListingModerationResult;

    if (moderationEnabled && this.moderation.isEnabled) {
      moderation = await this.moderation.moderate({
        title: dto.title,
        description: dto.description,
        categoryName: category.name,
        categoryIsFirearm: category.isFirearm,
        priceCents: dto.price ?? null,
        compareAtPriceCents: dto.compareAtPriceZarCents ?? null,
        imageUrls: [], // post-upload moderation will fill these in
        // dto.images is the seller's staged photos, base64-encoded so
        // Claude's vision pass can scan them for contact details + QR
        // codes BEFORE publish (the only photo check we still run).
        imagesBase64: dto.images,
        imageCount: dto.imageCount ?? dto.images?.length ?? 0,
        sellerFirstFirearmListings: false, // safety-net removed
      });
    } else {
      // Flag off OR no API key — preview is a no-op approve so the
      // seller isn't blocked from publishing. The submit path mirrors
      // this behaviour (publishes ACTIVE without moderation).
      moderation = {
        decision: 'APPROVE',
        confidence: 1,
        reasons: [],
      };
    }

    // Hash this attempt's sin set so the client can carry it forward.
    const attemptHash = hashAttempt(moderation.reasons);
    const isRepeatOffense =
      moderation.decision === 'REJECT' &&
      Array.isArray(dto.previousAttemptHashes) &&
      dto.previousAttemptHashes.includes(attemptHash);

    // Soft-block logic.
    const canPublish =
      moderation.decision === 'APPROVE' ||
      moderation.decision === 'AUTO_FIX_AND_APPROVE' ||
      moderation.decision === 'HUMAN_REVIEW';
    const hardBlocked = moderation.decision === 'REJECT' && isRepeatOffense;

    return {
      decision: moderation.decision,
      confidence: moderation.confidence,
      reasons: moderation.reasons,
      reasonCategories: moderation.reasons.map((r) => ({
        reason: r,
        category: categorizeReason(r),
      })),
      publicReason: moderation.publicReason,
      cleanedDescription: moderation.cleanedDescription,
      attemptHash,
      isRepeatOffense,
      canPublish,
      hardBlocked,
    };
  }

  // Firearm/barrel listings must declare where the seller plans to
  // dealer-stock the item — dealer name, province, and area are all
  // MANDATORY (2026-07-13). Returns the four columns to persist
  // (plannedDealerLocation = the composed display string). Non-firearm
  // listings get all-null. Throws BadRequest on a firearm missing any part.
  private buildPlannedDealer(
    dto: {
      plannedDealerName?: string;
      plannedDealerProvince?: string;
      plannedDealerArea?: string;
    },
    isFirearm: boolean,
  ): {
    plannedDealerName: string | null;
    plannedDealerProvince: string | null;
    plannedDealerArea: string | null;
    plannedDealerLocation: string | null;
  } {
    if (!isFirearm) {
      return {
        plannedDealerName: null,
        plannedDealerProvince: null,
        plannedDealerArea: null,
        plannedDealerLocation: null,
      };
    }
    const name = (dto.plannedDealerName ?? '').trim();
    const province = (dto.plannedDealerProvince ?? '').trim();
    const area = (dto.plannedDealerArea ?? '').trim();
    if (!name || !province || !area) {
      throw new BadRequestException(
        'Firearm and barrel listings must say where you plan to dealer-stock the item: a dealer name, province, and area are all required.',
      );
    }
    // Province must be one of the 9 SA provinces. The frontend uses a
    // controlled dropdown; this rejects arbitrary text from a crafted API
    // call so the public composed display string stays clean.
    const SA_PROVINCES = [
      'Eastern Cape',
      'Free State',
      'Gauteng',
      'KwaZulu-Natal',
      'Limpopo',
      'Mpumalanga',
      'North West',
      'Northern Cape',
      'Western Cape',
    ];
    if (!SA_PROVINCES.includes(province)) {
      throw new BadRequestException(
        'Choose a valid South African province for the planned dealer-stock location.',
      );
    }
    return {
      plannedDealerName: name,
      plannedDealerProvince: province,
      plannedDealerArea: area,
      plannedDealerLocation: `${name} — ${area}, ${province}`,
    };
  }

  // Resolve the seller's PRIVATE_ARRANGE contact-sharing consent for a
  // create/edit. Offering PRIVATE_ARRANGE REQUIRES consent — reject without
  // it (operator decision 2026-07-23). Returns the timestamp to store:
  // fresh consent → now; an edit that keeps PRIVATE_ARRANGE without
  // re-ticking → the previously-stored consent; not offering it → null.
  private resolvePrivateArrangeConsent(
    offersPrivateArrange: boolean,
    consent: boolean | undefined,
    existingConsentAt: Date | null | undefined,
  ): Date | null {
    if (!offersPrivateArrange) return null;
    if (consent) return new Date();
    if (existingConsentAt) return existingConsentAt;
    throw new BadRequestException(
      'To offer Private Arrangement you must consent to share your phone number and email with the buyer so they can arrange the firearm transfer.',
    );
  }


  /**
   * What to store for a listing's price, given the number the seller typed.
   *
   * BUY_NOW is now a MARKED-UP price (operator 2026-08-15): the seller types
   * what they want to RECEIVE, and we build our commission plus the Peach fee
   * on top to get the figure the buyer sees. `Listing.price` keeps meaning "the
   * buyer-facing price", so nothing downstream changes; `sellerAskCents`
   * carries the other half.
   *
   * Everything else is untouched. An AUCTION price is a STARTING price that a
   * bid then discovers, so there is nothing to mark up — the commission comes
   * out of the seller on those, exactly as it always did. TAKE_A_SHOT has no
   * sale price at all.
   */
  private priceFieldsFor(
    listingType: ListingType,
    typedPriceCents: number | null | undefined,
    isTopSeller: boolean,
  ): { price: number | null; sellerAskCents: number | null } {
    if (typedPriceCents == null) return { price: null, sellerAskCents: null };
    if (listingType !== ListingType.BUY_NOW) {
      return { price: typedPriceCents, sellerAskCents: null };
    }
    const marked = this.fees.listPriceFromSellerAsk(typedPriceCents, isTopSeller);
    return { price: marked.listPrice, sellerAskCents: marked.sellerAsk };
  }

  async create(clerkId: string, dto: CreateListingDto): Promise<Listing> {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new ForbiddenException('User not synced — try again in a moment');
    assertAccountNotClosed(user);
    if (user.isBanned) throw new ForbiddenException('Account is suspended');
    // Firm seller-standing policy: 3 reject strikes = banned from LISTING
    // (buying is unaffected). Lifted only by admin clear-reject-strikes.
    if (user.sellingBannedAt) {
      throw new ForbiddenException(
        'Selling is suspended on your account after repeated rejected sales/offers. You can still buy. Contact support to have your account reviewed.',
      );
    }

    const category = await this.prisma.category.findUnique({
      where: { id: dto.categoryId },
      include: { parent: { select: { slug: true, name: true } } },
    });
    if (!category) {
      throw new BadRequestException('Invalid category');
    }
    // AMMUNITION BAN — runs before the isActive gate (so the seller reads the
    // real rule rather than a generic "invalid category"), and before the paid
    // Claude licence/moderation calls and reference-number allocation, so a
    // banned payload costs nothing and burns no counter.
    this.assertNotLiveAmmunition(category, dto.title, dto.description);
    if (!category.isActive) {
      throw new BadRequestException('Invalid category');
    }
    // P0.1c — availableSecondhand was only ever a UI filter; enforce it
    // server-side so a crafted payload can't list into a new-store-only
    // (or otherwise closed) category.
    if (!category.availableSecondhand) {
      throw new BadRequestException(
        'This category is not available for marketplace listings.',
      );
    }

    if (!PRICELESS_LISTING_TYPES.has(dto.listingType) && !dto.price) {
      throw new BadRequestException('Price is required for BUY_NOW and AUCTION listings');
    }
    if (PRICELESS_LISTING_TYPES.has(dto.listingType) && dto.price) {
      throw new BadRequestException('Take a Shot listings must not have a listed price');
    }

    // UX-7 — compare-at ("was") price is DISPLAY-ONLY (strikethrough + "% off"),
    // never part of any fee/checkout calculation. When present, guard it:
    //  • BUY_NOW only (never auction bids / offers / swaps)
    //  • strictly greater than the sale price (it's a discount, not a markup)
    //  • capped at 4× the sale price so it can't fabricate an extreme anchor
    //    (CPA s41 anti-anchoring). The displayed % is further capped at 70%.
    if (dto.compareAtPriceZarCents != null) {
      if (dto.listingType !== 'BUY_NOW') {
        throw new BadRequestException(
          'A compare-at (original) price is only available on Buy Now listings.',
        );
      }
      // Validate against the price the BUYER WILL SEE, not the number the
      // seller typed. Under the markup model those differ by our commission
      // plus the card fee (~13.8%), so comparing to the raw ask would let a
      // seller set a "was" price BELOW their own listed price — a strikethrough
      // under the live figure, and a misleading discount claim under CPA s41.
      const salePrice =
        this.priceFieldsFor(
          dto.listingType,
          dto.price,
          user.sellerTier === 'TOP_SELLER',
        ).price ?? 0;
      if (dto.compareAtPriceZarCents <= salePrice) {
        throw new BadRequestException(
          'The original price must be higher than the sale price.',
        );
      }
      if (dto.compareAtPriceZarCents > salePrice * 4) {
        throw new BadRequestException(
          'The original price can be at most 4× the sale price.',
        );
      }
    }

    // Firearm listings MUST include DEALER_TRANSFER in shippingMethods
    // (operator decision 2026-05-26 — was previously seller's choice).
    // The seller can additionally offer PRIVATE_ARRANGE, but they
    // cannot list a firearm with PRIVATE_ARRANGE as the ONLY option.
    // SAPS regulation already requires every firearm transfer to flow
    // through a licensed dealer; this just enforces it at listing-
    // creation time so the buyer always has the dealer-stock fallback.
    if (
      category.isFirearm &&
      dto.shippingMethods &&
      !dto.shippingMethods.includes('DEALER_TRANSFER')
    ) {
      throw new BadRequestException(
        'Firearm listings must include "Dealer-stocked transfer" as a shipping option.',
      );
    }

    // Firearm/barrel planned dealer-stock — validate + compose EARLY, before
    // the paid firearm-licence vision check + moderation + reference-number
    // allocation, so an invalid firearm payload fails fast without burning
    // Claude spend or a reference-counter increment. All-null for non-firearms.
    const plannedDealer = this.buildPlannedDealer(dto, category.isFirearm);

    // ---- Collection-only + papers attestation (P3) -----------------------
    // Collection-only categories (trailers, off-road caravans, oversized /
    // dangerous goods no courier will carry). The seller's UI hides courier
    // options; this forces COLLECTION server-side so a crafted payload can't
    // attach PUDO/TCG to a collection-only listing (which would then try to
    // quote / book a courier that can't carry it). Mirrors the firearm
    // DEALER_TRANSFER lock.
    // COLLECTION is reserved for collection-only categories. A normal listing
    // must never carry it in its offered methods — it would be a dead option
    // no buyer can select and no courier/dealer path honours. (The firearm
    // gate above only checks DEALER_TRANSFER presence, not stray members.)
    // P4.2/4.3b — validate the attribute VALUES EARLY (the DG gate below needs
    // the cleaned battery_wh). Unknown keys dropped; required-empty / bad-type
    // / bad-option throws. Only the CLEANED object is ever persisted.
    const attributeDefs = await this.categories.getEffectiveAttributes(
      category.id,
    );
    const { cleaned: cleanedAttributes, error: attributeError } =
      validateAndCleanAttributes(attributeDefs, dto.attributes);
    if (attributeError) {
      throw new BadRequestException(attributeError);
    }
    const attributesForDb: Prisma.InputJsonValue | typeof Prisma.JsonNull =
      Object.keys(cleanedAttributes).length > 0
        ? (cleanedAttributes as Prisma.InputJsonValue)
        : Prisma.JsonNull;

    // P4.3b — dangerous-goods: a loose lithium battery over the courier limit
    // (UN3480) can't be couriered, so force this listing collection-only even
    // though its category isn't collection-flagged. effectiveCollectionOnly
    // drives every collection gate + the snapshot + the shipping force below.
    // Coerce, don't duck-type: validateAndCleanAttributes yields a number for a
    // NUMBER attr, but if battery_wh were ever redefined as SELECT/TEXT the
    // cleaned value would be a string — coercing keeps the DG gate fail-safe
    // (a stringy "200" still trips it) instead of silently no-opping.
    const dgWhThreshold = await this.settings.get(FLAGS.dgLithiumWhThreshold);
    const batteryWh = Number(cleanedAttributes.battery_wh ?? NaN);
    const dgLithiumRestricted =
      Number.isFinite(batteryWh) && batteryWh > dgWhThreshold;
    const effectiveCollectionOnly =
      category.collectionOnly || dgLithiumRestricted;

    // ── Vicinity ────────────────────────────────────────────────────────
    // The town a buyer sees before paying. Province is DERIVED from the pickup
    // address rather than taken from its own field, because Listing.province is
    // also stamped onto the courier collection address — when the two could
    // drift, a courier could be sent to the right street in the wrong province.
    const pickupProvince = dto.pickupProvince ?? dto.province;
    const publicLocality = toPublicLocality(dto.pickupCity);

    // A pickup address is required on EVERY path. The sell form has always
    // enforced this, under a comment saying it must stay that way, but the API
    // did not — so a crafted POST could publish a listing with no location of
    // record at all.
    if (
      !dto.pickupStreet?.trim() ||
      !dto.pickupCity?.trim() ||
      !dto.pickupPostalCode?.trim()
    ) {
      throw new BadRequestException(
        'A pickup address is required — it is where a courier collects from, and it is what tells buyers which town the item is in.',
      );
    }
    // Harder gate where the buyer has to TRAVEL to the item. Mirrors the
    // firearm planned-dealer gate: we tell buyers that location is not a refund
    // ground, so a listing must never reach them without one.
    if ((effectiveCollectionOnly || category.isFirearm) && !publicLocality) {
      throw new BadRequestException(
        'Buyers need to know the town this item is in before they buy. Add a pickup address with a town or city (no street numbers in the town field).',
      );
    }

    // COLLECTION is reserved for collection-only items (category-flagged OR
    // DG-forced). A normal listing must never carry it — a dead option no buyer
    // can select. (The firearm gate above only checks DEALER_TRANSFER presence.)
    if (!effectiveCollectionOnly && dto.shippingMethods?.includes('COLLECTION')) {
      throw new BadRequestException(
        'In-person collection is only available for collection-only items.',
      );
    }
    if (effectiveCollectionOnly && category.isFirearm) {
      // Defensive: a category is never both firearm + collection-only (and a
      // firearm category has no battery_wh attribute, so DG can't fire here).
      throw new BadRequestException(
        'A category cannot be both firearm and collection-only.',
      );
    }
    // Collection-only items settle through the standard checkout (COLLECTION +
    // papers gate). Take-a-Shot's offer-checkout carries no collection path,
    // so restrict collection-only items — category-flagged OR DG-forced — to
    // Buy Now / Auction.
    if (
      effectiveCollectionOnly &&
      dto.listingType !== 'BUY_NOW' &&
      dto.listingType !== 'AUCTION'
    ) {
      throw new BadRequestException(
        dgLithiumRestricted
          ? 'Large lithium batteries ship collection-only, so they can be listed as Buy Now or Auction — not Take-a-Shot.'
          : 'Collection-only items (e.g. trailers and caravans) can be listed as Buy Now or Auction — not Take-a-Shot.',
      );
    }
    // Papers attestation — NaTIS-registered goods (trailers / caravans). The
    // seller affirms they hold valid registration / roadworthy papers and
    // will hand them over at collection. Boolean only — we never collect or
    // store the documents themselves (POPIA).
    let papersAttestedAt: Date | null = null;
    if (category.requiresPapers) {
      if (dto.collectionPapersAttested !== true) {
        throw new BadRequestException(
          'You must confirm you hold valid registration / roadworthy papers and will hand them to the buyer at collection.',
        );
      }
      papersAttestedAt = new Date();
    }

    // P5.4 — OPTIONAL "tested & working" attestation for electronics/appliance
    // categories. Unlike papers (mandatory), this is the seller's own optional
    // claim — never throw when it's unticked. Re-checks the category flag so a
    // seller can't stamp it on a category that doesn't offer it.
    const testedWorkingAttestedAt =
      category.showTestedWorkingAttestation && dto.testedWorkingAttested === true
        ? new Date()
        : null;

    // ---- Firearm/barrel licence + serial verification (SAP 534 flow) ----
    // For licence-controlled categories the seller must supply a typed
    // serial + a serial photo + a licence photo (uploaded to Cloudinary
    // first via POST /listings/firearm-docs). Claude vision confirms the
    // serials match, the holder matches the seller, and reads the expiry —
    // BLOCKing expired/≤30-day/mismatched licences. A 31–90-day licence is
    // allowed; the frontend surfaces that warning from licenceExpiresAt.
    let firearmLicenceExpiresAt: Date | null = null;
    let firearmLicenceHolderName: string | null = null;
    if (category.isFirearm) {
      if (!dto.serialNumber || !dto.serialPhotoUrl || !dto.licencePhotoUrl) {
        throw new BadRequestException(
          'Firearm and barrel listings need the serial number, a clear serial photo, and a licence photo.',
        );
      }
      const sellerName =
        [user.firstName, user.lastName].filter(Boolean).join(' ') ||
        user.email ||
        '';
      const verdict = await this.firearmLicence.verify({
        typedSerial: dto.serialNumber,
        serialPhotoUrl: dto.serialPhotoUrl,
        licencePhotoUrl: dto.licencePhotoUrl,
        sellerName,
      });
      if (verdict.gate === 'BLOCK') {
        throw new BadRequestException(verdict.reason);
      }
      firearmLicenceExpiresAt = verdict.licenceExpiresAt;
      firearmLicenceHolderName = verdict.licenceHolderName;
    }

    // Auction-specific validation + derived fields
    let startTime: Date | null = null;
    let endTime: Date | null = null;
    if (dto.listingType === 'AUCTION') {
      if (!dto.durationDays) {
        throw new BadRequestException('Auction duration is required');
      }
      // Starting-bid rule. Two modes:
      //   1) Reserve set → starting = floor(reserve * 0.7). We OVERWRITE
      //      whatever the seller submitted as `price` so the rule is
      //      enforced server-side and can't be tampered with via the
      //      payload.
      //   2) No reserve → seller's typed `price` is the starting bid.
      if (dto.reservePrice) {
        // Pre-derive the starting bid from the reserve before the row
        // insert below reads `dto.price`. Mutating the DTO is the
        // simplest way to keep both insert paths in sync (the create
        // call reads `dto.price ?? null` directly).
        dto.price = Math.floor(dto.reservePrice * 0.7);
      } else if (!dto.price || dto.price <= 0) {
        throw new BadRequestException(
          'Set a starting bid (or set a reserve and we will derive it at 30% below).',
        );
      }
      // Buy Now must clear the starting bid — otherwise a buyer could
      // "Buy Now" for less than the opening bid, which doesn't make sense.
      // Run this AFTER price derivation so the comparison uses the
      // server-side starting bid, not whatever the seller typed.
      if (dto.buyNowPrice && dto.buyNowPrice <= (dto.price ?? 0)) {
        throw new BadRequestException(
          'Buy Now price must exceed the starting bid',
        );
      }
      startTime = new Date();
      endTime = new Date(startTime.getTime() + dto.durationDays * 24 * 60 * 60 * 1000);
    } else {
      // Non-auction listings must not set auction-only fields
      if (dto.reservePrice || dto.buyNowPrice || dto.durationDays) {
        throw new BadRequestException(
          'reservePrice, buyNowPrice and durationDays are only valid for AUCTION listings',
        );
      }
    }

    // ---- Claude AI moderation (relaxed mode) ----
    // Two checks only — contact details and blatantly advertised live
    // ammo / primers / propellant. Everything else is the seller's
    // call. All previous safety-net overrides (high-value review, new
    // seller firearm review, low-confidence bump) have been removed
    // per the operator's request — Claude's verdict is the final
    // decision, and if it can't run we publish ACTIVE rather than
    // dropping into HUMAN_REVIEW. Listings stuck pending broke trust
    // with sellers; admin still sees a queue of rejected listings if
    // they want to look.
    const moderationEnabled = await this.settings.get(FLAGS.claudeModerationEnabled);

    let moderation: ListingModerationResult | null = null;
    let finalDescription = dto.description;
    let originalDescription: string | null = null;
    let autoFixApplied = false;

    if (moderationEnabled && this.moderation.isEnabled) {
      moderation = await this.moderation.moderate({
        title: dto.title,
        description: dto.description,
        categoryName: category.name,
        categoryIsFirearm: category.isFirearm,
        priceCents: dto.price ?? null,
        compareAtPriceCents: dto.compareAtPriceZarCents ?? null,
        imageUrls: [], // images come in after create; vision pass happened in /listings/preview
        imageCount: dto.imageCount,
        sellerFirstFirearmListings: false, // safety-net removed
      });
    } else {
      // Either the flag is off OR ANTHROPIC_API_KEY isn't loaded. We
      // PUBLISH ACTIVE in both cases (no more "manual review queued"
      // stalls). If admin wants offline moderation, they enable the
      // flag + set the key; otherwise the marketplace stays open.
      this.logger.warn(
        moderationEnabled
          ? 'ANTHROPIC_API_KEY not set — publishing listing ACTIVE without moderation'
          : 'Moderation flag is OFF — publishing listing ACTIVE',
      );
    }

    // AUTO_FIX_AND_APPROVE — apply Claude's cleaned description and
    // run our local regex pass on top as defence in depth. This is
    // the ONLY post-processing step left.
    if (moderation && moderation.decision === 'AUTO_FIX_AND_APPROVE') {
      const cleaned = moderation.cleanedDescription ?? dto.description;
      const localPass = this.moderation.stripContactInfo(cleaned);
      originalDescription = dto.description;
      finalDescription = localPass.cleaned;
      autoFixApplied = true;
    }

    // Map decision → ListingStatus.
    //   APPROVE / AUTO_FIX_AND_APPROVE → ACTIVE
    //   REJECT                          → PENDING_REVIEW (admin reviews)
    //   no moderation run               → ACTIVE
    // Claude no longer returns HUMAN_REVIEW under the new prompt; we
    // keep the branch defensive in case an older response shape slips
    // through.
    let status: ListingStatus;
    if (
      !moderation ||
      moderation.decision === 'APPROVE' ||
      moderation.decision === 'AUTO_FIX_AND_APPROVE'
    ) {
      status = ListingStatus.ACTIVE;
    } else {
      status = ListingStatus.PENDING_REVIEW;
    }

    // Allocate the human-trackable reference number (UM/AU/TS + 6 digits)
    // BEFORE the create so the row lands with refNumber already populated
    // and we never have a moment where a listing is missing one.
    const referenceNumber = await this.referenceNumbers.allocateForListing(
      dto.listingType,
    );

    // Inventory / quantity (Phase 8a). Only a plain BUY_NOW non-firearm
    // listing may carry stock > 1 — firearms are 1-per-SAPS-534, auctions
    // and take-a-shot are single-item. A seller opts in by setting a
    // quantity above 1; everything else stays the legacy single item
    // (trackInventory=false, quantityAvailable=1).
    const requestedStock = Math.floor(Number(dto.quantityAvailable ?? 1));
    const trackInventory =
      inventoryEligible(dto.listingType, category.isFirearm) &&
      Number.isFinite(requestedStock) &&
      requestedStock > 1;
    const quantityAvailable = trackInventory
      ? Math.min(requestedStock, 9999)
      : 1;

    // Take a Shot thresholds must not cross: an auto-decline floor at or
    // above the auto-accept ceiling would make every offer both decline
    // AND accept. (Decline wins in OffersService, but the config is
    // nonsense — reject it at source.)
    if (
      dto.autoDeclineThreshold != null &&
      dto.autoAcceptThreshold != null &&
      dto.autoDeclineThreshold >= dto.autoAcceptThreshold
    ) {
      throw new BadRequestException(
        'The auto-decline threshold must be below the auto-accept threshold.',
      );
    }

    // (attributes were validated + the DG collection-only flag computed above,
    // before the collection gates — see cleanedAttributes / attributesForDb /
    // effectiveCollectionOnly.)
    const pricing = this.priceFieldsFor(
      dto.listingType,
      dto.price,
      user.sellerTier === 'TOP_SELLER',
    );

    const listing = await this.prisma.listing.create({
      data: {
        referenceNumber,
        sellerId: user.id,
        categoryId: dto.categoryId,
        title: dto.title,
        description: finalDescription,
        // BUY_NOW: dto.price is what the SELLER WANTS TO RECEIVE; the stored
        // price is that marked up by commission + the Peach fee. Other types
        // store the typed number as-is.
        price: pricing.price,
        sellerAskCents: pricing.sellerAskCents,
        // UX-7 — display-only "was" price (validated above; BUY_NOW only).
        compareAtPriceZarCents: dto.compareAtPriceZarCents ?? null,
        listingType: dto.listingType,
        status,
        // P5.1 — stamp discoverability time when publishing straight to ACTIVE;
        // a PENDING_REVIEW listing gets its listedAt on admin approval instead.
        // The saved-search matcher keys "new" on this, not createdAt.
        listedAt: status === ListingStatus.ACTIVE ? new Date() : null,
        condition: dto.condition,
        // Derived, not trusted from the client on its own — see the vicinity
        // block above.
        province: pickupProvince,
        pickupProvince,
        publicLocality,
        isFirearm: category.isFirearm,
        // Snapshot the signed-out visibility of the chosen category. Every
        // public-discovery query and the Meili document filter on this column,
        // so it must be written at create — a listing that misses it defaults
        // to false and is simply members-only, which is the safe direction.
        publicVisible: category.publicVisible,
        // P3 — snapshot the collection-only + papers flags from the category
        // (like isFirearm) so downstream shipping / checkout logic never has
        // to re-join the category. papersAttestedAt is the seller's create-
        // time attestation (null for non-papers categories).
        collectionOnly: effectiveCollectionOnly,
        requiresPapers: category.requiresPapers,
        papersAttestedAt,
        testedWorkingAttestedAt,
        trackInventory,
        quantityAvailable,
        // P4.2 — cleaned per-listing attribute values (or JsonNull when none).
        attributes: attributesForDb,
        make: dto.make,
        model: dto.model,
        calibre: dto.calibre,
        serialNumber: dto.serialNumber ?? null,
        serialPhotoUrl: dto.serialPhotoUrl ?? null,
        licencePhotoUrl: dto.licencePhotoUrl ?? null,
        licenceHolderName: firearmLicenceHolderName,
        licenceExpiresAt: firearmLicenceExpiresAt,
        passFeeToBuyer: dto.passFeeToBuyer,
        // Undefined leaves the schema default (true) in place.
        acceptsOffers: dto.acceptsOffers,
        autoAcceptThreshold: dto.autoAcceptThreshold,
        autoDeclineThreshold: dto.autoDeclineThreshold,
        declaredValueCents: dto.declaredValueCents ?? null,
        reservePrice: dto.reservePrice ?? null,
        buyNowPrice: dto.buyNowPrice ?? null,
        durationDays: dto.durationDays ?? null,
        isFeatured: dto.isFeatured ?? false,
        startTime,
        endTime,
        // Delivery + pickup address. Collection-only categories are forced
        // to the single COLLECTION method regardless of what the client sent.
        shippingMethods: effectiveCollectionOnly
          ? [ShippingMethod.COLLECTION]
          : (dto.shippingMethods ?? []),
        // PRIVATE_ARRANGE only survives on the non-collection path — require
        // + stamp the seller's contact-sharing consent there.
        privateArrangeConsentAt: this.resolvePrivateArrangeConsent(
          !effectiveCollectionOnly &&
            !!dto.shippingMethods?.includes(ShippingMethod.PRIVATE_ARRANGE),
          dto.privateArrangeConsent,
          null,
        ),
        // Firearm/barrel dealer-lock — mandatory structured location
        // (dealer name + province + area) composed into the display
        // string plannedDealerLocation. All-null for non-firearm listings.
        ...plannedDealer,
        pickupBuilding: dto.pickupBuilding ?? null,
        pickupStreet: dto.pickupStreet ?? null,
        pickupAddress2: dto.pickupAddress2 ?? null,
        pickupSuburb: dto.pickupSuburb ?? null,
        pickupCity: dto.pickupCity ?? null,
        pickupPostalCode: dto.pickupPostalCode ?? null,
        pickupLat: dto.pickupLat ?? null,
        pickupLng: dto.pickupLng ?? null,
        pickupPudoLockerId: dto.pickupPudoLockerId ?? null,
        // Parcel dimensions for the courier rate API (Pudo / TCG).
        weightGrams: dto.weightGrams ?? null,
        lengthCm: dto.lengthCm ?? null,
        widthCm: dto.widthCm ?? null,
        heightCm: dto.heightCm ?? null,
        // Claude moderation fields
        claudeDecision: moderation?.decision ?? null,
        claudeConfidence: moderation?.confidence ?? null,
        claudeReasons: moderation?.reasons ?? [],
        claudeReviewedAt: moderation ? new Date() : null,
        claudeOriginalDescription: originalDescription,
        claudeAutoFixApplied: autoFixApplied,
      },
      include: { images: true, category: true },
    });

    // Only index ACTIVE listings — pending/rejected shouldn't surface in search.
    if (listing.status === ListingStatus.ACTIVE) {
      await this.indexListing({ ...listing, category });
    }

    return listing;
  }

  /**
   * THE VISIBILITY GATE. A signed-out caller only ever sees listings whose
   * category is marked publicVisible; a signed-in member sees everything, as
   * before. Spread into every public-discovery Prisma `where` alongside the
   * `isDealListing: false` chokepoint.
   *
   * Anonymity is decided ONLY by the presence of a verified Clerk id supplied
   * by OptionalClerkGuard — never by a header, a query param or a user-agent.
   * Serving different content to a crawler than to a logged-out human is
   * cloaking; this returns the same thing to both.
   */
  private publicOnly(clerkId?: string): { publicVisible?: true } {
    return clerkId ? {} : { publicVisible: true };
  }

  async browse(dto: BrowseListingsDto, clerkId?: string) {
    const { q, sellerClerkId, ids } = dto;

    // `ids=cuid1,cuid2,…` — multi-ID lookup for the recently-viewed
    // rail. Returns ACTIVE listings in the order the IDs were given
    // (preserves the recency stack the client maintains). All other
    // filters are ignored on this path because the client has
    // already chosen the exact listings it wants.
    if (ids) return this.browseByIds(ids, clerkId);

    // Seller-scoped browses always go via Prisma — the Meilisearch
    // index stores sellerId (our internal cuid), not sellerClerkId, so
    // matching a Clerk ID against it would need a pre-resolve step.
    // The seller-profile page never combines q with a sellerClerkId
    // in practice, so this is the cleaner path.
    if (sellerClerkId) return this.browseViaPrisma(dto, clerkId);

    // P5.7 — brand-scoped browses always go via Prisma. The brand fold
    // (slug → all stored make casings → `make IN (...)`) lives ONLY in
    // browseViaPrisma; buildActiveListingFilter on the Meili path has no
    // brandSlug handling, so routing a brandSlug+q request to Meili would
    // silently drop the brand constraint and return every brand's q-matches.
    // Force Prisma so the brand filter is always honoured (q is ignored on
    // this path, which is the safe degradation — brand-scoped, not global).
    if (dto.brandSlug) return this.browseViaPrisma(dto, clerkId);

    // P4.3a — per-category attribute filters (JSON-encoded in dto.attrs).
    // Parsed defensively; a malformed blob is silently ignored. Attribute
    // filtering is implemented ONLY on the Meili path — the Prisma fallback
    // does not apply attr filters (documented degradation when Meili is
    // down), so route to Meili whenever q OR attr filters are present.
    const parsedAttrs = this.parseAttrFilters(dto.attrs);
    const hasAttrFilters = Object.keys(parsedAttrs).length > 0;

    if ((q || hasAttrFilters) && this.search.isConnected) {
      return this.browseViaSearch(dto, parsedAttrs, clerkId);
    }
    return this.browseViaPrisma(dto, clerkId);
  }

  /**
   * P4.3a — parse the JSON-encoded `attrs` filter blob. Returns an empty
   * object for anything malformed (bad JSON, non-object, null, array) so the
   * dispatcher/filter builder can treat "no attr filters" and "garbage attr
   * filters" identically. Per-entry key/value sanitization happens later in
   * browseViaSearch — this only guarantees a plain object shape.
   */
  private parseAttrFilters(raw?: string): Record<string, unknown> {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // malformed → ignore
    }
    return {};
  }

  /**
   * Distinct brands/makes across ACTIVE listings, most-listed first. Powers
   * the storefront brand facet (GET /listings/brands). Capped so the dropdown
   * stays usable; blank/whitespace makes are dropped.
   */
  async listBrands(limit = 60, clerkId?: string): Promise<string[]> {
    const rows = await this.prisma.listing.groupBy({
      by: ['make'],
      // Signed-out, brand folding must not surface firearm makes (Glock, CZ,
      // Sako…) as public brand slugs, landing pages and sitemap entries.
      where: {
        status: 'ACTIVE',
        isDealListing: false,
        make: { not: null },
        ...this.publicOnly(clerkId),
      },
      _count: { make: true },
      orderBy: { _count: { make: 'desc' } },
      take: limit,
    });
    return rows
      .map((r) => r.make)
      .filter((m): m is string => !!m && m.trim().length > 0);
  }

  /**
   * P5.7 — brand landing pages. Distinct makes across ACTIVE listings, folded
   * by slug (every casing/whitespace variant that slugifies to the same value
   * counts as ONE brand) and gated to >= BRAND_MIN_LISTINGS so we never mint a
   * thin, low-value SEO page. `label` is the most-listed casing. Powers both
   * the brand index/sitemap and the per-brand `/brand/[slug]` gate — all three
   * read the same folded counts so they can never disagree.
   */
  async listBrandsWithCounts(
    minCount = BRAND_MIN_LISTINGS,
    clerkId?: string,
  ): Promise<{ slug: string; label: string; count: number }[]> {
    const rows = await this.prisma.listing.groupBy({
      by: ['make'],
      where: {
        status: 'ACTIVE',
        isDealListing: false,
        make: { not: null },
        ...this.publicOnly(clerkId),
      },
      _count: { make: true },
    });
    const folded = new Map<
      string,
      { slug: string; label: string; count: number; best: number }
    >();
    for (const r of rows) {
      const raw = r.make?.trim();
      if (!raw) continue;
      const slug = brandSlugify(raw);
      if (!slug) continue;
      const c = r._count.make;
      const cur = folded.get(slug);
      if (cur) {
        cur.count += c;
        if (c > cur.best) {
          cur.best = c;
          cur.label = raw;
        }
      } else {
        folded.set(slug, { slug, label: raw, count: c, best: c });
      }
    }
    return [...folded.values()]
      .filter((b) => b.count >= minCount)
      .sort((a, b) => b.count - a.count)
      .map(({ slug, label, count }) => ({ slug, label, count }));
  }

  /**
   * P5.7 — resolve a brand slug to the exact stored `make` strings behind it
   * (all casing variants) plus the display label + folded count. Returns null
   * when the slug doesn't clear BRAND_MIN_LISTINGS so the page can 404 rather
   * than render an empty/thin brand. `makes` are the RAW stored values (not
   * trimmed) so a `make IN (...)` filter matches the rows exactly.
   */
  async resolveBrandSlug(
    slug: string,
    minCount = BRAND_MIN_LISTINGS,
    clerkId?: string,
  ): Promise<{
    slug: string;
    label: string;
    count: number;
    makes: string[];
  } | null> {
    const target = brandSlugify(slug);
    if (!target) return null;
    const rows = await this.prisma.listing.groupBy({
      by: ['make'],
      where: {
        status: 'ACTIVE',
        isDealListing: false,
        make: { not: null },
        ...this.publicOnly(clerkId),
      },
      _count: { make: true },
    });
    let count = 0;
    let label = '';
    let best = -1;
    const makes: string[] = [];
    for (const r of rows) {
      if (r.make == null) continue;
      const trimmed = r.make.trim();
      if (!trimmed || brandSlugify(trimmed) !== target) continue;
      makes.push(r.make);
      const c = r._count.make;
      count += c;
      if (c > best) {
        best = c;
        label = trimmed;
      }
    }
    if (makes.length === 0 || count < minCount) return null;
    return { slug: target, label, count, makes };
  }

  /**
   * P5.6 — sold-price comps for a category. Aggregates the snapshotted sale
   * price of settled sales (paymentStatus HELD or RELEASED = money captured;
   * refund children excluded) whose listing sits in the category (leaf OR
   * parent rollup) and is now SOLD. Gated to SOLD_COMPS_MIN_COUNT so a couple
   * of sales can't be reverse-engineered into a single seller's take. POPIA:
   * returns ONLY price + coarse month — never buyer, seller or listing IDs.
   */
  async soldComps(
    dto: { categorySlug?: string; categoryId?: string },
    clerkId?: string,
  ) {
    const categoryFilter = dto.categorySlug
      ? { OR: [{ slug: dto.categorySlug }, { parent: { slug: dto.categorySlug } }] }
      : dto.categoryId
        ? { OR: [{ id: dto.categoryId }, { parentId: dto.categoryId }] }
        : null;
    if (!categoryFilter) return { count: 0 };

    const rows = await this.prisma.transaction.findMany({
      where: {
        paymentStatus: { in: ['HELD', 'RELEASED'] },
        refundOfId: null,
        // Exclude first-party Daily Deals — deep house-deal discounts must not
        // drag the public comp range down.
        listing: {
          status: 'SOLD',
          isDealListing: false,
          category: categoryFilter,
          // ?categorySlug=firearms would otherwise hand realised firearm sale
          // prices to an anonymous caller.
          ...this.publicOnly(clerkId),
        },
      },
      select: { listingPrice: true, quantity: true },
      orderBy: { paidAt: 'desc' },
      take: 500,
    });

    const count = rows.length;
    if (count < SOLD_COMPS_MIN_COUNT) return { count };

    // POPIA: we return ONLY aggregate statistics (min / max / median), never
    // any individual sale row. Exposing a list of exact per-sale prices +
    // months would let a seller who made one of the sales read back every
    // OTHER seller's exact realised price — re-identification of a competitor's
    // take in a thin niche category — which the min-count gate alone does not
    // prevent. Aggregates over >= SOLD_COMPS_MIN_COUNT sales dilute any one row.
    //
    // listingPrice is the LINE TOTAL (unit × qty); divide back to a per-unit
    // price so a 3-pack sale doesn't skew the range against single items.
    const prices = rows
      .map((r) => Math.round(r.listingPrice / Math.max(1, r.quantity)))
      .sort((a, b) => a - b);
    return {
      count,
      low: prices[0],
      high: prices[prices.length - 1],
      median: prices[Math.floor(prices.length / 2)],
    };
  }

  /**
   * Non-sensitive marketplace config the sell form needs so it can mirror a
   * server-side gate in the UI without hardcoding a constant that would drift
   * when an admin retunes it. Currently just the DG lithium-Wh courier limit
   * (FLAGS.dgLithiumWhThreshold) — the sell form recomputes its "this becomes
   * collection-only" notice against this value instead of a literal 100, so the
   * notice and the server's actual force-collection decision never disagree.
   */
  async getPublicConfig(): Promise<{ dgLithiumWhThreshold: number }> {
    const dgLithiumWhThreshold = await this.settings.get(
      FLAGS.dgLithiumWhThreshold,
    );
    return { dgLithiumWhThreshold };
  }

  /**
   * Lightweight feed for the XML sitemap — every ACTIVE listing's id +
   * last-modified, newest first, capped so the sitemap stays bounded.
   */
  async sitemapEntries(
    limit = 5000,
  ): Promise<{ id: string; updatedAt: Date }[]> {
    return this.prisma.listing.findMany({
      // publicVisible unconditionally — a sitemap is BY DEFINITION read by
      // crawlers, so there is no signed-in variant of this feed.
      where: { status: 'ACTIVE', isDealListing: false, publicVisible: true },
      select: { id: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Cross-sell engine — "you might also need…". Generic + data-driven via
   * CategoryRelation, so it works for EVERY category (firearms, reloading,
   * optics, fishing, camping, knives + any future category) with no
   * per-category code. Returns a separate suggestion set the caller renders
   * as a distinct row; it never touches the user's primary results.
   *
   * Compliance: only ever returns status=ACTIVE listings (via browse) from
   * crossSellEligible categories (relation filter), so powder / primers /
   * live ammunition — Ammo is ineligible AND can't be an active P2P listing
   * — can never surface here.
   */
  async crossSell(
    dto: {
      listingId?: string;
      fromCategoryId?: string;
      q?: string;
      excludeIds?: string;
    },
    clerkId?: string,
  ): Promise<{ suggestions: unknown[]; reason: string | null }> {
    const exclude = new Set(
      (dto.excludeIds ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );

    // Resolve the context: which category to draw complements FROM + the
    // best narrowing signal (calibre / brand).
    let fromCategoryId = dto.fromCategoryId;
    let calibre: string | null = null;
    let make: string | null = null;
    // P4.4 — vehicle-fitment cross-sell keying. When the source item carries a
    // fitment (a Hilux roof rack), we key complements on the vehicle so a rack
    // surfaces Hilux-compatible awnings / drawers rather than generic ones.
    // vehicle_model is the most specific signal, vehicle_make the fallback.
    let vehicleModel: string | null = null;
    let vehicleMake: string | null = null;
    if (dto.listingId) {
      const l = await this.prisma.listing.findUnique({
        where: { id: dto.listingId },
        select: { categoryId: true, calibre: true, make: true, attributes: true },
      });
      if (l) {
        fromCategoryId = l.categoryId;
        calibre = l.calibre;
        make = l.make;
        const attrs = (l.attributes ?? null) as Record<string, unknown> | null;
        if (attrs && typeof attrs === 'object') {
          if (typeof attrs.vehicle_model === 'string' && attrs.vehicle_model.trim())
            vehicleModel = attrs.vehicle_model.trim();
          if (typeof attrs.vehicle_make === 'string' && attrs.vehicle_make.trim())
            vehicleMake = attrs.vehicle_make.trim();
        }
      }
      exclude.add(dto.listingId);
    }
    if (!calibre) calibre = this.extractCalibre(dto.q);
    if (!fromCategoryId) return { suggestions: [], reason: null };

    const relations = await this.prisma.categoryRelation.findMany({
      where: {
        fromCategoryId,
        toCategory: { crossSellEligible: true, isActive: true },
      },
      include: { toCategory: { select: { id: true, name: true } } },
      orderBy: { sortOrder: 'asc' },
      take: 8,
    });
    if (relations.length === 0) return { suggestions: [], reason: null };

    const groups: { name: string; listings: { id: string }[] }[] = [];
    for (const rel of relations) {
      // Signal precedence: a HARD calibre match when the relation requires
      // it (skip entirely if we have no calibre — never guess compatibility);
      // otherwise brand / calibre / the raw query as a soft relevance boost.
      let signal: string | undefined;
      if (rel.requireExactMatch) {
        if (!calibre) continue;
        signal = calibre;
      } else {
        // P4.4 — fitment first (vehicle model > make), then the old brand /
        // calibre / query soft signal. Keys vehicle-gear complements to the
        // buyer's rig; harmless for non-fitment items (both stay null).
        signal =
          vehicleModel ?? vehicleMake ?? make ?? calibre ?? (dto.q || undefined);
      }
      // Forward the caller's identity: crossSell delegates to browse, so the
      // visibility gate applies for free — but only if clerkId rides along.
      // Without it every cross-sell row would be publicly filtered even for
      // signed-in members.
      const res = await this.browse(
        {
          categoryId: rel.toCategoryId,
          q: signal,
          limit: 8,
          sort: 'newest',
        } as BrowseListingsDto,
        clerkId,
      );
      const picks = (res.listings as { id: string }[]).filter(
        (l) => !exclude.has(l.id),
      );
      for (const p of picks) exclude.add(p.id);
      if (picks.length > 0) {
        groups.push({ name: rel.toCategory.name, listings: picks.slice(0, 4) });
      }
    }

    // Round-robin across complementary categories (cap 12) so the row is
    // varied rather than four of one kind then four of another.
    const suggestions: unknown[] = [];
    for (let i = 0; suggestions.length < 12; i++) {
      let added = false;
      for (const g of groups) {
        if (g.listings[i]) {
          suggestions.push(g.listings[i]);
          added = true;
          if (suggestions.length >= 12) break;
        }
      }
      if (!added) break;
    }
    const reason =
      groups.length > 0
        ? `Pairs with ${groups
            .map((g) => g.name)
            .slice(0, 3)
            .join(', ')}`
        : null;

    // Demand signal: the buyer wanted complements here but we found NONE.
    // Log it (fire-and-forget, keyed by category + normalised calibre) so
    // the operator can see what stock to recruit — the supply side of the
    // flywheel. Only when there's a real calibre signal; generic misses
    // are noise. Never let a logging failure break the response.
    if (suggestions.length === 0 && fromCategoryId) {
      const calKey = this.calibreKey(calibre);
      if (calKey) {
        void this.prisma.crossSellMiss
          .upsert({
            where: {
              fromCategoryId_calibre: { fromCategoryId, calibre: calKey },
            },
            create: { fromCategoryId, calibre: calKey, count: 1 },
            update: { count: { increment: 1 }, lastSeenAt: new Date() },
          })
          .catch(() => undefined);
      }
    }
    return { suggestions, reason };
  }

  /**
   * Normalise a calibre string to a comparable key for demand-miss
   * aggregation: ".308 Win" → "308", "6.5 Creedmoor" → "65creedmoor".
   * Falls back to the alphanumerics of the raw value when no known
   * cartridge matches; null when there's nothing usable.
   */
  private calibreKey(raw?: string | null): string | null {
    const token = this.extractCalibre(raw ?? undefined);
    if (token) return token.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const alnum = (raw ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();
    return alnum.length >= 2 ? alnum : null;
  }

  /**
   * Pull a calibre/cartridge token out of free text (search query) using a
   * curated list of common SA cartridges — specific entries first. Returns
   * null when nothing recognisable is present, so the engine declines to
   * guess a compatibility match. (Phase 3 makes calibre a filterable index
   * attribute for exact matching.)
   */
  private extractCalibre(text?: string): string | null {
    if (!text) return null;
    const tokens = [
      '6.5 creedmoor', '6.5 prc', '6.5x55', '6.5', '300 win', '300 prc',
      '300 blackout', '30-06', '30-30', '308', '7.62x39', '7.62x51', '7.62',
      '7mm rem', '7mm', '5.56', '22-250', '223', '243', '270', '25-06', '280',
      '338 lapua', '338', '9mm', '45 acp', '40 s&w', '357', '38 special',
      '44 mag', '44', '380', '10mm', '303', '375', '416', '458',
      '12 gauge', '12g', '20 gauge', '410', '22lr', '22 lr', '17 hmr', '17',
      '6mm', '284',
    ];
    const t = ` ${text.toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ')} `;
    for (const c of tokens) {
      const norm = ` ${c.replace(/\./g, ' ').replace(/\s+/g, ' ')} `;
      if (t.includes(norm)) return c;
    }
    return null;
  }

  // Multi-ID lookup. Capped at 50 IDs per request to avoid
  // pathological response sizes; the recently-viewed rail never
  // displays more than ~20 anyway. SOLD / CANCELLED / EXPIRED
  // listings get filtered out so a stale ID in the client's
  // localStorage doesn't render a "gone" card on the rail.
  private async browseByIds(rawIds: string, clerkId?: string) {
    const ids = rawIds
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 50);
    if (ids.length === 0) {
      return { listings: [], total: 0, page: 1, limit: ids.length };
    }
    const rows = await this.prisma.listing.findMany({
      // isDealListing:false — a viewed deal PDP must not resurface as a normal
      // recently-viewed card in the public rail.
      where: {
        id: { in: ids },
        status: 'ACTIVE',
        isDealListing: false,
        // A members-only listing must not come back through the
        // recently-viewed rail either — the client holds the ids in
        // localStorage, which survives sign-out.
        ...this.publicOnly(clerkId),
      },
      include: {
        images: { where: { isPrimary: true }, take: 1 },
        category: { select: { id: true, name: true, slug: true } },
        seller: {
          select: { id: true, username: true, sellerTier: true },
        },
      },
    });
    // Re-order to match the input list (Prisma's findMany ignores it).
    const byId = new Map(rows.map((r) => [r.id, r]));
    const listings = ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => !!r);
    return {
      listings,
      total: listings.length,
      page: 1,
      limit: ids.length,
    };
  }

  /**
   * Build the Meilisearch filter-clause array shared by browseViaSearch and
   * the facets endpoint, so a facet count is always computed over EXACTLY the
   * same result set the browse would return (AND-consistent). Meilisearch has
   * no parameterized filters, so every user-supplied value is escaped/validated
   * before it reaches the filter string — see the per-branch notes. Returns the
   * AND-joinable parts; the caller joins with ' AND '.
   */
  private buildActiveListingFilter(
    dto: BrowseListingsDto,
    parsedAttrs: Record<string, unknown> = {},
    clerkId?: string,
  ): string[] {
    const {
      categoryId,
      categorySlug,
      listingType,
      condition,
      province,
      make,
      minPrice,
      maxPrice,
    } = dto;

    // isDealListing = false — first-party Daily Deals never appear in public
    // search/facets (they live only on /deals). Requires 'isDealListing' in
    // STATIC_LISTING_FILTERABLE_ATTRIBUTES (search.service.ts) + on the Meili doc.
    const filterParts: string[] = ['status = "ACTIVE"', 'isDealListing = false'];
    // Signed-out search must not reach members-only stock. `calibre` and
    // `categoryName` are searchable attributes, so without this a plain
    // ?q=glock returns firearm rows to anyone. Requires 'publicVisible' in
    // STATIC_LISTING_FILTERABLE_ATTRIBUTES + on the indexed document.
    if (!clerkId) filterParts.push('publicVisible = true');
    // Parent-category rollup (mirrors browseViaPrisma): a parent id/slug
    // must match its own leaf listings OR any child's, via the indexed
    // parentId/parentSlug. Wrapped in parens so the outer AND-join stays
    // correct. Leaf categories have no children indexed under them, so
    // this behaves identically to an exact match for leaves.
    if (categoryId)
      filterParts.push(`(categoryId = "${categoryId}" OR parentId = "${categoryId}")`);
    if (categorySlug)
      filterParts.push(
        `(categorySlug = "${categorySlug}" OR parentSlug = "${categorySlug}")`,
      );
    if (listingType) filterParts.push(`listingType = "${listingType}"`);
    if (condition) filterParts.push(`condition = "${condition}"`);
    if (province) filterParts.push(`province = "${province}"`);
    // Escape backslash + double-quote so a brand like 6.5" or O'Dell can't
    // break out of the Meilisearch filter string.
    if (make)
      filterParts.push(`make = "${make.replace(/(["\\])/g, '\\$1')}"`);
    if (minPrice !== undefined) filterParts.push(`price >= ${minPrice}`);
    if (maxPrice !== undefined) filterParts.push(`price <= ${maxPrice}`);

    // P4.3a — per-category attribute filters. CRITICAL: every key and every
    // string value is sanitized before it touches the filter string, because
    // Meilisearch has no parameterized filters — an unsanitized key/value is
    // a filter-injection vector.
    //  - KEY must match the snake_case regex (else the whole entry is
    //    skipped); the Meili field is `attr_<key>`.
    //  - number  → attr_<key> = <n>            (finite only)
    //  - boolean → attr_<key> = true|false
    //  - string  → attr_<key> = "<escaped>"    (same backslash+quote escape
    //    the `make` filter uses)
    //  - { min, max } (finite numbers) → attr_<key> >= min AND attr_<key> <= max
    for (const [key, value] of Object.entries(parsedAttrs)) {
      if (!ATTR_KEY_RE.test(key)) continue; // reject unsanitized keys outright
      const field = `attr_${key}`;

      if (typeof value === 'number') {
        if (Number.isFinite(value)) filterParts.push(`${field} = ${value}`);
        continue;
      }
      if (typeof value === 'boolean') {
        filterParts.push(`${field} = ${value ? 'true' : 'false'}`);
        continue;
      }
      if (typeof value === 'string') {
        // Same escaping as the `make` filter above.
        filterParts.push(`${field} = "${value.replace(/(["\\])/g, '\\$1')}"`);
        continue;
      }
      // Range object { min?, max? } — only finite numeric bounds are applied.
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const { min, max } = value as { min?: unknown; max?: unknown };
        if (typeof min === 'number' && Number.isFinite(min)) {
          filterParts.push(`${field} >= ${min}`);
        }
        if (typeof max === 'number' && Number.isFinite(max)) {
          filterParts.push(`${field} <= ${max}`);
        }
      }
    }

    return filterParts;
  }

  /**
   * P4-polish — facet counts for the FilterBar ("Toyota (12)"). Runs a
   * zero-hit Meilisearch query over the SAME filter the browse would apply
   * (buildActiveListingFilter) and returns Meili's facetDistribution keyed by
   * field → value → count. Only meaningful when a category is in scope (the
   * only surface that renders facets) and Meili is connected; otherwise returns
   * an empty map so the client simply renders options without counts (graceful
   * degradation, same as when Meili is down for browse).
   *
   * Counts are AND-consistent: they reflect ALL currently-applied filters, so
   * the count next to a value = exactly what the browse would return if that
   * value were (the only) selection within the current filter set. The client
   * suppresses counts on the facet the user is actively filtering (that facet
   * collapses to the chosen value), so no misleading zeros are shown.
   */
  async facets(
    dto: BrowseListingsDto,
    clerkId?: string,
  ): Promise<{
    facets: Record<string, Record<string, number>>;
  }> {
    const { categoryId, categorySlug } = dto;
    if ((!categoryId && !categorySlug) || !this.search.isConnected) {
      return { facets: {} };
    }

    const parsedAttrs = this.parseAttrFilters(dto.attrs);
    // Same clerkId as the browse, so a facet count can never advertise stock
    // the signed-out grid refuses to show ("Glock (3)" over an empty result).
    const filterParts = this.buildActiveListingFilter(dto, parsedAttrs, clerkId);

    // Static enum facets the FilterBar renders (make/condition/province/type).
    const facetFields = ['make', 'condition', 'province', 'listingType'];

    // Plus the scoped category's filterable SELECT/BOOLEAN attrs — the exact
    // keys the FilterBar shows as attr filters. NUMBER attrs are range inputs
    // (no per-value buckets), so they're excluded. Resolve the category id from
    // the slug when only a slug is given (category pages route by slug).
    let resolvedCategoryId = categoryId;
    if (!resolvedCategoryId && categorySlug) {
      const cat = await this.prisma.category.findUnique({
        where: { slug: categorySlug },
        select: { id: true },
      });
      resolvedCategoryId = cat?.id;
    }
    if (resolvedCategoryId) {
      try {
        const defs =
          await this.categories.getEffectiveAttributes(resolvedCategoryId);
        for (const def of defs) {
          if (
            def.filterable &&
            (def.type === 'SELECT' || def.type === 'BOOLEAN')
          ) {
            facetFields.push(`attr_${def.key}`);
          }
        }
      } catch {
        // attr facets are best-effort; static facets still return
      }
    }

    const result = await this.search.search(INDEXES.LISTINGS, dto.q ?? '', {
      filter: filterParts.join(' AND '),
      limit: 0,
      facets: facetFields,
    });

    return {
      facets: (result.facetDistribution ?? {}) as Record<
        string,
        Record<string, number>
      >,
    };
  }

  private async browseViaSearch(
    dto: BrowseListingsDto,
    parsedAttrs: Record<string, unknown> = {},
    clerkId?: string,
  ) {
    const { q = '', page = 1, limit = 20, sort = 'newest' } = dto;

    const filterParts = this.buildActiveListingFilter(dto, parsedAttrs, clerkId);

    const sortBy =
      sort === 'price_asc'
        ? ['price:asc']
        : sort === 'price_desc'
          ? ['price:desc']
          : sort === 'ending_soon'
            ? // Mirrors the Prisma path. Non-auctions carry the far-future
              // NEVER_ENDS_TS sentinel, so they land after real auctions
              // instead of ahead of them.
              ['endTimeTs:asc']
            : ['createdAt:desc'];

    const result = await this.search.search(INDEXES.LISTINGS, q, {
      filter: filterParts.join(' AND '),
      sort: sortBy,
      offset: (page - 1) * limit,
      limit,
    });

    // Insights — record only real TEXT searches (not blank browse/filter
    // changes), and only PAGE 1 (paging through results of the same query
    // is one search, not many). Query text + result count is the best "what
    // people want vs what we stock" signal; zero-result searches flag
    // advertising/stock gaps. Attributed when signed in (OptionalClerkGuard).
    if (typeof q === 'string' && q.trim().length > 0 && page === 1) {
      this.activity.record({
        eventType: 'search',
        actor: { clerkId },
        query: q.trim(),
        resultCount: result.estimatedTotalHits ?? 0,
      });
    }

    // Meilisearch returns its own flat document shape (id, title, status,
    // categorySlug, etc.) — NO relations like `images`, `seller`, or
    // `category`. Returning those raw hits would crash every consumer
    // that does `listing.images.find(...)` (ListingCard, listing detail,
    // wishlist). Fix: use Meilisearch only for ranking + filtering, then
    // re-fetch the full Prisma listing rows with the same includes
    // browseViaPrisma uses, preserving the Meilisearch hit order.
    type Hit = { id?: string };
    const hits = result.hits as Hit[];
    const ids = hits.map((h) => h.id).filter((x): x is string => !!x);
    if (ids.length === 0) {
      return { listings: [], total: result.estimatedTotalHits ?? 0, page, limit };
    }

    const rows = await this.prisma.listing.findMany({
      where: { id: { in: ids } },
      include: {
        images: { where: { isPrimary: true }, take: 1 },
        category: { select: { id: true, name: true, slug: true } },
        seller: {
          select: {
            id: true,
            username: true,
            sellerTier: true,
            // UX-1b — seller rating shown on cards. averageRating is a
            // cached denormalised field on User; the review count is a
            // cheap joined aggregate (same query, no N+1). Both public.
            averageRating: true,
            _count: { select: { ratingsReceived: true } },
          },
        },
      },
    });

    // Restore Meilisearch order. findMany returns rows in DB order;
    // we want them sorted by where each listing's ID appears in the
    // Meilisearch hit list so search relevance is preserved.
    const byId = new Map(rows.map((r) => [r.id, r]));
    const listings = ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => !!r);

    return {
      listings,
      total: result.estimatedTotalHits ?? 0,
      page,
      limit,
    };
  }

  private async browseViaPrisma(dto: BrowseListingsDto, clerkId?: string) {
    const {
      page = 1,
      limit = 20,
      sort = 'newest',
      categoryId,
      categorySlug,
      listingType,
      condition,
      province,
      make,
      minPrice,
      maxPrice,
      sellerClerkId,
      brandSlug,
    } = dto;

    // isDealListing:false — THE public-discovery chokepoint. GET /listings,
    // category pages, /brand/[slug], seller grids, cross-sell and Ask GG's
    // searchMarketplace/getComplements all flow through here; excluding Daily
    // Deals once keeps them off every public grid. They surface only on /deals.
    const where: Record<string, unknown> = {
      status: 'ACTIVE',
      isDealListing: false,
      // …and publicVisible for signed-out callers: the same chokepoint, one
      // audience narrower. Regulated stock stays fully functional for members.
      ...this.publicOnly(clerkId),
    };
    // P5.7 — brand landing page. Fold the slug back to its stored `make`
    // variants and filter to all of them. An unknown/too-thin slug resolves
    // to null → match nothing (the page 404s before it ever calls browse, but
    // this keeps the endpoint honest if hit directly).
    if (brandSlug) {
      const resolved = await this.resolveBrandSlug(brandSlug);
      where.make = resolved ? { in: resolved.makes } : { in: [] };
    }
    // Parent-category rollup: listings are filed on LEAF categories, so a
    // parent browse (self OR child-of) must match the category itself AND
    // any category whose parentId is this one. Leaf categories have no
    // children, so `parentId: X` matches nothing → identical to an exact
    // match for leaves.
    if (categoryId)
      where.category = { OR: [{ id: categoryId }, { parentId: categoryId }] };
    if (categorySlug)
      where.category = {
        OR: [{ slug: categorySlug }, { parent: { slug: categorySlug } }],
      };
    if (listingType) where.listingType = listingType;
    if (condition) where.condition = condition;
    if (province) where.province = province;
    // P5.7 — don't let an exact `make` param stomp the brandSlug fold's
    // `make IN (...)` clause set above (a request carrying BOTH would otherwise
    // silently drop every casing variant except the exact match). brandSlug is
    // the broader, canonical filter, so it wins.
    if (make && !brandSlug) where.make = make;
    if (minPrice !== undefined || maxPrice !== undefined) {
      const priceFilter: Record<string, number> = {};
      if (minPrice !== undefined) priceFilter.gte = minPrice;
      if (maxPrice !== undefined) priceFilter.lte = maxPrice;
      where.price = priceFilter;
    }
    // Seller filter — used by /sellers/[clerkId] to show only that
    // seller's active listings. Resolved via the User row's clerkId
    // (relation filter) so we don't need an extra round-trip.
    if (sellerClerkId) where.seller = { clerkId: sellerClerkId };

    const orderBy =
      sort === 'price_asc'
        ? { price: 'asc' as const }
        : sort === 'price_desc'
          ? { price: 'desc' as const }
          : sort === 'ending_soon'
            ? // Soonest-closing auction first. `nulls: 'last'` matters: every
              // non-auction listing has a null endTime, and Postgres sorts
              // NULLs FIRST on ASC by default — without this the "ending
              // soonest" view would open with every listing that never ends.
              { endTime: { sort: 'asc' as const, nulls: 'last' as const } }
            : { createdAt: 'desc' as const };

    const [listings, total] = await Promise.all([
      this.prisma.listing.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          images: { where: { isPrimary: true }, take: 1 },
          category: { select: { id: true, name: true, slug: true } },
          seller: {
            select: {
              id: true,
              // Public listings show username only — never firstName /
              // lastName. Real names exist only inside KYC + paid-
              // transaction internals. See feedback memory:
              // username-not-real-name.
              username: true,
              sellerTier: true,
              // Phase E1 badges — GG+ pill (MEMBER/PRO) + verified-
              // expert badge render next to the username on every
              // listing card. Both fields are public by design (OD1
              // + OD2 locked).
              subscriptionTier: true,
              isVerifiedExpert: true,
              // UX-1b — seller rating on cards. averageRating is a cached
              // denormalised field; the count is a cheap joined aggregate
              // (same query, no N+1). Both public.
              averageRating: true,
              _count: { select: { ratingsReceived: true } },
            },
          },
        },
      }),
      this.prisma.listing.count({ where }),
    ]);

    return { listings, total, page, limit };
  }

  // Public listing detail (GET /listings/:id). This endpoint is unguarded by
  // design — it powers the server-rendered PDP — so it MUST NOT hand out the
  // seller's private fields (see PUBLIC_LISTING_SELECT for the full block-list
  // and why). It IS, however, owner-aware: when the caller presents a valid
  // Clerk token for the seller (via OptionalClerkGuard → clerkId), they also
  // get their hidden reserve / auto-accept threshold (to pre-fill the edit
  // form) and the moderation-banner fields, and may see the listing at any
  // status. Anonymous / non-owner callers get the public projection and only
  // for publicly-visible statuses.
  async findById(id: string, clerkId?: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      select: PUBLIC_LISTING_SELECT,
    });
    if (!listing) throw new NotFoundException('Listing not found');

    const isOwner = !!clerkId && listing.seller?.clerkId === clerkId;

    // Insights — a listing view (fire-and-forget; owner previews still record
    // but the operator's own views are filtered out by ActivityService).
    this.activity.record({
      eventType: 'listing_view',
      actor: { clerkId },
      listingId: id,
    });

    if (isOwner) {
      // Owner sees their own listing at any status, plus the private extras.
      // Second (tiny) query keeps the hot public path to a single round-trip
      // and keeps the private columns out of the shared public select.
      const extras = await this.prisma.listing.findUnique({
        where: { id },
        select: OWNER_LISTING_EXTRAS_SELECT,
      });
      return { ...listing, ...extras };
    }

    // Non-owner: don't let DRAFT / PENDING_REVIEW / CANCELLED listings be
    // probed by id. Throw the same NotFound as a missing row so existence
    // isn't revealed.
    if (!PUBLICLY_VISIBLE_STATUSES.includes(listing.status)) {
      throw new NotFoundException('Listing not found');
    }

    // Members-only category + no session → 404, deliberately identical to a
    // missing row. A "sign in to view this item" response would confirm that a
    // firearm exists at this id, which is exactly what the gate is for; the
    // 404 page carries the friendly "some listings are members-only" line
    // instead. Note this is keyed on having ANY verified session, not on
    // ownership — every signed-in member sees the full catalogue.
    if (!clerkId && !listing.publicVisible) {
      throw new NotFoundException('Listing not found');
    }

    return listing;
  }

  async update(id: string, clerkId: string, dto: UpdateListingDto) {
    const listing = await this.assertOwner(id, clerkId);

    if (
      listing.status === ListingStatus.SOLD ||
      listing.status === ListingStatus.CANCELLED
    ) {
      throw new BadRequestException('Cannot edit a sold or cancelled listing');
    }

    // Marketplace integrity: once a buyer has committed (auction bid
    // OR live take-a-shot offer in negotiation), the seller can no
    // longer edit. Prevents bait-and-switch where a seller accepts
    // commitment on one item then swaps it. assertEditable throws
    // 409 if locked.
    await this.assertEditable(listing);

    // AMMUNITION BAN — the edit path is the obvious bypass: publish something
    // innocent, then rewrite it into ammunition once it is live. Checked
    // against the EFFECTIVE values (the incoming field, falling back to what
    // is stored), for two reasons: a partial PATCH that only changes the title
    // must still be judged against the stored description, and a legacy row
    // that predates this guard must not become editable-and-live. The
    // effective CATEGORY is checked too, so a listing cannot be moved into
    // (or edited while sitting in) an ammunition category.
    const effectiveCategoryId = dto.categoryId ?? listing.categoryId;
    const effectiveTitle = dto.title ?? listing.title;
    const effectiveDescription = dto.description ?? listing.description;
    const ammoGateCategory = await this.prisma.category.findUnique({
      where: { id: effectiveCategoryId },
      select: {
        slug: true,
        name: true,
        isFirearm: true,
        parent: { select: { slug: true, name: true } },
      },
    });
    if (ammoGateCategory) {
      this.assertNotLiveAmmunition(
        ammoGateCategory,
        effectiveTitle,
        effectiveDescription,
      );
    }

    // Price-less types (TAKE_A_SHOT) can never gain a listed price — mirrors
    // the create() guard so a crafted PATCH can't sneak one on.
    if (PRICELESS_LISTING_TYPES.has(listing.listingType) && dto.price) {
      throw new BadRequestException(
        "Take a Shot listings don't carry a listed price.",
      );
    }

    // Phase M dealer-lock — if the seller is editing shippingMethods
    // on a firearm listing, DEALER_TRANSFER must still be present.
    if (
      listing.isFirearm &&
      dto.shippingMethods !== undefined &&
      !dto.shippingMethods.includes('DEALER_TRANSFER')
    ) {
      throw new BadRequestException(
        'Firearm listings must include "Dealer-stocked transfer" as a shipping option.',
      );
    }

    // P3 collection-lock — a collection-only listing must keep COLLECTION as
    // its sole shipping method. The edit form hides shipping for these, but a
    // crafted PATCH mustn't switch a trailer onto a courier method.
    if (
      listing.collectionOnly &&
      dto.shippingMethods !== undefined &&
      (dto.shippingMethods.length !== 1 ||
        dto.shippingMethods[0] !== ShippingMethod.COLLECTION)
    ) {
      throw new BadRequestException(
        'Collection-only listings can only be collected in person — courier delivery is not available.',
      );
    }
    // P4.3b — a legitimate edit can cross the DG threshold AND send COLLECTION
    // (the client anticipating the collection switch). A raw pre-check of the
    // incoming battery_wh lets the symmetric guard below allow that tighten-to-
    // collection edit; the full validation + DG override further down re-checks
    // and forces collection either way, so relaxing the guard here is safe.
    const dgWhThreshold = await this.settings.get(FLAGS.dgLithiumWhThreshold);
    const editRawWh = Number(
      (dto.attributes as Record<string, unknown> | undefined)?.battery_wh ??
        NaN,
    );
    const editWillBeDg =
      Number.isFinite(editRawWh) && editRawWh > dgWhThreshold;
    // Symmetric guard — a non-collection listing must never carry COLLECTION
    // in its offered methods (keeps a firearm's [DEALER_TRANSFER, …] array
    // clean; the firearm lock above only checks DEALER_TRANSFER presence).
    if (
      !listing.collectionOnly &&
      !editWillBeDg &&
      dto.shippingMethods !== undefined &&
      dto.shippingMethods.includes(ShippingMethod.COLLECTION)
    ) {
      throw new BadRequestException(
        'In-person collection is only available for collection-only listings.',
      );
    }

    // FCA gate (P0.1a) — a category change must never alter the firearm
    // status of a listing. isFirearm is snapshotted at create() after the
    // full serial/licence verification; re-filing a firearm under
    // "Camping" would bypass dealer transfer + SAP-534, and re-filing a
    // non-firearm as a firearm would skip the licence checks entirely.
    // Either direction ⇒ the seller must create a new listing.
    // P5.4 — set true when a category change moves the listing into a category
    // that does NOT offer the tested-&-working attestation, so we clear any
    // stale stamp (otherwise the seller's "tested & working" badge would keep
    // showing on a listing the operator never enabled the claim for — a CPA
    // s41 gate bypass). Recomputed below inside the category-change block.
    let clearTestedWorkingStamp = false;
    // Set only when the category actually changes; undefined leaves the
    // existing snapshot untouched.
    let nextPublicVisible: boolean | undefined;
    if (dto.categoryId !== undefined && dto.categoryId !== listing.categoryId) {
      const newCategory = await this.prisma.category.findUnique({
        where: { id: dto.categoryId },
        select: {
          isFirearm: true,
          isActive: true,
          availableSecondhand: true,
          collectionOnly: true,
          showTestedWorkingAttestation: true,
          publicVisible: true,
        },
      });
      if (!newCategory || !newCategory.isActive) {
        throw new BadRequestException('Invalid category');
      }
      if (!newCategory.availableSecondhand) {
        throw new BadRequestException(
          'This category is not available for marketplace listings.',
        );
      }
      if (newCategory.isFirearm !== listing.isFirearm) {
        throw new BadRequestException(
          listing.isFirearm
            ? 'A firearm listing cannot be moved to a non-firearm category. Cancel it and create a new listing instead.'
            : 'A listing cannot be moved into a licence-controlled firearm category. Create a new listing so the serial and licence can be verified.',
        );
      }
      // P3 — same reasoning for collection-only: the COLLECTION shipping
      // method + papers attestation are snapshotted at create. Moving across
      // the collection/courier boundary would strand a stale snapshot.
      if (newCategory.collectionOnly !== listing.collectionOnly) {
        throw new BadRequestException(
          'This listing cannot be moved between collection-only and courier categories. Cancel it and create a new listing instead.',
        );
      }
      // P5.4 — if the destination category doesn't offer the tested-&-working
      // attestation, drop any stamp carried over from the source category so
      // the badge can't appear where the operator didn't enable it.
      if (!newCategory.showTestedWorkingAttestation) {
        clearTestedWorkingStamp = true;
      }
      // Re-snapshot signed-out visibility. Unlike isFirearm this boundary IS
      // crossable (Optics is public, Shooting Accessories is members-only), so
      // a stale snapshot would leave a members-only listing publicly visible —
      // exactly the leak this whole change exists to prevent.
      nextPublicVisible = newCategory.publicVisible;
    }

    // FCA gate (review finding) — UpdateListingDto is PartialType(Create),
    // so the ...dto spread would happily overwrite the VERIFIED firearm
    // serial + serial/licence photos (create() runs Claude licence
    // verification; update() runs none — a seller could swap in an
    // unlicensed firearm's serial under firearm A's verified verdict).
    // The selling format is equally immutable (auction/offer state
    // machines key off it). Allow only resubmitting the identical value.
    if (
      dto.listingType !== undefined &&
      dto.listingType !== listing.listingType
    ) {
      throw new BadRequestException(
        'The selling format cannot be changed after listing — cancel and create a new listing.',
      );
    }
    if (
      (dto.serialNumber !== undefined && dto.serialNumber !== listing.serialNumber) ||
      (dto.serialPhotoUrl !== undefined && dto.serialPhotoUrl !== listing.serialPhotoUrl) ||
      (dto.licencePhotoUrl !== undefined && dto.licencePhotoUrl !== listing.licencePhotoUrl)
    ) {
      throw new BadRequestException(
        'The serial number and licence documents are verified when a listing is created and cannot be changed. Cancel this listing and create a new one to list a different firearm.',
      );
    }

    // UX-7 — re-validate the compare-at ("was") price on edit so a crafted
    // PATCH can't bypass the CPA s41 anti-anchoring cap the create path
    // enforces. Only runs when the edit actually touches price or compare-at;
    // otherwise a valid stored pair is left alone (e.g. a description-only
    // edit). Effective values fall back to the stored listing when omitted, so
    // changing only the price still re-checks the existing compare-at.
    if (
      dto.price !== undefined ||
      dto.compareAtPriceZarCents !== undefined
    ) {
      const effectiveCompareAt =
        dto.compareAtPriceZarCents !== undefined
          ? dto.compareAtPriceZarCents
          : listing.compareAtPriceZarCents;
      if (effectiveCompareAt != null) {
        if (listing.listingType !== 'BUY_NOW') {
          throw new BadRequestException(
            'A compare-at (original) price is only available on Buy Now listings.',
          );
        }
        const effectivePrice =
          dto.price !== undefined ? (dto.price ?? 0) : (listing.price ?? 0);
        if (effectiveCompareAt <= effectivePrice) {
          throw new BadRequestException(
            'The original price must be higher than the sale price.',
          );
        }
        if (effectiveCompareAt > effectivePrice * 4) {
          throw new BadRequestException(
            'The original price can be at most 4× the sale price.',
          );
        }
      }
    }

    // Planned dealer-stock — only touch the columns when the client sent
    // at least one of the three structured parts (an edit that omits them
    // leaves the existing values alone, so a price-only PATCH doesn't force
    // it). For firearms all three are required + composed into the display
    // string; for non-firearms they're forced null. Throws if a firearm is
    // missing any part. isFirearm can't change on edit (FCA gate below), so
    // the listing snapshot is authoritative.
    const plannedDealerProvided =
      dto.plannedDealerName !== undefined ||
      dto.plannedDealerProvince !== undefined ||
      dto.plannedDealerArea !== undefined;
    const plannedDealerUpdate = plannedDealerProvided
      ? this.buildPlannedDealer(dto, listing.isFirearm)
      : undefined;
    // Take a Shot thresholds must not cross post-edit (mirrors create()).
    // Compare the EFFECTIVE values — an edit may change only one side.
    const effDecline =
      dto.autoDeclineThreshold !== undefined
        ? dto.autoDeclineThreshold
        : listing.autoDeclineThreshold;
    const effAccept =
      dto.autoAcceptThreshold !== undefined
        ? dto.autoAcceptThreshold
        : listing.autoAcceptThreshold;
    if (effDecline != null && effAccept != null && effDecline >= effAccept) {
      throw new BadRequestException(
        'The auto-decline threshold must be below the auto-accept threshold.',
      );
    }

    // Strip fields from the ...dto spread at the TYPE level — a runtime `delete`
    // wouldn't change the type, so the spread would clash with Prisma's input:
    //   - collectionPapersAttested: a create-time attestation, not a Listing column.
    //   - attributes: a real Json column, but validated + set separately below
    //     (the raw, unvalidated client object must never reach Prisma).
    //   - plannedDealer* : controlled + composed above, never passed raw.
    const {
      collectionPapersAttested: _omitPapers,
      attributes: _omitAttributes,
      testedWorkingAttested: _omitTested,
      plannedDealerName: _omitPdName,
      plannedDealerProvince: _omitPdProvince,
      plannedDealerArea: _omitPdArea,
      plannedDealerLocation: _omitPdLocation,
      // privateArrangeConsent is a boolean INTENT flag; the column is the
      // timestamp privateArrangeConsentAt, computed below. Never pass raw.
      privateArrangeConsent: _omitPaConsent,
      ...listingUpdate
    } = dto;
    void _omitPapers;
    void _omitAttributes;
    void _omitPaConsent;
    void _omitTested;
    void _omitPdName;
    void _omitPdProvince;
    void _omitPdArea;
    void _omitPdLocation;

    // P4.2 — validate attributes against the EXISTING listing's category (a
    // category change can't cross the firearm/collection boundary, so the def
    // set is stable). Only set the cleaned object when the client supplied one;
    // an undefined dto.attributes leaves the column untouched.
    let attributesUpdate:
      | Prisma.InputJsonValue
      | typeof Prisma.JsonNull
      | undefined;
    // P4.3b — if an edit pushes battery_wh over the DG limit, tighten the
    // listing to collection-only (tighten only; never auto-loosen — dropping
    // back below the limit stays collection-only until a manual change).
    let dgTighten = false;
    if (dto.attributes !== undefined) {
      const attributeDefs = await this.categories.getEffectiveAttributes(
        listing.categoryId,
      );
      const { cleaned, error } = validateAndCleanAttributes(
        attributeDefs,
        dto.attributes,
      );
      if (error) {
        throw new BadRequestException(error);
      }
      attributesUpdate =
        Object.keys(cleaned).length > 0
          ? (cleaned as Prisma.InputJsonValue)
          : Prisma.JsonNull;
      const wh = Number(cleaned.battery_wh ?? NaN);
      dgTighten = Number.isFinite(wh) && wh > dgWhThreshold;
      if (
        dgTighten &&
        listing.listingType !== 'BUY_NOW' &&
        listing.listingType !== 'AUCTION'
      ) {
        throw new BadRequestException(
          'Large lithium batteries ship collection-only, which this listing type does not support. Cancel and relist it as Buy Now or Auction.',
        );
      }
    }

    // ---- Claude AI moderation on the EDIT path ---------------------------
    // Until 2026-08 update() ran the deterministic term guard and nothing
    // else: moderate() was only ever called from previewDraft() and create().
    // That made the edit path the cheapest bypass on the platform — publish a
    // clean "Bergara B14 HMR chambered in .308 Winchester", then PATCH the
    // description into an ammunition advert. assertEditable only locks on
    // bids/offers, so an ACTIVE listing with neither edits freely, and the
    // tail of this method re-indexes it. It also made the moderation prompt's
    // own claim ("a deterministic term guard already runs on every write
    // path") true while the AI half of that sentence was false.
    //
    // We re-run the FULL moderator rather than just forcing PENDING_REVIEW.
    // Forcing review would have been the cheap option, but it taxes every
    // honest typo fix with an admin round-trip and sellers learn to avoid
    // editing — the same "listings stuck pending" failure create() was
    // deliberately unwound from. Claude only runs when the seller actually
    // touches the title, the description or the category (a price or shipping
    // PATCH is free), so the spend is bounded by real text edits.
    //
    // Judged on the EFFECTIVE (merged) values: a PATCH that changes only the
    // title must still be read against the stored description.
    const editTouchesText =
      dto.title !== undefined ||
      dto.description !== undefined ||
      dto.categoryId !== undefined;

    let editModeration: ListingModerationResult | null = null;
    let editStatus: ListingStatus | undefined;
    let editDescription: string | undefined;
    let editOriginalDescription: string | undefined;
    let editAutoFixApplied = false;

    if (editTouchesText) {
      const moderationEnabled = await this.settings.get(
        FLAGS.claudeModerationEnabled,
      );
      if (moderationEnabled && this.moderation.isEnabled) {
        editModeration = await this.moderation.moderate({
          title: effectiveTitle,
          description: effectiveDescription,
          categoryName: ammoGateCategory?.name ?? '',
          categoryIsFirearm: ammoGateCategory?.isFirearm ?? listing.isFirearm,
          priceCents:
            dto.price !== undefined ? (dto.price ?? null) : listing.price,
          compareAtPriceCents:
            dto.compareAtPriceZarCents !== undefined
              ? (dto.compareAtPriceZarCents ?? null)
              : listing.compareAtPriceZarCents,
          imageUrls: [],
          imageCount: 0,
          sellerFirstFirearmListings: false,
        });

        // Same mapping create() uses: APPROVE / AUTO_FIX → publishable,
        // REJECT → PENDING_REVIEW for an admin. A listing that was already
        // PENDING_REVIEW stays there; nothing here promotes a listing.
        if (editModeration.decision === 'AUTO_FIX_AND_APPROVE') {
          const cleaned =
            editModeration.cleanedDescription ?? effectiveDescription;
          editDescription = this.moderation.stripContactInfo(cleaned).cleaned;
          editOriginalDescription = effectiveDescription;
          editAutoFixApplied = true;
        }
        if (
          editModeration.decision === 'REJECT' ||
          editModeration.decision === 'HUMAN_REVIEW'
        ) {
          editStatus = ListingStatus.PENDING_REVIEW;
        }
      } else {
        // Flag off OR no API key — mirrors create(), which publishes without
        // moderation rather than stalling the seller in a review queue.
        this.logger.warn(
          moderationEnabled
            ? 'ANTHROPIC_API_KEY not set — applying listing edit without moderation'
            : 'Moderation flag is OFF — applying listing edit without moderation',
        );
      }
    }

    // Re-derive the published location whenever the pickup address is edited.
    // Without this the two halves drift the moment a seller corrects an
    // address: the buyer would keep seeing the old town while the courier
    // collects from the new one — and the old town is the one the buyer's
    // "location is not a refund ground" acknowledgement was based on.
    const locationUpdate: {
      province?: Province;
      pickupProvince?: Province;
      publicLocality?: string | null;
    } = {};
    if (dto.pickupProvince !== undefined || dto.province !== undefined) {
      const p = dto.pickupProvince ?? dto.province;
      if (p) {
        locationUpdate.province = p;
        locationUpdate.pickupProvince = p;
      }
    }
    if (dto.pickupCity !== undefined) {
      locationUpdate.publicLocality = toPublicLocality(dto.pickupCity);
    }

    const updated = await this.prisma.listing.update({
      where: { id },
      data: {
        ...listingUpdate,
        ...locationUpdate,
        ...(editDescription !== undefined
          ? { description: editDescription }
          : {}),
        ...(editStatus !== undefined ? { status: editStatus } : {}),
        ...(editModeration
          ? {
              claudeDecision: editModeration.decision,
              claudeConfidence: editModeration.confidence,
              claudeReasons: editModeration.reasons,
              claudeReviewedAt: new Date(),
              claudeOriginalDescription: editOriginalDescription ?? null,
              claudeAutoFixApplied: editAutoFixApplied,
            }
          : {}),
        ...(plannedDealerUpdate !== undefined ? plannedDealerUpdate : {}),
        ...(attributesUpdate !== undefined
          ? { attributes: attributesUpdate }
          : {}),
        ...(dgTighten
          ? {
              collectionOnly: true,
              shippingMethods: [ShippingMethod.COLLECTION],
            }
          : {}),
        // Re-resolve PRIVATE_ARRANGE consent only when the seller is editing
        // shipping options (and not being force-tightened to COLLECTION). An
        // edit that keeps PRIVATE_ARRANGE without re-ticking reuses the
        // existing consent; adding it fresh requires the tick.
        ...(dto.shippingMethods !== undefined && !dgTighten
          ? {
              privateArrangeConsentAt: this.resolvePrivateArrangeConsent(
                dto.shippingMethods.includes(ShippingMethod.PRIVATE_ARRANGE),
                dto.privateArrangeConsent,
                listing.privateArrangeConsentAt,
              ),
            }
          : {}),
        ...(clearTestedWorkingStamp ? { testedWorkingAttestedAt: null } : {}),
        ...(nextPublicVisible !== undefined
          ? { publicVisible: nextPublicVisible }
          : {}),
      },
      include: { images: true, category: true },
    });

    if (updated.status === ListingStatus.ACTIVE) {
      await this.indexListing(updated);
    } else if (listing.status === ListingStatus.ACTIVE) {
      // The edit knocked a live listing back into review (moderation REJECT).
      // Leaving the old document behind would keep the pre-edit copy
      // searchable and clickable — the exact hole the edit-path backstop
      // exists to close.
      await this.search.deleteDocument(INDEXES.LISTINGS, id);
    }

    // P5.2 — price-drop alert to wishlisters. Fire only on a genuine DECREASE of
    // an ACTIVE listing, throttled to once per 12h per listing so repeated small
    // edits can't spam every watcher. Both old (`listing.price`) and new
    // (`updated.price`) are in scope with zero extra fetches. Fire-and-forget so
    // a notification hiccup never breaks the seller's edit.
    const PRICE_DROP_THROTTLE_MS = 12 * 60 * 60 * 1000;
    const throttleOk =
      !listing.priceDropNotifiedAt ||
      Date.now() - listing.priceDropNotifiedAt.getTime() > PRICE_DROP_THROTTLE_MS;
    if (
      updated.status === ListingStatus.ACTIVE &&
      dto.price !== undefined &&
      listing.price != null &&
      updated.price != null &&
      updated.price < listing.price &&
      throttleOk
    ) {
      void this.wishlistAlerts
        .notifyPriceDrop(
          {
            id: updated.id,
            title: updated.title,
            price: updated.price,
            sellerId: updated.sellerId,
          },
          listing.price,
        )
        .catch((e) =>
          this.logger.error(
            `price-drop notify failed for ${id}: ${(e as Error).message}`,
          ),
        );
    }

    return updated;
  }

  async cancel(id: string, clerkId: string) {
    await this.assertOwner(id, clerkId);

    const updated = await this.prisma.listing.update({
      where: { id },
      data: { status: ListingStatus.CANCELLED },
    });

    await this.search.deleteDocument(INDEXES.LISTINGS, id);
    return updated;
  }

  /**
   * Seller confirms a listing is still for sale — resets the stale-listing
   * clock (lastRenewedAt) so the daily 75d-nudge / 90d-expire sweep starts a
   * fresh cycle, and clears renewalNudgedAt so the next cycle can nudge again.
   * Deliberately the ONLY writer of lastRenewedAt: ordinary edits must never
   * extend a dead listing's life (that's exactly the bug this replaces).
   * ACTIVE non-auction listings only — auctions have their own endTime
   * lifecycle and nothing else is at risk of the sweep.
   */
  async renew(id: string, clerkId: string) {
    const listing = await this.assertOwner(id, clerkId);
    if (listing.status !== ListingStatus.ACTIVE) {
      throw new BadRequestException('Only an active listing can be renewed');
    }
    if (listing.listingType === 'AUCTION') {
      throw new BadRequestException(
        'Auctions end on their own schedule and never need renewing',
      );
    }
    const updated = await this.prisma.listing.update({
      where: { id },
      data: { lastRenewedAt: new Date(), renewalNudgedAt: null },
      select: { id: true, lastRenewedAt: true },
    });
    return { renewed: true, lastRenewedAt: updated.lastRenewedAt };
  }

  async addImage(id: string, clerkId: string, file: Express.Multer.File) {
    const listing = await this.assertOwner(id, clerkId);
    // Photos can't change after commitment — buyers commit on the
    // images they see at bid / offer time. Same lock as update().
    await this.assertEditable(listing);

    const imageCount = await this.prisma.listingImage.count({
      where: { listingId: id },
    });
    if (imageCount >= 10) {
      throw new BadRequestException('Maximum 10 images per listing');
    }

    const { url, publicId } = await this.cloudinary.uploadImage(
      file.buffer,
      'listings',
    );

    return this.prisma.listingImage.create({
      data: {
        listingId: id,
        url,
        publicId,
        order: imageCount,
        isPrimary: imageCount === 0,
      },
    });
  }

  async removeImage(listingId: string, imageId: string, clerkId: string) {
    const listing = await this.assertOwner(listingId, clerkId);
    // Same lock — removing a photo after commitment would let the
    // seller change which item buyers think they're bidding /
    // offering on.
    await this.assertEditable(listing);

    const image = await this.prisma.listingImage.findFirst({
      where: { id: imageId, listingId },
    });
    if (!image) throw new NotFoundException('Image not found');

    await this.cloudinary.deleteImage(image.publicId);
    await this.prisma.listingImage.delete({ where: { id: imageId } });

    if (image.isPrimary) {
      const first = await this.prisma.listingImage.findFirst({
        where: { listingId },
        orderBy: { order: 'asc' },
      });
      if (first) {
        await this.prisma.listingImage.update({
          where: { id: first.id },
          data: { isPrimary: true },
        });
      }
    }
  }

  async findMine(clerkId: string) {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) return [];

    return this.prisma.listing.findMany({
      where: { sellerId: user.id },
      include: {
        images: { where: { isPrimary: true }, take: 1 },
        category: { select: { id: true, name: true, slug: true } },
        // P5.2 — how many buyers have wishlisted this listing, so /my/listings
        // can nudge the seller ("N saved — consider a price drop"). Cheap
        // indexed aggregate, same one the buyer-facing SocialProofPill uses.
        _count: { select: { wishlistedBy: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Marketplace-integrity gate — locks listing edits once a buyer
   * has committed:
   *
   *   - AUCTION → any bid placed (bidCount > 0)
   *   - TAKE_A_SHOT → any offer in PENDING / COUNTERED / ACCEPTED
   *     (i.e. mid-negotiation or deal-effectively-done)
   *   - BUY_NOW → not gated here; the existing status flow
   *     (PENDING_PAYMENT → PENDING → SOLD) blocks edits at the
   *     right point.
   *
   * Throws 409 ConflictException with a structured body so the
   * frontend can render a clean explanation card instead of a
   * generic error.
   */
  private async assertEditable(listing: {
    id: string;
    listingType: ListingType;
    bidCount: number;
    // The offer edit-lock reads this; callers pass the full listing row.
    acceptsOffers: boolean;
  }): Promise<void> {
    if (listing.listingType === ListingType.AUCTION && listing.bidCount > 0) {
      throw new ConflictException({
        message:
          "This listing is locked because bids have been placed. You can't edit an auction once buyers have committed — cancel + relist if the listing is wrong.",
        code: 'listing-locked-by-bids',
        bidCount: listing.bidCount,
        listingId: listing.id,
      });
    }
    // ⚠️ KEYED ON THE OFFER FLAG, NOT THE OLD LISTING TYPE. This lock exists
    // because editing a listing out from under a live offer changes what the
    // buyer offered on. That is now possible on ANY listing, since Buy Now and
    // Auction listings take offers too — so checking the type would have left
    // every one of them editable mid-offer.
    if (listing.acceptsOffers) {
      const activeOffer = await this.prisma.offer.findFirst({
        where: {
          listingId: listing.id,
          status: { in: ['PENDING', 'COUNTERED', 'ACCEPTED'] },
        },
        select: { id: true, status: true },
      });
      if (activeOffer) {
        throw new ConflictException({
          message:
            "This listing is locked because there's an offer in negotiation. You can't change the item mid-deal. Reject or wait for the offer to expire, then edit.",
          code: 'listing-locked-by-offer',
          offerStatus: activeOffer.status,
          listingId: listing.id,
        });
      }
    }
  }

  /** Public read of the lock state — used by /listings/:id detail so
   *  the frontend can hide the Edit button without trial-and-error
   *  on the update endpoint. Returns `{ canEdit, reason? }`. */
  async getEditLockState(listingId: string): Promise<{
    canEdit: boolean;
    reason: string | null;
    code: string | null;
  }> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        listingType: true,
        status: true,
        bidCount: true,
        // Read by the offer edit-lock below.
        acceptsOffers: true,
      },
    });
    if (!listing) {
      return { canEdit: false, reason: 'Listing not found', code: 'not-found' };
    }
    if (
      listing.status === ListingStatus.SOLD ||
      listing.status === ListingStatus.CANCELLED
    ) {
      return {
        canEdit: false,
        reason: `Listing is ${listing.status.toLowerCase()}.`,
        code: 'listing-' + listing.status.toLowerCase(),
      };
    }
    if (
      listing.listingType === ListingType.AUCTION &&
      listing.bidCount > 0
    ) {
      return {
        canEdit: false,
        reason: `Bids have been placed (${listing.bidCount}). The listing is locked.`,
        code: 'listing-locked-by-bids',
      };
    }
    // ⚠️ KEYED ON THE OFFER FLAG, NOT THE OLD LISTING TYPE. This lock exists
    // because editing a listing out from under a live offer changes what the
    // buyer offered on. That is now possible on ANY listing, since Buy Now and
    // Auction listings take offers too — so checking the type would have left
    // every one of them editable mid-offer.
    if (listing.acceptsOffers) {
      const activeOffer = await this.prisma.offer.findFirst({
        where: {
          listingId: listing.id,
          status: { in: ['PENDING', 'COUNTERED', 'ACCEPTED'] },
        },
        select: { status: true },
      });
      if (activeOffer) {
        return {
          canEdit: false,
          reason: `An offer is in negotiation (${activeOffer.status.toLowerCase()}). The listing is locked.`,
          code: 'listing-locked-by-offer',
        };
      }
    }
    return { canEdit: true, reason: null, code: null };
  }

  private async assertOwner(listingId: string, clerkId: string) {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new ForbiddenException('User not found');

    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.sellerId !== user.id) throw new ForbiddenException('Not your listing');

    return listing;
  }

  // Re-sync a single listing to Meilisearch. Used by the admin
  // review flow after approving/rejecting a PENDING_REVIEW listing —
  // create() only indexes when the listing lands directly in ACTIVE,
  // so admin-approved rows were ghost-missing from the search index
  // until this helper got wired in.
  //
  // Loads the listing fresh (with category) so the indexed shape
  // matches the create()-time index exactly.
  async reindexById(listingId: string): Promise<void> {
    const row = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: { category: true },
    });
    if (!row) return;
    if (row.status === 'ACTIVE') {
      await this.indexListing(row);
    } else {
      // Anything non-ACTIVE must NOT be searchable. Removing on every
      // non-ACTIVE transition keeps the index clean (idempotent — a
      // delete of a missing doc is a no-op in Meilisearch).
      await this.removeFromIndex(listingId);
    }
  }

  // One-time / admin-triggered full reindex of every ACTIVE listing.
  // Needed after the parentId/parentSlug fields were added to the Meili
  // doc — existing docs predate those attributes, so parent-category
  // browse would miss them until each is re-indexed. Small catalogue, so
  // a simple loop is fine; indexing is off the hot path. Idempotent —
  // re-running just overwrites each doc with the same shape.
  async reindexAllActiveListings(): Promise<{ reindexed: number }> {
    const rows = await this.prisma.listing.findMany({
      // Daily Deals are never indexed for search (see indexListing skip).
      where: { status: 'ACTIVE', isDealListing: false },
      include: { category: true },
    });
    for (const row of rows) {
      await this.indexListing(row);
    }
    return { reindexed: rows.length };
  }

  // Public helper so the admin module can yank a listing out of
  // Meilisearch without us re-exporting SearchService.
  async removeFromIndex(listingId: string): Promise<void> {
    try {
      await this.search.deleteDocument(INDEXES.LISTINGS, listingId);
    } catch (err) {
      this.logger.warn(
        `Failed to remove listing ${listingId} from index: ${(err as Error).message}`,
      );
    }
  }

  private async indexListing(
    listing: Listing & {
      category: { slug: string; name: string; parentId: string | null } | null;
    },
  ) {
    // Daily Deals never enter the search index — they live only on /deals.
    // Actively evict any stale doc (defensive; the create path already skips
    // indexing house deals). Every doc that IS indexed therefore carries
    // isDealListing:false, so the browse/facets filter `isDealListing = false`
    // matches the whole index (the clause needs the attribute to exist).
    if (listing.isDealListing) {
      await this.removeFromIndex(listing.id);
      return;
    }
    try {
      // Parent-category rollup: index the parent's id + slug so a parent
      // browse can filter down to this leaf listing. Both null for
      // root-category listings (no parent). Off the hot path (indexing
      // only), so the extra lookup per doc is fine.
      const parentId = listing.category?.parentId ?? null;
      let parentSlug: string | null = null;
      if (parentId) {
        const parent = await this.prisma.category.findUnique({
          where: { id: parentId },
          select: { slug: true },
        });
        parentSlug = parent?.slug ?? null;
      }
      const doc: Record<string, unknown> = {
        id: listing.id,
        title: listing.title,
        description: listing.description,
        make: listing.make,
        model: listing.model,
        calibre: listing.calibre,
        categoryId: listing.categoryId,
        categorySlug: listing.category?.slug,
        categoryName: listing.category?.name,
        parentId,
        parentSlug,
        // Always present on indexed docs (deals are skipped above), so the
        // browse/facets `isDealListing = false` filter has an attribute to match.
        isDealListing: listing.isDealListing,
        // Signed-out search filters on this. Read from the listing's own
        // snapshot rather than the joined category so the indexed value can
        // never disagree with what the Prisma browse returns.
        publicVisible: listing.publicVisible,
        status: listing.status,
        listingType: listing.listingType,
        condition: listing.condition,
        province: listing.province,
        sellerId: listing.sellerId,
        price: listing.price,
        priceRange: listing.price ? this.priceRange(listing.price) : null,
        createdAt: listing.createdAt?.toISOString(),
        // Sortable auction close time, as a NUMBER (Meili sorts numerics
        // predictably; a null/absent field has no defined position). Anything
        // that never ends gets a far-future sentinel so an ascending
        // "ending soonest" sort puts real auctions first and everything else
        // after them, matching the Prisma path's `nulls: 'last'`.
        endTimeTs: listing.endTime
          ? listing.endTime.getTime()
          : NEVER_ENDS_TS,
      };

      // P4.3a — flatten the per-category attribute VALUES into `attr_<key>`
      // fields so Meilisearch can facet/filter on them (native types are
      // preserved: numbers stay numbers, booleans stay booleans). The key
      // regex is a defence in case a malformed key ever reaches the index —
      // only snake_case keys become facet fields.
      const attrs = listing.attributes;
      if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) {
        for (const [key, value] of Object.entries(attrs as Record<string, unknown>)) {
          if (!ATTR_KEY_RE.test(key)) continue;
          doc[`attr_${key}`] = value;
        }
      }

      await this.search.addDocuments(INDEXES.LISTINGS, [doc]);
    } catch (err) {
      this.logger.warn(`Failed to index listing ${listing.id}: ${(err as Error).message}`);
    }
  }

  private priceRange(cents: number): string {
    const rand = cents / 100;
    if (rand < 5000) return 'under-5000';
    if (rand < 20000) return '5000-20000';
    if (rand < 100000) return '20000-100000';
    return 'over-100000';
  }
}
