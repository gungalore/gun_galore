import { DocumentReadCacheService } from './document-read-cache.service';
import { DocumentPageRasterService } from './document-page-raster.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MotivationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SecureFileStorageService } from '../common/secure-file-storage.service';

// ────────────────────────────────────────────────────────────────────
// RETENTION — actually deleting the things we said we would delete.
//
// Motivation.retentionPurgeAt has been written since the module was built and
// NOTHING HAS EVER READ IT. Until uploads landed that was a promise nobody had
// to keep; now there are encrypted identity documents on our own disk, and a
// retention policy that no code implements is just a sentence in a privacy
// page.
//
// ── TWO STAGES, because the operator wants both things ──────────────
//
// Operator, 2026-08-18: keep earlier motivations so a repeat applicant gets the
// same storyline. Also: POPIA. Those pull in opposite directions, so retention
// is split by what each thing is actually FOR:
//
//   STAGE 1 — THE SCANS GO.  ID copies, licences, competency certificates and
//             safe photographs carry all of the exposure and none of the
//             argument. At retentionPurgeAt the bytes are deleted, storageKey
//             is nulled and purgedAt is stamped. The ROW stays, so the annexure
//             list still shows what was submitted and when.
//
//   STAGE 2 — THE TEXT GOES.  The motivation itself is the storyline a second
//             application is written from, so it lives as long as the account
//             does. Account deletion cascades it away; erase() removes it on
//             request, immediately.
//
// This is also what the schema always described and no code implemented:
// storageKey is nullable "so a row can outlive its bytes after a retention
// purge", and purgedAt existed with no writer. This is that writer.
//
// ── THINGS THAT WOULD MAKE THIS SILENTLY DO NOTHING ─────────────────
//
// ⚠️ IT MUST NOT CALL MotivationsService. Every method there begins with
// quota.assertEnabled(), and motivation_writer_enabled defaults to FALSE. With
// the flag off, a purge routed through that service would throw NotFound on
// every row, swallow it, delete nothing — and still stamp a healthy heartbeat.
// A retention job that reports success while retaining everything is worse than
// no retention job. So this service talks to Prisma and the file store directly
// and never asks whether the feature is on: the obligation does not switch off
// with the feature.
//
// ⚠️ retentionPurgeAt IS ONLY WRITTEN ON ONE BRANCH — the transition to
// COMPLETED. A draft someone abandoned, or an application that failed the gate,
// never gets a date, so a query on `retentionPurgeAt <= now` would never reach
// them and their ID scans would sit on disk forever. Hence the second sweep
// below, which does not trust the column.
//
// ⚠️ FILES BEFORE ROWS, always. Motivation → MotivationUpload is
// onDelete: Cascade, and a cascade cannot reach the filesystem.
// ────────────────────────────────────────────────────────────────────

/**
 * How long an application that never completed keeps its documents.
 *
 * The safety net, not the policy. A completed application carries an explicit
 * retentionPurgeAt; this catches everything that never got one — abandoned
 * drafts, gate failures, and every row that already exists today.
 *
 * Twelve months from the last time anyone touched it. Long enough that someone
 * who left an application half-finished over a hunting season can come back to
 * it, short enough that we are not holding a stranger's ID copy indefinitely
 * for an application they never made.
 */
const ORPHAN_RETENTION_DAYS = 365;

/** Rows per pass. Bounded so a large purge cannot hold the table. */
const BATCH = 200;
const MAX_BATCHES = 50;

