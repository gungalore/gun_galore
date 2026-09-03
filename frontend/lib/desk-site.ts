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
/**
 * ⚠️ THE WARDEN KIND UNION IS IMPORTED, NOT RETYPED. It is the tag the
 * operator reads — "fixed alone" against "red gate" is the difference between
 * a note and an emergency — and it already exists twice: chat.tsx's KIND_TAG
 * and the backend's WARDEN_MESSAGE_KINDS, which its own header says must not
 * be extended on one side alone. A third copy here is a third thing to
 * forget. Type-only, so nothing is bundled.
 */
import type { WardenKind } from '@/components/desk/chat';

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
 * The roster, and the three writes that act on it.
 *
 * 🚨 THIS USED TO READ AND NOTHING ELSE, WHICH IS WHY IT MATTERED. After the
 * cutover deleted the legacy panel, setAdminRole and deactivateAdmin existed
 * here with NO caller and there was no create call at all — so a database
 * write was the only way to remove a compromised administrator. The drawer on
 * the Site board now calls all three.
 *
 * ⚠️ THE SERVER IS THE AUTHORITY, NOT THIS FILE. Every rule below is enforced
 * in AdminService and re-read from the database, so a forged JWT cannot talk
 * its way past them:
 *   · only a SUPERADMIN may create, change a role, or deactivate;
 *   · you cannot change your OWN role ("ask another Full admin");
 *   · you cannot deactivate yourself.
 * Those last two together are what make a lockout unreachable: the sole Full
 * admin can neither demote nor switch off the only account that could undo it.
 * Do NOT re-implement any of this here — a second copy is a second set of
 * rules, and the drifted one is the one nobody reads. Surface the server's
 * refusal instead.
 */
export function fetchAdmins(): Promise<AdminAccount[]> {
  return deskFetch('/admin/admins');
}

/**
 * ⚠️ THE EMAIL MUST ALREADY BE A MEMBER. createAdmin looks the address up in
 * the User table and refuses when it finds nothing — an admin account is a
 * promotion of someone who has signed up, never an invitation to a stranger.
 * The server says so in words; this passes that through untouched.
 */
export function createAdmin(email: string, role: AdminRoleValue) {
  return deskFetch('/admin/admins', {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  });
}

