import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

// ────────────────────────────────────────────────────────────────────────────
// EXP-E4 — Experience (Hunting Packages) SLA sweep. The nudge/alert twin of
// DispatchSlaService for future-dated ON-SITE services (ShippingMethod.
// ON_SITE_SERVICE). An experience never dispatches and never auto-refunds, so
// it is invisible to EVERY courier/DT/collection sweep in dispatch-sla.service
// (all of which filter shippingMethod to PUDO/TCG/DEALER_TRANSFER/COLLECTION).
// This service is its own hourly sweep, mirroring the DT/collection "human-
// judgment, no blind refund" precedent:
//
//   a. nudgeBookingConfirm   — outfitter hasn't confirmed, deadline approaching
//   b. escalateBookingConfirm — outfitter still unconfirmed past deadline → admin
//   c. remindPreEvent        — confirmed booking ~PRE_EVENT_REMINDER_DAYS out
//   d. nudgeAndAlertPostEvent — event passed, buyer hasn't confirmed → nudge,
//                               then admin alert if still HELD after the window
//
// INVARIANTS (adversarially reviewed):
//   • EVERY query filters shippingMethod=ON_SITE_SERVICE + paymentStatus=HELD,
//     so a courier order can NEVER be selected here.
//   • NO pass moves money, releases, or refunds. Passes (a),(c),(d-stageA) send
//     a best-effort notification and stamp a one-shot guard column; (b),(d-
//     stageB) raise an AdminAlert (human decides).
//   • Alert-and-stamp happen in ONE $transaction (mirrors alertStuckHeldFunds):
//     a failed alert rolls the guard stamp back so the next run simply retries.
//   • The booking-confirm deadline is DERIVED as paidAt + BOOKING_CONFIRM_HOURS
//     in-code (bookingConfirmDeadlineAt may be NULL — E1 didn't always stamp it),
//     so the sweep never depends on that column being populated.
// ────────────────────────────────────────────────────────────────────────────

// Outfitter accept window (from paidAt). Mirrors E1/E2 semantics.
const BOOKING_CONFIRM_HOURS = 48;
// How far out the pre-event reminder fires (confirmed bookings only).
const PRE_EVENT_REMINDER_DAYS = 3;
// Grace after the event before an unconfirmed booking is escalated to admin.
const POST_EVENT_CONFIRM_WINDOW_DAYS = 7;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

