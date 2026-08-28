import {
  BadRequestException,
  GoneException,
  ServiceUnavailableException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as crypto from 'node:crypto';
import {
  MotivationLicenceType,
  MotivationStatus,
  MotivationUploadKind,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReferenceNumberService } from '../common/reference-number.service';
import { SecureFileStorageService } from '../common/secure-file-storage.service';
import {
  encryptJson,
  encryptText,
  decryptJson,
  tryDecryptText,
} from '../common/blob-crypto';
import {
  ProvenanceMap,
  automaticCount,
  automaticSources,
  changedKeys,
  markMember,
  parseProvenance,
  stamp,
} from '../common/answer-provenance';
import { MotivationQuotaService } from './motivation-quota.service';
import { CipSheetService } from './cip-sheet.service';
import { asLayout } from './motivation-pdf-layouts';
import { applicationBlockers } from './motivation-eligibility';
import { decideAutolink } from './motivation-autolink';
import { primaryUploadKind } from './motivation-credentials';
import { consentFormFor } from './motivation-consent-statement';
import { MotivationClaudeService } from './motivation-claude.service';
import {
  AnnexureImagePage,
  MotivationPdfService,
  asScheme,
  asFormat,
} from './motivation-pdf.service';
import {
  imageSize,
  isEmbeddable,
} from './motivation-annexure-layout';
import { buildLibrary, NEVER_REUSABLE } from './motivation-library';
import { VaultAdoptionService } from './vault-adoption.service';
import { VaultConsentService } from '../users/vault-consent.service';
import { SettingsService, FLAGS } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  planFor,
  followsPlan,
  fingerprint,
  maxSimilarity,
  SIMILARITY_REGENERATE_THRESHOLD,
  type SectionId,
} from './motivation-structure';
import type { FactPack } from './motivation-prompts';
import {
  buildAnnexures,
  buildChecklist,
  UPLOAD_KIND_LABELS,
  annexureByKind,
  type AnnexureEntry,
} from './motivation-checklist';
import { saps271Coverage } from './saps271-coverage';
import { MotivationSellerConsentService } from './motivation-seller-consent.service';
import { buildPriorNoticeRequest } from './motivation-prior-notice';
import { buildCompletedStatement } from './motivation-character-statement';
import { WITNESS_FORM_VERSION } from './motivation-witness-form';
import { readFile } from 'node:fs/promises';
import { FirearmImageService } from './motivation-firearm-image';
import { markForSection, type MarkName } from './motivation-pdf-marks';
import { MotivationWitnessService } from './motivation-witness.service';
import {
  asCoverChoice,
  checkCoverPhoto,
  COVER_ASPECT,
  COVER_FRAME_MM,
  COVER_MAX_PX,
} from './motivation-cover-photo';
import { packConsistency } from './motivation-verify';
import {
  FIELD_REGISTRY_VERSION,
  FIREARM_SOURCE_KEY,
  LICENCE_TYPE_LABELS,
  SOURCE_DEALER,
  SOURCE_ESTATE,
  SOURCE_PRIVATE,
  fieldByKey,
  fieldsFor,
  isVisible,
  missingRequired,
  sanitiseAnswers,
  SAPS271_FILL,
  SAPS271_OPT_KEY,
} from './motivation-fields';
import { decryptSaIdNumber } from '../common/id-crypto';
import {
  ExtractedField,
  MotivationExtractService,
} from './motivation-extract.service';
import {
  FOLLOW_UP_BATCH,
  fallbackQuestion,
  findGaps,
  gapBrief,
} from './motivation-gaps';
import { readSaId } from './sa-id';
import { Saps271Service } from './saps271.service';
import { overlapFromAnswers } from './motivation-overlap';
import {
  documentLabel,
  documentStatus,
  pickableKinds,
} from './motivation-documents';
import {
  ProfileSource,
  profileCoverageNote,
  profileOffer,
} from './motivation-profile';
import {
  asksPlace,
  uploadKindsFor,
  CredentialChoices,
  S16_AUTO_ATTACH,
  credentialChoices,
  validLongEnough,
  CredentialSource,
  credentialOffer,
  toIsoDay,
} from './motivation-credentials';

// ────────────────────────────────────────────────────────────────────
// The motivation lifecycle. Generation, the quality gate and the interview
// land in later commits — this is create / read / save / abandon / erase, plus
// the two gates that have to be right before any of that exists: the throttle
// and ownership.
//
// EVERY method starts with quota.assertEnabled(). Gating in the service rather
// than the controller means the cron, the admin path and HTTP all get the same
// check for free.
// ────────────────────────────────────────────────────────────────────

/**
 * Attorney-reviewed template + disclaimer versions, stamped on every document.
 * BUMP THESE whenever the PDF skeleton or the disclaimer text changes, so a
 * document produced under a reviewed version can be told apart from one
 * produced after an edit.
 */
const TEMPLATE_VERSION = 'tpl-2026-08-a';
const DISCLAIMER_VERSION = 'dis-2026-08-a';

/**
 * ⚠️ FIRST PERSON, LIKE EVERY OTHER WORD ON THE PAGE. Operator, 2026-08-21:
 * "do not refer to the applicant in the third person anywhere in the doc.
 * First person perspective as if it the applicant typing the document
 * always."
 *
 * This is the applicant's own motivation, signed by them and handed to the
 * Registrar by them. A disclaimer that switches to "the applicant confirms"
 * halfway down the last page announces that somebody else wrote the document
 * — which is both true and exactly the thing a reviewer should not be
 * thinking about while reading it.
 *
 * The legal content is unchanged: it still says the facts are mine, that it
 * is not legal advice, and that the decision is not ours to make. It says it
 * in the voice of the person signing.
 */
const DISCLAIMER_TEXT =
  'I prepared this motivation with assistance from All Outdoor, from ' +
  'information I supplied, and I submit it as my own. It is not legal ' +
  'advice. I confirm that the facts stated in it are true and correct to the ' +
  'best of my knowledge.';

/** How many same-type documents to compare against for sameness. */
/**
 * Upload limits.
 *
 * 10 MB matches the tier this codebase already uses for identity documents and
 * AI-backed uploads (kyc.controller.ts, transactions.controller.ts). It is a
 * SECOND check behind the interceptor's: multer aborts the request with a bare
 * 413, which is not something an applicant can act on, so the size is checked
 * again here where a readable message can be returned.
 *
 * The document cap exists so a runaway client cannot fill the encrypted store,
 * and it has to clear the largest legitimate pack with room to spare. Splitting
 * the safe photograph into three shots (2026-08-19) took the recommended set
 * for a dedicated licence from eight to ten, which left the old cap of twelve
 * with room for two extra documents — so sixteen, not twelve. A cap that a
 * thorough applicant can hit is a bug that only shows up in the field.
 */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_UPLOADS = 16;

const SIMILARITY_CORPUS = 200;

/**
 * Rough USD cost per million tokens, by model tier.
 *
 * DELIBERATELY APPROXIMATE and deliberately ours. There is no pricing API, and
 * a stale hardcoded rate that silently under-reports is worse than an obvious
 * estimate — so this is a planning figure for the admin spend card, not an
 * invoice. What matters is that it is RECORDED at all: org-level spend
 * alerting does not work on this box (the admin key is a regular key), so
 * these columns are the only per-document cost signal we have.
 *
 * Unknown models fall back to the flagship rate — over-estimating spend is the
 * safe direction.
 */
const MODEL_RATES_USD_PER_MTOK: Record<string, { in: number; out: number }> = {
  opus: { in: 15, out: 75 },
  sonnet: { in: 3, out: 15 },
  haiku: { in: 0.8, out: 4 },
};

export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const tier = /opus/i.test(model)
    ? 'opus'
    : /sonnet/i.test(model)
      ? 'sonnet'
      : /haiku/i.test(model)
        ? 'haiku'
        : 'opus';
  const rate = MODEL_RATES_USD_PER_MTOK[tier];
  const usd =
    (promptTokens / 1_000_000) * rate.in +
    (completionTokens / 1_000_000) * rate.out;
  // Six decimals, matching the Decimal(10,6) column.
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/**
 * The firearms the applicant already holds, read out of the numbered answer
 * fields and into a table the PDF can print.
 *
 * ⚠️ MAKE AND CALIBRE ARE THE IDENTITY, SERIALS ARE NOT PRINTED HERE. The
 * interview collects barrel and frame serials and the licence number for each
 * existing firearm, because the SAPS 271 asks for them — but a serial in a
 * table on a motivation is a line a reviewer has to check against a licence
 * that is already annexed, and getting it wrong is worse than omitting it.
 * The annexed licence copy is the evidence; this table is the summary.
 *
 * A row with no make AND no calibre is skipped rather than printed as a row
 * of dashes: the interview lets an applicant start firearm 2 and abandon it,
 * and half a row on a submission reads as carelessness.
 */
function existingFirearms(
  answers: Record<string, string>,
): { make: string; calibre: string; type: string; section: string }[] {
  const out: { make: string; calibre: string; type: string; section: string }[] =
    [];
  for (let i = 1; i <= 3; i++) {
    const make = (answers[`existing_firearm_${i}_make`] ?? '').trim();
    const calibre = (answers[`existing_firearm_${i}_calibre`] ?? '').trim();
    const type = (answers[`existing_firearm_${i}_type`] ?? '').trim();
    const licence = (answers[`existing_firearm_${i}_licence_no`] ?? '').trim();
    if (!make && !calibre) continue;
    out.push({
      make: make || '—',
      calibre: calibre || '—',
      type: type || '—',
      // The licence NUMBER, not the section, when we have it — that is what a
      // DFO looks up. "Licensed" alone when we do not, rather than a guess at
      // which section it was issued under.
      section: licence ? `Licence ${licence}` : 'Licensed',
    });
  }
  return out;
}

/**
 * "Howa 1500 bolt-action rifle, serial B742119" — the firearm, named once.
 *
 * Extracted because three surfaces need the identical string and were about
 * to hold three copies of it: the running footer of every page, the cover's
 * identification block, and the opening sentence of the prior-notice request.
 * A footer and a request that name the firearm differently is the kind of
 * inconsistency a reviewer notices and nobody testing would.
 */
function firearmLine(answers: Record<string, string>): string | undefined {
  const base = [answers.firearm_make, answers.firearm_type]
    .map((v) => (v ?? '').trim())
    .filter(Boolean)
    .join(' ');
  if (!base) return undefined;
  const serial = answers.firearm_serial?.trim();
  return serial ? `${base}, serial ${serial}` : base;
}

/**
 * Heading -> subject mark, read off the stored structure plan.
 *
 * ⚠️ NOTHING IS INVENTED WHEN THE PLAN IS MISSING. Motivations written before
 * plans were stored, and any row whose JSON does not parse, simply get no
 * marks — the document renders exactly as it does today. Guessing a mark from
 * the heading text would put a trophy beside a self-defence section the first
 * time somebody's wording happened to contain the word "hunt".
 */
