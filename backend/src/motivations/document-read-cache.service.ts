import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { decryptJson, encryptJson } from '../common/blob-crypto';
import type { ExtractedField } from './motivation-extract.service';
import { CONTAINER_VERSION } from './evidence-taxonomy';

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

  /**
   * Forget everything read off any of these documents.
   *
   * ⚠️ THE RETENTION SWEEP'S DOOR, AND THE REASON `forget` ALONE WAS NOT
   * ENOUGH. `forget` is called from the per-upload delete, which knows one
   * sha256 because it just deleted that one row. The retention sweep nulls a
   * BATCH of rows at once and had no sha256 to hand it: it removed the bytes
   * and stamped purgedAt, and the transcript of everything printed on the page
   * — the holder's name, identity number and every serial — outlived the
   * photograph by its thirty-day TTL. Erasure has the same shape: the rows go
   * in a cascade and the readings survived.
   *
   * One statement for the whole set, so a batch of two hundred is one round
   * trip rather than two hundred.
   */
  async forgetMany(fileSha256s: readonly string[]): Promise<number> {
    const sha = fileSha256s.filter(Boolean);
    if (!sha.length) return 0;
    try {
      const { count } = await this.prisma.documentReadCache.deleteMany({
        where: { fileSha256: { in: sha as string[] } },
      });
      return count;
    } catch (err) {
      this.logger.warn(
        `Read cache purge failed for ${sha.length} document(s): ${(err as Error).message}`,
      );
      return 0;
    }
  }

  /**
   * The key for one EVIDENCE CLASSIFICATION of one file.
   *
   * ⚠️ A PARALLEL PATH, NOT A WIDENING OF `key()`. The document key carries a
   * `kind` and a `licenceType` because those decide the field list; an evidence
   * classification asks a different question (which container), is answered by
   * a different prompt, and stores a different shape. Folding it into the same
   * method would put two payload shapes behind one `get()` that returns
   * `ExtractedField[]`.
   *
   * ⚠️ THE DESCRIPTION IS IN THE KEY, HASHED. The same photograph described as
   * "me and my son on a hunt" and as "my reloading bench" may rightly sort
   * differently, so a cached answer is only valid for the description that
   * produced it — remember no answer, only the answer TO THESE WORDS. It is
   * hashed rather than stored raw so the cache key is not itself POPIA data
   * sitting in a column the retention sweep does not know about.
   *
   * ⚠️ CONTAINER_VERSION, NOT READER_VERSION. The answer space is the
   * taxonomy; revising the containers must invalidate every cached container
   * the same day, exactly as READER_VERSION does for a field read.
   */
  evidenceKey(args: { fileSha256: string; description: string | null }): string {
    const described = createHash('sha256')
      .update(args.description ?? '')
      .digest('hex');
    return createHash('sha256')
      .update(
        [args.fileSha256, 'evidence', CONTAINER_VERSION, described].join('|'),
      )
      .digest('hex');
  }

  /** A previous evidence classification of these exact bytes, or null. */
  async getEvidence(
    cacheKey: string,
  ): Promise<{ container: string; confident: boolean } | null> {
    try {
      const row = await this.prisma.documentReadCache.findUnique({
        where: { cacheKey },
        select: { payloadEncrypted: true, expiresAt: true },
      });
      if (!row || row.expiresAt.getTime() <= Date.now()) return null;
      const payload = decryptJson<{ container?: unknown; confident?: unknown }>(
        row.payloadEncrypted,
      );
      // ⚠️ A CONTAINERLESS ROW IS NOT A HIT, for the reason get() gives for an
      // empty read: `null` container is what a low-confidence answer stores,
      // and that answer is context-specific (see the caller). A cached miss
      // would pin a file to "we could not decide" for thirty days.
      if (typeof payload?.container !== 'string' || !payload.container) {
        return null;
      }
      return {
        container: payload.container,
        confident: payload.confident === true,
      };
    } catch (err) {
      this.logger.warn(
        `Evidence cache lookup failed, classifying instead: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Remember an evidence classification.
   *
   * ⚠️ ONLY A CONFIDENT ANSWER IS STORED. A low-confidence one is a judgement
   * about THIS description, and the whole point of the retry loop is that a
   * better description gets a better answer. Caching the miss would answer the
   * retry with the miss.
   */
  async putEvidence(args: {
    cacheKey: string;
    fileSha256: string;
    container: string;
  }): Promise<void> {
    if (!args.container) return;
    const expiresAt = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000);
    try {
      await this.prisma.documentReadCache.upsert({
        where: { cacheKey: args.cacheKey },
        create: {
          cacheKey: args.cacheKey,
          fileSha256: args.fileSha256,
          payloadEncrypted: encryptJson({
            container: args.container,
            confident: true,
          }),
          expiresAt,
        },
        update: {
          payloadEncrypted: encryptJson({
            container: args.container,
            confident: true,
          }),
          readAt: new Date(),
          expiresAt,
        },
      });
    } catch (err) {
      this.logger.warn(`Evidence cache write failed: ${(err as Error).message}`);
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
