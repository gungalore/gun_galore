import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * AdminCreditsService — unified credit/balance fetcher for every paid
 * external service Gun Galore touches at runtime.
 *
 * Why this lives in /admin and not next to each service:
 *   - Operator monitoring is a cross-cutting concern. Spreading the
 *     fetch logic across each module (SmsService, VerifyNowService,
 *     CloudinaryService, etc.) makes it hard for the operator to see
 *     "what does my pool look like right now?" in one place.
 *   - The cron in TasksService.pollCreditBalances() calls one method
 *     here (fetchAll()) and gets back a uniform array. Threshold
 *     comparison is then trivial.
 *   - The admin /admin/credits page also calls fetchAll() for a live
 *     snapshot, and reads from CreditSnapshot for the trend chart.
 *
 * Design contract for every fetch method:
 *   1. NEVER throws. A failed fetch returns
 *      `{ service, balance: null, error: 'reason', fetchedAt }` so the
 *      cron can still write a row and the chart can render a gap.
 *   2. Bounded by `AbortSignal.timeout(5000)`. We must not hang the
 *      cron — every fetch competes for the 15-min tick budget alongside
 *      4 other services + threshold writes.
 *   3. When the relevant env var(s) are missing, returns
 *      `{ balance: null, error: 'not configured', ... }` gracefully
 *      WITHOUT making a network call. Local-dev parity — the operator
 *      should never see a confusing "down" report just because they
 *      haven't wired up Anthropic admin keys yet.
 *   4. `metadata` carries everything service-specific so the admin UI
 *      can render the raw response (storage used, USD spent today, etc)
 *      without us needing to add columns for every dimension.
 */

const FETCH_TIMEOUT_MS = 5000;

// One uniform shape every fetcher returns. Matches what the cron writes
// to CreditSnapshot (minus the auto-generated id).
export interface CreditSnapshotResult {
  service: 'smsportal' | 'verifynow' | 'cloudinary' | 'anthropic' | 'pudo' | 'tcg';
  balance: number | null;
  unit: string | null;
  metadata: Record<string, unknown> | null;
  fetchedAt: Date;
  error?: string;
}

