import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DealStatus,
  ListingStatus,
  ShippingMethod,
  PaymentStatus,
} from '@prisma/client';
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

  // ─── DD-5 — Daily Deals P&L (admin) ─────────────────────────────────
  // Financial performance of the first-party programme. ADMIN-ONLY (exposes
  // cost + margin). Revenue/units are measured from the Transaction table (the
  // money source of truth), NOT stock depletion: a sale counts only when it is
  // paid and not refunded / cancelled / rejected (the SAME filter as the DD-2
  // per-customer cap), partial refunds (refundedAmount on a still-kept item)
  // are netted off revenue, and COGS = costPrice × units. Only deals that
  // actually went live (liveAt set) enter the P&L; an optional [from,to]
  // window filters by liveAt (the drop date).
  async pnlReport(opts?: { from?: Date; to?: Date }) {
    const windowed = !!(opts?.from || opts?.to);
    const deals = await this.prisma.deal.findMany({
      where: {
        liveAt: windowed ? { gte: opts?.from, lte: opts?.to } : { not: null },
      },
      select: {
        id: true,
        status: true,
        costPriceCents: true,
        wasPriceCents: true,
        initialStock: true,
        dropDate: true,
        liveAt: true,
        listingId: true,
        listing: { select: { title: true, price: true } },
      },
    });
    if (deals.length === 0) {
      return { totals: this.emptyPnlTotals(), deals: [] };
    }

    // One grouped aggregate over the COUNTED (paid, not refunded/cancelled/
    // rejected) sales across all the deal listings.
    const grouped = await this.prisma.transaction.groupBy({
      by: ['listingId'],
      where: {
        listingId: { in: deals.map((d) => d.listingId) },
        paidAt: { not: null },
        refundOfId: null, // exclude synthetic refund children
        paymentStatus: { not: PaymentStatus.REFUNDED }, // exclude fully-refunded
        rejectedAt: null,
        cancelledByBuyerAt: null,
        manualCancelledAt: null,
      },
      _sum: { quantity: true, listingPrice: true, refundedAmount: true },
    });
    const byListing = new Map(grouped.map((g) => [g.listingId, g._sum]));

    const rows = deals.map((d) => {
      const s = byListing.get(d.listingId);
      const unitsSold = s?.quantity ?? 0;
      // listingPrice is already the line total (unit price × quantity) and is
      // PRODUCT-only (shipping / handling / fees live in separate columns).
      const grossSalesCents = s?.listingPrice ?? 0;
      const refundsCents = s?.refundedAmount ?? 0;
      const cogsCents = d.costPriceCents * unitsSold;
      // Product margin is refund-INDEPENDENT. refundedAmount is measured against
      // buyerTotal (product + shipping + fees), so netting it into a product-only
      // gross would wrongly charge a shipping / goodwill refund to product margin
      // — it can even show a profitable, kept sale as a loss. Refunds are reported
      // as their own line (cash returned to buyers), NOT deducted from margin.
      const grossProfitCents = grossSalesCents - cogsCents;
      const grossMarginPct =
        grossSalesCents > 0
          ? Math.round((grossProfitCents / grossSalesCents) * 100)
          : 0;
      const sellThroughPct =
        d.initialStock > 0
          ? Math.round((unitsSold / d.initialStock) * 100)
          : 0;
      return {
        id: d.id,
        title: d.listing.title,
        status: d.status,
        dropDate: d.dropDate,
        liveAt: d.liveAt,
        costPriceCents: d.costPriceCents,
        dealPriceCents: d.listing.price ?? 0,
        wasPriceCents: d.wasPriceCents,
        initialStock: d.initialStock,
        unitsSold,
        sellThroughPct,
        grossSalesCents,
        refundsCents,
        cogsCents,
        grossProfitCents,
        grossMarginPct,
      };
    });
    // Best performers first (by gross profit).
    rows.sort((a, b) => b.grossProfitCents - a.grossProfitCents);

    const agg = rows.reduce(
      (acc, r) => {
        acc.unitsSold += r.unitsSold;
        acc.grossSalesCents += r.grossSalesCents;
        acc.refundsCents += r.refundsCents;
        acc.cogsCents += r.cogsCents;
        acc.grossProfitCents += r.grossProfitCents;
        return acc;
      },
      {
        unitsSold: 0,
        grossSalesCents: 0,
        refundsCents: 0,
        cogsCents: 0,
        grossProfitCents: 0,
      },
    );
    // Sell-through as a POOLED, stock-weighted ratio (Σ units ÷ Σ go-live
    // stock) — matches "units sold ÷ go-live stock" and stops one tiny
    // sold-out deal skewing the headline the way an unweighted mean would.
    const withStock = rows.filter((r) => r.initialStock > 0);
    const stockDenom = withStock.reduce((s, r) => s + r.initialStock, 0);
    const stockUnits = withStock.reduce((s, r) => s + r.unitsSold, 0);
    const avgSellThroughPct =
      stockDenom > 0 ? Math.round((stockUnits / stockDenom) * 100) : 0;
    const totals = {
      dealsRun: rows.length,
      dealsLive: rows.filter(
        (r) => r.status === DealStatus.LIVE || r.status === DealStatus.EXTENDED,
      ).length,
      unitsSold: agg.unitsSold,
      grossSalesCents: agg.grossSalesCents,
      refundsCents: agg.refundsCents,
      cogsCents: agg.cogsCents,
      grossProfitCents: agg.grossProfitCents,
      grossMarginPct:
        agg.grossSalesCents > 0
          ? Math.round((agg.grossProfitCents / agg.grossSalesCents) * 100)
          : 0,
      avgSellThroughPct,
    };
    return { totals, deals: rows };
  }

  private emptyPnlTotals() {
    return {
      dealsRun: 0,
      dealsLive: 0,
      unitsSold: 0,
      grossSalesCents: 0,
      refundsCents: 0,
      cogsCents: 0,
      grossProfitCents: 0,
      grossMarginPct: 0,
      avgSellThroughPct: 0,
    };
  }

  // ─── Public storefront read path (DD-3) ──────────────────────────────
  // The ONLY buyer-facing surface. Everything here is gated on the
  // FLAGS.dealsEnabled master killswitch (the same read goLive uses), so the
  // /deals storefront + deal PDP ship INERT — with the switch off the API
  // returns `{enabled:false, deals:[]}` / 404 and nothing leaks. publicShape()
  // STRIPS the six internal fields the admin card carries (cost, margin,
  // revenue, sell-through, supplier) — buyers must NEVER see our cost/margin —
  // and surfaces the seller by username only (house rule). Deal listings are
  // swept out of every normal discovery query (isDealListing), so this reads
  // the Deal table directly rather than the browse rails.

  private static readonly PUBLIC_INCLUDE = {
    listing: {
      include: {
        images: { orderBy: { order: 'asc' as const } },
        seller: { select: { clerkId: true, username: true } },
        category: { select: { name: true, slug: true } },
      },
    },
  };

  // Buyable = Listing ACTIVE + a LIVE/EXTENDED deal. The storefront grid shows
  // only these. The PDP additionally renders ENDED / SOLD_OUT deals (clearly
  // labelled) so a shared or bookmarked deal link doesn't just 404 the instant
  // the deal closes.
  private static readonly PUBLIC_STOREFRONT_STATUSES: DealStatus[] = [
    DealStatus.LIVE,
    DealStatus.EXTENDED,
  ];
  private static readonly PUBLIC_PDP_STATUSES: DealStatus[] = [
    DealStatus.LIVE,
    DealStatus.EXTENDED,
    DealStatus.ENDED,
    DealStatus.SOLD_OUT,
  ];

  async listLivePublic() {
    const enabled = await this.settings.get(FLAGS.dealsEnabled);
    if (!enabled) return { enabled: false, deals: [] };
    const deals = await this.prisma.deal.findMany({
      where: {
        status: { in: DealsService.PUBLIC_STOREFRONT_STATUSES },
        // Belt-and-braces: only a deal whose Listing is genuinely ACTIVE is
        // buyable, so never surface one whose listing has moved on (SOLD /
        // EXPIRED / CANCELLED) even if the Deal.status lags.
        listing: { status: ListingStatus.ACTIVE },
      },
      orderBy: [{ heroRank: 'asc' }, { liveAt: 'desc' }, { createdAt: 'desc' }],
      include: DealsService.PUBLIC_INCLUDE,
    });
    return { enabled: true, deals: deals.map((d) => this.publicShape(d)) };
  }

  // Resolve by deal id, listing id, OR listing referenceNumber — the storefront
  // links by deal id; the /listings/:id → /deals redirect (DD-3) hands us a
  // listing id; a shared reference code resolves too. Fails closed when the
  // switch is off or the deal isn't in a publicly-renderable status.
  async findOnePublic(idOrRef: string) {
    const enabled = await this.settings.get(FLAGS.dealsEnabled);
    if (!enabled) throw new NotFoundException('Deal not found.');
    const deal = await this.prisma.deal.findFirst({
      where: {
        status: { in: DealsService.PUBLIC_PDP_STATUSES },
        OR: [
          { id: idOrRef },
          { listingId: idOrRef },
          { listing: { referenceNumber: idOrRef } },
        ],
      },
      include: DealsService.PUBLIC_INCLUDE,
    });
    if (!deal) throw new NotFoundException('Deal not found.');
    return this.publicShape(deal);
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

  // ─── DD-4 — scheduled drop automation (cron-driven) ─────────────────
  // Called every minute by TasksService. Automates the OneDayOnly lifecycle:
  //   • auto go-live SCHEDULED deals when their startsAt arrives (gated on
  //     the dealsEnabled killswitch, so nothing goes live while off),
  //   • auto-END LIVE deals at endsAt and EXTENDED deals at extendedUntil —
  //     this is the hard time-gate that closes the DD-3 "buyable past the
  //     advertised end" gap (the buy path only checks Listing ACTIVE),
  //   • "Extra Time": a LIVE deal that reaches endsAt with stock left is
  //     extended once (LIVE → EXTENDED) when deal_extra_time_hours > 0,
  //   • KILLSWITCH ENFORCEMENT: while dealsEnabled is OFF, end any lingering
  //     LIVE/EXTENDED deal so the flag is a true killswitch (this supersedes
  //     the DD-3 operator caution — no more "end deals before flipping off").
  // These transitions mirror the admin goLive/end/extend cores but write NO
  // admin-audit event (the actor is the system, not an AdminUser — the Deal's
  // own liveAt/endedAt/extendedUntil timestamps are the record). Each deal is
  // isolated in its own try/catch so one bad row can't abort the sweep. Push
  // announcements are fired by TasksService from the returned `dropped` list.
  async runScheduledDrops(): Promise<{
    dropped: { id: string; title: string; dealPriceCents: number; savePct: number }[];
    ended: number;
    extended: number;
  }> {
    const now = new Date();
    const dropped: { id: string; title: string; dealPriceCents: number; savePct: number }[] = [];
    let ended = 0;
    let extended = 0;

    const enabled = await this.settings.get(FLAGS.dealsEnabled);

    // Killswitch OFF → nothing may be buyable. End every live/extended deal
    // and go nothing live. (Resolves the DD-3 flag-off-while-live dead-end.)
    if (!enabled) {
      const live = await this.prisma.deal.findMany({
        where: { status: { in: [DealStatus.LIVE, DealStatus.EXTENDED] } },
        select: { id: true, listingId: true },
      });
      for (const d of live) {
        try {
          await this._endSystem(d.id, d.listingId);
          ended += 1;
        } catch (err) {
          this.logger.warn(
            `drop-cron: killswitch end of deal ${d.id} failed: ${(err as Error).message}`,
          );
        }
      }
      if (ended > 0) {
        this.logger.log(`drop-cron: killswitch ended ${ended} live deal(s)`);
      }
      return { dropped, ended, extended };
    }

    // 1. Auto go-live: SCHEDULED deals whose start time has arrived.
    const toGoLive = await this.prisma.deal.findMany({
      where: { status: DealStatus.SCHEDULED, startsAt: { not: null, lte: now } },
      select: {
        id: true,
        listingId: true,
        wasPriceCents: true,
        endsAt: true,
        listing: {
          select: {
            trackInventory: true,
            quantityAvailable: true,
            title: true,
            price: true,
          },
        },
      },
    });
    for (const d of toGoLive) {
      try {
        const wentLive = await this._goLiveSystem(d);
        if (!wentLive) continue; // raced (cancelled/sold under us) — don't announce
        // Don't announce a deal whose whole [startsAt, endsAt] window already
        // elapsed (e.g. the cron missed ticks over a deploy, or a sub-minute
        // window): it will be auto-ended in the pass below in THIS same run,
        // so a "New Daily Deal" push would deep-link to a dead/ended PDP.
        if (d.endsAt && d.endsAt <= now) continue;
        const dealPriceCents = d.listing.price ?? 0;
        const savePct =
          d.wasPriceCents > 0
            ? Math.round(((d.wasPriceCents - dealPriceCents) / d.wasPriceCents) * 100)
            : 0;
        dropped.push({ id: d.id, title: d.listing.title, dealPriceCents, savePct });
      } catch (err) {
        this.logger.warn(
          `drop-cron: go-live of deal ${d.id} failed: ${(err as Error).message}`,
        );
      }
    }

    // 2. Auto-end / Extra Time.
    const extraHours = await this.settings.get(FLAGS.dealExtraTimeHours);
    // 2a. LIVE deals past their scheduled end.
    const liveExpired = await this.prisma.deal.findMany({
      where: { status: DealStatus.LIVE, endsAt: { not: null, lte: now } },
      select: {
        id: true,
        listingId: true,
        listing: {
          select: { status: true, trackInventory: true, quantityAvailable: true },
        },
      },
    });
    for (const d of liveExpired) {
      try {
        const listingActive = d.listing.status === ListingStatus.ACTIVE;
        const hasStock = d.listing.trackInventory
          ? d.listing.quantityAvailable > 0
          : listingActive; // single-item: still ACTIVE = still available
        if (extraHours > 0 && listingActive && hasStock) {
          // Extra Time — extend ONCE into a bounded EXTENDED window.
          const extendedUntil = new Date(now.getTime() + extraHours * 3600_000);
          await this._extraTimeSystem(d.id, d.listingId, extendedUntil);
          extended += 1;
        } else {
          await this._endSystem(d.id, d.listingId);
          ended += 1;
        }
      } catch (err) {
        this.logger.warn(
          `drop-cron: end/extend of deal ${d.id} failed: ${(err as Error).message}`,
        );
      }
    }
    // 2b. EXTENDED deals (Extra Time or admin-extended) past extendedUntil.
    const extendedExpired = await this.prisma.deal.findMany({
      where: { status: DealStatus.EXTENDED, extendedUntil: { not: null, lte: now } },
      select: { id: true, listingId: true },
    });
    for (const d of extendedExpired) {
      try {
        await this._endSystem(d.id, d.listingId);
        ended += 1;
      } catch (err) {
        this.logger.warn(
          `drop-cron: end of extended deal ${d.id} failed: ${(err as Error).message}`,
        );
      }
    }

    if (dropped.length || ended || extended) {
      this.logger.log(
        `drop-cron: ${dropped.length} went live, ${ended} ended, ${extended} extended`,
      );
    }
    return { dropped, ended, extended };
  }

  // System go-live core — mirrors goLive()'s $transaction but is actor-less
  // (no admin-audit). Flips the listing DRAFT→ACTIVE (still isDealListing, so
  // still off every public discovery surface) and the Deal→LIVE, re-snapshot-
  // ing the go-live stock baseline exactly as the admin path does.
  private async _goLiveSystem(deal: {
    id: string;
    listingId: string;
    listing: { trackInventory: boolean; quantityAvailable: number };
  }): Promise<boolean> {
    const initialStock = deal.listing.trackInventory
      ? deal.listing.quantityAvailable
      : 1;
    // COMPARE-AND-SET (mirrors the guarded _endSystem / _extraTimeSystem):
    // only take a deal live from its exact expected state — a SCHEDULED deal
    // whose listing is still DRAFT. If either moved on under us between the
    // batch read and this write — a racing admin cancel() (→CANCELLED), or an
    // overlapping cron pass that already sold/ended it — the updateMany matches
    // nothing and we ABORT without blind-writing a CANCELLED/SOLD listing back
    // to ACTIVE. (The admin goLive() is shielded by requireStatus + being
    // human-paced; the cron replaces that shield with this CAS.) Returns
    // whether the deal actually went live, so the caller only pushes real drops.
    return this.prisma
      .$transaction(async (tx) => {
        const listingRes = await tx.listing.updateMany({
          where: { id: deal.listingId, status: ListingStatus.DRAFT },
          data: {
            status: ListingStatus.ACTIVE,
            isDealListing: true,
            listedAt: new Date(),
          },
        });
        if (listingRes.count === 0) return false; // listing no longer DRAFT
        const dealRes = await tx.deal.updateMany({
          where: { id: deal.id, status: DealStatus.SCHEDULED },
          data: { status: DealStatus.LIVE, liveAt: new Date(), initialStock },
        });
        if (dealRes.count === 0) {
          // Deal moved on after the listing flip — roll the whole tx back.
          throw new Error('deal no longer SCHEDULED at go-live');
        }
        return true;
      })
      .catch((err) => {
        this.logger.warn(
          `drop-cron: go-live CAS for deal ${deal.id} aborted: ${(err as Error).message}`,
        );
        return false;
      });
  }

  // System end core — mirrors end()'s $transaction. Flips the listing to
  // EXPIRED (never resurrecting a SOLD/CANCELLED one) so the checkout ACTIVE-
  // gate rejects new purchases, and the Deal→ENDED.
  private async _endSystem(dealId: string, listingId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.listing.updateMany({
        where: {
          id: listingId,
          status: { notIn: [ListingStatus.SOLD, ListingStatus.CANCELLED] },
        },
        data: { status: ListingStatus.EXPIRED },
      });
      await tx.deal.update({
        where: { id: dealId },
        data: { status: DealStatus.ENDED, endedAt: new Date() },
      });
    });
  }

  // System Extra-Time core — mirrors extend()'s $transaction. From LIVE the
  // listing is already ACTIVE (the EXPIRED→ACTIVE updateMany is a no-op); the
  // Deal→EXTENDED with the bounded extendedUntil.
  private async _extraTimeSystem(
    dealId: string,
    listingId: string,
    extendedUntil: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.listing.updateMany({
        where: { id: listingId, status: ListingStatus.EXPIRED },
        data: { status: ListingStatus.ACTIVE },
      });
      await tx.deal.update({
        where: { id: dealId },
        data: { status: DealStatus.EXTENDED, extendedUntil },
      });
    });
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

  // Buyer-safe projection (DD-3). An ALLOWLIST — mirrors the PUBLIC_LISTING_
  // SELECT philosophy: we deliberately OMIT costPriceCents, marginPct,
  // revenueCents, sellThroughPct, supplierName, supplierRef, parcel dims,
  // heroRank and every admin/audit field. Seller is username-only. What stays
  // is exactly the deal chrome a buyer needs: was/now price + save%, live
  // stock/scarcity, ships-in window, per-customer cap, and the lifecycle
  // flags (buyable / soldOut / ended) + countdown timestamp.
  private publicShape(deal: {
    id: string;
    status: DealStatus;
    wasPriceCents: number;
    startsAt: Date | null;
    endsAt: Date | null;
    extendedUntil: Date | null;
    liveAt: Date | null;
    soldOutAt: Date | null;
    initialStock: number;
    perCustomerCap: number;
    shipsInDaysMin: number;
    shipsInDaysMax: number;
    listing: {
      id: string;
      referenceNumber: string | null;
      title: string;
      description: string;
      price: number | null;
      condition: string;
      province: string;
      make: string | null;
      model: string | null;
      calibre: string | null;
      shippingMethods: string[];
      trackInventory: boolean;
      quantityAvailable: number;
      status: string;
      images?: { id: string; url: string; order: number; isPrimary: boolean }[];
      seller?: { clerkId: string; username: string | null } | null;
      category?: { name: string; slug: string } | null;
    };
  }) {
    const dealPriceCents = deal.listing.price ?? 0;
    const savePct =
      deal.wasPriceCents > 0
        ? Math.round(((deal.wasPriceCents - dealPriceCents) / deal.wasPriceCents) * 100)
        : 0;
    // Sold out: a stock-tracked deal hits 0 available; a single-item deal
    // signals its one sale by flipping the Listing to SOLD.
    const soldOut =
      deal.status === DealStatus.SOLD_OUT ||
      (deal.listing.trackInventory
        ? deal.listing.quantityAvailable <= 0
        : deal.listing.status === 'SOLD');
    const ended =
      deal.status === DealStatus.ENDED || deal.listing.status === 'EXPIRED';
    // Buyable is the checkout truth: Listing ACTIVE + a live/extended deal that
    // still has stock. The frontend uses this to switch the buy CTA to an
    // ended/sold-out state.
    const buyable =
      deal.listing.status === 'ACTIVE' &&
      !soldOut &&
      (deal.status === DealStatus.LIVE || deal.status === DealStatus.EXTENDED);
    // Extra Time overrides the base window for the "ends in" countdown.
    const endsAt = deal.extendedUntil ?? deal.endsAt;
    return {
      id: deal.id,
      status: deal.status,
      listingId: deal.listing.id,
      referenceNumber: deal.listing.referenceNumber,
      title: deal.listing.title,
      description: deal.listing.description,
      condition: deal.listing.condition,
      province: deal.listing.province,
      make: deal.listing.make,
      model: deal.listing.model,
      calibre: deal.listing.calibre,
      shippingMethods: deal.listing.shippingMethods,
      images: deal.listing.images ?? [],
      category: deal.listing.category ?? null,
      // Username only — never the house seller's real identity.
      seller: deal.listing.seller
        ? {
            clerkId: deal.listing.seller.clerkId,
            username: deal.listing.seller.username,
          }
        : null,
      // Money (cents) — was/now + derived save%. NO cost / margin / revenue.
      dealPriceCents,
      wasPriceCents: deal.wasPriceCents,
      savePct,
      // Scarcity (buyer-safe): units left + go-live baseline for "X sold".
      trackInventory: deal.listing.trackInventory,
      quantityAvailable: deal.listing.quantityAvailable,
      initialStock: deal.initialStock,
      perCustomerCap: deal.perCustomerCap,
      shipsInDaysMin: deal.shipsInDaysMin,
      shipsInDaysMax: deal.shipsInDaysMax,
      // Lifecycle + countdown
      listingStatus: deal.listing.status,
      buyable,
      soldOut,
      ended,
      startsAt: deal.startsAt,
      endsAt,
      liveAt: deal.liveAt,
      soldOutAt: deal.soldOutAt,
    };
  }
}
