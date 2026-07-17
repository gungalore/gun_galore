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
  // P1.1 — Ask GG subscription pricing, ZAR CENTS per 31-day period.
  // Admin-tunable via the marketplace settings editor without a deploy.
  // Launch defaults: MEMBER R49/mo, PRO R149/mo (operator can change).
  subscriptionMemberPriceCents: {
    key: 'subscription_member_price_cents',
    default: 4900,
    parse: (s) => {
      const n = parseInt(s, 10);
      return Number.isFinite(n) && n > 0 ? n : 4900;
    },
  } as FlagDefinition<number>,
  subscriptionProPriceCents: {
    key: 'subscription_pro_price_cents',
    default: 14900,
    parse: (s) => {
      const n = parseInt(s, 10);
      return Number.isFinite(n) && n > 0 ? n : 14900;
    },
  } as FlagDefinition<number>,
  // Dangerous-goods gate — a loose lithium battery (the `battery_wh` attribute)
  // above this watt-hour value is forced collection-only, never couriered
  // (carriers won't carry >100 Wh loose cells, UN3480). Admin-tunable without a
  // deploy; fails open to 100 Wh so the gate can never silently widen.
  dgLithiumWhThreshold: {
    key: 'dg_lithium_wh_threshold',
    default: 100,
    parse: (s) => {
      const n = parseInt(s, 10);
      return Number.isFinite(n) && n > 0 ? n : 100;
    },
  } as FlagDefinition<number>,
  // ── Ask GG quota caps (Ask GG Everywhere) ──────────────────────────
  // Moved out of hardcoded consts in ask-gg-quota.service.ts so the
  // operator can tune spend live from /admin/settings without a deploy.
  // Defaults mirror the launch spec (OD3). All fail open to defaults.
  askGgFreeMsgCapPer30d: {
    key: 'ask_gg_free_msg_cap_per_30d',
    default: 5,
    parse: (s) => {
      const n = parseInt(s, 10);
      return Number.isFinite(n) && n >= 0 ? n : 5;
    },
  } as FlagDefinition<number>,
  askGgMemberMsgCapPerHour: {
    key: 'ask_gg_member_msg_cap_per_hour',
    default: 20,
    parse: (s) => {
      const n = parseInt(s, 10);
      return Number.isFinite(n) && n > 0 ? n : 20;
    },
  } as FlagDefinition<number>,
  askGgProMsgCapPerHour: {
    key: 'ask_gg_pro_msg_cap_per_hour',
    default: 60,
    parse: (s) => {
      const n = parseInt(s, 10);
      return Number.isFinite(n) && n > 0 ? n : 60;
    },
  } as FlagDefinition<number>,
  askGgFreePhotoCapPer30d: {
    key: 'ask_gg_free_photo_cap_per_30d',
    default: 5,
    parse: (s) => {
      const n = parseInt(s, 10);
      return Number.isFinite(n) && n >= 0 ? n : 5;
    },
  } as FlagDefinition<number>,
  // W6 two-lane quota — SUPPORT (site/account help) is FREE for every
  // signed-in tier; this is only the per-day ABUSE cap on that lane.
  askGgSupportMsgCapPerDay: {
    key: 'ask_gg_support_msg_cap_per_day',
    default: 20,
    parse: (s) => {
      const n = parseInt(s, 10);
      return Number.isFinite(n) && n >= 0 ? n : 20;
    },
  } as FlagDefinition<number>,
  // ── Daily Deals (DD-1) ─────────────────────────────────────────────
  // First-party "OneDayOnly-style" house deals. The house-seller User row
  // that every Deal listing is filed under; seeded by seed-house-seller.ts
  // and stored here so the DealsService can resolve it without a hardcoded
  // id. Empty string = not yet seeded (DealsService fails closed on create).
  // NOT exposed in the admin settings editor (free-text, no validation).
  houseSellerUserId: {
    key: 'house_seller_user_id',
    default: '',
    parse: (s) => s,
  } as FlagDefinition<string>,
  // Master on/off for the public Daily Deals surface. Inert until DD-2
  // ships the storefront; DD-1 builds everything behind this OFF.
  dealsEnabled: {
    key: 'deals_enabled',
    default: false,
    parse: (s) => s === 'true' || s === '1',
  } as FlagDefinition<boolean>,
  // Hour of day (SAST, 0–23) the daily drop goes live. Default 06:00.
  dealDropHour: {
    key: 'deal_drop_hour',
    default: 6,
    parse: (s) => {
      const n = parseInt(s, 10);
      if (!Number.isFinite(n)) return 6;
      return Math.min(23, Math.max(0, n));
    },
  } as FlagDefinition<number>,
  // Default per-customer purchase cap applied to a new Deal (admin can
  // override per-deal in the builder).
  dealDefaultPerCustomerCap: {
    key: 'deal_default_per_customer_cap',
    default: 10,
    parse: (s) => {
      const n = parseInt(s, 10);
      return Number.isFinite(n) && n > 0 ? n : 10;
    },
  } as FlagDefinition<number>,
  // Whether the daily drop fires a push/notification to subscribers.
  dealPushEnabled: {
    key: 'deal_push_enabled',
    default: true,
    parse: (s) => s === 'true' || s === '1',
  } as FlagDefinition<boolean>,
  // DD-4 — "Extra Time": hours to auto-extend a LIVE deal that reaches its
  // scheduled end while it still has stock (the OneDayOnly evening second-
  // chance slot). 0 = disabled (the deal just ends at endsAt). A deal is
  // extended at most ONCE (the EXTENDED window then ends at extendedUntil).
  dealExtraTimeHours: {
    key: 'deal_extra_time_hours',
    default: 0,
    parse: (s) => {
      const n = parseInt(s, 10);
      if (!Number.isFinite(n) || n < 0) return 0;
      return Math.min(48, n);
    },
  } as FlagDefinition<number>,
  // DD-F — JIT supplier fulfilment: when ON, a Zoho purchase order is
  // emailed to the supplier from Zoho Books at deal end. Keep OFF until
  // real suppliers are live so nothing is sent while the programme is inert.
  dealPoEmailEnabled: {
    key: 'deal_po_email_enabled',
    default: false,
    parse: (s) => s === 'true' || s === '1',
  } as FlagDefinition<boolean>,
  // ── Claude-vision KYC ──────────────────────────────────────────────
  // OFF = the legacy VerifyNow photo+facematch flow runs untouched. ON =
  // sellers verify via ID-document upload + live selfie judged by Claude,
  // with VerifyNow only doing the 1-credit SA ID (Basic) record check.
  // Flipping OFF mid-rollout is safe: in-flight sellers resume the legacy
  // flow (kycIdVerifiedAt is already set by the Details step).
  kycClaudeFlowEnabled: {
    key: 'kyc_claude_flow_enabled',
    default: false,
    parse: (s) => s === 'true' || s === '1',
  } as FlagDefinition<boolean>,
  // Value ceiling (ZAR cents) for the cheap tier. A seller whose highest
  // active listing / pending-payout sale is >= this gets the ANCHORED
  // check (official DHA photo pulled + matched) instead — resolved
  // server-side, invisible to the seller. Default R10,000.
  kycAnchoredThresholdCents: {
    key: 'kyc_anchored_threshold_cents',
    default: 1_000_000,
    parse: (s) => {
      const n = parseInt(s, 10);
      return Number.isFinite(n) && n >= 0 ? n : 1_000_000;
    },
  } as FlagDefinition<number>,
  // ── Dealer auto-registration ───────────────────────────────────────
  // When ON, an approved firearm dealer-transfer auto-adds the receiving
  // SAPS-licensed dealer (read off the SAP 534 + seller-supplied details)
  // into the Dealer directory as an INACTIVE, UNVERIFIED, source=AUTO
  // entry for an admin to review and activate. OFF = nothing is written
  // to the directory from the verification path (the legacy behaviour).
  // Never routes a live checkout on OCR alone — auto entries are inactive
  // until an admin activates them, regardless of this flag.
  dealerAutoRegisterEnabled: {
    key: 'dealer_auto_register_enabled',
    default: false,
    parse: (s) => s === 'true' || s === '1',
  } as FlagDefinition<boolean>,
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