// ────────────────────────────────────────────────────────────────────
// ⚠️ DERIVED ARTIFACTS OUTLIVE THEIR DOCUMENT UNLESS SOMETHING SAYS SO.
//
// Operator, 2026-09-26: "If a file is deleted it must be gone completely."
//
// A document leaves three things behind, not one:
//   1. the encrypted bytes at storageKey — the sweep always removed these;
//   2. a rasterised page image (DocumentPageImage), keyed by the plaintext
//      sha256 — a faithful copy of the licence, held thirty days;
//   3. a cached transcription (DocumentReadCache), also keyed by sha256 —
//      the holder's name, identity number and every serial, held thirty days.
//
// The PER-UPLOAD delete calls forget(sha256) on both, so a member removing a
// file from a pack was covered. THE RETENTION SWEEP AND THE ERASURE WERE NOT:
// they remove bytes and rows in a batch and never had a sha256 to hand
// either service. So a document that aged out, or that was erased with its
// account, kept a picture of itself and a transcript of everything printed on
// it for another thirty days — and if the same file was re-uploaded, the
// stale reading was served as a cache hit rather than re-read.
//
// Both artifacts are keyed by sha256 ALONE, with no source-existence check, so
// this is not self-healing: nothing notices the source is gone. It has to be
// done here, deliberately, whenever bytes are removed by a batch path.
// ────────────────────────────────────────────────────────────────────

