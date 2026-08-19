// ────────────────────────────────────────────────────────────────────
// CALENDAR MATHS FOR THE DATE PICKER.
//
// Pure, dependency-free, and — the point of the whole file — IT NEVER
// CONSTRUCTS A Date FROM A VALUE.
//
// ⚠️ THE TIMEZONE TRAP. `new Date('2026-08-19')` parses as MIDNIGHT UTC, which
// in South Africa (UTC+2) is 02:00 on the 19th — fine. But the reverse,
// `date.toISOString().slice(0, 10)`, converts LOCAL back to UTC, and for a
// member picking a date at 00:30 SAST that yields YESTERDAY. That single line
// is the classic off-by-one in every hand-rolled date picker, and it would put
// a licence-expiry reminder out by a day.
//
// So: a date is three integers here, start to finish. The only place a real
// Date is created is todayYmd(), which reads LOCAL calendar components and
// never serialises. The weekday comes from Sakamoto's algorithm rather than
// from Date at all.
//
// The string form is strict ISO yyyy-mm-dd, deliberately identical to what the
// backend's parseIsoDate accepts — it round-trips the string and rejects
// impossible dates like 2026-02-31. Anything this module emits must survive
// that parser untouched.
// ────────────────────────────────────────────────────────────────────

/** A calendar date as the member thinks of it. `m` is 1-12, NOT 0-11. */
export interface Ymd {
  y: number;
  m: number;
  d: number;
}

/** Gregorian. Every 4 years, except centuries, except every 400. */
export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function daysInMonth(y: number, m: number): number {
  if (m < 1 || m > 12) return 0;
  if (m === 2 && isLeapYear(y)) return 29;
  return MONTH_LENGTHS[m - 1];
}

export function isValidYmd(p: Ymd): boolean {
  if (!Number.isInteger(p.y) || !Number.isInteger(p.m) || !Number.isInteger(p.d)) {
    return false;
  }
  if (p.y < MIN_YEAR || p.y > MAX_YEAR) return false;
  if (p.m < 1 || p.m > 12) return false;
  return p.d >= 1 && p.d <= daysInMonth(p.y, p.m);
}

/**
 * The years this picker will navigate between.
 *
 * Not arbitrary: a firearm made in the 1890s is a real thing a member may date,
 * and a licence expiry is at most a decade out. Sakamoto's weekday algorithm is
 * only correct for Gregorian dates, which is the other reason not to go earlier.
 */
export const MIN_YEAR = 1800;
export const MAX_YEAR = 2200;

/**
 * STRICT. Anything that is not exactly yyyy-mm-dd, or that names a day the
 * month does not have, is null — never a silently corrected date.
 */
export function parseIso(value: string | null | undefined): Ymd | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const p = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  return isValidYmd(p) ? p : null;
}

export function toIso(p: Ymd): string {
  const mm = String(p.m).padStart(2, '0');
  const dd = String(p.d).padStart(2, '0');
  return `${String(p.y).padStart(4, '0')}-${mm}-${dd}`;
}

/**
 * TODAY, as the member's own calendar shows it.
 *
 * Local components, deliberately. toISOString() here would be UTC and would
 * mark the wrong square as "today" for every South African between midnight
 * and 02:00.
 *
 * ⚠️ Not safe to call during a server render — the server's clock and timezone
 * are not the browser's, so a value rendered on both sides can differ and
 * hydration will warn. Call it on open, or in an effect.
 */
export function todayYmd(now: Date = new Date()): Ymd {
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
}

/** Negative if a is earlier, 0 if the same day, positive if later. */
export function compareYmd(a: Ymd, b: Ymd): number {
  if (a.y !== b.y) return a.y - b.y;
  if (a.m !== b.m) return a.m - b.m;
  return a.d - b.d;
}

export function sameYmd(a: Ymd | null, b: Ymd | null): boolean {
  return !!a && !!b && compareYmd(a, b) === 0;
}

/**
 * Day of the week WITHOUT touching Date — Sakamoto's algorithm.
 *
 * Returns 0 = Monday … 6 = Sunday. Monday-first because that is how a South
 * African wall calendar is printed.
 */
const SAKAMOTO = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
export function weekdayIndex(p: Ymd): number {
  let y = p.y;
  if (p.m < 3) y -= 1;
  const sunFirst =
    (y +
      Math.floor(y / 4) -
      Math.floor(y / 100) +
      Math.floor(y / 400) +
      SAKAMOTO[p.m - 1] +
      p.d) %
    7;
  // Sakamoto counts from Sunday; shift so Monday is 0.
  return (sunFirst + 6) % 7;
}

// ── the decade page ─────────────────────────────────────────────────
//
// "Put 10 years on one page with arrows to the next 10 years" — so the page is
// the calendar decade a year actually belongs to (2020-2029 for 2026), not ten
// years counted from wherever the cursor happens to be. That way the same year
// is always on the same page, and paging back and forth is stable.

export function decadeStartFor(year: number): number {
  return Math.floor(year / 10) * 10;
}

export function decadeYears(start: number): number[] {
  return Array.from({ length: 10 }, (_, i) => start + i);
}

// ── range limits ────────────────────────────────────────────────────
//
// min and max arrive as the same ISO strings the native input takes, so a call
// site that already sets min/max keeps working unchanged. An unparseable limit
// is treated as no limit, which is the safe direction: it can never lock a
// member out of a date they are entitled to pick.

export interface Limits {
  min: Ymd | null;
  max: Ymd | null;
}

