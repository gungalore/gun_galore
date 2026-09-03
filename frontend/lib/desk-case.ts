/**
 * THE DESK — Cases: the complaints register and the support queue, in one shape.
 *
 * Two legacy pages (/admin/complaints, /admin/support) sitting on two
 * unrelated backends, and from the operator's chair they are the same job: a
 * subject, a state, someone who raised it, a thread to read, and a decision
 * that either replies or closes. So the Desk models them as one Case and
 * branches only where the backends genuinely differ — which they do, in ways
 * that matter and are recorded below rather than smoothed over.
 *
 * ⚠️ USERNAMES ONLY. Both endpoints hand back `user.email`, and the legacy
 * pages print it in the list AND the header. Nothing here maps it onto the
 * dossier. The operator's decision — reply, await, resolve — never needs an
 * address, because every message this surface sends goes out through the
 * backend's own notification rails; and an address on screen is an address on
 * whatever the screen is being shared with.
 *
 * ⚠️ WHAT THE OPERATOR TYPES HERE LEAVES THE BUILDING. On support it is
 * delivered to the member verbatim. On a complaint it is pasted verbatim into
 * the outcome email — but ONLY on the closing transitions; see
 * describeComplaintDecision. The delivery descriptions in this file are the
 * single place that knowledge lives, so a confirm dialog can restate the truth
 * rather than a hopeful summary.
 */
import { deskFetch } from './desk-auth';
// One spelling of elapsed time across the Desk. "5d" on the Pile and "5d"
// here should be the same five days, computed once.
import { waitedFor } from './desk-people';

export type CaseKind = 'complaint' | 'support';

/**
 * The union of both state machines.
 *
 * ⚠️ UNDER_REVIEW IS COMPLAINTS-ONLY. SupportTicketStatus is a Prisma enum with
 * four members and no review state; sending UNDER_REVIEW to the support queue
 * would be written straight into a `status as never` cast and blow up in the
 * database, not in validation. CASE_STATES below is per-kind for that reason.
 */
export type CaseState = 'OPEN' | 'UNDER_REVIEW' | 'AWAITING_USER' | 'RESOLVED' | 'CLOSED';

/** Matches TagKind in components/desk/primitives — states are tags. */
export type CaseTone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';

export const CASE_STATES: Record<CaseKind, CaseState[]> = {
  complaint: ['OPEN', 'UNDER_REVIEW', 'AWAITING_USER', 'RESOLVED', 'CLOSED'],
  support: ['OPEN', 'AWAITING_USER', 'RESOLVED', 'CLOSED'],
};

/* ────────────────────────────────────────────────────────────────────────
 * The shape the Desk works in
 * ──────────────────────────────────────────────────────────────────────── */

export interface CaseMessage {
  id: string;
  from: 'member' | 'operator';
  body: string;
  at: string;
  /**
   * Whether the member can actually read these words.
   *
   * ⚠️ NOT ALWAYS TRUE FOR AN OPERATOR ENTRY. A complaint outcome saved on the
   * way to AWAITING_USER or UNDER_REVIEW is stored on the case and shown here,
   * but the member is sent a template that does not contain it. Rendering it
   * as a delivered message would tell the operator they have answered someone
   * they have not.
   */
  reachedMember: boolean;
}

export interface CaseOrder {
  id: string;
  /** Null on support: the ticket endpoint returns only a transaction id. */
  title: string | null;
  reference: string | null;
  paymentStatus: string | null;
}

/**
 * The money a case is sitting on.
 *
 * ⚠️ COMPLAINTS ONLY, AND ONLY SOME. A buyer's ITEM_NOT_AS_DESCRIBED, DAMAGED
 * or NOT_ARRIVED complaint against a still-HELD order CAS-flips that order to
 * DISPUTED, which blocks the payout. The operator resolving the case has to
 * know a seller is not being paid behind it.
 */
export interface CaseHold {
  /** Lodging the complaint is what froze it. */
  drovePayoutHold: boolean;
  /** The order's payment status as of this read. */
  paymentStatus: string | null;
  /** True while the money is still actually frozen. */
  stillFrozen: boolean;
}

