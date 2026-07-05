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
import { Listing, ListingStatus, ListingType, ShippingMethod } from '@prisma/client';
import {
  ListingModerationService,
  ListingModerationResult,
  hashAttempt,
  categorizeReason,
} from '../moderation/listing-moderation.service';
import { PreviewListingDto } from './dto/preview-listing.dto';
import { SettingsService, FLAGS } from '../settings/settings.service';
import { ReferenceNumberService } from '../common/reference-number.service';
import { FirearmLicenceService } from './firearm-licence.service';
import { inventoryEligible } from '../payments/inventory';
import { CategoriesService } from '../categories/categories.service';
import { WishlistAlertsService } from '../wishlist-alerts/wishlist-alerts.service';
import { validateAndCleanAttributes } from './attribute-validation';
import { Prisma } from '@prisma/client';

// Listing types that carry NO listed sale price — buyers name a price
// (TAKE_A_SHOT) or trade an item (SWOP). The price guards below treat both
// the same: price must be omitted, not required.
const PRICELESS_LISTING_TYPES = new Set<ListingType>([
  ListingType.TAKE_A_SHOT,
  ListingType.SWOP,
]);

// P4.3a — attribute keys are snake_case and stable (matches the DB check
// on CategoryAttribute.key). Used both when flattening values into the
// Meili doc (`attr_<key>`) and when sanitizing client-supplied attr filters
// so an unsanitized key can never be interpolated into a filter string.
const ATTR_KEY_RE = /^[a-z][a-z0-9_]{0,48}$/;

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
  ) {}

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

  // Pre-upload the outfitter's public-liability insurance + registration
  // proof to Cloudinary BEFORE create() for a hunting-package / experience
  // listing, so the Sell form can pass the returned URLs into POST /listings
  // for the admin / Claude-vision supplier-doc review. Mirrors
  // uploadFirearmDocs (open self-serve safeguard for experiences).
  async uploadSupplierDocs(
    clerkId: string,
    insurance: Express.Multer.File | undefined,
    registration: Express.Multer.File | undefined,
  ): Promise<{ insuranceUrl: string; registrationDocUrl: string }> {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new ForbiddenException('User not synced — try again in a moment');
    if (user.isBanned) throw new ForbiddenException('Account is suspended');
    if (!insurance || !registration) {
      throw new BadRequestException(
        'Both a public-liability insurance certificate and an outfitter registration document are required.',
      );
    }
    const [ins, reg] = await Promise.all([
      this.cloudinary.uploadImage(
        insurance.buffer,
        `experience-supplier-docs/${user.id}`,
      ),
      this.cloudinary.uploadImage(
        registration.buffer,
        `experience-supplier-docs/${user.id}`,
      ),
    ]);
    return { insuranceUrl: ins.url, registrationDocUrl: reg.url };
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
    },
  ) {
    if (!description?.trim()) {
      return { enhanced: '', changed: false, specsAdded: false };
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
    if (user.isBanned) throw new ForbiddenException('Account is suspended');

    const category = await this.prisma.category.findUnique({
      where: { id: dto.categoryId },
    });
    if (!category || !category.isActive) {
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
      throw new BadRequestException('Take a Shot and Swop listings must not have a listed price');
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
      const salePrice = dto.price ?? 0;
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

  async create(clerkId: string, dto: CreateListingDto): Promise<Listing> {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new ForbiddenException('User not synced — try again in a moment');
    if (user.isBanned) throw new ForbiddenException('Account is suspended');

    const category = await this.prisma.category.findUnique({
      where: { id: dto.categoryId },
    });
    if (!category || !category.isActive) {
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
      throw new BadRequestException('Take a Shot and Swop listings must not have a listed price');
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
      const salePrice = dto.price ?? 0;
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
    // papers gate). Take-a-Shot's offer-checkout and Swop carry no collection
    // path, so restrict collection-only items — category-flagged OR DG-forced —
    // to Buy Now / Auction.
    if (
      effectiveCollectionOnly &&
      dto.listingType !== 'BUY_NOW' &&
      dto.listingType !== 'AUCTION'
    ) {
      throw new BadRequestException(
        dgLithiumRestricted
          ? 'Large lithium batteries ship collection-only, so they can be listed as Buy Now or Auction — not Take-a-Shot or Swop.'
          : 'Collection-only items (e.g. trailers and caravans) can be listed as Buy Now or Auction — not Take-a-Shot or Swop.',
      );
    }
    // ---- Hunting Packages / Experiences (Category.isExperience) ----------
    // A future-dated on-site SERVICE (hunting package / range day): no courier
    // or parcel, Buy Now or Auction only, funds held until the buyer confirms
    // the experience happened. Open self-serve, so we capture the supplier's
    // registration + public-liability insurance + attestations and route every
    // experience to PENDING_REVIEW for an admin to check before it goes live.
    const isExperience = category.isExperience;
    let supplierAttestedAt: Date | null = null;
    let experienceEventStart: Date | null = null;
    let experienceEventEnd: Date | null = null;
    if (isExperience) {
      if (dto.listingType !== 'BUY_NOW' && dto.listingType !== 'AUCTION') {
        throw new BadRequestException(
          'Hunting packages and experiences can only be listed as Marketplace (Buy Now) or Auction — not Take a Shot or Swop.',
        );
      }
      if (dto.shippingMethods && dto.shippingMethods.length > 0) {
        throw new BadRequestException(
          'Hunting packages are delivered on-site — no courier or collection method applies.',
        );
      }
      if (!dto.experienceType) {
        throw new BadRequestException(
          'Select the experience type (range day or plains-game hunt).',
        );
      }
      if (!dto.eventStartDate) {
        throw new BadRequestException(
          'An event date is required for a hunting package.',
        );
      }
      experienceEventStart = new Date(dto.eventStartDate);
      if (
        Number.isNaN(experienceEventStart.getTime()) ||
        experienceEventStart.getTime() <= Date.now()
      ) {
        throw new BadRequestException('The event date must be in the future.');
      }
      if (dto.eventEndDate) {
        experienceEventEnd = new Date(dto.eventEndDate);
        if (
          Number.isNaN(experienceEventEnd.getTime()) ||
          experienceEventEnd.getTime() < experienceEventStart.getTime()
        ) {
          throw new BadRequestException(
            'The event end date must be on or after the start date.',
          );
        }
      }
      if (!dto.eventProvince) {
        throw new BadRequestException(
          'Select the province where the experience takes place.',
        );
      }
      if (!dto.capacitySlots || dto.capacitySlots < 1) {
        throw new BadRequestException(
          'Set how many hunters/guests the package accommodates (at least 1).',
        );
      }
      if (!dto.whatsIncluded || dto.whatsIncluded.trim().length === 0) {
        throw new BadRequestException(
          'Describe what the package includes (accommodation, guide, field prep…).',
        );
      }
      if (
        dto.experienceType === 'PLAINS_GAME_HUNT' &&
        (!dto.speciesList || dto.speciesList.length === 0)
      ) {
        throw new BadRequestException(
          'List at least one species for a plains-game hunt.',
        );
      }
      if (
        !dto.supplierRegistrationNumber ||
        dto.supplierRegistrationNumber.trim().length === 0
      ) {
        throw new BadRequestException(
          'Enter your professional-hunter / outfitter registration number.',
        );
      }
      if (!dto.supplierRegistrationDocUrl || !dto.supplierInsuranceUrl) {
        throw new BadRequestException(
          'Upload your registration document and public-liability insurance certificate.',
        );
      }
      if (
        dto.supplierPublicLiabilityAttested !== true ||
        dto.supplierAuthorityAttested !== true ||
        dto.supplierRiskDisclosureAttested !== true
      ) {
        throw new BadRequestException(
          'You must confirm all supplier declarations before listing an experience.',
        );
      }
      supplierAttestedAt = new Date();
    } else if (
      dto.experienceType ||
      dto.eventStartDate ||
      dto.eventProvince ||
      dto.capacitySlots ||
      dto.supplierRegistrationNumber
    ) {
      // Experience fields were sent for a non-experience category — reject so
      // they can't be smuggled onto a normal listing.
      throw new BadRequestException(
        'Experience details are only valid for hunting-package categories.',
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

    // Experiences are ALWAYS admin-reviewed before going live — open
    // self-serve supplier, so a human checks the registration / insurance /
    // attestations regardless of Claude's moderation verdict.
    if (isExperience) {
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
      inventoryEligible(dto.listingType, category.isFirearm, isExperience) &&
      Number.isFinite(requestedStock) &&
      requestedStock > 1;
    const quantityAvailable = trackInventory
      ? Math.min(requestedStock, 9999)
      : 1;

    // (attributes were validated + the DG collection-only flag computed above,
    // before the collection gates — see cleanedAttributes / attributesForDb /
    // effectiveCollectionOnly.)
    const listing = await this.prisma.listing.create({
      data: {
        referenceNumber,
        sellerId: user.id,
        categoryId: dto.categoryId,
        title: dto.title,
        description: finalDescription,
        price: dto.price,
        // UX-7 — display-only "was" price (validated above; BUY_NOW only).
        compareAtPriceZarCents: dto.compareAtPriceZarCents ?? null,
        listingType: dto.listingType,
        status,
        // P5.1 — stamp discoverability time when publishing straight to ACTIVE;
        // a PENDING_REVIEW listing gets its listedAt on admin approval instead.
        // The saved-search matcher keys "new" on this, not createdAt.
        listedAt: status === ListingStatus.ACTIVE ? new Date() : null,
        condition: dto.condition,
        province: dto.province,
        isFirearm: category.isFirearm,
        // P3 — snapshot the collection-only + papers flags from the category
        // (like isFirearm) so downstream shipping / checkout logic never has
        // to re-join the category. papersAttestedAt is the seller's create-
        // time attestation (null for non-papers categories).
        collectionOnly: effectiveCollectionOnly,
        requiresPapers: category.requiresPapers,
        papersAttestedAt,
        testedWorkingAttestedAt,
        // Experience snapshot (Category.isExperience). Inert for every normal
        // listing; drives the on-site-service fulfilment path when set.
        isExperience,
        experienceType: dto.experienceType ?? null,
        eventStartDate: experienceEventStart,
        eventEndDate: experienceEventEnd,
        eventProvince: isExperience ? (dto.eventProvince ?? null) : null,
        locationText: isExperience ? (dto.locationText ?? null) : null,
        capacitySlots: isExperience ? (dto.capacitySlots ?? null) : null,
        durationText: isExperience ? (dto.durationText ?? null) : null,
        speciesList: isExperience ? (dto.speciesList ?? []) : [],
        whatsIncluded: isExperience ? (dto.whatsIncluded ?? null) : null,
        rifleProvided: isExperience ? (dto.rifleProvided ?? false) : false,
        supplierRegistrationNumber: isExperience
          ? (dto.supplierRegistrationNumber?.trim() ?? null)
          : null,
        supplierRegistrationDocUrl: isExperience
          ? (dto.supplierRegistrationDocUrl ?? null)
          : null,
        supplierInsuranceUrl: isExperience
          ? (dto.supplierInsuranceUrl ?? null)
          : null,
        supplierAttestedAt,
        // Inert default so the listing lands in the admin review queue; the
        // Claude-vision doc review is wired in E5.
        supplierDocReviewStatus: isExperience ? 'PENDING_ADMIN_REVIEW' : null,
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
        autoAcceptThreshold: dto.autoAcceptThreshold,
        reservePrice: dto.reservePrice ?? null,
        buyNowPrice: dto.buyNowPrice ?? null,
        durationDays: dto.durationDays ?? null,
        isFeatured: dto.isFeatured ?? false,
        startTime,
        endTime,
        // Delivery + pickup address. Collection-only categories are forced
        // to the single COLLECTION method regardless of what the client sent.
        shippingMethods: isExperience
          ? [ShippingMethod.ON_SITE_SERVICE]
          : effectiveCollectionOnly
            ? [ShippingMethod.COLLECTION]
            : (dto.shippingMethods ?? []),
        // Phase M dealer-lock — optional planned-dealer hint shown
        // to buyers near that dealer. Trimmed to spec-allowed 200
        // chars at the DTO layer; we also defensively null out
        // whitespace-only inputs here.
        plannedDealerLocation:
          (dto.plannedDealerLocation ?? '').trim().length > 0
            ? dto.plannedDealerLocation!.trim()
            : null,
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

  async browse(dto: BrowseListingsDto) {
    const { q, sellerClerkId, ids } = dto;

    // `ids=cuid1,cuid2,…` — multi-ID lookup for the recently-viewed
    // rail. Returns ACTIVE listings in the order the IDs were given
    // (preserves the recency stack the client maintains). All other
    // filters are ignored on this path because the client has
    // already chosen the exact listings it wants.
    if (ids) return this.browseByIds(ids);

    // Seller-scoped browses always go via Prisma — the Meilisearch
    // index stores sellerId (our internal cuid), not sellerClerkId, so
    // matching a Clerk ID against it would need a pre-resolve step.
    // The seller-profile page never combines q with a sellerClerkId
    // in practice, so this is the cleaner path.
    if (sellerClerkId) return this.browseViaPrisma(dto);

    // P5.7 — brand-scoped browses always go via Prisma. The brand fold
    // (slug → all stored make casings → `make IN (...)`) lives ONLY in
    // browseViaPrisma; buildActiveListingFilter on the Meili path has no
    // brandSlug handling, so routing a brandSlug+q request to Meili would
    // silently drop the brand constraint and return every brand's q-matches.
    // Force Prisma so the brand filter is always honoured (q is ignored on
    // this path, which is the safe degradation — brand-scoped, not global).
    if (dto.brandSlug) return this.browseViaPrisma(dto);

    // P4.3a — per-category attribute filters (JSON-encoded in dto.attrs).
    // Parsed defensively; a malformed blob is silently ignored. Attribute
    // filtering is implemented ONLY on the Meili path — the Prisma fallback
    // does not apply attr filters (documented degradation when Meili is
    // down), so route to Meili whenever q OR attr filters are present.
    const parsedAttrs = this.parseAttrFilters(dto.attrs);
    const hasAttrFilters = Object.keys(parsedAttrs).length > 0;

    if ((q || hasAttrFilters) && this.search.isConnected) {
      return this.browseViaSearch(dto, parsedAttrs);
    }
    return this.browseViaPrisma(dto);
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
  async listBrands(limit = 60): Promise<string[]> {
    const rows = await this.prisma.listing.groupBy({
      by: ['make'],
      where: { status: 'ACTIVE', make: { not: null } },
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
  ): Promise<{ slug: string; label: string; count: number }[]> {
    const rows = await this.prisma.listing.groupBy({
      by: ['make'],
      where: { status: 'ACTIVE', make: { not: null } },
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
      where: { status: 'ACTIVE', make: { not: null } },
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
  async soldComps(dto: { categorySlug?: string; categoryId?: string }) {
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
        listing: { status: 'SOLD', category: categoryFilter },
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
      where: { status: 'ACTIVE' },
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
  async crossSell(dto: {
    listingId?: string;
    fromCategoryId?: string;
    q?: string;
    excludeIds?: string;
  }): Promise<{ suggestions: unknown[]; reason: string | null }> {
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
      const res = await this.browse({
        categoryId: rel.toCategoryId,
        q: signal,
        limit: 8,
        sort: 'newest',
      } as BrowseListingsDto);
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
  private async browseByIds(rawIds: string) {
    const ids = rawIds
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 50);
    if (ids.length === 0) {
      return { listings: [], total: 0, page: 1, limit: ids.length };
    }
    const rows = await this.prisma.listing.findMany({
      where: { id: { in: ids }, status: 'ACTIVE' },
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

    const filterParts: string[] = ['status = "ACTIVE"'];
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
  async facets(dto: BrowseListingsDto): Promise<{
    facets: Record<string, Record<string, number>>;
  }> {
    const { categoryId, categorySlug } = dto;
    if ((!categoryId && !categorySlug) || !this.search.isConnected) {
      return { facets: {} };
    }

    const parsedAttrs = this.parseAttrFilters(dto.attrs);
    const filterParts = this.buildActiveListingFilter(dto, parsedAttrs);

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
  ) {
    const { q = '', page = 1, limit = 20, sort = 'newest' } = dto;

    const filterParts = this.buildActiveListingFilter(dto, parsedAttrs);

    const sortBy =
      sort === 'price_asc'
        ? ['price:asc']
        : sort === 'price_desc'
          ? ['price:desc']
          : ['createdAt:desc'];

    const result = await this.search.search(INDEXES.LISTINGS, q, {
      filter: filterParts.join(' AND '),
      sort: sortBy,
      offset: (page - 1) * limit,
      limit,
    });

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

  private async browseViaPrisma(dto: BrowseListingsDto) {
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

    const where: Record<string, unknown> = { status: 'ACTIVE' };
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

  async findById(id: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: {
        images: { orderBy: { order: 'asc' } },
        category: true,
        seller: {
          select: {
            id: true,
            clerkId: true,
            // Public-facing handle only. firstName/lastName are
            // explicitly NOT selected here — listing detail must not
            // leak the seller's real identity.
            username: true,
            avatarUrl: true,
            sellerTier: true,
            totalSales: true,
            createdAt: true,
            // Phase E1 badges (OD1 + OD2 locked).
            subscriptionTier: true,
            isVerifiedExpert: true,
            // Public rationale — only shown on the seller profile,
            // never on browse cards. Visible to everyone because
            // the badge is a public award; private rationale lives
            // in AdminAuditEvent only.
            expertBadgeReason: true,
            // UX-1b — seller rating shown near the PDP title (links to
            // the seller profile). Cached average + cheap joined count.
            averageRating: true,
            _count: { select: { ratingsReceived: true } },
          },
        },
        // Social-proof signals: how many people have saved this
        // listing. Surfaced as "X people saved this" on the listing
        // detail page (only when ≥ 3 — "1 person saved this" reads
        // sadder than no signal). Cheap aggregate query via Prisma's
        // _count. Counts are public — names never are.
        _count: {
          select: { wishlistedBy: true },
        },
      },
    });
    if (!listing) throw new NotFoundException('Listing not found');
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
    if (dto.categoryId !== undefined && dto.categoryId !== listing.categoryId) {
      const newCategory = await this.prisma.category.findUnique({
        where: { id: dto.categoryId },
        select: {
          isFirearm: true,
          isActive: true,
          availableSecondhand: true,
          collectionOnly: true,
          showTestedWorkingAttestation: true,
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

    // Normalise the optional planned-dealer hint: trim, null out
    // whitespace-only inputs (matches create()).
    const normalisedPlanned =
      dto.plannedDealerLocation === undefined
        ? undefined
        : (dto.plannedDealerLocation ?? '').trim().length > 0
          ? dto.plannedDealerLocation!.trim()
          : null;
    // Strip fields from the ...dto spread at the TYPE level — a runtime `delete`
    // wouldn't change the type, so the spread would clash with Prisma's input:
    //   - collectionPapersAttested: a create-time attestation, not a Listing column.
    //   - attributes: a real Json column, but validated + set separately below
    //     (the raw, unvalidated client object must never reach Prisma).
    const {
      collectionPapersAttested: _omitPapers,
      attributes: _omitAttributes,
      testedWorkingAttested: _omitTested,
      ...listingUpdate
    } = dto;
    void _omitPapers;
    void _omitAttributes;
    void _omitTested;

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

    const updated = await this.prisma.listing.update({
      where: { id },
      data: {
        ...listingUpdate,
        ...(normalisedPlanned !== undefined
          ? { plannedDealerLocation: normalisedPlanned }
          : {}),
        ...(attributesUpdate !== undefined
          ? { attributes: attributesUpdate }
          : {}),
        ...(dgTighten
          ? {
              collectionOnly: true,
              shippingMethods: [ShippingMethod.COLLECTION],
            }
          : {}),
        ...(clearTestedWorkingStamp ? { testedWorkingAttestedAt: null } : {}),
      },
      include: { images: true, category: true },
    });

    if (updated.status === ListingStatus.ACTIVE) {
      await this.indexListing(updated);
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
    if (listing.listingType === ListingType.TAKE_A_SHOT) {
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
      select: { id: true, listingType: true, status: true, bidCount: true },
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
    if (listing.listingType === ListingType.TAKE_A_SHOT) {
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
      where: { status: 'ACTIVE' },
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
        status: listing.status,
        listingType: listing.listingType,
        condition: listing.condition,
        province: listing.province,
        sellerId: listing.sellerId,
        price: listing.price,
        priceRange: listing.price ? this.priceRange(listing.price) : null,
        createdAt: listing.createdAt?.toISOString(),
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
