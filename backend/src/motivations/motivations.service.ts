import {
  BadRequestException,
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
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReferenceNumberService } from '../common/reference-number.service';
import { SecureFileStorageService } from '../common/secure-file-storage.service';
import {
  encryptJson,
  encryptText,
  tryDecryptText,
} from '../common/blob-crypto';
import {
  automaticCount,
  automaticSources,
  changedKeys,
  markMember,
  parseProvenance,
} from '../common/answer-provenance';
import { MotivationQuotaService } from './motivation-quota.service';
import { asLayout } from './motivation-pdf-layouts';
import { applicationBlockers } from './motivation-eligibility';
import { credentialOffer } from './motivation-credentials';
import { asScheme, asFormat } from './motivation-pdf.service';
import { SettingsService, FLAGS } from '../settings/settings.service';
import { buildChecklist } from './motivation-checklist';
import { saps271Coverage } from './saps271-coverage';
import {
  FIELD_REGISTRY_VERSION,
  LICENCE_TYPE_LABELS,
  fieldByKey,
  fieldsFor,
  missingRequired,
  sanitiseAnswers,
} from './motivation-fields';
import { overlapFromAnswers } from './motivation-overlap';
import { profileOffer } from './motivation-profile';
import {
  EDITABLE,
  MotivationSharedService,
  isPaidFor,
} from './motivation-shared.service';
import { MotivationPrefillService } from './motivation-prefill.service';
import { MotivationDocumentsService } from './motivation-documents.service';
import { MotivationGenerationService } from './motivation-generation.service';
import { MotivationRenderService } from './motivation-render.service';
import { MotivationWitnessesService } from './motivation-witnesses-flow.service';

// Re-exported so every existing importer keeps working: both moved to
// motivation-shared.service.ts when this file was split, and nothing about
// what either of them computes changed.
export { estimateCostUsd, isPaidFor } from './motivation-shared.service';

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

// ────────────────────────────────────────────────────────────────────
// ⚠️ THIS IS THE FACADE. Five services were split out of this file —
// prefill, documents, generation, render and witnesses — and every public
// method they took is still declared here, delegating. Controllers, the
// Licence Centre and the specs all call MotivationsService; moving a route
// onto a sub-service is a separate decision from splitting the file, and
// doing both at once would have made the diff unreviewable.
//
// ⚠️ A SUB-SERVICE MUST NEVER INJECT THIS. Anything two of them need lives
// in MotivationSharedService instead — injecting the facade back would be a
// cycle Nest only reports at boot.
// ────────────────────────────────────────────────────────────────────

@Injectable()
export class MotivationsService {
  private readonly logger = new Logger(MotivationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: MotivationQuotaService,
    private readonly refs: ReferenceNumberService,
    private readonly files: SecureFileStorageService,
    private readonly settings: SettingsService,
    private readonly shared: MotivationSharedService,
    private readonly prefill: MotivationPrefillService,
    private readonly documents: MotivationDocumentsService,
    private readonly generation: MotivationGenerationService,
    private readonly render: MotivationRenderService,
    private readonly witnesses: MotivationWitnessesService,
  ) {}

