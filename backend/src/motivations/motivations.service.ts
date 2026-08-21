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
import { MotivationQuotaService } from './motivation-quota.service';
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
import { buildLibrary } from './motivation-library';
import { SettingsService, FLAGS } from '../settings/settings.service';
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
import { buildPriorNoticeRequest } from './motivation-prior-notice';
import { buildCharacterStatements } from './motivation-character-statement';
import { readFile } from 'node:fs/promises';
import { FirearmImageService } from './motivation-firearm-image';
import { markForSection, type MarkName } from './motivation-pdf-marks';
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
  LICENCE_TYPE_LABELS,
  fieldByKey,
  fieldsFor,
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
  CREDENTIAL_TO_UPLOAD,
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
 * Has this pack been paid for, or does it hold a free-beta seat?
 *
 * ⚠️ TWO WAYS TO BE SETTLED, AND THE SECOND IS NOT A LOOPHOLE. A beta seat
 * is allocated from an atomic counter with a hard cap; holding one is how the
 * operator chose to give the first members the product for nothing. Both mean
 * "this person is entitled to a clean document", so both clear the watermark.
 *
 * Payments are not live yet, so today this is almost always false and almost
 * every pack carries the mark. That is the correct default: the failure mode
 * of getting it wrong the other way is handing out the finished product for
 * nothing.
 */
export function isSettled(row: {
  billedCents: number;
  betaSeatNo: number | null;
}): boolean {
  return row.billedCents > 0 || row.betaSeatNo !== null;
}