@Injectable()
export class ExperienceSlaService {
  private readonly logger = new Logger(ExperienceSlaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // Single public entry point — runs the four idempotent passes in order.
  // Each pass has its own try/catch inside so one failing pass never blocks
  // the others (the caller in tasks.service wraps the whole thing too).
  async experienceSlaSweep(): Promise<{
    bookingNudged: number;
    bookingEscalated: number;
    preEventReminded: number;
    postEventNudged: number;
    postEventAlerted: number;
  }> {
    const a = await this.nudgeBookingConfirm();
    const b = await this.escalateBookingConfirm();
    const c = await this.remindPreEvent();
    const d = await this.nudgeAndAlertPostEvent();
    return {
      bookingNudged: a.nudged,
      bookingEscalated: b.escalated,
      preEventReminded: c.reminded,
      postEventNudged: d.nudged,
      postEventAlerted: d.alerted,
    };
  }

  // ── (a) nudgeBookingConfirm ────────────────────────────────────────────────
  // Outfitter hasn't confirmed and the accept deadline (paidAt +
  // BOOKING_CONFIRM_HOURS) is within ~24h but not yet past. One-shot outfitter
  // nudge, guarded by bookingConfirmNudgedAt. Deadline is DERIVED from paidAt
  // (bookingConfirmDeadlineAt may be NULL), expressed as a window on paidAt:
  //   now >= paidAt + (BOOKING_CONFIRM_HOURS − 24)h   AND   now <= paidAt + BOOKING_CONFIRM_HOURS
  // i.e. paidAt is in [now − 48h, now − 24h]. NO money moves.
  async nudgeBookingConfirm(): Promise<{ scanned: number; nudged: number }> {
    const now = new Date();
    // paidAt lower bound: the deadline hasn't passed yet → paidAt >= now − 48h.
    const paidAtFloor = new Date(now.getTime() - BOOKING_CONFIRM_HOURS * HOUR_MS);
    // paidAt upper bound: we're within the last 24h before the deadline →
    // paidAt <= now − (48 − 24)h = now − 24h.
    const paidAtCeil = new Date(
      now.getTime() - (BOOKING_CONFIRM_HOURS - 24) * HOUR_MS,
    );

    const due = await this.prisma.transaction.findMany({
      where: {
        shippingMethod: 'ON_SITE_SERVICE',
        paymentStatus: 'HELD',
        bookingConfirmedAt: null,
        bookingDeclinedAt: null,
        bookingConfirmNudgedAt: null,
        paidAt: { not: null, gte: paidAtFloor, lte: paidAtCeil },
      },
      include: {
        listing: { select: { title: true } },
        seller: {
          select: { email: true, firstName: true, lastName: true, phone: true },
        },
      },
      take: 100,
    });

    let nudged = 0;
    for (const tx of due) {
      try {
        // Stamp FIRST so a notify failure doesn't leave the row un-stamped and
        // re-nudge every hour; but a stamp then failed-notify is acceptable
        // (best-effort nudge, no money). Mirrors dispatchNudgeSeller ordering.
        await this.prisma.transaction.update({
          where: { id: tx.id },
          data: { bookingConfirmNudgedAt: now },
        });
        await this.notifications.experienceBookingConfirmNudgeOutfitter({
          sellerEmail: tx.seller.email,
          sellerName:
            [tx.seller.firstName, tx.seller.lastName].filter(Boolean).join(' ') ||
            'Outfitter',
          sellerPhone: tx.seller.phone,
          listingTitle: tx.listing.title,
          transactionId: tx.id,
          eventDate: tx.eventDate,
        });
        nudged++;
      } catch (err) {
        this.logger.warn(
          `experience booking nudge failed for ${tx.id}: ${(err as Error).message}`,
        );
      }
    }
    if (nudged > 0) {
      this.logger.log(`Experience booking-confirm nudges sent: ${nudged}`);
    }
    return { scanned: due.length, nudged };
  }

  // ── (b) escalateBookingConfirm ─────────────────────────────────────────────
  // Outfitter STILL hasn't confirmed and the deadline (paidAt +
  // BOOKING_CONFIRM_HOURS) is now PAST. One-shot urgent AdminAlert, guarded by
  // bookingConfirmEscalatedAt. NO auto-refund — admin decides (mirrors the DT /
  // collection sweeps: firearm/service logistics need human judgment).
  async escalateBookingConfirm(): Promise<{ scanned: number; escalated: number }> {
    const now = new Date();
    // Deadline passed → paidAt + 48h < now → paidAt < now − 48h.
    const paidAtCutoff = new Date(now.getTime() - BOOKING_CONFIRM_HOURS * HOUR_MS);

    const due = await this.prisma.transaction.findMany({
      where: {
        shippingMethod: 'ON_SITE_SERVICE',
        paymentStatus: 'HELD',
        bookingConfirmedAt: null,
        bookingDeclinedAt: null,
        bookingConfirmEscalatedAt: null,
        paidAt: { not: null, lt: paidAtCutoff },
      },
      select: {
        id: true,
        orderReference: true,
        buyerTotal: true,
        paidAt: true,
        eventDate: true,
        listing: { select: { title: true } },
        buyer: { select: { username: true } },
        seller: { select: { username: true } },
      },
      take: 100,
    });

    let escalated = 0;
    for (const tx of due) {
      try {
        const hrs = tx.paidAt
          ? Math.floor((now.getTime() - tx.paidAt.getTime()) / HOUR_MS)
          : BOOKING_CONFIRM_HOURS;
        const rand = 'R' + (tx.buyerTotal / 100).toFixed(2);
        // Alert + stamp in ONE $transaction — both commit or neither, so a
        // create failure rolls back the guard and the next run retries (never
        // a lost alert, never a duplicate). Mirrors alertStuckHeldFunds.
        await this.prisma.$transaction([
          this.prisma.adminAlert.create({
            data: {
              type: 'EXPERIENCE_BOOKING_UNCONFIRMED',
              referenceId: tx.id,
              urgent: true,
              context:
                `Experience booking ${tx.orderReference ?? tx.id.slice(-8).toUpperCase()} (${tx.listing.title}) — ` +
                `buyer @${tx.buyer?.username ?? '—'} paid ${rand} ${hrs}h ago but outfitter ` +
                `@${tx.seller?.username ?? '—'} never confirmed the booking (past the ${BOOKING_CONFIRM_HOURS}h window). ` +
                `Payment is HELD. Chase the outfitter or refund the buyer from the dossier — no auto-refund on this path.`,
            },
          }),
          this.prisma.transaction.update({
            where: { id: tx.id },
            data: { bookingConfirmEscalatedAt: now },
          }),
        ]);
        escalated++;
      } catch (err) {
        this.logger.warn(
          `experience booking escalation failed for ${tx.id}: ${(err as Error).message}`,
        );
      }
    }
    if (escalated > 0) {
      this.logger.log(
        `Experience booking-confirm escalations: alerted admin on ${escalated} booking(s)`,
      );
    }
    return { scanned: due.length, escalated };
  }

  // ── (c) remindPreEvent ─────────────────────────────────────────────────────
  // A CONFIRMED booking whose eventDate is within PRE_EVENT_REMINDER_DAYS and
  // still in the future. One-shot reminder to BOTH buyer + outfitter, guarded
  // by eventPreReminderSentAt. NO money moves.
  async remindPreEvent(): Promise<{ scanned: number; reminded: number }> {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + PRE_EVENT_REMINDER_DAYS * DAY_MS);

    const due = await this.prisma.transaction.findMany({
      where: {
        shippingMethod: 'ON_SITE_SERVICE',
        paymentStatus: 'HELD',
        bookingConfirmedAt: { not: null },
        eventCompletedConfirmedAt: null,
        eventPreReminderSentAt: null,
        // Still future, within the reminder window.
        eventDate: { not: null, gt: now, lte: windowEnd },
      },
      include: {
        listing: { select: { title: true } },
        buyer: {
          select: { email: true, firstName: true, username: true, phone: true },
        },
        seller: {
          select: { email: true, firstName: true, lastName: true, phone: true },
        },
      },
      take: 100,
    });

    let reminded = 0;
    for (const tx of due) {
      try {
        await this.prisma.transaction.update({
          where: { id: tx.id },
          data: { eventPreReminderSentAt: now },
        });
        // Buyer reminder.
        await this.notifications.experiencePreEventReminder({
          recipientEmail: tx.buyer.email,
          recipientName: tx.buyer.firstName ?? tx.buyer.username ?? 'there',
          recipientPhone: tx.buyer.phone,
          role: 'BUYER',
          listingTitle: tx.listing.title,
          transactionId: tx.id,
          eventDate: tx.eventDate,
        });
        // Outfitter reminder.
        await this.notifications.experiencePreEventReminder({
          recipientEmail: tx.seller.email,
          recipientName:
            [tx.seller.firstName, tx.seller.lastName].filter(Boolean).join(' ') ||
            'Outfitter',
          recipientPhone: tx.seller.phone,
          role: 'OUTFITTER',
          listingTitle: tx.listing.title,
          transactionId: tx.id,
          eventDate: tx.eventDate,
        });
        reminded++;
      } catch (err) {
        this.logger.warn(
          `experience pre-event reminder failed for ${tx.id}: ${(err as Error).message}`,
        );
      }
    }
    if (reminded > 0) {
      this.logger.log(`Experience pre-event reminders sent: ${reminded}`);
    }
    return { scanned: due.length, reminded };
  }

