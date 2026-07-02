import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SubscriptionTier } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService, FLAGS } from '../settings/settings.service';
import { ReferenceNumberService } from '../common/reference-number.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ZohoBooksService } from '../zoho/zoho-books.service';
import {
  PAYMENT_MODE,
  GG_BANK_DETAILS,
} from '../payments/transactions.service';

/**
 * P1.1 — MEMBER/PRO subscription billing on the manual-EFT rail.
 *
 * PREPAID model (CPA-clean: no debit order, no fixed-term lock-in):
 *   1. Member picks a tier → we allocate an SB-prefixed EFT reference on a
 *      PENDING SubscriptionCharge (24h pay-by window) and show the bank
 *      details — exactly the manual-checkout pattern buyers already know.
 *   2. The inContact scan / FNB statement reconciliation matches the
 *      reference → confirmPayment() activates the tier for 31 days
 *      (User.subscriptionTier is the hot-path perk read). Renewing the
 *      SAME tier before expiry STACKS from the current period end, so
 *      paying early never costs days.
 *   3. No auto-renew on this rail: a daily sweep reminds 3 days out,
 *      then downgrades to FREE at expiry. "Cancel" = simply don't renew.
 *   Admin comp grants (billingCycle 'comp') are never touched by the
 *   sweep — the operator's own PRO stays put.
 *
 * When the card paygate lands (Ivori/Peach), recurring billing replaces
 * this lane; the Subscription/SubscriptionCharge rows carry over as-is.
 */

const PAY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h to EFT
const PERIOD_DAYS = 31;
const REMINDER_DAYS_BEFORE = 3;

