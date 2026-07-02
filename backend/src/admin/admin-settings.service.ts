import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';

/**
 * Admin marketplace settings — read and write the key/value Setting
 * table with metadata about each flag (label, hint, type, default,
 * group) so the admin UI knows how to render an editor for each one.
 *
 * Flag registry lives here (rather than reusing settings.service.ts's
 * FLAGS) because the admin UI needs richer metadata (label, hint,
 * group, input type) than the runtime accessor does. The two
 * registries are kept in sync manually — when adding a flag, add it
 * here AND to settings.service.ts FLAGS if it's referenced from
 * runtime code.
 */

export type SettingFlagType = 'boolean' | 'number' | 'text' | 'percent';

export interface SettingFlag {
  key: string;
  label: string;
  hint: string;
  group: string;
  type: SettingFlagType;
  default: string; // stored as string for parity with the underlying table
}

const FLAGS: SettingFlag[] = [
  // ─── Moderation ───────────────────────────────────────────────
  {
    key: 'claude_moderation_enabled',
    label: 'Claude moderation enabled',
    hint: 'Master switch for AI moderation on listing publish + Q&A. Turn off only for debugging — every listing will go straight to PENDING_REVIEW.',
    group: 'Moderation',
    type: 'boolean',
    default: 'true',
  },
  {
    key: 'claude_confidence_threshold',
    label: 'Claude confidence threshold',
    hint: 'Listings with Claude confidence below this go to HUMAN_REVIEW instead of APPROVE. 0.85 = strict, 0.65 = lenient.',
    group: 'Moderation',
    type: 'number',
    default: '0.85',
  },
  {
    key: 'new_seller_firearm_review_count',
    label: 'New seller firearm review count',
    hint: 'How many of a new seller\'s first firearm listings get forced to PENDING_REVIEW regardless of Claude verdict. Default 3.',
    group: 'Moderation',
    type: 'number',
    default: '3',
  },
  {
    key: 'high_value_review_threshold',
    label: 'High-value review threshold (R)',
    hint: 'Listings priced above this (in ZAR, not cents) always go to PENDING_REVIEW. Default R20,000.',
    group: 'Moderation',
    type: 'number',
    default: '20000',
  },

  // ─── Raffles ──────────────────────────────────────────────────
  {
    key: 'raffle_seller_applications_enabled',
    label: 'Raffle seller applications enabled',
    hint: 'When true, sellers can submit raffle prize applications from /sell. Default off until the application flow is built.',
    group: 'Raffles',
    type: 'boolean',
    default: 'false',
  },
  {
    key: 'raffle_po_box_address',
    label: 'Raffle PO Box address',
    hint: 'Free-entry postal address shown on every competition\'s free-entry PDF. CPA Section 36 requires this.',
    group: 'Raffles',
    type: 'text',
    default: '',
  },
  {
    key: 'raffle_max_relists',
    label: 'Raffle max relists',
    hint: 'How many times a raffle prize can be re-listed after a previous draw was cancelled. Default 5.',
    group: 'Raffles',
    type: 'number',
    default: '5',
  },

  // ─── Shipping ─────────────────────────────────────────────────
  {
    key: 'dg_lithium_wh_threshold',
    label: 'Lithium battery courier limit (Wh)',
    hint: 'A loose lithium battery (the battery_wh listing attribute) above this energy is forced collection-only — couriers won\'t carry >100 Wh loose cells (UN3480). Lower this if a carrier tightens its limit. Default 100.',
    group: 'Shipping',
    type: 'number',
    default: '100',
  },
];

@Injectable()
export class AdminSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  // List all flags with their CURRENT value (from DB) and metadata.
  // Frontend uses this to render the editor — type drives the input
  // widget, group drives section headers.
  async list(): Promise<(SettingFlag & { currentValue: string })[]> {
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: FLAGS.map((f) => f.key) } },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    return FLAGS.map((f) => ({
      ...f,
      currentValue: byKey.get(f.key) ?? f.default,
    }));
  }

  // Update a single flag. Validates the value against the flag's
  // declared type before writing — admin can't accidentally set a
  // boolean flag to "yes" instead of "true".
  async update(adminId: string, key: string, value: string, reason: string) {
    const flag = FLAGS.find((f) => f.key === key);
    if (!flag) {
      throw new BadRequestException(`Unknown setting key: ${key}`);
    }
    const trimmedReason = (reason ?? '').trim();
    if (trimmedReason.length < 3) {
      throw new BadRequestException(
        'Reason of ≥3 chars is required when editing a marketplace setting.',
      );
    }
    // Type validation
    if (flag.type === 'boolean') {
      if (value !== 'true' && value !== 'false') {
        throw new BadRequestException(
          `Setting ${key} expects "true" or "false", got "${value}"`,
        );
      }
    } else if (flag.type === 'number' || flag.type === 'percent') {
      const n = parseFloat(value);
      if (!Number.isFinite(n)) {
        throw new BadRequestException(
          `Setting ${key} expects a numeric value, got "${value}"`,
        );
      }
      if (flag.type === 'percent' && (n < 0 || n > 1)) {
        throw new BadRequestException(
          `Setting ${key} expects a value between 0 and 1, got ${n}`,
        );
      }
    }

    // Snapshot old value for audit
    const oldRow = await this.prisma.setting.findUnique({ where: { key } });
    const oldValue = oldRow?.value ?? flag.default;

    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });

    await this.audit.record({
      adminUserId: adminId,
      action: 'SETTING_UPDATE',
      resourceType: 'Setting',
      resourceId: key,
      oldValue,
      newValue: value,
      reason: trimmedReason,
    });

    return { key, value };
  }
}
