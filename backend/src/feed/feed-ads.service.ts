// ────────────────────────────────────────────────────────────────────
// FEATURED ADS — the only promotional surface in the community feed.
//
// Two shapes:
//   1. A LISTING ad — a seller features one of their existing marketplace /
//      auction listings. Title, photo, price and link all come from the
//      listing, and the ad stops showing the moment the listing is no longer
//      ACTIVE. This is the primary flow.
//   2. A text ad — admin/official placement with its own title and ctaUrl.
//
// Members may not otherwise advertise in the feed. Pricing is not built yet
// (the operator is deciding the model); featuring is currently free but
// capped per seller. Flag-gated on `feed_ads_enabled` (default OFF).
// ────────────────────────────────────────────────────────────────────

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FeedAdStatus, ListingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService, FLAGS } from '../settings/settings.service';

/** Max active featured ads one seller may hold at once. */
export const FEED_AD_MAX_PER_USER = 3;

export interface FeedAdInput {
  title: string;
  body?: string | null;
  imageUrl?: string | null;
  imagePublicId?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  listingId?: string | null;
  advertiser?: string | null;
  status?: FeedAdStatus;
  startsAt?: string | null;
  endsAt?: string | null;
  sortOrder?: number;
}

export interface ServedAd {
  id: string;
  title: string;
  body: string | null;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaUrl: string;
  advertiser: string | null;
  listing: {
    id: string;
    title: string;
    price: number | null;
    listingType: string;
    imageUrl: string | null;
  } | null;
}

@Injectable()
export class FeedAdsService {
  private readonly logger = new Logger(FeedAdsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async isEnabled(): Promise<boolean> {
    return this.settings.get(FLAGS.feedAdsEnabled);
  }

  /**
   * Ads eligible to be served right now. Listing ads whose listing is no
   * longer ACTIVE are dropped. Impression counters are incremented
   * best-effort — a metrics write must never break the feed.
   */
  async activeAds(limit = 3): Promise<ServedAd[]> {
    if (!(await this.isEnabled())) return [];
    const now = new Date();
    const rows = await this.prisma.feedAd.findMany({
      where: {
        status: FeedAdStatus.ACTIVE,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      take: Math.min(limit * 4, 20),
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            price: true,
            listingType: true,
            status: true,
            images: {
              orderBy: { order: 'asc' },
              take: 1,
              select: { url: true },
            },
          },
        },
      },
    });

    const usable = rows
      .filter(
        (a) =>
          !a.listingId ||
          (a.listing && a.listing.status === ListingStatus.ACTIVE),
      )
      .slice(0, Math.min(limit, 10));

    if (usable.length > 0) {
      await this.prisma.feedAd
        .updateMany({
          where: { id: { in: usable.map((a) => a.id) } },
          data: { impressionCount: { increment: 1 } },
        })
        .catch(() => undefined);
    }

