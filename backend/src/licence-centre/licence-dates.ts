// ────────────────────────────────────────────────────────────────────
// DATES AND REMINDER STAGES.
//
// PURE — no Nest, no Prisma, no clock of its own. Every function that needs
// "now" takes it, so a test can stand anywhere in time.
//
// This module exists because a licence expiry date is the one value in the
// Centre that must never be wrong by a day. Everything here is about refusing
// to guess.
// ────────────────────────────────────────────────────────────────────

export type ReminderStage = 'T180' | 'T120' | 'T100' | 'T30' | 'D0';

/**
 * The stages, and the column that claims each one.
 *
 * T-120 and T-100 mirror the cadence SA Hunters already runs for licences and
 * competency, so a member who holds both is not being told two different
 * things. T-180 is ours: the association starts at 120, and by then a first
 * renewal — which needs a motivation, photographs and certified copies — is
 * already tight.
 *
 * ⚠️ verifyBeforeUse: section 24 of the Firearms Control Act requires a
 * renewal application to be lodged a set period before expiry, and the copy
 * says "well before expiry" rather than naming a number until the attorney
 * confirms it. Do NOT print a day count as if it were the statutory one.
 */
export const REMINDER_STAGES: readonly {
  stage: ReminderStage;
  days: number;
  column:
    | 'remind180SentAt'
    | 'remind120SentAt'
    | 'remind100SentAt'
    | 'remind30SentAt'
    | 'remindD0SentAt';
}[] = [
  { stage: 'T180', days: 180, column: 'remind180SentAt' },
  { stage: 'T120', days: 120, column: 'remind120SentAt' },
  { stage: 'T100', days: 100, column: 'remind100SentAt' },
  { stage: 'T30', days: 30, column: 'remind30SentAt' },
  { stage: 'D0', days: 0, column: 'remindD0SentAt' },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Strict ISO `yyyy-mm-dd` to a UTC-midnight Date, or null.
 *
 * ⚠️ DO NOT REACH FOR `new Date(s)` HERE. It accepts "2026" and "March 2026",
 * and it parses "2026-08-19" as UTC midnight while "2026/08/19" is LOCAL
 * midnight — in SAST that is a one-day drift, which on a reminder means
 * telling somebody their licence expires on the wrong day.
 *
 * The round-trip check at the end is what rejects 31 February, which
 * Date.UTC would otherwise roll forward to 3 March without complaint.
 */
export function parseIsoDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // A licence dated 1823 or 2400 is a misread, not a document.
  if (y < 1900 || y > 2200) return null;
  const out = new Date(Date.UTC(y, mo - 1, d));
  return out.getUTCFullYear() === y &&
    out.getUTCMonth() === mo - 1 &&
    out.getUTCDate() === d
    ? out
    : null;
}

/** Midnight UTC on the same day. Used so a day count agrees with a date. */
export function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

/** `yyyy-mm-dd` for a Date, in UTC — never the box's local day. */
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Whole days from `now` until `when`. Negative once it is in the past.
 *
 * Floor, not round: with 1.9 days left the honest answer is "1 day", and
 * rounding up to 2 would have us say "2 days" on the morning something
 * expires tomorrow.
 */
export function daysUntil(when: Date, now: Date): number {
  return Math.floor((when.getTime() - now.getTime()) / MS_PER_DAY);
}

export type ExpiryState = 'valid' | 'expiring' | 'expired' | 'unknown';

/**
 * How a document should read on the list.
 *
 * `unknown` is a first-class state, not a fallback: a document whose date
 * nobody has confirmed must never be shown in green, because nothing is
 * watching it.
 */
export function expiryState(
  expiresOn: Date | null | undefined,
  confirmedAt: Date | null | undefined,
  now: Date,
): ExpiryState {
  if (!expiresOn || !confirmedAt) return 'unknown';
  const left = daysUntil(expiresOn, now);
  if (left < 0) return 'expired';
  if (left <= 180) return 'expiring';
  return 'valid';
}

/**
 * Which stages are DUE for a document, given what has already been sent.
 *
 * `lte`, not a band. A row added late, or muted and un-muted, or missed
 * because the box was down, still gets caught by the first stage it is
 * already inside — and the per-stage claim column is what stops it firing
 * twice. A band would silently skip anyone who was not looked at on exactly
 * the right night.
 *
 * Returns at most ONE stage: the nearest unfired one. Firing T-180, T-120 and
 * T-100 in the same minute because a document was added at 90 days would be
 * three messages saying the same thing.
 */
export function dueStage(
  expiresOn: Date,
  now: Date,
  alreadySent: Partial<Record<ReminderStage, boolean>>,
): ReminderStage | null {
  const left = daysUntil(expiresOn, now);
  // Walk from the tightest window outwards. The FIRST stage whose window we
  // are inside is the most urgent thing there is to say.
  for (let i = REMINDER_STAGES.length - 1; i >= 0; i--) {
    const s = REMINDER_STAGES[i];
    if (left > s.days) continue;
    // ⚠️ AND STOP THERE, sent or not. Falling through to a wider stage would
    // mean that a document which has already had its "it has expired" message
    // goes on to receive "it expires in 30 days" the following night —
    // every earlier stage is still technically inside its window forever.
    return alreadySent[s.stage] ? null : s.stage;
  }
  return null;
}

/**
 * How long a competency certificate lasts, when the certificate does not say.
 *
 * ⚠️ SECTION 10(2) OF THE FIREARMS CONTROL ACT 60 OF 2000, read from the text
 * rather than recalled: "A competency certificate lapses after five years from
 * its date of issue." Most competency certificates print only an issue date,
 * so a member who has just photographed one is looking at a document with no
 * expiry on it and a form asking for one.
 *
 * ⚠️ IT IS A SUGGESTION, NOT A FINDING, and the confirm step is what makes
 * that safe: nothing here arms the reminder sweep until the member has looked
 * at the date and said it is right. We are doing the arithmetic they would
 * otherwise do in their head, and showing our reasoning.
 *
 * ⚠️ NOT APPLIED TO ANY OTHER KIND. Licence validity runs off section 27 and
 * varies by section — two, five or ten years — and dedicated status expiries
 * are set by the association, not by statute. Guessing either would be
 * inventing a deadline.
 */
export const COMPETENCY_YEARS = 5;

export function competencyLapses(issuedOn: Date): Date {
  const d = new Date(issuedOn.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + COMPETENCY_YEARS);
  return d;
}
