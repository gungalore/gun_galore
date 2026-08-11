import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * SMS marketing campaigns. A campaign is a short URL key (?c=KEY) carried in
 * outbound marketing SMSes; arriving with an active key shows the welcome
 * banner once per browser session. `hits` counts banner-shown arrivals, which
 * is per-blast click attribution — the number that says whether a paid SMS
 * blast pulled.
 */
@Injectable()
export class MarketingService {
  private readonly logger = new Logger(MarketingService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Public: resolve a campaign key. Counts the hit (atomic increment) — the
  // frontend only calls this when it is actually about to show the banner
  // (first arrival this session), so hits ≈ unique banner impressions.
  async resolve(key: string) {
    const k = (key ?? '').trim().slice(0, 40);
    if (!k) return { campaign: null };
    const campaign = await this.prisma.marketingCampaign.findUnique({
      where: { key: k },
      select: { id: true, active: true, headline: true },
    });
    if (!campaign || !campaign.active) return { campaign: null };
    void this.prisma.marketingCampaign
      .update({
        where: { id: campaign.id },
        data: { hits: { increment: 1 }, lastHitAt: new Date() },
      })
      .catch((e) =>
        this.logger.warn(`campaign hit count failed: ${(e as Error).message}`),
      );
    return { campaign: { headline: campaign.headline } };
  }

  // ── Admin ────────────────────────────────────────────────────────
  async adminList() {
    const campaigns = await this.prisma.marketingCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Conversions, not just impressions. `hits` counts banner arrivals, which
    // never answered the question the operator is actually paying per-SMS
    // for: did anyone JOIN, and did they list anything? Two grouped counts
    // over indexed columns, joined in memory against at most 100 campaigns.
    const [signupRows, listerRows] = await Promise.all([
      this.prisma.user.groupBy({
        by: ['campaignKey'],
        where: { campaignKey: { not: null } },
        _count: { _all: true },
      }),
      // Distinct campaign-attributed users who have listed at least once —
      // the real signal that a blast brought SUPPLY, not just signups.
      this.prisma.listing.findMany({
        where: { seller: { campaignKey: { not: null } } },
        select: { sellerId: true, seller: { select: { campaignKey: true } } },
        distinct: ['sellerId'],
        take: 5000,
      }),
    ]);

    const signupsByKey = new Map(
      signupRows.map((r) => [r.campaignKey as string, r._count._all]),
    );
    const listersByKey = new Map<string, number>();
    for (const l of listerRows) {
      const k = l.seller?.campaignKey;
      if (!k) continue;
      listersByKey.set(k, (listersByKey.get(k) ?? 0) + 1);
    }

    return campaigns.map((c) => ({
      ...c,
      signups: signupsByKey.get(c.key) ?? 0,
      sellers: listersByKey.get(c.key) ?? 0,
    }));
  }

  async adminCreate(dto: { key?: string; name?: string; headline?: string }) {
    const key = (dto.key ?? '').trim().toLowerCase();
    const name = (dto.name ?? '').trim();
    if (!/^[a-z0-9-]{2,24}$/.test(key)) {
      throw new BadRequestException(
        'Key must be 2–24 characters: letters, numbers or dashes (it rides in the SMS URL — keep it short).',
      );
    }
    if (name.length < 3) {
      throw new BadRequestException('Give the campaign an internal name.');
    }
    const exists = await this.prisma.marketingCampaign.findUnique({
      where: { key },
    });
    if (exists) throw new BadRequestException('That key is already in use.');
    return this.prisma.marketingCampaign.create({
      data: {
        key,
        name,
        headline: (dto.headline ?? '').trim() || null,
      },
    });
  }

  async adminToggle(id: string) {
    const c = await this.prisma.marketingCampaign.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Campaign not found');
    return this.prisma.marketingCampaign.update({
      where: { id },
      data: { active: !c.active },
    });
  }
}