    return usable.map((a) => this.shape(a));
  }

  private shape(a: {
    id: string;
    title: string;
    body: string | null;
    imageUrl: string | null;
    ctaLabel: string | null;
    ctaUrl: string | null;
    advertiser: string | null;
    listing: {
      id: string;
      title: string;
      price: number | null;
      listingType: string;
      images: { url: string }[];
    } | null;
  }): ServedAd {
    if (a.listing) {
      return {
        id: a.id,
        title: a.listing.title,
        body: a.body,
        imageUrl: a.listing.images[0]?.url ?? a.imageUrl,
        ctaLabel: a.ctaLabel ?? 'View listing',
        ctaUrl: `/listings/${a.listing.id}`,
        advertiser: a.advertiser,
        listing: {
          id: a.listing.id,
          title: a.listing.title,
          price: a.listing.price,
          listingType: a.listing.listingType,
          imageUrl: a.listing.images[0]?.url ?? null,
        },
      };
    }
    return {
      id: a.id,
      title: a.title,
      body: a.body,
      imageUrl: a.imageUrl,
      ctaLabel: a.ctaLabel,
      ctaUrl: a.ctaUrl ?? '/',
      advertiser: a.advertiser,
      listing: null,
    };
  }

  async recordClick(id: string) {
    const ad = await this.prisma.feedAd.findUnique({
      where: { id },
      select: { id: true, ctaUrl: true, listingId: true },
    });
    if (!ad) throw new NotFoundException();
    await this.prisma.feedAd
      .update({ where: { id }, data: { clickCount: { increment: 1 } } })
      .catch(() => undefined);
    return {
      url: ad.listingId ? `/listings/${ad.listingId}` : (ad.ctaUrl ?? '/'),
    };
  }

  // ── Seller flow: feature one of your own listings ──────────────────

  async featureStatus(userId: string, listingId: string) {
    if (!(await this.isEnabled())) return { featured: false, adsEnabled: false };
    const ad = await this.prisma.feedAd.findUnique({
      where: { listingId },
      select: { id: true, createdByUserId: true, status: true },
    });
    return {
      featured: !!ad && ad.status === FeedAdStatus.ACTIVE,
      adsEnabled: true,
    };
  }

  async featureListing(userId: string, listingId: string) {
    if (!(await this.isEnabled())) {
      throw new NotFoundException();
    }
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true, sellerId: true, title: true, status: true },
    });
    if (!listing) throw new NotFoundException();
    if (listing.sellerId !== userId) {
      throw new BadRequestException('You can only feature your own listings.');
    }
    if (listing.status !== ListingStatus.ACTIVE) {
      throw new BadRequestException('Only active listings can be featured.');
    }
    const activeCount = await this.prisma.feedAd.count({
      where: { createdByUserId: userId, status: FeedAdStatus.ACTIVE },
    });
    const already = await this.prisma.feedAd.findUnique({
      where: { listingId },
      select: { id: true },
    });
    if (!already && activeCount >= FEED_AD_MAX_PER_USER) {
      throw new BadRequestException(
        `You can feature at most ${FEED_AD_MAX_PER_USER} listings at a time.`,
      );
    }
    const ad = await this.prisma.feedAd.upsert({
      where: { listingId },
      create: {
        listingId,
        title: listing.title,
        ctaLabel: 'View listing',
        status: FeedAdStatus.ACTIVE,
        createdByUserId: userId,
      },
      update: {
        status: FeedAdStatus.ACTIVE,
        title: listing.title,
        createdByUserId: userId,
      },
    });
    return { featured: true, adId: ad.id };
  }

  async unfeatureListing(userId: string, listingId: string) {
    if (!(await this.isEnabled())) {
      throw new NotFoundException();
    }
    await this.prisma.feedAd.deleteMany({
      where: { listingId, createdByUserId: userId },
    });
    return { featured: false };
  }

  // ── Admin ──────────────────────────────────────────────────────────

  /** Only internal paths or https URLs — never a javascript:/data: target. */
  private validateCta(ctaUrl: string): string {
    const url = (ctaUrl ?? '').trim();
    if (url.startsWith('/') && !url.startsWith('//')) return url;
    if (/^https:\/\//i.test(url)) return url;
    throw new BadRequestException(
      'Destination must be an internal /path or an https URL.',
    );
  }

  async adminList() {
    return this.prisma.feedAd.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: { listing: { select: { id: true, title: true, status: true } } },
    });
  }

  async adminCreate(dto: FeedAdInput, adminId?: string) {
    let listingId: string | null = null;
    let ctaUrl: string | null = null;
    if (dto.listingId) {
      const listing = await this.prisma.listing.findUnique({
        where: { id: dto.listingId },
        select: { id: true, title: true },
      });
      if (!listing) throw new NotFoundException('Listing not found.');
      listingId = listing.id;
    } else if (dto.ctaUrl) {
      ctaUrl = this.validateCta(dto.ctaUrl);
    } else {
      throw new BadRequestException('An ad needs a listingId or a ctaUrl.');
    }

    return this.prisma.feedAd.create({
      data: {
        listingId,
        title: dto.title.trim(),
        body: dto.body ?? null,
        imageUrl: dto.imageUrl ?? null,
        imagePublicId: dto.imagePublicId ?? null,
        ctaLabel: dto.ctaLabel ?? null,
        ctaUrl,
        advertiser: dto.advertiser ?? null,
        status: dto.status ?? FeedAdStatus.DRAFT,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        sortOrder: dto.sortOrder ?? 0,
        createdByUserId: adminId ?? null,
      },
    });
  }

  async adminUpdate(id: string, dto: Partial<FeedAdInput>) {
    const existing = await this.prisma.feedAd.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException();
    return this.prisma.feedAd.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
        ...(dto.imagePublicId !== undefined
          ? { imagePublicId: dto.imagePublicId }
          : {}),
        ...(dto.ctaLabel !== undefined ? { ctaLabel: dto.ctaLabel } : {}),
        ...(dto.ctaUrl !== undefined
          ? { ctaUrl: dto.ctaUrl ? this.validateCta(dto.ctaUrl) : null }
          : {}),
        ...(dto.advertiser !== undefined ? { advertiser: dto.advertiser } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.startsAt !== undefined
          ? { startsAt: dto.startsAt ? new Date(dto.startsAt) : null }
          : {}),
        ...(dto.endsAt !== undefined
          ? { endsAt: dto.endsAt ? new Date(dto.endsAt) : null }
          : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
  }

  async adminRemove(id: string) {
    const existing = await this.prisma.feedAd.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException();
    await this.prisma.feedAd.delete({ where: { id } });
    return { deleted: true };
  }
}