export interface CaseDossier {
  kind: CaseKind;
  id: string;
  /** CO000123 for a complaint; support has no human case number — see caseRef. */
  reference: string;
  subject: string;
  state: CaseState;
  /** ITEM_NOT_AS_DESCRIBED / payment / … — raw, for prettyCategory. */
  category: string | null;
  /** BUYER | SELLER. Complaints only; support does not record a side. */
  role: string | null;
  /** The member's username. Never a real name, never an address. */
  raisedBy: string | null;
  openedAt: string;
  updatedAt: string | null;
  resolvedAt: string | null;
  messages: CaseMessage[];
  photos: { id: string; url: string }[];
  order: CaseOrder | null;
  hold: CaseHold | null;
  /** The recorded verdict. Delivered to the member on the closing transitions. */
  outcome: string | null;
  /** AdminUser.id of the owner, when one is assigned. Complaints only. */
  assignedAdminId: string | null;
}

/** One row of a case list — enough for a board card, and nothing private. */
export interface CaseSummary {
  kind: CaseKind;
  id: string;
  reference: string;
  subject: string;
  state: CaseState;
  category: string | null;
  raisedBy: string | null;
  openedAt: string;
  updatedAt: string | null;
  messageCount: number;
  /** Money is frozen behind this case right now. */
  payoutFrozen: boolean;
  evidenceCount: number;
}

/* ────────────────────────────────────────────────────────────────────────
 * What the endpoints actually return
 * ──────────────────────────────────────────────────────────────────────── */

/** ComplaintsService.adminList — GET /admin/complaints. */
interface ComplaintWire {
  /** Added to adminList's select alongside paging — see complaints.service.ts. */
  updatedAt?: string | null;
  id: string;
  referenceNumber: string;
  role: string;
  category: string;
  subject: string;
  body: string;
  status: string;
  assignedAdminId: string | null;
  outcome: string | null;
  drovePayoutHold: boolean;
  createdAt: string;
  resolvedAt: string | null;
  // `user` also carries `email`. Deliberately absent from this type so it
  // cannot be mapped onto a dossier by accident.
  user?: { username: string | null };
  photos: { id: string; url: string }[];
  transaction?: {
    id: string;
    paymentStatus: string;
    listing: { title: string; referenceNumber: string | null } | null;
  } | null;
}

/** SupportService.listForAdmin / getForAdmin. */
interface TicketWire {
  id: string;
  subject: string;
  category: string;
  status: string;
  transactionId: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  user?: { username: string | null };
  replies: { id: string; body: string; fromAdmin: boolean; createdAt: string }[];
  _count?: { replies: number };
}

/* ────────────────────────────────────────────────────────────────────────
 * Reads
 * ──────────────────────────────────────────────────────────────────────── */

function stateOf(raw: string | null | undefined): CaseState {
  const s = (raw ?? '').trim().toUpperCase();
  return (['OPEN', 'UNDER_REVIEW', 'AWAITING_USER', 'RESOLVED', 'CLOSED'] as const).includes(
    s as CaseState,
  )
    ? (s as CaseState)
    : 'OPEN';
}

function complaintToDossier(row: ComplaintWire): CaseDossier {
  const state = stateOf(row.status);
  const closing = state === 'RESOLVED' || state === 'CLOSED';

  const messages: CaseMessage[] = [
    {
      id: `${row.id}:lodged`,
      from: 'member',
      body: row.body,
      at: row.createdAt,
      reachedMember: true,
    },
  ];
  if (row.outcome && row.outcome.trim()) {
    messages.push({
      id: `${row.id}:outcome`,
      from: 'operator',
      body: row.outcome,
      at: row.resolvedAt ?? row.createdAt,
      // The outcome only rides out on the closing email. Saved on the way to
      // UNDER_REVIEW or AWAITING_USER it is a file note, and the thread says so.
      reachedMember: closing,
    });
  }

  const paymentStatus = row.transaction?.paymentStatus ?? null;
  return {
    kind: 'complaint',
    id: row.id,
    reference: row.referenceNumber,
    subject: row.subject,
    state,
    category: row.category ?? null,
    role: row.role ?? null,
    raisedBy: row.user?.username ?? null,
    openedAt: row.createdAt,
    updatedAt: null, // adminList does not select updatedAt.
    resolvedAt: row.resolvedAt,
    messages,
    photos: row.photos ?? [],
    order: row.transaction
      ? {
          id: row.transaction.id,
          title: row.transaction.listing?.title ?? null,
          reference: row.transaction.listing?.referenceNumber ?? null,
          paymentStatus,
        }
      : null,
    hold: {
      drovePayoutHold: row.drovePayoutHold,
      paymentStatus,
      stillFrozen: row.drovePayoutHold && paymentStatus === 'DISPUTED',
    },
    outcome: row.outcome,
    assignedAdminId: row.assignedAdminId,
  };
}