function sectionMarksFor(
  plan: unknown,
  firearmType?: string,
): Record<string, MarkName> | undefined {
  const sections = (plan as { sections?: { id?: string; heading?: string }[] })
    ?.sections;
  if (!Array.isArray(sections)) return undefined;

  const out: Record<string, MarkName> = {};
  for (const s of sections) {
    if (!s?.id || !s?.heading) continue;
    const mark = markForSection(s.id as SectionId, firearmType);
    if (!mark) continue;
    // The renderer uppercases and strips a trailing colon before it draws.
    out[s.heading.replace(/:\s*$/, '').toUpperCase()] = mark;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Has this pack been paid for? Nothing else clears the watermark.
 *
 * ⚠️ THIS USED TO BE isSettled(), AND IT ALSO PASSED A FREE-BETA SEAT. The
 * reasoning was that a seat is "how the operator chose to give the first
 * members the product for nothing", so both meant entitled-to-a-clean-copy.
 * Operator, 2026-08-22: "remember to add a watermark as this is not been paid
 * for yet." A seat is a free seat, not a payment — `billedCents` is the only
 * column that records money — so a beta pack is watermarked like any other
 * unpaid one. `betaSeatNo` still governs the beta CAP; it never governs the
 * mark, which is why it is not read here at all.
 *
 * Payments are not live yet, so today this is almost always false and almost
 * every pack carries the mark. That is the correct default: the failure mode
 * of getting it wrong the other way is handing out the finished product for
 * nothing.
 */
export function isPaidFor(row: { billedCents: number }): boolean {
  return row.billedCents > 0;
}

/** Statuses where the applicant may still edit their answers. */
const EDITABLE: MotivationStatus[] = [
  MotivationStatus.DRAFT,
  MotivationStatus.INTERVIEW,
  MotivationStatus.NEEDS_MORE_INFO,
];

/**
 * Statuses a generation may be STARTED from.
 *
 * EDITABLE plus COMPLETED, and the addition is the point: a finished document
 * had no way back. Answering a follow-up, fixing a wrong make, or simply
 * wanting another attempt all left the applicant on a dead end — the button
 * refused with "This document is already being prepared", which was not even
 * true. The only route to a second draft was an admin editing the row by hand.
 *
 * ⚠️ GENERATING IS STILL EXCLUDED, and that is the whole reason this is a CAS.
 * Two clicks must not both call Claude. QUALITY_REVIEW is excluded for the same
 * reason — a pass is still in flight. FAILED and ABANDONED stay out: an admin
 * owns those.
 *
 * ⚠️ REGENERATING SPENDS REAL MONEY — a measured S16 run cost $1.64 — but it
 * does NOT take a second seat: the seat is claimed once per motivation, not
 * once per attempt (see the claim below). The ceiling is the controller's
 * 10-per-hour throttle.
 */
const REGENERABLE: MotivationStatus[] = [
  ...EDITABLE,
  MotivationStatus.COMPLETED,
];

@Injectable()
export class MotivationsService {
  private readonly logger = new Logger(MotivationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: MotivationQuotaService,
    private readonly refs: ReferenceNumberService,
    private readonly files: SecureFileStorageService,
    private readonly claude: MotivationClaudeService,
    private readonly pdf: MotivationPdfService,
    private readonly settings: SettingsService,
    private readonly extract: MotivationExtractService,
    private readonly cip: CipSheetService,
    private readonly saps271: Saps271Service,
    // ⚠️ NO CYCLE: the consent service depends on Prisma, SMS, storage,
    // tokens and notifications, and on nothing in here. Injected so section F
    // is read through the one place that knows how to decrypt it.
    private readonly sellerConsent: MotivationSellerConsentService,
    private readonly firearmImages: FirearmImageService,
    private readonly witnesses: MotivationWitnessService,
    // @Global — see the note in motivations.module.ts. Importing
    // NotificationsModule here would be the wrong instinct and risks a cycle.
    private readonly notifications: NotificationsService,
    // Keeping a copy of what they attach, where they have agreed to it.
    // ⚠️ Injected here rather than the Centre's own module — see the note
    // on the provider in motivations.module.ts.
    private readonly vaultAdoption: VaultAdoptionService,
    // Whether this member's documents may be offered across applications.
    // @Global UsersModule, so no module edge — see vault-consent.service.ts.
    private readonly vaultConsent: VaultConsentService,
  ) {}

  /**
   * Resolve the internal user. Stale dev-era rows have caused this exact
   * lookup to fail in production before, so it is an explicit, readable error
   * rather than a null-deref further down.
   */
  private async requireUser(clerkId: string): Promise<{ id: string }> {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** Own list. Metadata only — nothing is decrypted here. */
  async listMine(clerkId: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    const rows = await this.prisma.motivation.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        referenceNumber: true,
        licenceType: true,
        status: true,
        qualityScore: true,
        createdAt: true,
        completedAt: true,
        label: true,
      },
    });
    return rows.map((r) => ({
      ...r,
      licenceTypeLabel: LICENCE_TYPE_LABELS[r.licenceType],
    }));
  }

  /**
   * Start one.
   *
   * THE THROTTLE IS THE DATABASE, NOT THIS CODE. A check-then-insert would let
   * two simultaneous requests both pass the check. The unique index on
   * (userId, licenceType, applicationRef) is what actually enforces one
   * motivation per type per application; all we do here is turn its error into
   * something a human can read.
   */
  async create(
    clerkId: string,
    licenceType: MotivationLicenceType,
    applicationRef = '',
    /**
     * Answers to open with, on top of the profile prefill.
     *
     * Used by the Licence Centre's renewal one-tap: the vault already holds
     * the licence number, the expiry and the firearm's details, so a renewal
     * should not start by asking for them again. Sanitised through the same
     * registry as anything the applicant types — a seed is data, not a
     * shortcut past validation.
     */
    seed: Record<string, string> = {},
  ) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);

    if (!Object.values(MotivationLicenceType).includes(licenceType)) {
      throw new BadRequestException('Please choose a licence type.');
    }

    // Check the beta has room BEFORE allocating a reference number, so a
    // refused start does not burn an MO number. The seat itself is only
    // claimed at generation — starting a draft costs us nothing.
    const status = await this.quota.status();
    if (!status.canStart) {
      throw new ConflictException({
        message: status.enabled
          ? 'The free beta is full for now. We will open paid motivations shortly.'
          : 'Not available yet.',
        code: 'motivation-beta-cap-reached',
        cap: status.cap,
        used: status.used,
      });
    }

    const referenceNumber = await this.refs.allocate('MO');

    // WHAT WE ALREADY KNOW GOES IN NOW, not behind a consent screen.
    //
    // Operator, 2026-08-19: the personal section has to arrive already filled.
    // It is the member's own profile, on their own account, being used for
    // their own application — asking permission to show someone their own name
    // was ceremony, and it put a click between them and a form that should
    // already have been complete. The wizard says plainly where each value came
    // from and every one of them is editable.
    //
    // profileConsentAt is still stamped: "when did their profile data get used"
    // remains a question worth being able to answer.
    const prefill = profileOffer(
      licenceType,
      await this.profileFor(user.id),
      // Anything the caller already knows wins over the profile: a renewal's
      // licence number came off the document itself.
      seed,
    );

    // ✅ AND SO DOES THE VAULT. Operator, 2026-08-28: "The licenses already
    // captured needs to pull though into any new application as firearms I
    // already own... Automation and prefill is what we must get 100% correct
    // with these two centres."
    //
    // This is the SAME work useLicenceCentre() has always done — it just did
    // it behind a button the member had to find and press, on a form that had
    // already asked them for values we were holding. Every firearm licence in
    // the Licence Centre fills an owned-firearm row here, so a new application
    // opens already knowing what they own.
    //
    // ⚠️ PRECEDENCE IS DELIBERATE AND THE ORDER IS LOAD-BEARING: profile,
    // then vault, then seed. The vault beats the profile because it was read
    // off the member's own documents; the seed beats both because a renewal's
    // licence number came off the very licence being renewed. Getting this
    // backwards would let a stale profile value overwrite a document.
    //
    // ⚠️ AND IT IS PASSED THE PROFILE'S ANSWERS, not an empty object.
    // credentialOffer skips what is already answered, so handing it {} would
    // re-offer every field the profile just filled and the later spread would
    // silently prefer the vault's copy of a value the member maintains.
    //
    // ⚠️ A VAULT FAILURE COSTS THE PREFILL, NOT THE APPLICATION. This is the
    // module's own established rule — "An unreadable blob costs the autofill,
    // not the attachment" — and create() is the one path where breaking it
    // would be worst: a member who cannot reach their vault would be unable to
    // START an application at all, which is a far heavier failure than opening
    // one with empty firearm rows they can fill by hand.
    //
    // ⚠️ THE OFFER IS CAPTURED WHOLE, not `.values`. `items` is the only place
    // credentialOffer says WHICH vault document each value came from, and
    // chaining `.values` off the call — which is what this did — discarded it
    // at the call site. The empty default has to live in the same catch as the
    // values default or a vault failure desyncs the two.
    let vaultValues: Record<string, string> = {};
    let vaultItems: { key: string; from: string; credentialId: string }[] = [];
    try {
      const vaultOffer = credentialOffer(
        licenceType,
        // ⚠️ includeUnconfirmed, AND WITHOUT IT THIS FILLS NOTHING. The default
        // is confirmed-only, and the operator's vault holds five firearm
        // licences of which ZERO are confirmed — phone uploads arrive
        // unconfirmed and the confirm prompt only ever ran on the desktop
        // upload path. That is the normal state, not a corner case, so the
        // default here meant "What you own" was empty for everybody.
        //
        // Safe because credentialOffer now gates PER VALUE rather than per
        // document: an unconfirmed row may supply a make, a calibre or a
        // serial, and may not supply a date. The reminder sweep is untouched
        // — it reads Credential.expiresOn, which this path never writes.
        await this.credentialsFor(user.id, { includeUnconfirmed: true }),
        { ...prefill.values, ...seed },
      );
      vaultValues = vaultOffer.values;
      vaultItems = vaultOffer.items;
    } catch (err) {
      this.logger.warn(
        `Motivation create: Licence Centre prefill skipped — ${(err as Error).message}`,
      );
    }

    const { answers: seeded } = sanitiseAnswers(licenceType, {
      ...prefill.values,
      ...vaultValues,
      ...seed,
    });

    // ── where every one of those values came from ──────────────────
    //
    // ⚠️ STAMPED IN THE SAME PRECEDENCE ORDER AS THE VALUES, so the last
    // writer of a value is also the last writer of its provenance. Reversing
    // the order here would put a "From your profile" chip on a value the vault
    // supplied.
    //
    // ⚠️ AND ONLY FOR KEYS THAT SURVIVED sanitiseAnswers. It can reject a key
    // even from a trusted offer, and a provenance entry for a value that was
    // never written is a chip on an empty field.
    const provenance = this.stampOffers(
      {},
      seeded,
      prefill.from,
      vaultItems,
      // The renewal path seeds from the licence being renewed. We know it came
      // out of the Licence Centre; we do not get told which credential, so the
      // entry carries a source and no id. Better than no entry at all, which
      // would understate the count for the flow that starts best-informed.
      seed,
    );

    if (Object.keys(seeded).length) {
      this.logger.log(
        `Motivation create: prefilled ${Object.keys(seeded).length} field(s) — ` +
          `${Object.keys(provenance).length} attributed`,
      );
    }

    try {
      return await this.prisma.motivation.create({
        data: {
          referenceNumber,
          ...(Object.keys(seeded).length
            ? {
                answersEncrypted: encryptJson(seeded),
                answerProvenance: provenance as unknown as object,
                profileConsentAt: new Date(),
              }
            : {}),
          userId: user.id,
          licenceType,
          applicationRef: (applicationRef ?? '').trim(),
          status: MotivationStatus.DRAFT,
          // Fixed now, not at generation: an admin regenerating with a new seed
          // must be able to show WHY two documents differ, which means the seed
          // has to be a stored fact rather than something recomputed.
          variantSeed: crypto.randomInt(0, 2 ** 31 - 1),
          answersSchemaVersion: FIELD_REGISTRY_VERSION,
        },
        select: {
          id: true,
          referenceNumber: true,
          status: true,
          licenceType: true,
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException(
          `You already have a ${LICENCE_TYPE_LABELS[licenceType]} motivation in progress. Finish or delete it before starting another.`,
        );
      }
      throw err;
    }
  }

  /**
   * Full state for the wizard — decrypted answers, progress, uploads.
   *
   * Ownership is part of the WHERE clause, never an if-statement after the
   * fetch: a wrong id and someone else's id must be indistinguishable, and a
   * 404 leaks less than a 403.
   */
  async findOne(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);

    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      include: {
        uploads: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            kind: true,
            mimeType: true,
            byteSize: true,
            extractionOk: true,
            extractedFields: true,
            createdAt: true,
            purgedAt: true,
            // storageKey is deliberately NOT selected — the client never needs
            // it and it is the one value that addresses a file on our disk.
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            role: true,
            contentEncrypted: true,
            fieldKey: true,
            createdAt: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    const answers = this.readAnswers(row.answersEncrypted);

    return {
      id: row.id,
      referenceNumber: row.referenceNumber,
      licenceType: row.licenceType,
      licenceTypeLabel: LICENCE_TYPE_LABELS[row.licenceType],
      // The member's own name, or null if they have not set one — see
      // rename() below. Purely a list label; not an answer.
      label: row.label,
      status: row.status,
      fields: fieldsFor(row.licenceType),
      answers,
      missingRequired: missingRequired(row.licenceType, answers),
      // ⚠️ SURFACED WHILE THEY CAN STILL CHANGE THEIR MIND CHEAPLY. The same
      // rules block generation, but hearing "a rifle cannot be licensed under
      // section 13" the moment the firearm is described costs one edit;
      // hearing it at the Generate button costs a whole form's worth of work
      // in the wrong application type. Empty for anyone who has not yet said
      // what the firearm is.
      blockers: applicationBlockers(row.licenceType, answers),
      // Surfaced while they are still filling the form, not after a failed
      // gate. Someone who has just typed their existing firearms is in the
      // best position to explain why they need both — and being asked at that
      // moment reads as help, where being asked after a rejection reads as a
      // hurdle.
      overlap: (() => {
        const o = overlapFromAnswers(row.licenceType, answers);
        return o.needsJustification
          ? { needsJustification: true, prompt: o.prompt }
          : { needsJustification: false, prompt: null };
      })(),
      thinFields: row.thinFields,
      qualityScore: row.qualityScore,
      gateCycles: row.gateCycles,
      declarationAcceptedAt: row.declarationAcceptedAt,
      hasDocument: !!row.documentTextEncrypted,
      documentVersion: row.documentVersion,
      // Which of the fifty settings this pack is in - five layouts times ten
      // colourways. Validated on read because the columns are plain VARCHARs;
      // see asFormat/asScheme/asLayout.
      template: {
        format: asFormat(row.templateFormat),
        colourway: asScheme(row.templateColourway),
        layout: asLayout(row.templateLayout),
      },
      // ⚠️ WATERMARK UNTIL IT IS PAID FOR. Operator, 2026-08-19: "Be sure to
      // watermark any item that has not been paid for"; and again 2026-08-22,
      // of a beta-seated pack: "remember to add a watermark as this is not
      // been paid for yet." A free seat is not a payment — see isPaidFor.
      watermarked: !isPaidFor(row),
      editable: EDITABLE.includes(row.status),
      createdAt: row.createdAt,
      completedAt: row.completedAt,
      uploads: row.uploads,
      // Decrypt per row rather than in bulk: one unreadable message (a rotated
      // secret, a partial write) must not take the whole wizard down.
      messages: row.messages.map((m) => ({
        id: m.id,
        role: m.role,
        fieldKey: m.fieldKey,
        createdAt: m.createdAt,
        content: tryDecryptText(m.contentEncrypted) ?? '',
      })),
    };
  }

  /**
   * Merge a partial patch into the encrypted answer blob.
   *
   * READ-MODIFY-WRITE, single-user. Two devices editing the same motivation at
   * the same moment would have one overwrite the other's field — accepted:
   * this is one person's own document, and the alternative (per-field rows) is
   * a lot of machinery for a race nobody will hit. It is NOT accepted anywhere
   * money or state transitions are involved, which is why those use CAS.
   */
  async saveAnswers(
    clerkId: string,
    id: string,
    patch: Record<string, unknown>,
  ) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);

    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        licenceType: true,
        status: true,
        answersEncrypted: true,
        answerProvenance: true,
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    if (!EDITABLE.includes(row.status)) {
      throw new ConflictException(
        'This motivation is being generated or is already complete, so it can no longer be edited.',
      );
    }

    const { answers: clean, rejected, refused } = sanitiseAnswers(
      row.licenceType,
      patch,
    );
    // ⚠️ THE PREVIOUS ANSWERS ARE HELD, NOT INLINED INTO THE SPREAD. The next
    // three lines are the whole of "MEMBER always wins" and they need
    // something to compare against.
    const before = this.readAnswers(row.answersEncrypted);
    const merged = { ...before, ...clean };

    // ⚠️ changedKeys, NOT Object.keys(clean). THIS IS THE BUG THIS FEATURE
    // WOULD OTHERWISE SHIP WITH. The wizard sends a whole step back on every
    // save, so stamping the payload's keys would flip every prefilled field on
    // the step to MEMBER the first time somebody pressed Continue without
    // touching anything — silently, on a write that looks perfectly correct.
    // And MEMBER is absorbing: from that moment no vault re-sync or profile
    // re-consent could ever fill those fields again. Only a value that
    // actually differs is the member's doing.
    const provenance = markMember(
      parseProvenance(row.answerProvenance),
      changedKeys(before, merged),
    );

    await this.prisma.motivation.update({
      where: { id: row.id },
      data: {
        answersEncrypted: encryptJson(merged),
        answersSchemaVersion: FIELD_REGISTRY_VERSION,
        answerProvenance: provenance as unknown as object,
      },
    });

    const unknown = rejected.filter((k) => !refused.includes(k));
    if (unknown.length) {
      // Not an error — a stale client can legitimately send a key we have
      // since removed. Logged as KEYS ONLY; the values are the sensitive part.
      this.logger.warn(
        `Motivation ${row.id}: ignored unregistered answer keys ${unknown.join(', ')}`,
      );
    }
    if (refused.length) {
      // ⚠️ THIS ONE IS A DEFECT UNTIL PROVEN OTHERWISE. The wizard only offers
      // values the registry defines, so a registered field refusing its own
      // value means the two have drifted — which is exactly how `discipline`
      // silently discarded every one of its fifty-nine options. Keys only.
      this.logger.error(
        `Motivation ${row.id}: REFUSED values for registered fields ${refused.join(', ')} — the form and the validator disagree`,
      );
    }

    return {
      saved: Object.keys(clean).length,
      ignored: rejected,
      refused,
      missingRequired: missingRequired(row.licenceType, merged),
    };
  }

  /** Walk away without deleting — keeps the audit trail, frees nothing. */
  async abandon(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    // Stamped HERE as well as on completion. retentionPurgeAt used to be
    // written on exactly one branch — the transition to COMPLETED — so an
    // abandoned draft never got a date and its encrypted ID scans would have
    // sat on disk with nothing ever coming to look for them.
    const retentionDays = await this.settings.get(FLAGS.motivationRetentionDays);
    const res = await this.prisma.motivation.updateMany({
      where: { id, userId: user.id, status: { in: EDITABLE } },
      data: {
        status: MotivationStatus.ABANDONED,
        retentionPurgeAt: new Date(
          Date.now() + retentionDays * 24 * 60 * 60 * 1000,
        ),
      },
    });
    if (res.count === 0) {
      throw new NotFoundException('Motivation not found');
    }
    return { abandoned: true };
  }

  /**
   * SELF-SERVE POPIA ERASURE. Deletes the row, its messages, its upload rows
   * AND the encrypted files off our disk.
   *
   * This did not exist anywhere in the platform before — the only erasure path
   * was the Clerk user.deleted webhook, which nulls references and openly
   * admits it does not remove stored assets. It is affordable here because we
   * know exactly which files belong to a motivation.
   *
   * Files first, database second. A cascade cannot reach the filesystem, so
   * deleting the rows first would orphan the bytes with nothing left pointing
   * at them — undeletable except by hand.
   */
  async erase(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);

    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: { id: true, uploads: { select: { id: true, storageKey: true } } },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    let filesRemoved = 0;
    for (const up of row.uploads) {
      if (!up.storageKey) continue;
      try {
        await this.files.remove(up.storageKey);
        filesRemoved++;
      } catch (err) {
        // Keep going: one unreadable key must not strand the rest of an
        // erasure request. Logged loudly — a file we failed to delete is a
        // POPIA problem an operator has to know about.
        this.logger.error(
          `Erasure of motivation ${row.id}: could not remove ${up.storageKey}: ${(err as Error).message}`,
        );
      }
    }

    // Cascades take messages and uploads with it.
    await this.prisma.motivation.delete({ where: { id: row.id } });

    return { erased: true, filesRemoved };
  }

  // ────────────────────────────────────────────────────────────────
  // FILLING FROM THE PROFILE, WITH PERMISSION
  // ────────────────────────────────────────────────────────────────

  /** Load the profile fields we are allowed to look at, ID decrypted. */
  private async profileFor(userId: string): Promise<ProfileSource> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        idNumberEncrypted: true,
        addrBuilding: true,
        addrStreet: true,
        addrAddress2: true,
        addrSuburb: true,
        addrCity: true,
        addrPostalCode: true,
        addrProvince: true,
      },
    });

    // A stored ID that will not decrypt is not an error worth failing on: the
    // applicant types it instead, which is exactly what they would do if the
    // profile had never held one. Failing here would block the whole offer over
    // one field.
    let idNumber: string | null = null;
    if (u?.idNumberEncrypted) {
      try {
        idNumber = decryptSaIdNumber(u.idNumberEncrypted);
      } catch {
        idNumber = null;
      }
    }

    return {
      firstName: u?.firstName ?? null,
      lastName: u?.lastName ?? null,
      email: u?.email ?? null,
      phone: u?.phone ?? null,
      idNumber,
      addrBuilding: u?.addrBuilding ?? null,
      addrStreet: u?.addrStreet ?? null,
      addrAddress2: u?.addrAddress2 ?? null,
      addrSuburb: u?.addrSuburb ?? null,
      addrCity: u?.addrCity ?? null,
      addrPostalCode: u?.addrPostalCode ?? null,
      addrProvince: u?.addrProvince ?? null,
    };
  }

  /**
   * What we WOULD copy from the profile, and where each value came from.
   *
   * Read-only and safe to call before any decision — showing the applicant the
   * list is the whole point. Nothing is written until useProfile().
   */
  // ── the Licence Centre, read-only ─────────────────────────────────
  //
  // ⚠️ WHY THIS READS THE TABLE INSTEAD OF CALLING THE VAULT'S SERVICE.
  // LicenceCentreModule already imports MotivationsModule (it owns the renewal
  // one-tap), so importing it back would be a module cycle. The seam already
  // works this way in the other direction — licence-centre.service.ts reads
  // the Motivation table directly for its idempotency check while calling the
  // service for the write. The rule across this seam is: call the service to
  // WRITE, read the table to READ. Nothing here ever writes a Credential; the
  // confirmedAt invariant keeps its single owner.

  /**
   * Load the member's vault rows, decrypted, in a shape the pure offer can use.
   *
   * confirmedAt IS NOT NULL is not a nicety. An unconfirmed row holds an expiry
   * date nobody has checked, read off a photograph — the same reason the
   * reminder sweep will not look at one.
   */
  private async credentialsFor(
    userId: string,
    opts: { includeUnconfirmed?: boolean } = {},
  ): Promise<CredentialSource[]> {
    const rows = await this.prisma.credential.findMany({
      // ⚠️ THE CONFIRMATION GATE PROTECTS DATES, NOT NUMBERS. confirmedAt
      // exists so the reminder sweep never acts on an expiry nobody has
      // checked — that stays absolute. But the operator's phone-photographed
      // competency certificate sat here fully read and INVISIBLE to the
      // wizard's dropdown, because uploads from the phone arrive unconfirmed
      // and the confirm prompt only ever ran on the desktop's own upload
      // path. A member picking a certificate NUMBER from a dropdown is
      // looking at the value with the panel telling them to check it — that
      // needs no date ceremony first. Callers that fill things silently keep
      // the default.
      where: {
        userId,
        ...(opts.includeUnconfirmed ? {} : { confirmedAt: { not: null } }),
        purgedAt: null,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        kind: true,
        title: true,
        expiresOn: true,
        confirmedAt: true,
        // ⚠️ detailsEncrypted, NOT extractionEncrypted. This read was wrong in
        // two ways at once, and together they meant the vault could never fill
        // anything on a motivation, whatever the member uploaded.
        //
        // The Licence Centre puts what vision read into `detailsEncrypted` and
        // names its keys in `extractedFields`. It has never written
        // `extractionEncrypted` at all — that column is written only on
        // MotivationUpload, and on Credential it has always been null. So this
        // decrypted nothing, every time, silently.
        //
        // The schema's own comment on extractedFields said the values live in
        // extractionEncrypted, which is how the mistake looked correct while
        // being read. The comment is now fixed to match what the writer does.
        detailsEncrypted: true,
        extractionOk: true,
      },
    });

    return rows.map((r) => {
      let details: Record<string, string> = {};
      if (r.extractionOk && r.detailsEncrypted) {
        try {
          // ⚠️ AND THE SHAPE IS FLAT. The blob is the details object itself —
          // `encryptJson(reading.details)` — not `{ details: … }` wrapped. So
          // even against the right column the old `read?.details` would have
          // come back undefined and fallen through to {}.
          details =
            decryptJson<Record<string, string>>(r.detailsEncrypted) ?? {};
        } catch {
          // A row we cannot decrypt is a row we offer nothing from. It is not
          // an error the applicant can act on, and it must not stop the rest.
          details = {};
        }
      }
      return {
        id: r.id,
        kind: r.kind as string,
        title: r.title,
        expiresOn: r.expiresOn ? toIsoDay(r.expiresOn) : null,
        details,
        confirmed: r.confirmedAt !== null,
      };
    });
  }

  // ── the document library ──────────────────────────────────────────

  /**
   * Everything the member could reuse on this motivation.
   *
   * ⚠️ IT READS BOTH STORES, because neither is the library on its own — the
   * vault chases expiry and has no concept of an ID copy or a photograph of a
   * safe; those exist only as uploads. See motivation-library.ts.
   *
   * ⚠️ EVERY UPLOAD THE MEMBER OWNS, NOT JUST THIS PACK'S. That is the whole
   * point: the second application should not ask for the ID again. Scoped by
   * `motivation: { userId: user.id }`, which is the only thing standing
   * between one member's library and another's.
   */
  async library(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: { id: true, licenceType: true, status: true },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    const offerAcross = await this.vaultConsent.mayOfferAcross(user.id);

    const [credentials, uploads] = await Promise.all([
      this.prisma.credential.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          kind: true,
          title: true,
          createdAt: true,
          storageKey: true,
          purgedAt: true,
          sha256: true,
          expiresOn: true,
          // WHICH association document this is, where its kind covers several.
          // Without it a sworn good standing letter is indistinguishable from a
          // status card in the vault, and the good standing slot's reuse list
          // is empty however many the member holds — see motivation-library.
          disciplineType: true,
          // The date PRINTED on the document, which is what a proof of address
          // is judged on — not when it was photographed.
          issuedOn: true,
        },
      }),
      this.prisma.motivationUpload.findMany({
        // ⚠️ THE SCOPE NARROWS TO THIS APPLICATION WHERE SOMEBODY HAS SAID NO.
        //
        // Offering documents across applications is what the product already
        // does, so it is NOT switched off for people who have simply never
        // been asked — that would take a working feature away to punish them
        // for our omission. It stops for `declined` and `withdrawn`, the two
        // states where a person actually answered no.
        //
        // ⚠️ HERE, AND NOT INSIDE buildLibrary. That module's header promises
        // "rows in, list out, no Prisma, no clock", and the honest place to
        // narrow a result set is the query that produces it.
        where: {
          motivation: offerAcross ? { userId: user.id } : { id: row.id },
        },
        select: {
          id: true,
          motivationId: true,
          kind: true,
          createdAt: true,
          storageKey: true,
          purgedAt: true,
          sha256: true,
        },
      }),
    ]);

    const now = new Date();
    const items = buildLibrary(
      credentials.map((c) => ({
        ...c,
        issuedOn: c.issuedOn ? toIsoDay(c.issuedOn) : null,
      })),
      uploads,
      row.id,
      documentLabel,
      now,
    );

    // ── what a section 16 pack could be handed automatically ─────────
    //
    // ⚠️ OFFERED, NOT DONE. Attaching documents to somebody's licence
    // application without being asked is a decision made on their behalf
    // about what a DFO will see — and the one time it is wrong, they find out
    // at the counter. The list is returned and the wizard offers it in one
    // press; the press is theirs.
    //
    // ⚠️ NEVER THE ENDORSEMENT. It names ONE firearm, so a previous
    // application's endorsement describes the wrong gun. Status and good
    // standing describe the PERSON, and the person has not changed.
    const isS16 =
      row.licenceType === 'S16_DEDICATED_HUNTER' ||
      row.licenceType === 'S16_DEDICATED_SPORT';
    const expiryByCredential = new Map(
      credentials.map((c) => [
        c.id,
        c.expiresOn ? toIsoDay(c.expiresOn) : null,
      ]),
    );
    const suggested = !isS16
      ? []
      : items.filter(
          (i) =>
            S16_AUTO_ATTACH.includes(i.kind) &&
            !i.alreadyHere &&
            // Only vault documents carry an expiry we can judge. A previous
            // motivation's upload has no date on the row, so it is offered in
            // the library like anything else and simply not suggested.
            (i.source === 'credential'
              ? validLongEnough(
                  expiryByCredential.get(i.sourceId) ?? null,
                  now,
                )
              : false),
        );

    return { items, suggested };
  }

  /**
   * Attach a document the member already has, without asking for it again.
   *
   * ⚠️ THE BYTES ARE COPIED, NOT THE STORAGE KEY. Sharing one encrypted blob
   * between two motivations would mean the retention sweep purging one
   * application silently blanking a document in another — and the row that
   * lost its file would look, to its owner, exactly like a bug. A licence
   * card is under a megabyte; correctness is worth the disk.
   *
   * ⚠️ THE EXTRACTION IS COPIED TOO, when the source has one. Same file, same
   * kind, same answer — re-running vision would spend money to arrive back
   * where we started.
   */
  /**
   * Attach everything this application needs that the member already holds.
   *
   * Operator, 2026-08-24: "why can't the server add the relevant documents in
   * place and mark them green for me?"
   *
   * ⚠️ A POST, NEVER A SIDE EFFECT OF READING. The wizard calls this once when
   * the documents step is first opened. Attaching on a GET would mean a page
   * refresh, a poll or a second tab silently changing what is on somebody's
   * licence application — and the 20-second poll on that page would do it
   * every twenty seconds.
   *
   * ⚠️ CONSENT FIRST, AND `given` MEANS GIVEN. Not "has not said no". Reusing
   * vault documents unasked is new automatic processing and needs a yes;
   * mayKeep() is the one function allowed to answer that, so this asks it
   * rather than reading a column.
   *
   * Idempotent: a kind already attached is skipped, so calling it twice
   * attaches nothing twice.
   */
  async autolink(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        licenceType: true,
        status: true,
        autolinkedAt: true,
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    if (!EDITABLE.includes(row.status)) {
      return { attached: [], skipped: [], reason: 'not-editable' as const };
    }

    // ⚠️ ONCE PER APPLICATION, NOT ONCE PER PAGE LOAD, AND THIS GUARD IS THE
    // WHOLE DIFFERENCE BETWEEN A FEATURE AND A FIGHT. decideAutolink skips a
    // kind that is ALREADY ATTACHED — so the moment the member deleted a
    // document it was no longer attached, and the next load put it straight
    // back. The operator hit it within hours of the feature shipping: "why
    // can't I delete the proof of address?"
    //
    // A feature that silently undoes somebody's own deletions is worse than no
    // feature. The routing spec fills vault slots "at generator open", which
    // is once — so this records that it happened, and a delete stays deleted.
    if (row.autolinkedAt) {
      return { attached: [], skipped: [], reason: 'already-done' as const };
    }

    if (!(await this.vaultConsent.mayKeepFor(user.id))) {
      // Not an error: they have simply not agreed, or have withdrawn. The
      // library still offers everything for them to attach by hand.
      return { attached: [], skipped: [], reason: 'no-consent' as const };
    }

    // ⚠️ CREDENTIALS ONLY, NOT UPLOADS FROM OTHER APPLICATIONS. The freshness
    // rule needs a date we can stand behind, and only a vault credential
    // carries one the member has CONFIRMED. An upload on a previous
    // application has no date on the row at all, so "is it still valid" would
    // be unanswerable — and answering it anyway is how a stale document gets
    // attached silently. Those still appear in the library to be attached by
    // hand, where the member can see what they are.
    const [credentials, uploads] = await Promise.all([
      this.prisma.credential.findMany({
        where: {
          userId: user.id,
          storageKey: { not: null },
          purgedAt: null,
          // ⚠️ CONFIRMED DATES ONLY. An unconfirmed expiry is our reading of a
          // document, not the member's answer, and the whole freshness rule
          // rests on it.
          confirmedAt: { not: null },
        },
        select: {
          id: true,
          kind: true,
          coversKinds: true,
          disciplineType: true,
          title: true,
          expiresOn: true,
        },
      }),
      this.prisma.motivationUpload.findMany({
        where: { motivationId: row.id },
        select: { kind: true, sha256: true },
      }),
    ]);

    const wanted = documentStatus(row.licenceType, [], {}).needs.map(
      (n) => n.kind,
    );

    const candidates = credentials
      .map((c) => {
        // The slot it actually belongs in — disciplineType beats the primary
        // kind, so a sworn good standing letter is not offered as a card.
        const declared = (c.disciplineType ?? '').trim();
        const kind =
          declared && declared in MotivationUploadKind
            ? (declared as MotivationUploadKind)
            : primaryUploadKind(c.kind);
        return kind
          ? {
              sourceId: c.id,
              source: 'credential' as const,
              kind,
              expiresOn: c.expiresOn ? toIsoDay(c.expiresOn) : null,
              title: c.title,
            }
          : null;
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    const decision = decideAutolink(
      candidates,
      wanted,
      uploads.map((u) => u.kind),
      new Date(),
    );

    const attached: { kind: string; title: string }[] = [];
    for (const c of decision.attach) {
      try {
        await this.addFromLibrary(clerkId, id, c.source, c.sourceId);
        attached.push({ kind: c.kind, title: c.title });
      } catch (err) {
        // ⚠️ ONE FAILURE MUST NOT COST THE REST. A purged file or a
        // since-deleted credential is a reason to skip that document, not to
        // abandon the other five the member does hold.
        this.logger.warn(
          `Motivation ${row.id}: could not auto-attach ${c.kind}: ${
            (err as Error).message
          }`,
        );
      }
    }

    // ⚠️ STAMPED EVEN WHEN NOTHING WAS ATTACHED. "We looked and there was
    // nothing to add" is a completed run, and re-running it on every load
    // would re-attach whatever the member deletes between visits.
    await this.prisma.motivation.update({
      where: { id: row.id },
      data: { autolinkedAt: new Date() },
    });

    return {
      attached,
      // Said out loud, so "why is my competency not on here" has an answer
      // the member can read rather than a silence they have to guess at.
      skipped: decision.skipped.map((s) => ({
        kind: s.candidate.kind,
        title: s.candidate.title,
        why: s.why,
      })),
      reason: 'ok' as const,
    };
  }

  async addFromLibrary(
    clerkId: string,
    id: string,
    source: 'credential' | 'upload',
    sourceId: string,
    /**
     * "These are the safe at the address on this application."
     *
     * ⚠️ REQUIRED FOR EVERY PHOTOGRAPH OF THE SAFE — one kind since
     * 2026-08-23, plus the retired four an older application still carries;
     * asksPlace() is the authority. CHECKED HERE RATHER THAN IN THE
     * PICKER. A photograph of a safe is a photograph of one safe at one
     * dwelling; a member who has moved house and reuses last year's shots has
     * submitted pictures of somebody else's wall, and nothing on the file says
     * so. There is no structured address stored against the photograph to
     * compare with, and inferring one wrongly is the exact failure this whole
     * feature exists to avoid — so it is asked.
     *
     * The route is directly callable, so a tick the frontend renders is a
     * convenience and this is the check.
     */
    placeConfirmed = false,
  ) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      // licenceType and answersEncrypted are for the vision read below: the
      // extractor needs the licence type to know what it is looking at, and
      // the current answers to decide WHICH owned-firearm row a licence fills.
      select: {
        id: true,
        status: true,
        licenceType: true,
        answersEncrypted: true,
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    if (!EDITABLE.includes(row.status)) {
      throw new ConflictException('This application can no longer be changed.');
    }

    const count = await this.prisma.motivationUpload.count({
      where: { motivationId: row.id },
    });
    if (count >= MAX_UPLOADS) {
      throw new ConflictException(
        `An application can carry ${MAX_UPLOADS} documents. Remove one before adding another.`,
      );
    }

    // ⚠️ OWNERSHIP IS A WHERE CLAUSE, in both branches. A sourceId is a
    // client-supplied id: the only thing stopping it naming another member's
    // document is that the query cannot find one.
    let kind: MotivationUploadKind;
    /** Extra checklist rows this one attachment answers. See coversKinds. */
    let alsoSatisfies: MotivationUploadKind[] = [];
    let storageKey: string | null;
    let mimeType: string | null;
    let purgedAt: Date | null;
    let extraction: { ok: boolean; fields: string[]; blob: string | null } = {
      ok: false,
      fields: [],
      blob: null,
    };

    if (source === 'credential') {
      const c = await this.prisma.credential.findFirst({
        where: { id: sourceId, userId: user.id },
        select: {
          kind: true,
          storageKey: true,
          mimeType: true,
          purgedAt: true,
          detailsEncrypted: true,
          extractionOk: true,
        },
      });
      if (!c) throw new NotFoundException('Document not found');
      const mapped = uploadKindsFor(c.kind);
      if (!mapped.length) {
        throw new BadRequestException(
          'That document does not answer anything on this application.',
        );
      }
      // ⚠️ FILED AS THE FIRST, COUNTING FOR ALL OF THEM. A membership
      // certificate is both the association card and the letter of good
      // standing; a second row for the same bytes would collide with the
      // sha256 unique index and print the same page twice in the pack.
      kind = mapped[0];
      alsoSatisfies = mapped.slice(1);
      storageKey = c.storageKey;
      mimeType = c.mimeType;
      purgedAt = c.purgedAt;

      // ⚠️ READABILITY FIRST, AND IT IS NOT THE SAME QUESTION AS AUTOFILL.
      //
      // `suspect` — the amber "we could not read anything off it" — asks ONE
      // thing: did anybody ever successfully read this document? The vault
      // already answered that, in c.extractionOk. Carry it across verbatim.
      //
      // This line is the fix for a bug that survived two attempts because the
      // two questions were conflated. The `kept` filter below answers a
      // DIFFERENT question — which of the vault's values fit THIS form's boxes
      // — and it is an exact key-name match between two registries that name
      // the same things differently. The vault reads a licence as
      // {licence_number, make, calibre, frame_serial}; the motivation registry
      // wants {existing_firearm_1_licence_no, _make, _calibre, _frame_serial}.
      // The intersection is EMPTY, for that kind and for every dedicated-status
      // and proficiency kind too. Deriving `ok` from that intersection meant a
      // document the vault had read perfectly was reported as unreadable
      // whenever its field names happened not to collide — which was nine of
      // the ten kinds that reach here.
      //
      // Nothing is lost by not aliasing. Those values DO reach the member, via
      // credentialOffer (GET :id/credential-offer), which has the alias table,
      // the owned-firearm slot logic and the association-slot precedence, and
      // offers them for confirmation rather than writing them. Duplicating any
      // of that here would be a second copy of the hardest logic in the module
      // to serve a badge.
      extraction = { ok: c.extractionOk, fields: [], blob: null };

      // ⚠️ AND THE AUTOFILL ON TOP, where the names do line up.
      //
      // Nothing needs re-reading: the vault already ran vision over this
      // exact file and kept what it found. Copying it also means picking a
      // competency certificate from the list fills the number, the same as
      // photographing one.
      if (c.detailsEncrypted) {
        try {
          const details =
            decryptJson<Record<string, string>>(c.detailsEncrypted) ?? {};
          // ⚠️ ONLY KEYS THIS UPLOAD KIND ACTUALLY ANSWERS. A vault reading
          // carries things the motivation registry has no field for — a
          // holder name, what a competency covers — and offering those as
          // suggestions would propose values for boxes that do not exist.
          // ⚠️ NO ALIASING, DELIBERATELY. The vault reads `covers` off a
          // competency certificate and the registry has `competency_for`,
          // which look like the same thing and are not interchangeable:
          // competency_for is a MULTI field constrained to Handgun / Rifle /
          // Shotgun, and the vault's value is free text off a photograph
          // ("handgun and rifle", "H, R"). Mapping one to the other would put
          // an unmatchable value into a constrained box on a form somebody
          // signs. Only keys that match exactly cross over — which for a
          // competency certificate means the number, and the number is the
          // one that matters.
          const wanted = new Set(MotivationExtractService.wantedFor(kind));
          const kept = Object.fromEntries(
            Object.entries(details).filter(([k, v]) => wanted.has(k) && v),
          );
          if (Object.keys(kept).length > 0) {
            // ok is already true whenever the vault read it; restating it here
            // covers the row that carries values without extractionOk set.
            extraction = {
              ok: true,
              fields: Object.keys(kept),
              blob: encryptJson(kept),
            };
          }
        } catch {
          // An unreadable blob costs the autofill, not the attachment.
        }
      }
    } else {
      // ⚠️ THE SAME NARROWING, ON THE ROUTE THAT CAN BE CALLED DIRECTLY. A
      // list the frontend never renders is not a boundary.
      const offerAcross = await this.vaultConsent.mayOfferAcross(user.id);
      const u = await this.prisma.motivationUpload.findFirst({
        where: {
          id: sourceId,
          motivation: offerAcross ? { userId: user.id } : { id: row.id },
        },
        select: {
          kind: true,
          // Which application it was filed with — the whole question the
          // NEVER_REUSABLE check below is asking.
          motivationId: true,
          storageKey: true,
          mimeType: true,
          purgedAt: true,
          extractionOk: true,
          extractedFields: true,
          extractionEncrypted: true,
        },
      });
      if (!u) throw new NotFoundException('Document not found');
      // ⚠️ THE BOUNDARY IS HERE, NOT IN THE PICKER. buildLibrary already keeps
      // these out of the list, but this route is directly callable — and the
      // document it is protecting against is one that names a DIFFERENT
      // firearm by serial. A filter the client applies is a convenience; this
      // is the check.
      if (u.motivationId !== row.id && NEVER_REUSABLE.has(u.kind)) {
        throw new BadRequestException(
          'That document belongs to the application it was filed with and cannot be reused here.',
        );
      }
      kind = u.kind;
      storageKey = u.storageKey;
      mimeType = u.mimeType;
      purgedAt = u.purgedAt;
      extraction = {
        ok: u.extractionOk,
        fields: u.extractedFields,
        blob: u.extractionEncrypted,
      };
    }

    if (asksPlace(kind) && !placeConfirmed) {
      throw new BadRequestException(
        'Please confirm this is the safe at the address on this application.',
      );
    }

    if (!storageKey || purgedAt) {
      throw new GoneException(
        'That document is no longer stored, so it cannot be reused.',
      );
    }

    let bytes: Buffer;
    try {
      bytes = await this.files.read(storageKey);
    } catch (err) {
      this.logger.error(
        `Motivation ${row.id}: could not read library source ${sourceId}: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'We could not open that document just now. Please try again.',
      );
    }

    let stored: { storageKey: string; sha256: string; byteSize: number };
    try {
      stored = await this.files.write('motivations', bytes, new Date());
    } catch (err) {
      this.logger.error(
        `Motivation ${row.id}: could not store library copy: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'We could not store that document just now. Please try again.',
      );
    }

    // Already on this pack? The unique index says so — and the honest answer
    // is the row they already have, not an error about a mistake they did not
    // make.
    const existing = await this.prisma.motivationUpload.findFirst({
      where: { motivationId: row.id, sha256: stored.sha256 },
      select: { id: true, kind: true, byteSize: true, createdAt: true },
    });
    if (existing) {
      await this.files.remove(stored.storageKey).catch(() => undefined);
      return {
        id: existing.id,
        kind: existing.kind,
        label: documentLabel(existing.kind),
        byteSize: existing.byteSize,
        available: true,
        annexure: null,
        suggestions: [],
        alreadyHad: true,
      };
    }

    // ── READ THE DOCUMENT ITSELF, RATHER THAN TRANSLATING WHAT THE VAULT
    //    THOUGHT IT SAID ────────────────────────────────────────────────
    //
    // Operator, 2026-08-23: "Just use claude vision to extract the information
    // when preparing the motivation to insert the information into the
    // document."
    //
    // ⚠️ THIS REPLACES A KEY-MAPPING PROBLEM THAT HAD ALREADY PRODUCED FOUR
    // BUGS. The vault and the motivation registry name the same values
    // differently — a licence is read into the vault as
    // {licence_number, make, calibre, frame_serial} and the form wants
    // {existing_firearm_1_licence_no, _make, _calibre, _frame_serial} — so
    // carrying a reading across meant either an exact-name intersection that
    // was empty for nine of ten kinds, or a third copy of an alias table.
    //
    // Reading the bytes we have just copied sidesteps all of it: this
    // extractor emits registry keys BY CONSTRUCTION, and it owns the
    // owned-firearm slot logic (a licence describes one firearm and somebody
    // may attach four), which no alias table could have reproduced without
    // duplicating it.
    //
    // ⚠️ IT COSTS A VISION CALL PER PICK, which is what the vault copy was
    // avoiding. That trade is deliberate: the call is the same one
    // photographing the document would have cost, and the thing it buys is
    // the values actually landing in the boxes instead of a badge being the
    // right colour.
    //
    // ⚠️ ONLY WHERE THE VAULT HAS NOT ALREADY ANSWERED. A competency
    // certificate's number crosses over on an exact name match, for free —
    // paying to re-read it would spend money to learn what is already in
    // hand. So this runs when `extraction.fields` is empty, which is exactly
    // the set of kinds the intersection was failing.
    //
    // FAIL-SOFT, like every other read in this module: the bytes are stored
    // and the row is about to exist, so a timeout or a model outage costs the
    // autofill, not the attachment. The vault's readability verdict survives
    // underneath, so the row does not go amber just because the call failed.
    if (
      extraction.fields.length === 0 &&
      MotivationExtractService.canExtract(kind)
    ) {
      try {
        const fresh = await this.extract.extract({
          kind,
          licenceType: row.licenceType,
          bytes,
          mimeType: mimeType ?? 'image/jpeg',
          answers: this.readAnswers(row.answersEncrypted),
        });
        if (fresh.length > 0) {
          extraction = {
            ok: true,
            fields: fresh.map((f) => f.key),
            blob: encryptJson(
              Object.fromEntries(fresh.map((f) => [f.key, f.value])),
            ),
          };
        }
      } catch (err) {
        this.logger.warn(
          `Motivation ${row.id}: could not read library copy ${sourceId}: ${(err as Error).message}`,
        );
      }
    }

    const created = await this.prisma.motivationUpload.create({
      data: {
        motivationId: row.id,
        kind,
        coversKinds: alsoSatisfies,
        storageKey: stored.storageKey,
        mimeType: mimeType ?? 'image/jpeg',
        byteSize: stored.byteSize,
        sha256: stored.sha256,
        extractionOk: extraction.ok,
        extractedFields: extraction.fields,
        extractionEncrypted: extraction.blob,
      },
      select: { id: true, kind: true, byteSize: true },
    });

    // The values the source had already been read for, so picking a document
    // from the library fills the same boxes photographing it would have.
    let suggestions: { key: string; value: string; label: string }[] = [];
    if (extraction.ok && extraction.blob) {
      try {
        const read = decryptJson<Record<string, string>>(extraction.blob);
        suggestions = Object.entries(read ?? {}).map(([key, value]) => ({
          key,
          value,
          label: key,
        }));
      } catch {
        // A blob we cannot read costs a convenience, not the attachment.
      }
    }

    return {
      id: created.id,
      kind: created.kind,
      label: documentLabel(created.kind),
      byteSize: created.byteSize,
      available: true,
      annexure: null,
      suggestions,
      alreadyHad: false,
      // ⚠️ THE SAME VERDICT THE LIST WILL GIVE, SENT NOW. Without it the
      // checklist has no `suspect` to read, renders the row green, and then
      // flips it amber a second later when the next refresh arrives — which
      // is exactly what the operator saw with a proof of address that was
      // perfectly good. A row that changes its mind in front of somebody is
      // worse than one that was amber from the start.
      suspect:
        MotivationExtractService.canExtract(created.kind) && !extraction.ok,
    };
  }

  /**
   * Read an attached document again.
   *
   * ⚠️ ONE SHOT WAS NOT ENOUGH. extract() is fail-soft by design — a timeout,
   * a 529, any error at all returns [] and the upload survives, which is the
   * right trade. But nothing ever tried again, so a transient failure marked a
   * good document "we could not read anything on this" permanently, and the
   * copy blamed the photograph. Seen live: an address document that reads
   * perfectly on a second attempt, stored with extractionOk false.
   *
   * The bytes are already ours and the read is cheap. Offering it costs a
   * button; not offering it costs the applicant a document they cannot fix.
   */
  async rereadUpload(clerkId: string, id: string, uploadId: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: { id: true, licenceType: true, answersEncrypted: true },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    const up = await this.prisma.motivationUpload.findFirst({
      where: { id: uploadId, motivationId: row.id },
      select: {
        id: true,
        kind: true,
        storageKey: true,
        mimeType: true,
        purgedAt: true,
      },
    });
    if (!up) throw new NotFoundException('Document not found');
    if (!up.storageKey || up.purgedAt) {
      throw new GoneException('That document is no longer stored.');
    }
    if (!MotivationExtractService.canExtract(up.kind)) {
      // A photograph of a safe yields nothing by design; re-reading it would
      // spend a call to confirm that.
      return { ok: false, fields: [] as string[], readable: false };
    }

    const bytes = await this.files.read(up.storageKey);
    const found = await this.extract.extract({
      kind: up.kind,
      licenceType: row.licenceType,
      bytes,
      mimeType: up.mimeType ?? 'image/jpeg',
      answers: this.readAnswers(row.answersEncrypted),
    });

    // ⚠️ NEVER WORSE THAN BEFORE. A second failure must not wipe a reading
    // that succeeded earlier, so an empty result leaves the row untouched.
    if (!found.length) {
      return { ok: false, fields: [], readable: true };
    }

    const values = Object.fromEntries(found.map((f) => [f.key, f.value]));
    await this.prisma.motivationUpload.update({
      where: { id: up.id },
      data: {
        extractionOk: true,
        extractedFields: found.map((f) => f.key),
        extractionEncrypted: encryptJson(values),
      },
    });
    return { ok: true, fields: found.map((f) => f.key), readable: true };
  }

  /** What we WOULD fill from the vault, and which document each value is from. */
  async licenceCentreOffer(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: { id: true, licenceType: true, answersEncrypted: true },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    const answers = this.readAnswers(row.answersEncrypted);
    const credentials = await this.credentialsFor(user.id, {
      includeUnconfirmed: true,
    });
    // (This used to read "THE ONE-BUTTON FILL STAYS CONFIRMED-ONLY", drawing
    // the line between showing a value and writing one. The line moved on
    // 2026-08-28: credentialOffer gates per VALUE now, so both paths may take
    // facts from an unconfirmed document and neither may take a date.)
    const offer = credentialOffer(
      row.licenceType,
      credentials.filter((c) => c.confirmed),
      answers,
    );

    return {
      empty: offer.empty,
      items: offer.items,
      skipped: offer.skipped,
      /**
       * Everything they could pick from, per group — as opposed to `items`,
       * which is what we would fill if they said "just do it". Somebody
       * holding two competency certificates has to be asked which.
       *
       * ⚠️ IT INCLUDES WHAT THEY PHOTOGRAPHED ONTO A MOTIVATION, not only the
       * vault. The operator asked for this dropdown three times and it kept
       * coming back empty, because it only ever looked at Licence Centre
       * credentials — and the competency certificate somebody photographs
       * while filling in the form lands as a motivation upload, not a vault
       * row. A member who has just taken a photograph of the document and
       * still cannot pick it from the list is being told the feature does not
       * work, and they are right.
       */
      choices: await this.choicesFor(
        user.id,
        // An unconfirmed date shown as authoritative would be a small lie in
        // a dropdown label — say so instead.
        credentials.map((c) =>
          c.confirmed ? c : { ...c, title: `${c.title} — date not checked yet` },
        ),
      ),
      /** Vault documents that also satisfy a required upload on this pack. */
      // ⚠️ `.length`, NOT TRUTHINESS. This filtered on the map lookup itself,
      // which worked only while a kind that fills nothing was ABSENT from the
      // map. Now that it is present as an empty array — so the compiler can
      // enforce exhaustiveness — an empty array is truthy, and the bare lookup
      // would report a Professional Hunter registration as a document
      // satisfying zero checklist rows.
      documents: credentials
        .filter((c) => uploadKindsFor(c.kind).length > 0)
        .map((c) => ({
          credentialId: c.id,
          title: c.title,
          kind: c.kind,
          satisfies: uploadKindsFor(c.kind),
          expiresOn: c.expiresOn,
        })),
    };
  }

  /**
   * Pickable documents, from BOTH stores.
   *
   * The vault half is pure (`credentialChoices`). The upload half has to
   * decrypt, so it lives here: a motivation upload of the right kind whose
   * extraction actually yielded the field becomes a choice named after the
   * document it fills.
   */
  private async choicesFor(
    userId: string,
    credentials: CredentialSource[],
  ): Promise<CredentialChoices> {
    const base = credentialChoices(credentials);

    const rows = await this.prisma.motivationUpload.findMany({
      where: {
        motivation: { userId },
        kind: {
          in: [
            'COMPETENCY_CERTIFICATE',
            'ASSOCIATION_CARD',
            'GOOD_STANDING_LETTER',
          ],
        },
        extractionOk: true,
        purgedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        kind: true,
        createdAt: true,
        extractionEncrypted: true,
      },
    });

    // ⚠️ DEDUPED ON THE VALUE, NOT THE ROW. The same certificate photographed
    // onto two motivations, or held in the vault AND photographed, would
    // otherwise appear two and three times — and a list of identical entries
    // is not a choice.
    const seen = new Set<string>();
    for (const c of base.competency) seen.add(c.values.competency_number ?? '');
    for (const c of base.dedicated) seen.add(c.values.association_number ?? '');

    for (const r of rows) {
      if (!r.extractionEncrypted) continue;
      let read: Record<string, string> = {};
      try {
        read = decryptJson<Record<string, string>>(r.extractionEncrypted) ?? {};
      } catch {
        continue;
      }
      const when = toIsoDay(r.createdAt);
      if (r.kind === 'COMPETENCY_CERTIFICATE') {
        const number = (read.competency_number ?? '').trim();
        if (!number || seen.has(number)) continue;
        seen.add(number);
        base.competency.push({
          credentialId: `upload:${r.id}`,
          title: `Competency certificate you photographed (${when})`,
          expiresOn: (read.competency_expiry ?? '').trim() || null,
          values: { competency_number: number },
        });
        continue;
      }
      const name = (read.association_name ?? '').trim();
      const number = (read.association_number ?? '').trim();
      if (!name && !number) continue;
      if (number && seen.has(number)) continue;
      if (number) seen.add(number);
      const values: Record<string, string> = {};
      if (name) values.association_name = name;
      if (number) values.association_number = number;
      base.dedicated.push({
        credentialId: `upload:${r.id}`,
        title:
          r.kind === 'GOOD_STANDING_LETTER'
            ? `Letter of good standing you photographed (${when})`
            : `Dedicated status you photographed (${when})`,
        expiresOn: null,
        values,
      });
    }

    return base;
  }

  /** They agree, and we copy. Same write path as every other answer. */
  async useLicenceCentre(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        licenceType: true,
        status: true,
        answersEncrypted: true,
        answerProvenance: true,
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    if (!EDITABLE.includes(row.status)) {
      throw new ConflictException('This application can no longer be edited.');
    }

    const answers = this.readAnswers(row.answersEncrypted);
    const offer = credentialOffer(
      row.licenceType,
      // ⚠️ includeUnconfirmed, TO MATCH create(). These two fill the same
      // fields from the same vault through the same pure function, and leaving
      // them different meant a NEW application picked up the member's licences
      // while pressing the button on an EXISTING one found nothing — with the
      // operator's own five licences, all unconfirmed, that is the difference
      // between working and looking broken.
      //
      // What used to make confirmed-only right here was that this path writes
      // without the member seeing each value. That is still true, and it is
      // now handled where it belongs: credentialOffer gates PER VALUE, so an
      // unconfirmed document supplies facts and never a date. The reminder
      // sweep reads Credential.expiresOn, which this path does not write.
      await this.credentialsFor(user.id, { includeUnconfirmed: true }),
      answers,
    );

    // Through sanitiseAnswers like every other write. The vault's contents are
    // the member's own, but they were read off a photograph by a model and
    // they still have to satisfy the registry.
    const { answers: clean } = sanitiseAnswers(row.licenceType, offer.values);
    const merged = { ...answers, ...clean };

    // offer.items is where credentialOffer says WHICH document each value came
    // from. It has always been computed here and never read.
    const provenance = this.stampVault(
      parseProvenance(row.answerProvenance),
      clean,
      offer.items,
    );

    await this.prisma.motivation.update({
      where: { id: row.id },
      data: {
        answersEncrypted: encryptJson(merged),
        answersSchemaVersion: FIELD_REGISTRY_VERSION,
        answerProvenance: provenance as unknown as object,
      },
    });

    this.logger.log(
      `Motivation ${row.id}: prefilled ${Object.keys(clean).length} field(s) from the Licence Centre`,
    );

    return {
      filled: Object.keys(clean).length,
      answers: merged,
      missingRequired: missingRequired(row.licenceType, merged),
    };
  }

  async profilePrefillOffer(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        licenceType: true,
        answersEncrypted: true,
        profileConsentAt: true,
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    const answers = this.readAnswers(row.answersEncrypted);
    const offer = profileOffer(
      row.licenceType,
      await this.profileFor(user.id),
      answers,
    );

    return {
      alreadyConsented: row.profileConsentAt !== null,
      fields: Object.entries(offer.values).map(([key, value]) => ({
        key,
        label: fieldByKey(row.licenceType, key)?.label ?? key,
        value,
        from: offer.from[key],
      })),
      missingFromProfile: offer.missingFromProfile,
      note: profileCoverageNote(offer),
    };
  }

  /**
   * The applicant agrees, and we copy.
   *
   * Consent is stamped on THIS motivation, not on the account: agreeing once
   * is not agreeing forever, and a timestamp on the row is what answers "who
   * allowed this, and when" later.
   */
  async useProfile(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        licenceType: true,
        status: true,
        answersEncrypted: true,
        answerProvenance: true,
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    if (!EDITABLE.includes(row.status)) {
      throw new ConflictException('This application can no longer be edited.');
    }

    const answers = this.readAnswers(row.answersEncrypted);
    const offer = profileOffer(
      row.licenceType,
      await this.profileFor(user.id),
      answers,
    );

    // Through sanitiseAnswers like every other write. Profile data is ours, but
    // it is still user-entered text and it still has to satisfy the registry.
    const { answers: clean } = sanitiseAnswers(row.licenceType, offer.values);
    const merged = { ...answers, ...clean };

    // offer.from is the plain-English source per field — "your account name",
    // "the ID number from your identity check". Computed here since the offer
    // was written and, until now, read only by the preview endpoint.
    const provenance = this.stampProfile(
      parseProvenance(row.answerProvenance),
      clean,
      offer.from,
    );

    await this.prisma.motivation.update({
      where: { id: row.id },
      data: {
        answersEncrypted: encryptJson(merged),
        answersSchemaVersion: FIELD_REGISTRY_VERSION,
        answerProvenance: provenance as unknown as object,
        profileConsentAt: new Date(),
      },
    });

    // Logged rather than recorded as an activity event: ActivityService is not
    // injected here, and the consent timestamp on the row is the record that
    // actually matters.
    this.logger.log(
      `Motivation ${row.id}: prefilled ${Object.keys(clean).length} field(s) from profile with consent`,
    );

    return {
      filled: Object.keys(clean).length,
      missingRequired: missingRequired(row.licenceType, merged),
    };
  }

  // ────────────────────────────────────────────────────────────────
  // UPLOADS — the annexures, and the only writer to the encrypted store
  // ────────────────────────────────────────────────────────────────

  /**
   * Accept one supporting document.
   *
   * The bytes go to SecureFileStorageService, never to Cloudinary. Every other
   * upload in this codebase lands on a PUBLIC Cloudinary secure_url, which is
   * fine for a photograph of a tent and unthinkable for someone's identity
   * document — the operator's own instruction was to keep these on our own
   * server, encrypted.
   *
   * ORDER MATTERS: bytes first, row second, and if the row fails the bytes are
   * removed again. The other order would leave a row pointing at a file that
   * does not exist; this order's failure leaves nothing behind at all.
   */
  async addUpload(
    clerkId: string,
    id: string,
    /**
     * NULL MEANS "SORT IT FOR ME".
     *
     * A member uploading a whole pack at once cannot pick a type per file
     * before the files exist, so the batch path sends no kind and the document
     * is named from its contents. A kind they DID choose is never overruled.
     */
    kind: MotivationUploadKind | null,
    file: { buffer: Buffer; mimetype: string },
    /**
     * Skip the vision read.
     *
     * Set by the Licence Centre's renewal one-tap, which is copying a document
     * it has ALREADY read and whose values it has already seeded. Reading it a
     * second time would spend a model call to learn what we just wrote.
     */
    opts: { skipExtraction?: boolean } = {},
  ) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);

    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: { id: true, status: true, licenceType: true, answersEncrypted: true },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    if (!EDITABLE.includes(row.status)) {
      throw new ConflictException(
        'This application can no longer be edited, so documents cannot be added.',
      );
    }

    if (!file?.buffer?.length) {
      throw new BadRequestException('That file appears to be empty.');
    }
    if (file.buffer.length > MAX_UPLOAD_BYTES) {
      throw new BadRequestException('That file is larger than 10 MB.');
    }

    const count = await this.prisma.motivationUpload.count({
      where: { motivationId: row.id },
    });
    if (count >= MAX_UPLOADS) {
      throw new ConflictException(
        `An application can carry ${MAX_UPLOADS} documents. Remove one before adding another.`,
      );
    }

    // NAME IT, if they did not. Before the row, because the kind is a column
    // on it — and fail-soft: an unsortable document becomes OTHER, which reads
    // as unsorted rather than as a satisfied requirement.
    let resolved: MotivationUploadKind = kind ?? 'OTHER';
    let autoFiled = false;
    let confident = false;
    if (!kind) {
      const guess = await this.extract
        .classify({ bytes: file.buffer, mimeType: file.mimetype })
        .catch(() => null);
      autoFiled = true;
      if (guess) {
        resolved = guess.kind;
        confident = guess.confident;
      }
    }

    // Written before the row so a duplicate is detected by the DATABASE rather
    // than by reading first and writing after — that read-then-write is a race,
    // and two uploads of one file arriving together would both survive it.
    let stored: { storageKey: string; sha256: string; byteSize: number };
    try {
      stored = await this.files.write('motivations', file.buffer, new Date());
    } catch (err) {
      // SecureFileStorageService throws PLAIN Errors — an unconfigured
      // ID_HASH_SECRET among them. Unwrapped, those become a 500 with a stack
      // trace instead of something an applicant can act on.
      this.logger.error(
        `Motivation ${row.id}: could not store upload: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'We could not store that document just now. Please try again.',
      );
    }

    try {
      const created = await this.prisma.motivationUpload.create({
        data: {
          motivationId: row.id,
          kind: resolved,
          storageKey: stored.storageKey,
          mimeType: file.mimetype,
          byteSize: stored.byteSize,
          sha256: stored.sha256,
        },
        select: { id: true, kind: true, byteSize: true, createdAt: true },
      });

      // READ IT, if there is anything on it worth reading.
      //
      // FAIL-SOFT: the bytes are already stored and the row already exists, so
      // an unreadable photograph or a model outage costs the applicant a
      // convenience, not their upload. extractionOk stays false and they type
      // the values themselves — which is what they would have done anyway.
      //
      // The suggestions are NOT written into their answers here. They are
      // returned for confirmation: a misread digit in an ID number would
      // otherwise become a false statement on a form they sign.
      let suggestions: ExtractedField[] = [];
      if (!opts.skipExtraction && MotivationExtractService.canExtract(resolved)) {
        try {
          suggestions = await this.extract.extract({
            kind: resolved,
            licenceType: row.licenceType,
            bytes: file.buffer,
            mimeType: file.mimetype,
            // Decides which "firearms you already own" row a licence fills.
            // Without it every licence lands on row 1 and the second upload
            // overwrites the first.
            answers: this.readAnswers(row.answersEncrypted),
          });
          await this.prisma.motivationUpload.update({
            where: { id: created.id },
            data: {
              extractionOk: suggestions.length > 0,
              // KEYS only in the clear — the registry is not PII, the values
              // are. The values themselves are encrypted.
              extractedFields: suggestions.map((f) => f.key),
              extractionEncrypted: suggestions.length
                ? encryptJson(
                    Object.fromEntries(suggestions.map((f) => [f.key, f.value])),
                  )
                : null,
            },
          });
        } catch (err) {
          this.logger.warn(
            `Motivation ${row.id}: extraction failed for upload ${created.id}: ${(err as Error).message}`,
          );
        }
      }

      // ── the firearm, off whatever this document is ──────────────────
      //
      // Operator, 2026-08-28: "Can we write the ai to accepts any kind of
      // document and process the information on it? As we need the firearm
      // details and not the details of the owner for this part."
      //
      // ⚠️ A SECOND READ, NOT A REPLACEMENT. extract() above answers "what does
      // a document of this KIND carry" and is right for an ID or a proof of
      // address. This answers "what firearm is this about", which no
      // classifier needs to have recognised the genre to do — and the genre is
      // exactly what an applicant holding "atleast something" cannot promise.
      //
      // ⚠️ ONLY ON KINDS THAT COULD DESCRIBE A FIREARM. A second vision call on
      // a safe photograph or a municipal bill would spend money to find
      // nothing, and give a model the chance to invent a firearm from a stray
      // number on the page.
      //
      // ⚠️ AND IT NEVER OVERWRITES THE KIND EXTRACTOR. Those suggestions came
      // from a document we had identified; these came from one we had not. On
      // a key both produced, the identified read wins.
      if (
        !opts.skipExtraction &&
        MotivationExtractService.readsFirearm(resolved)
      ) {
        try {
          const firearm = await this.extract.readFirearm({
            bytes: file.buffer,
            mimeType: file.mimetype,
          });
          const already = new Set(suggestions.map((f) => f.key));
          // ⚠️ ONLY FIELDS THE APPLICANT CAN ACTUALLY SEE. Six of the firearm
          // fields (the barrel / frame / receiver rows and their makes) are
          // formOnly, so they exist only once somebody has opted into having
          // the SAPS 271 filled. Offering a value for a box that is not on
          // screen produces a "we read 7 things" panel listing fields the
          // applicant cannot find, which reads as the feature being broken.
          //
          // isVisible also covers the conditional fields generally, so this
          // stays correct if any firearm field later hangs off a showIf.
          const answersNow = this.readAnswers(row.answersEncrypted);
          const visible = new Set(
            fieldsFor(row.licenceType)
              .filter((f) => isVisible(f, answersNow))
              .map((f) => f.key),
          );
          for (const [key, value] of Object.entries(firearm)) {
            if (already.has(key) || !visible.has(key)) continue;
            suggestions.push({
              key,
              value,
              // Read without knowing what the document is, so it is offered
              // for confirmation like everything else here rather than
              // trusted outright.
              trusted: false,
              note: 'Read off the document you uploaded — check it against the paperwork.',
            } as (typeof suggestions)[number]);
          }
        } catch (err) {
          // Same rule as above: a failed read costs the convenience, never
          // the upload.
          this.logger.warn(
            `Motivation ${row.id}: firearm read failed for upload ${created.id}: ${(err as Error).message}`,
          );
        }
      }

      // KEEP A COPY, WHERE THEY HAVE AGREED TO IT.
      //
      // "When a person does their first application, WE need to store all the
      // attachments they save" — operator, 2026-08-22. A motivation upload
      // dies with its application on a two-year clock; this is what lets the
      // reusable half outlive it.
      //
      // ⚠️ AFTER THE ROW, OUTSIDE ITS TRY, AND SWALLOWED. An application must
      // never fail because the Centre was full, or the disk hiccuped, or a
      // consent lookup timed out. The upload is the thing the member came to
      // do; the copy is a convenience on top of it.
      //
      // adoptUpload itself decides whether there is consent and whether this
      // kind is worth keeping — nothing here needs to know.
      void this.vaultAdoption
        .adoptUpload(user.id, created.id)
        .catch((err: unknown) =>
          this.logger.warn(
            `Motivation ${row.id}: could not copy upload ${created.id} to the Document Centre: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );

      // The wizard shows what each document was filed as, and `autoFiled` is
      // what tells it which rows to put a correction control on.
      return { ...created, suggestions, autoFiled, confident };
    } catch (err) {
      // Whatever went wrong, the bytes must not outlive the attempt: a file
      // with no row pointing at it is undeletable except by hand.
      await this.files.remove(stored.storageKey).catch(() => undefined);

      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // ⚠️ THE CONSTRAINT IS ON (motivationId, sha256) — THE BYTES, NOT THE
        // KIND — which is exactly why several photographs can sit under one
        // kind. What it refuses is the same picture twice, and that is worth
        // saying plainly on the safe row: three copies of one photograph
        // cannot fill a row that wants three, and without this the wizard
        // reads as broken — it goes on showing the row short right after
        // accepting nothing.
        //
        // ⚠️ ONLY ON THE SAFE ROW. The second sentence went out on every
        // duplicate, so somebody re-sending their ID copy was answered with a
        // rule about photographing a safe — advice about a document they were
        // not uploading, which reads as us having lost track of what they did.
        throw new ConflictException(
          resolved === 'SAFE_PHOTOGRAPHS'
            ? 'That exact file is already attached to this application. Each of the safe photographs has to be a different picture.'
            : 'That exact file is already attached to this application.',
        );
      }
      throw err;
    }
  }

  /**
   * Write suggestions the applicant has CONFIRMED.
   *
   * Separate from the upload on purpose. Extraction proposes; the applicant
   * decides. Anything they have already answered themselves is left alone —
   * the same rule profile prefill follows, and for the same reason: a form that
   * quietly contradicts what someone typed is the worst outcome here.
   */
  async applyExtraction(
    clerkId: string,
    id: string,
    accepted: Record<string, unknown>,
  ) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        licenceType: true,
        status: true,
        answersEncrypted: true,
        answerProvenance: true,
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    if (!EDITABLE.includes(row.status)) {
      throw new ConflictException('This application can no longer be edited.');
    }

    const answers = this.readAnswers(row.answersEncrypted);
    const fresh: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(accepted ?? {})) {
      if ((answers[k] ?? '').trim()) continue; // never overwrite
      fresh[k] = v;
    }

    const { answers: clean } = sanitiseAnswers(row.licenceType, fresh);
    const merged = { ...answers, ...clean };

    // READ: these values came off a document uploaded to THIS application.
    //
    // ⚠️ NO sourceId YET, AND THAT IS A KNOWN GAP RATHER THAN AN OVERSIGHT.
    // The route (`POST :id/uploads/apply`) reuses SaveAnswersDto and carries no
    // uploadId — not in the DTO, not in the frontend caller. Wiring one is a
    // DTO plus frontend change, which belongs with the screen that renders the
    // chip. Until then the entry is honest about the source and silent about
    // which document, which beats inventing an id.
    let provenance = parseProvenance(row.answerProvenance);
    for (const key of Object.keys(clean)) {
      provenance = stamp(provenance, [key], {
        source: 'READ',
        from: 'a document you uploaded',
      });
    }

    await this.prisma.motivation.update({
      where: { id: row.id },
      data: {
        answersEncrypted: encryptJson(merged),
        answersSchemaVersion: FIELD_REGISTRY_VERSION,
        answerProvenance: provenance as unknown as object,
      },
    });

    return {
      filled: Object.keys(clean).length,
      missingRequired: missingRequired(row.licenceType, merged),
    };
  }

  /** The annexure list. Metadata only — never the bytes. */
  async listUploads(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        licenceType: true,
        answersEncrypted: true,
        uploads: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            kind: true,
            coversKinds: true,
            mimeType: true,
            byteSize: true,
            createdAt: true,
            purgedAt: true,
            storageKey: true,
            extractionOk: true,
            extractedFields: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    const annexures = buildAnnexures(row.uploads.map((u) => u.kind));
    const letterFor = new Map(annexures.map((a) => [a.kind, a.letter]));

    const files = row.uploads.map((u) => ({
      id: u.id,
      kind: u.kind,
      label: UPLOAD_KIND_LABELS[u.kind],
      annexure: letterFor.get(u.kind) ?? null,
      mimeType: u.mimeType,
      byteSize: u.byteSize,
      createdAt: u.createdAt,
      // The row can outlive its bytes after a retention purge. Say so, rather
      // than let a download fail with a puzzling error.
      available: u.storageKey !== null && u.purgedAt === null,
      extractionOk: u.extractionOk,
      extractedFields: u.extractedFields,
      /**
       * Filed as something it does not look like.
       *
       * ⚠️ INFERRED FROM THE EXTRACTION WE ALREADY RAN, not from a second
       * vision call. When somebody names the document type, we skip
       * classification and go straight to reading the fields that type
       * carries — so a competency certificate filed as proof of address comes
       * back having yielded none of the things an address document carries.
       * That silence is the signal, and it costs nothing.
       *
       * ⚠️ ONLY FOR KINDS WE CAN ACTUALLY READ. A photograph of a safe
       * extracts nothing by design; flagging it would be crying wolf at every
       * pack.
       */
      suspect:
        MotivationExtractService.canExtract(u.kind) && !u.extractionOk,
    }));

    // What the APPLICATION still needs, weighed against what is attached.
    // Named specifically rather than "some documents are missing", because the
    // alternative to naming them is a wasted trip to a police station.
    const answers = this.readAnswers(row.answersEncrypted);

    return {
      files,
      documents: documentStatus(
        row.licenceType,
        // ⚠️ kind AND coversKinds. One membership certificate is both the
        // association card and the letter of good standing; counting only
        // `kind` would leave the second row asking for a paper already in the
        // pack. buildAnnexures deliberately still sees `kind` ALONE — the
        // document gets one annexure letter, because it is one page.
        row.uploads.flatMap((u) => [u.kind, ...u.coversKinds]),
        // Their answers decide one of the requirements: a licence is needed
        // for every firearm they have told us they already own.
        answers,
      ),
      // The choices in the wizard's "document type" menu, ordered so the next
      // thing to photograph is the next thing in the list. Served rather than
      // hard-coded in the frontend: the two lists had already drifted apart,
      // the client's omitting two kinds and describing the safe in the
      // singular while this side described three.
      kinds: pickableKinds(
        row.licenceType,
        answers,
        // Same union as the checklist: a row already answered by a covering
        // document must not still be offered as the next thing to photograph.
        row.uploads.flatMap((u) => [u.kind, ...u.coversKinds]),
      ),
    };
  }

  /**
   * Read one document back.
   *
   * The buffer is decrypted BEFORE the caller sets any header: a tampered file
   * fails its authentication tag here, and headers-then-throw would emit a 200
   * that dies halfway through the body.
   */
  async readUpload(clerkId: string, id: string, uploadId: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);

    // Ownership is a WHERE CLAUSE, so "not yours" and "does not exist" are the
    // same answer and neither confirms the other exists.
    const up = await this.prisma.motivationUpload.findFirst({
      where: { id: uploadId, motivation: { id, userId: user.id } },
      select: {
        id: true,
        kind: true,
        mimeType: true,
        storageKey: true,
        purgedAt: true,
      },
    });
    if (!up) throw new NotFoundException('Document not found');
    if (!up.storageKey || up.purgedAt) {
      throw new GoneException(
        'That document has been deleted under our retention policy.',
      );
    }

    let bytes: Buffer;
    try {
      bytes = await this.files.read(up.storageKey);
    } catch (err) {
      this.logger.error(
        `Motivation ${id}: could not read upload ${up.id}: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException('We could not open that document.');
    }

    const ext = up.mimeType === 'application/pdf' ? 'pdf' : 'jpg';
    return {
      bytes,
      mimeType: up.mimeType,
      filename: `${up.kind.toLowerCase()}-${up.id.slice(-6)}.${ext}`,
    };
  }

  /** Remove a document, bytes first. */
  async removeUpload(clerkId: string, id: string, uploadId: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);

    const up = await this.prisma.motivationUpload.findFirst({
      where: { id: uploadId, motivation: { id, userId: user.id } },
      select: { id: true, storageKey: true, motivation: { select: { status: true } } },
    });
    if (!up) throw new NotFoundException('Document not found');
    if (!EDITABLE.includes(up.motivation.status)) {
      throw new ConflictException('This application can no longer be edited.');
    }

    if (up.storageKey) {
      try {
        await this.files.remove(up.storageKey);
      } catch (err) {
        // Deleting the row anyway would orphan the bytes forever, so this one
        // does NOT continue past the failure.
        this.logger.error(
          `Motivation ${id}: could not remove ${up.storageKey}: ${(err as Error).message}`,
        );
        throw new ServiceUnavailableException(
          'We could not delete that document just now. Please try again.',
        );
      }
    }

    await this.prisma.motivationUpload.delete({ where: { id: up.id } });
    return { removed: true };
  }

  // ────────────────────────────────────────────────────────────────
  // THE FOLLOW-UP INTERVIEW
  // ────────────────────────────────────────────────────────────────

  /**
   * The conversation so far.
   *
   * Content is encrypted at rest, so this is the only place it is decrypted,
   * and only for the person it belongs to.
   */
  async listMessages(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        licenceType: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            role: true,
            contentEncrypted: true,
            fieldKey: true,
            createdAt: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    return row.messages.map((m) => ({
      id: m.id,
      role: m.role,
      // A message that will not decrypt is shown as unavailable rather than
      // throwing: one bad row must not hide the whole conversation.
      content: tryDecryptText(m.contentEncrypted) ?? '',
      fieldKey: m.fieldKey,
      fieldLabel: m.fieldKey
        ? (fieldByKey(row.licenceType, m.fieldKey)?.label ?? null)
        : null,
      createdAt: m.createdAt,
    }));
  }

  /**
   * Answer a follow-up.
   *
   * The answer is BOTH a message and an answer: it is appended to the
   * conversation so the applicant can see what they said, and merged into the
   * encrypted answer blob under the field the question was about, because that
   * blob is what the document is built from. Storing it only as chat would let
   * someone answer every question and still fail the completeness check.
   */
  async answerFollowUp(
    clerkId: string,
    id: string,
    messageId: string,
    answer: string,
  ) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);

    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        licenceType: true,
        status: true,
        answersEncrypted: true,
        answerProvenance: true,
        messages: {
          where: { id: messageId, role: 'assistant' },
          select: { id: true, fieldKey: true },
        },
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    if (!EDITABLE.includes(row.status)) {
      throw new ConflictException('This application can no longer be edited.');
    }

    const question = row.messages[0];
    if (!question) throw new NotFoundException('Question not found');

    const text = (answer ?? '').trim();
    if (!text) throw new BadRequestException('Please write an answer first.');

    const answers = this.readAnswers(row.answersEncrypted);
    let merged = answers;
    let provenance = parseProvenance(row.answerProvenance);

    if (question.fieldKey) {
      const field = fieldByKey(row.licenceType, question.fieldKey);
      if (field) {
        // A follow-up EXTENDS what is already there rather than replacing it.
        // The gate asked because the answer was thin, and overwriting would
        // throw away the part they had already given.
        const existing = (answers[question.fieldKey] ?? '').trim();
        const combined = existing ? `${existing}\n\n${text}` : text;
        const { answers: clean } = sanitiseAnswers(row.licenceType, {
          [question.fieldKey]: combined,
        });
        merged = { ...answers, ...clean };

        // ⚠️ MEMBER FOR THE WHOLE FIELD, even though the value is now part
        // ours and part theirs. They typed the sentence that changed it, and
        // MEMBER is absorbing by design: a field somebody has written into in
        // their own words is not one we may quietly refill later.
        if (question.fieldKey in clean) {
          provenance = markMember(provenance, [question.fieldKey]);
        }
      }
    }

    await this.prisma.$transaction([
      this.prisma.motivationMessage.create({
        data: {
          motivationId: row.id,
          role: 'user',
          contentEncrypted: encryptText(text),
          fieldKey: question.fieldKey,
        },
      }),
      this.prisma.motivation.update({
        where: { id: row.id },
        data: {
          answersEncrypted: encryptJson(merged),
          answersSchemaVersion: FIELD_REGISTRY_VERSION,
          answerProvenance: provenance as unknown as object,
          // Back to a state that can generate. The gate moved it to
          // NEEDS_MORE_INFO; answering is what moves it back.
          ...(row.status === MotivationStatus.NEEDS_MORE_INFO
            ? { status: MotivationStatus.DRAFT }
            : {}),
        },
      }),
    ]);

    const outstanding = await this.prisma.motivationMessage.count({
      where: {
        motivationId: row.id,
        role: 'assistant',
        fieldKey: { not: null },
        NOT: { fieldKey: { in: Object.keys(merged).filter((k) => merged[k]) } },
      },
    });

    return {
      answered: true,
      outstandingQuestions: outstanding,
      missingRequired: missingRequired(row.licenceType, merged),
    };
  }

  /**
   * Record the applicant's declaration. No document renders without it — they
   * are signing this and submitting it as their own.
   */
  async acceptDeclaration(
    clerkId: string,
    id: string,
    testimonialConsent = false,
  ) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    const res = await this.prisma.motivation.updateMany({
      where: { id, userId: user.id },
      data: {
        declarationAcceptedAt: new Date(),
        testimonialConsentAt: testimonialConsent ? new Date() : null,
      },
    });
    if (res.count === 0) throw new NotFoundException('Motivation not found');
    return { accepted: true };
  }

  /**
   * GENERATE — the whole pipeline.
   *
   * Order matters and every step is defensive:
   *   1. flag, ownership, declaration, completeness
   *   2. CAS into GENERATING so two clicks cannot both spend money
   *   3. claim a beta seat BEFORE any Claude call
   *   4. build the fact pack in code — the model only arranges what we give it
   *   5. draft, then VERIFY the structure plan was actually followed
   *   6. check sameness against previous documents of this type
   *   7. grade; a thin document never becomes a PDF
   */
  /**
   * The cheap half: everything that can refuse, plus the claim on the row.
   *
   * Split out so the expensive half can run OFF the request. Nothing in here
   * calls a model or costs money, so it is safe to run on every attempt.
   */
  private async prepareGeneration(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);

    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        // The MO number. Carried through the run because it is the ONLY thing
        // the outcome notification is allowed to name — see notifyOutcome.
        referenceNumber: true,
        licenceType: true,
        status: true,
        answersEncrypted: true,
        declarationAcceptedAt: true,
        variantSeed: true,
        gateCycles: true,
        betaSeatNo: true,
        // Needed so the sameness corpus can exclude this applicant's own
        // earlier documents — see recentFingerprints.
        userId: true,
        promptTokens: true,
        completionTokens: true,
        // Reused across gate cycles — the suburb and the firearm do not
        // change between attempts, so the searches are paid for once.
        researchEncrypted: true,
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    if (!row.declarationAcceptedAt) {
      throw new ConflictException(
        'Please confirm the declaration before we prepare the document.',
      );
    }

    const answers = this.readAnswers(row.answersEncrypted);
    const missing = missingRequired(row.licenceType, answers);
    if (missing.length) {
      throw new ConflictException({
        message: 'Some required answers are still missing.',
        code: 'motivation-incomplete',
        missing,
      });
    }

    // ⚠️ THE HARD CONSTRAINTS, ENFORCED BEFORE WE SPEND A CLAUDE CALL ON A
    // PACK THAT CANNOT BE GRANTED. Operator's routing spec §3: "If the
    // selected firearm violates the selected application type, block the
    // generator with a specific message. Do not silently continue."
    //
    // A self-loading rifle under section 13 is not a weak application, it is
    // an impossible one — the Act does not permit a rifle under section 13 at
    // all. Writing a beautiful motivation for it costs us the generation and
    // costs the applicant the fee, the fingerprints and the wait before the
    // Registrar tells them the same thing.
    //
    // ⚠️ AFTER missingRequired, DELIBERATELY. These rules read the firearm's
    // type and action, so an applicant who has not filled them in yet must
    // hear "you have not finished" rather than a rule about a firearm they
    // have not described.
    const blockers = applicationBlockers(row.licenceType, answers);
    if (blockers.length) {
      throw new ConflictException({
        message: blockers.map((b) => b.message).join(' '),
        code: 'motivation-not-eligible',
        blockers,
      });
    }

    // COMPARE-AND-SWAP. Two clicks on Generate must not both call Claude —
    // that is duplicated spend and a race on the row. Only the request that
    // moves the status out of an editable state proceeds.
    const claimed = await this.prisma.motivation.updateMany({
      where: { id: row.id, status: { in: REGENERABLE } },
      data: { status: MotivationStatus.GENERATING },
    });
    if (claimed.count === 0) {
      // ⚠️ SAY WHICH STATE IT IS ACTUALLY IN. This branch fires for EVERY
      // status outside REGENERABLE, but the message only ever described one of
      // them — a finished document was told it was "already being prepared",
      // which sent the operator looking for a generation that had ended
      // minutes earlier. Re-read rather than guess.
      const now = await this.prisma.motivation.findUnique({
        where: { id: row.id },
        select: { status: true },
      });
      throw new ConflictException(
        now?.status === MotivationStatus.GENERATING ||
        now?.status === MotivationStatus.QUALITY_REVIEW
          ? 'This document is already being prepared. Give it a moment.'
          : 'This document cannot be prepared again from here. Contact support.',
      );
    }

    return { row, answers };
  }

  /**
   * The expensive half: two flagship calls and a grading pass.
   *
   * ⚠️ THIS MUST NOT RUN INSIDE AN HTTP REQUEST. Measured on a live section 16
   * pack: 88 seconds, 14k prompt and 12k completion tokens over two gate
   * cycles. nginx gives an upstream 60 seconds and Cloudflare cuts the origin
   * at 100 whatever nginx is told, so the applicant got a 504 for a document
   * that had been written and paid for — and clicking again spent it twice.
   *
   * The row is already claimed (GENERATING) before this is called, so a second
   * click cannot start a second run; the caller decides whether to await.
   */
  private async runGeneration(
    prepared: Awaited<ReturnType<MotivationsService['prepareGeneration']>>,
  ) {
    const { row, answers } = prepared;

    // Whether THIS call took a seat. If generation then fails, the seat has to
    // go back — see the catch block.
    let claimedSeatHere = false;

    try {
      // A seat is claimed once per motivation, not once per attempt: a gate
      // retry is our cost to carry, not another seat off the applicant.
      let seat = row.betaSeatNo;
      if (seat === null) {
        const cap = await this.settings.get(FLAGS.motivationBetaFreeCap);
        seat = await this.quota.claimBetaSeat(cap);
        claimedSeatHere = seat !== null;
        // ⚠️ WRITE THE SEAT TO THE ROW THE MOMENT IT IS TAKEN, not at the end
        // of the run. The counter has already been incremented; if the process
        // dies before the terminal update — a deploy, an OOM kill, and the
        // generation now runs detached where that is likelier — the seat is
        // spent with nothing on the row to show for it, and no sweep can tell
        // whose it was. Persisted here, the row owns it: the retry reads
        // row.betaSeatNo above and reuses it, which is also what makes "one
        // seat per motivation, not per attempt" survive a restart.
        if (seat !== null) {
          await this.prisma.motivation
            .update({ where: { id: row.id }, data: { betaSeatNo: seat } })
            .catch(() => undefined);
        }
        if (seat === null) {
          await this.prisma.motivation.update({
            where: { id: row.id },
            data: { status: MotivationStatus.NEEDS_MORE_INFO },
          });
          throw new ConflictException({
            message:
              'The free beta filled up while you were working. We will open paid motivations shortly.',
            code: 'motivation-beta-cap-reached',
          });
        }
      }

      // DOES THIS APPLICANT ALREADY HOLD SOMETHING THAT DOES THIS JOB?
      //
      // The question that gets a second medium-game rifle refused, and one the
      // Registrar asks whether or not we do. Computed once here and used in
      // both directions: the note tells the writer to meet the objection head
      // on, and needsJustification promotes the "why both" question in the
      // follow-up ranking if the gate sends this back.
      const overlap = overlapFromAnswers(row.licenceType, answers);

      // ── background research, once per motivation ───────────────────
      //
      // The professional motivations are not templates: precinct crime
      // figures behind a self-defence application, pages on the cartridge in
      // a section 16. That material is published, not something to ask the
      // applicant for — so it is gathered here, by a cheaper model with web
      // search, and handed to the writer AND the gate (or the gate would
      // fail every researched sentence as ungrounded).
      //
      // Fail-soft and cached: a research failure costs colour, never the
      // document, and a retry re-reads the stored brief instead of paying
      // for the searches again.
      let researchIn = 0;
      let researchOut = 0;
      let research = row.researchEncrypted
        ? (tryDecryptText(row.researchEncrypted) ?? undefined)
        : undefined;
      if (!research) {
        const r = await this.claude
          .research({
            licenceType: row.licenceType,
            answers,
            // ⚠️ THE OTHER FIREARM IS PART OF THE BRIEF NOW. The writer has to
            // argue the comparison itself rather than wait for the applicant
            // to hand it over, and rule 1 forbids it any figure it was not
            // given — so without published material on the held cartridge the
            // strongest section in a same-class application could only be
            // written in generalities.
            heldForComparison:
              overlap.verdict.kind === 'overlap'
                ? [
                    ...overlap.verdict.withCalibres,
                    ...overlap.verdict.withTypes,
                  ]
                : [],
          })
          .catch(() => null);
        if (r) {
          research = r.text;
          researchIn = r.usage.promptTokens;
          researchOut = r.usage.completionTokens;
          await this.prisma.motivation
            .update({
              where: { id: row.id },
              data: { researchEncrypted: encryptText(r.text) },
            })
            .catch(() => undefined);
        }
      }

      // ── the cover photograph ──────────────────────────────────────
      //
      // Fetched HERE and nowhere else. It belongs beside the research pass for
      // the same three reasons: it is background work, it is cached on disk so
      // the second applicant with a CZ 75 pays nothing, and it is fail-soft —
      // a miss costs the cover a picture, never the document.
      //
      // ⚠️ NOT IN THE DOWNLOAD PATH. The pack is re-rendered on every
      // download, and an outbound call to somebody else's server there would
      // sit inside our 60-second nginx ceiling on a request the applicant is
      // waiting on. renderPdf only ever reads what is already on disk.
      if (answers.firearm_make) {
        await this.firearmImages
          .fetchAndStore(
            answers.firearm_make,
            answers.firearm_model ?? '',
            answers.firearm_type,
          )
          .catch(() => null);
      }

      // The lettered annexure list — from the SAME function that letters the
      // printed pack, so a citation the writer makes can never point at a tab
      // that will not exist.
      const uploadKinds = (
        await this.prisma.motivationUpload.findMany({
          where: { motivationId: row.id },
          select: { kind: true, coversKinds: true },
        })
      ).map((u) => u.kind);
      const annexures = buildAnnexures(uploadKinds).map((a) => ({
        letter: a.letter,
        label: a.label,
      }));

      const pack: FactPack = {
        licenceType: row.licenceType,
        answers,
        derived: this.deriveFacts(answers),
        // Only when there is genuinely an overlap. Passing a note otherwise
        // would have the document argue against a problem it does not have.
        overlapNote: overlap.writerNote ?? undefined,
        research,
        annexures,
      };

      // Draft, verify the plan landed, and check it does not look like
      // everything else we have produced. ONE retry with a fresh seed covers
      // both failures — a second identical result means the variation engine
      // is broken, which is an admin problem rather than a user one.
      //
      // ⚠️ THE PLAN NEEDS THE OVERLAP, not just the seed. The comparison
      // section is only in the plan when the applicant actually holds a
      // same-class firearm — the same condition that puts `overlapNote` in the
      // pack. Both are read off THIS check so the writer can never be handed a
      // section with no instruction behind it, or an instruction with no
      // section to put it in.
      const planOpts = { hasOverlap: !!overlap.writerNote };
      let seed = row.variantSeed;
      let plan = planFor(row.licenceType, seed, planOpts);
      let attempt = await this.claude.generate(pack, plan);
      let tokensIn = attempt.usage.promptTokens + researchIn;
      let tokensOut = attempt.usage.completionTokens + researchOut;

      const previous = await this.recentFingerprints(
        row.licenceType,
        row.id,
        row.userId,
      );
      let structureOk = followsPlan(attempt.text, plan).ok;
      let sameness = maxSimilarity(fingerprint(attempt.text), previous);
      // The FIRST verifier, in code and for free: serial, ID, calibre and
      // annexure citations checked deterministically. A failure here rides
      // the same single retry as a broken structure — same cost, same cap.
      let mechanics = packConsistency(attempt.text, answers, annexures);

      if (
        !structureOk ||
        sameness > SIMILARITY_REGENERATE_THRESHOLD ||
        mechanics.length
      ) {
        this.logger.warn(
          `Motivation ${row.id}: regenerating (structureOk=${structureOk}, sameness=${sameness.toFixed(2)}, mechanics=${mechanics.length})`,
        );
        seed = crypto.randomInt(0, 2 ** 31 - 1);
        plan = planFor(row.licenceType, seed, planOpts);
        attempt = await this.claude.generate(pack, plan);
        tokensIn += attempt.usage.promptTokens;
        tokensOut += attempt.usage.completionTokens;
        structureOk = followsPlan(attempt.text, plan).ok;
        sameness = maxSimilarity(fingerprint(attempt.text), previous);
        mechanics = packConsistency(attempt.text, answers, annexures);
      }

      // ⚠️ A DOCUMENT THAT FAILS THE MECHANICAL CHECKS TWICE IS NEVER FILED.
      // A wrong serial or a citation to a tab that does not exist is not a
      // quality problem the applicant can fix with a better answer — it is
      // the writer corrupting identity data, our defect, an admin's problem.
      if (mechanics.length) {
        await this.prisma.motivation.update({
          where: { id: row.id },
          data: {
            status: MotivationStatus.FAILED,
            failedAt: new Date(),
            failureReason: mechanics.slice(0, 3).join('; ').slice(0, 500),
          },
        });
        void this.prisma.adminAlert
          .create({
            data: {
              type: 'motivation-verify-failed',
              urgent: true,
              context: `Motivation ${row.id} failed mechanical verification twice: ${mechanics[0]}`,
            },
          })
          .catch(() => undefined);
        await this.notifyOutcome(row, 'failed');
        return { status: MotivationStatus.FAILED, score: 0 };
      }

      const graded = await this.claude.grade(pack, attempt.text);
      tokensIn += graded.usage.promptTokens;
      tokensOut += graded.usage.completionTokens;

      const maxCycles = await this.settings.get(FLAGS.motivationMaxGateCycles);
      const nextCycles = row.gateCycles + 1;

      const common = {
        variantSeed: seed,
        structurePlan: plan as unknown as object,
        structureFingerprint: fingerprint(attempt.text),
        // ⚠️ KEEP THE DRAFT EVEN WHEN THE GATE SENDS IT BACK. It used to be
        // written only on a pass, so an applicant whose document was held for
        // more detail could never SEE the document — they paid for it, it was
        // written, and all they got was a score and a list of questions. That
        // makes the gate impossible to argue with and impossible to learn
        // from: neither the applicant nor the operator can tell a fair
        // knock-back from an over-strict one without reading the text.
        //
        // Only the PASSED branch sets documentVersion, completedAt and
        // qualityPassedAt, so "finished" still means finished — the PDF stays
        // gated on COMPLETED (see renderPdf) and this is a draft to read, not
        // a document to file.
        documentTextEncrypted: encryptText(attempt.text),
        qualityScore: graded.verdict.overall,
        qualityFindings: graded.verdict as unknown as object,
        thinFields: graded.verdict.thinFields,
        modelUsed: attempt.usage.model,
        promptTokens: (row.promptTokens ?? 0) + tokensIn,
        completionTokens: (row.completionTokens ?? 0) + tokensOut,
        costUsd: estimateCostUsd(attempt.usage.model, tokensIn, tokensOut),
        betaSeatNo: seat,
        generatedAt: new Date(),
      };

      // Read once for BOTH terminal branches. A document that failed the gate
      // needs a retention date every bit as much as one that passed — its
      // uploads are the same identity documents.
      const retentionDays = await this.settings.get(
        FLAGS.motivationRetentionDays,
      );

      // THE SECOND VERIFIER — a fresh model reading the finished document the
      // way a suspicious DFO would, once, only on text that passed the gate.
      // Advisory: its findings are stored beside the verdict for the operator
      // and the applicant, but a broken verifier must not un-pass a passed
      // document. Two verifiers per document — this and the mechanical checks
      // above — and not more, per the operator.
      let verification: string[] | undefined;
      if (graded.verdict.passed) {
        const v = await this.claude
          .verifyDocument({ pack, documentText: attempt.text, annexures })
          .catch(() => null);
        if (v) {
          verification = v.issues;
          tokensIn += v.usage.promptTokens;
          tokensOut += v.usage.completionTokens;
          if (v.issues.length) {
            this.logger.warn(
              `Motivation ${row.id}: verifier noted ${v.issues.length} issue(s) — stored with the verdict`,
            );
          }
        }
      }

      if (graded.verdict.passed) {
        await this.prisma.motivation.update({
          where: { id: row.id },
          data: {
            ...common,
            qualityFindings: {
              ...(graded.verdict as unknown as Record<string, unknown>),
              ...(verification ? { verification } : {}),
            } as unknown as object,
            status: MotivationStatus.COMPLETED,
            // (the text itself comes from `common` now — see the note there)
            documentVersion: { increment: 1 },
            templateVersion: TEMPLATE_VERSION,
            disclaimerVersion: DISCLAIMER_VERSION,
            qualityPassedAt: new Date(),
            completedAt: new Date(),
            retentionPurgeAt: new Date(
              Date.now() + retentionDays * 24 * 60 * 60 * 1000,
            ),
          },
        });
        await this.notifyOutcome(row, 'ready');
        return {
          status: MotivationStatus.COMPLETED,
          score: graded.verdict.overall,
        };
      }

      // Out of retries — an admin owns it from here, rather than sending the
      // applicant round the loop forever.
      if (nextCycles > maxCycles) {
        await this.prisma.motivation.update({
          where: { id: row.id },
          data: {
            ...common,
            status: MotivationStatus.FAILED,
            gateCycles: nextCycles,
            failedAt: new Date(),
            // Same reason as abandon(): a terminal state with no retention date
            // is a document nothing ever comes back for.
            retentionPurgeAt: new Date(
              Date.now() + retentionDays * 24 * 60 * 60 * 1000,
            ),
            failureReason:
              graded.verdict.issues.slice(0, 3).join('; ') ||
              'Quality gate not met',
          },
        });
        void this.prisma.adminAlert
          .create({
            data: {
              type: 'motivation-gate-exhausted',
              urgent: false,
              context: `Motivation ${row.id} failed the quality gate ${nextCycles} times and needs a human look.`,
            },
          })
          .catch(() => undefined);
        await this.notifyOutcome(row, 'failed');
        return { status: MotivationStatus.FAILED, score: graded.verdict.overall };
      }

      // Back to the applicant, for the specific fields the gate found thin.
      await this.prisma.motivation.update({
        where: { id: row.id },
        data: {
          ...common,
          status: MotivationStatus.NEEDS_MORE_INFO,
          gateCycles: nextCycles,
        },
      });
      await this.queueFollowUps(
        row.id,
        row.licenceType,
        graded.verdict.thinFields,
        answers,
      );
      // ⚠️ AFTER queueFollowUps, NEVER BEFORE. The message tells the applicant
      // the questions are waiting for them; sending it first would race an
      // applicant who taps the SMS straight away onto a page with none on it.
      await this.notifyOutcome(row, 'held');
      return {
        status: MotivationStatus.NEEDS_MORE_INFO,
        score: graded.verdict.overall,
        thinFields: graded.verdict.thinFields,
      };
    } catch (err) {
      // Release the CAS so the applicant can try again. Without this a failed
      // generation strands the row in GENERATING forever — uneditable and
      // un-regenerable, the worst possible end state.
      await this.prisma.motivation
        .updateMany({
          where: { id: row.id, status: MotivationStatus.GENERATING },
          data: { status: MotivationStatus.NEEDS_MORE_INFO },
        })
        .catch(() => undefined);

      // AND GIVE THE SEAT BACK. The seat is claimed before the first Claude
      // call so we never spend money we have not accounted for — but that
      // means an Anthropic outage would otherwise consume a free-beta seat
      // and produce nothing. The applicant did not get a document; they must
      // not lose their place in the beta for our failure.
      //
      // Only if THIS call took it: a retry on a motivation that already held
      // a seat must not decrement someone else's.
      if (claimedSeatHere) {
        await this.quota.releaseBetaSeat().catch(() => undefined);
      }

      // ⚠️ AND TELL THEM. THIS is the branch that fired on 2026-08-22 and said
      // nothing: an Anthropic timeout, or a document that came back unusable,
      // put the row back to NEEDS_MORE_INFO and returned the seat — correctly
      // — and then simply rethrew into startGeneration's catch, which logs.
      // The applicant, who is holding a phone waiting for the message we
      // promised them, got a button that went grey and came back.
      //
      // Ordered AFTER the row is restored so the link in the message opens a
      // page they can actually press Prepare on, and awaited so a process that
      // dies immediately after has still sent it.
      await this.notifyOutcome(row, 'failed');
      throw err;
    }
  }

  /**
   * Tell the applicant their document is finished — ready, or held back.
   *
   * ⚠️ THE RUN IS DETACHED, SO NOTHING ELSE EVER TELLS THEM. startGeneration
   * returns immediately and the wizard settles on "Writing it — about a
   * minute…"; a minute and a half later the row changes and the page does not,
   * because the applicant has long since locked their phone. Both terminal
   * gate branches call this, because a document held back for more detail is
   * just as FINISHED from where they are standing — and a knock-back nobody
   * is told about is the one outcome with no way back into the flow.
   *
   * ⚠️ AND SO DOES EVERY FAILURE BRANCH, WHICH IS NEW. Only the two success
   * paths called this, so the outcome where somebody is MOST certainly still
   * waiting — the one where nothing was written at all — was the one that said
   * nothing. Operator, 2026-08-22: "Pressed the Prepare my motivation and it
   * greyed out. It is back to prepare my motivation again and did not receive
   * any notifications." The button returning is the only signal there was, and
   * only if you happened to be looking at the page.
   *
   * ⚠️ IT NEVER THROWS. The row is already in its terminal state by the time
   * this runs and the document is written and (in time) paid for; a Resend
   * outage, a missing phone number or a stale user row must cost a message,
   * never the document. Every failure is a warning in the log.
   *
   * The MO reference is the only identifier passed on. NotificationsService
   * owns the rule about what may reach a lock screen — see motivationFinished
   * — but nothing here hands it a firearm, a calibre or a section to leak.
   */
  private async notifyOutcome(
    row: { id: string; userId: string; referenceNumber: string },
    outcome: 'ready' | 'held' | 'failed',
  ): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: row.userId },
        select: { email: true, phone: true, firstName: true },
      });
      // No address, no message. Stale dev-era rows have made this exact lookup
      // come back empty in production before (see requireUser), and a null
      // deref here would be an unhandled rejection on a detached promise.
      if (!user?.email) {
        this.logger.warn(
          `Motivation ${row.id}: finished (${outcome}) but the applicant has no email on file — not notified`,
        );
        return;
      }
      await this.notifications.motivationFinished({
        userId: row.userId,
        email: user.email,
        phone: user.phone,
        name: user.firstName ?? 'there',
        motivationId: row.id,
        referenceNumber: row.referenceNumber,
        outcome,
      });
    } catch (err) {
      this.logger.warn(
        `Motivation ${row.id}: could not tell the applicant it finished (${outcome}) — ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Generate and wait for the outcome.
   *
   * Kept for callers that genuinely want the result in hand — the tests, and
   * anything server-side that is not answering an HTTP request. NOT the route:
   * see startGeneration and the timing note on runGeneration.
   */
  async generate(clerkId: string, id: string) {
    const prepared = await this.prepareGeneration(clerkId, id);
    return this.runGeneration(prepared);
  }

  /**
   * Start generating and return at once. What the route calls.
   *
   * Every refusal the applicant can act on — not found, declaration not
   * accepted, answers missing, already running — still happens before this
   * returns, so the wizard gets a real error rather than a hopeful "started"
   * followed by silence. Only the part that cannot fail fast runs detached.
   *
   * ⚠️ THE PROMISE IS DELIBERATELY NOT AWAITED, and its rejection is swallowed
   * here rather than left to crash the process. runGeneration's own catch has
   * already restored the row and returned the beta seat by the time it
   * rethrows; there is no caller left to tell, and the applicant learns the
   * outcome from the row's status.
   */
  async startGeneration(clerkId: string, id: string) {
    const prepared = await this.prepareGeneration(clerkId, id);
    void this.runGeneration(prepared).catch((err) => {
      this.logger.error(
        `Motivation ${prepared.row.id}: background generation failed — ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
    return { status: MotivationStatus.GENERATING };
  }

  /**
   * Free rows left claimed by a process that died mid-generation.
   *
   * ⚠️ THE ONE FAILURE runGeneration's catch CANNOT COVER. It restores the row
   * on a thrown error, but a deploy, an OOM kill or a pm2 restart takes the
   * process with the promise still in flight — and GENERATING is not editable
   * and not re-generable, so the applicant is stranded on a document that
   * looks permanently busy with nothing to click.
   *
   * ⚠️ TWENTY-FIVE MINUTES, AND THE FIGURE IS DERIVED, NOT CHOSEN. It must
   * stay clear of the worst realistic run, which GENERATE_TIMEOUT_MS's comment
   * computes: research 180s + write 300s + one local retry 300s + verify 60s +
   * grade 60s = 15 minutes. It was 15 when the writer's clock was 180s and the
   * sum was 11; raising the writer's token ceiling raised both, and a sweep
   * that fires at the same moment a legitimate run is still writing would take
   * the row out from under it. Change either timeout and redo the sum here.
   *
   * It moves the row to NEEDS_MORE_INFO rather than an editable draft, because
   * tokens may well have been spent and the applicant should see the state as
   * it is.
   */
  @Cron('*/5 * * * *')
  async sweepStuckGenerations() {
    const cutoff = new Date(Date.now() - 25 * 60 * 1000);
    const stuck = await this.prisma.motivation.updateMany({
      where: { status: MotivationStatus.GENERATING, updatedAt: { lt: cutoff } },
      data: { status: MotivationStatus.NEEDS_MORE_INFO },
    });
    if (stuck.count > 0) {
      this.logger.error(
        `Released ${stuck.count} motivation(s) stuck in GENERATING — a generation was interrupted, most likely by a restart.`,
      );
    }
    return { released: stuck.count };
  }

  /**
   * Render the PDF. Nothing is stored — it is rebuilt from the encrypted text
   * on every download, so erasure has no assets to chase and a lost file is
   * impossible.
   */
  /**
   * Decrypt every upload that can be reprinted into the pack, in annexure
   * order, and name the ones that cannot.
   *
   * ⚠️ ONE MEMBER'S OWN DOCUMENTS, ALREADY OWNERSHIP-CHECKED. The rows are
   * handed in from the motivation's own `findFirst`, which is scoped by
   * userId — this must never be called with rows fetched any other way.
   *
   * ⚠️ IT NEVER THROWS. A pack is worth printing without one copy in it; it
   * is not worth failing to print at all. Every failure — purged, unreadable
   * on disk, a format pdfkit cannot take, a header we cannot measure — comes
   * back as a named line on the index telling the applicant to bring that one
   * themselves.
   */
  /**
   * ⚠️ THE LETTERING IS PASSED IN, NOT RECOMPUTED. This method used to call
   * buildAnnexures itself, with the uploads only — while renderPdf called it
   * again WITH the generated prior-notice request. Two lists, two different
   * letterings, and the copies came out disagreeing with the index they are
   * indexed by: the pack's index said "Annexure F — Existing firearm
   * licence(s)" while the licence pages themselves were captioned
   * "Annexure E", because the copies' lettering never reserved a letter for
   * the document we generate.
   *
   * An annexure index that does not match its own annexures is worse than no
   * index. One list, computed once, handed to both.
   */
  private async annexureImages(
    uploads: {
      id: string;
      kind: MotivationUploadKind;
      storageKey: string | null;
      mimeType: string | null;
      purgedAt: Date | null;
    }[],
    annexures: AnnexureEntry[],
  ): Promise<{
    images: AnnexureImagePage[];
    notPrinted: { letter: string; label: string; why: string }[];
    /** Annexures that arrived as PDFs — merged into the pack, not skipped. */
    pdfs: {
      letter: string;
      label: string;
      index: number;
      total: number;
      bytes: Buffer;
    }[];
  }> {
    // ⚠️ RESOLVED THROUGH annexureByKind, WHICH KNOWS ABOUT THE GROUPS. A
    // map built straight off the entry list is keyed by each group's
    // REPRESENTATIVE kind, so an ajar-safe photograph or a good-standing
    // letter finds nothing and prints "Annexure ?" with the raw enum name as
    // its caption. That shipped.
    const byKind = annexureByKind(annexures);
    // How many copies share each letter, so a caption can say "1 of 2".
    const totals = new Map<string, number>();
    for (const u of uploads) {
      totals.set(u.kind, (totals.get(u.kind) ?? 0) + 1);
    }
    const seen = new Map<string, number>();

    const images: AnnexureImagePage[] = [];
    const notPrinted: { letter: string; label: string; why: string }[] = [];
    const pdfs: {
      letter: string;
      label: string;
      index: number;
      total: number;
      bytes: Buffer;
    }[] = [];

    for (const u of uploads) {
      const entry = byKind.get(u.kind);
      const letter = entry?.letter ?? '?';
      const label = entry?.label ?? UPLOAD_KIND_LABELS[u.kind] ?? u.kind;
      const index = (seen.get(u.kind) ?? 0) + 1;
      seen.set(u.kind, index);
      const total = totals.get(u.kind) ?? 1;

      if (!u.storageKey || u.purgedAt) {
        notPrinted.push({ letter, label, why: 'no longer stored' });
        continue;
      }
      // ⚠️ A PDF IS NO LONGER A REASON TO LEAVE A DOCUMENT OUT. pdfkit cannot
      // embed one, but pdf-lib can copy its pages into the finished pack —
      // see motivation-pdf-merge.ts. Read the bytes first, because both paths
      // need them.
      const isPdf = (u.mimeType ?? '') === 'application/pdf';
      if (!isPdf && !isEmbeddable(u.mimeType ?? '')) {
        notPrinted.push({ letter, label, why: 'not a JPG, PNG or PDF' });
        continue;
      }
      let bytes: Buffer;
      try {
        bytes = await this.files.read(u.storageKey);
      } catch {
        notPrinted.push({ letter, label, why: 'we could not read it back' });
        continue;
      }
      if (isPdf) {
        pdfs.push({ letter, label, index, total, bytes });
        continue;
      }
      const size = imageSize(bytes);
      if (!size) {
        // Measuring is not optional: the alternative is guessing an aspect
        // ratio and printing somebody's licence stretched.
        notPrinted.push({ letter, label, why: 'we could not measure it' });
        continue;
      }
      images.push({
        letter,
        label,
        index,
        total,
        bytes,
        certification: entry?.certification ?? 'none',
        ...size,
      });
    }

    return { images, notPrinted, pdfs };
  }

  /**
   * The draft text, whether or not it passed review.
   *
   * Separate from the detail payload because the wizard polls that every few
   * seconds and this is fifteen hundred words — and separate from renderPdf
   * because the PDF is the thing you FILE and stays gated on COMPLETED. This
   * is the thing you READ, so that a document held back for more detail can
   * be argued with instead of only scored.
   */
  async draftText(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        status: true,
        documentTextEncrypted: true,
        qualityScore: true,
        qualityFindings: true,
        generatedAt: true,
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    if (!row.documentTextEncrypted) {
      throw new ConflictException('Nothing has been written yet.');
    }
    const text = tryDecryptText(row.documentTextEncrypted);
    if (!text) {
      throw new ConflictException(
        'We could not open this draft. Please contact support.',
      );
    }
    return {
      text,
      status: row.status,
      // So the reader can see the draft and the reasons side by side rather
      // than taking a number on faith.
      qualityScore: row.qualityScore,
      findings: row.qualityFindings,
      generatedAt: row.generatedAt,
      final: row.status === MotivationStatus.COMPLETED,
    };
  }

  /**
   * Record which template the applicant picked.
   *
   * ⚠️ ALLOWED IN EVERY STATUS, including COMPLETED. This is not an answer and
   * it changes nothing the document argues — the body is stored text and the
   * PDF is re-rendered from it on every download, so re-skinning a finished
   * motivation costs one query and no Claude call. Locking it to the editable
   * statuses would mean somebody who dislikes the colour has to regenerate a
   * document they already paid for.
   */
  async setTemplate(
    clerkId: string,
    id: string,
    choice: { format?: string; colourway?: string; layout?: string },
  ) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);

    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    const updated = await this.prisma.motivation.update({
      where: { id: row.id },
      data: {
        // Only what was sent: the picker changes colour and format
        // independently, and spreading undefined would blank the other one.
        ...(choice.format !== undefined
          ? { templateFormat: asFormat(choice.format) }
          : {}),
        ...(choice.colourway !== undefined
          ? { templateColourway: asScheme(choice.colourway) }
          : {}),
        ...(choice.layout !== undefined
          ? { templateLayout: asLayout(choice.layout) }
          : {}),
      },
      select: {
        templateFormat: true,
        templateColourway: true,
        templateLayout: true,
      },
    });

    return {
      format: asFormat(updated.templateFormat),
      colourway: asScheme(updated.templateColourway),
      layout: asLayout(updated.templateLayout),
    };
  }

  /**
   * The member's own name for this application, e.g. "Home defence" against a
   * Section 13 draft. Operator, board review 2026-08-27: "User must be able
   * to rename the motivation."
   *
   * ⚠️ ALLOWED IN EVERY STATUS, same reasoning as setTemplate above: this is
   * not an answer, changes nothing the document argues, and is not read into
   * answersEncrypted, documentTextEncrypted or the rendered PDF. A finished
   * motivation is still allowed to be renamed on the list.
   *
   * ⚠️ WHITESPACE-ONLY IS THE SAME AS UNNAMED. The DTO caps length but does
   * not forbid a string of spaces, and this is user input on a page that
   * generates a legal document — trimmed here, so "   " is never mistaken
   * for a real name and is stored as null instead, matching what an
   * untouched motivation already looks like.
   */
  async rename(clerkId: string, id: string, rawLabel: string | undefined) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);

    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    const trimmed = (rawLabel ?? '').trim();

    const updated = await this.prisma.motivation.update({
      where: { id: row.id },
      data: { label: trimmed || null },
      select: { label: true },
    });

    return { label: updated.label };
  }

  async renderPdf(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);

    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        referenceNumber: true,
        licenceType: true,
        status: true,
        documentTextEncrypted: true,
        templateVersion: true,
        answersEncrypted: true,
        completedAt: true,
        templateFormat: true,
        templateColourway: true,
        templateLayout: true,
        structurePlan: true,
        coverPhotoChoice: true,
        coverPhotoKey: true,
        coverPhotoMime: true,
        // The one column that records money, and so the only one the mark
        // reads. betaSeatNo used to be selected beside it; see isPaidFor.
        billedCents: true,
        // ⚠️ ORDERED BY CREATION, and the bytes come with it now. The copies
        // are reprinted into the pack, so a stable order matters: "1 of 2"
        // and "2 of 2" have to mean the same two pages every download.
        uploads: {
          select: {
            id: true,
            kind: true,
            storageKey: true,
            mimeType: true,
            purgedAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    if (
      row.status !== MotivationStatus.COMPLETED ||
      !row.documentTextEncrypted
    ) {
      throw new ConflictException('This document is not ready yet.');
    }

    const body = tryDecryptText(row.documentTextEncrypted);
    if (!body) {
      throw new ConflictException(
        'We could not open this document. Please contact support.',
      );
    }

    const answers = this.readAnswers(row.answersEncrypted);

    // The annexure index closes the printed document so a reviewer can find
    // anything the body cross-references.
    //
    // THE TICK BOXES stay a live surface on the platform and in the PWA (see
    // checklist() below) — that is the operator's decision and it holds, the
    // pack stays digital until it is printed. But once it IS printed, the
    // paper has to say what goes with it: the applicant walking into the
    // station is holding a pile of documents, not a phone. So the "take these
    // with you" half of the checklist is rendered onto the last page, with
    // boxes to tick with a pen, and the "your pack" half is not — that half is
    // what they are already holding.
    const kinds = (row.uploads ?? []).map((u) => u.kind);

    // ⚠️ THE CHECKLIST HAS PROMISED THIS SINCE THE MODULE SHIPPED AND NOTHING
    // PRODUCED IT. "Request for prior notice before refusal (PAJA)" sits under
    // "Your pack", owned by us, ticking itself green the moment the motivation
    // was written — and no code anywhere built the document. Found 2026-08-20.
    //
    // Built here rather than at generation time because it is derived purely
    // from the applicant's own identifying details: no Claude call, no stored
    // text, and it re-renders identically every download. See
    // motivation-prior-notice.ts for why the pack carries it at all.
    const priorNotice = buildPriorNoticeRequest({
      applicantName: answers.full_name || 'The applicant',
      idNumber: answers.id_number?.trim() || undefined,
      referenceNumber: row.referenceNumber,
      licenceTypeLabel: LICENCE_TYPE_LABELS[row.licenceType],
      firearmLine: firearmLine(answers),
    });
    // The SIGNED character witness statements.
    //
    // ⚠️ WHAT EXISTS, AND NOTHING ELSE. This used to build two BLANK forms
    // unconditionally — ruled sheets for the applicant to print and hand out.
    // Operator, 2026-08-21: "Only use the link." A witness completes and signs
    // on their own phone now, so a slot nobody has completed contributes no
    // page at all. A pack that goes to the police contains what was actually
    // said, never a placeholder for what somebody hoped would be.
    const characterStatements = await this.buildWitnessStatements(
      row.id,
      answers.full_name || 'The applicant',
      row.referenceNumber,
      LICENCE_TYPE_LABELS[row.licenceType],
    );
    const sellerConsent = await this.buildSellerConsent(row.id).catch(() => {
      // Never lose the motivation over the consent sheet.
      this.logger.error(`Motivation ${row.id}: seller consent sheet failed`);
      return undefined;
    });
    // ONE lettering, built once, used by the index AND by the captions on the
    // reprinted copies. See annexureImages.
    const annexures = buildAnnexures(kinds, ['PRIOR_NOTICE_REQUEST']);
    const printable = await this.annexureImages(row.uploads ?? [], annexures);

    return this.pdf.render({
      referenceNumber: row.referenceNumber,
      // The applicant's REAL name — the documented exception to the site-wide
      // username-only rule. A motivation to the Registrar with a username on it
      // is worthless.
      applicantName: answers.full_name || 'The applicant',
      licenceTypeLabel: LICENCE_TYPE_LABELS[row.licenceType],
      body,
      disclaimer: DISCLAIMER_TEXT,
      templateVersion: row.templateVersion ?? TEMPLATE_VERSION,
      // Validated on read: the columns are plain VARCHARs so adding a template
      // costs no migration, which also means they can hold anything. An
      // unrecognised value falls back rather than failing the download.
      format: asFormat(row.templateFormat),
      colourway: asScheme(row.templateColourway),
      layout: asLayout(row.templateLayout),
      // See isPaidFor. Payments are not live, so today this stamps almost
      // every download — which is the right way round.
      watermark: !isPaidFor(row),
      // Named in the running footer of every page, the way a professional
      // pack does it — a loose sheet has to identify its own application.
      firearmLine: firearmLine(answers),
      generatedAt: row.completedAt ?? new Date(),
      // ⚠️ ON THE COVER BECAUSE THE DFO FILES ON IT. Every professional pack
      // identifies the applicant by ID number on its first page: it is the
      // key the Central Firearms Register runs on, and a folder that carries
      // it cannot be confused with another Gerhard Fourie.
      idNumber: answers.id_number?.trim() || undefined,
      // What they already hold. Section 13(3) caps a self-defence applicant
      // at one firearm and section 15(3) an occasional sport shooter at four,
      // so this is a statutory precondition the DFO checks — set out as a
      // table a reviewer can read at a glance instead of mining it out of a
      // paragraph. Empty is meaningful too: the renderer prints "this is a
      // first application" rather than dropping the section.
      ownedFirearms: existingFirearms(answers),
      annexures,
      priorNotice,
      // ⚠️ KEYED ON THE HEADING AS IT IS PRINTED — uppercased, colon stripped —
      // because that is the only string the renderer has when it draws one.
      // See sectionMarks on MotivationPdfInput for why this is built from the
      // stored plan rather than inferred from the words.
      sectionMarks: sectionMarksFor(row.structurePlan, answers.firearm_type),
      firearmPhoto: await this.coverPhotoForRender(row, answers),
      characterStatements,
      sellerConsent,
      annexureImages: printable.images,
      annexuresNotPrinted: printable.notPrinted,
      // Merged into the finished pack by pdf-lib after pdfkit has drawn the
      // body — these used to be listed as "bring your own copy".
      annexurePdfs: printable.pdfs,
      // ⚠️ THE CARTRIDGE'S OWN DATASHEET, AS BODY CONTENT. Operator,
      // 2026-08-23: "i want to insert the full cartridge page into the
      // motivation. Showing the dimensions and everything on the page" and
      // "it not an annexure. Its part of the motivation itself."
      //
      // Matched on the calibre EXACTLY — see CipSheetService for why fuzzy
      // matching is refused here. No match means no page, which costs nothing;
      // a WRONG datasheet would assert chamber dimensions and a maximum
      // pressure for another cartridge inside a document the applicant signs.
      cipSheet: await this.cipSheetFor(answers.firearm_calibre),
      // The "take these to the police station" half of the checklist, and only
      // that half — the other half is the pack they are already holding.
      takeWithYou: buildChecklist(row.licenceType, kinds)
        .sections.find((sec) => sec.key === 'theirs')
        ?.items.map((i) => ({ label: i.label, note: i.note })),
    });
  }

  /**
   * The C.I.P. datasheet for a calibre, or nothing.
   *
   * ⚠️ FAIL-SOFT AND FLAG-GATED. A pack must never fail to render because a
   * reference page could not be found, read or licensed. The flag exists
   * because reproducing C.I.P.'s own typeset page inside a document we sell is
   * republication of somebody else's work, and that question was still open
   * when this shipped — turning it off costs the page and nothing else.
   */
  private async cipSheetFor(
    calibre: string | undefined,
  ): Promise<{ bytes: Buffer; label: string } | undefined> {
    const name = (calibre ?? '').trim();
    if (!name) return undefined;
    const on = await this.settings.get(FLAGS.cipSheetEnabled).catch(() => true);
    if (!on) return undefined;
    try {
      const sheet = await this.cip.sheetFor(name);
      if (!sheet) return undefined;
      return {
        bytes: sheet.bytes,
        label: `The cartridge — ${sheet.name} (C.I.P. data)`,
      };
    } catch {
      return undefined;
    }
  }

  /**
   * The signed statements, ready to print.
   *
   * ⚠️ THE SIGNATURE IS DECRYPTED FOR THIS RENDER AND NOT KEPT. It lives in
   * the encrypted tree like the applicant's own documents — it is a third
   * party's handwriting, given to us on a favour — and it exists in the clear
   * only inside the buffer that becomes the PDF.
   */
  /**
   * The previous owner's signed consent, as a sheet for the pack.
   *
   * ⚠️ THIS DID NOT EXIST, AND THE APPLICANT WAS TOLD IT DID. consentFormFor()
   * has built this sheet since the consent flow shipped and NOTHING EVER
   * CALLED IT — the module had zero callers. Meanwhile the panel on the
   * applicant's screen reads "their signed consent and a copy of their licence
   * are in your pack". Only the licence PHOTOGRAPHS were in the pack, as
   * SELLER_LICENCE annexures. The signed declaration — the document that
   * actually says the owner agrees to the transfer, the one a DFO needs — was
   * never rendered at all.
   *
   * Fail-soft like every other pack input: a consent we cannot read costs its
   * own sheet and nothing else.
   */
  private async buildSellerConsent(motivationId: string) {
    const row = await this.prisma.motivationSellerConsent.findUnique({
      where: { motivationId },
      select: {
        id: true,
        status: true,
        invitedPhone: true,
        answersEncrypted: true,
        firearmSnapshotEncrypted: true,
        signatureKey: true,
        licenceFrontKey: true,
        licenceBackKey: true,
        signedPlace: true,
        signedAt: true,
      },
    });
    if (!row || row.status !== 'COMPLETED') return undefined;

    let answers: Record<string, string> = {};
    let firearm: Record<string, unknown> = {};
    try {
      answers = JSON.parse(tryDecryptText(row.answersEncrypted) ?? '{}') as Record<
        string,
        string
      >;
      firearm = JSON.parse(
        tryDecryptText(row.firearmSnapshotEncrypted) ?? '{}',
      ) as Record<string, unknown>;
    } catch {
      this.logger.error(
        `Motivation ${motivationId}: seller consent ${row.id} would not decrypt`,
      );
      return undefined;
    }

    // The three stored files. Any that will not read is simply left out — the
    // declaration and the firearm list are the load-bearing part.
    const read = async (key: string | null) =>
      key ? await this.files.read(key).catch(() => null) : null;
    const [signature, front, back] = await Promise.all([
      read(row.signatureKey),
      read(row.licenceFrontKey),
      read(row.licenceBackKey),
    ]);

    return consentFormFor(
      {
        sellerFullName: answers.fullName ?? '',
        sellerIdNumber: answers.idNumber ?? '',
        sellerPhone: row.invitedPhone,
        firearm: firearm as never,
        signedPlace: row.signedPlace,
        signedAt: row.signedAt,
      },
      { signature, front, back },
    );
  }

  private async buildWitnessStatements(
    motivationId: string,
    applicantName: string,
    referenceNumber: string,
    licenceTypeLabel: string,
  ) {
    const rows = await this.prisma.motivationWitness.findMany({
      where: { motivationId, status: 'COMPLETED' },
      orderBy: { slot: 'asc' },
      select: {
        id: true,
        answersEncrypted: true,
        signedPlace: true,
        signedAt: true,
      },
    });
    if (!rows.length) return undefined;

    const out = [];
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      const plain = tryDecryptText(r.answersEncrypted);
      let parsed: Record<string, string> = {};
      try {
        parsed = plain ? (JSON.parse(plain) as Record<string, string>) : {};
      } catch {
        // A statement we cannot read must not take the whole pack down, and
        // must not print half-empty either — skip it and let the applicant
        // see it is missing from their own preview.
        this.logger.error(
          `Motivation ${motivationId}: witness ${r.id} answers would not decrypt`,
        );
        continue;
      }
      const signature = await this.witnesses.signature(r.id).catch(() => null);
      out.push(
        buildCompletedStatement({
          index: i + 1,
          total: rows.length,
          applicantName,
          referenceNumber,
          licenceTypeLabel,
          answers: parsed,
          signature: signature ?? undefined,
          signedPlace: r.signedPlace,
          signedAt: r.signedAt,
          version: parsed._version ?? WITNESS_FORM_VERSION,
        }),
      );
    }
    return out.length ? out : undefined;
  }

  // ── Character witnesses ─────────────────────────────────────────
  //
  // ⚠️ OWNERSHIP IS CHECKED HERE AND ONLY HERE. MotivationWitnessService knows
  // nothing about who is calling — it works from ids — because its other half
  // is reached by a stranger holding a link. Every applicant-side entry point
  // has to prove the motivation belongs to the caller before it delegates.

  private async requireOwnMotivation(clerkId: string, id: string) {
    const user = await this.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: { id: true, answersEncrypted: true },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    return { user, row };
  }

  async listWitnesses(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const { row } = await this.requireOwnMotivation(clerkId, id);
    return { witnesses: await this.witnesses.list(row.id) };
  }

  async inviteWitness(
    clerkId: string,
    id: string,
    args: { slot: number; name: string; phone: string },
  ) {
    await this.quota.assertEnabled();
    const { user, row } = await this.requireOwnMotivation(clerkId, id);
    const answers = this.readAnswers(row.answersEncrypted);
    return this.witnesses.invite({
      motivationId: row.id,
      applicantUserId: user.id,
      applicantName: (answers.full_name ?? '').trim() || 'An All Outdoor member',
      slot: args.slot,
      name: args.name,
      phone: args.phone,
      // ⚠️ FROM THE ENVIRONMENT, NEVER FROM THE REQUEST. A base URL taken off a
      // Host header is a base URL an attacker can set, and this one is posted
      // to a third party by SMS.
      baseUrl: process.env.FRONTEND_URL ?? 'https://alloutdoor.co.za',
    });
  }

  async removeWitness(clerkId: string, id: string, witnessId: string) {
    await this.quota.assertEnabled();
    const { row } = await this.requireOwnMotivation(clerkId, id);
    await this.witnesses.remove(row.id, witnessId);
    return { removed: true as const };
  }

  async witnessSignature(clerkId: string, id: string, witnessId: string) {
    await this.quota.assertEnabled();
    const { row } = await this.requireOwnMotivation(clerkId, id);
    const owned = await this.prisma.motivationWitness.findFirst({
      where: { id: witnessId, motivationId: row.id },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Witness not found');
    return this.witnesses.signature(owned.id);
  }

  // ── The cover photograph ────────────────────────────────────────
  //
  // Three sources, in the order that puts the applicant's own decision ahead
  // of ours. See motivation-cover-photo.ts for why "none" has to be stored
  // rather than inferred.

  /**
   * Which bytes go on the cover of THIS render.
   *
   * ⚠️ RESOLVED AT RENDER TIME, NOT STORED. The pack is rebuilt on every
   * download, so a decision the applicant changed five minutes ago only takes
   * effect if the choice is read here rather than baked in anywhere earlier.
   */
  private async coverPhotoForRender(
    row: { coverPhotoChoice: string | null; coverPhotoKey: string | null },
    answers: Record<string, string>,
  ): Promise<string | Buffer | undefined> {
    const choice = asCoverChoice(row.coverPhotoChoice);
    if (choice === 'NONE') return undefined;

    if (row.coverPhotoKey && choice !== 'STOCK') {
      // ⚠️ FAIL SOFT. A cover photograph that will not decrypt must not take
      // the whole motivation down — the applicant would lose the document
      // over its decoration.
      const own = await this.files.read(row.coverPhotoKey).catch(() => null);
      if (own) return own;
    }

    // Pure disk — see the note at the fetch site in the background pass.
    // Absent until that has run, and absent for good where Commons holds
    // nothing: the cover simply renders without a frame.
    if (!answers.firearm_make) return undefined;
    return this.firearmImages.find(
      answers.firearm_make,
      answers.firearm_model ?? '',
    )?.file;
  }

  /**
   * What to show the applicant when they open the cover-photograph card.
   *
   * Names the source of a stock photograph deliberately. Somebody being asked
   * "keep this or replace it?" is entitled to know the picture came off
   * Wikimedia Commons and shows the MODEL rather than their own firearm.
   */
  async coverPhoto(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        answersEncrypted: true,
        coverPhotoChoice: true,
        coverPhotoKey: true,
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    const answers = this.readAnswers(row.answersEncrypted);
    const make = (answers.firearm_make ?? '').trim();
    const model = (answers.firearm_model ?? '').trim();
    const stock = make ? this.firearmImages.find(make, model) : null;

    return {
      choice: asCoverChoice(row.coverPhotoChoice),
      hasOwn: Boolean(row.coverPhotoKey),
      firearmLine: [make, model].filter(Boolean).join(' ') || null,
      stock: stock
        ? {
            // The Commons file title, e.g. "File:Tikka-T3-Sporter.jpg", so the
            // applicant can go and look at it themselves if they want to.
            source: stock.source.split(/\s+/)[0] ?? '',
          }
        : null,
      // ⚠️ SENT, NOT HARD-CODED IN THE BUNDLE. The trim box locks to this
      // ratio and the frame prints at this size; a copy in the frontend would
      // go stale the first time the cover layout moved, and the symptom would
      // be a red box that promises a crop the cover does not print.
      aspect: COVER_ASPECT,
      frameMm: COVER_FRAME_MM,
      maxPx: COVER_MAX_PX,
    };
  }

  /** The bytes currently destined for the cover, for the on-screen preview. */
  async coverPhotoBytes(
    clerkId: string,
    id: string,
  ): Promise<{ bytes: Buffer; mimeType: string } | null> {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        answersEncrypted: true,
        coverPhotoChoice: true,
        coverPhotoKey: true,
        coverPhotoMime: true,
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    if (row.coverPhotoKey && asCoverChoice(row.coverPhotoChoice) !== 'STOCK') {
      const own = await this.files.read(row.coverPhotoKey).catch(() => null);
      if (own) {
        return { bytes: own, mimeType: row.coverPhotoMime ?? 'image/jpeg' };
      }
    }

    const answers = this.readAnswers(row.answersEncrypted);
    if (!answers.firearm_make) return null;
    const stock = this.firearmImages.find(
      answers.firearm_make,
      answers.firearm_model ?? '',
    );
    if (!stock) return null;
    const bytes = await readFile(stock.file).catch(() => null);
    if (!bytes) return null;
    return {
      bytes,
      mimeType: stock.file.endsWith('.png') ? 'image/png' : 'image/jpeg',
    };
  }

  /** Record the applicant's decision. */
  async setCoverPhotoChoice(clerkId: string, id: string, choice: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    const wanted = asCoverChoice(choice);
    if (!wanted) throw new BadRequestException('Unknown cover choice.');

    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: { id: true, coverPhotoKey: true },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    // ⚠️ "USE MY OWN" WITH NOTHING UPLOADED WOULD FALL THROUGH TO THE STOCK
    // PHOTOGRAPH, which is the opposite of what was asked for.
    if (wanted === 'OWN' && !row.coverPhotoKey) {
      throw new BadRequestException(
        'Upload a photograph first, then choose to use it.',
      );
    }
    await this.prisma.motivation.update({
      where: { id: row.id },
      data: { coverPhotoChoice: wanted },
    });
    return { choice: wanted };
  }

  /** Store the applicant's own cover photograph and select it. */
  async uploadCoverPhoto(
    clerkId: string,
    id: string,
    file: { buffer: Buffer; mimetype: string },
  ) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: { id: true, coverPhotoKey: true },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    const check = checkCoverPhoto(file.buffer, file.mimetype);
    if (!check.ok) throw new BadRequestException(check.problem);

    // ⚠️ THE ENCRYPTED TREE, like every other document they give us. A
    // photograph the applicant took of their own firearm can show its serial
    // number; it is not the shared, git-tracked stock asset in assets/firearms
    // and must not be stored beside one.
    const stored = await this.files.write(
      'motivations',
      file.buffer,
      new Date(),
    );
    const previous = row.coverPhotoKey;

    await this.prisma.motivation.update({
      where: { id: row.id },
      data: {
        coverPhotoKey: stored.storageKey,
        coverPhotoMime: file.mimetype,
        coverPhotoChoice: 'OWN',
      },
    });

    // Replace rather than accumulate — and only AFTER the row points at the
    // new file, so a crash between the two leaves an orphan on disk rather
    // than a cover referencing bytes we already deleted.
    if (previous) {
      await this.files.remove(previous).catch(() => undefined);
    }
    return { choice: 'OWN' as const, hasOwn: true };
  }

  /** Discard their own photograph and fall back to whatever we found. */
  async removeCoverPhoto(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: { id: true, coverPhotoKey: true },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    await this.prisma.motivation.update({
      where: { id: row.id },
      // Back to null rather than to STOCK: they have discarded a decision,
      // not made a new one, and the card should offer the stock photograph
      // afresh.
      data: {
        coverPhotoKey: null,
        coverPhotoMime: null,
        coverPhotoChoice: null,
      },
    });
    if (row.coverPhotoKey) {
      await this.files.remove(row.coverPhotoKey).catch(() => undefined);
    }
    return { choice: null, hasOwn: false };
  }

  /**
   * The pre-filled SAPS 271 — ONLY for applicants who asked for it.
   *
   * The 271 is an opt-in addition, not the product (operator, 2026-08-19):
   * most dealers complete the form with the buyer, so the default path never
   * asks the form-tier questions and never produces this document. Requesting
   * it without opting in is answered with a plain explanation, not a 404 —
   * the motivation exists; the form was declined.
   *
   * Available from the moment they opt in, not only after generation: the
   * whole point is that the form and the motivation are separate deliverables,
   * and leftBlank tells them exactly which boxes still need a pen.
   */
  async renderSaps271(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        referenceNumber: true,
        licenceType: true,
        answersEncrypted: true,
        uploads: { select: { kind: true } },
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    const answers = this.readAnswers(row.answersEncrypted);
    if ((answers[SAPS271_OPT_KEY] ?? '') !== SAPS271_FILL) {
      throw new ConflictException(
        'You chose to let your dealer complete the SAPS 271. If you would like us to fill it in instead, change that choice in your application first.',
      );
    }

    const account = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { email: true },
    });

    try {
      // ⚠️ THE LETTER, NOT A GUESS AT IT. Items 68.1 and 69.1 are answered by
      // citing the photographs of the safe, so the citation has to carry the
      // letter this pack's index actually gives them — which moves with what
      // else was uploaded. annexureByKind rather than a find() over the
      // entries, because the safe kinds collapse onto one letter and a lookup
      // by member kind misses every member but the group's representative.
      const safeAnnexureLetter = annexureByKind(
        buildAnnexures((row.uploads ?? []).map((u) => u.kind)),
      ).get(MotivationUploadKind.SAFE_PHOTOGRAPHS)?.letter;

      // ⚠️ SECTION F, AT LAST. Twenty-two boxes were mapped, tested and
      // UNREACHABLE: this call never passed a seller, so the current owner's
      // half of the form went to every DFO blank while the coverage panel
      // told the applicant it was done. Operator, 2026-08-28: "F should be
      // filled, type A."
      //
      // ⚠️ NULL ON EVERY ROUTE BUT A SIGNED PRIVATE SALE, and that is the
      // point: sectionF() returns nothing until the seller has actually
      // completed and signed, and saps271-map refuses to fill the block
      // unless the applicant said the route was private. Two independent
      // gates, because printing one person's particulars under another
      // person's declaration is the failure this section can produce.
      const seller = (await this.sellerConsent.sectionF(row.id)) ?? undefined;

      const { pdf, leftBlank } = await this.saps271.build({
        licenceType: row.licenceType,
        answers,
        email: account?.email ?? undefined,
        motivationReference: row.referenceNumber,
        safeAnnexureLetter,
        seller,
      });
      return {
        pdf,
        filename: `saps271-${row.referenceNumber}.pdf`,
        leftBlank,
      };
    } catch (err) {
      // buildSaps271 throws a plain Error for a section 24 renewal — the 271
      // is the wrong form for it. Said plainly rather than surfaced as a 500.
      throw new ConflictException((err as Error).message);
    }
  }

  /**
   * The live submission checklist, for the platform and the PWA.
   *
   * Deliberately NOT part of the PDF. The applicant works through this on
   * screen — ticking off what they have gathered — and it stays current right
   * up to the moment they print. Only the annexure index goes into the paper.
   */
  async checklist(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);

    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        licenceType: true,
        status: true,
        uploads: { select: { kind: true } },
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    return buildChecklist(
      row.licenceType,
      (row.uploads ?? []).map((u) => u.kind),
      row.status === MotivationStatus.COMPLETED,
      { waitingOn: this.waitingOn(await this.sellerState(row.id)) },
    );
  }

  /**
   * THE WHOLE LEFT COLUMN, IN ONE CALL.
   *
   * The screen used to assemble itself from several endpoints — the checklist
   * here, the offers there, the answers somewhere else — which is how two
   * parts of one page end up disagreeing about the same row while both are
   * "correct". This is one read, one answer.
   *
   * ⚠️ THE SAME waitingOn() AS checklist(), NOT A SECOND COPY. If these two
   * ever compute it differently, the row that says "waiting on Piet" on one
   * screen says "not started" on the next.
   *
   * ⚠️ NO ANSWER VALUES IN THE PROVENANCE. It carries a source name, a row id,
   * a timestamp and the member's own title for their own document — checked
   * by parseProvenance, which drops anything else. The answers themselves are
   * returned by findOne, which is where they belong and where they are already
   * ownership-scoped.
   */
  async pack(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);

    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        referenceNumber: true,
        licenceType: true,
        status: true,
        answersEncrypted: true,
        answerProvenance: true,
        uploads: { select: { kind: true } },
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    const answers = this.readAnswers(row.answersEncrypted);
    const provenance = parseProvenance(row.answerProvenance);
    const seller = await this.sellerState(row.id);

    return {
      id: row.id,
      referenceNumber: row.referenceNumber,
      licenceType: row.licenceType,
      status: row.status,
      checklist: buildChecklist(
        row.licenceType,
        (row.uploads ?? []).map((u) => u.kind),
        row.status === MotivationStatus.COMPLETED,
        { waitingOn: this.waitingOn(seller) },
      ),
      // Section-by-section completeness, counted in QUESTIONS rather than in
      // form boxes — saps271-coverage.ts explains why the unit matters.
      coverage: saps271Coverage(row.licenceType, answers, {
        seller: { status: seller.status, name: seller.name },
      }),
      provenance,
      prefill: {
        // ⚠️ COUNTED AGAINST THE ANSWERS, not against the map. A field we
        // filled and the member then cleared is not something we filled for
        // them, and a banner claiming credit for work that is not on the
        // screen is worse than no banner.
        filled: automaticCount(provenance, answers),
        sources: automaticSources(provenance),
      },
    };
  }

  /**
   * Facts WE compute rather than ask for. Keeping this in code is what stops
   * the model doing arithmetic on someone's licence application.
   */
  private deriveFacts(
    answers: Record<string, string>,
    asAt = new Date(),
  ): Record<string, string> {
    const derived: Record<string, string> = {};

    // AGE ONLY, deliberately. readSaId also yields date of birth, gender and
    // citizenship — those are SAPS 271 box-fillers, not argument material, and
    // there is no reason to put someone's date of birth in a prompt. Age is
    // here because a motivation may legitimately reason about it.
    const { age } = readSaId(answers.id_number ?? '', asAt);
    if (age !== null && age >= 18) derived.applicant_age = String(age);

    const since = (answers.dedicated_since ?? '').trim();
    const yearMatch = /^([0-9]{4})/.exec(since);
    if (yearMatch) {
      const years = asAt.getUTCFullYear() - Number(yearMatch[1]);
      if (years >= 0 && years < 80) derived.years_dedicated = String(years);
    }

    // WHERE THE FIREARM IS UNTIL THE APPLICATION IS DECIDED.
    //
    // Operator, item 3 of twelve, 2026-08-24, on the dealer route: put the
    // invoice in "as proof of purchase and also where the fire arm is
    // currently stored until the application has reached it's outcome."
    //
    // It is a question every DFO has and almost no motivation answers: an
    // applicant cannot lawfully hold the firearm before the licence is
    // granted, so somebody else is holding it, and saying who closes the loop.
    //
    // ⚠️ NEVER "IN MY POSSESSION", AND NEVER "COLLECTED PRIVATELY". A firearm
    // always moves through a licensed dealer; on the private route the seller
    // keeps lawful possession until that transfer happens. Deriving this in
    // code rather than asking is what stops the writer inventing a custody
    // arrangement that would be an offence if true.
    const source = (answers[FIREARM_SOURCE_KEY] ?? '').trim();
    if (source === SOURCE_DEALER) {
      derived.custody_pending_outcome =
        'The dealer holds the firearm in their stock until the licence is granted; the applicant takes possession only after that.';
    } else if (source === SOURCE_PRIVATE) {
      derived.custody_pending_outcome =
        'The current licensed owner keeps the firearm until the licence is granted, and the transfer is then done through a licensed dealer.';
    } else if (source === SOURCE_ESTATE) {
      // ⚠️ THE ESTATE HOLDS IT, AND SAYING SO MATTERS MORE HERE THAN ANYWHERE.
      // An heir living in the deceased's house is the person most likely to
      // have the firearm in the same building already, and a motivation that
      // implied they were keeping it would describe an offence on a document
      // they sign. An estate firearm is held by the executor, in a licensed
      // dealer's safe or with SAPS, until the licence is decided.
      derived.custody_pending_outcome =
        'The firearm is held by the estate — with a licensed dealer or SAPS — until the licence is granted and it is transferred through a dealer.';
    }

    return derived;
  }

  /** Fingerprints of recent same-type documents, for the sameness check. */
  private async recentFingerprints(
    licenceType: MotivationLicenceType,
    excludeId: string,
    excludeUserId: string,
  ): Promise<string[][]> {
    const rows = await this.prisma.motivation.findMany({
      where: {
        licenceType,
        id: { not: excludeId },
        // THE APPLICANT'S OWN EARLIER DOCUMENTS ARE NOT COMPETITION.
        //
        // The sameness engine exists for one reason: so the CFR never sees a
        // flood of near-identical documents from DIFFERENT people. Two
        // motivations by the SAME person are a different case entirely — they
        // describe one life, so they SHOULD share circumstances, and forcing
        // them apart is actively harmful. A second application whose account of
        // the same commute, the same premises and the same history reads
        // differently from the first is the exact contradiction a DFO looks
        // for, and we would have manufactured it ourselves.
        //
        // Operator, 2026-08-18: keep the earlier motivations so a repeat
        // applicant gets the same storyline. This is the half of that which
        // stops us fighting it.
        userId: { not: excludeUserId },
        status: MotivationStatus.COMPLETED,
      },
      orderBy: { createdAt: 'desc' },
      take: SIMILARITY_CORPUS,
      select: { structureFingerprint: true },
    });
    return rows.map((r) => r.structureFingerprint).filter((f) => f.length > 0);
  }

  /**
   * Turn the gate's thin-field list into questions. WE pick the fields; Claude
   * only phrases them. If it cannot, the field's own help text is the fallback
   * — a plain question beats no question.
   */
  private async queueFollowUps(
    motivationId: string,
    licenceType: MotivationLicenceType,
    thinFields: string[],
    answers: Record<string, string>,
  ): Promise<void> {
    // WHAT to ask is worked out in code, for nothing — it is arithmetic over
    // the field registry. Claude is asked only to WORD the questions, which is
    // the one part it is genuinely better at.
    // ⚠️ NEVER ASK A QUESTION THAT IS ALREADY ON SCREEN UNANSWERED. Every
    // gate cycle used to queue its follow-ups blind, so three attempts put
    // THREE copies of "could you tell me a bit more about your competition
    // record" in front of the applicant — who read it, reasonably, as the
    // system falling apart. A question counts as open until a user message
    // with the same fieldKey arrives after it, which is the same rule the
    // wizard renders by.
    const history = await this.prisma.motivationMessage.findMany({
      where: { motivationId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, fieldKey: true },
    });
    const open = new Set<string>();
    for (const m of history) {
      if (!m.fieldKey) continue;
      if (m.role === 'assistant') open.add(m.fieldKey);
      else open.delete(m.fieldKey);
    }

    const gaps = findGaps(licenceType, answers, { thinFields })
      .filter((g) => !open.has(g.key))
      .slice(0, FOLLOW_UP_BATCH);
    if (!gaps.length) return;

    // ONE request for the batch. This used to be one per field, which meant a
    // failed gate sent the whole system prompt three times to produce three
    // sentences.
    let phrased: Record<string, string> = {};
    try {
      const res = await this.claude.askFollowUpBatch({
        licenceType,
        gaps: gapBrief(gaps),
      });
      phrased = res.questions;
    } catch {
      // Every gap has a free fallback, so a failure here costs wording, not
      // the interview.
      phrased = {};
    }

    for (const gap of gaps) {
      await this.prisma.motivationMessage
        .create({
          data: {
            motivationId,
            role: 'assistant',
            fieldKey: gap.key,
            contentEncrypted: encryptText(
              phrased[gap.key] ?? fallbackQuestion(gap),
            ),
          },
        })
        .catch(() => undefined);
    }
  }

  /**
   * Decrypt the answer blob, tolerating absence and corruption.
   *
   * A row with no answers yet is normal (a fresh draft). A row whose blob will
   * not decrypt is not, but returning {} lets the applicant see their form and
   * start again rather than meeting a 500 with no way forward.
   */
  /**
   * REFILE A DOCUMENT UNDER A DIFFERENT TYPE.
   *
   * Needed the moment anything files documents automatically, and needed
   * anyway: the type is what the required-documents checklist counts, so a
   * mislabelled upload silently satisfies a requirement the pack does not meet.
   * Before this there was no way to correct one short of deleting the file and
   * uploading it again.
   */
  async changeUploadKind(
    clerkId: string,
    id: string,
    uploadId: string,
    kind: MotivationUploadKind,
  ) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);

    // Ownership through the parent, in the WHERE clause — never a post-fetch
    // check.
    const claim = await this.prisma.motivationUpload.updateMany({
      where: { id: uploadId, motivation: { id, userId: user.id } },
      data: { kind },
    });
    if (claim.count === 0) throw new NotFoundException('Document not found');
    return { kind };
  }

  // ────────────────────────────────────────────────────────────────────
  // WHO WE ARE WAITING ON.
  //
  // ⚠️ ONE PLACE, BECAUSE TWO WOULD DIVERGE. buildChecklist is pure and cannot
  // reach a witness or a seller's consent, so the status has to be injected —
  // and both callers (checklist() and pack()) must inject the SAME thing or
  // the two endpoints will disagree about the same row on the same screen.
  // This method is that one place; neither caller computes it itself.
  //
  // A row nobody is waiting on is simply absent from the map. Absence is the
  // ordinary case and reads as "not started", which is correct.
  /**
   * The seller's half of a private sale, as a plain status.
   *
   * ⚠️ READ ONCE, USED TWICE. Both the checklist row and the 271 section panel
   * need to know where he stands. Reading it separately for each would be two
   * queries and, worse, two chances to interpret one status differently on one
   * screen.
   *
   * Read straight off the row rather than through the consent service: this
   * needs one nullable status and none of that service's behaviour, and
   * injecting it here would mean touching the module wiring and every
   * construction of MotivationsService for a single string.
   */
  private async sellerState(motivationId: string): Promise<{
    status: 'NONE' | 'INVITED' | 'COMPLETED' | 'DECLINED';
    name?: string;
    openedAt: Date | null;
  }> {
    try {
      const consent = await this.prisma.motivationSellerConsent.findUnique({
        where: { motivationId },
        select: { status: true, invitedName: true, openedAt: true },
      });
      if (!consent) return { status: 'NONE', openedAt: null };
      return {
        status: consent.status as 'INVITED' | 'COMPLETED' | 'DECLINED',
        name: (consent.invitedName ?? '').trim() || undefined,
        openedAt: consent.openedAt,
      };
    } catch (err) {
      // A status we cannot read costs the sentence, not the screen.
      this.logger.warn(
        `Motivation ${motivationId}: seller consent status unreadable — ${(err as Error).message}`,
      );
      return { status: 'NONE', openedAt: null };
    }
  }

  private waitingOn(seller: {
    status: string;
    name?: string;
    openedAt: Date | null;
  }): Record<string, string> {
    const out: Record<string, string> = {};
    const who = seller.name || 'the seller';

    if (seller.status === 'INVITED') {
      out.upload_firearm_source_proof = seller.openedAt
        ? `${who} has opened the link and is busy with it. Nothing for you to do.`
        : `Sent to ${who}. He photographs his licence on his own phone — you upload nothing.`;
    }
    if (seller.status === 'DECLINED') {
      // ⚠️ NOT "WAITING", AND DELIBERATELY NOT SILENT EITHER. A declined
      // seller is a dead end for that route and the applicant has to be told
      // so, with the other route named — otherwise the row sits amber for
      // ever and looks like a system that has forgotten about them.
      out.upload_firearm_source_proof = `${seller.name || 'The seller'} declined. Upload a certified copy of his licence yourself instead.`;
    }

    // ⚠️ NO WITNESS ENTRY HERE, AND THAT IS A FINDING RATHER THAN AN OVERSIGHT.
    //
    // Character references are the other thing an applicant waits on somebody
    // else for, the witness engine is built, and the invited-but-unsigned
    // state is exactly what 'waiting-on-someone' was added for. But
    // CHARACTER_REFERENCE is not in RECOMMENDED for ANY licence type, so the
    // checklist has no row for it — a sentence keyed to
    // `upload_character_reference` would attach to nothing and look alive
    // while doing nothing at all.
    //
    // Making it a row changes oursTotal for every licence type and moves the
    // progress ring an existing screen already renders, which is a product
    // decision and not a refactor. The guard test below is what stops this
    // being written again by mistake.

    return out;
  }

  // ────────────────────────────────────────────────────────────────────
  // PROVENANCE — recording where a prefilled answer came from.
  //
  // These exist so the six write paths cannot each invent their own version.
  // Two rules run through all of them and both are easy to get wrong once:
  //
  //  1. STAMP ONLY WHAT WAS WRITTEN. sanitiseAnswers can drop a key even from
  //     a trusted offer. Provenance for a value that was never stored puts a
  //     "From your Document Centre" chip on a blank field.
  //  2. ONE stamp() CALL PER KEY, never one for the batch. Both offers carry
  //     PER-KEY source text, and credentialOffer carries a per-key credential
  //     id — a single bulk call has no correct `from` to pass.
  //
  // stamp() itself is what refuses to overwrite a MEMBER entry, so every one
  // of these is safe to call over an application the member has edited.
  // ────────────────────────────────────────────────────────────────────

  /** Stamp the profile's contribution. PROFILE never carries a sourceId. */
  private stampProfile(
    map: ProvenanceMap,
    written: Record<string, string>,
    from: Record<string, string>,
  ): ProvenanceMap {
    let out = map;
    for (const [key, source] of Object.entries(from ?? {})) {
      if (!(key in written)) continue;
      out = stamp(out, [key], { source: 'PROFILE', from: source });
    }
    return out;
  }

  /** Stamp the vault's contribution, one entry per offered value. */
  private stampVault(
    map: ProvenanceMap,
    written: Record<string, string>,
    items: readonly { key: string; from: string; credentialId: string }[],
  ): ProvenanceMap {
    let out = map;
    for (const item of items ?? []) {
      if (!(item.key in written)) continue;
      out = stamp(out, [item.key], {
        source: 'VAULT',
        sourceId: item.credentialId,
        from: item.from,
      });
    }
    return out;
  }

  /**
   * create()'s three contributors, stamped in the same precedence order the
   * values were merged in: profile, then vault, then seed.
   *
   * ⚠️ THE ORDER IS THE POINT. Values spread profile → vault → seed, so the
   * last writer wins. Stamping in any other order would attribute a value to
   * whoever was overruled.
   */
  private stampOffers(
    map: ProvenanceMap,
    written: Record<string, string>,
    profileFrom: Record<string, string>,
    vaultItems: readonly { key: string; from: string; credentialId: string }[],
    seed: Record<string, string>,
  ): ProvenanceMap {
    let out = this.stampProfile(map, written, profileFrom);
    out = this.stampVault(out, written, vaultItems);

    // The only non-empty seed today is a renewal, built by licence-renewal.ts
    // from the licence being renewed — so VAULT is truthful. It carries no
    // credential id because RenewalPlan does not pass one through; wiring that
    // is a Licence Centre change, not a Phase 1 one.
    for (const key of Object.keys(seed ?? {})) {
      if (!(key in written)) continue;
      out = stamp(out, [key], {
        source: 'VAULT',
        from: 'the licence you are renewing',
      });
    }
    return out;
  }

  private readAnswers(encrypted: string | null): Record<string, string> {
    if (!encrypted) return {};
    try {
      return decryptJson<Record<string, string>>(encrypted);
    } catch (err) {
      this.logger.error(
        `Could not decrypt motivation answers: ${(err as Error).message}`,
      );
      return {};
    }
  }
}
