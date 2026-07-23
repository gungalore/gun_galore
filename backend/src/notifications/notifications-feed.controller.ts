import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { NotificationCategory, Prisma } from '@prisma/client';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { moduleForNotification } from './notification-module';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsFeedQueryDto } from './dto/notifications-feed-query.dto';
import { DismissNotificationsDto } from './dto/dismiss.dto';

// Feed + counts + dismiss endpoints backing the bell-icon badge in the
// bottom tab bar + the /notifications inbox page. Read-mostly; cheap
// COUNT queries; throttled to 120/min/user (the bell polls every 60s
// across multiple tabs / devices so users can easily exceed the
// default global throttle).
@Controller('notifications/me')
@UseGuards(ClerkGuard)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class NotificationsFeedController {
  constructor(private readonly prisma: PrismaService) {}

  // GET /notifications/me/active-count
  // Cheap COUNT query per category. Polled by the bell badge in
  // bottom-tab-bar.tsx every 60s. Returns 0s for unsigned-in users
  // (defensive — ClerkGuard already 401s those).
  @Get('active-count')
  async activeCount(@CurrentUser() clerkId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!user) return { buyer: 0, seller: 0, account: 0, total: 0 };

    const [buyer, seller, account] = await this.prisma.$transaction([
      this.prisma.notification.count({
        where: { userId: user.id, resolvedAt: null, category: 'BUYER' },
      }),
      this.prisma.notification.count({
        where: { userId: user.id, resolvedAt: null, category: 'SELLER' },
      }),
      this.prisma.notification.count({
        where: { userId: user.id, resolvedAt: null, category: 'ACCOUNT' },
      }),
    ]);

    return {
      buyer,
      seller,
      account,
      total: buyer + seller + account,
    };
  }

  // GET /notifications/me/module-counts
  // Unresolved-notification counts grouped by ACCOUNT-MENU MODULE (the menu
  // href where the user acts on them), for the per-module red badges in the
  // account dropdown / drawer / PWA More sheet. One groupBy — cheap. Keys are
  // menu hrefs (e.g. '/my/offers'); only modules with a non-zero count appear.
  @Get('module-counts')
  async moduleCounts(
    @CurrentUser() clerkId: string,
  ): Promise<Record<string, number>> {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!user) return {};

    const groups = await this.prisma.notification.groupBy({
      by: ['type', 'category'],
      where: { userId: user.id, resolvedAt: null },
      _count: { _all: true },
    });

    const counts: Record<string, number> = {};
    for (const g of groups) {
      const mod = moduleForNotification(g.type, g.category);
      if (mod) counts[mod] = (counts[mod] ?? 0) + g._count._all;
    }
    return counts;
  }

  // GET /notifications/me?category=&status=&limit=&before=
  // Paginated descending-by-createdAt feed for the inbox page.
  @Get()
  async list(
    @CurrentUser() clerkId: string,
    @Query() q: NotificationsFeedQueryDto,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!user) return [];

    const status = q.status ?? 'active';
    const limit = q.limit ?? 50;

    const where: Prisma.NotificationWhereInput = {
      userId: user.id,
      ...(q.category ? { category: q.category as NotificationCategory } : {}),
      ...(status === 'active' ? { resolvedAt: null } : {}),
      ...(status === 'resolved' ? { resolvedAt: { not: null } } : {}),
      ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
    };

    return this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  // POST /notifications/me/dismiss   body: { ids: string[] }
  // ONLY clears rows where `dismissible = true`. Action-required rows
  // can only be resolved by acting on the linked entity (server-side
  // resolveByEntity). The where-clause does the safety filter.
  @Post('dismiss')
  async dismiss(
    @CurrentUser() clerkId: string,
    @Body() dto: DismissNotificationsDto,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!user) return { dismissed: 0 };

    const r = await this.prisma.notification.updateMany({
      where: {
        id: { in: dto.ids },
        userId: user.id,
        dismissible: true,
        resolvedAt: null,
      },
      data: {
        resolvedAt: new Date(),
        resolvedBy: 'dismissed',
      },
    });

    return { dismissed: r.count };
  }
}
