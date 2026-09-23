'use client';

/**
 * ADMIN API CLIENT — the Warden panel's only door to the backend.
 *
 * ⚠️ AUTHORIZATION IS A BEARER TOKEN, NOT THE COOKIE. AdminJwtGuard reads
 * `Authorization: Bearer <jwt>` only; the `gg_admin_sess` cookie the login
 * route also sets is deliberately ignored by the guard (it exists for the
 * legacy surface). So the access token has to live somewhere the client can
 * read, and this module owns that store.
 *
 * ⚠️ REFRESH IS SINGLE-FLIGHT. Several polled cards 401 at once when the
 * fifteen-minute access token lapses; without the shared promise each one
 * would rotate the refresh token and the losers of that race would revoke the
 * session (the exact two-tab bug the backend's grace window exists to blunt).
 * `refreshInFlight` makes the whole panel refresh once.
 *
 * ⚠️ EVERY READ IS `no-store`. The panel is viewer-varying by definition.
 */

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const ACCESS_KEY = 'gg_admin_access';
const REFRESH_KEY = 'gg_admin_refresh';
const EXPIRES_KEY = 'gg_admin_expires';

export interface AdminIdentity {
  id: string;
  email: string;
  role: 'SUPERADMIN' | 'MONITORING_ADMIN' | 'ADMIN' | string;
  [key: string]: unknown;
}

export interface AdminLoginResult {
  token: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  refreshExpiresAt?: string;
  admin: AdminIdentity;
}

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

// ── Token store ───────────────────────────────────────────────────────

function safeGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private mode — the panel simply will not survive a reload */
  }
}

export const adminTokens = {
  access(): string | null {
    return safeGet(ACCESS_KEY);
  },
  refresh(): string | null {
    return safeGet(REFRESH_KEY);
  },
  expiresAt(): string | null {
    return safeGet(EXPIRES_KEY);
  },
  set(result: {
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
  }) {
    safeSet(ACCESS_KEY, result.accessToken);
    safeSet(REFRESH_KEY, result.refreshToken);
    safeSet(EXPIRES_KEY, result.expiresAt);
  },
  clear() {
    safeSet(ACCESS_KEY, null);
    safeSet(REFRESH_KEY, null);
    safeSet(EXPIRES_KEY, null);
  },
  /** True when there is no token at all, or it expired more than a minute ago. */
  isExpired(): boolean {
    const raw = safeGet(EXPIRES_KEY);
    if (!raw) return true;
    const at = new Date(raw).getTime();
    if (Number.isNaN(at)) return true;
    return at < Date.now() - 60_000;
  },
};

// ── Raw fetch ─────────────────────────────────────────────────────────

