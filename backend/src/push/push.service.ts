import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationCategory } from '@prisma/client';

/**
 * Push notification fanout — wraps the `web-push` library.
 *
 * Lifecycle:
 *   1. Browser opts in → registers a subscription (POST /push/subscribe)
 *      → we store the endpoint + keys.
 *   2. NotificationsService.persist() writes an inbox row AND, for
 *      non-dismissible (action-required) events, calls
 *      sendToUser(userId, payload) on this service.
 *   3. sendToUser fetches every active subscription for the user and
 *      fires web-push in parallel.
 *   4. If a subscription returns 410 Gone (the browser unsubscribed
 *      OR the PWA was uninstalled), we delete the row.
 *
 * VAPID keys must be set in env:
 *   VAPID_PUBLIC_KEY  — also exposed to the frontend as
 *                       NEXT_PUBLIC_VAPID_PUBLIC_KEY
 *   VAPID_PRIVATE_KEY — server-only
 *   VAPID_SUBJECT     — mailto: URL identifying us to push gateways
 *
 * If keys are absent, the service degrades to a no-op (logs once,
 * never throws). This matches the rest of the platform — every
 * external dependency is allowed to be missing without breaking
 * the request handling path.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private vapidConfigured = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT ?? 'mailto:support@gungalore.co.za';
    if (!pub || !priv) {
      this.logger.warn(
        'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY missing — push notifications disabled. The inbox + email + SMS still work; push sends become silent no-ops.',
      );
      return;
    }
    webpush.setVapidDetails(subject, pub, priv);
    this.vapidConfigured = true;
    this.logger.log('Push notifications enabled (VAPID configured).');
  }

  /** True when the service is ready to send. Read by the frontend
   * via GET /push/vapid-public-key — if the backend isn't configured
   * we hide the opt-in UI entirely. */
  isReady(): boolean {
    return this.vapidConfigured;
  }

  /** Public key for the browser to use when calling
   * pushManager.subscribe(). Identical to env VAPID_PUBLIC_KEY but
   * exposed via API so the frontend doesn't need its own env var. */
  getPublicKey(): string | null {
    return process.env.VAPID_PUBLIC_KEY ?? null;
  }

  /** Persist a new subscription. Upserts on the endpoint so a device
   * that re-subscribes (e.g. after clearing site data) replaces the
   * stale row instead of stacking duplicates. */
  async subscribe(
    clerkId: string,
    input: {
      endpoint: string;
      p256dh: string;
      auth: string;
      userAgent?: string;
      categories?: NotificationCategory[];
    },
  ): Promise<{ subscribed: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!user) return { subscribed: false };

    await this.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        userId: user.id,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent ?? null,
        category: input.categories ?? ['BUYER', 'SELLER', 'ACCOUNT'],
      },
      update: {
        // Re-bind to current user (in case the device used to belong
        // to a different account). Refresh the keys (the browser
        // may have rotated them).
        userId: user.id,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent ?? null,
        category: input.categories ?? ['BUYER', 'SELLER', 'ACCOUNT'],
      },
    });
    return { subscribed: true };
  }

  /** Unsubscribe a single endpoint. Called when the user disables
   * push in the UI — also fires when the browser auto-unsubscribes
   * (we get a 410 in sendToUser and clean up there). */
  async unsubscribe(
    clerkId: string,
    endpoint: string,
  ): Promise<{ removed: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!user) return { removed: false };
    const deleted = await this.prisma.pushSubscription
      .deleteMany({
        where: { endpoint, userId: user.id },
      })
      .catch(() => ({ count: 0 }));
    return { removed: deleted.count > 0 };
  }

  /** Has the current user opted in on at least one device? Drives
   * the UI's "Enabled" vs "Enable" pill. */
  async hasAnySubscription(clerkId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!user) return false;
    const count = await this.prisma.pushSubscription.count({
      where: { userId: user.id },
    });
    return count > 0;
  }

  /** Fire a push notification to every active subscription for the
   * given user. Filters by category if specified. Errors per
   * subscription are caught + logged; one broken device does not
   * stop the rest from receiving. 410 Gone deletes the row.
   *
   * Returns the count of successful pushes (0 if the user has no
   * subscriptions, or VAPID isn't configured).
   */
  async sendToUser(
    userId: string,
    category: NotificationCategory,
    payload: {
      title: string;
      body: string;
      url?: string;
      tag?: string; // dedup hint — same tag replaces instead of stacking
    },
  ): Promise<number> {
    if (!this.vapidConfigured) return 0;
    const subs = await this.prisma.pushSubscription.findMany({
      where: {
        userId,
        // Postgres array contains: only fire if this device opted-in
        // for this category.
        category: { has: category },
      },
    });
    if (subs.length === 0) return 0;

    const json = JSON.stringify(payload);
    let sent = 0;
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            json,
            { TTL: 60 * 60 * 24 }, // 24h — drop if undelivered
          );
          sent += 1;
          // Bump lastUsedAt asynchronously — don't block on this.
          void this.prisma.pushSubscription
            .update({
              where: { id: sub.id },
              data: { lastUsedAt: new Date() },
            })
            .catch(() => undefined);
        } catch (err) {
          const status = (err as { statusCode?: number })?.statusCode;
          if (status === 410 || status === 404) {
            // Endpoint is gone — the browser unsubscribed / PWA was
            // uninstalled. Drop the row so we don't keep trying.
            await this.prisma.pushSubscription
              .delete({ where: { id: sub.id } })
              .catch(() => undefined);
            this.logger.debug(
              `Pruned dead push subscription (${status}) for user ${userId}`,
            );
          } else {
            this.logger.warn(
              `push to ${sub.endpoint.slice(0, 40)}… failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
      }),
    );
    return sent;
  }

  /** Weekly cron-callable cleanup. Drops subscriptions that haven't
   * been used in 90 days (the device almost certainly uninstalled
   * the PWA or cleared its SW). Returns the prune count. */
  async pruneStale(maxAgeDays = 90): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 3600 * 1000);
    const result = await this.prisma.pushSubscription.deleteMany({
      where: {
        OR: [
          { lastUsedAt: { lt: cutoff } },
          // Subs that were created but never fired (no lastUsedAt set)
          // get pruned after the same window from their createdAt.
          { lastUsedAt: null, createdAt: { lt: cutoff } },
        ],
      },
    });
    if (result.count > 0) {
      this.logger.log(`Pruned ${result.count} stale push subscriptions`);
    }
    return result.count;
  }
}