const PAID_TIERS: SubscriptionTier[] = ['MEMBER', 'PRO'];

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly referenceNumbers: ReferenceNumberService,
    private readonly notifications: NotificationsService,
    private readonly zohoBooks: ZohoBooksService,
  ) {}

  async pricing() {
    const [memberCents, proCents] = await Promise.all([
      this.settings.get(FLAGS.subscriptionMemberPriceCents),
      this.settings.get(FLAGS.subscriptionProPriceCents),
    ]);
    return { memberCents, proCents, periodDays: PERIOD_DAYS };
  }

  private async priceFor(tier: SubscriptionTier): Promise<number> {
    const p = await this.pricing();
    return tier === 'PRO' ? p.proCents : p.memberCents;
  }

  /** Current tier + period + any open (payable) charge for the member. */
  async getMine(clerkId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true, subscriptionTier: true },
    });
    if (!user) throw new ForbiddenException('User not synced');
    const sub = await this.prisma.subscription.findUnique({
      where: { userId: user.id },
      select: {
        tier: true,
        status: true,
        billingCycle: true,
        currentPeriodEnd: true,
      },
    });
    const pending = await this.prisma.subscriptionCharge.findFirst({
      where: {
        subscription: { userId: user.id },
        status: 'PENDING',
        payByAt: { gt: new Date() },
      },
      orderBy: { chargedAt: 'desc' },
      select: {
        id: true,
        orderReference: true,
        amountCents: true,
        payByAt: true,
        tierPurchased: true,
        detectedAt: true,
      },
    });
    return {
      tier: user.subscriptionTier,
      isComp: sub?.billingCycle === 'comp',
      periodEnd:
        user.subscriptionTier !== 'FREE'
          ? sub?.currentPeriodEnd?.toISOString() ?? null
          : null,
      pending: pending
        ? {
            reference: pending.orderReference,
            amountCents: pending.amountCents,
            payByAt: pending.payByAt?.toISOString() ?? null,
            tier: pending.tierPurchased,
            detected: !!pending.detectedAt,
          }
        : null,
      pricing: await this.pricing(),
      bankDetails: GG_BANK_DETAILS,
    };
  }

  /**
   * Start (or resume) a tier purchase: returns the EFT instructions.
   * Idempotent per open window — a second click returns the SAME
   * reference instead of allocating a fresh one.
   */
  async checkout(clerkId: string, tierRaw: string) {
    if (PAYMENT_MODE !== 'manual') {
      throw new BadRequestException(
        'Subscriptions are currently available via EFT only.',
      );
    }
    const tier = tierRaw as SubscriptionTier;
    if (!PAID_TIERS.includes(tier)) {
      throw new BadRequestException('Choose MEMBER or PRO.');
    }
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true, isBanned: true, subscriptionTier: true },
    });
    if (!user) throw new ForbiddenException('User not synced');
    if (user.isBanned) throw new ForbiddenException('Account is suspended');

    const amountCents = await this.priceFor(tier);

    // One Subscription row per user. First purchase creates a PLACEHOLDER
    // (period already in the past ⇒ carries no entitlement) — the tier on
    // User only changes when a charge is CONFIRMED.
    const now = new Date();
    const sub = await this.prisma.subscription.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        tier,
        status: 'SUSPENDED', // nothing active until a charge succeeds
        billingCycle: 'monthly-eft',
        amountCents,
        currentPeriodStart: now,
        currentPeriodEnd: now, // placeholder — set by confirmPayment
      },
      update: {}, // never clobber an ACTIVE (or comp) row at checkout time
    });

    // Resume an open charge for the SAME tier instead of stacking refs.
    const open = await this.prisma.subscriptionCharge.findFirst({
      where: {
        subscriptionId: sub.id,
        status: 'PENDING',
        tierPurchased: tier,
        payByAt: { gt: now },
      },
      orderBy: { chargedAt: 'desc' },
    });
    if (open) {
      return this.instructions(open.orderReference!, open.amountCents, open.payByAt!, tier);
    }

    const orderReference =
      await this.referenceNumbers.allocateOrderReference('SUBSCRIPTION');
    const payByAt = new Date(now.getTime() + PAY_WINDOW_MS);
    await this.prisma.subscriptionCharge.create({
      data: {
        subscriptionId: sub.id,
        amountCents,
        status: 'PENDING',
        orderReference,
        payByAt,
        tierPurchased: tier,
        periodDays: PERIOD_DAYS,
      },
    });
    this.logger.log(
      `Subscription checkout: user ${user.id} → ${tier} R${(amountCents / 100).toFixed(2)} ref ${orderReference}`,
    );
    return this.instructions(orderReference, amountCents, payByAt, tier);
  }

  private instructions(
    reference: string,
    amountCents: number,
    payByAt: Date,
    tier: SubscriptionTier,
  ) {
    return {
      manual: true as const,
      reference,
      amountCents,
      payByAt: payByAt.toISOString(),
      tier,
      periodDays: PERIOD_DAYS,
      bankDetails: GG_BANK_DETAILS,
    };
  }

  /**
   * Activate the tier for a matched EFT. Called by BOTH the inContact
   * detection and the statement reconciliation — idempotent via the
   * atomic PENDING→SUCCEEDED claim. Subscriptions are low-value,
   * zero-COGS digital perks, so (unlike goods) we activate on the
   * provisional inContact match too: the member shouldn't sit on FREE
   * for a day after paying. A fabricated alert risks only perk access,
   * never held funds.
   */
  async confirmPayment(chargeId: string): Promise<void> {
    const now = new Date();
    const result = await this.prisma.$transaction(async (txc) => {
      const claim = await txc.subscriptionCharge.updateMany({
        where: { id: chargeId, status: 'PENDING' },
        data: { status: 'SUCCEEDED', chargedAt: now, detectedAt: now },
      });
      if (claim.count === 0) return null; // already confirmed / failed

      const charge = await txc.subscriptionCharge.findUnique({
        where: { id: chargeId },
        include: { subscription: { include: { user: { select: { id: true, subscriptionTier: true } } } } },
      });
      if (!charge?.tierPurchased) return null;
      const sub = charge.subscription;
      const tier = charge.tierPurchased;

      // Same-tier renewal before expiry STACKS from the current period
      // end; anything else (first purchase, upgrade, lapsed renewal)
      // starts a fresh period from now.
      const stacks =
        sub.user.subscriptionTier === tier && sub.currentPeriodEnd > now;
      const periodStart = stacks ? sub.currentPeriodEnd : now;
      const periodEnd = new Date(
        periodStart.getTime() + charge.periodDays * 24 * 3600 * 1000,
      );

      await txc.subscription.update({
        where: { id: sub.id },
        data: {
          tier,
          status: 'ACTIVE',
          billingCycle: 'monthly-eft',
          amountCents: charge.amountCents,
          currentPeriodStart: stacks ? sub.currentPeriodStart : now,
          currentPeriodEnd: periodEnd,
          lastChargeAt: now,
          failedChargeCount: 0,
          renewalReminderAt: null,
          cancelAtPeriodEnd: false,
        },
      });
      await txc.user.update({
        where: { id: sub.user.id },
        data: { subscriptionTier: tier },
      });
      return { userId: sub.user.id, tier, periodEnd, amountCents: charge.amountCents };
    });

    if (!result) return;
    this.logger.log(
      `Subscription ACTIVATED: user ${result.userId} → ${result.tier} until ${result.periodEnd.toISOString()}`,
    );
    void this.zohoBooks.createSubscriptionSalesReceipt(chargeId);
    void this.notifySubscriptionActivated(result.userId, result.tier, result.periodEnd);
  }

  private async notifySubscriptionActivated(
    userId: string,
    tier: SubscriptionTier,
    periodEnd: Date,
  ) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, firstName: true, phone: true },
      });
      if (!user) return;
      await this.notifications.subscriptionActivated({
        email: user.email,
        name: user.firstName ?? 'there',
        phone: user.phone,
        tier,
        periodEnd,
      });
    } catch (err) {
      this.logger.warn(`subscription notify failed: ${(err as Error).message}`);
    }
  }

  /**
   * Daily sweep (also safe hourly): fail lapsed PENDING charges, remind
   * members expiring within 3 days, downgrade expired prepaid periods.
   * comp accounts (admin grants) are never touched.
   */
  async sweep(): Promise<{ failedCharges: number; reminded: number; lapsed: number }> {
    const now = new Date();
    // (1) PENDING charges past their pay-by window → FAILED. A payment
    // arriving after this surfaces as EXPIRED in the reconciler queue
    // (admin refunds / re-activates manually) — mirrors goods orders.
    const failed = await this.prisma.subscriptionCharge.updateMany({
      where: { status: 'PENDING', payByAt: { not: null, lt: now } },
      data: { status: 'FAILED', errorMessage: 'EFT pay-by window lapsed' },
    });

    // (2) Renewal reminder 3 days before the prepaid period ends.
    const remindBefore = new Date(now.getTime() + REMINDER_DAYS_BEFORE * 24 * 3600 * 1000);
    const dueReminders = await this.prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        billingCycle: 'monthly-eft',
        renewalReminderAt: null,
        currentPeriodEnd: { gt: now, lte: remindBefore },
      },
      include: { user: { select: { email: true, firstName: true, phone: true } } },
      take: 100,
    });
    for (const s of dueReminders) {
      await this.prisma.subscription.update({
        where: { id: s.id },
        data: { renewalReminderAt: now },
      });
      void this.notifications
        .subscriptionExpiring({
          email: s.user.email,
          name: s.user.firstName ?? 'there',
          phone: s.user.phone,
          tier: s.tier,
          periodEnd: s.currentPeriodEnd,
        })
        .catch(() => undefined);
    }

    // (3) Expired prepaid periods → downgrade to FREE. Atomic per row so
    // a concurrent renewal (confirmPayment moved currentPeriodEnd
    // forward) is never clobbered — the WHERE re-checks expiry.
    const expired = await this.prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        billingCycle: 'monthly-eft',
        currentPeriodEnd: { lt: now },
      },
      include: { user: { select: { id: true, email: true, firstName: true, phone: true, subscriptionTier: true } } },
      take: 100,
    });
    let lapsed = 0;
    for (const s of expired) {
      const claim = await this.prisma.subscription.updateMany({
        where: { id: s.id, status: 'ACTIVE', currentPeriodEnd: { lt: now } },
        data: { status: 'SUSPENDED' },
      });
      if (claim.count === 0) continue; // renewed in the gap
      await this.prisma.user.update({
        where: { id: s.user.id },
        data: { subscriptionTier: 'FREE' },
      });
      lapsed += 1;
      this.logger.log(`Subscription lapsed: user ${s.user.id} (${s.tier} → FREE)`);
      void this.notifications
        .subscriptionLapsed({
          email: s.user.email,
          name: s.user.firstName ?? 'there',
          phone: s.user.phone,
          tier: s.tier,
        })
        .catch(() => undefined);
    }
    return { failedCharges: failed.count, reminded: dueReminders.length, lapsed };
  }
}