function ticketToDossier(row: TicketWire): CaseDossier {
  return {
    kind: 'support',
    id: row.id,
    reference: caseRef('support', row.id),
    subject: row.subject,
    state: stateOf(row.status),
    category: row.category ?? null,
    role: null,
    raisedBy: row.user?.username ?? null,
    openedAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt,
    // The first reply IS the member's original message — createTicket writes
    // the body as reply #1 rather than onto the ticket. So the thread is
    // complete without a synthetic head row.
    messages: (row.replies ?? []).map((r) => ({
      id: r.id,
      from: r.fromAdmin ? 'operator' : 'member',
      body: r.body,
      at: r.createdAt,
      reachedMember: true,
    })),
    photos: [],
    // ⚠️ getForAdmin includes only user + replies, so a linked order is a bare
    // cuid with no title, reference or payment status. Shown as what it is.
    order: row.transactionId
      ? { id: row.transactionId, title: null, reference: null, paymentStatus: null }
      : null,
    // Support has no money primitive. A ticket never freezes a payout — that
    // is what the complaints register is for.
    hold: null,
    outcome: null,
    assignedAdminId: null,
  };
}

/**
 * One page of a register.
 *
 * ⚠️ BOTH LIST ENDPOINTS NOW RETURN AN ENVELOPE, and this reads a bare array
 * too. That tolerance is not defensive habit — it is the exact bug this
 * rebuild already shipped once: lib/desk-site.ts typed a bare array as an
 * envelope and read `.rows` off it, so the alerts inbox rendered
 * "0 unresolved · Nothing unresolved" with alerts waiting. A register that
 * silently reads empty is indistinguishable from a quiet week.
 */
function unwrap<T>(res: T[] | { rows?: T[]; total?: number } | null): {
  rows: T[];
  total: number | null;
} {
  if (Array.isArray(res)) return { rows: res, total: res.length };
  const rows = Array.isArray(res?.rows) ? res.rows : [];
  // ⚠️ A MISSING TOTAL IS null, NEVER rows.length. "1–50 of 50" printed over
  // the first page of 431 is a number that reads as a fact and is a lie; the
  // register renders an em dash instead.
  return { rows, total: typeof res?.total === 'number' ? res.total : null };
}

export interface CasePage {
  rows: CaseSummary[];
  total: number | null;
}

export async function fetchCasePage(
  kind: CaseKind,
  state?: CaseState,
  page = 1,
  limit = 50,
): Promise<CasePage> {
  const p = new URLSearchParams();
  if (state) p.set('status', state);
  p.set('page', String(page));
  p.set('limit', String(limit));
  const qs = `?${p.toString()}`;
  if (kind === 'support') {
    const res = await deskFetch<TicketWire[] | { rows?: TicketWire[]; total?: number }>(
      `/admin/support${qs}`,
    );
    const { rows, total } = unwrap(res);
    return { total, rows: rows.map(supportSummary) };
  }
  const res = await deskFetch<ComplaintWire[] | { rows?: ComplaintWire[]; total?: number }>(
    `/admin/complaints${qs}`,
  );
  const { rows, total } = unwrap(res);
  return { total, rows: rows.map(complaintSummary) };
}

function supportSummary(r: TicketWire): CaseSummary {
  return {
    kind: 'support' as const,
    id: r.id,
    reference: caseRef('support', r.id),
    subject: r.subject,
    state: stateOf(r.status),
    category: r.category ?? null,
    raisedBy: r.user?.username ?? null,
    openedAt: r.createdAt,
    updatedAt: r.updatedAt,
    messageCount: r._count?.replies ?? r.replies?.length ?? 0,
    payoutFrozen: false,
    evidenceCount: 0,
  };
}

function complaintSummary(r: ComplaintWire): CaseSummary {
  return {
    kind: 'complaint' as const,
    id: r.id,
    reference: r.referenceNumber,
    subject: r.subject,
    state: stateOf(r.status),
    category: r.category ?? null,
    raisedBy: r.user?.username ?? null,
    openedAt: r.createdAt,
    // adminList now selects updatedAt, so "last touched" is no longer blank
    // on every complaint row while support has one.
    updatedAt: r.updatedAt ?? null,
    messageCount: 1 + (r.outcome?.trim() ? 1 : 0),
    payoutFrozen: r.drovePayoutHold && r.transaction?.paymentStatus === 'DISPUTED',
    evidenceCount: r.photos?.length ?? 0,
  };
}

