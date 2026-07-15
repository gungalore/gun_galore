import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WantedStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ContactDetailFilterService } from '../moderation/contact-detail-filter.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateWantedDto } from './dto/create-wanted.dto';
import { RespondWantedDto } from './dto/respond-wanted.dto';

/**
 * Wanted ads — demand capture ("looking for a 6.5 Creedmoor scope…").
 *
 * Deliberately NOT listings: a wanted ad is never sellable. No price, no
 * checkout, no cart, no offers, no shipping — zero new money surface.
 * Sellers respond with a link to one of their OWN ACTIVE listings and/or
 * a contact-filtered message; the ad owner clicks through to the listing
 * and transacts on the existing rails (payment held, courier, dealer
 * transfer where applicable).
 *
 * Guard rails:
 *   - ContactDetailFilterService on title/description/message — no phone
 *     numbers / WhatsApp handles, same policy as offer notes.
 *   - Category must be availableSecondhand — blocks "wanted: ammo" P2P asks
 *     (live-ammo categories are not privately tradable on the platform).
 *   - Caps: 10 open ads per user, 3 responses per responder per ad.
 *   - Lazy expiry: browse hides ads past expiresAt (60 days); no cron.
 */

const AD_TTL_DAYS = 60;
const MAX_OPEN_ADS_PER_USER = 10;
const MAX_RESPONSES_PER_AD_PER_USER = 3;
const PAGE_SIZE = 24;
const CARD_DESCRIPTION_CLIP = 240;