/**
 * ⚠️ A FILE WRITTEN BUT NOT YET REFERENCED IS NOT AN ORPHAN.
 *
 * Every writer does `files.write()` and then a row create, and the two are not
 * one transaction — so between them the file is on disk with nothing pointing
 * at it. The reconciliation sweep must not delete it. A file younger than this
 * is left alone; an orphan that never got its row simply waits a day.
 */
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class MotivationRetentionService {
  private readonly logger = new Logger(MotivationRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: SecureFileStorageService,
    private readonly readCache: DocumentReadCacheService,
    private readonly pageRaster: DocumentPageRasterService,
  ) {}

  /**
   * Nightly, 02:40.
   *
   * Deliberately off the hour and off the half-hour: this box runs a lot of
   * crons and stacking them on :00 makes a slow night look like an outage.
   */
  @Cron('40 2 * * *')
  async purge(): Promise<void> {
    try {
      const due = await this.purgeDueUploads();
      const orphaned = await this.purgeOrphanedUploads();
      /**
       * ⚠️ THE READ CACHE EXPIRES HERE TOO, AND IT IS THE SAME OBLIGATION.
       * A cached reading is a name, an ID number and serial numbers — the same
       * class of data as the document it was read off — so it is held to the
       * same standard rather than left to accumulate because it is only a
       * cache. Thirty days, swept nightly with everything else.
       */
      const reads = await this.readCache.purgeExpired();
      /**
       * ⚠️ AND THE PAGE IMAGES, WHICH ARE THE DOCUMENT RATHER THAN A NOTE ABOUT
       * IT. A rasterised page is a faithful picture of somebody's licence or
       * bank statement, so it is held to the standard of the bytes it came from
       * — thirty days, swept nightly, bytes and all.
       */
      const pages = await this.pageRaster.purgeExpired();
      /**
       * ⚠️ ANYTHING ON DISK NO ROW POINTS AT. The last line of defence, and
       * the only one that can find a file whose row was taken by a cascade —
       * see the note on sweepOrphanedFiles. Runs last so a file whose row this
       * very sweep just purged is already reflected in the reference set.
       */
      const swept = await this.sweepOrphanedFiles();
      if (due + orphaned + reads + pages + swept > 0) {
        this.logger.log(
          `Motivation retention: purged ${due} document(s) past their retention date, ${orphaned} from applications that were never completed, ${reads} expired document reading(s), ${pages} expired page image(s) and ${swept} file(s) no row pointed at`,
        );
      }
    } catch (err) {
      // Loud, because a retention failure is a POPIA problem an operator has to
      // know about — not a background nicety that can quietly stop working.
      this.logger.error(
        `Motivation retention purge failed: ${(err as Error).message}`,
      );
    } finally {
      await this.recordCronRun('motivation-retention');
    }
  }

  /**
   * Everything belonging to one user, now — for account deletion.
   *
   * THE HOLE THIS CLOSES. Motivation.userId is onDelete: Cascade, so deleting a
   * User takes the motivations and their upload ROWS with it. A cascade cannot
   * reach the filesystem, so the encrypted identity documents were left on disk
   * with nothing left pointing at them: not reachable by the nightly sweep,
   * which finds files through rows, and not deletable by anything short of
   * someone going in by hand.
   *
   * The scrub branch of deleteById leaked differently and worse. It keeps
   * the User row when financial FKs block a hard delete — so the motivations
   * survived intact, and a POPIA erasure request left the applicant's ID
   * number, home address and security circumstances exactly where they were.
   *
   * So this deletes both, files first, and is called BEFORE either branch runs.
   *
   * MUST NOT THROW. The caller is a identity-provider webhook: an exception there makes
   * the identity provider retry forever and leaves the account undeleted. A failure is logged
   * loudly and swallowed, and what could not be removed is returned so the
   * caller can say so.
   */
  async purgeForUser(
    userId: string,
  ): Promise<{ filesRemoved: number; filesFailed: number; motivations: number }> {
    let filesRemoved = 0;
    let filesFailed = 0;
    let motivations = 0;

    // ⚠️ COLLECTED BEFORE THE ROWS GO, BECAUSE AFTER THEM THERE IS NOTHING TO
    // COLLECT. A reading or a page image is keyed by the plaintext sha256 of
    // the source document, and that hash lives on the upload row — which the
    // cascade below removes. Gathered here, forgotten after the files are
    // gone, so an erasure does not leave a transcript of the ID it erased.
    const sha256s: string[] = [];

    try {
      const rows = await this.prisma.motivation.findMany({
        where: { userId },
        select: {
          id: true,
          uploads: { select: { id: true, storageKey: true, sha256: true } },
          // ⚠️ SIGNATURES WERE BEING LEFT ON DISK FOREVER, INCLUDING THROUGH AN
          // ERASURE REQUEST. This service walked `uploads` and nothing else,
          // so a witness's drawn signature — and now a seller's — survived the
          // row that pointed at it: the cascade takes the record, and the
          // encrypted bytes stay in the tree with nothing left referencing
          // them. Nobody would ever find them to remove by hand.
          //
          // They are third parties' signatures. They are exactly the material
          // an erasure is supposed to reach.
          witnesses: { select: { id: true, signatureKey: true } },
          sellerConsent: { select: { id: true, signatureKey: true } },
        },
      });
      motivations = rows.length;
      if (!rows.length) return { filesRemoved, filesFailed, motivations };

      for (const row of rows) {
        for (const up of row.uploads) {
          if (up.sha256) sha256s.push(up.sha256);
        }
        // Uploads, plus the signatures that hang off the same application.
        const keyed: { id: string; storageKey: string | null }[] = [
          ...row.uploads,
          ...row.witnesses.map((w) => ({
            id: w.id,
            storageKey: w.signatureKey,
          })),
          ...(row.sellerConsent
            ? [
                {
                  id: row.sellerConsent.id,
                  storageKey: row.sellerConsent.signatureKey,
                },
              ]
            : []),
        ];
        for (const up of keyed) {
          if (!up.storageKey) continue;
          try {
            await this.files.remove(up.storageKey);
            filesRemoved++;
          } catch (err) {
            // Keep going. One unreadable key must not strand the rest of an
            // erasure, and the row is going regardless — leaving it would only
            // preserve a pointer to a file we already failed to delete.
            filesFailed++;
            this.logger.error(
              `Account deletion: could not remove ${up.storageKey} (motivation ${row.id}): ${(err as Error).message}`,
            );
          }
        }
      }

      // The rows go even where a file did not: this is an erasure request, and
      // the motivation text carries the ID number, the home address and the
      // applicant's account of their own security circumstances.
      await this.prisma.motivation.deleteMany({ where: { userId } });

      // ⚠️ AND THE DERIVED ARTIFACTS GO WITH THEM. These rows are keyed by
      // sha256, so the cascade cannot reach them and nothing else will: the
      // document is gone, so there is no per-upload delete left to call
      // forget(). Without this a member who asked to be erased keeps a page
      // image of their licence and a cached transcription of its serial
      // numbers for the rest of the month.
      if (sha256s.length) {
        await this.readCache.forgetMany(sha256s);
        await this.pageRaster.forgetMany(sha256s);
      }
    } catch (err) {
      this.logger.error(
        `Account deletion: motivation purge for user ${userId} failed: ${(err as Error).message}`,
      );
    }

    if (filesFailed > 0) {
      this.logger.error(
        `Account deletion: ${filesFailed} motivation file(s) for user ${userId} could NOT be deleted and are now orphaned on disk — remove them by hand.`,
      );
    }
    return { filesRemoved, filesFailed, motivations };
  }

  /** Stage 1 for applications that completed and carry a retention date. */
  private async purgeDueUploads(): Promise<number> {
    return this.purgeWhere({
      purgedAt: null,
      storageKey: { not: null },
      motivation: { retentionPurgeAt: { lte: new Date() } },
    });
  }

  /**
   * The same, for applications that never got a retention date.
   *
   * Does NOT trust retentionPurgeAt, because nothing writes it outside the
   * COMPLETED branch. Anything abandoned, failed, or simply left alone is
   * caught here on the age of the row instead.
   */
  private async purgeOrphanedUploads(): Promise<number> {
    const cutoff = new Date(
      Date.now() - ORPHAN_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    return this.purgeWhere({
      purgedAt: null,
      storageKey: { not: null },
      motivation: {
        retentionPurgeAt: null,
        updatedAt: { lt: cutoff },
        // A completed application without a retention date would be a bug
        // elsewhere; excluding it here means this sweep can only ever reach
        // work that was genuinely left behind.
        status: {
          in: [
            MotivationStatus.DRAFT,
            MotivationStatus.NEEDS_MORE_INFO,
            MotivationStatus.ABANDONED,
            MotivationStatus.FAILED,
          ],
        },
      },
    });
  }

  /**
   * Delete bytes, then mark the row.
   *
   * Each file gets its own try/catch: one unreadable key must not strand the
   * rest of a purge. A failure leaves the row untouched so the next run tries
   * again — which is the right way round, because marking it purged while the
   * bytes survive would hide the file from every future sweep.
   */
  private async purgeWhere(
    where: Record<string, unknown>,
  ): Promise<number> {
    let purged = 0;
    // ⚠️ THE HASHES OF THE DOCUMENTS WE PURGED, so their page images and
    // cached readings can be forgotten once the batch is done. `sha256` is
    // selected for exactly this: it is the only key the two derived services
    // know, and it is not otherwise used on this path.
    const purgedSha256s: string[] = [];

    for (let pass = 0; pass < MAX_BATCHES; pass++) {
      const batch = await this.prisma.motivationUpload.findMany({
        where: where as never,
        select: { id: true, storageKey: true, motivationId: true, sha256: true },
        take: BATCH,
        orderBy: { createdAt: 'asc' },
      });
      if (batch.length === 0) break;

      let progressed = false;
      for (const up of batch) {
        if (!up.storageKey) continue;
        try {
          await this.files.remove(up.storageKey);
        } catch (err) {
          this.logger.error(
            `Retention: could not remove ${up.storageKey} (upload ${up.id}, motivation ${up.motivationId}): ${(err as Error).message}`,
          );
          continue;
        }
        await this.prisma.motivationUpload.update({
          where: { id: up.id },
          data: {
            storageKey: null,
            purgedAt: new Date(),
            // ⚠️ THE TRANSCRIPT GOES WITH THE IMAGE, OR THE PURGE PURGES
            // NOTHING. ocrTextEncrypted holds the FULL text Vision read off
            // the page — the holder's name, identity number, address and
            // every serial on it. Deleting the photograph and keeping a
            // verbatim copy of everything printed on it would be a retention
            // sweep that retains the sensitive half.
            //
            // ocrChars stays: a count is not content, and it records that
            // this document had in fact been read, which purgedAt alone does
            // not say. Same reasoning as extractedFields beside it.
            ocrTextEncrypted: null,
            // ⚠️ THE MEMBER'S OWN WORDS GO WITH THE PHOTOGRAPH. For an
            // evidence item the description IS the content — "me and my son
            // on a hunt in Limpopo" is POPIA data about a private photograph,
            // and it is the only text on the row. Leaving it behind would
            // keep the sentence that describes a deleted image. The container
            // (evidenceType) stays: an id is not content, and without it the
            // row would read as unplaceable rather than as purged.
            evidenceDescriptionEncrypted: null,
          },
        });
        if (up.sha256) purgedSha256s.push(up.sha256);
        purged++;
        progressed = true;
      }

      // Every row in the batch failed to delete. Another pass would fetch the
      // same rows and fail again, so stop rather than spin — the errors above
      // are already loud.
      if (!progressed) break;
      if (batch.length < BATCH) break;
    }

    // ⚠️ THE DERIVED ARTIFACTS GO WITH THE BYTES. This is the hole the whole
    // note at the top of this file is about: the bytes are gone and the row is
    // marked, so from every angle the purge looks complete — while a page
    // image of the licence and a transcript of its serial numbers sit in the
    // tree for another thirty days, and the next upload of the same file is
    // served the stale reading as a cache hit. Keyed by sha256, so nothing else
    // will ever notice.
    if (purgedSha256s.length) {
      await this.readCache.forgetMany(purgedSha256s);
      await this.pageRaster.forgetMany(purgedSha256s);
    }

    return purged;
  }

  /**
   * Delete files on disk that no row points at.
   *
   * ⚠️ THIS IS THE ONLY SWEEP THAT CAN SEE A CASCADE'S LEFTOVERS. Every other
   * path to a file goes through a row: `purgeWhere` finds files through
   * upload rows, `purgeForUser` through a user's rows. When the ROW is gone —
   * a hard cascade, a `deleteMany` that took a soft-deleted upload with it, a
   * crash between `write()` and the create that would have referenced it —
   * nothing points at the bytes and no row-driven sweep can ever reach them
   * again. They sit in the encrypted tree forever, photographs of ID books
   * nobody can find.
   *
   * It works the other way round: list the disk, then ask which of those keys
   * the database still references. What is left is garbage by construction.
   *
   * ⚠️ THE REFERENCE SET IS EVERY STORAGE KEY IN THE SCHEMA, NOT JUST THE
   * MOTIVATION ONES. A sweep that knew only about MotivationUpload would
   * delete every vault credential, every KYC document and every seller
   * signature — the single most destructive thing this file could do. The one
   * that must be maintained when a column is added is this list; a missing
   * column here does not fail, it silently deletes live files.
   *
   * ⚠️ AND IT IS AGE-GUARDED. A writer does `files.write()` and THEN the row
   * create, in that order and not in one transaction — so a file with no row
   * is the normal state for a moment on every single upload. A file younger
   * than ORPHAN_GRACE_MS is never touched, which is what keeps a race from
   * turning a member's document into a deleted one.
   *
   * ⚠️ AND IT DOES NOT RUN WHEN THE PROBLEM IS OURS TO FIX BY HAND. If the
   * reference query throws, the sweep returns 0 and deletes nothing — an
   * empty reference set would look exactly like "every file is an orphan".
   */
  private async sweepOrphanedFiles(): Promise<number> {
    let referenced: Set<string>;
    try {
      referenced = await this.referencedStorageKeys();
    } catch (err) {
      this.logger.error(
        `Retention: could not build the storage-key reference set, so no disk file will be swept this run: ${(err as Error).message}`,
      );
      return 0;
    }

    let files: Awaited<ReturnType<SecureFileStorageService['list']>>;
    try {
      files = await this.files.list();
    } catch (err) {
      this.logger.error(
        `Retention: could not read the storage tree: ${(err as Error).message}`,
      );
      return 0;
    }

    const cutoff = Date.now() - ORPHAN_GRACE_MS;
    let swept = 0;
    for (const file of files) {
      if (referenced.has(file.key)) continue;
      // A file written moments ago whose row has not landed yet. Not an
      // orphan — the normal middle of an upload.
      if (file.modifiedMs > cutoff) continue;
      try {
        await this.files.remove(file.key);
        swept++;
      } catch (err) {
        this.logger.error(
          `Retention: could not remove orphaned file ${file.key}: ${(err as Error).message}`,
        );
      }
    }

    if (swept > 0) {
      // ⚠️ A NAMED FILE IN THE LOG, SO IT IS NOT A SILENT DELETE. A sweep
      // that removes bytes with no row behind them is exactly the kind of
      // thing that must be diagnosable after the fact, and these keys name
      // nothing sensitive — an opaque random id under a namespace.
      this.logger.warn(
        `Retention: removed ${swept} file(s) with no row pointing at them`,
      );
    }
    return swept;
  }

  /**
   * Every storage key currently referenced by a row, across the whole schema.
   *
   * ⚠️ ELEVEN COLUMNS, AND EVERY WRITER OF SecureFileStorageService HAS ONE.
   * A column left out here is not a missing feature — it is a live document
   * the sweep would delete the first night after its grace period lapsed.
   * The writers, for the next person adding one:
   *   · motivation-documents.service  → MotivationUpload.storageKey
   *   · licence-centre.service        → Credential.storageKey
   *   · vault-adoption / kyc-id-adoption → Credential.storageKey
   *   · motivation-witness.service    → MotivationWitness.signatureKey
   *   · motivation-seller-consent      → .signatureKey, .licenceFrontKey,
   *                                      .licenceBackKey, and a
   *                                      MotivationSellerConsentDocument.storageKey
   *   · motivation-render.service      → Motivation.coverPhotoKey
   *   · kyc.service                    → User.kycIdStorageKey, kycSelfieStorageKey
   *   · document-page-raster.service   → DocumentPageImage.storageKey
   */
  private async referencedStorageKeys(): Promise<Set<string>> {
    const keys = new Set<string>();
    const add = (rows: { key: string | null }[]) => {
      for (const r of rows) if (r.key) keys.add(r.key);
    };

    const [
      uploads,
      credentials,
      pageImages,
      witnessSigs,
      consentSigs,
      consentDocs,
      coverPhotos,
      kyc,
    ] = await Promise.all([
      this.prisma.motivationUpload.findMany({
        where: { storageKey: { not: null } },
        select: { storageKey: true },
      }),
      this.prisma.credential.findMany({
        where: { storageKey: { not: null } },
        select: { storageKey: true },
      }),
      this.prisma.documentPageImage.findMany({
        select: { storageKey: true },
      }),
      this.prisma.motivationWitness.findMany({
        where: { signatureKey: { not: null } },
        select: { signatureKey: true },
      }),
      this.prisma.motivationSellerConsent.findMany({
        select: { signatureKey: true, licenceFrontKey: true, licenceBackKey: true },
      }),
      this.prisma.motivationSellerConsentDocument.findMany({
        where: { storageKey: { not: null } },
        select: { storageKey: true },
      }),
      this.prisma.motivation.findMany({
        where: { coverPhotoKey: { not: null } },
        select: { coverPhotoKey: true },
      }),
      this.prisma.user.findMany({
        select: { kycIdStorageKey: true, kycSelfieStorageKey: true },
      }),
    ]);

    add(uploads.map((r) => ({ key: r.storageKey })));
    add(credentials.map((r) => ({ key: r.storageKey })));
    add(pageImages.map((r) => ({ key: r.storageKey })));
    add(witnessSigs.map((r) => ({ key: r.signatureKey })));
    for (const r of consentSigs) {
      add([{ key: r.signatureKey }, { key: r.licenceFrontKey }, { key: r.licenceBackKey }]);
    }
    add(consentDocs.map((r) => ({ key: r.storageKey })));
    add(coverPhotos.map((r) => ({ key: r.coverPhotoKey })));
    for (const r of kyc) {
      add([{ key: r.kycIdStorageKey }, { key: r.kycSelfieStorageKey }]);
    }

    return keys;
  }

  /**
   * Mirrors TasksService.recordCronRun so this appears on /admin/health.
   *
   * ⚠️ Monitoring is OPT-IN and nothing scans decorators: writing this
   * heartbeat is only half of it. The matching entry in admin-health.service.ts
   * `definitions` is the other half, and without it this runs unwatched.
   */
  private async recordCronRun(key: string): Promise<void> {
    try {
      await this.prisma.setting.upsert({
        where: { key: `cron:lastrun:${key}` },
        create: { key: `cron:lastrun:${key}`, value: new Date().toISOString() },
        update: { value: new Date().toISOString() },
      });
    } catch (err) {
      this.logger.warn(`recordCronRun(${key}) failed: ${(err as Error).message}`);
    }
  }
}
