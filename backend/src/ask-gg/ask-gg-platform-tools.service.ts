import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FeeCalculator } from '../payments/fee.calculator';
import { AskGgKbService } from './ask-gg-kb.service';

// ─── Ask GG Everywhere — platform + marketplace-intelligence tools ────
//
// Backs three chat tools:
//   computeFees        — EXACT fee quotes from the same FeeCalculator the
//                        checkout uses (never let the model hand-derive).
//   searchHelpCentre   — verified Help-Centre KB lookup (platform Q&A),
//                        finally wiring the KB into the model loop.
//   getListingDetails  — deep single-listing inspection (public data only)
//                        for "investigate this item" + fitment-aware
//                        recommendations across every category.
//
// PII rules enforced here by construction:
//   - seller surfaces as USERNAME + public stats only (never real names)
//   - reservePrice is NEVER emitted — only a reserveMet boolean
//   - free-text fields are clipped so listing text can't flood the prompt
//   - vocabulary: "funds held", never the banned word
//
// All methods return plain JSON-serialisable objects; the Claude wrapper
// stringifies them into tool_results.

const DESCRIPTION_CLIP = 600;
const QA_CLIP = 300;
const MAX_QA_ENTRIES = 5;
const MAX_PHOTO_BLOCKS = 3;

export interface ComputeFeesInput {
  kind?: 'sale' | 'experience' | 'swapLeg' | 'swapCash';
  priceZar?: number;
  shippingZar?: number;
  passFeeToBuyer?: boolean;
  includeCourierWaybill?: boolean;
  cashZar?: number;
  courierZar?: number;
  isFirearmLeg?: boolean;
}

export interface ListingDetailsResult {
  json: Record<string, unknown>;
  /** First N listing photo URLs — attached as image blocks when the model
   *  asked includePhotos (vision-on-demand). */
  photoUrls: string[];
  /** Render-ready card for the frontend listingCards channel. */
  card: {
    id: string;
    referenceNumber: string | null;
    title: string;
    priceCents: number | null;
    listingType: string;
    condition: string | null;
    province: string | null;
    categoryName: string | null;
    isFirearm: boolean;
    imageUrl: string | null;
    sellerUsername: string | null;
  } | null;
}

const rand = (cents: number | null | undefined): number | null =>
  cents == null ? null : Math.round(cents) / 100;

