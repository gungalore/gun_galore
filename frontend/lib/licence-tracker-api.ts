import { LicenceApiError, type TokenGetter } from './licence-centre-api';
import { safeJson } from './safe-json';

// The SAPS Application Tracker's API client — /licence-centre/tracking.
//
// ⚠️ SIBLING OF licence-centre-api.ts AND DELIBERATELY THE SAME SHAPE. Four
// properties have to survive the copy, and every one of them has bitten this
// codebase already:
//   1. the token is fetched INSIDE request(), never hoisted — a hoisted one is
//      captured at mount and a long session sends an expired token
//   2. safeJson on every body: an empty 200 is the norm for PATCH/DELETE, and
//      a raw res.json() throws on it
//   3. a 413 is checked BEFORE !res.ok, because nginx rejects an oversized
//      body itself with an HTML page and there is no JSON to read
//   4. `fallback` is optional: omit it for calls that must have a body
//
// ⚠️ THE ONE THING THIS FILE DOES DIFFERENTLY IS THE 429. The Document Centre
// throws a fixed "give it a minute" message; a tracker's cooldown is measured
// in HOURS and the answer carries the exact moment to come back, so throwing
// that away would leave the member with a message that is both vague and
// wrong. See TrackerCooldownError.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export type TrackerKind = 'COMPETENCY' | 'FIREARM_LICENCE' | 'RENEWAL';

/**
 * What the last poll did — which is NOT the same thing as the status.
 *
 * `no_records` is SAPS answering that it holds nothing against this reference,
 * which is a normal state for one just lodged. `error` is US being blind: a
 * block page, a redesign, a timeout. They must never be shown as each other.
 */
export type TrackerOutcome = 'unknown' | 'row' | 'no_records' | 'error';

export interface TrackerView {
  id: string;
  kind: TrackerKind;
  label: string | null;
  reference: string;
  serial: string | null;
  submittedOn: string | null;
  applicationType: string | null;
  applicationNumber: string | null;
  calibre: string | null;
  make: string | null;
  /** The serial as SAPS PRINTS it, which is not necessarily the one typed. */
  serialSeen: string | null;
  status: string | null;
  statusDate: string | null;
  /** How stale SAPS's own answer is — not when we asked. */
  sapsUpdatedOn: string | null;
  lastCheckedAt: string | null;
  lastOutcome: TrackerOutcome;
  lastError: string | null;
  createdAt: string;
  eventCount: number;
}

export interface TrackerEventView {
  id: string;
  source: 'SAPS' | 'MEMBER';
  observedAt: string;
  status: string | null;
  statusDate: string | null;
  applicationType: string | null;
  applicationNumber: string | null;
  calibre: string | null;
  make: string | null;
  serial: string | null;
  statusDescription: string | null;
  nextStep: string | null;
}

export interface TrackerDetail extends TrackerView {
  events: TrackerEventView[];
}

export interface CreateTrackerBody {
  kind: TrackerKind;
  reference: string;
  /** Dropped server-side for a COMPETENCY — and the field is not rendered. */
  serial?: string | null;
  label?: string | null;
  submittedOn?: string | null;
}

export interface AddEventBody {
  title: string;
  status?: string | null;
  nextStep?: string | null;
  observedAt?: string | null;
}

/**
 * The cooldown, which is a real answer rather than a failure.
 *
 * ⚠️ `retryAfter` IS THE MOMENT, NOT A NUMBER OF SECONDS. The server sends the
 * ISO instant the tracker may be asked again — see `assertCooldown` — because
 * "in 6 hours" read at 09:00 and re-read at 15:00 has already expired.
 */
export class TrackerCooldownError extends LicenceApiError {
  constructor(
    message: string,
    readonly retryAfter: string | null,
  ) {
    super(message, 429);
  }
}

