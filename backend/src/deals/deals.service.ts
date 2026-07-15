import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DealStatus, ListingStatus, ShippingMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReferenceNumberService } from '../common/reference-number.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { SettingsService, FLAGS } from '../settings/settings.service';
import { AdminAuditService } from '../admin/admin-audit.service';
import { inventoryEligible } from '../payments/inventory';
import {
  CreateDealDto,
  UpdateDealDto,
  ScheduleDealDto,
  ExtendDealDto,
} from './dto/deal.dto';

// ─── Daily Deals service (DD-1) ──────────────────────────────────────
// First-party "OneDayOnly-style" house deals. A Deal is a 1:1 overlay on
// a BUY_NOW Listing filed under the house-seller User. `isDealListing =
// true` keeps that listing out of EVERY public marketplace surface (the
// exclusion sweep), and — in DD-1 — the underlying Listing is held at
// status DRAFT so it is neither browsable NOR reachable via the public
// PDP (non-owner status gating 404s DRAFT). The whole module is therefore
// INERT: no money path, no drop cron, no public /deals surface yet. The
// Deal.status lifecycle here is pure admin bookkeeping; DD-4 will sync the
// Listing status to ACTIVE on go-live when the storefront + money path
// exist.
//
// House rules: usernames only, no "escrow", first-party money branches
// live in DD-2 (adversarial review), NOT here.

// A house deal is ordinary retail — never a licensed/regulated item.
// Firearms are 1-per-SAPS-534 and route through dealers; experiences are
// on-site services with their own fulfilment; papers-required categories
// are licence-controlled. All are rejected at the category gate.
function isLicensedCategory(c: {
  isFirearm: boolean;
  requiresPapers: boolean;
  isExperience: boolean;
}): boolean {
  return c.isFirearm || c.requiresPapers || c.isExperience;
}

@Injectable()
export class DealsService {
  private readonly logger = new Logger(DealsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly referenceNumbers: ReferenceNumberService,
    private readonly cloudinary: CloudinaryService,
    private readonly settings: SettingsService,
    private readonly audit: AdminAuditService,
  ) {}

