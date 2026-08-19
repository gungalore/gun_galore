import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CredentialKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SecureFileStorageService } from '../common/secure-file-storage.service';
import { FLAGS, SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { decryptJson, encryptJson } from '../common/blob-crypto';
import { LicenceCentreQuotaService } from './licence-centre-quota.service';
import { LicenceCentreExtractService } from './licence-centre-extract.service';
import { expiryState, parseIsoDate, toIsoDate } from './licence-dates';

// ────────────────────────────────────────────────────────────────────
// THE MEMBER'S OWN DOCUMENTS.
//
// Storage is free for everyone (pricing model C); the reminder AUTOMATION is
// what AO Pro buys. That is deliberate: the more documents are in here, the
// better every other part of this works, so charging to store them would be
// charging for the thing we most want to happen.
//
// ⚠️ NOTHING HERE STAMPS confirmedAt EXCEPT confirmExpiry. Extraction
// proposes; the member confirms; only then can a reminder fire. Every other
// write path must leave confirmedAt alone.
// ────────────────────────────────────────────────────────────────────

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_TITLE = 120;

@Injectable()
export class LicenceCentreService {
  private readonly logger = new Logger(LicenceCentreService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: SecureFileStorageService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly quota: LicenceCentreQuotaService,
    private readonly extract: LicenceCentreExtractService,
  ) {}

  /** @CurrentUser() gives the CLERK id; everything here keys on our own. */
  private async requireUser(clerkId: string): Promise<{ id: string }> {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private readDetails(encrypted: string | null): Record<string, string> {
    if (!encrypted) return {};
    try {
      return decryptJson<Record<string, string>>(encrypted);
    } catch (err) {
      // A document whose details will not decrypt is still a document: the
      // member can see it, download it and read the date off it themselves.
      this.logger.error(
        `Could not decrypt credential details: ${(err as Error).message}`,
      );
      return {};
    }
  }

  async list(clerkId: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    const now = new Date();

    const rows = await this.prisma.credential.findMany({
      where: { userId: user.id },
      orderBy: [{ expiresOn: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        kind: true,
        title: true,
        issuedOn: true,
        expiresOn: true,
        confirmedAt: true,
        remindersMuted: true,
        extractionOk: true,
        extractedFields: true,
        detailsEncrypted: true,
        storageKey: true,
        purgedAt: true,
        mimeType: true,
        byteSize: true,
        createdAt: true,
      },
    });

    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      issuedOn: r.issuedOn ? toIsoDate(r.issuedOn) : null,
      expiresOn: r.expiresOn ? toIsoDate(r.expiresOn) : null,
      confirmed: r.confirmedAt !== null,
      remindersMuted: r.remindersMuted,
      state: expiryState(r.expiresOn, r.confirmedAt, now),
      details: this.readDetails(r.detailsEncrypted),
      // The row can outlive its bytes after an erasure. Say so rather than
      // let a download fail with something puzzling.
      available: r.storageKey !== null && r.purgedAt === null,
      mimeType: r.mimeType,
      byteSize: r.byteSize,
      createdAt: r.createdAt,
    }));
  }

  async create(
    clerkId: string,
    kind: CredentialKind,
    title: string,
    file: { buffer: Buffer; mimetype: string },
  ) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);

    if (!file?.buffer?.length) {
      throw new BadRequestException('That file appears to be empty.');
    }
    if (file.buffer.length > MAX_UPLOAD_BYTES) {
      throw new BadRequestException('That file is larger than 10 MB.');
    }

    const cap = await this.settings.get(FLAGS.licenceCentreMaxCredentials);
    const held = await this.prisma.credential.count({
      where: { userId: user.id },
    });
    if (held >= cap) {
      throw new ConflictException(
        `You can keep ${cap} documents here. Remove one before adding another.`,
      );
    }

    // BYTES FIRST, ROW SECOND. The database's unique constraint is what spots
    // a duplicate — reading first and writing after is a race.
    let stored: { storageKey: string; sha256: string; byteSize: number };
    try {
      stored = await this.files.write('credentials', file.buffer, new Date());
    } catch (err) {
      // SecureFileStorageService throws plain Errors, an unconfigured
      // ID_HASH_SECRET among them. Unwrapped that is a 500 with a stack trace
      // instead of something a member can act on.
      this.logger.error(
        `Credential upload for ${user.id} could not be stored: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'We could not store that document just now. Please try again.',
      );
    }

    const clean = (title ?? '').trim().slice(0, MAX_TITLE);
    let created: { id: string };
    try {
      created = await this.prisma.credential.create({
        data: {
          userId: user.id,
          kind,
          title: clean || DEFAULT_TITLE[kind],
          storageKey: stored.storageKey,
          mimeType: file.mimetype,
          byteSize: stored.byteSize,
          sha256: stored.sha256,
        },
        select: { id: true },
      });
    } catch (err) {
      // The bytes must not outlive the attempt: a file with no row pointing at
      // it is undeletable except by hand.
      await this.files.remove(stored.storageKey).catch(() => undefined);
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'That exact file is already in your Licence Centre.',
        );
      }
      throw err;
    }

    // Reading the document runs AFTER the row is committed and outside the
    // compensating delete, so a vision outage costs a convenience rather than
    // the upload itself.
    const reading = await this.extract
      .read({ kind, bytes: file.buffer, mimeType: file.mimetype })
      .catch(() => null);

    if (reading) {
      await this.prisma.credential
        .update({
          where: { id: created.id },
          data: {
            issuedOn: parseIsoDate(reading.issuedOn),
            // ⚠️ PROPOSED, NOT CONFIRMED. expiresOn is written so the member
            // sees a filled-in date to check, and confirmedAt stays null, so
            // the reminder sweep cannot see this row until they say it is
            // right.
            expiresOn: parseIsoDate(reading.expiresOn),
            extractionOk:
              Boolean(reading.expiresOn) ||
              Object.keys(reading.details).length > 0,
            // Keys in the clear, values encrypted. The key names are not PII.
            extractedFields: Object.keys(reading.details),
            detailsEncrypted: Object.keys(reading.details).length
              ? encryptJson(reading.details)
              : null,
          },
        })
        .catch((err) =>
          this.logger.warn(
            `Could not stash reading for credential ${created.id}: ${(err as Error).message}`,
          ),
        );
    }

    return {
      id: created.id,
      proposed: {
        expiresOn: reading?.expiresOn ?? null,
        issuedOn: reading?.issuedOn ?? null,
        details: reading?.details ?? {},
        lowConfidence: reading?.lowConfidence ?? [],
      },
    };
  }

  /**
   * THE SAFETY RAIL.
   *
   * A date only starts driving reminders once the member has looked at it and
   * said it is right. Extraction can misread a smudged card, and a wrong date
   * that silently drives reminders is how somebody misses a real deadline
   * because of us — which is worse than sending nothing, because they stopped
   * checking themselves once we told them we were watching.
   */
  async confirmExpiry(
    clerkId: string,
    id: string,
    expiresOn: string,
    issuedOn?: string,
  ) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);

    const expiry = parseIsoDate(expiresOn);
    if (!expiry) {
      throw new BadRequestException(
        'That is not a date we can read. Enter it as yyyy-mm-dd, exactly as it is printed on the document.',
      );
    }

    // Re-confirming a NEW date has to clear the stages, or a renewed licence
    // never gets reminded about again — every column is already stamped from
    // the document it replaced.
    const before = await this.prisma.credential.findFirst({
      where: { id, userId: user.id },
      select: { id: true, expiresOn: true },
    });
    if (!before) throw new NotFoundException('Document not found');

    const dateChanged =
      before.expiresOn === null ||
      before.expiresOn.getTime() !== expiry.getTime();

    await this.prisma.credential.update({
      where: { id: before.id },
      data: {
        expiresOn: expiry,
        issuedOn: parseIsoDate(issuedOn ?? null),
        confirmedAt: new Date(),
        ...(dateChanged
          ? {
              remind180SentAt: null,
              remind120SentAt: null,
              remind100SentAt: null,
              remind30SentAt: null,
              remindD0SentAt: null,
            }
          : {}),
      },
    });

    // Clear the "confirm this" nudge and any expiry reminder standing against
    // the old date. A dismissible:false row can only be cleared this way.
    await this.notifications
      .resolveByEntity('credential', id, {
        userId: user.id,
        resolvedBy: 'user_action',
      })
      .catch(() => undefined);

    return { confirmed: true, expiresOn: toIsoDate(expiry) };
  }

  /** Their call. We remind; we never insist. */
  async mute(clerkId: string, id: string, muted: boolean) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);
    const claim = await this.prisma.credential.updateMany({
      where: { id, userId: user.id },
      data: { remindersMuted: muted },
    });
    if (claim.count === 0) throw new NotFoundException('Document not found');
    if (muted) {
      await this.notifications
        .resolveByEntity('credential', id, {
          userId: user.id,
          resolvedBy: 'user_action',
        })
        .catch(() => undefined);
    }
    return { muted };
  }

  async readFile(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);

    // Ownership is a WHERE CLAUSE, never a post-fetch check.
    const row = await this.prisma.credential.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        kind: true,
        mimeType: true,
        storageKey: true,
        purgedAt: true,
      },
    });
    if (!row) throw new NotFoundException('Document not found');
    if (!row.storageKey || row.purgedAt) {
      throw new GoneException('That document has been deleted.');
    }

    let bytes: Buffer;
    try {
      bytes = await this.files.read(row.storageKey);
    } catch (err) {
      this.logger.error(
        `Credential ${id}: could not read bytes: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException('We could not open that document.');
    }

    const ext = row.mimeType === 'application/pdf' ? 'pdf' : 'jpg';
    return {
      bytes,
      mimeType: row.mimeType,
      filename: `${row.kind.toLowerCase()}-${row.id.slice(-6)}.${ext}`,
    };
  }

  /** POPIA erasure of one document. Files first — a cascade cannot reach disk. */
  async remove(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.requireUser(clerkId);

    const row = await this.prisma.credential.findFirst({
      where: { id, userId: user.id },
      select: { id: true, storageKey: true },
    });
    if (!row) throw new NotFoundException('Document not found');

    if (row.storageKey) {
      try {
        await this.files.remove(row.storageKey);
      } catch (err) {
        // Deleting the row now would orphan the bytes with nothing left
        // pointing at them — invisible to every future sweep.
        this.logger.error(
          `Credential ${id}: could not remove bytes: ${(err as Error).message}`,
        );
        throw new ServiceUnavailableException(
          'We could not delete that document just now. Please try again.',
        );
      }
    }

    await this.prisma.credential.delete({ where: { id: row.id } });
    await this.notifications
      .resolveByEntity('credential', id, { userId: user.id })
      .catch(() => undefined);
    return { removed: true };
  }

  /** Counts and health only — never a blob, never a decrypted detail. */
  async adminHealth() {
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const [byKind, total, unconfirmed, expiring30, expired, muted] =
      await Promise.all([
        this.prisma.credential.groupBy({
          by: ['kind'],
          _count: { _all: true },
        }),
        this.prisma.credential.count(),
        this.prisma.credential.count({ where: { confirmedAt: null } }),
        this.prisma.credential.count({
          where: {
            confirmedAt: { not: null },
            expiresOn: { gt: now, lte: in30 },
          },
        }),
        this.prisma.credential.count({
          where: { confirmedAt: { not: null }, expiresOn: { lt: now } },
        }),
        this.prisma.credential.count({ where: { remindersMuted: true } }),
      ]);
    return {
      total,
      byKind: byKind.map((r) => ({ kind: r.kind, count: r._count._all })),
      // The number worth watching: documents nobody has confirmed are
      // documents no reminder will ever fire for.
      unconfirmed,
      expiring30,
      expired,
      muted,
    };
  }
}

const DEFAULT_TITLE: Record<CredentialKind, string> = {
  FIREARM_LICENCE: 'Firearm licence',
  COMPETENCY_CERTIFICATE: 'Competency certificate',
  DEDICATED_STATUS: 'Dedicated status',
  PROFICIENCY: 'Proficiency certificate',
  OTHER: 'Supporting document',
};
