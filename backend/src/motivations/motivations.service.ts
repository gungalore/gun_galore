import {
  BadRequestException,
  GoneException,
  ServiceUnavailableException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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
} from './motivation-structure';
import type { FactPack } from './motivation-prompts';
import {
  buildAnnexures,
  buildChecklist,
  UPLOAD_KIND_LABELS,
} from './motivation-checklist';
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

const DISCLAIMER_TEXT =
  'This document was prepared from information supplied by the applicant and ' +
  'is submitted by the applicant as their own motivation. It is not legal ' +
  'advice. The applicant confirms that the facts stated are true and correct ' +
  'to the best of their knowledge.';

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
      if (!mapped) {
        throw new BadRequestException(
          'That document does not answer anything on this application.',
        );
      }
      kind = mapped as MotivationUploadKind;
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
    };
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
        row.uploads.map((u) => u.kind),
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
        row.uploads.map((u) => u.kind),
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
        // Needed so the sameness corpus can exclude this applicant's own
        // earlier documents — see recentFingerprints.
        userId: true,
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

      // DOES THIS APPLICANT ALREADY HOLD SOMETHING THAT DOES THIS JOB?
      //
      // The question that gets a second medium-game rifle refused, and one the
      // Registrar asks whether or not we do. Computed once here and used in
      // both directions: the note tells the writer to meet the objection head
      // on, and needsJustification promotes the "why both" question in the
      // follow-up ranking if the gate sends this back.
      const overlap = overlapFromAnswers(row.licenceType, answers);

      const pack: FactPack = {
        licenceType: row.licenceType,
        answers,
        derived: this.deriveFacts(answers),
        // Only when there is genuinely an overlap. Passing a note otherwise
        // would have the document argue against a problem it does not have.
        overlapNote: overlap.writerNote ?? undefined,
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

      const previous = await this.recentFingerprints(
        row.licenceType,
        row.id,
        row.userId,
      );
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

      // Read once for BOTH terminal branches. A document that failed the gate
      // needs a retention date every bit as much as one that passed — its
      // uploads are the same identity documents.
      const retentionDays = await this.settings.get(
        FLAGS.motivationRetentionDays,
      );

      if (graded.verdict.passed) {
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
  private async annexureImages(
    uploads: {
      id: string;
      kind: MotivationUploadKind;
      storageKey: string | null;
      mimeType: string | null;
      purgedAt: Date | null;
    }[],
  ): Promise<{
    images: AnnexureImagePage[];
    notPrinted: { letter: string; label: string; why: string }[];
  }> {
    const letters = buildAnnexures(uploads.map((u) => u.kind));
    const letterFor = new Map(letters.map((a) => [a.kind, a.letter]));
    const labelFor = new Map(letters.map((a) => [a.kind, a.label]));
    // How many copies share each letter, so a caption can say "1 of 2".
    const totals = new Map<string, number>();
    for (const u of uploads) {
      totals.set(u.kind, (totals.get(u.kind) ?? 0) + 1);
    }
    const seen = new Map<string, number>();

    const images: AnnexureImagePage[] = [];
    const notPrinted: { letter: string; label: string; why: string }[] = [];

    for (const u of uploads) {
      const letter = letterFor.get(u.kind) ?? '?';
      const label = labelFor.get(u.kind) ?? u.kind;
      const index = (seen.get(u.kind) ?? 0) + 1;
      seen.set(u.kind, index);
      const total = totals.get(u.kind) ?? 1;

      if (!u.storageKey || u.purgedAt) {
        notPrinted.push({ letter, label, why: 'no longer stored' });
        continue;
      }
      if (!isEmbeddable(u.mimeType ?? '')) {
        notPrinted.push({
          letter,
          label,
          why: u.mimeType === 'application/pdf' ? 'a PDF' : 'not a JPG or PNG',
        });
        continue;
      }
      let bytes: Buffer;
      try {
        bytes = await this.files.read(u.storageKey);
      } catch {
        notPrinted.push({ letter, label, why: 'we could not read it back' });
        continue;
      }
      const size = imageSize(bytes);
      if (!size) {
        // Measuring is not optional: the alternative is guessing an aspect
        // ratio and printing somebody's licence stretched.
        notPrinted.push({ letter, label, why: 'we could not measure it' });
        continue;
      }
      images.push({ letter, label, index, total, bytes, ...size });
    }

    return { images, notPrinted };
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
    const printable = await this.annexureImages(row.uploads ?? []);

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
      annexures: buildAnnexures(kinds),
      annexureImages: printable.images,
      annexuresNotPrinted: printable.notPrinted,
      // The "take these to the police station" half of the checklist, and only
      // that half — the other half is the pack they are already holding.
      takeWithYou: buildChecklist(row.licenceType, kinds)
        .sections.find((sec) => sec.key === 'theirs')
        ?.items.map((i) => ({ label: i.label, note: i.note })),
    });
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
    const gaps = findGaps(licenceType, answers, {
      thinFields,
      overlapNeedsJustification,
    }).slice(0, FOLLOW_UP_BATCH);
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
