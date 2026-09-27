import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { decryptJson, encryptJson } from './blob-crypto';

// ────────────────────────────────────────────────────────────────────
// THE IDENTIFY PASS'S MEMORY, BETWEEN THE PICKER AND THE POLISH.
//
// ⚠️ THE SERVER SORTS THE BATCH AND REMEMBERS ITS OWN VERDICT; THE CLIENT
// ONLY CARRIES THE ID BACK. The member picks files, the server mints an id
// per file and sends them to a model, and the verdict — document or evidence,
// which kind, which container, and the OCR text it read — is held HERE under
// the id the server issued. The client polishes and uploads, and the store
// handler files the row from this record rather than from anything the
// request asserts. A verdict the client could type is a verdict the client
// could forge.
//
// ⚠️ SHORT-LIVED, BECAUSE ocrText IS POPIA DATA. It is the full text of a
// licence or an identity document. expiresAt is set at identify time and the
// sweep clears the ciphertext before deleting the row.
//
// ⚠️ THE MARRIAGE IS BY id, NEVER BY HASH. Identify reads the UNPOLISHED
// bytes; the polished file stored later has a different hash and will not
// match — and that is correct, because they are two different images. Only
// the id the server issued ties them together.
// ────────────────────────────────────────────────────────────────────

/**
 * How long the member has to polish and upload a batch.
 *
 * Long enough to walk a ten-file batch through the scanner treatment and the
 * confirm screen; short enough that an abandoned batch of identity documents
 * does not linger. Well inside DocumentReadCache's 30 days.
 */
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How many files one identify batch may carry.
 *
 * ⚠️ ONE NUMBER FOR BOTH CALLERS. The vault's identify pass and the
 * motivation wizard's are the same batch from the same picker, and each file
 * costs a model call. Two copies of this ceiling would drift, and the one that
 * drifted high would be the one that let a single request spend unbounded
 * money. It lives here because both modules already depend on this service.
 */
export const MAX_IDENTIFY_FILES = 20;

/** How many characters of the member's own description reach the model. */
export const MAX_IDENTIFY_DESCRIPTION = 500;

/** The verdict the server reached for one identified file. */
export interface IdentifyRecord {
  id: string;
  ownerId: string;
  sha256: string;
  role: 'document' | 'evidence';
  /** The document kind, or null for evidence — an evidence item has no kind. */
  kind: string | null;
  /**
   * Other roles this same document fills, read off the same classifier answer.
   *
   * ⚠️ PART OF THE VERDICT, SO IT LIVES IN THE RECORD. The store handler takes
   * the classifier's answer from HERE, never from the request — and
   * `coversKinds` is written from it. Empty for evidence.
   */
  alsoCovers: string[];
  /** An evidence container id, or null when the classifier was unsure. */
  container: string | null;
  confident: boolean;
  /** The full text read off the page, decrypted. POPIA data. */
  ocrText: string | null;
}