async function request<T>(
  getToken: TokenGetter,
  path: string,
  init: RequestInit = {},
  fallback?: T,
): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_URL}/licence-centre/tracking${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 413) {
    throw new LicenceApiError(
      'That is too large for us to take. Please try again.',
      413,
    );
  }

  if (res.status === 429) {
    const body = await safeJson<{
      message?: string | string[];
      retryAfter?: string;
    }>(res, {});
    const message = Array.isArray(body.message)
      ? body.message.join(' ')
      : (body.message ??
        'We checked SAPS for this application recently. Repeated enquiries are answered with a block page, so please try again later.');
    throw new TrackerCooldownError(message, body.retryAfter ?? null);
  }

  if (!res.ok) {
    const body = await safeJson<{ message?: string | string[]; code?: string }>(
      res,
      {},
    );
    const message = Array.isArray(body.message)
      ? body.message.join(' ')
      : (body.message ?? 'Something went wrong. Please try again in a moment.');
    throw new LicenceApiError(message, res.status, body.code);
  }

  return safeJson<T>(res, (fallback ?? null) as T);
}

export const licenceTrackerApi = {
  /**
   * Whether the feature is on, so the screen renders a dark state rather than
   * guessing from a 404. ⚠️ NOT gated server-side; falls back to OFF, because
   * an unreachable answer is not a reason to show a form that cannot work.
   */
  status: (t: TokenGetter) =>
    request<{ enabled: boolean }>(t, '/status', {}, { enabled: false }),

  /** The member's active trackers, newest first. */
  list: async (t: TokenGetter): Promise<TrackerView[]> => {
    const body = await request<{ trackers: TrackerView[] }>(
      t,
      '',
      {},
      { trackers: [] },
    );
    return body?.trackers ?? [];
  },

  get: (t: TokenGetter, id: string) =>
    request<TrackerDetail>(t, `/${encodeURIComponent(id)}`),

  create: (t: TokenGetter, body: CreateTrackerBody) =>
    request<TrackerView>(t, '', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** Deactivates. The member's own history survives them tidying the list. */
  remove: (t: TokenGetter, id: string) =>
    request<{ id: string; active: boolean }>(
      t,
      `/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    ),

  /** Ask SAPS now. Cooldown-gated — a 429 is a TrackerCooldownError. */
  check: (t: TokenGetter, id: string) =>
    request<TrackerView>(t, `/${encodeURIComponent(id)}/check`, {
      method: 'POST',
    }),

  /** A milestone the member recorded themselves. Always source MEMBER. */
  addEvent: (t: TokenGetter, id: string, body: AddEventBody) =>
    request<TrackerDetail>(t, `/${encodeURIComponent(id)}/events`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

// ────────────────────────────────────────────────────────────────────
// Presentation helpers. Pure, so the component specs can hold them still.
// ────────────────────────────────────────────────────────────────────

/**
 * What to call this application on screen.
 *
 * ⚠️ THE REFERENCE IS LAST FOR A REASON. Members name the tracker after the
 * rifle ("My first .308"), and a list of eight application numbers is the
 * least readable version of the same screen.
 */
export function trackerLabel(t: {
  label?: string | null;
  applicationNumber?: string | null;
  reference?: string | null;
}): string {
  return (
    t.label?.trim() ||
    t.applicationNumber?.trim() ||
    t.reference?.trim() ||
    'Your application'
  );
}

export const KIND_LABELS: Record<TrackerKind, string> = {
  COMPETENCY: 'Competency',
  FIREARM_LICENCE: 'Firearm licence',
  RENEWAL: 'Renewal',
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind as TrackerKind] ?? kind;
}

export interface TrackingTone {
  label: string;
  colour: string;
  wash: string;
  line: string;
}

/**
 * ⚠️ EVERY TONE HERE REPEATS A WORD SAPS PRINTED. None of them is an outcome
 * we decided, and none may be reworded into one: "Refused" is what the enquiry
 * says, not a verdict this platform reached, and the screen says so in words
 * beside it. A status we do not recognise keeps its OWN text — inventing a
 * friendlier label for a status nobody has seen is how a wrong one gets
 * read as ours.
 */
const TONE: Record<string, TrackingTone> = {
  approved: {
    label: 'Approved',
    colour: 'var(--success)',
    wash: 'var(--success-wash)',
    line: 'var(--success-line)',
  },
  refused: {
    label: 'Refused',
    colour: 'var(--red)',
    wash: 'var(--red-wash)',
    line: 'var(--red-line)',
  },
  cancelled: {
    label: 'Cancelled',
    colour: 'var(--red)',
    wash: 'var(--red-wash)',
    line: 'var(--red-line)',
  },
  'card ready for collection': {
    label: 'Card ready for collection',
    colour: 'var(--success)',
    wash: 'var(--success-wash)',
    line: 'var(--success-line)',
  },
  'card printed': {
    label: 'Card printed',
    colour: 'var(--success)',
    wash: 'var(--success-wash)',
    line: 'var(--success-line)',
  },
  'in preparation': {
    label: 'In preparation',
    colour: 'var(--gold)',
    wash: 'var(--gold-wash)',
    line: 'var(--gold-line)',
  },
  'in circulation': {
    label: 'In circulation',
    colour: 'var(--gold)',
    wash: 'var(--gold-wash)',
    line: 'var(--gold-line)',
  },
  'received at cfr': {
    label: 'Received at CFR',
    colour: 'var(--gold)',
    wash: 'var(--gold-wash)',
    line: 'var(--gold-line)',
  },
  'sent to cfr': {
    label: 'Sent to CFR',
    colour: 'var(--gold)',
    wash: 'var(--gold-wash)',
    line: 'var(--gold-line)',
  },
  'for consideration': {
    label: 'For consideration',
    colour: 'var(--gold)',
    wash: 'var(--gold-wash)',
    line: 'var(--gold-line)',
  },
  'payment received': {
    label: 'Payment received',
    colour: 'var(--gold)',
    wash: 'var(--gold-wash)',
    line: 'var(--gold-line)',
  },
};

const UNREAD: TrackingTone = {
  label: 'No status read yet',
  colour: 'var(--text-tertiary)',
  wash: 'transparent',
  line: 'var(--border)',
};

export function statusTone(status: string | null | undefined): TrackingTone {
  const raw = status?.trim();
  if (!raw) return UNREAD;
  return (
    TONE[raw.toLowerCase()] ?? {
      // ⚠️ THE RAW STRING, NOT A GUESS. A status we do not know is still a
      // status SAPS printed, and it is the only honest thing to show.
      label: raw,
      colour: 'var(--gold)',
      wash: 'var(--gold-wash)',
      line: 'var(--gold-line)',
    }
  );
}

/**
 * The timeline, newest first.
 *
 * ⚠️ A STABLE SORT BY INSTANT, NOT BY INSERTION ORDER. SAPS's own rows are
 * written in poll order, which is also newest-first, but a MEMBER milestone can
 * be backdated (`observedAt` is settable) — so the two streams only interleave
 * correctly if both are ordered by the instant they describe.
 */
export function observations(
  events: TrackerEventView[],
): TrackerEventView[] {
  return [...events].sort(
    (a, b) =>
      new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime(),
  );
}

// ────────────────────────────────────────────────────────────────────
// THE JOURNEY: how long it has been, what the usual path is, and how long
// each step of it took.
//
// ⚠️ NOT ONE NUMBER IN HERE IS A CLAIM ABOUT SAPS. The days counter is
// arithmetic on a date the MEMBER gave us. The ladder is the order of the
// statuses SAPS itself prints, labelled as the usual order rather than a
// promise. The elapsed days are a subtraction, and the view says which two
// dates were subtracted — because a figure that silently measures the wrong
// thing is worse than no figure.
// ────────────────────────────────────────────────────────────────────

/**
 * Whole days between a date we stored and the member's own today.
 *
 * ⚠️ THE STORED DATE IS READ IN UTC, "TODAY" IS READ LOCALLY, AND THE MIX IS
 * THE CORRECT ONE. Every date here is stored as `Date.UTC(y, m-1, d)` —
 * midnight UTC standing for a calendar date — so the UTC components are the
 * date that was meant. "Today", though, is the member's today: at 00:30 in
 * Johannesburg it is still the previous day in London, and counting to
 * London's day would lose them one every morning before 02:00.
 */
export function daysSince(
  iso: string | null,
  now: Date = new Date(),
): number | null {
  if (!iso) return null;
  const then = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(then.getTime())) return null;
  const thenDay = Date.UTC(
    then.getUTCFullYear(),
    then.getUTCMonth(),
    then.getUTCDate(),
  );
  const nowDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  // ⚠️ A DATE IN THE FUTURE IS NOT A NEGATIVE WAIT. A member who mistyped the
  // year gets 0, not "-1,400 days" — and they can edit it.
  return Math.max(0, Math.round((nowDay - thenDay) / 86_400_000));
}

/** "1067 days" — and "1 day", because "1 days" on the figure a member reads
 *  first is exactly the kind of carelessness that makes the rest look wrong.
 *  No thousands separator: `toLocaleString` writes one differently across
 *  ICU builds, and a day count is not a place to discover that. */
export function formatDays(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * One rung of the usual path.
 *
 * ⚠️ EVERY RUNG IS A STATUS SAPS PRINTS. Nothing on this ladder is a step we
 * invented, and nothing is inferred: a rung is marked "seen" only when one of
 * the member's own recorded rows actually carries it.
 */
export interface JourneyStage {
  /** The status SAPS prints, lower-cased — the key this rung answers to. */
  status: string;
  /** The rung in SAPS's own words, tidied to sentence case. */
  label: string;
  /** One plain line on what happens at this stage. */
  blurb: string;
}

/**
 * The order these statuses usually arrive in.
 *
 * ⚠️ "USUALLY" IS DOING REAL WORK IN THAT SENTENCE, AND THE VIEW SAYS SO.
 * SAPS can skip a rung, restate one, or answer with a status nobody here has
 * seen; the ladder is a reading aid, and the screen prints SAPS's own "Next
 * step" sentence underneath it so the member can see what the Service says
 * for themselves. We are not SAPS. This is not a decision.
 */
export const SAPS_STAGES: JourneyStage[] = [
  {
    status: 'payment received',
    label: 'Payment received',
    blurb: 'SAPS has recorded the application fee against your reference.',
  },
  {
    status: 'sent to cfr',
    label: 'Sent to CFR',
    blurb:
      'Your DFO has forwarded the application to the Central Firearm Registry.',
  },
  {
    status: 'received at cfr',
    label: 'Received at CFR',
    blurb: 'The Central Firearm Registry has the application on its books.',
  },
  {
    status: 'in preparation',
    label: 'In preparation',
    blurb: 'The file is being prepared for a decision officer to consider.',
  },
  {
    status: 'in circulation',
    label: 'In circulation',
    blurb: 'The file is moving between the offices that have to sign it off.',
  },
  {
    status: 'for consideration',
    label: 'For consideration',
    blurb: 'A decision officer is considering the application.',
  },
  {
    status: 'approved',
    label: 'Approved',
    blurb:
      'The application was granted. The card still has to be printed and sent to your DFO.',
  },
  {
    status: 'card printed',
    label: 'Card printed',
    blurb: 'The card has been produced and is on its way to your DFO.',
  },
  {
    status: 'card ready for collection',
    label: 'Card ready for collection',
    blurb:
      'Your DFO has the card. Take your ID and your reference when you collect it.',
  },
];

/**
 * The statuses that end the process rather than moving it along.
 *
 * ⚠️ THEY ARE NOT RUNGS AND MUST NOT BE DRAWN AS ONE. A refused application
 * has not "reached approved"; putting the two on one ladder would draw a
 * refusal as a later stage of an approval.
 */
export const TERMINAL_STAGES: Record<string, { label: string; blurb: string }> =
  {
    refused: {
      label: 'Refused',
      blurb:
        'SAPS refused the application. The enquiry does not print a reason — your DFO can tell you what the letter says and how to appeal.',
    },
    cancelled: {
      label: 'Cancelled',
      blurb:
        'SAPS cancelled the application. Your DFO is the only place that can say why.',
    },
  };

/**
 * Where a status sits on the ladder, or `null` when it does not.
 *
 * ⚠️ NULL IS THE IMPORTANT RETURN VALUE. A status nobody here has seen — or a
 * terminal one — must never be forced onto a rung, because a position on a
 * ladder is itself a claim about where the application is.
 */
export function stageFor(status: string | null | undefined): number | null {
  const raw = status?.trim().toLowerCase();
  if (!raw) return null;
  const at = SAPS_STAGES.findIndex((s) => s.status === raw);
  return at === -1 ? null : at;
}

/** The terminal status this is, if it is one. */
export function terminalFor(
  status: string | null | undefined,
): { label: string; blurb: string } | null {
  const raw = status?.trim().toLowerCase();
  if (!raw) return null;
  return TERMINAL_STAGES[raw] ?? null;
}

/**
 * What the elapsed figure was measured between — so the screen can say.
 *
 * `saps` — the two status dates SAPS printed. This is when the application
 *          actually moved, and it is what we use whenever both rows have one.
 * `seen` — when WE last looked. Only used when a status date is missing, and
 *          it can be days late: a weekly sweep notices on Sunday what moved
 *          on Tuesday.
 * `lodged` — the member's own lodgement date against the first row we hold.
 */
export type ElapsedBasis = 'saps' | 'seen' | 'lodged';

export interface JourneyStep {
  event: TrackerEventView;
  /** Whole days since the step before. `null` when it cannot be measured. */
  elapsedDays: number | null;
  /** What was measured, so the label can say which. */
  basis: ElapsedBasis | null;
}

/** Calendar days between two stored dates (each a calendar date, midnight UTC). */
function calendarDays(from: string, to: string): number | null {
  const a = new Date(from.length <= 10 ? `${from}T00:00:00Z` : from);
  const b = new Date(to.length <= 10 ? `${to}T00:00:00Z` : to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const span =
    Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) -
    Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  return span < 0 ? null : Math.round(span / 86_400_000);
}

/** Whole days between two real instants — observedAt carries a time. */
function instantDays(from: string, to: string): number | null {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const days = Math.floor((b - a) / 86_400_000);
  // A row written before the one it follows is a data fault, not a negative
  // wait. Say nothing rather than "-3 days".
  return days < 0 ? null : days;
}

/**
 * The history, newest first, with each step's elapsed time attached.
 *
 * ⚠️ THE FIGURE IS MEASURED ON SAPS'S OWN DATES WHEREVER BOTH ROWS CARRY ONE,
 * AND THE BASIS TRAVELS WITH IT. With the weekly sweep, measuring on our own
 * observation stamps routinely reports a step as having taken nine days when
 * SAPS moved it on the third. The fallback exists because a MEMBER milestone
 * has no status date at all, and an approximate figure that is labelled as
 * ours beats a blank.
 */
export function journey(
  events: TrackerEventView[],
  submittedOn: string | null,
): JourneyStep[] {
  // Built oldest-first, because each step is measured from the one before it.
  const chrono = [...observations(events)].reverse();

  const steps: JourneyStep[] = chrono.map((event, i) => {
    if (i === 0) {
      // The oldest row we hold is anchored to the day the member lodged it —
      // the only thing that can say what came before our first look.
      if (!submittedOn) return { event, elapsedDays: null, basis: null };
      return {
        event,
        elapsedDays: calendarDays(
          submittedOn,
          event.statusDate ?? event.observedAt,
        ),
        basis: 'lodged',
      };
    }

    const prev = chrono[i - 1];
    if (prev.statusDate && event.statusDate) {
      const days = calendarDays(prev.statusDate, event.statusDate);
      if (days !== null) return { event, elapsedDays: days, basis: 'saps' };
    }
    const days = instantDays(prev.observedAt, event.observedAt);
    return { event, elapsedDays: days, basis: days === null ? null : 'seen' };
  });

  // Newest first, matching the timeline it is printed in.
  return steps.reverse();
}

/** "12 Mar 2026, 14:30" — local, because this is when the member looked. */
export function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The SAPS marker is a date, not an instant — no time to show, none invented.
 *
 * ⚠️ ALWAYS UTC, INCLUDING FOR A FULL ISO INSTANT, AND THAT IS NOT PEDANTRY.
 * The server stores these as `Date.UTC(y, m-1, d)` — midnight UTC — because
 * the enquiry prints a calendar date and there is no time of day to keep. A
 * formatter that read that instant back in the VIEWER's zone rendered
 * "11 Sep 2026" for a `2026-09-12` status anywhere west of Greenwich, and a
 * wrong date on a status line is the one kind of error this screen cannot
 * afford. `formatWhen` is the local-time one, for when we actually looked.
 */
export function formatDay(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * What to say when the cooldown turns a "Check now" away.
 *
 * ⚠️ THE TIME IS THE POINT. "Try again later" on a screen whose whole purpose
 * is the wait is the least useful sentence available; the server sends the
 * instant, so we name it.
 */
export function retryMessage(retryAfter: string | null): string {
  if (!retryAfter) {
    return 'We checked SAPS for this application recently. Please try again later.';
  }
  const d = new Date(retryAfter);
  if (Number.isNaN(d.getTime())) {
    return 'We checked SAPS for this application recently. Please try again later.';
  }
  return `Checked recently — repeated enquiries are answered with a block page. You can ask again after ${formatWhen(retryAfter)}.`;
}