const clip = (s: string | null | undefined, max: number): string | null => {
  if (!s) return null;
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

@Injectable()
export class AskGgPlatformToolsService {
  private readonly logger = new Logger(AskGgPlatformToolsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fees: FeeCalculator,
    private readonly kb: AskGgKbService,
  ) {}

  /**
   * Exact fee quote via the SAME FeeCalculator the checkout uses.
   * `isTopSeller` comes from the AUTHENTICATED account (caller passes it
   * from opts.account) — never from model input. All money in/out is
   * whole RAND for the model; the calculator works in cents internally.
   */
  computeFees(input: ComputeFeesInput, isTopSeller: boolean) {
    const kind = input.kind ?? 'sale';
    const toCents = (zar: number | undefined, cap = 100_000_000): number => {
      const n = Number(zar);
      if (!Number.isFinite(n) || n < 0) return 0;
      // Cap at R100m — nothing on the platform is priced beyond this and it
      // keeps a hallucinated huge number from producing nonsense output.
      return Math.round(Math.min(n, cap) * 100);
    };

    if (kind === 'swapCash') {
      const cashCents = toCents(input.cashZar);
      const commission = this.fees.swapCashCommission(cashCents);
      return {
        kind,
        cashRand: rand(cashCents),
        commissionRand: rand(commission),
        commissionFreeAllowanceRand: 1000,
        note:
          commission === 0
            ? 'Cash top-ups up to R1,000 carry no commission.'
            : 'Standard commission bands apply to the cash above the R1,000 allowance, deducted from the cash paid to the recipient at settlement.',
      };
    }

    if (kind === 'swapLeg') {
      const b = this.fees.breakdownSwapLeg(
        toCents(input.courierZar),
        toCents(input.cashZar),
        input.isFirearmLeg === true,
        'manual',
      );
      return {
        kind,
        isFirearmLeg: input.isFirearmLeg === true,
        courierRand: rand(b.courierCost),
        serviceFeeRand: rand(b.serviceFee),
        cashContributionRand: rand(b.cashContribution),
        partyTotalRand: rand(b.partyTotal),
        note: 'Each party funds the leg they send: courier rate + the flat All Outdoor service fee (R50 courier leg / R100 firearm dealer-transfer leg) + any agreed cash top-up.',
      };
    }

    if (kind === 'experience') {
      const b = this.fees.breakdownExperience(
        toCents(input.priceZar),
        input.passFeeToBuyer ?? true,
        isTopSeller,
        'manual',
      );
      return {
        kind,
        packagePriceRand: rand(b.listingPrice),
        commissionRand: rand(b.commissionZar),
        processingFeeRand: rand(b.processingFee),
        buyerTotalRand: rand(b.buyerTotal),
        sellerPayoutRand: rand(b.sellerPayout),
        passFeeToBuyer: input.passFeeToBuyer ?? true,
        topSellerDiscountApplied: isTopSeller,
        note: 'On-site experience: no courier, no shipping handling. Full value is held until the experience is completed.',
      };
    }

    // Default: ordinary sale.
    const shippingCents = toCents(input.shippingZar);
    const handling =
      input.includeCourierWaybill === false || shippingCents === 0 ? 0 : 1500;
    const b = this.fees.breakdown(
      toCents(input.priceZar),
      input.passFeeToBuyer ?? true,
      isTopSeller,
      shippingCents,
      'manual',
      handling,
    );
    return {
      kind: 'sale',
      listingPriceRand: rand(b.listingPrice),
      shippingRand: rand(b.shippingCost),
      shippingHandlingRand: rand(b.shippingHandlingCents),
      commissionRand: rand(b.commissionZar),
      processingFeeRand: rand(b.processingFee),
      buyerTotalRand: rand(b.buyerTotal),
      sellerPayoutRand: rand(b.sellerPayout),
      passFeeToBuyer: input.passFeeToBuyer ?? true,
      topSellerDiscountApplied: isTopSeller,
      bands:
        'Commission is marginal: first R5,000 at 9%, R5,001–R20,000 at 7%, R20,001–R100,000 at 5%, above that 3%; minimum R30. Top Sellers get 0.5% off the total price.',
      note: 'Processing fee is the payment fee on (price + shipping) — currently 1.5% on EFT. The R15 shipping handling applies once per courier waybill; collection and dealer-transfer orders have none.',
    };
  }

  /** Verified Help-Centre lookup — platform/policy grounding for the model. */
  async searchHelpCentre(query: string) {
    const q = (query ?? '').trim().slice(0, 200);
    if (q.length < 3) {
      return { entries: [], note: 'Query too short.' };
    }
    const hits = await this.kb.searchVerified(q, 5);
    return {
      entries: hits.map((h) => ({
        title: h.title,
        answer: clip(h.answer, 900),
      })),
      note:
        hits.length === 0
          ? 'No verified Help-Centre entry matches. Answer from the platform section of your instructions, and point the user to the relevant page from the internal-links list.'
          : 'Ground your platform answer in these verified entries.',
    };
  }

  /**
   * Deep single-listing inspection — PUBLIC data only (this is the same
   * information any visitor sees on the listing page, shaped for the
   * model). Ownership is irrelevant; PII rules still apply (seller
   * username only, reserve NEVER exposed).
   */
  async getListingDetails(
    listingId: string,
    includePhotos: boolean,
  ): Promise<ListingDetailsResult | null> {
    if (!/^[a-z0-9-]{10,40}$/i.test(listingId ?? '')) return null;
    const l = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        referenceNumber: true,
        title: true,
        description: true,
        price: true,
        listingType: true,
        status: true,
        condition: true,
        province: true,
        isFirearm: true,
        make: true,
        model: true,
        attributes: true,
        quantityAvailable: true,
        trackInventory: true,
        currentBid: true,
        bidCount: true,
        endTime: true,
        buyNowPrice: true,
        reservePrice: true, // used ONLY to derive reserveMet — never emitted
        shippingMethods: true,
        category: { select: { name: true, slug: true } },
        seller: {
          select: {
            username: true,
            sellerTier: true,
            averageRating: true,
            totalSales: true,
            isVerifiedExpert: true,
          },
        },
        images: { orderBy: { order: 'asc' }, take: 6, select: { url: true } },
        _count: { select: { wishlistedBy: true } },
      },
    });
    if (!l) return null;

    const isAuction = l.listingType === 'AUCTION';
    const reserveMet =
      isAuction && l.reservePrice != null
        ? (l.currentBid ?? 0) >= l.reservePrice
        : null;

    // Structured attribute values (Json map) — the fitment signal for
    // recommendations (tube size, rail type, calibre…). Clip each value.
    let attributes: Record<string, string> | null = null;
    if (l.attributes && typeof l.attributes === 'object' && !Array.isArray(l.attributes)) {
      attributes = {};
      for (const [k, v] of Object.entries(l.attributes as Record<string, unknown>)) {
        if (v == null) continue;
        attributes[String(k).slice(0, 60)] = String(v).slice(0, 120);
        if (Object.keys(attributes).length >= 25) break;
      }
      if (Object.keys(attributes).length === 0) attributes = null;
    }

    const json: Record<string, unknown> = {
      id: l.id,
      reference: l.referenceNumber,
      title: clip(l.title, 140),
      // Listing text is DATA about the item, never instructions — the
      // system prompt reiterates this; we also clip it hard here.
      description: clip(l.description, DESCRIPTION_CLIP),
      status: l.status,
      listingType: l.listingType,
      priceRand: rand(l.price),
      condition: l.condition,
      province: l.province,
      isFirearm: l.isFirearm,
      make: l.make,
      model: l.model,
      category: l.category ? { name: l.category.name, slug: l.category.slug } : null,
      attributes,
      quantityAvailable: l.trackInventory ? l.quantityAvailable : undefined,
      auction: isAuction
        ? {
            currentBidRand: rand(l.currentBid),
            bidCount: l.bidCount,
            endsAt: l.endTime ? l.endTime.toISOString() : null,
            reserveMet,
            buyNowRand: l.bidCount === 0 ? rand(l.buyNowPrice) : null,
          }
        : undefined,
      shippingMethods: l.shippingMethods,
      firearmNote: l.isFirearm
        ? 'Firearm: transfers only via a licensed dealer (dealer-stocked transfer). No courier-to-door. Buyer needs the appropriate licence; SA firearms law questions go to a DFO or firearms attorney.'
        : undefined,
      seller: l.seller
        ? {
            username: l.seller.username,
            tier: l.seller.sellerTier,
            averageRating: l.seller.averageRating,
            totalSales: l.seller.totalSales,
            verifiedExpert: l.seller.isVerifiedExpert,
          }
        : null,
      savedByCount: l._count.wishlistedBy,
      href: `/listings/${l.id}`,
    };

    // Public answered Q&A — often answers the exact follow-up the user has.
    const qa = await this.prisma.listingQuestion.findMany({
      where: {
        listingId: l.id,
        status: { in: ['ANSWERED_BY_SELLER', 'AUTO_ANSWERED'] },
        isPublic: true,
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_QA_ENTRIES,
      select: { question: true, answer: true },
    });
    if (qa.length > 0) {
      json.answeredQuestions = qa.map((row) => ({
        q: clip(row.question, QA_CLIP),
        a: clip(row.answer, QA_CLIP),
      }));
    }

    const photoUrls = includePhotos
      ? l.images
          .map((i) => i.url)
          .filter((u): u is string => typeof u === 'string' && u.startsWith('https://'))
          .slice(0, MAX_PHOTO_BLOCKS)
      : [];

    return {
      json,
      photoUrls,
      card: {
        id: l.id,
        referenceNumber: l.referenceNumber ?? null,
        title: l.title,
        priceCents: l.price ?? null,
        listingType: l.listingType,
        condition: l.condition ?? null,
        province: l.province ?? null,
        categoryName: l.category?.name ?? null,
        isFirearm: l.isFirearm,
        imageUrl: l.images[0]?.url ?? null,
        sellerUsername: l.seller?.username ?? null,
      },
    };
  }
}