async function raw<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      const parsed = JSON.parse(text) as { message?: string | string[] };
      if (parsed?.message) {
        message = Array.isArray(parsed.message)
          ? parsed.message.join(', ')
          : parsed.message;
      }
    } catch {
      /* not JSON — keep the raw text */
    }
    throw new AdminApiError(res.status, message || `API ${res.status}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

// ── Refresh (single-flight) ───────────────────────────────────────────

let refreshInFlight: Promise<AdminLoginResult> | null = null;

async function refreshTokens(): Promise<AdminLoginResult> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = adminTokens.refresh();
    if (!refreshToken) throw new AdminApiError(401, 'No admin session.');
    const issued = await raw<AdminLoginResult>('/admin/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
    adminTokens.set({
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresAt: issued.expiresAt,
    });
    return issued;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

/**
 * The panel's fetch. Attaches the access token, and on a single 401 rotates
 * once and retries the original request.
 */
export async function adminFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const withAuth = (token: string | null): RequestInit => ({
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!adminTokens.access() || adminTokens.isExpired()) {
    try {
      await refreshTokens();
    } catch {
      /* fall through — the request below will surface the 401 */
    }
  }

  try {
    return await raw<T>(path, withAuth(adminTokens.access()));
  } catch (err) {
    if (err instanceof AdminApiError && err.status === 401) {
      await refreshTokens();
      return raw<T>(path, withAuth(adminTokens.access()));
    }
    throw err;
  }
}

// ── Auth calls ────────────────────────────────────────────────────────

export async function adminLogin(input: {
  email: string;
  password: string;
  totpCode?: string;
  recoveryCode?: string;
}): Promise<AdminLoginResult> {
  const result = await raw<AdminLoginResult>('/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  adminTokens.set({
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresAt: result.expiresAt,
  });
  return result;
}

export async function adminLogout(): Promise<void> {
  const refreshToken = adminTokens.refresh();
  try {
    await raw('/admin/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    /* the local clear below is what matters */
  }
  adminTokens.clear();
}

export async function adminMe(): Promise<AdminIdentity> {
  return adminFetch<AdminIdentity>('/admin/auth/me');
}

/**
 * A binary admin read — the KYC document stream.
 *
 * ⚠️ IT CANNOT BE A PLAIN <img src>. `GET /admin/users/:id/kyc-file/:which`
 * is behind AdminJwtGuard, which reads an Authorization header the browser
 * will not attach to an image request. The bytes come through here, into a
 * blob URL that is revoked by the caller when the drawer closes.
 */
export async function adminFetchBlob(path: string): Promise<Blob> {
  if (!adminTokens.access() || adminTokens.isExpired()) {
    try {
      await refreshTokens();
    } catch {
      /* the 401 below is the honest answer */
    }
  }

  const attempt = async (token: string | null) => {
    const res = await fetch(`${API_URL}${path}`, {
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      // ⚠️ THE BACKEND'S MESSAGE IS THE USEFUL PART. A bare "API 404" tells the
      // operator nothing; the KYC route answers with "No stored file for this
      // user. It may still be on the old CDN" — which is the whole explanation.
      let message = `API ${res.status}`;
      try {
        const body = (await res.json()) as { message?: string | string[] };
        if (body?.message) {
          message = Array.isArray(body.message)
            ? body.message.join(', ')
            : body.message;
        }
      } catch {
        /* not JSON — keep the status line */
      }
      throw new AdminApiError(res.status, message);
    }
    return res.blob();
  };

  try {
    return await attempt(adminTokens.access());
  } catch (err) {
    if (err instanceof AdminApiError && err.status === 401) {
      await refreshTokens();
      return attempt(adminTokens.access());
    }
    throw err;
  }
}

// ── Response shapes (permissive: the panel renders defensively) ───────

export interface AttentionQueue {
  pendingListings: number;
  kycStalled: number;
  dispatchSlaAtRisk: number;
  disputedPayments: number;
  unresolvedAlerts: number;
  feeBypassAttempts7d: number;
  creditsBelowAlarm: number;
  salesAwaitingAccept: number;
  dealerVerificationsPendingReview: number;
}

export interface TodayPulse {
  gmvCents: number;
  salesCount: number;
  newUsers: number;
  newListings: number;
}

export interface ActivityEvent {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  href?: string;
  occurredAt: string;
  urgent?: boolean;
}

export interface ServiceProbe {
  name: string;
  url: string;
  category: string;
  status: 'up' | 'degraded' | 'down' | 'not-configured' | 'unknown';
  latencyMs: number | null;
  httpStatus: number | null;
  detail: string | null;
}

export interface CronStatus {
  name: string;
  schedule: string;
  status: 'ok' | 'stale' | 'never';
  lastRunAt: string | null;
  expectedIntervalSec: number;
}

export interface QueueDepth {
  label: string;
  count: number;
  thresholdWarn: number;
  thresholdAlarm: number;
  href?: string;
}

/**
 * ⚠️ NO LONGER RENDERED, DELIBERATELY. The Insights board's flag table was
 * removed 2026-09-22 — these are rules the codebase has already decided, and
 * the operator does not want an off switch for a decision. The type stays
 * because the endpoint and the registry are still real and are still used
 * deliberately around a deploy.
 */
export interface SettingFlag {
  key: string;
  label: string;
  hint: string;
  group: string;
  type: 'boolean' | 'number' | 'text' | 'percent';
  default: string;
  /**
   * ⚠️ THE LIVE VALUE IS `currentValue`, NOT `value`. AdminSettingsService.list()
   * hangs the stored override off that name; reading `value` silently fell back
   * to `default` for every flag, so the board rendered the factory state and not
   * the database's.
   */
  currentValue?: string;
  /** Retained for older payloads; prefer `currentValue`. */
  value?: string;
  danger?: true;
}

export interface ByCategory {
  categoryName: string;
  count: number;
  gmvCents: number;
  [key: string]: unknown;
}

export interface TopMakeModel {
  make: string;
  model: string;
  count: number;
  gmvCents: number;
  avgPriceCents: number;
  [key: string]: unknown;
}

export interface AlertCount {
  unresolved: number;
  urgent: number;
}

export interface PayoutsDue {
  payouts?: Array<{
    transactionId?: string;
    sellerId?: string;
    username?: string;
    amountCents?: number;
    [key: string]: unknown;
  }>;
  refunds?: unknown[];
  skipped?: Array<Record<string, unknown>>;
  totalCents?: number;
  [key: string]: unknown;
}

export interface HeldFunds {
  [key: string]: unknown;
}

export interface AdminUserRow {
  id: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  kycStatus?: string | null;
  sellerTier?: string | null;
  isBanned?: boolean;
  createdAt?: string;
  [key: string]: unknown;
}

/**
 * The member record as the dossier returns it.
 *
 * ⚠️ `idNumberEncrypted` IS NOT HERE, AND ITS ABSENCE IS THE DESIGN. The
 * backend selects it only to derive `hasIdNumber` and strips it before the
 * response — the number itself comes from `revealIdNumber()`, which is a
 * separate, audited ask. If this interface ever grows a raw ID field, something
 * has gone wrong upstream.
 */
export interface AdminUserProfile extends AdminUserRow {
  emailVerifiedAt?: string | null;
  phone?: string | null;
  phoneVerified?: boolean;
  dateOfBirth?: string | null;
  avatarUrl?: string | null;
  lastLoginAt?: string | null;
  failedLoginCount?: number;
  lockedUntil?: string | null;

  addrBuilding?: string | null;
  addrStreet?: string | null;
  addrAddress2?: string | null;
  addrSuburb?: string | null;
  addrCity?: string | null;
  addrPostalCode?: string | null;
  addrProvince?: string | null;

  sellerTier?: string | null;
  trustScore?: number | null;
  averageRating?: number | null;
  totalSales?: number | null;
  profileCompletedAt?: string | null;

  kycMethod?: string | null;
  kycTier?: string | null;
  kycRequiredAt?: string | null;
  kycVerifiedAt?: string | null;
  kycIdVerifiedAt?: string | null;
  kycConsentGivenAt?: string | null;
  kycAttempts?: number | null;
  kycFaceMatchScore?: number | null;
  kycFaceMatchStatus?: string | null;
  kycReviewedAt?: string | null;
  kycReviewNote?: string | null;
  kycClaudeFindings?: unknown;
  /** Presence only — the bytes come from the authenticated media route. */
  hasIdNumber?: boolean;

  bankName?: string | null;
  bankAccountHolder?: string | null;
  bankAccountNumber?: string | null;
  bankBranchCode?: string | null;
  bankAccountType?: string | null;
  bankVerifiedAt?: string | null;
  bankAvsResult?: string | null;

  isBanned?: boolean;
  bannedAt?: string | null;
  accountClosedAt?: string | null;
  auctionStrikes?: number;
  dispatchStrikes?: number;
  sellerRejectStrikes?: number;
  sellingBannedAt?: string | null;
  lastStrikeAt?: string | null;

  termsAcceptedAt?: string | null;
  privacyConsentAt?: string | null;
  ageAffirmedAt?: string | null;
  consentPolicyVersion?: string | null;
  marketingConsentAt?: string | null;
  documentVaultConsentVersion?: string | null;
  documentVaultConsentAt?: string | null;
  documentVaultConsentWithdrawnAt?: string | null;

  notifyEmailEnabled?: boolean;
  notifySmsEnabled?: boolean;
  notifyOffersEnabled?: boolean;
  notifyWhatsappEnabled?: boolean;
  notifyFallbackChannel?: string | null;

  defaultWeightGrams?: number | null;
  defaultLengthCm?: number | null;
  defaultWidthCm?: number | null;
  defaultHeightCm?: number | null;

  zohoContactId?: string | null;
}

/** Everything the dossier endpoint returns for one member. */
export interface AdminUserDossier {
  user: AdminUserProfile;
  listings?: Array<Record<string, unknown>>;
  buyerTransactions?: Array<Record<string, unknown>>;
  sellerTransactions?: Array<Record<string, unknown>>;
  buyerOffers?: Array<Record<string, unknown>>;
  bids?: Array<Record<string, unknown>>;
  ratingsReceived?: Array<Record<string, unknown>>;
  ratingsGiven?: Array<Record<string, unknown>>;
  auditEvents?: Array<Record<string, unknown>>;
  systemAlerts?: Array<Record<string, unknown>>;
  complaintsLodged?: Array<Record<string, unknown>>;
  complaintsAgainst?: Array<Record<string, unknown>>;
  closure?: Record<string, unknown> | null;
}

/**
 * Ask for the member's SA ID number.
 *
 * ⚠️ THIS IS AN AUDITED ACTION, not a field read. Every call writes an
 * AdminAuditEvent naming the admin and the member, so the button on the profile
 * is deliberately a deliberate act. `mask` comes back with it so the caller can
 * show `840912••••083` without re-deriving the mask.
 */
export async function revealIdNumber(
  userId: string,
): Promise<{ idNumber: string; masked: string }> {
  return adminFetch<{ idNumber: string; masked: string }>(
    `/admin/users/${encodeURIComponent(userId)}/id-number`,
  );
}

export interface Paginated<T> {
  rows?: T[];
  total?: number;
  page?: number;
  limit?: number;
  [key: string]: unknown;
}

export interface TransactionRow {
  id: string;
  paymentStatus?: string;
  amountCents?: number;
  buyerTotal?: number;
  createdAt?: string;
  listing?: { title?: string } | null;
  buyer?: { username?: string } | null;
  seller?: { username?: string } | null;
  [key: string]: unknown;
}

export interface ListingRow {
  id: string;
  title?: string;
  description?: string;
  price?: number;
  isFirearm?: boolean;
  status?: string;
  createdAt?: string;
  category?: { name?: string } | null;
  [key: string]: unknown;
}

export interface PostRow {
  id: string;
  title?: string;
  body?: string;
  type?: string;
  status?: string;
  graphicTier?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface AnalyticsOverview {
  gmvCents: number;
  gmvCentsPrev: number;
  revenueCents: number;
  revenueCentsPrev: number;
  txCount: number;
  txCountPrev: number;
  aovCents: number;
  aovCentsPrev: number;
  refundRate: number;
  refundRatePrev: number;
  disputeRate: number;
  disputeRatePrev: number;
  [key: string]: unknown;
}

export interface TimeSeriesPoint {
  bucket: string;
  gmvCents: number;
  revenueCents: number;
  count: number;
  [key: string]: unknown;
}

// ── The Warden daemon ─────────────────────────────────────────────────
//
// ⚠️ HAND-MIRRORED FROM backend/src/admin/warden.types.ts, WHICH IS ITSELF
// HAND-MIRRORED FROM warden/src/types.ts. There is no import path across those
// three trees, and a divergence is silent on every side — a message kind the
// panel cannot name renders an `undefined` tag. backend/src/admin/warden.spec.ts
// reads this file's component (components/admin/warden-thread.tsx) off disk and
// holds the first leg of that mirror.

export type WardenMessageKind =
  | 'finding'
  | 'fixed'
  | 'red-gate'
  | 'proposal'
  | 'ran'
  | 'note';

export interface WardenPre {
  /** `inset` is a proposal's dry run (what WOULD happen); `ground` is the
   *  transcript of something that already ran. Never the same, at a glance. */
  tone: 'inset' | 'ground';
  lines: string[];
}

export interface WardenChatMessage {
  id: string;
  role: 'warden' | 'operator';
  kind: WardenMessageKind;
  at: string;
  body: string[];
  pre?: WardenPre;
  proposalId?: string;
  footnote?: string;
}

export type WardenProposalKind = 'proposal' | 'red_gate';
export type WardenProposalStatus = 'pending' | 'approved' | 'declined' | 'acknowledged';

export interface WardenProposal {
  id: string;
  kind: WardenProposalKind;
  status: WardenProposalStatus;
  headline: string;
  diagnosis: string;
  /** EXACTLY what Approve will run. Null for a red gate, which has nothing. */
  command: string | null;
  /** The safe-list operation name, or null when the model drafted it free-hand.
   *  null is the STRONGER warning: it means nothing bounds this command. */
  operationName: string | null;
  /** Explicit true, or not reversible. Never inferred from the command. */
  reversible: boolean;
  gateKey: string | null;
  raisedAt: string;
}

export interface WardenPause {
  until: string;
  since: string;
  operatorId: string | null;
  reason: string | null;
}

export interface WardenChat {
  present: boolean;
  /** `not_deployed` and `unreachable` are opposite facts and must not render
   *  the same: the first means nothing can be waiting, the second means a
   *  proposal may be waiting on a list this process never read. */
  absence: 'not_deployed' | 'unreachable' | null;
  note?: string;
  lastCheckAt: string | null;
  messages: WardenChatMessage[];
  proposals: WardenProposal[];
  paused: WardenPause | null;
}

export interface WardenCheckRow {
  id: string;
  title: string;
  status: 'ok' | 'warn' | 'bad' | 'unknown';
  verdict: string;
  gateKey: string | null;
  standing: boolean;
  measuredAt: string;
  fresh: boolean;
}

export interface WardenCheckBoard {
  lastCheckAt: string | null;
  counts: { ok: number; warn: number; bad: number; unknown: number };
  dropped: number;
  rows: WardenCheckRow[];
  paused: WardenPause | null;
}

export interface WardenBoardView {
  present: boolean;
  absence: 'not_deployed' | 'unreachable' | null;
  note?: string;
  board: WardenCheckBoard | null;
}

export interface WardenTruncatedText {
  text: string;
  truncated: boolean;
  originalBytes: number;
}

export interface WardenAuditEntry {
  id: string;
  proposalId: string;
  at: string;
  finishedAt: string;
  durationMs: number;
  trigger: 'unattended' | 'operator_approved';
  operatorId: string | null;
  operationKind: 'safe_list' | 'approved_command';
  operationName: string | null;
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  stdout: WardenTruncatedText;
  stderr: WardenTruncatedText;
  redactions: string[];
  recheck: { at: string; result: 'ok' | 'still-bad' | 'unknown'; note: string } | null;
}

export interface WardenAuditView {
  present: boolean;
  note?: string;
  entries: WardenAuditEntry[];
  truncated: boolean;
  /** Runs neither side could render. A silent drop is a false alibi — never
   *  fold this into `truncated`, which only means "there is more, ask for it". */
  dropped: number;
}

export interface WardenSweepResult {
  /** ⚠️ false IS NOT A FAILURE. The sweep was started and is still running;
   *  the daemon answered early rather than outliving nginx's cut. */
  finished: boolean;
  forced: boolean;
  joined: boolean;
  board: WardenCheckBoard;
}

export async function wardenChat(): Promise<WardenChat> {
  return adminFetch<WardenChat>('/admin/warden/chat');
}

export async function wardenSend(message: string): Promise<{ messages: WardenChatMessage[] }> {
  return adminFetch<{ messages: WardenChatMessage[] }>('/admin/warden/chat', {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

/**
 * ⚠️ MONEY-GRADE. `expectedCommand` is echoed back verbatim; the backend
 * re-reads the proposal and refuses on any difference. Never trim it.
 */
export async function wardenApprove(
  id: string,
  expectedCommand: string,
  reason?: string,
): Promise<{ ok: boolean; proposalId: string; command: string; messages: WardenChatMessage[] }> {
  return adminFetch(`/admin/warden/proposals/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    body: JSON.stringify({ expectedCommand, ...(reason ? { reason } : {}) }),
  });
}

