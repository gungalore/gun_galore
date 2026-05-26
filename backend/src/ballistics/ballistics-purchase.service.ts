import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PeachService } from '../payments/peach.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ZohoBooksService } from '../zoho/zoho-books.service';
import { AdminAuditService } from '../admin/admin-audit.service';

/**
 * R299 one-off lifetime purchase that unlocks the standalone
 * Ballistic Calculator PWA at ballistics.gungalore.co.za.
 *
 * Why a separate service from SubscriptionsService:
 *   - This is a one-off, not a recurring billing. Peach `createCheckout`
 *     is enough — no need for the BANVR tokenisation pipeline that
 *     gates recurring subscriptions.
 *   - The license lives on a single User column
 *     (`ballisticsPurchasedAt`), not a Subscription row. No period
 *     boundaries, no charge retries, no cancel-at-period-end logic.
 *   - Refund flow is admin-only — operator unsets the column +
 *     fires Peach refund via existing `refundPayment`.
 *
 * Public-facing entry points:
 *   - createCheckout(clerkId): redirect URL to Peach widget
 *   - applyVerifiedPayment(...): called from /api/payments/webhook/peach
 *     when a payment with the ballistics merchantTransactionId prefix
 *     completes successfully
 *   - refundForUser(...): admin override — clears the license + fires
 *     Peach refund + Zoho credit note. Requires AdminAuditEvent.
 */
const PRICE_CENTS = 29900;
const MERCHANT_TX_PREFIX = 'BAL-';

@Injectable()
export class BallisticsPurchaseService {
  private readonly logger = new Logger(BallisticsPurchaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly peach: PeachService,
    private readonly notifications: NotificationsService,
    private readonly zoho: ZohoBooksService,
    private readonly audit: AdminAuditService,
  ) {}

