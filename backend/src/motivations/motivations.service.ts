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
import { encryptJson, decryptJson, tryDecryptText } from '../common/blob-crypto';
import { MotivationQuotaService } from './motivation-quota.service';
import {
  FIELD_REGISTRY_VERSION,
  LICENCE_TYPE_LABELS,
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