@Injectable()
export class AdminCreditsService {
  private readonly logger = new Logger(AdminCreditsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------
  // SMSPortal — credit balance for outbound OTPs + transactional SMS.
  // -------------------------------------------------------------------
  // GET https://rest.smsportal.com/v1/Balance
  // Auth: HTTP Basic with clientId:apiSecret (same scheme SmsService
  // uses for /BulkMessages). The Balance endpoint is free to call —
  // doesn't consume a credit itself.
  //
  // Response shape (per SMSPortal v1 docs):
  //   { "balance": 1234.5, "currency": "ZAR" }
  // The `balance` field is the SMS credit count (NOT currency despite
  // the `currency` sibling — SMSPortal returns ZAR/USD as the cost
  // currency on top-ups, not the unit of balance). We always map it to
  // unit='credits' so the operator UI doesn't have to know.
  async fetchSmsPortal(): Promise<CreditSnapshotResult> {
    const fetchedAt = new Date();
    const clientId =
      process.env.SMSPORTAL_CLIENT_ID ?? process.env.SMSPORTAL_API_KEY;
    const apiSecret = process.env.SMSPORTAL_API_SECRET;
    const baseUrl =
      process.env.SMSPORTAL_BASE_URL ?? 'https://rest.smsportal.com/v1';

    if (!clientId || !apiSecret) {
      return {
        service: 'smsportal',
        balance: null,
        unit: 'credits',
        metadata: null,
        fetchedAt,
        error: 'SMSPORTAL_CLIENT_ID / SMSPORTAL_API_SECRET not configured',
      };
    }

    try {
      const credentials = Buffer.from(`${clientId}:${apiSecret}`).toString(
        'base64',
      );
      const res = await fetch(`${baseUrl}/Balance`, {
        method: 'GET',
        headers: {
          Authorization: `Basic ${credentials}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          service: 'smsportal',
          balance: null,
          unit: 'credits',
          metadata: { httpStatus: res.status, body: text.slice(0, 200) },
          fetchedAt,
          error: `HTTP ${res.status}`,
        };
      }

      const raw = (await res.json().catch(() => ({}))) as {
        balance?: number;
        currency?: string;
      };
      const balance = typeof raw.balance === 'number' ? raw.balance : null;

      return {
        service: 'smsportal',
        balance,
        unit: 'credits',
        metadata: { raw, currency: raw.currency ?? null },
        fetchedAt,
        error:
          balance == null ? 'Balance field missing in response' : undefined,
      };
    } catch (err) {
      return {
        service: 'smsportal',
        balance: null,
        unit: 'credits',
        metadata: null,
        fetchedAt,
        error: (err as Error).message,
      };
    }
  }

  // -------------------------------------------------------------------
  // VerifyNow — KYC credit balance (one credit per ID lookup + selfie).
  // -------------------------------------------------------------------
  // Reuses the existing VerifyNowService.getCreditBalance shape rather
  // than duplicating the auth + parsing. We re-implement the fetch
  // here instead of injecting VerifyNowService because:
  //   - Adding KycModule to AdminModule's imports creates a circular
  //     reference path (KycModule already depends on a few admin-side
  //     services indirectly via NotificationsModule).
  //   - This service must NEVER throw — VerifyNowService throws
  //     KycException on failure, which would break the fetchAll
  //     Promise.allSettled contract.
  //
  // Endpoint: GET {VERIFYNOW_BASE_URL}/my_credits  (free — no credit
  // consumed). Returns either:
  //   Sandbox:    { "available_credits": 1000 }
  //   Production: { "Status": "Success",
  //                 "Result": { "credits": "1500",
  //                             "last_refresh": "..." } }
  // We map both to balance=credits, unit='lookup'.
  async fetchVerifyNow(): Promise<CreditSnapshotResult> {
    const fetchedAt = new Date();
    const apiKey = process.env.VERIFYNOW_API_KEY;
    const baseUrl =
      process.env.VERIFYNOW_BASE_URL ??
      'https://www.verifynow.co.za/api/external';

    if (!apiKey) {
      return {
        service: 'verifynow',
        balance: null,
        unit: 'lookup',
        metadata: null,
        fetchedAt,
        error: 'VERIFYNOW_API_KEY not configured',
      };
    }

    try {
      const res = await fetch(`${baseUrl}/my_credits`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      const text = await res.text();
      let data: Record<string, unknown> = {};
      try {
        data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        data = { rawBody: text };
      }

      if (!res.ok) {
        return {
          service: 'verifynow',
          balance: null,
          unit: 'lookup',
          metadata: { httpStatus: res.status, raw: data },
          fetchedAt,
          error: `HTTP ${res.status}`,
        };
      }

      // Normalise both sandbox + production shapes.
      const result = (data.Result ?? {}) as Record<string, unknown>;
      const rawCredits =
        (data.available_credits as number | string | undefined) ??
        (result.credits as number | string | undefined);
      const balance =
        typeof rawCredits === 'number'
          ? rawCredits
          : typeof rawCredits === 'string'
            ? Number(rawCredits) || 0
            : null;

      return {
        service: 'verifynow',
        balance,
        unit: 'lookup',
        metadata: { raw: data, lastRefresh: result.last_refresh ?? null },
        fetchedAt,
        error:
          balance == null ? 'Credits field missing in response' : undefined,
      };
    } catch (err) {
      return {
        service: 'verifynow',
        balance: null,
        unit: 'lookup',
        metadata: null,
        fetchedAt,
        error: (err as Error).message,
      };
    }
  }

  // -------------------------------------------------------------------
  // Cloudinary — credits + storage usage.
  // -------------------------------------------------------------------
  // GET https://api.cloudinary.com/v1_1/{cloud_name}/usage
  // Auth: HTTP Basic with api_key:api_secret (no special "admin" key —
  // the same credentials Cloudinary uses for uploads work here).
  //
  // Response includes `credits.usage` (used so far this period),
  // `credits.limit` (the plan's allocation), `storage.usage` (bytes),
  // `bandwidth.usage`, `transformations.usage`. We compute
  // balance = limit - usage so the operator UI shows "remaining"
  // consistently with the other services (higher number = more headroom).
  //
  // NOTE: Cloudinary's free plan returns `credits.limit = 25` (units of
  // 1000 transformations OR 1 GB storage OR 1 GB bandwidth — see their
  // pricing page). The unit is intentionally fuzzy on Cloudinary's
  // side; we just surface what they tell us and label it 'credits'.
  async fetchCloudinary(): Promise<CreditSnapshotResult> {
    const fetchedAt = new Date();
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      return {
        service: 'cloudinary',
        balance: null,
        unit: 'credits',
        metadata: null,
        fetchedAt,
        error: 'CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET not configured',
      };
    }

    try {
      const credentials = Buffer.from(`${apiKey}:${apiSecret}`).toString(
        'base64',
      );
      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/usage`,
        {
          method: 'GET',
          headers: {
            Authorization: `Basic ${credentials}`,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        },
      );

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          service: 'cloudinary',
          balance: null,
          unit: 'credits',
          metadata: { httpStatus: res.status, body: text.slice(0, 200) },
          fetchedAt,
          error: `HTTP ${res.status}`,
        };
      }

      const raw = (await res.json().catch(() => ({}))) as {
        credits?: { usage?: number; limit?: number };
        storage?: { usage?: number; limit?: number };
        bandwidth?: { usage?: number; limit?: number };
        transformations?: { usage?: number; limit?: number };
      };

      const used = raw.credits?.usage ?? 0;
      const limit = raw.credits?.limit ?? 0;
      const balance = Math.max(0, limit - used);

      // Convert bytes → GB for the operator-facing metadata.
      const bytesToGb = (b: number | undefined) =>
        b ? Math.round((b / 1024 / 1024 / 1024) * 100) / 100 : 0;

      return {
        service: 'cloudinary',
        balance,
        unit: 'credits',
        metadata: {
          raw,
          credits_used: used,
          credits_limit: limit,
          storage_gb: bytesToGb(raw.storage?.usage),
          storage_limit_gb: bytesToGb(raw.storage?.limit),
          bandwidth_gb: bytesToGb(raw.bandwidth?.usage),
          transformations_used: raw.transformations?.usage ?? 0,
        },
        fetchedAt,
      };
    } catch (err) {
      return {
        service: 'cloudinary',
        balance: null,
        unit: 'credits',
        metadata: null,
        fetchedAt,
        error: (err as Error).message,
      };
    }
  }

  // -------------------------------------------------------------------
  // Anthropic — usage spend over the last 24h.
  // -------------------------------------------------------------------
  // Anthropic exposes an Admin API for usage reporting under an
  // ANTHROPIC_ADMIN_API_KEY (separate from the runtime ANTHROPIC_API_KEY
  // used by the listing-review agent). The admin key is opt-in — most
  // organisations don't enable it by default — so we gracefully report
  // "not configured" when it's missing rather than blocking the cron.
  //
  // GET https://api.anthropic.com/v1/organizations/usage_report/messages
  //   Headers:
  //     x-api-key: <ANTHROPIC_ADMIN_API_KEY>
  //     anthropic-version: 2023-06-01
  //   Query:
  //     starting_at, ending_at (RFC3339 UTC)
  //
  // Response shape (best-effort — Anthropic's admin API is relatively
  // new and the schema is documented as "may evolve"). We extract the
  // sum of `cost_usd` (or similar) across the returned buckets. If the
  // shape doesn't match what we expect, we report the raw response in
  // metadata so the operator can debug rather than getting a silent zero.
  //
  // NOTE: "balance" here is INVERTED vs the other services — it's
  // SPEND_USD over the last 24h, NOT money remaining. Thresholds for
  // Anthropic should be configured to fire when spend EXCEEDS the limit
  // (the threshold-check in TasksService treats balance <= threshold as
  // the alert condition, so for Anthropic the operator should set
  // warnThreshold = "max acceptable spend" and we negate the comparison
  // in the cron — see TasksService for details).
  async fetchAnthropic(): Promise<CreditSnapshotResult> {
    const fetchedAt = new Date();
    const adminKey = process.env.ANTHROPIC_ADMIN_API_KEY;

    if (!adminKey) {
      return {
        service: 'anthropic',
        balance: null,
        unit: 'USD',
        metadata: null,
        fetchedAt,
        error: 'ANTHROPIC_ADMIN_API_KEY not configured',
      };
    }

    try {
      // Last-24h window. RFC3339 UTC.
      const endingAt = new Date().toISOString();
      const startingAt = new Date(
        Date.now() - 24 * 60 * 60 * 1000,
      ).toISOString();
      const url = new URL(
        'https://api.anthropic.com/v1/organizations/usage_report/messages',
      );
      url.searchParams.set('starting_at', startingAt);
      url.searchParams.set('ending_at', endingAt);

      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'x-api-key': adminKey,
          'anthropic-version': '2023-06-01',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          service: 'anthropic',
          balance: null,
          unit: 'USD',
          metadata: { httpStatus: res.status, body: text.slice(0, 500) },
          fetchedAt,
          error: `HTTP ${res.status} — Admin API may not be enabled on this org`,
        };
      }

      const raw = (await res.json().catch(() => ({}))) as {
        data?: Array<{
          // Buckets contain per-time-window cost rollups. Field names
          // are conservative defaults based on Anthropic's docs; if the
          // shape changes the raw metadata will let the operator debug.
          cost_usd?: number;
          cost?: number;
          total_cost_usd?: number;
        }>;
      };

      // Sum every plausible "cost" field across the returned buckets.
      const buckets = Array.isArray(raw.data) ? raw.data : [];
      const sumSpend = buckets.reduce((acc, b) => {
        const v = b.cost_usd ?? b.total_cost_usd ?? b.cost ?? 0;
        return acc + (typeof v === 'number' ? v : 0);
      }, 0);

      return {
        service: 'anthropic',
        balance: sumSpend,
        unit: 'USD',
        metadata: {
          raw,
          spend_today_usd: sumSpend,
          bucket_count: buckets.length,
          window_start: startingAt,
          window_end: endingAt,
        },
        fetchedAt,
      };
    } catch (err) {
      return {
        service: 'anthropic',
        balance: null,
        unit: 'USD',
        metadata: null,
        fetchedAt,
        error: (err as Error).message,
      };
    }
  }

