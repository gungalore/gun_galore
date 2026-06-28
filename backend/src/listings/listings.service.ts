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
import { Listing, ListingStatus, ListingType } from '@prisma/client';
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

// Listing types that carry NO listed sale price — buyers name a price
// (TAKE_A_SHOT) or trade an item (SWOP). The price guards below treat both
// the same: price must be omitted, not required.
const PRICELESS_LISTING_TYPES = new Set<ListingType>([
  ListingType.TAKE_A_SHOT,
  ListingType.SWOP,
]);

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

    if (!PRICELESS_LISTING_TYPES.has(dto.listingType) && !dto.price) {
      throw new BadRequestException('Price is required for BUY_NOW and AUCTION listings');
    }
    if (PRICELESS_LISTING_TYPES.has(dto.listingType) && dto.price) {
      throw new BadRequestException('Take a Shot and Swop listings must not have a listed price');
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

    if (!PRICELESS_LISTING_TYPES.has(dto.listingType) && !dto.price) {
      throw new BadRequestException('Price is required for BUY_NOW and AUCTION listings');
    }
    if (PRICELESS_LISTING_TYPES.has(dto.listingType) && dto.price) {
      throw new BadRequestException('Take a Shot and Swop listings must not have a listed price');
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

    const listing = await this.prisma.listing.create({
      data: {
        referenceNumber,
        sellerId: user.id,
        categoryId: dto.categoryId,
        title: dto.title,
        description: finalDescription,
        price: dto.price,
        listingType: dto.listingType,
        status,
        condition: dto.condition,
        province: dto.province,
        isFirearm: category.isFirearm,
        trackInventory,
        quantityAvailable,
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
        // Delivery + pickup address
        shippingMethods: dto.shippingMethods ?? [],
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

    if (q && this.search.isConnected) {
      return this.browseViaSearch(dto);
    }
    return this.browseViaPrisma(dto);
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
    if (dto.listingId) {
      const l = await this.prisma.listing.findUnique({
        where: { id: dto.listingId },
        select: { categoryId: true, calibre: true, make: true },
      });
      if (l) {
        fromCategoryId = l.categoryId;
        calibre = l.calibre;
        make = l.make;
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
        signal = make ?? calibre ?? (dto.q || undefined);
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

  private async browseViaSearch(dto: BrowseListingsDto) {
    const {
      q = '',
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
    } = dto;

    const filterParts: string[] = ['status = "ACTIVE"'];
    if (categoryId) filterParts.push(`categoryId = "${categoryId}"`);
    if (categorySlug) filterParts.push(`categorySlug = "${categorySlug}"`);
    if (listingType) filterParts.push(`listingType = "${listingType}"`);
    if (condition) filterParts.push(`condition = "${condition}"`);
    if (province) filterParts.push(`province = "${province}"`);
    // Escape backslash + double-quote so a brand like 6.5" or O'Dell can't
    // break out of the Meilisearch filter string.
    if (make)
      filterParts.push(`make = "${make.replace(/(["\\])/g, '\\$1')}"`);
    if (minPrice !== undefined) filterParts.push(`price >= ${minPrice}`);
    if (maxPrice !== undefined) filterParts.push(`price <= ${maxPrice}`);

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
    } = dto;

    const where: Record<string, unknown> = { status: 'ACTIVE' };
    if (categoryId) where.categoryId = categoryId;
    if (categorySlug) where.category = { slug: categorySlug };
    if (listingType) where.listingType = listingType;
    if (condition) where.condition = condition;
    if (province) where.province = province;
    if (make) where.make = make;
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

    // Normalise the optional planned-dealer hint: trim, null out
    // whitespace-only inputs (matches create()).
    const normalisedPlanned =
      dto.plannedDealerLocation === undefined
        ? undefined
        : (dto.plannedDealerLocation ?? '').trim().length > 0
          ? dto.plannedDealerLocation!.trim()
          : null;
    const updated = await this.prisma.listing.update({
      where: { id },
      data: {
        ...dto,
        ...(normalisedPlanned !== undefined
          ? { plannedDealerLocation: normalisedPlanned }
          : {}),
      },
      include: { images: true, category: true },
    });

    if (updated.status === ListingStatus.ACTIVE) {
      await this.indexListing(updated);
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

  private async indexListing(listing: Listing & { category: { slug: string; name: string } | null }) {
    try {
      await this.search.addDocuments(INDEXES.LISTINGS, [
        {
          id: listing.id,
          title: listing.title,
          description: listing.description,
          make: listing.make,
          model: listing.model,
          calibre: listing.calibre,
          categoryId: listing.categoryId,
          categorySlug: listing.category?.slug,
          categoryName: listing.category?.name,
          status: listing.status,
          listingType: listing.listingType,
          condition: listing.condition,
          province: listing.province,
          sellerId: listing.sellerId,
          price: listing.price,
          priceRange: listing.price ? this.priceRange(listing.price) : null,
          createdAt: listing.createdAt?.toISOString(),
        },
      ]);
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
