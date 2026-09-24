import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ShippingService } from './shipping.service';
import { toShippingStatus, STATUS_LABEL } from './status-map';

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shipping: ShippingService,
  ) {}

  // ------------------------------------------------------------------
  // Record an INTERNAL milestone. Called from TransactionsService at
  // each lifecycle hook. Idempotent — the @@unique(transactionId,
  // status, occurredAt) tuple stops duplicate inserts if the same hook
  // fires twice (e.g. webhook + verifyResult both landing). When the
  // collapsed status maps to a Prisma ShippingStatus enum value, the
  // Transaction.shippingStatus column is rolled forward in lockstep
  // via the existing applyShippingUpdate() helper (handles back-step
  // rejection + buyer notification side-effects).
  // ------------------------------------------------------------------
  async recordInternal(
    transactionId: string,
    status: string,
    opts: { message?: string; occurredAt?: Date } = {},
  ): Promise<void> {
    const occurredAt = opts.occurredAt ?? new Date();
    try {
      await this.prisma.trackingEvent.create({
        data: {
          transactionId,
          status,
          rawStatus: null,
          source: 'INTERNAL',
          message: opts.message ?? STATUS_LABEL[status] ?? null,
          occurredAt,
        },
      });
    } catch (err) {
      // P2002 = unique constraint violation = same event already logged.
      // Anything else gets surfaced via the warn log; we don't throw
      // because tracking is non-critical to the parent business action.
      const code = (err as { code?: string }).code;
      if (code !== 'P2002') {
        this.logger.warn(
          `recordInternal(${transactionId}, ${status}) failed: ${(err as Error).message}`,
        );
      }
    }

    // Mirror to Transaction.shippingStatus when applicable.
    const collapsedToPrisma = toShippingStatus(status);
    if (collapsedToPrisma) {
      await this.shipping
        .applyShippingUpdate(transactionId, collapsedToPrisma)
        .catch((err) =>
          this.logger.warn(
            `applyShippingUpdate(${transactionId}, ${collapsedToPrisma}) failed: ${(err as Error).message}`,
          ),
        );
    }
  }

  // ------------------------------------------------------------------
  // Buyer/seller-facing timeline for /transactions/[id]. Authorises
  // against the same buyer-or-seller rule the rest of the transaction
  // endpoints use. Returns events oldest → newest.
  // ------------------------------------------------------------------
  async getTimeline(transactionId: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        shippingMethod: true,
        shippingStatus: true,
        trackingReference: true,
        paidAt: true,
        dispatchedAt: true,
        deliveredAt: true,
        releasedAt: true,
      },
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.buyerId !== user.id && tx.sellerId !== user.id) {
      throw new ForbiddenException('Not authorised');
    }

    const events = await this.prisma.trackingEvent.findMany({
      where: { transactionId },
      orderBy: { occurredAt: 'asc' },
      select: {
        id: true,
        status: true,
        rawStatus: true,
        source: true,
        message: true,
        occurredAt: true,
        recordedAt: true,
      },
    });

    return {
      transactionId: tx.id,
      shippingMethod: tx.shippingMethod,
      shippingStatus: tx.shippingStatus,
      trackingReference: tx.trackingReference,
      milestones: {
        paidAt: tx.paidAt,
        dispatchedAt: tx.dispatchedAt,
        deliveredAt: tx.deliveredAt,
        releasedAt: tx.releasedAt,
      },
      events: events.map((e) => ({
        ...e,
        label: STATUS_LABEL[e.status] ?? e.message ?? e.status,
      })),
    };
  }
}
