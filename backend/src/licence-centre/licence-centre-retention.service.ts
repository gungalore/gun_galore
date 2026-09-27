import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SecureFileStorageService } from '../common/secure-file-storage.service';
// From MotivationsModule, which this module already imports (and exports it
// from). It is not @Global, so it must be injected through that edge.
import { DocumentIdentifyService } from '../common/document-identify.service';

// ────────────────────────────────────────────────────────────────────
// LC0 — RETENTION AND ERASURE.
//
// ⚠️ NOT FLAG-GATED, DELIBERATELY. A purge routed through the flag gate
// deletes nothing while the flag is off and still stamps a healthy heartbeat:
// a POPIA job that looks green and does nothing. This talks to Prisma and the
// file store directly.
//
// ⚠️ VAULT RETENTION IS USER-CONTROLLED, NOT CLOCK-CONTROLLED. A document
// lives as long as the account does — that is the product. So there is no
// "older than N days" sweep here. This cron is the safety net for bytes that
// lost their row, which is the one thing nobody else can find.
//
// ⚠️ THE VAULT'S BYTES ARE ITS OWN. A motivation upload is a DUPLICATE, with
// its own row and its own storage key, purged on the writer's clock. Nothing
// in this file may ever reach a motivation's file, and nothing in the writer's
// purge may reach one of these.
// ────────────────────────────────────────────────────────────────────

const BATCH = 200;

// ────────────────────────────────────────────────────────────────────
// ⚠️ A DEACTIVATED TRACKER IS KEPT FOR A YEAR, THEN HARD-DELETED.
//
// Deactivating is member bookkeeping, not erasure — the row keeps the
// application's whole observed history, and a member who tidied their list
// in March may want last year's status in September. But the encrypted
// reference and serial are POPIA-sensitive and nobody has asked for them in
// a year, so they go. A firearm application runs for months, which is why
// this window is measured in years rather than weeks.
//
// Deactivation stamps `updatedAt` (Prisma's @updatedAt), and nothing else
// touches a deactivated row — the sweep only polls `active: true` — so
// `updatedAt` IS the deactivation date. There is no second column to keep
// honest.
// ────────────────────────────────────────────────────────────────────
const TRACKER_RETENTION_DAYS = 365;

@Injectable()
export class LicenceCentreRetentionService {
  private readonly logger = new Logger(LicenceCentreRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: SecureFileStorageService,
    // ⚠️ THE IDENTIFY STORE IS SWEPT HERE, NOT IN THE MOTIVATIONS CRON. It is
    // POPIA data — the OCR text of licences and identity documents — and the
    // vault's own crons exist for exactly this class of leftover. A member who
    // identifies ten files and uploads none must leave nothing behind.
    private readonly identify: DocumentIdentifyService,
  ) {}

  /**
   * Nightly at 03:35 — after the 02:10 box backup, so the freshest tarball
   * always predates the job that deletes things.
   */
  @Cron('35 3 * * *')
  async sweep(): Promise<void> {
    try {
      await this.purgeSoftDeleted();
      await this.purgeDeactivatedTrackers();
      // Swallows its own failure, like the tracker purge: a stuck identify row
      // is not a reason to skip the other two POPIA obligations.
      await this.identify.purgeExpired();
    } catch (err) {
      this.logger.error(
        `Licence Centre retention sweep failed: ${(err as Error).message}`,
      );
    } finally {
      await this.recordCronRun('licence-centre-retention');
    }
  }

  /**
   * Rows marked purged whose bytes are somehow still on disk.
   *
   * The delete path removes the file first and the row second, so this should
   * find nothing. It exists because "should find nothing" is a claim, and a
   * file nobody can see is a file nobody deletes.
   */
  private async purgeSoftDeleted(): Promise<number> {
    let purged = 0;
    for (;;) {
      const batch = await this.prisma.credential.findMany({
        where: { purgedAt: { not: null }, storageKey: { not: null } },
        select: { id: true, storageKey: true },
        take: BATCH,
      });
      if (!batch.length) break;

      let progressed = false;
      for (const c of batch) {
        if (!c.storageKey) continue;
        try {
          await this.files.remove(c.storageKey);
        } catch (err) {
          // Leave the key in place. Clearing it while the bytes survive would
          // hide the file from every future sweep, permanently.
          this.logger.error(
            `Licence Centre retention: could not remove ${c.storageKey} (credential ${c.id}): ${(err as Error).message}`,
          );
          continue;
        }
        await this.prisma.credential.update({
          where: { id: c.id },
          data: { storageKey: null },
        });
        purged++;
        progressed = true;
      }

      // Every row in the batch failed. Another pass fetches the same rows and
      // fails the same way, so stop rather than spin.
      if (!progressed) break;
      if (batch.length < BATCH) break;
    }
    if (purged > 0) {
      this.logger.log(`Licence Centre retention: removed ${purged} orphaned file(s)`);
    }
    return purged;
  }

