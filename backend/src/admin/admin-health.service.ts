import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * System Health monitor — pings every external service All Outdoor
 * depends on + reports cron last-run timestamps + a few internal queue
 * depths. Used by /admin/health to give the operator a one-screen
 * answer to "is everything still up?".
 *
 * Service health probes:
 *   - Each probe does a fetch() with a 5s timeout. We don't care
 *     about the response body or even the status code — anything
 *     that returns within 5s means the host is reachable. Timeout =
 *     host unreachable. 5xx = reachable but unhealthy.
 *   - HEAD where possible to avoid bandwidth + side effects. Some
 *     services (Cloudinary, Resend) don't accept HEAD on their root
 *     so we fall back to GET.
 *   - All probes run in parallel via Promise.all so the page renders
 *     in roughly max(probe-latency) ~= 5s worst case.
 *
 * Cron health:
 *   - Cron jobs write `cron:lastrun:<name>` to the Setting table on
 *     each successful run. We read those + check how long ago each
 *     ran vs its expected cadence. "stale" = hasn't run in 3× its
 *     interval (clear signal something broke the scheduler).
 *
 * Queue depths:
 *   - Just a handful of cheap Prisma counts that map to "work
 *     waiting to be done" — e.g. pending tracking polls, unsent
 *     notifications. Renders alongside crons.
 */

export interface ServiceProbe {
  name: string;
  url: string;
  category: 'payment' | 'shipping' | 'kyc' | 'media' | 'search' | 'auth' | 'comms';
  // up         — host reachable, HTTP < 500
  // degraded   — host reachable but 5xx (probably overloaded)
  // down       — fetch errored or timed out (host unreachable)
  // not-configured — operator hasn't supplied the env var/key this
  //                  service needs to run; runtime gracefully disables
  //                  it, so it's not really "down" — it's "off"
  status: 'up' | 'degraded' | 'down' | 'not-configured' | 'unknown';
  latencyMs: number | null;
  httpStatus: number | null;
  detail: string | null;
}

export interface CronStatus {
  name: string;
  schedule: string;
  lastRunAt: Date | null;
  expectedIntervalSec: number;
  // "ok" = ran within expected interval, "stale" = overdue, "never"
  // = no run recorded yet.
  status: 'ok' | 'stale' | 'never';
}

export interface QueueDepth {
  label: string;
  count: number;
  thresholdWarn: number;
  thresholdAlarm: number;
  /** Admin page + filter that reproduces EXACTLY this count, so the card is
   *  clickable straight into the work it is counting. Omitted where no admin
   *  surface lists that queue yet (a wrong link is worse than none). */
  href?: string;
}

const PROBE_TIMEOUT_MS = 5000;