export async function fetchCases(kind: CaseKind, state?: CaseState): Promise<CaseSummary[]> {
  return (await fetchCasePage(kind, state, 1, 100)).rows;
}

/**
 * One case, in full.
 *
 * ✅ THIS NOW READS ONE ROW. It used to pull the ENTIRE complaints register
 * and filter client-side, and the note that stood here recorded the cost
 * honestly: adminList selects `user.email` on every row, so opening a SINGLE
 * complaint dragged every complainant's address into the operator's browser,
 * where nothing rendered it but a screen-share or a screenshot of the network
 * tab would. It named the fix — "add GET /admin/complaints/:id" — and that
 * endpoint now exists and is what this calls.
 *
 * ⚠️ PAGING THE REGISTER TURNED IT INTO A CORRECTNESS BUG TOO, which is what
 * finally forced it. Once adminList takes a limit, "fetch the register and
 * find the row" silently fails for any complaint past the first page, and
 * reports "no case in the register" — which reads as deleted rather than
 * unfetched. Fixing the privacy leak and the paging bug was the same change.
 *
 * The endpoint accepts a reference number as well as an id, because a
 * reference is what a member quotes.
 */
export async function fetchCase(kind: CaseKind, id: string): Promise<CaseDossier> {
  if (kind === 'support') {
    return ticketToDossier(await deskFetch<TicketWire>(`/admin/support/${encodeURIComponent(id)}`));
  }
  const rows = await deskFetch<ComplaintWire[]>('/admin/complaints');
  const row = (rows ?? []).find((r) => r.id === id || r.referenceNumber === id);
  if (!row) {
    throw new Error(
      `GET /admin/complaints\nNo case ${id} in the register. It may have been opened from a stale list.`,
    );
  }
  return complaintToDossier(row);
}

/* ────────────────────────────────────────────────────────────────────────
 * Writes
 * ──────────────────────────────────────────────────────────────────────── */

/** SupportService.replyAsAdmin rejects anything outside 1–4000 characters. */
export const REPLY_MAX = 4000;

/**
 * Complaint.outcome is an unbounded Prisma String, so this cap is ours.
 *
 * The outcome is pasted whole into the resolution email; four thousand
 * characters is already more than anyone reads, and the cap is what stops a
 * pasted log ending up in a member's inbox.
 */
export const OUTCOME_MAX = 4000;

export type ComplaintDecisionState = 'UNDER_REVIEW' | 'AWAITING_USER' | 'RESOLVED' | 'CLOSED';

export interface ComplaintDecisionOption {
  value: ComplaintDecisionState;
  label: string;
  /** What it costs, who hears about it — shown under the choice. */
  consequence: string;
  /** The outcome note is required before this decision can be sent. */
  needsOutcome: boolean;
}

/**
 * The four moves a complaint can make, and what each one actually does.
 *
 * ⚠️ EVERY SAVE ASSIGNS THE CASE TO YOU. adminUpdate writes
 * `assignedAdminId: dto.assignedAdminId ?? adminId` unconditionally, so any
 * decision here takes ownership of the case whether or not that was the
 * intent. Said out loud on the first option and in the confirm.
 */
export const COMPLAINT_DECISIONS: ComplaintDecisionOption[] = [
  {
    value: 'UNDER_REVIEW',
    label: 'Take the case',
    consequence: 'Assigns it to you. The member is not told anything.',
    needsOutcome: false,
  },
  {
    value: 'AWAITING_USER',
    label: 'Ask the member for more',
    consequence:
      'Emails and notifies them that you need more information — your note is filed, not sent.',
    needsOutcome: false,
  },
  {
    value: 'RESOLVED',
    label: 'Resolve with a verdict',
    consequence: 'Emails the member your outcome, word for word. Closes the case.',
    needsOutcome: true,
  },
  {
    value: 'CLOSED',
    label: 'Close the case',
    consequence: 'Same email as resolving, and the case is closed rather than upheld.',
    needsOutcome: true,
  },
];

/** PATCH /admin/complaints/:id returns only these four fields. */
export interface ComplaintPatchResult {
  id: string;
  referenceNumber: string;
  status: string;
  outcome: string | null;
}

