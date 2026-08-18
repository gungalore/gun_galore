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

@Injectable()
export class MotivationRetentionService {
  private readonly logger = new Logger(MotivationRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: SecureFileStorageService,
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
      if (due + orphaned > 0) {
        this.logger.log(
          `Motivation retention: purged ${due} document(s) past their retention date and ${orphaned} from applications that were never completed`,
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

    for (let pass = 0; pass < MAX_BATCHES; pass++) {
      const batch = await this.prisma.motivationUpload.findMany({
        where: where as never,
        select: { id: true, storageKey: true, motivationId: true },
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
          data: { storageKey: null, purgedAt: new Date() },
        });
        purged++;
        progressed = true;
      }

      // Every row in the batch failed to delete. Another pass would fetch the
      // same rows and fail again, so stop rather than spin — the errors above
      // are already loud.
      if (!progressed) break;
      if (batch.length < BATCH) break;
    }

    return purged;
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