@Injectable()
export class WantedService {
  private readonly logger = new Logger(WantedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly filter: ContactDetailFilterService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Resolve the platform user from the Clerk ID. */
  private async me(clerkId: string) {
    const u = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true, username: true },
    });
    if (!u) throw new NotFoundException('User not found');
    return u;
  }

  /** ACTIVE-but-lapsed ads read as EXPIRED without a cron writing rows. */
  private effectiveStatus(ad: {
    status: WantedStatus;
    expiresAt: Date;
  }): WantedStatus {
    if (ad.status === 'ACTIVE' && ad.expiresAt.getTime() < Date.now()) {
      return 'EXPIRED';
    }
    return ad.status;
  }

  // Shared card shape for browse/detail/mine. Usernames only — never
  // real names on public surfaces.
  private shapeCard(ad: {
    id: string;
    title: string;
    description: string;
    categoryId: string | null;
    category: { name: string; slug: string } | null;
    province: string | null;
    budgetMinCents: number | null;
    budgetMaxCents: number | null;
    status: WantedStatus;
    expiresAt: Date;
    createdAt: Date;
    user: { username: string | null };
    _count: { responses: number };
  }) {
    return {
      id: ad.id,
      title: ad.title,
      description:
        ad.description.length > CARD_DESCRIPTION_CLIP
          ? `${ad.description.slice(0, CARD_DESCRIPTION_CLIP)}…`
          : ad.description,
      categoryId: ad.categoryId,
      categoryName: ad.category?.name ?? null,
      categorySlug: ad.category?.slug ?? null,
      province: ad.province,
      budgetMinCents: ad.budgetMinCents,
      budgetMaxCents: ad.budgetMaxCents,
      status: this.effectiveStatus(ad),
      expiresAt: ad.expiresAt,
      createdAt: ad.createdAt,
      responseCount: ad._count.responses,
      ownerUsername: ad.user.username ?? 'member',
    };
  }

  private readonly cardInclude = {
    category: { select: { name: true, slug: true } },
    user: { select: { username: true } },
    _count: { select: { responses: true } },
  } satisfies Prisma.WantedAdInclude;

  // ─── Create ────────────────────────────────────────────────────────

  async create(clerkId: string, dto: CreateWantedDto) {
    const me = await this.me(clerkId);

    if (
      dto.budgetMinCents != null &&
      dto.budgetMaxCents != null &&
      dto.budgetMinCents > dto.budgetMaxCents
    ) {
      throw new BadRequestException(
        'Budget minimum cannot exceed the maximum',
      );
    }

    if (dto.categoryId) {
      const cat = await this.prisma.category.findUnique({
        where: { id: dto.categoryId },
        select: { isActive: true, availableSecondhand: true },
      });
      if (!cat || !cat.isActive) {
        throw new BadRequestException('Unknown category');
      }
      // Live-ammo (and any other not-privately-tradable) categories can't
      // be asked for either — same compliance line as the Sell form.
      if (!cat.availableSecondhand) {
        throw new BadRequestException(
          'This category is not available for private trade on Gun Galore',
        );
      }
    }

    // Contact filter on both freeform fields — a wanted ad is a public
    // surface; the whole point is that sellers respond ON the platform.
    for (const [field, origin] of [
      [dto.title, 'wanted-title'],
      [dto.description, 'wanted-description'],
    ] as const) {
      const verdict = await this.filter.check(field, origin, clerkId);
      if (!verdict.allowed) {
        throw new BadRequestException(
          verdict.reason ??
            'Contact details are not allowed in wanted ads — sellers respond right here on Gun Galore.',
        );
      }
    }

    const openAds = await this.prisma.wantedAd.count({
      where: {
        userId: me.id,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
      },
    });
    if (openAds >= MAX_OPEN_ADS_PER_USER) {
      throw new BadRequestException(
        `You already have ${MAX_OPEN_ADS_PER_USER} open wanted ads — close one first.`,
      );
    }

    const ad = await this.prisma.wantedAd.create({
      data: {
        userId: me.id,
        title: dto.title.trim(),
        description: dto.description.trim(),
        categoryId: dto.categoryId ?? null,
        province: dto.province ?? null,
        budgetMinCents: dto.budgetMinCents ?? null,
        budgetMaxCents: dto.budgetMaxCents ?? null,
        expiresAt: new Date(Date.now() + AD_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
      include: this.cardInclude,
    });

    this.logger.log(`Wanted ad ${ad.id} created by ${me.id}`);
    return this.shapeCard(ad);
  }

  // ─── Browse (public) ───────────────────────────────────────────────

  async browse(query: {
    categoryId?: string;
    province?: string;
    page?: number;
  }) {
    const page = Math.max(1, Number(query.page) || 1);

    const where: Prisma.WantedAdWhereInput = {
      status: 'ACTIVE',
      expiresAt: { gt: new Date() },
    };

    if (query.categoryId) {
      // Match the category itself plus its direct children so browsing
      // "Optics" also surfaces "Rifle Scopes" asks.
      const children = await this.prisma.category.findMany({
        where: { parentId: query.categoryId },
        select: { id: true },
      });
      where.categoryId = {
        in: [query.categoryId, ...children.map((c) => c.id)],
      };
    }

    if (
      query.province &&
      /^[A-Z_]+$/.test(query.province) &&
      [
        'EASTERN_CAPE',
        'FREE_STATE',
        'GAUTENG',
        'KWAZULU_NATAL',
        'LIMPOPO',
        'MPUMALANGA',
        'NORTH_WEST',
        'NORTHERN_CAPE',
        'WESTERN_CAPE',
      ].includes(query.province)
    ) {
      where.province = query.province as Prisma.WantedAdWhereInput['province'];
    }

    const [total, ads] = await Promise.all([
      this.prisma.wantedAd.count({ where }),
      this.prisma.wantedAd.findMany({
        where,
        include: this.cardInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);

    return {
      total,
      page,
      pageSize: PAGE_SIZE,
      items: ads.map((a) => this.shapeCard(a)),
    };
  }

  // ─── Detail (public — no response contents) ────────────────────────

  async detail(id: string) {
    const ad = await this.prisma.wantedAd.findUnique({
      where: { id },
      include: this.cardInclude,
    });
    if (!ad) throw new NotFoundException('Wanted ad not found');
    // Full description on detail (card shape clips it).
    return { ...this.shapeCard(ad), description: ad.description };
  }

  // ─── Responses (owner-only read) ───────────────────────────────────

  async responsesFor(clerkId: string, adId: string) {
    const me = await this.me(clerkId);
    const ad = await this.prisma.wantedAd.findUnique({
      where: { id: adId },
      select: { userId: true },
    });
    if (!ad) throw new NotFoundException('Wanted ad not found');
    if (ad.userId !== me.id) {
      throw new ForbiddenException('Only the ad owner can view responses');
    }

    const responses = await this.prisma.wantedResponse.findMany({
      where: { wantedAdId: adId },
      orderBy: { createdAt: 'desc' },
      include: {
        responder: { select: { username: true } },
        listing: {
          select: {
            id: true,
            title: true,
            price: true,
            status: true,
            images: {
              where: { isPrimary: true },
              take: 1,
              select: { url: true },
            },
          },
        },
      },
    });

    return responses.map((r) => ({
      id: r.id,
      message: r.message,
      createdAt: r.createdAt,
      responderUsername: r.responder.username ?? 'member',
      listing: r.listing
        ? {
            id: r.listing.id,
            title: r.listing.title,
            price: r.listing.price,
            status: r.listing.status,
            imageUrl: r.listing.images[0]?.url ?? null,
          }
        : null,
    }));
  }

  // ─── Respond ("I have this") ───────────────────────────────────────

  async respond(clerkId: string, adId: string, dto: RespondWantedDto) {
    const me = await this.me(clerkId);

    const ad = await this.prisma.wantedAd.findUnique({
      where: { id: adId },
      select: {
        id: true,
        userId: true,
        title: true,
        status: true,
        expiresAt: true,
      },
    });
    if (!ad) throw new NotFoundException('Wanted ad not found');
    if (ad.userId === me.id) {
      throw new BadRequestException('You cannot respond to your own ad');
    }
    if (this.effectiveStatus(ad) !== 'ACTIVE') {
      throw new BadRequestException('This wanted ad is no longer open');
    }

    // Linked listing must be the responder's OWN and currently ACTIVE —
    // that's what makes the response actionable through the normal rails.
    if (dto.listingId) {
      const listing = await this.prisma.listing.findFirst({
        // isDealListing:false — a first-party house deal can never be linked as
        // a wanted-ad response (defense-in-depth; sellerId would never match).
        where: { id: dto.listingId, sellerId: me.id, status: 'ACTIVE', isDealListing: false },
        select: { id: true },
      });
      if (!listing) {
        throw new BadRequestException(
          'You can only link one of your own active listings',
        );
      }
    }

    const verdict = await this.filter.check(
      dto.message,
      'wanted-response',
      clerkId,
    );
    if (!verdict.allowed) {
      throw new BadRequestException(
        verdict.reason ??
          'Contact details are not allowed — the buyer can reach your listing right here.',
      );
    }

    const priorResponses = await this.prisma.wantedResponse.count({
      where: { wantedAdId: adId, responderId: me.id },
    });
    if (priorResponses >= MAX_RESPONSES_PER_AD_PER_USER) {
      throw new BadRequestException(
        'You have already responded to this ad the maximum number of times',
      );
    }

    let response;
    try {
      response = await this.prisma.wantedResponse.create({
        data: {
          wantedAdId: adId,
          responderId: me.id,
          listingId: dto.listingId ?? null,
          message: dto.message.trim(),
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException(
          'You already suggested this listing on this ad',
        );
      }
      throw e;
    }

    // Tell the ad owner — this is the retention hook that makes a wanted
    // ad better than a classifieds bump: sellers come to YOU.
    void this.notifications
      .persist({
        userId: ad.userId,
        category: 'BUYER',
        type: 'wanted_response',
        title: 'Someone has what you’re looking for',
        body: `${me.username ?? 'A member'} responded to your wanted ad “${ad.title}”`,
        url: `/wanted/${ad.id}`,
        iconKey: 'offer',
        linkedType: 'wantedAd',
        linkedId: ad.id,
        dismissible: true,
      })
      .catch((e) =>
        this.logger.warn(`wanted_response notification failed: ${e}`),
      );

    this.logger.log(`Wanted response ${response.id} on ad ${adId} by ${me.id}`);
    return { ok: true, id: response.id };
  }

  // ─── Mine (my ads + their responses) ───────────────────────────────

  async mine(clerkId: string) {
    const me = await this.me(clerkId);
    const ads = await this.prisma.wantedAd.findMany({
      where: { userId: me.id },
      include: this.cardInclude,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return ads.map((a) => this.shapeCard(a));
  }

  /** True when the caller has already responded to this ad (drives the
   * "you've responded" state on the detail page). */
  async myResponseState(clerkId: string, adId: string) {
    const me = await this.me(clerkId);
    const count = await this.prisma.wantedResponse.count({
      where: { wantedAdId: adId, responderId: me.id },
    });
    return {
      responded: count > 0,
      remaining: Math.max(0, MAX_RESPONSES_PER_AD_PER_USER - count),
    };
  }

  // ─── Close ─────────────────────────────────────────────────────────

  async close(clerkId: string, adId: string) {
    const me = await this.me(clerkId);
    const ad = await this.prisma.wantedAd.findUnique({
      where: { id: adId },
      select: { userId: true, status: true },
    });
    if (!ad) throw new NotFoundException('Wanted ad not found');
    if (ad.userId !== me.id) {
      throw new ForbiddenException('Only the ad owner can close it');
    }
    if (ad.status !== 'ACTIVE') return { ok: true };

    await this.prisma.wantedAd.update({
      where: { id: adId },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    return { ok: true };
  }
}