  // ── (d) nudgeAndAlertPostEvent ─────────────────────────────────────────────
  // Two stages, both one-shot, NO auto-release / auto-refund:
  //   Stage A — now > eventDate, buyer hasn't confirmed → buyer "confirm your
  //             hunt happened" nudge, guarded by eventCompletionNudgedAt.
  //   Stage B — now > (eventEndDate ?? eventDate) + POST_EVENT_CONFIRM_WINDOW_DAYS,
  //             still HELD + unconfirmed → urgent AdminAlert, guarded by
  //             adminAlertedForEventUnconfirmedAt (alert+stamp in one $transaction).
  // Both stages can fire for the same row across different runs; a row past the
  // window matches both filters in one run (nudge stamps, then alert stamps).
  async nudgeAndAlertPostEvent(): Promise<{
    scanned: number;
    nudged: number;
    alerted: number;
  }> {
    const now = new Date();

    // Stage A — buyer nudge (event date passed, not yet confirmed, not nudged).
    const toNudge = await this.prisma.transaction.findMany({
      where: {
        shippingMethod: 'ON_SITE_SERVICE',
        paymentStatus: 'HELD',
        eventCompletedConfirmedAt: null,
        eventCompletionNudgedAt: null,
        eventDate: { not: null, lt: now },
      },
      include: {
        listing: { select: { title: true } },
        buyer: {
          select: { email: true, firstName: true, username: true, phone: true },
        },
      },
      take: 100,
    });

    let nudged = 0;
    for (const tx of toNudge) {
      try {
        await this.prisma.transaction.update({
          where: { id: tx.id },
          data: { eventCompletionNudgedAt: now },
        });
        await this.notifications.experiencePostEventConfirmNudgeBuyer({
          buyerEmail: tx.buyer.email,
          buyerName: tx.buyer.firstName ?? tx.buyer.username ?? 'there',
          buyerPhone: tx.buyer.phone,
          listingTitle: tx.listing.title,
          transactionId: tx.id,
        });
        nudged++;
      } catch (err) {
        this.logger.warn(
          `experience post-event nudge failed for ${tx.id}: ${(err as Error).message}`,
        );
      }
    }

    // Stage B — admin alert once the confirm window has lapsed. The window runs
    // from (eventEndDate ?? eventDate). Prisma can't express COALESCE in a
    // filter, so gate on eventDate (always present for a booked experience) and
    // re-check the eventEndDate-aware boundary in-code before alerting.
    const eventDateCutoff = new Date(
      now.getTime() - POST_EVENT_CONFIRM_WINDOW_DAYS * DAY_MS,
    );
    const maybeAlert = await this.prisma.transaction.findMany({
      where: {
        shippingMethod: 'ON_SITE_SERVICE',
        paymentStatus: 'HELD',
        eventCompletedConfirmedAt: null,
        adminAlertedForEventUnconfirmedAt: null,
        // eventDate past the window is a NECESSARY (not sufficient) condition —
        // if eventEndDate is later, the in-code check below rejects it.
        eventDate: { not: null, lt: eventDateCutoff },
      },
      select: {
        id: true,
        orderReference: true,
        buyerTotal: true,
        eventDate: true,
        eventEndDate: true,
        listing: { select: { title: true } },
        buyer: { select: { username: true } },
        seller: { select: { username: true } },
      },
      take: 100,
    });

    let alerted = 0;
    for (const tx of maybeAlert) {
      // Window is measured from the LATER of eventEndDate / eventDate.
      const effectiveEnd = tx.eventEndDate ?? tx.eventDate;
      if (!effectiveEnd) continue;
      const windowCloses = new Date(
        effectiveEnd.getTime() + POST_EVENT_CONFIRM_WINDOW_DAYS * DAY_MS,
      );
      if (now.getTime() <= windowCloses.getTime()) continue; // not yet past

      try {
        const rand = 'R' + (tx.buyerTotal / 100).toFixed(2);
        const daysPast = Math.max(
          0,
          Math.floor((now.getTime() - effectiveEnd.getTime()) / DAY_MS),
        );
        await this.prisma.$transaction([
          this.prisma.adminAlert.create({
            data: {
              type: 'EXPERIENCE_EVENT_UNCONFIRMED',
              referenceId: tx.id,
              urgent: true,
              context:
                `Experience booking ${tx.orderReference ?? tx.id.slice(-8).toUpperCase()} (${tx.listing.title}) — ` +
                `the event ended ${daysPast}d ago but buyer @${tx.buyer?.username ?? '—'} never confirmed it happened. ` +
                `${rand} still HELD; outfitter @${tx.seller?.username ?? '—'} unpaid. ` +
                `Review + release or refund manually from the dossier — no auto-release / auto-refund on this path.`,
            },
          }),
          this.prisma.transaction.update({
            where: { id: tx.id },
            data: { adminAlertedForEventUnconfirmedAt: now },
          }),
        ]);
        alerted++;
      } catch (err) {
        this.logger.warn(
          `experience post-event alert failed for ${tx.id}: ${(err as Error).message}`,
        );
      }
    }

    if (nudged > 0 || alerted > 0) {
      this.logger.log(
        `Experience post-event sweep: nudged ${nudged} buyer(s), alerted admin on ${alerted} booking(s)`,
      );
    }
    return { scanned: toNudge.length + maybeAlert.length, nudged, alerted };
  }
}
