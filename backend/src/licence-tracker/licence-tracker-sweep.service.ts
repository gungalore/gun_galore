import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { FLAGS, SettingsService } from '../settings/settings.service';
import { LicenceTrackerService } from './licence-tracker.service';

// ────────────────────────────────────────────────────────────────────
// THE WEEKLY POLL OF THE SAPS ENQUIRY.
//
// The member can check one application by hand; nobody is going to open the
// app every week for a status that moves a handful of times in a year. This
// is the job that notices on their behalf.
//
// ⚠️ IT IS DELIBERATELY WEAKER THAN THE MEMBER'S OWN BUTTON. It is gated on
// `licence_tracker_sweep_enabled`, which ships OFF, because this is the one
// thing in the feature that makes traffic to a host that answers strangers
// with a block page. The manual path is on by default; the automatic one is
// a deliberate second decision for the operator.
//
// ⚠️ THE GATE IS INSIDE THE `try` AND BEFORE ANY WORK, and the heartbeat in
// `finally` is NOT gated. An unauthenticated external probe 503s when a
// monitored cron stops stamping, so a flag-off job has to keep reporting
// that it is alive — see admin-health.service.ts's row for this key.
//
// ⚠️ NOTHING HERE POLLS. The lookup, the diff, the event and the alert all
// live in LicenceTrackerService; this file's whole job is the schedule and
// the heartbeat, and it must stay that way or a second copy of the safety
// rules appears.
// ────────────────────────────────────────────────────────────────────

@Injectable()
export class LicenceTrackerSweepService {
  private readonly logger = new Logger(LicenceTrackerSweepService.name);

  constructor(
    private readonly tracker: LicenceTrackerService,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Sunday at 04:40.
   *
   * Off the hour and off every other job on purpose: 02:10 is the box
   * backup, 02:40 the motivation retention purge, 03:00 the trust-score
   * refresh, 03:20 the licence reminders, 03:35 the Licence Centre file
   * retention and 04:00 the stale-listing sweep. Sunday, because the DFO
   * offices are shut and the enquiry is at its quietest.
   *
   * ⚠️ THE BOX TIMEZONE IS NOT PINNED — no @Cron in this repo passes a
   * timeZone. Confirm with `ssh alloutdoor "date"` before trusting the hour;
   * only the "middle of the night" part really matters.
   */
  @Cron('40 4 * * 0')
  async sweep(): Promise<void> {
    try {
      const on = await this.settings.get(FLAGS.licenceTrackerSweepEnabled);
      if (!on) return;
      if (!(await this.settings.get(FLAGS.licenceTrackerEnabled))) return;

      const out = await this.tracker.sweep();
      if (out.polled > 0 || out.failed > 0) {
        this.logger.log(
          `SAPS tracker sweep: ${out.polled} polled, ${out.changed} moved, ` +
            `${out.failed} failed, ${out.skipped} left for next week`,
        );
      }
    } catch (err) {
      // ⚠️ SWALLOWED ON PURPOSE. A cron that throws takes the app's error
      // handler with it and the heartbeat still has to land, or the health
      // board cannot tell "it ran and something went wrong" from "it never
      // ran at all" — and the second is the one worth waking somebody for.
      this.logger.error(
        `SAPS tracker sweep failed: ${(err as Error).message}`,
      );
    } finally {
      await this.recordCronRun('licence-tracker-sweep');
    }
  }

  /**
   * Mirrors TasksService.recordCronRun so this shows on /admin/health.
   *
   * ⚠️ Writing this heartbeat is only half of it. Monitoring is opt-in and
   * nothing scans decorators: the matching row in admin-health.service.ts
   * `definitions` is the other half, and without it this runs unwatched.
   */
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