export function setAdminRole(id: string, role: AdminRoleValue) {
  return deskFetch(`/admin/admins/${encodeURIComponent(id)}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}

export function deactivateAdmin(id: string) {
  return deskFetch(`/admin/admins/${encodeURIComponent(id)}/deactivate`, { method: 'POST' });
}

/**
 * The two roles the server will accept, mirroring ASSIGNABLE_ROLES in
 * backend/src/admin/dto/create-admin.dto.ts. The legacy `ADMIN` tier still
 * exists on old rows and is rendered where it appears, but it is deliberately
 * not offered: assigning it would add a third meaning to a field that already
 * has one too many.
 */
export const ASSIGNABLE_ROLES = ['SUPERADMIN', 'MONITORING_ADMIN'] as const;
export type AdminRoleValue = (typeof ASSIGNABLE_ROLES)[number];

/**
 * ✅ "MONITORING ADMIN" IS NOW GENUINELY READ-ONLY, AND THIS COPY CHANGED ONLY
 * BECAUSE THAT BECAME TRUE. Until 2026-09-03 it was a label with no teeth:
 * SuperadminGuard sat on exactly the three admin-management routes and every
 * other admin endpoint took any logged-in admin, so the tier could release a
 * payout, refund a buyer and ban a member. This file refused to call it
 * read-only for exactly as long as that was the case.
 *
 * AdminJwtGuard now enforces it for every route behind admin auth: safe
 * methods open to any active admin, every mutating method SUPERADMIN-only,
 * deny-by-default rather than an allow-list — and the role is read off the
 * AdminUser row on each request, not out of the 8-hour token, so a demotion
 * bites on the next request.
 *
 * ⚠️ IF THAT GUARD IS EVER WEAKENED, THIS SENTENCE BECOMES A LIE BEFORE
 * ANYTHING ELSE DOES. A picker promising read-only over an unenforced tier
 * hands somebody full control while its author believes they granted a
 * viewer — worse than having no picker at all. desk-admins.spec.ts pins the
 * pairing; change both together or neither.
 */
export const ADMIN_ROLE_LABEL: Record<string, string> = {
  SUPERADMIN: 'Full admin',
  MONITORING_ADMIN: 'Monitoring admin',
  ADMIN: 'Admin (legacy)',
};

export const ADMIN_ROLE_NOTE: Record<AdminRoleValue, string> = {
  SUPERADMIN: 'Everything, including adding and removing administrators.',
  MONITORING_ADMIN:
    'Can see everything and change nothing — no payouts, no refunds, no decisions on members or listings. Takes effect immediately, including on anyone already signed in.',
};

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

/* ── Warden ───────────────────────────────────────────────────────────
 *
 * The Site tab is a conversation, and this is the wire to the other side of
 * it. Warden does NOT run in the API process: it is a daemon on the box, and
 * backend/src/desk/warden.service.ts is an authenticated door to it that
 * fails closed on WARDEN_BASE_URL / WARDEN_TOKEN.
 *
 * 🚨 ABSENT AND QUIET LOOK IDENTICAL AND MEAN OPPOSITE THINGS. `present` is
 * read as `=== true` below and defaults to false on anything the server did
 * not explicitly assert — an unreachable daemon, an older build with no such
 * route, a body that is not the shape expected. A chat card rendering an
 * empty thread under a green badge says "nothing has gone wrong" when it
 * means "nothing is watching", which is the failure this whole surface
 * exists to prevent.
 */

export interface WardenPre {
  /** `inset` is a dry run — what WOULD happen. `ground` already ran. */
  tone: 'inset' | 'ground';
  lines: string[];
}

export interface WardenChatMessage {
  id: string;
  role: 'warden' | 'operator';
  kind: WardenKind;
  at: string;
  /** Paragraphs, already split. Warden writes prose, not markdown. */
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
  /** EXACTLY what "Approve the fix…" runs. Null on a red gate, which has nothing to run. */
  command: string | null;
  gateKey: string | null;
  raisedAt: string;
}

export interface WardenChat {
  present: boolean;
  note?: string;
  /** Null while unknown. NEVER `now` — a guessed check time reads as a check. */
  lastCheckAt: string | null;
  messages: WardenChatMessage[];
  proposals: WardenProposal[];
}

/** What the card shows when the fetch itself failed: absent, with the reason. */
export function wardenAbsent(note: string): WardenChat {
  return { present: false, note, lastCheckAt: null, messages: [], proposals: [] };
}

export async function fetchWardenChat(): Promise<WardenChat> {
  const raw = await deskFetch<Partial<WardenChat> | null>('/admin/warden/chat');
  return {
    present: raw?.present === true,
    note: typeof raw?.note === 'string' ? raw.note : undefined,
    lastCheckAt: raw?.lastCheckAt ?? null,
    messages: Array.isArray(raw?.messages) ? raw.messages : [],
    proposals: Array.isArray(raw?.proposals) ? raw.proposals : [],
  };
}

/** React, refuse, ask or instruct. 503s when no Warden is configured. */
export async function sendWardenChat(message: string): Promise<WardenChatMessage[]> {
  const res = await deskFetch<{ messages?: WardenChatMessage[] }>('/admin/warden/chat', {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
  return Array.isArray(res?.messages) ? res.messages : [];
}

/**
 * 🚨 MONEY-GRADE, AND THE COMMAND IS THE COMPARE-AND-SWAP. `expectedCommand`
 * is the exact string the confirm dialog restated; the server re-reads the
 * proposal from Warden and 409s on any difference. Never send anything but
 * the command the operator actually read — a confirm that restates one thing
 * and runs another is worse than no confirm, because it is one they have
 * learned to trust.
 *
 * ⚠️ AND IT NEVER UNDOES. This ends in a command running on the production
 * box. There is no undo window here and there must not be one.
 */
export async function approveWardenProposal(
  id: string,
  expectedCommand: string,
  reason?: string,
): Promise<WardenChatMessage[]> {
  const res = await deskFetch<{ messages?: WardenChatMessage[] }>(
    `/admin/warden/proposals/${encodeURIComponent(id)}/approve`,
    { method: 'POST', body: JSON.stringify({ expectedCommand, reason: reason || undefined }) },
  );
  return Array.isArray(res?.messages) ? res.messages : [];
}

/** Refuse a fix. Warden reads declines back as standing guidance. */
export async function declineWardenProposal(
  id: string,
  reason?: string,
): Promise<WardenChatMessage[]> {
  const res = await deskFetch<{ messages?: WardenChatMessage[] }>(
    `/admin/warden/proposals/${encodeURIComponent(id)}/decline`,
    { method: 'POST', body: JSON.stringify({ reason: reason || undefined }) },
  );
  return Array.isArray(res?.messages) ? res.messages : [];
}

/**
 * The only four, shaped for the panel.
 *
 * ⚠️ THE PHONE ARRIVES MASKED AND THIS ENDPOINT HAS NO RAW FOR IT. The board
 * is screenshotted into support threads and read over shoulders; the edit
 * field prefills from /admin/settings instead, which is a deliberate open
 * rather than a passive render. `raw` is present only where the value is not
 * personal data — a flag, a list of alert types.
 */
export interface WardenSettingRow {
  key: string;
  label: string;
  kind: 'phone' | 'checkboxes' | 'toggle';
  display: string;
  raw?: string;
  items?: { value: string; label: string; checked: boolean }[];
  /** True when PATCH /admin/settings accepts it. Not a claim that this endpoint writes it. */
  editable: boolean;
  note: string;
}

export async function fetchWardenSettings(): Promise<WardenSettingRow[]> {
  const res = await deskFetch<{ rows?: WardenSettingRow[] }>('/admin/warden/settings');
  return Array.isArray(res?.rows) ? res.rows : [];
}

/**
 * "09:14" for today, "2 Sep 09:14" for anything older, "never" for null.
 *
 * ⚠️ SAST, EXPLICITLY. The board is read from one country and the box runs in
 * UTC; a cron that "last ran 02:10" is a different fact from one that last
 * ran 04:10, and the difference is the two hours nobody notices.
 */
export function clock(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const zone = { timeZone: 'Africa/Johannesburg' } as const;
  const sameDay =
    d.toLocaleDateString('en-ZA', zone) === new Date().toLocaleDateString('en-ZA', zone);
  return sameDay
    ? d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false, ...zone })
    : stamp(iso);
}

/* ── The WhatsApp reply drawer's entrance ─────────────────────────────
 *
 * 🚨 THE DRAWER EXISTS AND NOTHING OPENED IT. components/desk/whatsapp-drawer
 * was built against /admin/desk/whatsapp/*, and `whatsapp_reply` sits in the
 * DeskCardType union with nothing emitting it — so the whole feature was
 * unreachable and neither file said so by reading it. This is the door: the
 * same deep link the broadcast drawer already uses (?send=1), so the pile
 * card has a destination that exists today rather than one somebody has to
 * remember to build, and so a thread can be opened by hand right now.
 *
 * ⚠️ THE ID IS VALIDATED BEFORE IT IS BELIEVED. It comes off the address bar,
 * goes straight into a fetch path and is rendered in a drawer header. The
 * same character class the backend enforces on a Warden proposal id is
 * enforced here, so a crafted link cannot walk the API path.
 */
export const WHATSAPP_PARAM = 'whatsapp';

export function parseWhatsappThreadId(search: string): string | null {
  const id = (new URLSearchParams(search).get(WHATSAPP_PARAM) ?? '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

export function stripWhatsappParam(search: string): string {
  const p = new URLSearchParams(search);
  p.delete(WHATSAPP_PARAM);
  const rest = p.toString();
  return rest ? `?${rest}` : '';
}