  /** Own list. Metadata only — nothing is decrypted here. */
  async listMine(clerkId: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(clerkId);
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
    const user = await this.shared.requireUser(clerkId);

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
      await this.prefill.profileFor(user.id),
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
    // ⚠️ AND SO DOES WHAT WE ALREADY READ, LAST TIME. Operator, 2026-08-29:
    // "Nothing that is scanned and OCR'd is ever discarded. We will use the
    // information to fill out forms an future applications."
    //
    // Third source, and it slots BETWEEN profile and vault. A reading beats a
    // profile field the member may have typed years ago and never revisited;
    // it loses to the vault, whose documents have been curated in the Centre
    // and carry a confirmed date. Same fail-soft rule as the vault below: a
    // member who cannot reach their history must still be able to start.
    let priorValues: Record<string, string> = {};
    let priorFrom: Record<string, MotivationUploadKind> = {};
    try {
      const prior = await this.prefill.priorReadingsFor(user.id);
      priorValues = prior.values;
      priorFrom = prior.from;
    } catch (err) {
      this.logger.warn(
        `Motivation create: prior-reading prefill skipped — ${(err as Error).message}`,
      );
    }

    // ── and what they told us on the LAST application ─────────────
    //
    // H12. Fourth source, and it sits with the readings, between profile and
    // vault. A member's second application asked the same thirty-odd
    // criminal-history questions as their first and the same four about the
    // safe they had already described, and offered nothing for any of them.
    //
    // ⚠️ BELOW THE VAULT, DELIBERATELY, and it matters for exactly one key:
    // `safe_storage_detail`. A vault reading describes the safe we can see in
    // the photograph; last year's answer describes the safe they had last year.
    // Where those disagree the document wins, which is the same precedence
    // every other source in this list already obeys.
    //
    // Same fail-soft rule as the other three: a member whose history cannot be
    // read must still be able to start.
    let priorAnswerValues: Record<string, string> = {};
    let priorAnswerKeys: string[] = [];
    try {
      const answered = await this.prefill.priorAnswersFor(user.id);
      priorAnswerValues = answered.values;
      priorAnswerKeys = answered.keys;
    } catch (err) {
      this.logger.warn(
        `Motivation create: prior-answer prefill skipped — ${(err as Error).message}`,
      );
    }

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
        await this.prefill.credentialsFor(user.id, { includeUnconfirmed: true }),
        // credentialOffer skips what is already answered, so it must see the
        // prior readings too — otherwise it re-offers a field they just
        // filled and the spread below silently prefers the vault's copy.
        { ...prefill.values, ...priorValues, ...priorAnswerValues, ...seed },
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
      // Profile, then what we read last time, then what they ANSWERED last
      // time, then the vault, then the seed. See the note above priorValues for
      // why a reading sits here, and the one above priorAnswerValues for why an
      // answer sits below a document.
      ...priorValues,
      ...priorAnswerValues,
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
    const provenance = this.prefill.stampOffers(
      {},
      seeded,
      prefill.from,
      vaultItems,
      // The renewal path seeds from the licence being renewed. We know it came
      // out of the Licence Centre; we do not get told which credential, so the
      // entry carries a source and no id. Better than no entry at all, which
      // would understate the count for the flow that starts best-informed.
      seed,
      priorFrom,
      priorAnswerKeys,
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
    const user = await this.shared.requireUser(clerkId);

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
            // The same three the documents step gets — see expiryFor. The
            // wizard's own summary renders these rows too, and a row that
            // warns on one screen and not on the other is worse than one that
            // never warned at all.
            extractionEncrypted: true,
            sourceCredential: { select: { expiresOn: true } },
            sourceRemovedAt: true,
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

    const answers = this.shared.readAnswers(row.answersEncrypted);
    // One clock for every row, so two documents dated the same day cannot land
    // on opposite sides of ninety days.
    const uploadsNow = new Date();

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
      // ⚠️ REMAPPED, NOT PASSED THROUGH, and the two things being dropped are
      // the reason: `extractionEncrypted` is the decrypted-at-rest reading of
      // an identity document, and it has no business on the wire. expiryFor
      // turns it into the one fact the client needs.
      uploads: row.uploads.map((u) => {
        const { extractionEncrypted: _blob, sourceCredential: _src, ...rest } = u;
        return { ...rest, ...this.shared.expiryFor(u, uploadsNow) };
      }),
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
    const user = await this.shared.requireUser(clerkId);

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
    const before = this.shared.readAnswers(row.answersEncrypted);
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
    const user = await this.shared.requireUser(clerkId);
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
    const user = await this.shared.requireUser(clerkId);

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

  /** @see MotivationDocumentsService.library */
  library(clerkId: string, id: string) {
    return this.documents.library(clerkId, id);
  }

  /** @see MotivationDocumentsService.autolink */
  autolink(clerkId: string, id: string, placeConfirmed = false) {
    return this.documents.autolink(clerkId, id, placeConfirmed);
  }

  /** @see MotivationDocumentsService.rearmAutolinkFor */
  rearmAutolinkFor(userId: string): Promise<number> {
    return this.documents.rearmAutolinkFor(userId);
  }

  /** @see MotivationDocumentsService.addFromLibrary */
  addFromLibrary(
    clerkId: string,
    id: string,
    source: 'credential' | 'upload',
    sourceId: string,
    placeConfirmed = false,
  ) {
    return this.documents.addFromLibrary(
      clerkId,
      id,
      source,
      sourceId,
      placeConfirmed,
    );
  }

  /** @see MotivationDocumentsService.readingFor */
  readingFor(clerkId: string, id: string, uploadId: string) {
    return this.documents.readingFor(clerkId, id, uploadId);
  }

  /** @see MotivationDocumentsService.rereadUpload */
  rereadUpload(clerkId: string, id: string, uploadId: string) {
    return this.documents.rereadUpload(clerkId, id, uploadId);
  }

  /** @see MotivationPrefillService.licenceCentreOffer */
  licenceCentreOffer(clerkId: string, id: string) {
    return this.prefill.licenceCentreOffer(clerkId, id);
  }

  /** @see MotivationPrefillService.useLicenceCentre */
  useLicenceCentre(clerkId: string, id: string) {
    return this.prefill.useLicenceCentre(clerkId, id);
  }

  /** @see MotivationPrefillService.profilePrefillOffer */
  profilePrefillOffer(clerkId: string, id: string) {
    return this.prefill.profilePrefillOffer(clerkId, id);
  }

  /** @see MotivationPrefillService.useProfile */
  useProfile(clerkId: string, id: string) {
    return this.prefill.useProfile(clerkId, id);
  }

  /** @see MotivationDocumentsService.addUpload */
  addUpload(
    clerkId: string,
    id: string,
    kind: MotivationUploadKind | null,
    file: { buffer: Buffer; mimetype: string },
    opts: { skipExtraction?: boolean } = {},
  ) {
    return this.documents.addUpload(clerkId, id, kind, file, opts);
  }

  /** @see MotivationDocumentsService.applyExtraction */
  applyExtraction(
    clerkId: string,
    id: string,
    accepted: Record<string, unknown>,
  ) {
    return this.documents.applyExtraction(clerkId, id, accepted);
  }

  /** @see MotivationDocumentsService.listUploads */
  listUploads(clerkId: string, id: string) {
    return this.documents.listUploads(clerkId, id);
  }

  /** @see MotivationDocumentsService.readUpload */
  readUpload(clerkId: string, id: string, uploadId: string) {
    return this.documents.readUpload(clerkId, id, uploadId);
  }

  /** @see MotivationDocumentsService.removeUpload */
  removeUpload(clerkId: string, id: string, uploadId: string) {
    return this.documents.removeUpload(clerkId, id, uploadId);
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
    const user = await this.shared.requireUser(clerkId);
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
    const user = await this.shared.requireUser(clerkId);

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

    const answers = this.shared.readAnswers(row.answersEncrypted);
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
    const user = await this.shared.requireUser(clerkId);
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

  /** @see MotivationGenerationService.generate */
  generate(clerkId: string, id: string) {
    return this.generation.generate(clerkId, id);
  }

  /** @see MotivationGenerationService.startGeneration */
  startGeneration(clerkId: string, id: string) {
    return this.generation.startGeneration(clerkId, id);
  }

  /** @see MotivationGenerationService.sweepStuckGenerations */
  sweepStuckGenerations() {
    return this.generation.sweepStuckGenerations();
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
    const user = await this.shared.requireUser(clerkId);
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
    const user = await this.shared.requireUser(clerkId);

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
    const user = await this.shared.requireUser(clerkId);

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

  /** @see MotivationRenderService.renderPdf */
  renderPdf(clerkId: string, id: string) {
    return this.render.renderPdf(clerkId, id);
  }

  /** @see MotivationWitnessesService.listWitnesses */
  listWitnesses(clerkId: string, id: string) {
    return this.witnesses.listWitnesses(clerkId, id);
  }

  /** @see MotivationWitnessesService.inviteWitness */
  inviteWitness(
    clerkId: string,
    id: string,
    args: { slot: number; name: string; phone: string },
  ) {
    return this.witnesses.inviteWitness(clerkId, id, args);
  }

  /** @see MotivationWitnessesService.removeWitness */
  removeWitness(clerkId: string, id: string, witnessId: string) {
    return this.witnesses.removeWitness(clerkId, id, witnessId);
  }

  /** @see MotivationWitnessesService.witnessSignature */
  witnessSignature(clerkId: string, id: string, witnessId: string) {
    return this.witnesses.witnessSignature(clerkId, id, witnessId);
  }

  /** @see MotivationRenderService.coverPhoto */
  coverPhoto(clerkId: string, id: string) {
    return this.render.coverPhoto(clerkId, id);
  }

  /** @see MotivationRenderService.coverPhotoBytes */
  coverPhotoBytes(
    clerkId: string,
    id: string,
  ): Promise<{ bytes: Buffer; mimeType: string } | null> {
    return this.render.coverPhotoBytes(clerkId, id);
  }

  /** @see MotivationRenderService.setCoverPhotoChoice */
  setCoverPhotoChoice(clerkId: string, id: string, choice: string) {
    return this.render.setCoverPhotoChoice(clerkId, id, choice);
  }

  /** @see MotivationRenderService.uploadCoverPhoto */
  uploadCoverPhoto(
    clerkId: string,
    id: string,
    file: { buffer: Buffer; mimetype: string },
  ) {
    return this.render.uploadCoverPhoto(clerkId, id, file);
  }

  /** @see MotivationRenderService.removeCoverPhoto */
  removeCoverPhoto(clerkId: string, id: string) {
    return this.render.removeCoverPhoto(clerkId, id);
  }

  /** @see MotivationRenderService.renderSaps271 */
  renderSaps271(clerkId: string, id: string) {
    return this.render.renderSaps271(clerkId, id);
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
    const user = await this.shared.requireUser(clerkId);

    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        licenceType: true,
        status: true,
        answersEncrypted: true,
        uploads: { select: { kind: true } },
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    // The answers ride along because one renewal row depends on them: the
    // SAPS 517(g) reminder shows only when the licence being renewed is the
    // last one holding the member's competency up (motivation-checklist.ts,
    // s24Bring). Without them the row was built, tested, and never shown.
    return buildChecklist(
      row.licenceType,
      (row.uploads ?? []).map((u) => u.kind),
      row.status === MotivationStatus.COMPLETED,
      {
        waitingOn: this.waitingOn(await this.sellerState(row.id)),
        answers: this.shared.readAnswers(row.answersEncrypted),
      },
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
    const user = await this.shared.requireUser(clerkId);

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

    const answers = this.shared.readAnswers(row.answersEncrypted);
    const provenance = parseProvenance(row.answerProvenance);
    const seller = await this.sellerState(row.id);
    // The wizard's competency step renders this; the document checklist
    // renders the same value off /uploads. Same method, so they cannot drift.
    const proficiency = await this.shared.proficiencyFor(user.id);

    return {
      id: row.id,
      proficiency,
      referenceNumber: row.referenceNumber,
      licenceType: row.licenceType,
      status: row.status,
      checklist: buildChecklist(
        row.licenceType,
        (row.uploads ?? []).map((u) => u.kind),
        row.status === MotivationStatus.COMPLETED,
        { waitingOn: this.waitingOn(seller), answers },
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

  /** @see MotivationDocumentsService.changeUploadKind */
  changeUploadKind(
    clerkId: string,
    id: string,
    uploadId: string,
    kind: MotivationUploadKind,
  ) {
    return this.documents.changeUploadKind(clerkId, id, uploadId, kind);
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
    // ⚠️ COMPLETED HAD NO BRANCH AT ALL, so the one outcome the applicant is
    // hoping for fell through to the generic "we hold this" copy — a row that
    // looked no different from one nobody had answered. The seller had signed;
    // the screen would not say so.
    //
    // Not phrased as waiting, because nothing is: it is the only entry here
    // that reports a thing finished rather than a thing outstanding.
    if (seller.status === 'COMPLETED') {
      out.upload_firearm_source_proof = `${who} has completed and signed his half. Nothing more for you to do here.`;
    }
    if (seller.status === 'DECLINED') {
      // ⚠️ NOT "WAITING", AND DELIBERATELY NOT SILENT EITHER. A declined
      // seller is a dead end for that route and the applicant has to be told
      // so, with the other route named — otherwise the row sits amber for
      // ever and looks like a system that has forgotten about them.
      out.upload_firearm_source_proof = `${seller.name || 'The seller'} declined. Upload a certified copy of his licence yourself instead.`;
    }

    // ⚠️ NO WITNESS ENTRY HERE, AND IT IS NOW SETTLED RATHER THAN PENDING.
    //
    // This note used to read as a finding awaiting a decision: the witness
    // engine is built, and invited-but-unsigned is exactly what
    // 'waiting-on-someone' exists for — but CHARACTER_REFERENCE was in no
    // licence type's RECOMMENDED list, so a sentence keyed to
    // `upload_character_reference` would attach to nothing.
    //
    // Operator, 2026-08-29: "lets take out the character reference out of the
    // motivations. It serves no purpose. Only time someone needs these is for
    // the application for a competency." So there is no row because there is
    // no requirement, and there will not be one. A reference speaks to
    // whether a person is FIT to hold a firearm — the section 9 enquiry — not
    // to why this firearm is needed for this purpose.
    //
    // Making it a row changes oursTotal for every licence type and moves the
    // progress ring an existing screen already renders, which is a product
    // decision and not a refactor. The guard test below is what stops this
    // being written again by mistake.

    return out;
  }
}