  /**
   * Trackers the member deactivated more than a year ago.
   *
   * ⚠️ SWALLOWS ITS OWN FAILURE, so a database hiccup here cannot stop
   * `purgeSoftDeleted()` from running (or the reverse). Both are POPIA
   * obligations and neither is a reason to skip the other.
   *
   * ⚠️ HARD DELETE. The events go with it through `onDelete: Cascade`, which
   * is the point: the reference and serial ciphertext, and every status SAPS
   * ever printed for it, leave together. Nothing here is soft-deleted twice.
   */
  private async purgeDeactivatedTrackers(): Promise<number> {
    try {
      const cutoff = new Date(
        Date.now() - TRACKER_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );
      const { count } = await this.prisma.trackedApplication.deleteMany({
        where: { active: false, updatedAt: { lt: cutoff } },
      });
      if (count > 0) {
        this.logger.log(
          `Licence Centre retention: purged ${count} deactivated tracker(s) idle for over ${TRACKER_RETENTION_DAYS} days`,
        );
      }
      return count;
    } catch (err) {
      this.logger.error(
        `Licence Centre retention: tracker purge failed: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  /**
   * Everything one member has, bytes included.
   *
   * ⚠️ MUST NOT THROW. The caller is the account-deletion path: an
   * exception there makes the identity provider retry forever and leaves the account
   * undeleted. A failure is logged loudly and swallowed, and what could not be
   * removed is returned so the caller can say so.
   *
   * ⚠️ IT DELETES THE ROWS EXPLICITLY rather than trusting the cascade. The
   * account-deletion path has a fallback branch that KEEPS the User row and
   * scrubs its PII when a financial foreign key blocks the delete — under that
   * branch a cascade never happens, and these documents would survive an
   * erasure request.
   */
  async purgeForUser(userId: string): Promise<{
    credentials: number;
    filesRemoved: number;
    filesFailed: number;
    trackers: number;
  }> {
    const out = { credentials: 0, filesRemoved: 0, filesFailed: 0, trackers: 0 };
    try {
      // ⚠️ THE SAPS TRACKER COMES TOO, ACTIVE ONES INCLUDED. It is the same
      // class of record as everything else this method exists for: POPIA
      // data about a member's firearms licence, encrypted at rest, with no
      // home once the member is gone. Deactivated rows are not a loophole —
      // erasure is erasure. The events cascade with the row.
      // ⚠️ ORDER DOES NOT MATTER HERE but the credential rows below rely on
      // this deleting FIRST only in the sense that both are independent
      // deletes; neither can block the other.
      const trackers = await this.prisma.trackedApplication.deleteMany({
        where: { userId },
      });
      out.trackers = trackers.count;

      const rows = await this.prisma.credential.findMany({
        where: { userId },
        select: { id: true, storageKey: true },
      });
      out.credentials = rows.length;
      if (!rows.length) return out;

      for (const c of rows) {
        if (!c.storageKey) continue;
        try {
          await this.files.remove(c.storageKey);
          out.filesRemoved++;
        } catch (err) {
          out.filesFailed++;
          this.logger.error(
            `Erasure: could not remove credential file ${c.storageKey}: ${(err as Error).message}`,
          );
        }
      }

      // Rows go even where a file could not be removed: the member asked to be
      // erased, and a stuck file is our problem to clean up by hand, not a
      // reason to keep their records.
      await this.prisma.credential.deleteMany({ where: { userId } });
    } catch (err) {
      this.logger.error(
        `Licence Centre purge for user ${userId} failed: ${(err as Error).message}`,
      );
    }
    return out;
  }

  private async recordCronRun(key: string): Promise<void> {
    try {
      const now = new Date().toISOString();
      await this.prisma.setting.upsert({
        where: { key: `cron:lastrun:${key}` },
        create: { key: `cron:lastrun:${key}`, value: now },
        update: { value: now },
      });
    } catch (err) {
      this.logger.warn(
        `recordCronRun(${key}) failed: ${(err as Error).message}`,
      );
    }
  }
}