@Injectable()
export class DocumentIdentifyService {
  private readonly logger = new Logger(DocumentIdentifyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Remember one file's verdict under the id the server minted for it.
   *
   * ⚠️ THE ID IS CHOSEN BY THE CALLER, NOT HERE. The caller already has the
   * bytes (and their sha256) in hand when it mints the id, and one shared
   * transaction issues N ids and writes N rows — so the service takes the id
   * rather than generating one and handing it back.
   */
  async put(record: IdentifyRecord): Promise<void> {
    try {
      await this.prisma.documentIdentify.create({
        data: {
          id: record.id,
          ownerId: record.ownerId,
          sha256: record.sha256,
          role: record.role,
          kind: record.kind,
          alsoCovers: record.alsoCovers,
          container: record.container,
          confident: record.confident,
          ocrTextEncrypted: record.ocrText
            ? encryptJson({ text: record.ocrText })
            : null,
          ocrChars: record.ocrText === null ? null : record.ocrText.length,
          expiresAt: new Date(Date.now() + TTL_MS),
        },
      });
    } catch (err) {
      // ⚠️ FAIL-SOFT, BUT DO NOT SWALLOW THE CONSEQUENCE. A member whose
      // verdict could not be remembered still gets the verdict in the
      // response; the store handler falls back to classifying the bytes it
      // receives, so nothing is blocked.
      this.logger.warn(
        `Could not remember identify verdict ${record.id}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * The verdict for an id, OWNER-CHECKED, or null.
   *
   * ⚠️ null FOR ANOTHER MEMBER'S ID AS WELL AS AN UNKNOWN ONE. A distinct
   * "not yours" answer would confirm the id exists.
   */
  async get(args: {
    id: string;
    ownerId: string;
  }): Promise<IdentifyRecord | null> {
    try {
      const row = await this.prisma.documentIdentify.findFirst({
        where: {
          id: args.id,
          ownerId: args.ownerId,
          expiresAt: { gt: new Date() },
        },
        select: {
          id: true,
          ownerId: true,
          sha256: true,
          role: true,
          kind: true,
          alsoCovers: true,
          container: true,
          confident: true,
          ocrTextEncrypted: true,
        },
      });
      if (!row) return null;
      return {
        id: row.id,
        ownerId: row.ownerId,
        sha256: row.sha256,
        role: row.role === 'evidence' ? 'evidence' : 'document',
        kind: row.kind,
        alsoCovers: row.alsoCovers,
        container: row.container,
        confident: row.confident,
        ocrText: row.ocrTextEncrypted
          ? (decryptJson<{ text?: string }>(row.ocrTextEncrypted)?.text ?? null)
          : null,
      };
    } catch (err) {
      this.logger.warn(
        `Identify lookup failed for ${args.id}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * A verdict already reached for these exact bytes by this member, or null.
   *
   * ⚠️ THIS IS THE IDENTIFY CACHE, AND IT LIVES HERE RATHER THAN IN
   * DocumentReadCache. That table stores extracted FIELDS under a
   * reader-version key; a document-or-evidence verdict is a different shape
   * with a different answer space, and stuffing it into the same rows would
   * make one table answer two questions. A member who uploads the same file
   * twice — or re-identifies after a browser refresh — pays for the model call
   * once.
   *
   * ⚠️ NOT AN EXPIRY-SENSITIVE HIT. Keyed on the bytes and the owner, not on
   * the id: this answers "have we already identified this photograph", so
   * re-identifying a file does not spend a call to rediscover the same answer.
   */
  async findBySha(args: {
    ownerId: string;
    sha256: string;
  }): Promise<IdentifyRecord | null> {
    try {
      const row = await this.prisma.documentIdentify.findFirst({
        where: {
          ownerId: args.ownerId,
          sha256: args.sha256,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          ownerId: true,
          sha256: true,
          role: true,
          kind: true,
          alsoCovers: true,
          container: true,
          confident: true,
          ocrTextEncrypted: true,
        },
      });
      if (!row) return null;
      return {
        id: row.id,
        ownerId: row.ownerId,
        sha256: row.sha256,
        role: row.role === 'evidence' ? 'evidence' : 'document',
        kind: row.kind,
        alsoCovers: row.alsoCovers,
        container: row.container,
        confident: row.confident,
        ocrText: row.ocrTextEncrypted
          ? (decryptJson<{ text?: string }>(row.ocrTextEncrypted)?.text ?? null)
          : null,
      };
    } catch (err) {
      this.logger.warn(
        `Identify hash lookup failed: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Consume a verdict — read it and delete it in one call.
   *
   * ⚠️ AN ID IS GOOD ONCE. The store handler takes the verdict, writes the
   * row, and this deletes the record, so a replayed id cannot file a second
   * row. The deletion happens whatever the caller does with the verdict; a
   * caller that fails to store has already been handed what it needs.
   */
  async take(args: {
    id: string;
    ownerId: string;
  }): Promise<IdentifyRecord | null> {
    const record = await this.get(args);
    if (!record) return null;
    await this.prisma.documentIdentify
      .delete({ where: { id: record.id } })
      .catch((err) =>
        this.logger.warn(
          `Could not consume identify record ${record.id}: ${(err as Error).message}`,
        ),
      );
    return record;
  }

  /**
   * Drop expired rows, clearing the ciphertext FIRST.
   *
   * ⚠️ TWO STATEMENTS, NOT ONE. A single deleteMany leaves the OCR text in a
   * dead tuple until autovacuum reclaims it, which is not a POPIA answer.
   * Nulling it first is the same discipline the evidence retention sweep uses.
   * Called by the retention cron, never on a request path.
   */
  async purgeExpired(): Promise<number> {
    try {
      const now = new Date();
      await this.prisma.documentIdentify.updateMany({
        where: { expiresAt: { lte: now }, ocrTextEncrypted: { not: null } },
        data: { ocrTextEncrypted: null },
      });
      const { count } = await this.prisma.documentIdentify.deleteMany({
        where: { expiresAt: { lte: now } },
      });
      return count;
    } catch (err) {
      this.logger.warn(
        `Identify expiry sweep failed: ${(err as Error).message}`,
      );
      return 0;
    }
  }
}
