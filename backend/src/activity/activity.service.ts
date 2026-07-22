import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ActorRef {
  userId?: string | null;
  clerkId?: string | null;
  deviceId?: string | null;
}

export interface RecordInput {
  eventType:
    | 'listing_view'
    | 'search'
    | 'offer_placed'
    | 'bid_placed'
    | 'wishlist_add'
    | 'cart_add'
    | 'checkout_started'
    | 'page_view';
  actor?: ActorRef;
  listingId?: string | null;
  query?: string | null;
  resultCount?: number | null;
  amountCents?: number | null;
  path?: string | null;
  sessionId?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface BufferedEvent {
  userId: string | null;
  clerkId: string | null;
  deviceId: string | null;
  sessionId: string | null;
  eventType: string;
  listingId: string | null;
  query: string | null;
  resultCount: number | null;
  amountCents: number | null;
  path: string | null;
  metadata?: object;
  createdAt: Date;
}

// Fire-and-forget behavioural-event capture. record() NEVER throws, NEVER
// awaits, and NEVER touches the DB synchronously — it pushes onto an in-memory
// ring buffer that a timer drains with one createMany. A PG hiccup can only
// drop analytics, never surface to (or slow) a browsing user. Admin traffic
// (the operator, whether on the admin panel or signed in as a normal user) is
// dropped via a periodically-refreshed cache of admin identities.
@Injectable()
export class ActivityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ActivityService.name);
  private buffer: BufferedEvent[] = [];
  private adminClerkIds = new Set<string>();
  private adminUserIds = new Set<string>();
  private flushTimer: NodeJS.Timeout | null = null;
  private adminTimer: NodeJS.Timeout | null = null;

  private readonly MAX_BUFFER = 5000;
  private readonly FLUSH_MS = 3000;
  private readonly ADMIN_REFRESH_MS = 5 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    void this.refreshAdmins();
    this.adminTimer = setInterval(
      () => void this.refreshAdmins(),
      this.ADMIN_REFRESH_MS,
    );
    this.flushTimer = setInterval(() => void this.flush(), this.FLUSH_MS);
    // Timers must not keep the process alive on shutdown.
    this.adminTimer.unref?.();
    this.flushTimer.unref?.();
  }

  async onModuleDestroy() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.adminTimer) clearInterval(this.adminTimer);
    await this.flush();
  }

  // The one entry point for every server hook AND the client beacon.
  record(input: RecordInput): void {
    try {
      const a = input.actor ?? {};
      const clerkId = a.clerkId ?? null;
      const userId = a.userId ?? null;
      // Exclude admin/operator traffic.
      if (clerkId && this.adminClerkIds.has(clerkId)) return;
      if (userId && this.adminUserIds.has(userId)) return;

      if (this.buffer.length >= this.MAX_BUFFER) this.buffer.shift(); // drop oldest
      this.buffer.push({
        userId,
        clerkId,
        deviceId: a.deviceId ?? null,
        sessionId: input.sessionId ?? null,
        eventType: input.eventType,
        listingId: input.listingId ?? null,
        query: input.query ? input.query.slice(0, 200) : null,
        resultCount:
          typeof input.resultCount === 'number' ? input.resultCount : null,
        amountCents:
          typeof input.amountCents === 'number' ? input.amountCents : null,
        path: input.path ? input.path.slice(0, 300) : null,
        metadata: (input.metadata as object | undefined) ?? undefined,
        createdAt: new Date(),
      });
    } catch {
      /* capture must never break the host request */
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.buffer.length);
    try {
      await this.prisma.userEvent.createMany({ data: batch });
    } catch (err) {
      // Best-effort — drop the batch rather than retry-loop or backpressure.
      this.logger.warn(
        `activity flush dropped ${batch.length} events: ${(err as Error).message}`,
      );
    }
  }

  private async refreshAdmins(): Promise<void> {
    try {
      const admins = await this.prisma.adminUser.findMany({
        where: { isActive: true, clerkId: { not: null } },
        select: { clerkId: true },
      });
      const clerkIds = admins
        .map((a) => a.clerkId)
        .filter((c): c is string => !!c);
      this.adminClerkIds = new Set(clerkIds);
      if (clerkIds.length) {
        const users = await this.prisma.user.findMany({
          where: { clerkId: { in: clerkIds } },
          select: { id: true },
        });
        this.adminUserIds = new Set(users.map((u) => u.id));
      } else {
        this.adminUserIds = new Set();
      }
    } catch (err) {
      this.logger.warn(`admin-exclusion refresh failed: ${(err as Error).message}`);
    }
  }
}