  // -------------------------------------------------------------------
  // Pudo — account balance / wallet status.
  // -------------------------------------------------------------------
  // Pudo's public REST API doesn't expose a documented /account or
  // /balance endpoint at the time of writing — every shipment-create
  // call returns a `flags` array that includes "zero_balance" when the
  // merchant wallet is empty, but there's no "what's my balance" GET.
  //
  // We try GET {PUDO_BASE_URL}/api/v1/account first (per a community
  // mention in their support thread); if it 404s we fall back to
  // reporting "endpoint not exposed" gracefully — the operator can
  // still see the live "zero_balance" flag via the shipment audit log.
  //
  // Auth uses the same Bearer scheme as PudoService.buildBearer().
  async fetchPudo(): Promise<CreditSnapshotResult> {
    const fetchedAt = new Date();
    const apiKey = process.env.PUDO_API_KEY;
    const apiSecret = process.env.PUDO_API_SECRET ?? '';
    const baseUrl = process.env.PUDO_BASE_URL ?? 'https://api-pudo.co.za';

    if (!apiKey) {
      return {
        service: 'pudo',
        balance: null,
        unit: 'ZAR',
        metadata: null,
        fetchedAt,
        error: 'PUDO_API_KEY not configured',
      };
    }

    // Pudo's bearer format is <id>|<secret>. Match PudoService's
    // buildBearer() exactly so any working PUDO_API_KEY env keeps working.
    const bearer = apiKey.includes('|')
      ? apiKey
      : apiSecret
        ? `${apiKey}|${apiSecret}`
        : apiKey;

    try {
      const res = await fetch(`${baseUrl}/api/v1/account`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${bearer}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (res.status === 404) {
        // Endpoint not exposed — this is expected; report gracefully so
        // the admin UI shows "—" rather than a misleading "0".
        return {
          service: 'pudo',
          balance: null,
          unit: 'ZAR',
          metadata: { note: 'Pudo /account endpoint not exposed by their API' },
          fetchedAt,
          error:
            'No public balance endpoint — monitor via shipment-create flags',
        };
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          service: 'pudo',
          balance: null,
          unit: 'ZAR',
          metadata: { httpStatus: res.status, body: text.slice(0, 200) },
          fetchedAt,
          error: `HTTP ${res.status}`,
        };
      }

      const raw = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      // Pudo's account response shape isn't formally documented; we
      // probe a few plausible field names. If none match we still
      // record the raw so the operator can extend this mapping later.
      const balanceCandidate =
        (raw.balance as number | undefined) ??
        (raw.wallet_balance as number | undefined) ??
        (raw.account_balance as number | undefined) ??
        (raw.credit as number | undefined) ??
        null;

      return {
        service: 'pudo',
        balance: typeof balanceCandidate === 'number' ? balanceCandidate : null,
        unit: 'ZAR',
        metadata: { raw },
        fetchedAt,
        error:
          balanceCandidate == null
            ? 'Balance field missing — see raw metadata'
            : undefined,
      };
    } catch (err) {
      return {
        service: 'pudo',
        balance: null,
        unit: 'ZAR',
        metadata: null,
        fetchedAt,
        error: (err as Error).message,
      };
    }
  }

