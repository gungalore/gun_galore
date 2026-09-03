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
    key: 'ops_alert_phone',
    label: 'Ops alert phone number',
    hint: 'Where urgent operations problems are texted — a failed nightly backup, or a backup that has stopped running. Leave EMPTY to send nothing. SA format, e.g. 0821234567.',
    group: 'Operations',
    type: 'text',
    default: '',
  },
  {
    key: 'ops_alert_types',
    label: 'Ops alert types',
    hint: 'Comma-separated AdminAlert types worth a text message. Deliberately short: 52 places raise urgent alerts, and texting all of them teaches you to ignore the channel. Widen one type at a time.',
    group: 'Operations',
    type: 'text',
    default: 'BACKUP_FAILED',
  },
  {
    key: 'ops_alert_quiet_hours',
    label: 'Hold ops alerts overnight',
    hint: 'Anything raised between 22:00 and 06:00 SAST is held until morning. A backup that failed at 02:10 will be just as broken at 07:00, and a 3am text for something that can wait gets the channel muted. Turn OFF to send immediately.',
    group: 'Operations',
    type: 'boolean',
    default: 'true',
  },
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
    hint: 'OFF = Pudo lockers ONLY — the door-delivery leg died with The Courier Guy integration (retired 2026-09-04), so flipping OFF now means locker parcels work and door parcels are refused at quote. ON = Bob Go behind both, quoting and booking every courier parcel. Needs BOBGO_API_KEY set on the server first — with the flag ON and no key, checkout shows no shipping options at all. Reversible: parcels already with a carrier stay with that carrier, so flipping back only affects new sales.',
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

  // ─── Motivations ──────────────────────────────────────────────
  // Mirrors of settings.service.ts FLAGS. Both registries or neither: a key
  // registered only there is invisible here and PATCH rejects it as unknown.
  {
    key: 'motivation_writer_enabled',
    label: 'Licence motivation writer enabled',
    hint: 'Master switch for the firearm-licence motivation writer. OFF = the whole module is invisible and no AI spend is possible. Turn ON only once the prompt frameworks, disclaimer and PDF template have been through the attorney, and ID_HASH_SECRET is confirmed set on the server — without that secret every generation throws at runtime.',
    group: 'Motivations',
    type: 'boolean',
    default: 'false',
    // Ships a legal-adjacent document to the public and spends real Anthropic
    // money on every generation. Exactly what the typed-key gate and the
    // longer audit reason exist for.
    danger: true,
  },
  {
    key: 'cip_sheet_enabled',
    label: 'Print the C.I.P. cartridge datasheet',
    hint: "Adds one page to a motivation: C.I.P.'s own datasheet for the cartridge applied for, with case and chamber dimensions, maximum and proof pressures, bore and groove diameters and rifling twist. It sits immediately after the firearm section. Turn this OFF if the licensing question about reproducing C.I.P.'s typeset page goes against us — the pack loses that page and nothing else, and the pressure and twist figures we quote elsewhere are unaffected because those are facts rather than C.I.P.'s drawing. A cartridge with no sheet on file simply does not get one either way.",
    group: 'Motivations',
    type: 'boolean',
    default: 'true',
  },
  {
    key: 'motivation_beta_free_cap',
    label: 'Free beta motivations',
    hint: 'How many motivations are generated free before the beta closes and the price applies. Seats are allocated atomically, so a seat taken above the cap is burned rather than reissued. Capped at 5000 in code — this number is the main guard against runaway AI spend.',
    group: 'Motivations',
    type: 'number',
    default: '100',
  },
  {
    key: 'motivation_price_cents',
    label: 'Motivation price (cents)',
    hint: 'What one motivation costs once the free beta is exhausted. 19900 = R199. Inert until card payments are live — until then everything past the cap is simply refused rather than charged.',
    group: 'Motivations',
    type: 'number',
    default: '19900',
  },
  {
    key: 'motivation_buyer_price_cents',
    label: 'Motivation price for firearm buyers (cents)',
    hint: 'Discounted price for someone who bought the firearm on All Outdoor. 9900 = R99. NOT YET WIRED — there is no voucher or store-credit system in the platform, so nothing reads this. It is here so the price lives in one place when that is built.',
    group: 'Motivations',
    type: 'number',
    default: '9900',
  },
  {
    key: 'motivation_max_gate_cycles',
    label: 'Max quality-gate retries',
    hint: 'How many times a motivation that fails the quality gate may go back to the applicant for more detail before it is marked FAILED for an admin. Each cycle costs a full generation, so this is a spend ceiling as much as a UX one.',
    group: 'Motivations',
    type: 'number',
    default: '2',
  },
  {
    key: 'motivation_retention_days',
    label: 'Motivation retention (days)',
    hint: 'How long a completed motivation and its scanned ID/licence documents are kept before the weekly purge deletes them (POPIA). 730 = two years, enough to cover an application, an appeal and a renewal. Lowering this deletes older records at the next run — it does not warn first.',
    group: 'Motivations',
    type: 'number',
    default: '730',
  },

  // ─── Licence Centre ─────────────────────────────────────────────
  // Mirrors of settings.service.ts FLAGS. Both registries, or neither.
  {
    key: 'licence_centre_enabled',
    label: 'Licence & Competency Centre enabled',
    hint: "Master switch for the member document vault. OFF = the whole module 404s and nothing can be uploaded. Turn ON only once ID_HASH_SECRET is confirmed set on the server — without it every upload throws at runtime, and nothing recovers a file written in that state.",
    group: 'Document Centre',
    type: 'boolean',
    default: 'false',
    danger: true,
  },
  {
    key: 'licence_centre_reminders_enabled',
    label: 'Licence expiry reminders enabled',
    hint: "Master switch for the nightly expiry sweep. OFF = documents are stored and dates are shown, but nothing is ever sent. Only dates a member has CONFIRMED are ever reminded on, whatever this is set to.",
    group: 'Document Centre',
    type: 'boolean',
    default: 'false',
    danger: true,
  },
  {
    key: 'licence_centre_sms_enabled',
    label: 'Licence reminders by SMS',
    hint: "Adds SMS to the reminder channels for AO Pro members. Spends real SMSPortal credits on every stage of every confirmed document — the largest recurring cost in this module. The in-app reminder is free and always on.",
    group: 'Document Centre',
    type: 'boolean',
    default: 'false',
    danger: true,
  },
  {
    key: 'licence_centre_max_credentials',
    label: 'Max documents per member',
    hint: 'How many documents one member may keep. Each is an encrypted file on our own disk. Most also cost a Claude read at upload: the safe photographs are never read for dates, as there is nothing printed on them to read, but any document filed without a type still pays one cheap call to sort it into a pile. 60 because the Centre now holds the whole application folder, not only the documents that expire: an ID copy, proof of address, confirmation of employment, three safe photographs, the installation shot and an activity log come to eight before a single licence, so a section 16 member with eight licensed firearms is already near 19. Capped at 500 in code.',
    group: 'Document Centre',
    type: 'number',
    default: '60',
  },

  // ─── Comms ────────────────────────────────────────────────────
  // Mirrors of settings.service.ts FLAGS. Both registries, or neither.
  {
    key: 'whatsapp_enabled',
    label: 'WhatsApp notifications enabled',
    hint: 'Master switch for the WhatsApp channel. OFF = nothing is ever sent over WhatsApp, whatever a member has chosen — which is why the member toggle can sit ON while it is greyed out as "coming soon". There is no WhatsApp sender wired up yet, so leave this OFF until one is live and Meta has approved the templates. The plan is shipping updates only at first, to build sender reputation before anything else is sent.',
    group: 'Comms',
    type: 'boolean',
    default: 'false',
    // Opens an outbound channel to real phone numbers through a third party
    // whose trust in us is the entire reason for starting small.
    danger: true,
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
