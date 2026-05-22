import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Typed accessors over the single-row `Setting` key/value table.
// Values are stored as strings; we coerce them on read.
//
// Defaults are baked in so a fresh DB (with no `Setting` rows) still works
// sensibly. Admin writes override the default via upsert.

interface FlagDefinition<T> {
  key: string;
  default: T;
  parse: (raw: string) => T;
}

export const FLAGS = {
  claudeModerationEnabled: {
    key: 'claude_moderation_enabled',
    default: true,
    parse: (s) => s === 'true' || s === '1',
  } as FlagDefinition<boolean>,
  claudeConfidenceThreshold: {
    key: 'claude_confidence_threshold',
    default: 0.85,
    parse: (s) => {
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : 0.85;
    },
  } as FlagDefinition<number>,
  newSellerFirearmReviewCount: {
    key: 'new_seller_firearm_review_count',
    default: 3,
    parse: (s) => {
      const n = parseInt(s, 10);
      return Number.isFinite(n) ? n : 3;
    },
  } as FlagDefinition<number>,
  // ZAR (NOT cents) — admin enters whole rand. Comparison is `price >= threshold * 100`.
  highValueReviewThreshold: {
    key: 'high_value_review_threshold',
    default: 20000,
    parse: (s) => {
      const n = parseInt(s, 10);
      return Number.isFinite(n) ? n : 20000;
    },
  } as FlagDefinition<number>,
  raffleSellerApplicationsEnabled: {
    key: 'raffle_seller_applications_enabled',
    default: false,
    parse: (s) => s === 'true' || s === '1',
  } as FlagDefinition<boolean>,
  rafflePoBoxAddress: {
    key: 'raffle_po_box_address',
    default: '',
    parse: (s) => s,
  } as FlagDefinition<string>,
  raffleMaxRelists: {
    key: 'raffle_max_relists',
    default: 5,
    parse: (s) => {
      const n = parseInt(s, 10);
      return Number.isFinite(n) ? n : 5;
    },
  } as FlagDefinition<number>,
} as const;

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async get<T>(flag: FlagDefinition<T>): Promise<T> {
    try {
      const row = await this.prisma.setting.findUnique({
        where: { key: flag.key },
      });
      if (!row) return flag.default;
      return flag.parse(row.value);
    } catch (err) {
      // Fail open to the default — never break a flow on a settings read
      this.logger.warn(
        `Settings read for "${flag.key}" failed: ${(err as Error).message}`,
      );
      return flag.default;
    }
  }

  async set(key: string, value: string): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }
}