  // -------------------------------------------------------------------
  // fetchAll — runs every service in parallel via Promise.allSettled
  // so one slow/broken service can't block the others. Never throws —
  // settled rejections are converted to error rows on the way out.
  // Returns the array in a stable order so the UI grid is predictable.
  // -------------------------------------------------------------------
  // ─── TCG (The Courier Guy) ──────────────────────────────────────────
  //
  // TCG runs on Shiplogic at api.portal.thecourierguy.co.za with a
  // simple Bearer auth (TCG_API_KEY). Their billing API exposes the
  // prepaid wallet balance via GET /v2/account-balance. If you're on
  // a post-paid contract this returns 0 / null — that's expected, just
  // disable the alert toggle in that case.
  async fetchTcg(): Promise<CreditSnapshotResult> {
    const fetchedAt = new Date();
    const apiKey = process.env.TCG_API_KEY;
    const baseUrl =
      process.env.TCG_BASE_URL ?? 'https://api.portal.thecourierguy.co.za';

    if (!apiKey) {
      return {
        service: 'tcg',
        balance: null,
        unit: 'ZAR',
        metadata: null,
        fetchedAt,
        error: 'TCG_API_KEY not configured',
      };
    }

    try {
      // Shiplogic exposes /v2/account-balance for prepaid accounts.
      // Some accounts may also use /v2/account so we fall back to that
      // if the primary 404s.
      let res = await fetch(`${baseUrl}/v2/account-balance`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (res.status === 404) {
        res = await fetch(`${baseUrl}/v2/account`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          service: 'tcg',
          balance: null,
          unit: 'ZAR',
          metadata: { httpStatus: res.status, body: text.slice(0, 300) },
          fetchedAt,
          error:
            res.status === 404
              ? 'No balance endpoint on this TCG plan — likely post-paid'
              : `HTTP ${res.status}`,
        };
      }

      const raw = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;

      // Shiplogic isn't consistent across plans — probe the most likely
      // field names. balance, account_balance, available_balance, etc.
      // Falls back to null with raw payload so the operator can map.
      const balanceCandidate =
        (raw.balance as number | undefined) ??
        (raw.account_balance as number | undefined) ??
        (raw.available_balance as number | undefined) ??
        (raw.wallet_balance as number | undefined) ??
        ((raw.account as { balance?: number } | undefined)?.balance) ??
        null;

      return {
        service: 'tcg',
        balance: typeof balanceCandidate === 'number' ? balanceCandidate : null,
        unit: 'ZAR',
        metadata: { raw },
        fetchedAt,
        error:
          balanceCandidate == null
            ? 'Balance field missing — see raw metadata for mapping'
            : undefined,
      };
    } catch (err) {
      return {
        service: 'tcg',
        balance: null,
        unit: 'ZAR',
        metadata: null,
        fetchedAt,
        error: (err as Error).message,
      };
    }
  }

  async fetchAll(): Promise<CreditSnapshotResult[]> {
    const settled = await Promise.allSettled([
      this.fetchSmsPortal(),
      this.fetchVerifyNow(),
      this.fetchCloudinary(),
      this.fetchAnthropic(),
      this.fetchPudo(),
      this.fetchTcg(),
    ]);

    const services: CreditSnapshotResult['service'][] = [
      'smsportal',
      'verifynow',
      'cloudinary',
      'anthropic',
      'pudo',
      'tcg',
    ];

    return settled.map((s, i): CreditSnapshotResult => {
      if (s.status === 'fulfilled') return s.value;
      return {
        service: services[i],
        balance: null,
        unit: null,
        metadata: null,
        fetchedAt: new Date(),
        error: (s.reason as Error)?.message ?? 'Unknown fetch error',
      };
    });
  }

  // -------------------------------------------------------------------
  // History — read CreditSnapshot rows for one service, last N days.
  // Used by the per-service trend chart on /admin/credits.
  // Default 30 days. Caller may pass `days <= 0` to mean "1 day" so
  // the chart still renders even when querystring is malformed.
  // -------------------------------------------------------------------
  async history(service: string, days = 30) {
    const safeDays = Math.max(1, Math.min(365, Math.floor(days)));
    const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);
    return this.prisma.creditSnapshot.findMany({
      where: { service, fetchedAt: { gte: since } },
      orderBy: { fetchedAt: 'asc' },
      select: {
        id: true,
        service: true,
        balance: true,
        unit: true,
        fetchedAt: true,
        error: true,
      },
    });
  }