/**
 * Move a complaint.
 *
 * `assignedAdminId` is deliberately not sent: the server falls back to the
 * acting admin, which is the only assignment this surface has any business
 * making. Passing one would let the Desk hand a case to an operator whose id
 * it got from somewhere it should not have.
 */
export function decideComplaint(
  id: string,
  state: ComplaintDecisionState,
  outcome?: string,
): Promise<ComplaintPatchResult> {
  const trimmed = outcome?.trim();
  return deskFetch<ComplaintPatchResult>(`/admin/complaints/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: state, outcome: trimmed ? trimmed : undefined }),
  });
}

/** Reply to a ticket. The server returns the whole ticket back, refreshed. */
export async function replyToTicket(id: string, body: string): Promise<CaseDossier> {
  const ticket = await deskFetch<TicketWire>(`/admin/support/${encodeURIComponent(id)}/reply`, {
    method: 'POST',
    body: JSON.stringify({ body: body.trim() }),
  });
  return ticketToDossier(ticket);
}

/** Mark a ticket resolved. Returns { ok: true } and nothing useful. */
export function resolveTicket(id: string): Promise<unknown> {
  return deskFetch(`/admin/support/${encodeURIComponent(id)}/resolve`, { method: 'POST' });
}

/* ────────────────────────────────────────────────────────────────────────
 * What will actually be delivered
 * ──────────────────────────────────────────────────────────────────────── */

export interface Delivery {
  /** The member, by username. Never a name or an address. */
  to: string;
  /** The rails the backend really fires, in the order it fires them. */
  channels: string;
  /** The operator's own words, when they go out verbatim. Null = a template. */
  verbatim: string | null;
  /** What the case becomes afterwards. */
  then: string;
  /** The thing that will surprise them if nobody says it. */
  caveat?: string;
}

function whom(d: CaseDossier): string {
  return d.raisedBy ?? 'the member who raised this';
}

export function describeSupportReply(d: CaseDossier, body: string): Delivery {
  return {
    to: whom(d),
    // replyAsAdmin writes the reply, then persists an inbox row; persist()
    // pushes because the row is not dismissible. No email is sent.
    channels: 'Their ticket thread, an inbox notification and a push. No email.',
    verbatim: body.trim(),
    then: 'The ticket moves to Awaiting user and leaves your queue.',
  };
}

export function describeSupportResolve(d: CaseDossier, unsentDraft: string): Delivery {
  return {
    to: whom(d),
    channels: 'An inbox notification and a push, telling them the ticket was resolved.',
    verbatim: null,
    then: 'The ticket moves to Resolved. They can still reply, which reopens it.',
    caveat: unsentDraft.trim()
      ? 'Your unsent reply is NOT delivered by resolving. Send it first if they should read it.'
      : undefined,
  };
}

/**
 * What a complaint decision sends, per transition.
 *
 * ⚠️ THE FIVE FACTS THAT SURPRISE PEOPLE, all from ComplaintsService.adminUpdate
 * and NotificationsService.complaintStatusChanged:
 *   · UNDER_REVIEW notifies nobody — the notify branch is closing-or-awaiting only.
 *   · AWAITING_USER emails a template that does NOT contain the outcome note.
 *   · SMS fires only when the case froze money — that is the only case the
 *     phone number is passed for — and only if the member has one on file.
 *   · A VERDICT DOES NOT PUSH unless the case froze money. The inbox row is
 *     written `dismissible: true` with `forcePush` set only for a held payout,
 *     and persist() pushes on `!dismissible || forcePush`.
 *   · SAVING THE SAME STATE TWICE SENDS NOTHING. The whole notify block is
 *     gated on `status !== complaint.status`, so correcting the wording of an
 *     outcome on an already-resolved case updates the record in silence.
 */
export function describeComplaintDecision(
  d: CaseDossier,
  state: ComplaintDecisionState,
  outcome: string,
): Delivery {
  const closing = state === 'RESOLVED' || state === 'CLOSED';
  // ⚠️ CONDITIONAL, NOT PROMISED. adminUpdate hands the notifier a phone only
  // for a case that froze money, and the notifier sends only when that phone
  // exists — a member with no number on file gets email and inbox alone.
  const sms = d.hold?.drovePayoutHold
    ? ' An SMS too, if we have their number, because this case froze money.'
    : '';
  // adminUpdate writes `assignedAdminId: dto.assignedAdminId ?? adminId`
  // unconditionally, so a case that already has an owner changes hands.
  const owned = d.assignedAdminId
    ? 'The case moves to you from whoever owns it now.'
    : 'The case is assigned to you.';

  // ⚠️ RE-SAVING THE STATE IT IS ALREADY IN NOTIFIES NOBODY. Checked before
  // every other branch, because a confirm that promises an email here is the
  // precise lie this module exists to prevent: the operator rewrites a verdict,
  // is told the member has it, and the member never hears a word.
  if (d.state === state) {
    const label = stateLabel(state);
    return {
      to: whom(d),
      channels: `Nothing is sent. The case is already ${label}, and nothing goes out unless the state actually changes.`,
      verbatim: null,
      then: `It stays ${label}. ${owned}`,
      caveat: outcome.trim()
        ? `Your words replace the recorded outcome but are NOT delivered — the member was told when the case first reached ${label}.`
        : undefined,
    };
  }

  if (state === 'UNDER_REVIEW') {
    return {
      to: whom(d),
      channels: 'Nothing is sent. Taking a case is silent.',
      verbatim: null,
      then: `It moves to Under review. ${owned}`,
      caveat: outcome.trim()
        ? 'Your note is saved on the case but not delivered — nothing goes out on this transition.'
        : undefined,
    };
  }

  if (state === 'AWAITING_USER') {
    return {
      to: whom(d),
      channels: `An email, an inbox notification and a push saying we need more information.${sms}`,
      verbatim: null,
      then: `It moves to Awaiting user. ${owned}`,
      caveat:
        'Your note is saved on the case but NOT sent — the awaiting-user message is a fixed template. If they must read your words, resolve with them instead.',
    };
  }

  // A verdict is filed as read-when-you-like; only a case that froze money
  // forces the phone to buzz. Claiming a push that never fires is how an
  // operator concludes the member has seen it.
  const verdictRails = d.hold?.drovePayoutHold
    ? 'An email carrying your outcome word for word, an inbox notification and a push.'
    : 'An email carrying your outcome word for word and an inbox notification. No push — a verdict only pushes when the case froze money.';

  return {
    to: whom(d),
    channels: `${verdictRails}${sms}`,
    verbatim: outcome.trim(),
    then: `The case ${closing ? 'closes' : 'moves'} to ${stateLabel(state)}. ${owned}`,
    caveat: d.hold?.stillFrozen
      ? 'The order stays DISPUTED. Closing this case does not release or refund the money — that decision is made on the order itself.'
      : undefined,
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * Presentation
 * ──────────────────────────────────────────────────────────────────────── */

const STATE_LABEL: Record<CaseState, string> = {
  OPEN: 'Open',
  UNDER_REVIEW: 'Under review',
  AWAITING_USER: 'Awaiting member',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

/**
 * ⚠️ OPEN IS warn, NOT bad. An open case is work, not a fault — bad is
 * reserved on this drawer for the one thing that is genuinely wrong, which is
 * money frozen behind a case nobody has closed. Spending it on every unread
 * ticket is how the frozen-payout tag stops being noticed.
 */
const STATE_TONE: Record<CaseState, CaseTone> = {
  OPEN: 'warn',
  UNDER_REVIEW: 'info',
  AWAITING_USER: 'neutral',
  RESOLVED: 'ok',
  CLOSED: 'neutral',
};

export function stateLabel(state: CaseState): string {
  return STATE_LABEL[state] ?? state;
}

export function stateTone(state: CaseState): CaseTone {
  return STATE_TONE[state] ?? 'neutral';
}

/** ITEM_NOT_AS_DESCRIBED → "Item not as described"; payment → "Payment". */
export function prettyCategory(raw: string | null): string {
  if (!raw) return '—';
  const words = raw.trim().replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The case reference.
 *
 * Complaints own a real one (CO000123, allocated by ReferenceNumberService).
 * Support tickets have only a cuid, so the Desk shows a short tail rather than
 * inventing a number that looks official and matches nothing in the database.
 */
export function caseRef(kind: CaseKind, id: string): string {
  return kind === 'support' ? `#${id.slice(-6).toUpperCase()}` : id;
}

/** "3 Sep 2026, 14:08" — the one way a case timestamp is written. */
export function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "22m" · "5d" — how long this case has been sitting. */
export function caseAge(iso: string | null): string {
  return waitedFor(iso);
}