  // Resolve the seeded house-seller User id (Setting written by
  // seed-house-seller.ts). Fails CLOSED — if the seed hasn't run, deal
  // creation is impossible rather than silently filing under the wrong
  // account.
  private async resolveHouseSellerId(): Promise<string> {
    const id = await this.settings.get(FLAGS.houseSellerUserId);
    if (!id) {
      throw new BadRequestException(
        'Daily Deals house seller is not configured. Run `npm run seed:house` to seed it.',
      );
    }
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) {
      throw new BadRequestException(
        'Daily Deals house-seller id points at a missing user. Re-run `npm run seed:house`.',
      );
    }
    return user.id;
  }

  // wasPrice > dealPrice > 0, cost ≥ 0. Errors read in domain terms.
  private assertMoney(opts: {
    dealPriceCents: number;
    wasPriceCents: number;
    costPriceCents: number;
  }) {
    const { dealPriceCents, wasPriceCents, costPriceCents } = opts;
    if (!Number.isInteger(dealPriceCents) || dealPriceCents < 1) {
      throw new BadRequestException('Deal price must be at least 1 cent.');
    }
    if (!Number.isInteger(wasPriceCents) || wasPriceCents <= dealPriceCents) {
      throw new BadRequestException(
        'The "was" price must be higher than the deal price.',
      );
    }
    if (!Number.isInteger(costPriceCents) || costPriceCents < 0) {
      throw new BadRequestException('Cost price must be zero or more.');
    }
  }

  // Load a category and reject it if it is licence-controlled. Returns the
  // flags snapshot the listing needs.
  private async loadCategoryOrReject(categoryId: string) {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: {
        id: true,
        name: true,
        isFirearm: true,
        collectionOnly: true,
        requiresPapers: true,
        isExperience: true,
        isActive: true,
      },
    });
    if (!category) throw new BadRequestException('Category not found.');
    if (isLicensedCategory(category)) {
      throw new BadRequestException(
        `Daily Deals can't be created in "${category.name}" — licence-controlled and firearm categories are first-party retail only.`,
      );
    }
    return category;
  }

  // ── Create (→ DRAFT) ──────────────────────────────────────────────
  async create(adminId: string, dto: CreateDealDto) {
    this.assertMoney({
      dealPriceCents: dto.dealPriceCents,
      wasPriceCents: dto.wasPriceCents,
      costPriceCents: dto.costPriceCents,
    });

    const category = await this.loadCategoryOrReject(dto.categoryId);
    const houseSellerId = await this.resolveHouseSellerId();

    // Inventory: a plain BUY_NOW non-firearm listing may carry stock > 1.
    const trackInventory =
      inventoryEligible('BUY_NOW', category.isFirearm, category.isExperience) &&
      dto.initialStock > 1;
    const quantityAvailable = trackInventory
      ? Math.min(Math.floor(dto.initialStock), 9999)
      : 1;
    const initialStock = trackInventory ? quantityAvailable : 1;

    const defaultCap = await this.settings.get(
      FLAGS.dealDefaultPerCustomerCap,
    );
    const perCustomerCap = dto.perCustomerCap ?? defaultCap;

    const shippingMethods =
      dto.shippingMethods && dto.shippingMethods.length > 0
        ? dto.shippingMethods
        : [ShippingMethod.PUDO, ShippingMethod.TCG];

    // Allocate the human ref BEFORE the transaction (same as
    // ListingsService.create) so the row lands with it populated.
    const referenceNumber =
      await this.referenceNumbers.allocateForListing('BUY_NOW');

    const deal = await this.prisma.$transaction(async (tx) => {
      const listing = await tx.listing.create({
        data: {
          referenceNumber,
          sellerId: houseSellerId,
          categoryId: dto.categoryId,
          title: dto.title,
          description: dto.description,
          price: dto.dealPriceCents,
          // Display-only strikethrough anchor. Harmless on a deal listing
          // (never public); the deal chrome reads Deal.wasPriceCents.
          compareAtPriceZarCents: dto.wasPriceCents,
          listingType: 'BUY_NOW',
          // INERT: held at DRAFT so the listing is neither browsable
          // (isDealListing filter) nor reachable via the public PDP
          // (non-owner status gating 404s DRAFT). DD-4 flips this to
          // ACTIVE on go-live.
          status: ListingStatus.DRAFT,
          condition: dto.condition ?? 'NEW',
          province: dto.province,
          // Snapshot the gating flags from the category (like a normal
          // listing) — all false here since licensed categories are
          // rejected above.
          isFirearm: category.isFirearm,
          collectionOnly: category.collectionOnly,
          requiresPapers: category.requiresPapers,
          isExperience: category.isExperience,
          trackInventory,
          quantityAvailable,
          make: dto.make ?? null,
          model: dto.model ?? null,
          calibre: dto.calibre ?? null,
          shippingMethods,
          // Parcel dimensions for the courier rate API — defaulted so a deal
          // is always quotable/shippable even if the admin didn't set them.
          weightGrams: dto.weightGrams ?? 1000,
          lengthCm: dto.lengthCm ?? 20,
          widthCm: dto.widthCm ?? 20,
          heightCm: dto.heightCm ?? 15,
          // The Daily Deals flag — the single cheap key every public
          // listing query filters on.
          isDealListing: true,
        },
      });

      return tx.deal.create({
        data: {
          listingId: listing.id,
          status: DealStatus.DRAFT,
          costPriceCents: dto.costPriceCents,
          wasPriceCents: dto.wasPriceCents,
          startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
          endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
          dropDate: dto.dropDate ? new Date(dto.dropDate) : null,
          heroRank: dto.heroRank ?? 0,
          initialStock,
          perCustomerCap,
          shipsInDaysMin: dto.shipsInDaysMin ?? 3,
          shipsInDaysMax: dto.shipsInDaysMax ?? 7,
          supplierName: dto.supplierName ?? null,
          supplierRef: dto.supplierRef ?? null,
          createdByAdminId: adminId,
        },
        include: { listing: { include: { images: true } } },
      });
    });

    await this.audit.record({
      adminUserId: adminId,
      action: 'DEAL_CREATE',
      resourceType: 'Deal',
      resourceId: deal.id,
      newValue: {
        title: dto.title,
        dealPriceCents: dto.dealPriceCents,
        wasPriceCents: dto.wasPriceCents,
        costPriceCents: dto.costPriceCents,
        initialStock,
        referenceNumber,
      },
      reason: `Created Daily Deal draft: ${dto.title}`,
    });

    return this.shape(deal);
  }

  // ── Update (DRAFT / SCHEDULED only) ───────────────────────────────
  async update(adminId: string, id: string, dto: UpdateDealDto) {
    const deal = await this.prisma.deal.findUnique({
      where: { id },
      include: { listing: true },
    });
    if (!deal) throw new NotFoundException('Deal not found.');
    if (
      deal.status !== DealStatus.DRAFT &&
      deal.status !== DealStatus.SCHEDULED
    ) {
      throw new BadRequestException(
        'Only draft or scheduled deals can be edited. End or cancel it first.',
      );
    }

    // Merge money values (incoming ?? existing) and re-validate.
    const dealPriceCents = dto.dealPriceCents ?? deal.listing.price ?? 0;
    const wasPriceCents = dto.wasPriceCents ?? deal.wasPriceCents;
    const costPriceCents = dto.costPriceCents ?? deal.costPriceCents;
    this.assertMoney({ dealPriceCents, wasPriceCents, costPriceCents });

    // If the category changed, re-snapshot + re-reject licensed.
    let categorySnapshot: {
      isFirearm: boolean;
      collectionOnly: boolean;
      requiresPapers: boolean;
      isExperience: boolean;
    } | null = null;
    if (dto.categoryId && dto.categoryId !== deal.listing.categoryId) {
      categorySnapshot = await this.loadCategoryOrReject(dto.categoryId);
    }

    // Stock edit re-derives inventory tracking.
    const nextStock = dto.initialStock ?? deal.initialStock;
    const isFirearm = categorySnapshot?.isFirearm ?? deal.listing.isFirearm;
    const isExperience =
      categorySnapshot?.isExperience ?? deal.listing.isExperience;
    const trackInventory =
      inventoryEligible('BUY_NOW', isFirearm, isExperience) && nextStock > 1;
    const quantityAvailable = trackInventory
      ? Math.min(Math.floor(nextStock), 9999)
      : 1;
    const initialStock = trackInventory ? quantityAvailable : 1;

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.listing.update({
        where: { id: deal.listingId },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description }
            : {}),
          ...(dto.categoryId !== undefined
            ? { categoryId: dto.categoryId }
            : {}),
          ...(dto.condition !== undefined ? { condition: dto.condition } : {}),
          ...(dto.province !== undefined ? { province: dto.province } : {}),
          ...(dto.make !== undefined ? { make: dto.make } : {}),
          ...(dto.model !== undefined ? { model: dto.model } : {}),
          ...(dto.calibre !== undefined ? { calibre: dto.calibre } : {}),
          ...(dto.shippingMethods !== undefined
            ? { shippingMethods: dto.shippingMethods }
            : {}),
          ...(dto.weightGrams !== undefined ? { weightGrams: dto.weightGrams } : {}),
          ...(dto.lengthCm !== undefined ? { lengthCm: dto.lengthCm } : {}),
          ...(dto.widthCm !== undefined ? { widthCm: dto.widthCm } : {}),
          ...(dto.heightCm !== undefined ? { heightCm: dto.heightCm } : {}),
          ...(dto.dealPriceCents !== undefined
            ? { price: dto.dealPriceCents }
            : {}),
          ...(dto.wasPriceCents !== undefined
            ? { compareAtPriceZarCents: dto.wasPriceCents }
            : {}),
          ...(categorySnapshot
            ? {
                isFirearm: categorySnapshot.isFirearm,
                collectionOnly: categorySnapshot.collectionOnly,
                requiresPapers: categorySnapshot.requiresPapers,
                isExperience: categorySnapshot.isExperience,
              }
            : {}),
          trackInventory,
          quantityAvailable,
          // Never let a maintenance edit accidentally clear the flag.
          isDealListing: true,
        },
      });

      return tx.deal.update({
        where: { id },
        data: {
          ...(dto.wasPriceCents !== undefined
            ? { wasPriceCents: dto.wasPriceCents }
            : {}),
          ...(dto.costPriceCents !== undefined
            ? { costPriceCents: dto.costPriceCents }
            : {}),
          ...(dto.perCustomerCap !== undefined
            ? { perCustomerCap: dto.perCustomerCap }
            : {}),
          ...(dto.shipsInDaysMin !== undefined
            ? { shipsInDaysMin: dto.shipsInDaysMin }
            : {}),
          ...(dto.shipsInDaysMax !== undefined
            ? { shipsInDaysMax: dto.shipsInDaysMax }
            : {}),
          ...(dto.heroRank !== undefined ? { heroRank: dto.heroRank } : {}),
          ...(dto.supplierName !== undefined
            ? { supplierName: dto.supplierName }
            : {}),
          ...(dto.supplierRef !== undefined
            ? { supplierRef: dto.supplierRef }
            : {}),
          ...(dto.dropDate !== undefined
            ? { dropDate: dto.dropDate ? new Date(dto.dropDate) : null }
            : {}),
          initialStock,
        },
        include: { listing: { include: { images: true } } },
      });
    });

    await this.audit.record({
      adminUserId: adminId,
      action: 'DEAL_UPDATE',
      resourceType: 'Deal',
      resourceId: id,
      newValue: dto as unknown,
      reason: `Edited Daily Deal: ${updated.listing.title}`,
    });

    return this.shape(updated);
  }

  // ── Pipeline list ─────────────────────────────────────────────────
  async list(status?: string) {
    const statusFilter =
      status && Object.values(DealStatus).includes(status as DealStatus)
        ? (status as DealStatus)
        : undefined;
    const deals = await this.prisma.deal.findMany({
      where: statusFilter ? { status: statusFilter } : {},
      orderBy: [{ createdAt: 'desc' }],
      include: { listing: { include: { images: { orderBy: { order: 'asc' } } } } },
    });
    return deals.map((d) => this.shape(d));
  }

  async findOne(id: string) {
    const deal = await this.prisma.deal.findUnique({
      where: { id },
      include: { listing: { include: { images: { orderBy: { order: 'asc' } } } } },
    });
    if (!deal) throw new NotFoundException('Deal not found.');
    return this.shape(deal);
  }

  // ── Lifecycle transitions (INERT — status bookkeeping only) ───────
  async schedule(adminId: string, id: string, dto: ScheduleDealDto) {
    const deal = await this.requireStatus(id, [DealStatus.DRAFT]);
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt) {
      throw new BadRequestException('End time must be after the start time.');
    }
    const updated = await this.prisma.deal.update({
      where: { id },
      data: { status: DealStatus.SCHEDULED, startsAt, endsAt },
      include: { listing: { include: { images: true } } },
    });
    await this.recordTransition(adminId, id, deal.status, DealStatus.SCHEDULED, dto.reason);
    return this.shape(updated);
  }

  async goLive(adminId: string, id: string, reason?: string) {
    const deal = await this.requireStatus(id, [
      DealStatus.DRAFT,
      DealStatus.SCHEDULED,
    ]);
    // DD-2 — dealsEnabled is the master "arm the money path" killswitch. A deal
    // only becomes BUYABLE (its Listing flips DRAFT → ACTIVE) once the operator
    // turns Daily Deals ON in Settings, so nothing can be sold before the
    // storefront + operator sign-offs are ready. Deals can still be drafted /
    // scheduled while the switch is off; only go-live is gated.
    const enabled = await this.settings.get(FLAGS.dealsEnabled);
    if (!enabled) {
      throw new BadRequestException(
        'Daily Deals is turned off. Enable it in Settings before taking a deal live.',
      );
    }
    // Re-snapshot the go-live stock baseline (the sell-through denominator).
    const initialStock = deal.listing.trackInventory
      ? deal.listing.quantityAvailable
      : 1;
    const updated = await this.prisma.$transaction(async (tx) => {
      // Make the deal listing PURCHASABLE: DRAFT → ACTIVE. It stays
      // isDealListing:true, so it remains excluded from every public discovery
      // surface (browse / search / comps / wanted / saved-searches) — only
      // reachable via the /deals storefront (DD-3) + the direct PDP.
      await tx.listing.update({
        where: { id: deal.listingId },
        data: {
          status: ListingStatus.ACTIVE,
          isDealListing: true,
          listedAt: new Date(),
        },
      });
      return tx.deal.update({
        where: { id },
        data: {
          status: DealStatus.LIVE,
          liveAt: new Date(),
          initialStock,
        },
        include: { listing: { include: { images: true } } },
      });
    });
    await this.recordTransition(adminId, id, deal.status, DealStatus.LIVE, reason);
    return this.shape(updated);
  }

  async extend(adminId: string, id: string, dto: ExtendDealDto) {
    const deal = await this.requireStatus(id, [
      DealStatus.LIVE,
      DealStatus.ENDED,
    ]);
    const extendedUntil = new Date(dto.extendedUntil);
    const updated = await this.prisma.$transaction(async (tx) => {
      // Extra Time makes the deal buyable again: if it had ENDED (listing
      // EXPIRED), re-activate it. From LIVE it's already ACTIVE (no-op).
      // Never resurrect a SOLD/CANCELLED listing.
      await tx.listing.updateMany({
        where: {
          id: deal.listingId,
          status: ListingStatus.EXPIRED,
        },
        data: { status: ListingStatus.ACTIVE },
      });
      return tx.deal.update({
        where: { id },
        data: { status: DealStatus.EXTENDED, extendedUntil },
        include: { listing: { include: { images: true } } },
      });
    });
    await this.recordTransition(adminId, id, deal.status, DealStatus.EXTENDED, dto.reason);
    return this.shape(updated);
  }

  async end(adminId: string, id: string, reason?: string) {
    const deal = await this.requireStatus(id, [
      DealStatus.LIVE,
      DealStatus.EXTENDED,
    ]);
    const updated = await this.prisma.$transaction(async (tx) => {
      // End = no longer buyable. Flip the listing ACTIVE/PENDING → EXPIRED so
      // the checkout ACTIVE-gate rejects new purchases (the PDP still renders
      // it as an ended deal). Never resurrect a SOLD/CANCELLED listing.
      await tx.listing.updateMany({
        where: {
          id: deal.listingId,
          status: { notIn: [ListingStatus.SOLD, ListingStatus.CANCELLED] },
        },
        data: { status: ListingStatus.EXPIRED },
      });
      return tx.deal.update({
        where: { id },
        data: { status: DealStatus.ENDED, endedAt: new Date() },
        include: { listing: { include: { images: true } } },
      });
    });
    await this.recordTransition(adminId, id, deal.status, DealStatus.ENDED, reason);
    return this.shape(updated);
  }

  async cancel(adminId: string, id: string, reason?: string) {
    const deal = await this.prisma.deal.findUnique({
      where: { id },
      include: { listing: true },
    });
    if (!deal) throw new NotFoundException('Deal not found.');
    if (deal.status === DealStatus.CANCELLED) {
      throw new BadRequestException('Deal is already cancelled.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.listing.update({
        where: { id: deal.listingId },
        data: { status: ListingStatus.CANCELLED },
      });
      return tx.deal.update({
        where: { id },
        data: { status: DealStatus.CANCELLED },
        include: { listing: { include: { images: true } } },
      });
    });
    await this.recordTransition(adminId, id, deal.status, DealStatus.CANCELLED, reason);
    return this.shape(updated);
  }

  // Duplicate a deal into a fresh DRAFT ("run it again"). Copies the
  // product + deal fields; photos are NOT copied (admin re-uploads) so two
  // deals never share a Cloudinary asset that a delete on one would
  // destroy on the other.
  async duplicate(adminId: string, id: string, reason?: string) {
    const source = await this.prisma.deal.findUnique({
      where: { id },
      include: { listing: true },
    });
    if (!source) throw new NotFoundException('Deal not found.');

    const clone = await this.create(adminId, {
      title: source.listing.title,
      categoryId: source.listing.categoryId,
      description: source.listing.description,
      condition: source.listing.condition,
      province: source.listing.province,
      make: source.listing.make ?? undefined,
      model: source.listing.model ?? undefined,
      calibre: source.listing.calibre ?? undefined,
      shippingMethods: source.listing.shippingMethods,
      dealPriceCents: source.listing.price ?? 0,
      wasPriceCents: source.wasPriceCents,
      costPriceCents: source.costPriceCents,
      initialStock: source.initialStock,
      perCustomerCap: source.perCustomerCap,
      shipsInDaysMin: source.shipsInDaysMin,
      shipsInDaysMax: source.shipsInDaysMax,
      heroRank: source.heroRank,
      supplierName: source.supplierName ?? undefined,
      supplierRef: source.supplierRef ?? undefined,
    });

    await this.audit.record({
      adminUserId: adminId,
      action: 'DEAL_DUPLICATE',
      resourceType: 'Deal',
      resourceId: clone.id,
      oldValue: { sourceDealId: id },
      reason: reason?.trim() || `Duplicated Daily Deal from ${id}`,
    });
    return clone;
  }

  // Hard-delete a DRAFT or CANCELLED deal + its listing (cascade removes
  // the Deal row + ListingImage rows). Cloudinary assets are destroyed
  // first so we don't orphan them.
  async remove(adminId: string, id: string, reason?: string) {
    const deal = await this.prisma.deal.findUnique({
      where: { id },
      include: { listing: { include: { images: true } } },
    });
    if (!deal) throw new NotFoundException('Deal not found.');
    if (
      deal.status !== DealStatus.DRAFT &&
      deal.status !== DealStatus.CANCELLED
    ) {
      throw new BadRequestException(
        'Only draft or cancelled deals can be deleted. End the deal first.',
      );
    }

    // Record BEFORE the delete so the audit row survives.
    await this.audit.record({
      adminUserId: adminId,
      action: 'DEAL_DELETE',
      resourceType: 'Deal',
      resourceId: id,
      oldValue: {
        title: deal.listing.title,
        referenceNumber: deal.listing.referenceNumber,
      },
      reason: reason?.trim() || `Deleted Daily Deal draft: ${deal.listing.title}`,
    });

    const publicIds = deal.listing.images.map((i) => i.publicId).filter(Boolean);
    if (publicIds.length > 0) {
      await this.cloudinary.deleteImages(publicIds).catch((e) => {
        // Non-fatal — a stuck Cloudinary shouldn't block the DB delete.
        this.logger.warn(
          `Cloudinary cleanup failed for deal ${id}: ${(e as Error).message}`,
        );
      });
    }
    // Deleting the listing cascades the Deal + ListingImage rows.
    await this.prisma.listing.delete({ where: { id: deal.listingId } });
    return { ok: true };
  }

  // ── Photos ────────────────────────────────────────────────────────
  async addImage(adminId: string, id: string, file: Express.Multer.File) {
    const deal = await this.prisma.deal.findUnique({
      where: { id },
      select: { listingId: true },
    });
    if (!deal) throw new NotFoundException('Deal not found.');

    const imageCount = await this.prisma.listingImage.count({
      where: { listingId: deal.listingId },
    });
    if (imageCount >= 10) {
      throw new BadRequestException('Maximum 10 images per deal.');
    }

    const { url, publicId } = await this.cloudinary.uploadImage(
      file.buffer,
      'deals',
    );
    const image = await this.prisma.listingImage.create({
      data: {
        listingId: deal.listingId,
        url,
        publicId,
        order: imageCount,
        isPrimary: imageCount === 0,
      },
    });
    await this.audit.record({
      adminUserId: adminId,
      action: 'DEAL_IMAGE_ADD',
      resourceType: 'Deal',
      resourceId: id,
      newValue: { imageId: image.id },
      reason: 'Added a Daily Deal photo.',
    });
    return image;
  }

  async removeImage(adminId: string, id: string, imageId: string) {
    const deal = await this.prisma.deal.findUnique({
      where: { id },
      select: { listingId: true },
    });
    if (!deal) throw new NotFoundException('Deal not found.');

    const image = await this.prisma.listingImage.findFirst({
      where: { id: imageId, listingId: deal.listingId },
    });
    if (!image) throw new NotFoundException('Image not found.');

    if (image.publicId) {
      await this.cloudinary.deleteImage(image.publicId).catch(() => null);
    }
    await this.prisma.listingImage.delete({ where: { id: imageId } });

    // Keep exactly one primary + contiguous order after a removal.
    const remaining = await this.prisma.listingImage.findMany({
      where: { listingId: deal.listingId },
      orderBy: { order: 'asc' },
    });
    await this.prisma.$transaction(
      remaining.map((img, idx) =>
        this.prisma.listingImage.update({
          where: { id: img.id },
          data: { order: idx, isPrimary: idx === 0 },
        }),
      ),
    );
    await this.audit.record({
      adminUserId: adminId,
      action: 'DEAL_IMAGE_REMOVE',
      resourceType: 'Deal',
      resourceId: id,
      oldValue: { imageId },
      reason: 'Removed a Daily Deal photo.',
    });
    return { ok: true };
  }

  // ── Helpers ───────────────────────────────────────────────────────
  private async requireStatus(id: string, allowed: DealStatus[]) {
    const deal = await this.prisma.deal.findUnique({
      where: { id },
      include: { listing: true },
    });
    if (!deal) throw new NotFoundException('Deal not found.');
    if (!allowed.includes(deal.status)) {
      throw new BadRequestException(
        `This action isn't allowed while the deal is ${deal.status}.`,
      );
    }
    return deal;
  }

  private async recordTransition(
    adminId: string,
    id: string,
    from: DealStatus,
    to: DealStatus,
    reason?: string,
  ) {
    await this.audit.record({
      adminUserId: adminId,
      action: 'DEAL_STATUS_CHANGE',
      resourceType: 'Deal',
      resourceId: id,
      oldValue: { status: from },
      newValue: { status: to },
      reason: reason?.trim() || `Daily Deal ${from} → ${to}`,
    });
  }

  // Shape a deal + its listing into the admin-facing card the pipeline
  // list and builder consume: money in cents + derived margin/save/
  // sell-through metrics. `soldUnits` is 0 in DD-1 (no money path yet).
  private shape(deal: {
    id: string;
    status: DealStatus;
    costPriceCents: number;
    wasPriceCents: number;
    startsAt: Date | null;
    endsAt: Date | null;
    extendedUntil: Date | null;
    dropDate: Date | null;
    liveAt: Date | null;
    endedAt: Date | null;
    soldOutAt: Date | null;
    heroRank: number;
    initialStock: number;
    perCustomerCap: number;
    shipsInDaysMin: number;
    shipsInDaysMax: number;
    supplierName: string | null;
    supplierRef: string | null;
    createdByAdminId: string;
    createdAt: Date;
    updatedAt: Date;
    listing: {
      id: string;
      referenceNumber: string | null;
      title: string;
      description: string;
      price: number | null;
      categoryId: string;
      condition: string;
      province: string;
      make: string | null;
      model: string | null;
      calibre: string | null;
      shippingMethods: string[];
      weightGrams: number | null;
      lengthCm: number | null;
      widthCm: number | null;
      heightCm: number | null;
      trackInventory: boolean;
      quantityAvailable: number;
      status: string;
      images?: { id: string; url: string; order: number; isPrimary: boolean }[];
    };
  }) {
    const dealPriceCents = deal.listing.price ?? 0;
    // Sold-units: a stock-tracked deal decrements quantityAvailable per sale;
    // a single-item (non-tracked) deal signals its one sale by flipping the
    // listing to SOLD (quantityAvailable stays 1), so derive from status there
    // — otherwise a sold single-item deal would report 0 sold / R0 revenue.
    const soldUnits = deal.listing.trackInventory
      ? Math.max(0, deal.initialStock - deal.listing.quantityAvailable)
      : deal.listing.status === 'SOLD'
        ? deal.initialStock
        : 0;
    const marginPct =
      dealPriceCents > 0
        ? Math.round(((dealPriceCents - deal.costPriceCents) / dealPriceCents) * 100)
        : 0;
    const savePct =
      deal.wasPriceCents > 0
        ? Math.round(((deal.wasPriceCents - dealPriceCents) / deal.wasPriceCents) * 100)
        : 0;
    return {
      id: deal.id,
      status: deal.status,
      listingId: deal.listing.id,
      referenceNumber: deal.listing.referenceNumber,
      title: deal.listing.title,
      description: deal.listing.description,
      categoryId: deal.listing.categoryId,
      condition: deal.listing.condition,
      province: deal.listing.province,
      make: deal.listing.make,
      model: deal.listing.model,
      calibre: deal.listing.calibre,
      shippingMethods: deal.listing.shippingMethods,
      weightGrams: deal.listing.weightGrams,
      lengthCm: deal.listing.lengthCm,
      widthCm: deal.listing.widthCm,
      heightCm: deal.listing.heightCm,
      listingStatus: deal.listing.status,
      images: deal.listing.images ?? [],
      // Money (cents)
      dealPriceCents,
      wasPriceCents: deal.wasPriceCents,
      costPriceCents: deal.costPriceCents,
      // Derived metrics
      marginPct,
      savePct,
      initialStock: deal.initialStock,
      quantityAvailable: deal.listing.quantityAvailable,
      soldUnits,
      revenueCents: soldUnits * dealPriceCents,
      sellThroughPct:
        deal.initialStock > 0
          ? Math.round((soldUnits / deal.initialStock) * 100)
          : 0,
      perCustomerCap: deal.perCustomerCap,
      shipsInDaysMin: deal.shipsInDaysMin,
      shipsInDaysMax: deal.shipsInDaysMax,
      heroRank: deal.heroRank,
      supplierName: deal.supplierName,
      supplierRef: deal.supplierRef,
      // Schedule
      startsAt: deal.startsAt,
      endsAt: deal.endsAt,
      extendedUntil: deal.extendedUntil,
      dropDate: deal.dropDate,
      liveAt: deal.liveAt,
      endedAt: deal.endedAt,
      soldOutAt: deal.soldOutAt,
      createdAt: deal.createdAt,
      updatedAt: deal.updatedAt,
    };
  }
}
