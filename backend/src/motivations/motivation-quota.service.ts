import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService, FLAGS } from '../settings/settings.service';

// ────────────────────────────────────────────────────────────────────
// The three gates in front of every motivation: is the module on, has this
// applicant already got one of this type, and is there a free-beta seat left.
//
// Kept out of MotivationsService so the concurrency-critical part is small
// enough to reason about and testable on its own.
// ────────────────────────────────────────────────────────────────────

/** ReferenceCounter row that tallies free-beta seats. Not a listing prefix. */
const BETA_COUNTER_PREFIX = 'MOBETA';

export interface MotivationQuotaStatus {
  enabled: boolean;
  freeRemaining: number;
  cap: number;
  used: number;
  priceCents: number;
  /** False while payments are off AND the free cap is exhausted. */
  canStart: boolean;
}

@Injectable()
export class MotivationQuotaService {
  private readonly logger = new Logger(MotivationQuotaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Master switch. Reads fail OPEN to the default, which is why it is false. */
  async isEnabled(): Promise<boolean> {
    return this.settings.get(FLAGS.motivationWriterEnabled);
  }

  /**
   * Gate every service method on this, not the controller — so the cron, the
   * admin path and the HTTP path are all covered by one check.
   *
   * 404 rather than 403: with the module off it should not be discoverable
   * that it exists at all.
   */
  async assertEnabled(): Promise<void> {
    if (!(await this.isEnabled())) {
      throw new NotFoundException('Not found');
    }
  }

  /** What the frontend needs to render the entry point and the quota pill. */
  async status(): Promise<MotivationQuotaStatus> {
    // One round trip per flag — SettingsService.get() has no cache, so these
    // are batched rather than awaited in sequence.
    const [enabled, cap, priceCents] = await Promise.all([
      this.settings.get(FLAGS.motivationWriterEnabled),
      this.settings.get(FLAGS.motivationBetaFreeCap),
      this.settings.get(FLAGS.motivationPriceCents),
    ]);

    const used = await this.seatsTaken();
    const freeRemaining = Math.max(0, cap - used);

    return {
      enabled,
      cap,
      used,
      freeRemaining,
      priceCents,
      // Payments are not live, so once the free seats are gone nobody can
      // start one. When the paygate lands this becomes `enabled` and the
      // charge happens instead.
      canStart: enabled && freeRemaining > 0,
    };
  }

  /**
   * Claim a free-beta seat. Returns the seat number, or null when the cap is
   * exhausted.
   *
   * WHY IT LOOKS LIKE THIS. The obvious implementation — count the rows, compare
   * to the cap, then insert — is a race: two generations starting at the same
   * moment both read 99 against a cap of 100 and both go free. At R199 a seat
   * that is small change; the same shape on a bigger number is not.
   *
   * So the increment IS the claim. A single atomic upsert bumps the counter and
   * returns the new value; if that value is over the cap the caller does not get
   * a seat. The seat is BURNED rather than reissued, deliberately: reusing it
   * would mean reading the counter back down, which reopens the race we just
   * closed. The cost is that a handful of numbers can be skipped; the benefit is
   * that the cap can never be exceeded, whatever the concurrency.
   *
   * The tally deliberately does NOT live in the Setting table: SettingsService
   * writes are a plain last-write-wins upsert with no atomic increment.
   */
  async claimBetaSeat(cap: number): Promise<number | null> {
    const row = await this.prisma.referenceCounter.upsert({
      where: { prefix: BETA_COUNTER_PREFIX },
      create: { prefix: BETA_COUNTER_PREFIX, count: 1 },
      update: { count: { increment: 1 } },
    });
    if (row.count > cap) {
      // Over the line. The seat number is spent and will not be handed out
      // again — see above.
      return null;
    }
    return row.count;
  }

  /**
   * Hand a seat back after a failed generation.
   *
   * The counter is normally monotonic — that is what makes the cap race-proof
   * (see claimBetaSeat). This is the ONE sanctioned decrement, and it is
   * narrow on purpose: it runs only when a generation that claimed a seat then
   * failed before producing anything. The applicant got no document, so they
   * must not lose their place in the beta because Anthropic was down.
   *
   * It cannot go below zero, and it is best-effort: losing a decrement costs
   * one seat out of the cap, while a wrong decrement would hand out a free
   * motivation. If this ever has to be wrong, it should be wrong in the
   * direction of us paying, not the applicant.
   */
  async releaseBetaSeat(): Promise<void> {
    await this.prisma.referenceCounter.updateMany({
      where: { prefix: BETA_COUNTER_PREFIX, count: { gt: 0 } },
      data: { count: { decrement: 1 } },
    });
  }

  /**
   * Seats issued so far. Reads the counter, NOT a row count: rows can be
   * deleted (POPIA erasure, admin void) and the counter must not go backwards,
   * or a deletion would silently hand out a free motivation.
   */
  async seatsTaken(): Promise<number> {
    const row = await this.prisma.referenceCounter.findUnique({
      where: { prefix: BETA_COUNTER_PREFIX },
    });
    return row?.count ?? 0;
  }
}
