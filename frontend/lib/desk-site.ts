/**
 * THE DESK — everything the Site surface reads.
 *
 * Five of the legacy panel's pages land here rather than becoming five more
 * tabs: settings, alerts, credits, the audit trail and admin accounts. The
 * design is five flat surfaces, and a sixth and seventh tab would be the
 * first step back towards the twenty-item sidebar this rebuild exists to
 * replace. Settings, alerts and credits are sections of the board; the audit
 * trail and the admin roster are drawers, because they are records you
 * consult rather than surfaces you live in.
 */
import { deskFetch } from './desk-auth';

/* ── Settings ─────────────────────────────────────────────────────────── */

export interface SettingFlag {
  key: string;
  label: string;
  hint: string;
  group: string;
  type: string;
  default: string;
  currentValue: string;
}

/**
 * The only four keys the Desk exposes.
 *
 * ⚠️ EVERY OTHER FLAG IN THE REGISTRY STAYS OUT OF THE UI. There are dozens,
 * and most of them change what the public sees or spends real money. Those
 * change in code, with a commit and a reason — a dropdown in an admin panel
 * leaves no diff, no review and no answer to "who turned this on".
 *
 * whatsapp_enabled is the deliberate exception among the four: it is a kill
 * switch on a channel that has had this business restricted twice, and
 * needing a deploy to silence it is too slow.
 */
export const DESK_SETTING_KEYS = [
  'ops_alert_phone',
  'ops_alert_types',
  'ops_alert_quiet_hours',
  'whatsapp_enabled',
] as const;

export async function fetchDeskSettings(): Promise<SettingFlag[]> {
  const all = await deskFetch<SettingFlag[]>('/admin/settings');
  const wanted = new Set<string>(DESK_SETTING_KEYS);
  // Ordered as the Desk lists them, not as the registry happens to.
  return DESK_SETTING_KEYS.map((k) => all.find((f) => f.key === k)).filter(
    (f): f is SettingFlag => Boolean(f) && wanted.has(f!.key),
  );
}

/**
 * 🚨 THE SERVER'S REASON FLOORS, NOT A NUMBER THAT LOOKED SENSIBLE.
 * AdminSettingsService rejects a write whose reason is shorter than
 * REASON_MIN (3) — or DANGER_REASON_MIN (15) on a flag marked `danger`, and
 * whatsapp_enabled IS one, because it opens an outbound channel to real
 * phones. A UI that armed at five characters produced a guaranteed 400 on the
 * one switch that exists to be thrown in a hurry, and the operator met it as
 * a failed board rather than a full field. Mirror the floor or do not gate.
 */
export const SETTING_REASON_MIN = 3;
export const SETTING_DANGER_REASON_MIN = 15;

/** Which of the four the server treats as a danger flag. */
export const DANGER_SETTING_KEYS: readonly string[] = ['whatsapp_enabled'];

export function settingReasonMin(key: string): number {
  return DANGER_SETTING_KEYS.includes(key)
    ? SETTING_DANGER_REASON_MIN
    : SETTING_REASON_MIN;
}

