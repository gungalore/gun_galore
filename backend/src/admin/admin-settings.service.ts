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
  /**
   * Go-live switch: flipping this changes what the PUBLIC sees, spends
   * real money, or turns off a safety net — as opposed to the tuning
   * knobs (thresholds, hours, caps) that only nudge behaviour. The
   * admin UI renders danger rows with a red rail + a "go-live switch"
   * chip and refuses to unlock Save until the operator types the flag
   * key back, so a stray checkbox click can't ship a module.
   *
   * Server-side we ALSO demand a longer reason for these (below) —
   * the typed-key gate is UI-only and a curl with the admin JWT would
   * sail straight past it.
   */
  danger?: true;
}

/**
 * Minimum audit reason length. Ordinary knobs keep the historic 3
 * chars; danger flags need a real sentence, because the audit trail is
 * the only record of WHY a module went live and "asd" tells a future
 * reader (or a regulator) nothing.
 */
const REASON_MIN = 3;
const DANGER_REASON_MIN = 15;

const FLAGS: SettingFlag[] = [
  // ─── Moderation ───────────────────────────────────────────────
  {
    key: 'claude_moderation_enabled',
    label: 'Claude moderation enabled',
    hint: 'Master switch for AI moderation on listing publish + Q&A. Turn off only for debugging — every listing will go straight to PENDING_REVIEW.',
    group: 'Moderation',
    type: 'boolean',
    default: 'true',
    // Turning this OFF removes the automated safety net in front of
    // every public listing and dumps the whole queue on a human.
    danger: true,
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

  // ─── Shipping ─────────────────────────────────────────────────
  {
    key: 'bobgo_enabled',
    label: 'Bob Go courier rail',
    hint: 'OFF = Pudo lockers + The Courier Guy door delivery (the rail that has always run). ON = Bob Go behind both, quoting and booking every courier parcel. Needs BOBGO_API_KEY set on the server first — with the flag ON and no key, checkout shows no shipping options at all. Reversible: parcels already with a carrier stay with that carrier, so flipping back only affects new sales.',
    group: 'Shipping',
    type: 'boolean',
    default: 'false',
    // Spends real money (every booking bills the courier wallet) and swaps the
    // rail carrying every parcel on the platform. Exactly what the typed-key
    // gate and the longer audit reason exist for.
    danger: true,
  },
  {
    key: 'dg_lithium_wh_threshold',
    label: 'Lithium battery courier limit (Wh)',
    hint: 'A loose lithium battery (the battery_wh listing attribute) above this energy is forced collection-only — couriers won\'t carry >100 Wh loose cells (UN3480). Lower this if a carrier tightens its limit. Default 100.',
    group: 'Shipping',
    type: 'number',
    default: '100',
  },

  // ─── Deals ────────────────────────────────────────────────────
  // First-party "OneDayOnly-style" Daily Deals. house_seller_user_id is
  // deliberately NOT surfaced here — it's a system-seeded id with no
  // text validation and must not be hand-edited.
  {
    key: 'deals_enabled',
    label: 'Daily Deals enabled',
    hint: 'Master switch for the public Daily Deals surface. Leave OFF until the storefront ships — the admin deal builder works regardless.',
    group: 'Deals',
    type: 'boolean',
    default: 'false',
    // Flipping ON exposes the Daily Deals storefront to the public and
    // is gated on real suppliers + a live payments rail.
    danger: true,
  },
  {
    key: 'deal_drop_hour',
    label: 'Daily drop hour (SAST, 0–23)',
    hint: 'Hour of day the daily deal drop goes live, in SAST. 6 = 06:00. Values outside 0–23 are clamped.',
    group: 'Deals',
    type: 'number',
    default: '6',
  },
  {
    key: 'deal_default_per_customer_cap',
    label: 'Default per-customer cap',
    hint: 'Default maximum units one customer can buy of a new deal. Overridable per-deal in the builder. Default 10.',
    group: 'Deals',
    type: 'number',
    default: '10',
  },
  {
    key: 'deal_push_enabled',
    label: 'Deal drop push enabled',
    hint: 'Whether the daily drop sends a push/notification to subscribers. Default ON.',
    group: 'Deals',
    type: 'boolean',
    default: 'true',
  },
  {
    key: 'deal_extra_time_hours',
    label: 'Extra Time hours',
    hint: 'Auto-extend a live deal that reaches its end while stock remains, by this many hours (the "Extra Time" second-chance slot). 0 = off; a deal is extended at most once. Clamped 0–48.',
    group: 'Deals',
    type: 'number',
    default: '0',
  },
  {
    key: 'deal_po_email_enabled',
    label: 'Email deal POs to suppliers',
    hint: 'When ON, purchase orders are emailed to the supplier from Zoho at deal end. Keep OFF until real suppliers are live.',
    group: 'Deals',
    type: 'boolean',
    default: 'false',
    // Flipping ON sends real purchase orders to real third parties —
    // an outbound commercial commitment, not a display toggle.
    danger: true,
  },

  // ─── Verification ─────────────────────────────────────────────
  // The cheap Claude-vision ID flow: ~R3/seller (1-credit VerifyNow SA
  // ID Basic + Claude vision doc+selfie match) vs the legacy ~R59.80
  // Home Affairs photo pull + facematch. OFF = legacy flow runs
  // unchanged; flipping ON routes every new /kyc/verify session (whether
  // proactive from the profile page or forced at first payout) through
  // the wizard. Reversible — flip OFF and any mid-flow seller resumes the
  // legacy flow at the consent step. Keep VerifyNow credits funded before
  // turning ON for real seller volume.
  {
    key: 'kyc_claude_flow_enabled',
    label: 'Cheap Claude-vision ID verification',
    hint: 'ON = the ~R3/seller Claude-vision ID flow (1-credit SA ID Basic + selfie/document match, human review for borderline matches). OFF = the legacy ~R59.80 Home Affairs photo + facematch. Ensure VerifyNow credits are topped up before enabling for seller volume.',
    group: 'Verification',
    type: 'boolean',
    default: 'false',
    // Switches the identity-verification rail every new seller runs
    // through — an FICA/AML-relevant control, not a cost knob.
    danger: true,
  },
  {
    key: 'kyc_anchored_threshold_cents',
    label: 'Anchored KYC value threshold (cents)',
    hint: 'Sellers whose highest listing or pending payout is at/above this (in CENTS — 1000000 = R10,000) also get the official Home Affairs photo pulled (+10 credits) as a stronger high-value gate. Invisible to the seller; only applies while the Claude-vision flow is ON.',
    group: 'Verification',
    type: 'number',
    default: '1000000',
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
    // Danger (go-live) flags demand a real explanation — see the
    // DANGER_REASON_MIN note. The admin UI enforces the same minimum so
    // the operator is never surprised by a 400 here.
    const minReason = flag.danger ? DANGER_REASON_MIN : REASON_MIN;
    if (trimmedReason.length < minReason) {
      throw new BadRequestException(
        flag.danger
          ? `"${flag.label}" is a go-live switch — give a reason of at least ${DANGER_REASON_MIN} characters for the audit log.`
          : `Reason of ≥${REASON_MIN} chars is required when editing a marketplace setting.`,
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
