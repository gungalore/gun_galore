import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Photo retention (spec section 11). Deletes valuation photos older than
 * VALUATION_PHOTO_RETENTION_DAYS (default 30) from both the database and
 * Cloudinary, and clears the raw failure blob from the same window. A
 * COMPLETED valuation keeps its result, comps (price/model/date/URL only) and
 * outcome forever; only the member's photos go.
 */
@Injectable()
export class ValuationRetentionService {
  private readonly logger = new Logger(ValuationRetentionService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const days = Number(process.env.VALUATION_PHOTO_RETENTION_DAYS ?? 30);
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const stale = await this.prisma.valuationImage.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true, publicId: true },
      });
      if (stale.length === 0) return;
      await this.prisma.valuationImage.deleteMany({
        where: { id: { in: stale.map((i) => i.id) } },
      });
      const publicIds = stale.map((i) => i.publicId).filter(Boolean);
      if (publicIds.length) {
        try {
          await this.cloudinary.deleteImages(publicIds);
        } catch (err) {
          this.logger.warn(`cloudinary retention delete failed: ${(err as Error).message}`);
        }
      }
      await this.prisma.valuation.updateMany({
        where: { createdAt: { lt: cutoff }, rawFailureJson: { not: null } },
        data: { rawFailureJson: null },
      });
      this.logger.log(`valuation retention: removed ${stale.length} photo(s)`);
    } finally {
      this.running = false;
    }
  }
}
