import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ActorRef {
  userId?: string | null;
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
    | 'page_view'
    // Foreground time spent on one route. `metadata.durationSec` is the
    // active (visible-tab) seconds, clamped at the API boundary; `section`
    // is an allowlisted product area, never free text. This is what powers
    // "time spent on what" in the admin Insights board.
    | 'page_dwell'
    // Install funnel. The PWA is the only "app" we have, and until these
    // landed nothing anywhere recorded whether the install popup was ever
    // seen — an operator reporting "it works on Android but not iPhone" could
    // not be confirmed or refuted from any table we hold. Four events, one per
    // step: shown -> clicked -> (dismissed | completed). `metadata.platform`
    // carries which install path the browser actually had, which is the whole
    // question on iOS (no beforeinstallprompt exists there, ever).
    | 'install_shown'
    | 'install_clicked'
    | 'install_dismissed'
    | 'install_completed';
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
  // ⚠️ ONE SET WHERE THERE WERE TWO. The old pair held the same operators
  // under two identifiers — the provider subject and the User.id — because a
  // hook could stamp either. There is one identifier now, so a second set
  // could only ever disagree with the first.
  private adminUserIds = new Set<string>();
  private flushTimer: NodeJS.Timeout | null = null;
  private adminTimer: NodeJS.Timeout | null = null;
  // Session id → last time we wrote LoginEvent.lastActiveAt. Without a
  // throttle every page view would become an UPDATE; at most one per session
  // per five minutes is enough to bound an open session's length honestly
  // without turning analytics into a write amplifier.
  private readonly touchedSessions = new Map<string, number>();

  private readonly MAX_BUFFER = 5000;
  private readonly FLUSH_MS = 3000;
  private readonly ADMIN_REFRESH_MS = 5 * 60 * 1000;
  private readonly SESSION_TOUCH_MS = 5 * 60 * 1000;

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
      const userId = a.userId ?? null;
      // Exclude admin/operator traffic.
      if (userId && this.adminUserIds.has(userId)) return;

      if (this.buffer.length >= this.MAX_BUFFER) this.buffer.shift(); // drop oldest
      this.buffer.push({
        userId,
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
    await this.touchSessions(batch);
  }

  /**
   * Keep `LoginEvent.lastActiveAt` roughly current so an unclosed session
   * still has a measurable length. Best-effort and throttled per session:
   * a failure here must never affect event capture.
   */
  private async touchSessions(batch: BufferedEvent[]): Promise<void> {
    const now = Date.now();
    const due: string[] = [];
    for (const e of batch) {
      if (!e.sessionId) continue;
      const last = this.touchedSessions.get(e.sessionId) ?? 0;
      if (now - last < this.SESSION_TOUCH_MS) continue;
      this.touchedSessions.set(e.sessionId, now);
      due.push(e.sessionId);
    }
    if (due.length === 0) return;
    // The map must not grow forever in a long-lived process.
    if (this.touchedSessions.size > 20_000) {
      for (const [id, at] of this.touchedSessions) {
        if (now - at > this.SESSION_TOUCH_MS) this.touchedSessions.delete(id);
      }
    }
    try {
      await this.prisma.loginEvent.updateMany({
        where: { sessionId: { in: due }, endedAt: null },
        data: { lastActiveAt: new Date(now) },
      });
    } catch (err) {
      this.logger.warn(
        `login-event lastActiveAt touch failed: ${(err as Error).message}`,
      );
    }
  }

  private async refreshAdmins(): Promise<void> {
    try {
      // ⚠️ AdminUser.userId, NOT AdminUser.id. The first is the MEMBER row an
      // admin is linked to — which is what shows up in analytics traffic; the
      // second is the admin record's own primary key and matches nobody's
      // events. Selecting the wrong one silently excludes nothing and lets
      // every operator's browsing into the member statistics.
      const admins = await this.prisma.adminUser.findMany({
        where: { isActive: true, userId: { not: null } },
        select: { userId: true },
      });
      this.adminUserIds = new Set(
        admins.map((a) => a.userId).filter((id): id is string => !!id),
      );
    } catch (err) {
      this.logger.warn(`admin-exclusion refresh failed: ${(err as Error).message}`);
    }
  }
}