@Injectable()
export class AdminHealthService {
  private readonly logger = new Logger(AdminHealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------
  // External service probes — parallel HEAD/GET with 5s timeout.
  // -------------------------------------------------------------------
  async probeServices(): Promise<ServiceProbe[]> {
    // Resolve URLs from env (with the same fallbacks the actual
    // services use). We deliberately probe the BASE host, not an
    // authenticated endpoint — a 401/403 still proves the host is
    // up, which is the question we're answering.
    //
    // `requiresEnv` marks services that are inert at runtime unless
    // the operator supplies the listed env var. When missing, we
    // short-circuit the probe and report `not-configured` instead of
    // hitting a default URL and reporting it as "down".
    const targets: Array<
      Omit<ServiceProbe, 'status' | 'latencyMs' | 'httpStatus' | 'detail'> & {
        method: 'HEAD' | 'GET';
        requiresEnv?: string[];
        // Optional request headers (e.g. an API key for an AUTHENTICATED
        // probe). With `authAware`, a 4xx response counts as DEGRADED —
        // for auth'd endpoints a 401/403 means the credential is dead,
        // which is exactly what the probe must catch.
        headers?: Record<string, string>;
        authAware?: boolean;
      }
    > = [
      {
        name: 'Peach Payments',
        url:
          process.env.PEACH_ENV === 'live'
            ? 'https://secure.peachpayments.com'
            : 'https://testsecure.peachpayments.com',
        category: 'payment',
        method: 'HEAD',
      },
      {
        name: 'Pudo (locker shipping)',
        url: process.env.PUDO_BASE_URL ?? 'https://api-pudo.co.za',
        category: 'shipping',
        method: 'HEAD',
      },
      {
        name: 'The Courier Guy',
        // Real base URL the TCG service uses — was misnamed in the
        // initial health-monitor build (no `.portal.` subdomain).
        url: process.env.TCG_BASE_URL ?? 'https://api.portal.thecourierguy.co.za',
        category: 'shipping',
        method: 'HEAD',
        requiresEnv: ['TCG_API_KEY'],
      },
      {
        name: 'VerifyNow (KYC)',
        url: process.env.VERIFYNOW_BASE_URL ?? 'https://api.verifynow.co.za',
        category: 'kyc',
        method: 'HEAD',
        requiresEnv: ['VERIFYNOW_API_KEY'],
      },
      {
        name: 'Cloudinary (images)',
        url: 'https://api.cloudinary.com/v1_1',
        category: 'media',
        method: 'GET',
        requiresEnv: ['CLOUDINARY_CLOUD_NAME'],
      },
      {
        name: 'Meilisearch',
        // Meili has a real /health endpoint that returns {"status":"available"}.
        // If MEILISEARCH_HOST isn't set the runtime disables search
        // entirely (search.service.ts logs a warn), so we mark it
        // not-configured rather than hitting localhost and timing out.
        url: `${process.env.MEILISEARCH_HOST ?? 'http://localhost:7700'}/health`,
        category: 'search',
        method: 'GET',
        requiresEnv: ['MEILISEARCH_HOST'],
      },
      {
        name: 'Clerk (auth)',
        url: 'https://api.clerk.com/v1',
        category: 'auth',
        method: 'HEAD',
        requiresEnv: ['CLERK_SECRET_KEY'],
      },
      {
        name: 'Resend (email)',
        url: 'https://api.resend.com',
        category: 'comms',
        method: 'HEAD',
        requiresEnv: ['RESEND_API_KEY'],
      },
      {
        name: 'SMSPortal',
        url: process.env.SMSPORTAL_BASE_URL ?? 'https://rest.smsportal.com/v1',
        category: 'comms',
        method: 'HEAD',
        requiresEnv: ['SMSPORTAL_CLIENT_ID'],
      },
      {
        // AUTHENTICATED probe (audit fix 2026-07-20): the old bare HEAD on
        // the host reported "up" through a revoked key, exhausted credit,
        // or any auth failure. /v1/models is authenticated but FREE (no
        // tokens billed) — a 401/403 here means the key is dead and every
        // AI feature (Ask Boet, KYC, moderation, licence checks) is down.
        name: 'Anthropic (Claude)',
        url: 'https://api.anthropic.com/v1/models',
        category: 'comms',
        method: 'GET',
        requiresEnv: ['ANTHROPIC_API_KEY'],
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
          'anthropic-version': '2023-06-01',
        },
        authAware: true,
      },
      {
        // Zoho Books — accounting integration. Probes the public API
        // host; we don't use a credential-authenticated probe here
        // (other services in this list also probe base hosts only).
        // The deeper "can we actually auth + see our org" check
        // lives in ZohoBooksService.healthCheck() and could be added
        // as a separate row later if needed.
        name: 'Zoho Books',
        url:
          process.env.ZOHO_BOOKS_API_DOMAIN ?? 'https://www.zohoapis.com',
        category: 'comms',
        method: 'HEAD',
        requiresEnv: ['ZOHO_BOOKS_REFRESH_TOKEN'],
      },
    ];

    return Promise.all(
      targets.map(async (t): Promise<ServiceProbe> => {
        // Short-circuit when the env this service needs isn't set —
        // it's not "down", the operator just hasn't configured it yet.
        if (t.requiresEnv) {
          const missing = t.requiresEnv.filter((k) => !process.env[k]);
          if (missing.length > 0) {
            return {
              name: t.name,
              url: t.url,
              category: t.category,
              status: 'not-configured',
              latencyMs: null,
              httpStatus: null,
              detail: `Missing env: ${missing.join(', ')}`,
            };
          }
        }

        const start = Date.now();
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
          const res = await fetch(t.url, {
            method: t.method,
            headers: t.headers,
            signal: controller.signal,
          });
          clearTimeout(timeout);
          const latencyMs = Date.now() - start;
          // Default: any response (even 4xx) = host is reachable; 5xx =
          // something server-side is broken. authAware probes are
          // stricter: a 4xx on an authenticated endpoint means the
          // CREDENTIAL is dead → degraded.
          const status: ServiceProbe['status'] = t.authAware
            ? res.ok
              ? 'up'
              : 'degraded'
            : res.status >= 500
              ? 'degraded'
              : 'up';
          return {
            name: t.name,
            url: t.url,
            category: t.category,
            status,
            latencyMs,
            httpStatus: res.status,
            detail:
              status === 'degraded'
                ? t.authAware && res.status === 401
                  ? `HTTP 401 — API key rejected`
                  : `HTTP ${res.status}`
                : null,
          };
        } catch (err) {
          const latencyMs = Date.now() - start;
          const message = (err as Error).message ?? 'unknown error';
          // Localhost probes that fail almost always mean the dev
          // daemon isn't running (Meilisearch, local Pudo proxy etc.)
          // — surface a specific hint so the operator knows to start
          // it rather than chase an external-network issue.
          let detail: string;
          if (message.includes('aborted')) {
            detail = `Timeout after ${PROBE_TIMEOUT_MS}ms`;
          } else if (t.url.includes('localhost') || t.url.includes('127.0.0.1')) {
            detail = `${message} (is the local daemon running? Check ${t.url})`;
          } else {
            detail = message;
          }
          return {
            name: t.name,
            url: t.url,
            category: t.category,
            status: 'down',
            latencyMs,
            httpStatus: null,
            detail,
          };
        }
      }),
    );
  }

  // -------------------------------------------------------------------
  // Cron health — read each cron's last-run timestamp from the Setting
  // table and compare to its expected cadence. Crons themselves should
  // upsert `cron:lastrun:<name>` on completion (see tasks.service.ts).
  // -------------------------------------------------------------------
  async cronStatuses(): Promise<CronStatus[]> {
    const definitions: Array<{
      key: string;
      label: string;
      schedule: string;
      expectedIntervalSec: number;
    }> = [
      // Every schedule below is cross-checked against the actual @Cron
      // decorators in tasks.service.ts (audit 2026-07-18 — dispatch-sla
      // was declared "every 10 min" while the cron runs hourly, which
      // false-red'd the row for 30 of every 60 minutes). deal-drops is
      // deliberately NOT monitored: it only records a run when a drop
      // actually fires, so a freshness check would false-alarm forever.
      { key: 'shipping-poll', label: 'Shipping tracking poll', schedule: 'every 10 min', expectedIntervalSec: 600 },
      { key: 'auction-end', label: 'Auction end sweep', schedule: 'every 1 min', expectedIntervalSec: 60 },
      { key: 'offer-expire', label: 'Offer expiry sweep', schedule: 'every 10 min', expectedIntervalSec: 600 },
      { key: 'dispatch-sla', label: 'Dispatch SLA enforcer', schedule: 'every 1 hour', expectedIntervalSec: 3600 },
      { key: 'verifynow-balance', label: 'VerifyNow balance refresh', schedule: 'every 5 min', expectedIntervalSec: 300 },
      { key: 'push-prune', label: 'Push subscription cleanup', schedule: 'every 1 week', expectedIntervalSec: 604800 },
      { key: 'saved-search-match', label: 'Saved-search alert matcher', schedule: 'every 10 min', expectedIntervalSec: 600 },
      { key: 'stuck-held-funds', label: 'Stuck-held-funds admin alert', schedule: 'every 1 hour', expectedIntervalSec: 3600 },
      { key: 'deal-po-retry', label: 'Deal PO retry', schedule: 'every 1 hour', expectedIntervalSec: 3600 },
      { key: 'credit-poll', label: 'Service credit snapshot poll', schedule: 'every 15 min', expectedIntervalSec: 900 },
      { key: 'firearm-licence-expiry', label: 'Firearm licence expiry sweep', schedule: 'daily 06:00', expectedIntervalSec: 86400 },
      { key: 'pa-payout-reconcile', label: 'Payout reconcile sweep', schedule: 'every 5 min', expectedIntervalSec: 300 },
      { key: 'orphan-reclaim', label: 'Orphaned reservation reclaim', schedule: 'every 5 min', expectedIntervalSec: 300 },
      { key: 'order-status-rollup', label: 'Order status rollup', schedule: 'every 30 min', expectedIntervalSec: 1800 },
      { key: 'featured-tick', label: 'Featured slots tick', schedule: 'every 1 min', expectedIntervalSec: 60 },
      { key: 'subscription-sweep', label: 'Subscription sweep', schedule: 'every 10 min', expectedIntervalSec: 600 },
      { key: 'swap-proposal-expire', label: 'Swap proposal expiry', schedule: 'every 10 min', expectedIntervalSec: 600 },
      { key: 'swap-funding-sweep', label: 'Swap funding sweep', schedule: 'every 10 min', expectedIntervalSec: 600 },
      { key: 'swap-prefunding-sweep', label: 'Swap pre-funding sweep', schedule: 'every 1 hour', expectedIntervalSec: 3600 },
      { key: 'prize-draw', label: 'PRO prize draw', schedule: 'every 1 hour', expectedIntervalSec: 3600 },
      { key: 'swap-fee-receipt-retry', label: 'Swap fee receipt retry', schedule: 'every 1 hour', expectedIntervalSec: 3600 },
      { key: 'zoho-revenue-doc-retry', label: 'Zoho revenue-doc retry', schedule: 'every 1 hour', expectedIntervalSec: 3600 },
      { key: 'email-outbox-retry', label: 'Email outbox retry', schedule: 'every 10 min', expectedIntervalSec: 600 },
      { key: 'trust-score-refresh', label: 'Trust-score refresh', schedule: 'daily 03:00', expectedIntervalSec: 86_400 },
      { key: 'swap-locked-redrive', label: 'Swap locked-state redrive', schedule: 'every 5 min', expectedIntervalSec: 300 },
      { key: 'swap-shipping-sla', label: 'Swap shipping SLA sweep', schedule: 'every 1 hour', expectedIntervalSec: 3600 },
      { key: 'swap-verification-sweep', label: 'Swap verification sweep', schedule: 'every 1 hour', expectedIntervalSec: 3600 },
      { key: 'deal-collection-sweep', label: 'Deal collection sweep', schedule: 'every 1 hour', expectedIntervalSec: 3600 },
      { key: 'experience-sla', label: 'Experience SLA sweep', schedule: 'every 1 hour', expectedIntervalSec: 3600 },
      { key: 'dealer-verification-ageing', label: 'Dealer verification ageing', schedule: 'every 1 hour', expectedIntervalSec: 3600 },
      { key: 'accept-escalation', label: '48h accept escalation', schedule: 'every 10 min', expectedIntervalSec: 600 },
      { key: 'sms-retry', label: 'SMS retry + outage watch', schedule: 'every 10 min', expectedIntervalSec: 600 },
      { key: 'cron-watchdog', label: 'Cron watchdog', schedule: 'every 10 min', expectedIntervalSec: 600 },
      { key: 'stale-listing-sweep', label: 'Stale listing expiry', schedule: 'daily 04:00', expectedIntervalSec: 86_400 },
      { key: 'photoless-listing-sweep', label: 'Photo-less listing sweep', schedule: 'every 1 hour', expectedIntervalSec: 3600 },
    ];

    const rows = await this.prisma.setting.findMany({
      where: { key: { in: definitions.map((d) => `cron:lastrun:${d.key}`) } },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.updatedAt]));

    return definitions.map((d) => {
      const ts = byKey.get(`cron:lastrun:${d.key}`) ?? null;
      const now = Date.now();
      let status: CronStatus['status'] = 'never';
      if (ts) {
        const ageMs = now - ts.getTime();
        // 3x the interval = stale (occasional slow run is fine, but
        // 3× overdue means the scheduler is broken or the cron crashed).
        status = ageMs > d.expectedIntervalSec * 3000 ? 'stale' : 'ok';
      }
      return {
        name: d.label,
        schedule: d.schedule,
        lastRunAt: ts,
        expectedIntervalSec: d.expectedIntervalSec,
        status,
      };
    });
  }

  // -------------------------------------------------------------------
  // Queue depths — quick proxies for "work waiting to be done". Each
  // has thresholds that the UI uses to colour-code (green / amber / red).
  // -------------------------------------------------------------------
  async queueDepths(): Promise<QueueDepth[]> {
    const day = 24 * 3600 * 1000;
    const [pendingListings, heldNoDispatch, kycPending, listingsAwaitingAnswer] =
      await Promise.all([
        this.prisma.listing.count({ where: { status: 'PENDING_REVIEW' } }),
        this.prisma.transaction.count({
          where: {
            paymentStatus: 'HELD',
            dispatchedAt: null,
            paidAt: { lt: new Date(Date.now() - day) },
          },
        }),
        this.prisma.user.count({
          where: { kycRequiredAt: { not: null }, kycStatus: { not: 'VERIFIED' } },
        }),
        this.prisma.listingQuestion.count({
          where: { status: 'AWAITING_SELLER_ANSWER' },
        }),
      ]);

    // Each href reproduces its own count exactly (the transactions
    // 'dispatch-overdue' and users 'kyc-outstanding' filters were added to
    // AdminService for precisely this). The questions queue has no admin
    // surface listing AWAITING_SELLER_ANSWER, so that card stays unlinked
    // rather than dumping the operator somewhere that shows different rows.
    return [
      { label: 'Listings pending admin review', count: pendingListings, thresholdWarn: 10, thresholdAlarm: 30, href: '/admin/listings?status=PENDING_REVIEW' },
      { label: 'HELD payments past dispatch SLA (24h+)', count: heldNoDispatch, thresholdWarn: 5, thresholdAlarm: 20, href: '/admin/transactions?status=HELD&filter=dispatch-overdue' },
      { label: 'Users with KYC outstanding', count: kycPending, thresholdWarn: 20, thresholdAlarm: 60, href: '/admin/users?filter=kyc-outstanding' },
      { label: 'Listing questions awaiting seller answer', count: listingsAwaitingAnswer, thresholdWarn: 25, thresholdAlarm: 75 },
    ];
  }
}