/** ⚠️ Every write carries a reason. It lands in the audit trail. */
export function updateSetting(key: string, value: string, reason: string) {
  return deskFetch(`/admin/settings/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    body: JSON.stringify({ value, reason }),
  });
}

/* ── Alerts ───────────────────────────────────────────────────────────── */

export interface AdminAlertRow {
  id: string;
  type: string;
  context: string | null;
  urgent: boolean;
  resolved: boolean;
  createdAt: string;
  referenceId: string | null;
}

/**
 * ⚠️ THE ALERT INBOX IS A STAND-IN, AND THE UI SAYS SO. The build plan has
 * Warden replacing it: findings arrive in a chat, and what needs a human
 * becomes a Desk card. Warden is not deployed, so until it is, these rows
 * are the only place ~20 alert types surface at all — which is exactly the
 * "write-only alerts" problem the original audit found.
 *
 * 🚨 THE ENDPOINT RETURNS A BARE ARRAY. AdminService.listAlerts hands back
 * prisma.adminAlert.findMany(...) directly — there is no { rows, total }
 * envelope, and there never was. Typing one here and reading `.rows` off it
 * gave `undefined`, which the caller turned into an empty list: the inbox sat
 * at "0 unresolved · Nothing unresolved" no matter how many alerts were
 * waiting. That is the precise failure this board is written to avoid — a
 * quiet card reading as "nothing has gone wrong" when it means "nothing was
 * read". The envelope is still tolerated in case the endpoint ever grows one.
 */
export async function fetchAlerts(): Promise<AdminAlertRow[]> {
  const res = await deskFetch<AdminAlertRow[] | { rows?: AdminAlertRow[] }>(
    '/admin/alerts?resolved=false&limit=50',
  );
  if (Array.isArray(res)) return res;
  return Array.isArray(res?.rows) ? res.rows : [];
}

export function resolveAlert(id: string) {
  return deskFetch(`/admin/alerts/${encodeURIComponent(id)}/resolve`, { method: 'POST' });
}

/* ── Credits ──────────────────────────────────────────────────────────── */

/**
 * 🚨 THE WIRE SHAPE, NOT A PLAUSIBLE ONE. /admin/credits/snapshot returns
 * AdminCreditsService.fetchAll(): { service, balance, unit, metadata,
 * fetchedAt, error }. An earlier version of this type invented `vendor`,
 * `currency`, `checkedAt` and `belowThreshold` — so every row rendered a
 * blank name keyed on undefined, and the low-balance tag was a warning that
 * could never fire. A control that cannot go off is worse than no control:
 * it is read as "all vendors are fine" by a person who has no reason to
 * doubt it, on the same board whose own history is a service running to 28
 * credits with no warning anywhere.
 */
export interface CreditSnapshot {
  service: string;
  balance: number | null;
  unit: string | null;
  fetchedAt: string;
  error?: string;
}

/**
 * The floors the balance is judged against.
 *
 * ⚠️ SERVED SEPARATELY FROM THE BALANCE, which is why the flag needs a second
 * read. listThresholds() merges DEFAULT_THRESHOLDS in, so a service the
 * operator never configured still comes back with a floor.
 */
export interface CreditThreshold {
  service: string;
  warnThreshold: number | null;
  alarmThreshold: number | null;
  enabled: boolean;
}

export function fetchCredits(): Promise<CreditSnapshot[]> {
  return deskFetch('/admin/credits/snapshot');
}

export function fetchCreditThresholds(): Promise<CreditThreshold[]> {
  return deskFetch('/admin/credits/thresholds');
}

/**
 * Is this vendor low?
 *
 * ⚠️ ONLY WHERE THE THRESHOLDS ARE A FLOOR — warn ABOVE alarm. The anthropic
 * row encodes a daily SPEND CEILING in the same two columns (warn 10, alarm
 * 25, the wrong way round on purpose), and the legacy page compares it
 * downward anyway, so it sits permanently red whenever spend is normal. That
 * bug is not worth reproducing for symmetry: a vendor whose pair does not
 * read as a floor is left unflagged rather than flagged backwards.
 */
/**
 * ⚠️ NOT-CONFIGURED IS NOT A FAILURE, exactly as for a service probe. Pudo and
 * TCG are post-paid and Anthropic's admin key may be off, so those vendors
 * come back with an `error` that means "there is no balance to read here" —
 * amber on all of them trains the operator to skim past amber on the ones
 * that matter. Same test the legacy credits page uses.
 */
const NO_BALANCE_API = /no (public )?balance endpoint|may not be enabled|post-paid|not configured/i;

export function creditUnreadable(snap: CreditSnapshot): 'unconfigured' | 'failed' | null {
  if (!snap.error) return null;
  return NO_BALANCE_API.test(snap.error) ? 'unconfigured' : 'failed';
}

export function creditIsLow(
  snap: CreditSnapshot,
  threshold: CreditThreshold | undefined,
): boolean {
  if (!threshold || threshold.enabled === false) return false;
  if (snap.balance === null) return false;
  const { warnThreshold: warn, alarmThreshold: alarm } = threshold;
  if (warn === null || alarm === null || warn <= alarm) return false;
  return snap.balance <= warn;
}

/* ── Audit trail ──────────────────────────────────────────────────────── */

export interface AuditRow {
  id: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  reason: string | null;
  createdAt: string;
  adminUser: { email: string | null; firstName: string | null; lastName: string | null } | null;
}

/**
 * ⚠️ THE RECORD OF WHO DID WHAT. This is the single most dangerous page in
 * the legacy panel to lose, which is why it was the first thing built out of
 * the twenty-two: a money action that cannot be traced to a person is a money
 * action nobody can answer for.
 */
export function fetchAudit(opts: { resourceType?: string; limit?: number } = {}) {
  const p = new URLSearchParams();
  if (opts.resourceType) p.set('resourceType', opts.resourceType);
  p.set('limit', String(opts.limit ?? 50));
  return deskFetch<{ rows: AuditRow[]; total: number }>(`/admin/audit?${p.toString()}`);
}

/* ── Admin accounts ───────────────────────────────────────────────────── */

export interface AdminAccount {
  id: string;
  email: string;
  role: string;
  isActive?: boolean;
  createdAt?: string;
  lastLoginAt?: string | null;
}

/**
 * 🚨 THE ROSTER READS. IT DOES NOT GRANT AND IT DOES NOT REVOKE. An earlier
 * note here said this was "the only way to grant or revoke admin access",
 * which was the opposite of true: the drawer lists accounts and has no
 * control on any row. setAdminRole and deactivateAdmin below are the right
 * calls and nothing calls them; creating an admin has no call here at all.
 * Until buttons exist, adding, demoting or switching off an administrator is
 * still a legacy-page act, and /admin/admins is marked partial on the cutover
 * map for exactly that reason.
 *
 * Note the role that matters: MONITORING_ADMIN is meant to be read-only, and
 * the build plan records that it can currently perform mutating actions. The
 * roster shows the role so the operator can see who holds it; the server-side
 * fix is a separate piece of backend work.
 */
export function fetchAdmins(): Promise<AdminAccount[]> {
  return deskFetch('/admin/admins');
}

export function setAdminRole(id: string, role: string) {
  return deskFetch(`/admin/admins/${encodeURIComponent(id)}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}

export function deactivateAdmin(id: string) {
  return deskFetch(`/admin/admins/${encodeURIComponent(id)}/deactivate`, { method: 'POST' });
}

/** "2 Sep 09:14" — SAST, for a record you read rather than act on. */
export function stamp(iso: string): string {
  return new Date(iso).toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Johannesburg',
  });
}

