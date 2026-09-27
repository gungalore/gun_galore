import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { PrismaService } from '../prisma/prisma.service';
import { FLAGS, SettingsService } from '../settings/settings.service';
import { LicenceTrackerService } from './licence-tracker.service';

/**
 * The SAPS tracker's admin surface — /api/admin/licence-tracker.
 *
 * `AdminJwtGuard` opens safe methods to any active admin and reserves every
 * mutating one for a SUPERADMIN, so "Check all now" is superadmin-only
 * without this file saying so.
 *
 * ⚠️ NO REFERENCE OR SERIAL IS EVER RETURNED FROM HERE. The counts are the
 * point; a list of members' application numbers on an admin screen is the
 * one thing this table encrypts them to avoid.
 */
@Controller('admin/licence-tracker')
@UseGuards(AdminJwtGuard)
export class LicenceTrackerAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tracker: LicenceTrackerService,
    private readonly settings: SettingsService,
  ) {}

  /** Is the thing on, and how much of it is there. */
  @Get('health')
  async health() {
    const [
      enabled,
      sweepEnabled,
      active,
      watching,
      errors,
      noRecords,
      events,
      changedLast24h,
      lastChecked,
    ] = await Promise.all([
      this.settings.get(FLAGS.licenceTrackerEnabled),
      this.settings.get(FLAGS.licenceTrackerSweepEnabled),
      this.prisma.trackedApplication.count({ where: { active: true } }),
      this.prisma.trackedApplication.count(),
      this.prisma.trackedApplication.count({
        where: { active: true, lastOutcome: 'error' },
      }),
      this.prisma.trackedApplication.count({
        where: { active: true, lastOutcome: 'no_records' },
      }),
      this.prisma.trackedApplicationEvent.count(),
      this.prisma.trackedApplicationEvent.count({
        where: {
          source: 'SAPS',
          observedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
      this.prisma.trackedApplication.findFirst({
        where: { lastCheckedAt: { not: null } },
        orderBy: { lastCheckedAt: 'desc' },
        select: { lastCheckedAt: true },
      }),
    ]);

    return {
      enabled,
      sweepEnabled,
      active,
      total: watching,
      // ⚠️ `errors` AND `noRecords` ARE NOT THE SAME PROBLEM and must not be
      // summed. `errors` is us being blind (a block page, a redesign) and is
      // the number worth looking at; `no_records` is SAPS answering that it
      // holds nothing, which is a normal state for a reference just lodged.
      errors,
      noRecords,
      events,
      changedLast24h,
      lastCheckedAt: lastChecked?.lastCheckedAt ?? null,
    };
  }

  /**
   * Run the weekly sweep now.
   *
   * ⚠️ THIS IS THE ONLY WAY THE SWEEP IS TESTABLE without waiting for Sunday
   * morning, and it is deliberately NOT gated on `licence_tracker_sweep_enabled`
   * — the flag exists to keep the SCHEDULED job quiet, and an admin who has
   * asked for a pass by hand has already made that decision. It is still
   * SUPERADMIN-only. It refuses a second concurrent run inside the service.
   */
  @Post('check-all')
  @HttpCode(200)
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  async checkAll() {
    return this.tracker.sweep();
  }
}
