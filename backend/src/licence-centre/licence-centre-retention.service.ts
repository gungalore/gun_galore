import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SecureFileStorageService } from '../common/secure-file-storage.service';

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

@Injectable()
export class LicenceCentreRetentionService {
  private readonly logger = new Logger(LicenceCentreRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: SecureFileStorageService,
  ) {}

  /**
   * Nightly at 03:35 — after the 02:10 box backup, so the freshest tarball
   * always predates the job that deletes things.
   */
  @Cron('35 3 * * *')
  async sweep(): Promise<void> {
    try {
      await this.purgeSoftDeleted();
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
   * Everything one member has, bytes included.
   *
   * ⚠️ MUST NOT THROW. The caller is the Clerk `user.deleted` webhook: an
   * exception there makes Clerk retry forever and leaves the account
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
  }> {
    const out = { credentials: 0, filesRemoved: 0, filesFailed: 0 };
    try {
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