export function limitsFrom(min?: string | null, max?: string | null): Limits {
  return { min: parseIso(min), max: parseIso(max) };
}

export function dayDisabled(p: Ymd, lim: Limits): boolean {
  if (lim.min && compareYmd(p, lim.min) < 0) return true;
  if (lim.max && compareYmd(p, lim.max) > 0) return true;
  return false;
}

/** Disabled only when EVERY day in the month is out of range. */
export function monthDisabled(y: number, m: number, lim: Limits): boolean {
  const last = { y, m, d: daysInMonth(y, m) };
  const first = { y, m, d: 1 };
  if (lim.min && compareYmd(last, lim.min) < 0) return true;
  if (lim.max && compareYmd(first, lim.max) > 0) return true;
  return false;
}

/** Disabled only when EVERY day in the year is out of range. */
export function yearDisabled(y: number, lim: Limits): boolean {
  if (y < MIN_YEAR || y > MAX_YEAR) return true;
  if (lim.min && y < lim.min.y) return true;
  if (lim.max && y > lim.max.y) return true;
  return false;
}

/**
 * The nearest allowed day to p.
 *
 * Used when a member picks a year and month whose remembered day no longer
 * exists — 31 January, then February — and when a limit moves under a value
 * that was already chosen.
 */
export function clampToLimits(p: Ymd, lim: Limits): Ymd {
  if (lim.min && compareYmd(p, lim.min) < 0) return { ...lim.min };
  if (lim.max && compareYmd(p, lim.max) > 0) return { ...lim.max };
  return { ...p };
}

/** 31 January → February gives 28 or 29, never an impossible 31st. */
export function clampDayToMonth(y: number, m: number, d: number): Ymd {
  return { y, m, d: Math.min(Math.max(d, 1), daysInMonth(y, m)) };
}

// ── the grid ────────────────────────────────────────────────────────

export interface DayCell {
  /** null renders an empty square: the days before the 1st, or after the last. */
  date: Ymd | null;
  disabled: boolean;
}

/**
 * Six weeks of squares for one month, Monday first.
 *
 * ALWAYS 42 CELLS, deliberately. A month grid that changes height between
 * months makes the buttons below it jump under a thumb that is already moving
 * towards them.
 */
export function monthGrid(y: number, m: number, lim: Limits): DayCell[] {
  const lead = weekdayIndex({ y, m, d: 1 });
  const total = daysInMonth(y, m);
  return Array.from({ length: 42 }, (_, i) => {
    const dayNumber = i - lead + 1;
    if (dayNumber < 1 || dayNumber > total) return { date: null, disabled: true };
    const date = { y, m, d: dayNumber };
    return { date, disabled: dayDisabled(date, lim) };
  });
}

// ── words ───────────────────────────────────────────────────────────

export const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Monday first, matching weekdayIndex. */
export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAY_INITIAL = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * "19 August 2026". Built from the integers, not toLocaleDateString — the same
 * timezone trap applies, and this way a date reads identically on every device.
 */
export function formatLong(p: Ymd): string {
  return `${p.d} ${MONTH_LABELS[p.m - 1]} ${p.y}`;
}

/** "19 Aug 2026", for a trigger button that has to fit on a phone. */
export function formatShort(p: Ymd): string {
  return `${p.d} ${MONTH_SHORT[p.m - 1]} ${p.y}`;
}

// ── typed entry ─────────────────────────────────────────────────────

/**
 * A date somebody TYPED, read forgivingly.
 *
 * en-ZA writes 19/08/2026, the backend wants 2026-08-19, and a member copying
 * off a certificate will use whichever form the certificate used. All of these
 * mean the same day:
 *
 *   2026-08-19   2026/08/19   19/08/2026   19-08-2026   19.08.2026
 *
 * REFUSED, deliberately:
 *   - two-digit years. In a date-of-birth field "58" is a coin flip between
 *     1958 and 2058, and a wrong guess here is a wrong reminder later.
 *   - month names, ordinals, anything else. The calendar is right there.
 *   - impossible days. 31/02/2026 is null, never quietly 3 March.
 *
 * ⚠️ 05/06/2026 is a real date under BOTH readings and we take the South
 * African one — 5 June. The caller must normalise the box to canonical ISO on
 * blur so that choice is visible immediately, not at reminder time.
 */
export function parseLoose(value: string | null | undefined): Ymd | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();

  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (iso) {
    const p = { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) };
    return isValidYmd(p) ? p : null;
  }

  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (dmy) {
    const p = { y: Number(dmy[3]), m: Number(dmy[2]), d: Number(dmy[1]) };
    return isValidYmd(p) ? p : null;
  }

  return null;
}

/** Whole years, for min/max arithmetic. 29 Feb − 18y lands on 28 Feb. */
export function shiftYears(p: Ymd, years: number): Ymd {
  return clampDayToMonth(p.y + years, p.m, p.d);
}

/**
 * Decade chips for a field whose reach is wide — a date of birth is forty
 * years back and nobody should tap an arrow four times to get there.
 *
 * Bounded by the field's own limits, so a DOB field never offers a decade
 * that is entirely in the future.
 */
export function decadeStrip(lim: Limits, focusYear: number): number[] {
  const lo = decadeStartFor(
    Math.max(lim.min?.y ?? MIN_YEAR, focusYear - 120, MIN_YEAR),
  );
  const hi = decadeStartFor(
    Math.min(lim.max?.y ?? MAX_YEAR, focusYear + 40, MAX_YEAR),
  );
  const out: number[] = [];
  for (let y = lo; y <= hi; y += 10) out.push(y);
  return out;
}