/* ── System health: services, crons, queues ───────────────────────────
 *
 * The whole of the legacy /admin/health page, which the Site board could
 * previously only gesture at. Three cheap reads against endpoints that
 * already exist; nothing here needs a daemon on the box.
 *
 * ⚠️ THESE ARE NOT SERVER VITALS AND MUST NOT BE DRESSED AS THEM. CPU, disk
 * and memory still need Warden, and the vitals card says so. What follows is
 * different in kind: reachability probes of third parties, cron last-run
 * timestamps this process wrote itself, and four Prisma counts. Every one of
 * them has a real source, which is exactly why they are allowed on screen.
 */

export interface ServiceProbe {
  name: string;
  url: string;
  category: 'payment' | 'shipping' | 'kyc' | 'media' | 'search' | 'auth' | 'comms';
  /**
   * ⚠️ not-configured IS NOT down. The operator has not supplied the key, the
   * runtime disables the feature gracefully, and colouring it red trains
   * everyone to ignore the red.
   */
  status: 'up' | 'degraded' | 'down' | 'not-configured' | 'unknown';
  latencyMs: number | null;
  httpStatus: number | null;
  detail: string | null;
}

export interface CronRow {
  name: string;
  schedule: string;
  lastRunAt: string | null;
  expectedIntervalSec: number;
  /** 'never' is not always bad — a weekly job on a fresh box has never run. */
  status: 'ok' | 'stale' | 'never';
}

export interface QueueRow {
  label: string;
  count: number;
  thresholdWarn: number;
  thresholdAlarm: number;
  /** The legacy admin path that reproduces this count. See QUEUE_DESK_HREF. */
  href?: string;
}