/** Statuses where the applicant may still edit their answers. */
const EDITABLE: MotivationStatus[] = [
  MotivationStatus.DRAFT,
  MotivationStatus.INTERVIEW,
  MotivationStatus.NEEDS_MORE_INFO,
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
    private readonly saps271: Saps271Service,
    private readonly firearmImages: FirearmImageService,
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
    const { answers: seeded } = sanitiseAnswers(licenceType, {
      ...prefill.values,
      ...seed,
    });

    try {
      return await this.prisma.motivation.create({
        data: {
          referenceNumber,
          ...(Object.keys(seeded).length
            ? {
                answersEncrypted: encryptJson(seeded),
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
      status: row.status,
      fields: fieldsFor(row.licenceType),
      answers,
      missingRequired: missingRequired(row.licenceType, answers),
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
      // Which of the fifteen templates this pack is set in. Validated on read
      // because the columns are plain VARCHARs — see asFormat/asScheme.
      template: {
        format: asFormat(row.templateFormat),
        colourway: asScheme(row.templateColourway),
      },
      // ⚠️ WATERMARK UNTIL IT IS PAID FOR — OR EARNED. Operator, 2026-08-19:
      // "Be sure to watermark any item that has not been paid for or have the
      // merit as a free motivation." A free-beta seat is earned, so it is not
      // watermarked; an unpaid, unseated pack is.
      watermarked: !isSettled(row),
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
      select: { id: true, licenceType: true, status: true, answersEncrypted: true },
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
    const merged = { ...this.readAnswers(row.answersEncrypted), ...clean };

    await this.prisma.motivation.update({
      where: { id: row.id },
      data: {
        answersEncrypted: encryptJson(merged),
        answersSchemaVersion: FIELD_REGISTRY_VERSION,
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
        },
      }),
      this.prisma.motivationUpload.findMany({
        where: { motivation: { userId: user.id } },
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

    const items = buildLibrary(credentials, uploads, row.id, documentLabel);

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
    const now = new Date();
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
  async addFromLibrary(
    clerkId: string,
    id: string,
    source: 'credential' | 'upload',
    sourceId: string,
  ) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: { id: true, status: true },
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
      const mapped = CREDENTIAL_TO_UPLOAD[c.kind];
      if (!mapped?.length) {
        throw new BadRequestException(
          'That document does not answer anything on this application.',
        );
      }
      // ⚠️ FILED AS THE FIRST, COUNTING FOR ALL OF THEM. A membership
      // certificate is both the association card and the letter of good
      // standing; a second row for the same bytes would collide with the
      // sha256 unique index and print the same page twice in the pack.
      kind = mapped[0] as MotivationUploadKind;
      alsoSatisfies = mapped.slice(1) as MotivationUploadKind[];
      storageKey = c.storageKey;
      mimeType = c.mimeType;
      purgedAt = c.purgedAt;

      // ⚠️ THE VAULT'S READING COMES ACROSS TOO, and without it the copy
      // looked BROKEN. A motivation upload with no extraction is flagged
      // "suspect" — the amber "we could not read anything this document
      // carries" state — because for a photograph that means the wrong line
      // was picked. A document copied out of the vault had never been read
      // as a motivation upload at all, so every single library pick came back
      // amber, telling the member something was wrong with a certificate they
      // had chosen by name off a list.
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
      const u = await this.prisma.motivationUpload.findFirst({
        where: { id: sourceId, motivation: { userId: user.id } },
        select: {
          kind: true,
          storageKey: true,
          mimeType: true,
          purgedAt: true,
          extractionOk: true,
          extractedFields: true,
          extractionEncrypted: true,
        },
      });
      if (!u) throw new NotFoundException('Document not found');
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
    // ⚠️ THE ONE-BUTTON FILL STAYS CONFIRMED-ONLY. It writes values without
    // the member looking at each; the dropdown shows them what they picked.
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
      documents: credentials
        .filter((c) => CREDENTIAL_TO_UPLOAD[c.kind])
        .map((c) => ({
          credentialId: c.id,
          title: c.title,
          kind: c.kind,
          satisfies: CREDENTIAL_TO_UPLOAD[c.kind],
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
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    if (!EDITABLE.includes(row.status)) {
      throw new ConflictException('This application can no longer be edited.');
    }

    const answers = this.readAnswers(row.answersEncrypted);
    const offer = credentialOffer(
      row.licenceType,
      await this.credentialsFor(user.id),
      answers,
    );

    // Through sanitiseAnswers like every other write. The vault's contents are
    // the member's own, but they were read off a photograph by a model and
    // they still have to satisfy the registry.
    const { answers: clean } = sanitiseAnswers(row.licenceType, offer.values);
    const merged = { ...answers, ...clean };

    await this.prisma.motivation.update({
      where: { id: row.id },
      data: {
        answersEncrypted: encryptJson(merged),
        answersSchemaVersion: FIELD_REGISTRY_VERSION,
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

    await this.prisma.motivation.update({
      where: { id: row.id },
      data: {
        answersEncrypted: encryptJson(merged),
        answersSchemaVersion: FIELD_REGISTRY_VERSION,
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
        // The uniqueness constraint is on (motivationId, sha256) — the BYTES,
        // not the kind. So this also fires when someone tries to file one
        // photograph under two of the three safe shots, which is a different
        // mistake and needs saying, or the wizard reads as broken: it goes on
        // showing the shot as missing right after telling them it is a
        // duplicate.
        throw new ConflictException(
          'That exact file is already attached to this application. If you are adding the safe photographs, each of the three needs to be its own picture.',
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

    await this.prisma.motivation.update({
      where: { id: row.id },
      data: {
        answersEncrypted: encryptJson(merged),
        answersSchemaVersion: FIELD_REGISTRY_VERSION,
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

    // COMPARE-AND-SWAP. Two clicks on Generate must not both call Claude —
    // that is duplicated spend and a race on the row. Only the request that
    // moves the status out of an editable state proceeds.
    const claimed = await this.prisma.motivation.updateMany({
      where: { id: row.id, status: { in: EDITABLE } },
      data: { status: MotivationStatus.GENERATING },
    });
    if (claimed.count === 0) {
      throw new ConflictException(
        'This document is already being prepared. Give it a moment.',
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
          .research({ licenceType: row.licenceType, answers })
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
      let seed = row.variantSeed;
      let plan = planFor(row.licenceType, seed);
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
        plan = planFor(row.licenceType, seed);
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
        overlap.needsJustification,
      );
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
      throw err;
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
   * Fifteen minutes is well past the ~90 seconds a real run takes, so this
   * cannot cut off work that is still going; and it moves the row to
   * NEEDS_MORE_INFO rather than an editable draft, because tokens may well
   * have been spent and the applicant should see the state as it is.
   */
  @Cron('*/5 * * * *')
  async sweepStuckGenerations() {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000);
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
    choice: { format?: string; colourway?: string },
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
      },
      select: { templateFormat: true, templateColourway: true },
    });

    return {
      format: asFormat(updated.templateFormat),
      colourway: asScheme(updated.templateColourway),
    };
  }

  async renderPdf(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);

    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        referenceNumber: true,
        licenceType: true,
        status: true,
        documentTextEncrypted: true,
        templateVersion: true,
        answersEncrypted: true,
        completedAt: true,
        templateFormat: true,
        templateColourway: true,
        structurePlan: true,
        coverPhotoChoice: true,
        coverPhotoKey: true,
        coverPhotoMime: true,
        billedCents: true,
        betaSeatNo: true,
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
    // The two blank character reference forms.
    //
    // ⚠️ ALWAYS BOTH, AND ALWAYS BLANK, EVEN IF THE APPLICANT HAS ALREADY
    // UPLOADED SIGNED ONES. They cost two sheets, and the alternative — hiding
    // them once a CHARACTER_REFERENCE upload exists — silently removes them
    // from the pack of the applicant whose first referee changed their mind,
    // which is precisely when a spare blank form is worth having.
    //
    // Derived purely from identifying details, like the prior notice: no
    // Claude call, no stored text, identical on every re-render.
    const characterStatements = buildCharacterStatements({
      applicantName: answers.full_name || 'The applicant',
      referenceNumber: row.referenceNumber,
      licenceTypeLabel: LICENCE_TYPE_LABELS[row.licenceType],
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
      // See isSettled. Payments are not live, so today this stamps almost
      // every download — which is the right way round.
      watermark: !isSettled(row),
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
      annexureImages: printable.images,
      annexuresNotPrinted: printable.notPrinted,
      // Merged into the finished pack by pdf-lib after pdfkit has drawn the
      // body — these used to be listed as "bring your own copy".
      annexurePdfs: printable.pdfs,
      // The "take these to the police station" half of the checklist, and only
      // that half — the other half is the pack they are already holding.
      takeWithYou: buildChecklist(row.licenceType, kinds)
        .sections.find((sec) => sec.key === 'theirs')
        ?.items.map((i) => ({ label: i.label, note: i.note })),
    });
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
      const { pdf, leftBlank } = await this.saps271.build({
        licenceType: row.licenceType,
        answers,
        email: account?.email ?? undefined,
        motivationReference: row.referenceNumber,
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
    );
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
    overlapNeedsJustification = false,
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

    const gaps = findGaps(licenceType, answers, {
      thinFields,
      overlapNeedsJustification,
    })
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
