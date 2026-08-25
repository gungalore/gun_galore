import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FLAGS, SettingsService } from '../settings/settings.service';
import {
  REMINDER_STAGES,
  ReminderStage,
  daysUntil,
  startOfUtcDay,
} from './licence-dates';

// ────────────────────────────────────────────────────────────────────
// LC1 — THE REMINDER SWEEP.
//
// The whole point of the Centre. A licence expires on a statutory clock, and
// the renewal has to be lodged well before that date, so the reminder is
// worth more than the storage.
//
// ⚠️ ONLY A SETTLED DATE FIRES, AND THERE ARE NOW TWO WAYS TO SETTLE ONE.
// This used to read "only a CONFIRMED date fires... extraction proposes a
// date; the member confirms it; nothing here can promote an unconfirmed
// guess." Defensible, and it meant a member who uploaded a firearm licence
// and never went back to tick a box got NO REMINDER AT ALL — in the one
// product whose entire job is warning them before it expires.
//
// Operator, 2026-08-25: "insert it. No further user interaction required.
// Thats why we are designing this system, for automation and ease of use!"
//
// So the predicate is `confirmedAt` OR `dateSource` — a date the member
// settled, or one we filled in and armed. What promotes a guess is not this
// file: credential-auto-date.ts decides, before anything is stored, whether a
// reading is sure enough to act on. A date we are not sure of is still
// written and shown; it simply never gets a dateSource, so nothing here can
// see it. That distinction is the safety property, and it lives there.
//
// ⚖️ WE REMIND, WE NEVER ENSURE. Not "we'll make sure you never miss a
// renewal" — that is an outcome promise. The responsibility to renew stays
// the member's, and the document as printed always governs. Every message
// says so.
// ────────────────────────────────────────────────────────────────────

/** Rows per stage per pass, so one big night cannot hold the table. */
const BATCH = 200;

@Injectable()
export class LicenceCentreRemindersService {
  private readonly logger = new Logger(LicenceCentreRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Nightly at 03:20.
   *
   * Off the hour and off the half-hour on purpose: 02:10 is the box backup,
   * 02:40 the motivation retention purge, 03:00 the trust-score refresh, 04:00
   * the stale-listing sweep. Stacking one more job on :00 makes a slow night
   * look like an outage.
   *
   * ⚠️ THE BOX TIMEZONE IS NOT PINNED. No @Cron in this repo passes a timeZone
   * and nothing sets TZ in the deploy path, so this fires at 03:20 in the
   * box's own zone. Confirm with `ssh alloutdoor "date"` before trusting the
   * hour — the only thing that actually matters is that it is the middle of
   * the night, because these send SMS.
   */
  @Cron('20 3 * * *')
  async sweep(): Promise<void> {
    try {
      // The gate sits INSIDE the try and BEFORE any work. The heartbeat below
      // is in `finally` and is deliberately NOT gated: an unauthenticated
      // external probe 503s when a monitored cron stops stamping, so a
      // flag-off module must still report that it is alive.
      const on = await this.settings.get(FLAGS.licenceCentreRemindersEnabled);
      if (!on) return;

      const smsOn = await this.settings.get(FLAGS.licenceCentreSmsEnabled);

      let sent = 0;
      // ⚠️ TIGHTEST FIRST, AND THE ORDER IS LOAD-BEARING.
      //
      // tighterUnfired() guards each stage against the stages TIGHTER than
      // it. Run widest-first and that guard never bites: T-180 stamps itself,
      // then T-120 — whose guard does not look at remind180SentAt — matches
      // the same row and fires too, and so on. A licence twenty days out
      // collected all five messages on one night.
      //
      // Tightest-first, D-0 or T-30 claims the row and every wider stage is
      // then correctly blocked by its own guard. Copy the array; it is a
      // shared readonly constant.
      for (const stage of [...REMINDER_STAGES].reverse()) {
        try {
          sent += await this.runStage(stage, smsOn);
        } catch (err) {
          // One bad stage must never block the rest — the D-0 message is the
          // one that matters most and it runs last.
          this.logger.error(
            `Licence Centre reminder stage ${stage.stage} failed: ${(err as Error).message}`,
          );
        }
      }
      if (sent > 0) {
        this.logger.log(`Licence Centre: sent ${sent} expiry reminder(s)`);
      }
    } catch (err) {
      this.logger.error(
        `Licence Centre reminder sweep failed: ${(err as Error).message}`,
      );
    } finally {
      await this.recordCronRun('licence-centre-reminders');
    }
  }

  private async runStage(
    stage: (typeof REMINDER_STAGES)[number],
    smsOn: boolean,
  ): Promise<number> {
    const now = new Date();
    const cutoff = new Date(now.getTime() + stage.days * 24 * 60 * 60 * 1000);

    // `lte`, not a band. A document added late, or muted and un-muted, or
    // missed because the box was down, is still caught by the first stage it
    // is inside — and the per-stage claim column is what stops it firing
    // twice. A band silently skips anyone not looked at on the exact night.
    const rows = await this.prisma.credential.findMany({
      where: {
        // Settled by the member, or filled in and armed by us. See the header.
        OR: [{ confirmedAt: { not: null } }, { dateSource: { not: null } }],
        remindersMuted: false,
        purgedAt: null,
        expiresOn: { not: null, lte: cutoff },
        [stage.column]: null,
        // Every TIGHTER stage must also be unfired. Without this, a document
        // that already had its "expired" message would collect "expires in 30
        // days" the following night — every wider window stays true forever.
        ...tighterUnfired(stage.stage),
      },
      select: {
        id: true,
        title: true,
        expiresOn: true,
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            firstName: true,
            subscriptionTier: true,
          },
        },
      },
      take: BATCH,
      orderBy: { expiresOn: 'asc' },
    });