export const fetchServices = () => deskFetch<ServiceProbe[]>('/admin/health/services');
export const fetchCrons = () => deskFetch<CronRow[]>('/admin/health/crons');
export const fetchQueues = () => deskFetch<QueueRow[]>('/admin/health/queues');

export const SERVICE_CATEGORY_LABEL: Record<ServiceProbe['category'], string> = {
  payment: 'Payment',
  shipping: 'Shipping',
  kyc: 'KYC',
  media: 'Media',
  search: 'Search',
  auth: 'Auth',
  comms: 'Comms',
};

/**
 * Where a queue card sends the operator ON THE DESK.
 *
 * ⚠️ THE href THE SERVER SENDS POINTS AT THE PANEL BEING DELETED. Rendering
 * it would ship a dead link the day the cutover lands, so the legacy path is
 * translated here and anything without an honest Desk destination gets none.
 * A card that does not link is a small loss; a card that lands the operator
 * on a 404 during an incident is a large one.
 */
export const QUEUE_DESK_HREF: Record<string, string> = {
  '/admin/listings?status=PENDING_REVIEW': '/admin/desk',
  '/admin/users?filter=kyc-outstanding': '/admin/desk/people',
};

export function queueTone(q: QueueRow): 'ok' | 'warn' | 'bad' {
  if (q.count >= q.thresholdAlarm) return 'bad';
  if (q.count >= q.thresholdWarn) return 'warn';
  return 'ok';
}

/** "4s ago" · "2d ago" — how old a reading is. */
export function ago(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

/* ── Trust and safety ─────────────────────────────────────────────────
 *
 * All five feeds of /admin/trust-safety, as one Site section rather than a
 * sixth tab.
 *
 * 🚨 EVERY ROW TYPE BELOW OMITS email, AND THE ENDPOINTS ALL RETURN ONE.
 * The legacy page printed an address under every username on five tables at
 * once — a hundred-odd contactable people on one scroll, none of which an
 * operator needs to decide anything. Username identifies the row; the person
 * is worked on from People. Leaving the field off the type is what stops it
 * coming back the next time someone adds a column.
 */

export interface RejectionRow {
  id: string;
  /** Where the filter tripped — a listing description, a question, a message. */
  channel: string;
  /** 'phone' | 'email' | 'url' | 'social-platform' | 'address' | ... */
  category: string;
  /**
   * ⚠️ THE BLOCKED TEXT ITSELF, CAPPED AT 200 CHARS SERVER-SIDE. It is
   * evidence — it usually IS a phone number or an address — so the section
   * keeps it folded and reveals one row at a time on a deliberate press.
   */
  sampleText: string;
  createdAt: string;
  user: { id: string; username: string | null } | null;
}

export interface RepeatOffenderRow {
  userId: string;
  username: string | null;
  rejectionCount: number;
  lastRejectionAt: string;
}

export interface ReportedQuestionRow {
  id: string;
  question: string;
  reportedCount: number;
  status: string;
  createdAt: string;
  listing: { id: string; title: string };
  asker: { username: string | null };
}

export interface ReportedListingRow {
  id: string;
  reason: string;
  createdAt: string;
  listing: { id: string; title: string } | null;
}

export interface ReportedSellerRow {
  id: string;
  reason: string;
  createdAt: string;
  seller: { id: string; username: string | null } | null;
}

export const fetchRejections = () =>
  deskFetch<RejectionRow[]>('/admin/trust-safety/rejections?limit=100');
export const fetchRepeatOffenders = () =>
  deskFetch<RepeatOffenderRow[]>('/admin/trust-safety/repeat-offenders');
export const fetchReportedQuestions = () =>
  deskFetch<ReportedQuestionRow[]>('/admin/trust-safety/reported-questions');
export const fetchReportedListings = () =>
  deskFetch<ReportedListingRow[]>('/admin/trust-safety/reported-listings');
export const fetchReportedSellers = () =>
  deskFetch<ReportedSellerRow[]>('/admin/trust-safety/reported-sellers');
