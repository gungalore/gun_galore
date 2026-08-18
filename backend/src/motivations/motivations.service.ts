import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { MotivationLicenceType, MotivationStatus } from '@prisma/client';
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
import { MotivationPdfService } from './motivation-pdf.service';
import { SettingsService, FLAGS } from '../settings/settings.service';
import {
  planFor,
  followsPlan,
  fingerprint,
  maxSimilarity,
  SIMILARITY_REGENERATE_THRESHOLD,
} from './motivation-structure';
import type { FactPack } from './motivation-prompts';
import {
  FIELD_REGISTRY_VERSION,
  LICENCE_TYPE_LABELS,
  fieldByKey,
  fieldsFor,
  missingRequired,
  sanitiseAnswers,
} from './motivation-fields';

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

const DISCLAIMER_TEXT =
  'This document was prepared from information supplied by the applicant and ' +
  'is submitted by the applicant as their own motivation. It is not legal ' +
  'advice. The applicant confirms that the facts stated are true and correct ' +
  'to the best of their knowledge.';

/** How many same-type documents to compare against for sameness. */
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

    try {
      return await this.prisma.motivation.create({
        data: {
          referenceNumber,
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
        select: { id: true, referenceNumber: true, status: true },
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
      thinFields: row.thinFields,
      qualityScore: row.qualityScore,
      gateCycles: row.gateCycles,
      declarationAcceptedAt: row.declarationAcceptedAt,
      hasDocument: !!row.documentTextEncrypted,
      documentVersion: row.documentVersion,
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

    const { answers: clean, rejected } = sanitiseAnswers(row.licenceType, patch);
    const merged = { ...this.readAnswers(row.answersEncrypted), ...clean };

    await this.prisma.motivation.update({
      where: { id: row.id },
      data: {
        answersEncrypted: encryptJson(merged),
        answersSchemaVersion: FIELD_REGISTRY_VERSION,
      },
    });

    if (rejected.length) {
      // Not an error — a stale client can legitimately send a key we have
      // since removed. Logged as KEYS ONLY; the values are the sensitive part.
      this.logger.warn(
        `Motivation ${row.id}: ignored unregistered answer keys ${rejected.join(', ')}`,
      );
    }

    return {
      saved: Object.keys(clean).length,
      ignored: rejected,
      missingRequired: missingRequired(row.licenceType, merged),
    };
  }

  /** Walk away without deleting — keeps the audit trail, frees nothing. */
  async abandon(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    const res = await this.prisma.motivation.updateMany({
      where: { id, userId: user.id, status: { in: EDITABLE } },
      data: { status: MotivationStatus.ABANDONED },
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
  async generate(clerkId: string, id: string) {
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
        promptTokens: true,
        completionTokens: true,
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

      const pack: FactPack = {
        licenceType: row.licenceType,
        answers,
        derived: this.deriveFacts(answers),
      };

      // Draft, verify the plan landed, and check it does not look like
      // everything else we have produced. ONE retry with a fresh seed covers
      // both failures — a second identical result means the variation engine
      // is broken, which is an admin problem rather than a user one.
      let seed = row.variantSeed;
      let plan = planFor(row.licenceType, seed);
      let attempt = await this.claude.generate(pack, plan);
      let tokensIn = attempt.usage.promptTokens;
      let tokensOut = attempt.usage.completionTokens;

      const previous = await this.recentFingerprints(row.licenceType, row.id);
      let structureOk = followsPlan(attempt.text, plan).ok;
      let sameness = maxSimilarity(fingerprint(attempt.text), previous);

      if (!structureOk || sameness > SIMILARITY_REGENERATE_THRESHOLD) {
        this.logger.warn(
          `Motivation ${row.id}: regenerating (structureOk=${structureOk}, sameness=${sameness.toFixed(2)})`,
        );
        seed = crypto.randomInt(0, 2 ** 31 - 1);
        plan = planFor(row.licenceType, seed);
        attempt = await this.claude.generate(pack, plan);
        tokensIn += attempt.usage.promptTokens;
        tokensOut += attempt.usage.completionTokens;
        structureOk = followsPlan(attempt.text, plan).ok;
        sameness = maxSimilarity(fingerprint(attempt.text), previous);
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

      if (graded.verdict.passed) {
        const retentionDays = await this.settings.get(
          FLAGS.motivationRetentionDays,
        );
        await this.prisma.motivation.update({
          where: { id: row.id },
          data: {
            ...common,
            status: MotivationStatus.COMPLETED,
            documentTextEncrypted: encryptText(attempt.text),
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
   * Render the PDF. Nothing is stored — it is rebuilt from the encrypted text
   * on every download, so erasure has no assets to chase and a lost file is
   * impossible.
   */
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
      generatedAt: row.completedAt ?? new Date(),
    });
  }

  /**
   * Facts WE compute rather than ask for. Keeping this in code is what stops
   * the model doing arithmetic on someone's licence application.
   */
  private deriveFacts(answers: Record<string, string>): Record<string, string> {
    const derived: Record<string, string> = {};

    const id = (answers.id_number ?? '').trim();
    if (/^[0-9]{13}$/.test(id)) {
      const yy = Number(id.slice(0, 2));
      const mm = Number(id.slice(2, 4));
      const dd = Number(id.slice(4, 6));
      const now = new Date();
      const century =
        yy > Number(String(now.getUTCFullYear()).slice(2)) ? 1900 : 2000;
      const dob = new Date(Date.UTC(century + yy, mm - 1, dd));
      if (!Number.isNaN(dob.getTime())) {
        let age = now.getUTCFullYear() - dob.getUTCFullYear();
        const beforeBirthday =
          now.getUTCMonth() < dob.getUTCMonth() ||
          (now.getUTCMonth() === dob.getUTCMonth() &&
            now.getUTCDate() < dob.getUTCDate());
        if (beforeBirthday) age--;
        if (age >= 18 && age < 120) derived.applicant_age = String(age);
      }
    }

    const since = (answers.dedicated_since ?? '').trim();
    const yearMatch = /^([0-9]{4})/.exec(since);
    if (yearMatch) {
      const years = new Date().getUTCFullYear() - Number(yearMatch[1]);
      if (years >= 0 && years < 80) derived.years_dedicated = String(years);
    }

    return derived;
  }

  /** Fingerprints of recent same-type documents, for the sameness check. */
  private async recentFingerprints(
    licenceType: MotivationLicenceType,
    excludeId: string,
  ): Promise<string[][]> {
    const rows = await this.prisma.motivation.findMany({
      where: {
        licenceType,
        id: { not: excludeId },
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
    // Three at a time. A wall of questions after a failed gate reads as
    // punishment and gets abandoned.
    for (const key of thinFields.slice(0, 3)) {
      const field = fieldByKey(licenceType, key);
      if (!field) continue;

      let question: string | null = null;
      try {
        const asked = await this.claude.askFollowUp({
          licenceType,
          fieldKey: key,
          fieldLabel: field.label,
          fieldHelp: field.help,
          currentAnswer: answers[key] ?? '',
        });
        question = asked.question;
      } catch {
        question = null;
      }

      const fallback =
        `Could you tell me a bit more about ${field.label.toLowerCase()}?` +
        (field.help ? ' ' + field.help : '');

      await this.prisma.motivationMessage
        .create({
          data: {
            motivationId,
            role: 'assistant',
            fieldKey: key,
            contentEncrypted: encryptText(question ?? fallback),
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