  /**
   * Start a checkout. Returns the Peach widget config the frontend
   * loads on `/ballistics/purchase`. The user pays, Peach POSTs to
   * the standard payments webhook, and `applyVerifiedPayment` below
   * sees the `BAL-` prefix and grants the license.
   */
  async createCheckout(clerkId: string): Promise<{
    checkoutId: string;
    widgetScriptUrl: string;
    merchantTransactionId: string;
    amountCents: number;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: {
        id: true,
        email: true,
        ballisticsPurchasedAt: true,
      },
    });
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    if (user.ballisticsPurchasedAt) {
      throw new BadRequestException({
        message: 'You already own the Ballistic Calculator.',
        code: 'ballistics-already-purchased',
      });
    }

    // Merchant TX ID format: BAL-<userId>-<8-char nonce>. The prefix
    // lets the payments webhook route the result back to this service
    // without storing a pending-purchase row. Nonce prevents two
    // simultaneous tabs from overwriting each other's payment.
    const nonce = Math.random().toString(36).slice(2, 10);
    const merchantTransactionId = `${MERCHANT_TX_PREFIX}${user.id}-${nonce}`;

    const frontendBase =
      process.env.FRONTEND_URL ?? 'https://gungalore.co.za';
    const shopperResultUrl = `${frontendBase}/ballistics/purchase?status=processing&tx=${merchantTransactionId}`;

    // Route the Peach server-to-server webhook to our own handler so
    // the marketplace TransactionsService doesn't see a "BAL-..."
    // merchantTransactionId and warn about an unknown transaction.
    const backendBase =
      process.env.BACKEND_URL ?? 'http://localhost:3001';
    const checkout = await this.peach.createCheckout({
      amountZarCents: PRICE_CENTS,
      merchantTransactionId,
      shopperResultUrl,
      shopperEmail: user.email,
      description: 'Gun Galore Ballistic Calculator — Lifetime License',
      notificationUrl: `${backendBase}/api/ballistics/webhook/peach`,
    });

    return {
      ...checkout,
      merchantTransactionId,
      amountCents: PRICE_CENTS,
    };
  }

  /**
   * Called from the payments webhook (PaymentsController.peachWebhook)
   * when a verified Peach payment lands AND the merchantTransactionId
   * starts with our BAL- prefix. Idempotent — if the user already has
   * `ballisticsPurchasedAt` set, just verifies the peachPaymentId is
   * recorded and returns.
   */
  async applyVerifiedPayment(opts: {
    merchantTransactionId: string;
    peachPaymentId: string;
    amountCents: number;
  }): Promise<void> {
    const { merchantTransactionId, peachPaymentId, amountCents } = opts;
    if (!merchantTransactionId.startsWith(MERCHANT_TX_PREFIX)) return;

    // Parse userId from "BAL-<userId>-<nonce>".
    const body = merchantTransactionId.slice(MERCHANT_TX_PREFIX.length);
    const lastDash = body.lastIndexOf('-');
    const userId = lastDash > 0 ? body.slice(0, lastDash) : body;
    if (!userId) {
      this.logger.warn(
        `Malformed ballistics merchant tx id: ${merchantTransactionId}`,
      );
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        ballisticsPurchasedAt: true,
        ballisticsPurchasePeachId: true,
      },
    });
    if (!user) {
      this.logger.warn(
        `Ballistics payment ${peachPaymentId}: user ${userId} not found`,
      );
      return;
    }
    if (user.ballisticsPurchasedAt) {
      // Already granted — duplicate webhook, no-op.
      this.logger.log(
        `Ballistics license already granted to user ${userId}; ignoring duplicate webhook ${peachPaymentId}`,
      );
      return;
    }

    // Set the license. Single atomic update.
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ballisticsPurchasedAt: new Date(),
        ballisticsPurchasePeachId: peachPaymentId,
        ballisticsPurchaseAmountCents: amountCents,
      },
    });

    // Fire the in-app notification + email confirmation.
    try {
      await this.notifications.persist({
        userId,
        type: 'BALLISTICS_LICENSE_ACTIVATED',
        category: 'ACCOUNT',
        title: 'Ballistic Calculator unlocked',
        body: `Lifetime license activated — open ballistics.gungalore.co.za to use the full calculator, AI bullet lookup, and Spot Tracker.`,
        url: 'https://ballistics.gungalore.co.za/ballistics',
        dismissible: true,
      });
    } catch (err) {
      // Don't fail the webhook on a notify error — license is granted.
      this.logger.warn(
        `Ballistics notify failed for user ${userId}: ${err instanceof Error ? err.message : err}`,
      );
    }

    // Sales receipt to Zoho Books. Same pattern raffle tickets use —
    // sync best-effort, log+retry-from-admin on failure (the existing
    // Zoho retry queue picks it up).
    try {
      await this.zoho.createBallisticsLicenseSalesReceipt({
        userId,
        peachPaymentId,
        amountCents,
      });
    } catch (err) {
      this.logger.warn(
        `Ballistics Zoho receipt failed for user ${userId} (will retry via admin): ${
          err instanceof Error ? err.message : err
        }`,
      );
    }

    this.logger.log(
      `Ballistics license granted to user ${userId} (Peach ${peachPaymentId}, R${(amountCents / 100).toFixed(2)})`,
    );
  }

  /**
   * Admin-only refund / license revocation. Clears the license,
   * fires Peach refund, records an audit event with mandatory reason.
   * Used when a buyer disputes the purchase or operator manually
   * grants then needs to roll back.
   */
  async refundForUser(opts: {
    userId: string;
    adminUserId: string;
    reason: string;
  }): Promise<void> {
    const { userId, adminUserId, reason } = opts;
    if (!reason || reason.trim().length < 10) {
      throw new BadRequestException(
        'Refund reason is required (≥ 10 characters).',
      );
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        ballisticsPurchasedAt: true,
        ballisticsPurchasePeachId: true,
        ballisticsPurchaseAmountCents: true,
      },
    });
    if (!user) throw new NotFoundException('User not found.');
    if (!user.ballisticsPurchasedAt) {
      throw new BadRequestException('User has no active ballistics license.');
    }

    // Try the Peach refund first — if it fails we still want to know
    // before clearing the license. Falls back gracefully when the
    // payment ID isn't on file (manual grant case).
    if (user.ballisticsPurchasePeachId) {
      const result = await this.peach.refundPayment(
        user.ballisticsPurchasePeachId,
        user.ballisticsPurchaseAmountCents ?? PRICE_CENTS,
      );
      if (!result.success) {
        throw new BadRequestException(
          `Peach refund failed: ${result.resultCode ?? 'unknown'} ${result.message ?? ''}`,
        );
      }
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ballisticsPurchasedAt: null,
        ballisticsPurchasePeachId: null,
        ballisticsPurchaseAmountCents: null,
      },
    });

    await this.audit.record({
      adminUserId,
      action: 'BALLISTICS_LICENSE_REFUNDED',
      resourceType: 'User',
      resourceId: userId,
      oldValue: { ballisticsPurchasedAt: user.ballisticsPurchasedAt },
      newValue: { ballisticsPurchasedAt: null },
      reason,
    });

    try {
      await this.notifications.persist({
        userId,
        type: 'BALLISTICS_LICENSE_REVOKED',
        category: 'ACCOUNT',
        title: 'Ballistic Calculator license refunded',
        body: 'Your purchase has been refunded. The calculator is back in demo mode.',
        dismissible: true,
      });
    } catch (err) {
      this.logger.warn(
        `Refund notify failed for ${userId}: ${err instanceof Error ? err.message : err}`,
      );
    }

    // Best-effort Zoho credit note.
    try {
      await this.zoho.createBallisticsLicenseCreditNote({
        userId,
        peachPaymentId: user.ballisticsPurchasePeachId ?? '',
        amountCents: user.ballisticsPurchaseAmountCents ?? PRICE_CENTS,
        reason,
      });
    } catch (err) {
      this.logger.warn(
        `Ballistics Zoho credit-note failed for ${userId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * Returns true when the user has paid + still owns the license.
   * Centralised so the controller can gate `assertCanLookupBullet`,
   * profile CRUD, and any other purchaser-only endpoint without
   * duplicating the column read.
   */
  async hasLicense(clerkId: string): Promise<boolean> {
    const u = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { ballisticsPurchasedAt: true },
    });
    return !!u?.ballisticsPurchasedAt;
  }

  async requireLicense(clerkId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true, ballisticsPurchasedAt: true },
    });
    if (!u) throw new NotFoundException('User not found.');
    if (!u.ballisticsPurchasedAt) {
      throw new ForbiddenException({
        message:
          'Buy the lifetime license (R299) to use this feature — unlocks the full calculator + AI lookup forever.',
        code: 'ballistics-not-purchased',
        priceCents: PRICE_CENTS,
      });
    }
    return u.id;
  }
}