  // -------------------------------------------------------------------
  // Thresholds CRUD — operator-managed per-service alert levels.
  // -------------------------------------------------------------------
  async listThresholds() {
    return this.prisma.creditThreshold.findMany({
      orderBy: { service: 'asc' },
    });
  }

  async upsertThreshold(
    service: string,
    data: {
      warnThreshold?: number | null;
      alarmThreshold?: number | null;
      enabled?: boolean;
    },
  ) {
    return this.prisma.creditThreshold.upsert({
      where: { service },
      create: {
        service,
        warnThreshold: data.warnThreshold ?? null,
        alarmThreshold: data.alarmThreshold ?? null,
        enabled: data.enabled ?? true,
      },
      update: {
        warnThreshold: data.warnThreshold ?? null,
        alarmThreshold: data.alarmThreshold ?? null,
        enabled: data.enabled ?? true,
      },
    });
  }

  // -------------------------------------------------------------------
  // Lightweight test action per service — pings the API with a
  // non-billable call so the operator can confirm auth still works
  // without burning credits. Returns { ok: boolean, detail: string }.
  // -------------------------------------------------------------------
  async testService(service: string): Promise<{ ok: boolean; detail: string }> {
    switch (service) {
      case 'smsportal': {
        // Re-use the balance fetch — it's free and validates the auth.
        const r = await this.fetchSmsPortal();
        return {
          ok: r.balance !== null,
          detail: r.error ?? `Balance OK: ${r.balance} ${r.unit}`,
        };
      }
      case 'cloudinary': {
        // GET /ping is the cheapest authenticated round-trip Cloudinary
        // offers — returns { status: 'ok' } in <100ms.
        const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
        const apiKey = process.env.CLOUDINARY_API_KEY;
        const apiSecret = process.env.CLOUDINARY_API_SECRET;
        if (!cloudName || !apiKey || !apiSecret) {
          return { ok: false, detail: 'Cloudinary env vars not configured' };
        }
        try {
          const credentials = Buffer.from(`${apiKey}:${apiSecret}`).toString(
            'base64',
          );
          const res = await fetch(
            `https://api.cloudinary.com/v1_1/${cloudName}/ping`,
            {
              method: 'GET',
              headers: { Authorization: `Basic ${credentials}` },
              signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            },
          );
          return {
            ok: res.ok,
            detail: res.ok ? 'Ping OK' : `HTTP ${res.status}`,
          };
        } catch (err) {
          return { ok: false, detail: (err as Error).message };
        }
      }
      case 'verifynow': {
        const r = await this.fetchVerifyNow();
        return {
          ok: r.balance !== null,
          detail: r.error ?? `Balance OK: ${r.balance} ${r.unit}`,
        };
      }
      case 'anthropic': {
        // Smallest possible /v1/messages call — 1 max_tokens, a single
        // user message. Bills <$0.001 and validates the runtime
        // (non-admin) ANTHROPIC_API_KEY at the same time.
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          return { ok: false, detail: 'ANTHROPIC_API_KEY not configured' };
        }
        try {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'claude-haiku-4-5',
              max_tokens: 1,
              messages: [{ role: 'user', content: 'hi' }],
            }),
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });
          return {
            ok: res.ok,
            detail: res.ok
              ? 'API auth OK (1-token test message billed)'
              : `HTTP ${res.status}`,
          };
        } catch (err) {
          return { ok: false, detail: (err as Error).message };
        }
      }
      case 'pudo': {
        const r = await this.fetchPudo();
        // For Pudo we count "endpoint missing" as a partial success —
        // the auth at least round-tripped.
        return {
          ok: r.error == null || r.error.includes('endpoint'),
          detail: r.error ?? `Account OK: balance ${r.balance} ${r.unit}`,
        };
      }
      default:
        return { ok: false, detail: `Unknown service: ${service}` };
    }
  }

  // -------------------------------------------------------------------
  // Count services currently below their alarm threshold. Used by the
  // command-center attention queue and by the cron's alert logic.
  // Returns 0 when nothing is configured — never throws.
  // -------------------------------------------------------------------
  async countServicesBelowAlarm(): Promise<number> {
    const thresholds = await this.prisma.creditThreshold.findMany({
      where: { enabled: true, alarmThreshold: { not: null } },
    });
    if (thresholds.length === 0) return 0;

    let count = 0;
    for (const t of thresholds) {
      // Find the most recent snapshot for this service.
      const latest = await this.prisma.creditSnapshot.findFirst({
        where: { service: t.service, balance: { not: null } },
        orderBy: { fetchedAt: 'desc' },
        select: { balance: true },
      });
      if (
        latest?.balance != null &&
        t.alarmThreshold != null &&
        latest.balance <= t.alarmThreshold
      ) {
        count++;
      }
    }
    return count;
  }
}
