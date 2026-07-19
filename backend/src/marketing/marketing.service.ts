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
    return this.prisma.marketingCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
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