    let sent = 0;
    for (const c of rows) {
      if (!c.expiresOn) continue;

      // CLAIM BEFORE SENDING. The guard column is in the WHERE of both the
      // find and this update, so two overlapping runs cannot both send. A lost
      // claim is silent, not an error — the other run has it.
      const claim = await this.prisma.credential.updateMany({
        where: {
          id: c.id,
          [stage.column]: null,
          remindersMuted: false,
          // Re-check the date: a member who corrected the expiry mid-sweep
          // must not be reminded against the date we read a moment ago.
          expiresOn: { lte: cutoff },
        },
        data: { [stage.column]: now },
      });
      if (claim.count === 0) continue;

      sent += 1;

      // PRICING MODEL C: storage and the in-app reminder are free for
      // everyone; SMS and email automation are what AO Pro buys. The free
      // member still sees the badge and the date — which is the moment the
      // upgrade actually means something.
      const isPro = c.user.subscriptionTier === 'PRO';

      await this.notifications
        .credentialExpiring({
          userId: c.user.id,
          phone: c.user.phone,
          name: c.user.firstName ?? 'there',
          email: c.user.email,
          credentialId: c.id,
          title: c.title,
          expiresOn: c.expiresOn,
          // Counted on CALENDAR boundaries, not from the raw instant.
          // daysUntil(expiry, now) at 03:20 on a licence exactly 30 days out
          // floors 29.94 to 29, so the message read "expires on 2026-09-18 —
          // 29 days away", contradicting its own date.
          daysLeft: Math.max(0, daysUntil(c.expiresOn, startOfUtcDay(now))),
          stage: stage.stage,
          smsEnabled: smsOn && isPro,
          emailEnabled: isPro,
        })
        // One bad recipient must not reject the loop — the claim is already
        // stamped, so this is a message lost rather than a sweep lost.
        .catch((err) =>
          this.logger.warn(
            `Licence reminder for credential ${c.id} did not send: ${(err as Error).message}`,
          ),
        );
    }
    return sent;
  }

  /**
   * Mirrors TasksService.recordCronRun so this shows on /admin/health.
   *
   * ⚠️ Writing this heartbeat is only half of it. Monitoring is opt-in and
   * nothing scans decorators: the matching row in admin-health.service.ts
   * `definitions` is the other half, and without it this runs unwatched.
   *
   * It records THAT A PASS RAN, not that it succeeded — an erroring-but-alive
   * cron has to look different from a dead one.
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

/**
 * "No tighter stage has already fired."
 *
 * Pure, and exported for the spec: this is the condition that makes `lte`
 * windows safe, and getting it wrong means reminding somebody about a document
 * that expired last year, every single night.
 */
export function tighterUnfired(
  stage: ReminderStage,
): Record<string, null> {
  const i = REMINDER_STAGES.findIndex((s) => s.stage === stage);
  const out: Record<string, null> = {};
  for (const s of REMINDER_STAGES.slice(i + 1)) out[s.column] = null;
  return out;
}
