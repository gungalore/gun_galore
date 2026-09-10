import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { decryptJson, encryptJson } from '../common/blob-crypto';
import type { ExtractedField } from './motivation-extract.service';

// ────────────────────────────────────────────────────────────────────
// A DOCUMENT WE HAVE ALREADY PAID TO READ.
//
// Operator, 2026-09-10: "every thing we generate that can be reused we store in
// a database as much of it that could be reusable so it costs money and effort
// one time and never again."
//
// ⚠️ THE LEDGER IS WHY THIS EXISTS, AND IT NAMED THE NUMBER. `AiUsage` carried
// exactly ten `motivation.extract.current_licence` calls and four
// `proficiency_certificate` calls, repeated SIX TIMES across three days —
// 60 calls where 10 would have done — because every pick of a vault document
// into a pack re-reads the bytes from scratch. Not re-scans: the same stored
// files, hours apart, in identical batches.
//
// ⚠️ AND RE-READING IS A DECISION, SO THIS CACHES THE READER RATHER THAN
// REPLACING IT. Carrying values across from the vault BY NAME had already
// produced four bugs — the vault and the motivation registry name the same
// values differently, and the extractor emits registry keys by construction
// and owns the owned-firearm slot logic. See the note in
// motivation-documents.service.ts. Nothing here reintroduces a mapping; it
// only declines to pay twice for a deterministic read of identical bytes.
//
// ⚠️ FAIL-SOFT IN BOTH DIRECTIONS. A cache that cannot be read must cost a
// model call, never a document; a cache that cannot be written must cost
// nothing at all. Every path here swallows its own errors, because the thing
// it is protecting is somebody's licence application.
// ────────────────────────────────────────────────────────────────────

/**
 * Bump when the reader's OUTPUT could change for bytes it has already seen.
 *
 * ⚠️ THIS IS THE MISTAKE NEXT DOOR, NOT REPEATED. `MotivationResearch` keys on
 * the SUBJECT and not on the question it asked, so rewording that brief is
 * inert until the row expires 180 days later — a fix that ships and does
 * nothing for half a year. A change to the system prompt, to how a value is
 * normalised, or to `parse()` belongs here, and it invalidates the same day.
 *
 * Field-list changes need no bump: the asked keys are already in the key.
 */
export const READER_VERSION = '2026-09-10';

/** Thirty days. See the schema note — this holds identity data, not trivia. */
const TTL_DAYS = 30;

@Injectable()
export class DocumentReadCacheService {
  private readonly logger = new Logger(DocumentReadCacheService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The key for one reading of one document.
   *
   * ⚠️ EVERYTHING THAT CHANGES THE ANSWER IS IN IT. The bytes, obviously; the
   * kind and the licence type, because those decide which registry fields are
   * asked for; the asked keys themselves, so adding a field to EXTRACTABLE
   * cannot serve a cached read that never looked for it; and the reader's own
   * version.
   *
   * ⚠️ THE SLOT IS DELIBERATELY *NOT* IN IT. A licence read into
   * existing_firearm_3_* is the same reading of the same card as one read into
   * row 1. The caller normalises to row 1 before storing and remaps on the way
   * out, so one cached read serves every slot rather than one row per slot —
   * which on a ten-firearm applicant is the difference between one call and
   * ten.
   */
  key(args: {
    fileSha256: string;
    kind: string;
    licenceType: string;
    askedKeys: readonly string[];
  }): string {
    return createHash('sha256')
      .update(
        [
          args.fileSha256,
          args.kind,
          args.licenceType,
          READER_VERSION,
          [...args.askedKeys].sort().join(','),
        ].join('|'),
      )
      .digest('hex');
  }

  /** A previous reading of these exact bytes, or null. */
  async get(cacheKey: string): Promise<ExtractedField[] | null> {
    try {
      const row = await this.prisma.documentReadCache.findUnique({
        where: { cacheKey },
        select: { payloadEncrypted: true, expiresAt: true },
      });
      if (!row || row.expiresAt.getTime() <= Date.now()) return null;
      const fields = decryptJson<ExtractedField[]>(row.payloadEncrypted);
      // ⚠️ AN EMPTY READ IS NOT A HIT. The extractor returns [] both for "this
      // photograph says nothing we asked for" and for a model timeout, and the
      // second must not be cached as the first — a marginal document would be
      // permanently unreadable for thirty days on the strength of one outage.
      return Array.isArray(fields) && fields.length ? fields : null;
    } catch (err) {
      this.logger.warn(
        `Read cache lookup failed, reading the document instead: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Remember a reading.
   *
   * ⚠️ NOTHING IS STORED FOR AN EMPTY RESULT, for the reason above: we cannot
   * tell a blank document from a failed call here, and one of those two must
   * not be remembered.
   */
  async put(args: {
    cacheKey: string;
    fileSha256: string;
    fields: readonly ExtractedField[];
  }): Promise<void> {
    if (!args.fields.length) return;
    const expiresAt = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000);
    try {
      await this.prisma.documentReadCache.upsert({
        where: { cacheKey: args.cacheKey },
        create: {
          cacheKey: args.cacheKey,
          fileSha256: args.fileSha256,
          payloadEncrypted: encryptJson(args.fields),
          expiresAt,
        },
        update: {
          payloadEncrypted: encryptJson(args.fields),
          readAt: new Date(),
          expiresAt,
        },
      });
    } catch (err) {
      // A cache that cannot be written costs nothing. The read already
      // happened and the caller already has its answer.
      this.logger.warn(
        `Read cache write failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Forget everything read off these bytes.
   *
   * ⚠️ CALLED WHEN A DOCUMENT IS DELETED, and that is a privacy obligation
   * rather than housekeeping. A member who removes a licence card from the
   * vault has removed it; a cached transcription of its serial numbers
   * outliving it by thirty days would make the delete a lie.
   */
  async forget(fileSha256: string): Promise<number> {
    try {
      const { count } = await this.prisma.documentReadCache.deleteMany({
        where: { fileSha256 },
      });
      return count;
    } catch (err) {
      this.logger.warn(
        `Read cache purge failed for one document: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  /** Drop what has expired. Called by the retention sweep. */
  async purgeExpired(): Promise<number> {
    try {
      const { count } = await this.prisma.documentReadCache.deleteMany({
        where: { expiresAt: { lte: new Date() } },
      });
      return count;
    } catch (err) {
      this.logger.warn(
        `Read cache expiry sweep failed: ${(err as Error).message}`,
      );
      return 0;
    }
  }
}