export async function wardenDecline(
  id: string,
  reason?: string,
): Promise<{ ok: boolean; proposalId: string; messages: WardenChatMessage[] }> {
  return adminFetch(`/admin/warden/proposals/${encodeURIComponent(id)}/decline`, {
    method: 'POST',
    body: JSON.stringify(reason ? { reason } : {}),
  });
}

export async function wardenBoard(): Promise<WardenBoardView> {
  return adminFetch<WardenBoardView>('/admin/warden/board');
}

export async function wardenAudit(proposalId?: string): Promise<WardenAuditView> {
  const qs = proposalId ? `?proposalId=${encodeURIComponent(proposalId)}` : '';
  return adminFetch<WardenAuditView>(`/admin/warden/audit${qs}`);
}

export async function wardenSweep(): Promise<WardenSweepResult> {
  return adminFetch<WardenSweepResult>('/admin/warden/sweep', { method: 'POST' });
}

export async function wardenPause(
  minutes?: number,
  reason?: string,
): Promise<{ ok: boolean; paused: WardenPause | null; messages: WardenChatMessage[] }> {
  return adminFetch('/admin/warden/pause', {
    method: 'POST',
    body: JSON.stringify({ ...(minutes ? { minutes } : {}), ...(reason ? { reason } : {}) }),
  });
}

export async function wardenResume(): Promise<{
  ok: boolean;
  paused: null;
  messages: WardenChatMessage[];
}> {
  return adminFetch('/admin/warden/resume', { method: 'POST' });
}

// ── Formatters ────────────────────────────────────────────────────────

export function formatRand(cents: number | null | undefined): string {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return 'R0';
  const rands = cents / 100;
  return `R${rands.toLocaleString('en-ZA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

export function formatRandExact(cents: number | null | undefined): string {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return 'R0.00';
  return `R${(cents / 100).toLocaleString('en-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatWhen(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
