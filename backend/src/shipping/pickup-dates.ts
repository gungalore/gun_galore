// ─── Pickup-date arithmetic (SAST, business days) ───────────────────────────
//
// Everything the seller's pickup picker and the Pargo payout clock need to
// reason about "the next business day". Pure and dependency-free so it is
// unit-testable without the Nest container.
//
// ⚠️ ALL SOUTH-AFRICAN LOGIC. SAST is UTC+2 with no DST, so a fixed offset is
// exact. We never touch the server's local timezone: the current instant is
// shifted into SAST and then read with the UTC getters, so the same date is
// produced on a dev box in Cape Town and a CI runner in UTC.
//
// Two rules live here:
//   1. The seller's "soonest" pickup day: tomorrow if booked before the
//      service's cut-off, else the day after; then rolled forward off the
//      weekend. Friday therefore always resolves to Monday.
//   2. The Pargo pickup deadline: the end of the NEXT calendar day, rolled to
//      Monday when that day is a weekend.

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const ALLOWED_COLLECTION_WINDOWS = [
  '08:00-11:00',
  '11:00-14:00',
  '14:00-17:00',
] as const;

export function isAllowedCollectionWindow(
  value: string | null | undefined,
): value is (typeof ALLOWED_COLLECTION_WINDOWS)[number] {
  return value != null &&
    (ALLOWED_COLLECTION_WINDOWS as readonly string[]).includes(value);
}

export interface PickupDay {
  /** SAST calendar date, `YYYY-MM-DD`. */
  iso: string;
  /** e.g. "Tuesday". */
  weekday: string;
}

interface Civil {
  y: number;
  m: number;
  d: number;
}

function sastCivil(now: Date): Civil & { h: number } {
  const s = new Date(now.getTime() + SAST_OFFSET_MS);
  return {
    y: s.getUTCFullYear(),
    m: s.getUTCMonth(),
    d: s.getUTCDate(),
    h: s.getUTCHours(),
  };
}

// Noon UTC of the civil date avoids any midnight/offset edge when asking for
// its weekday. SAST has no DST, so this is just belt-and-braces.
function dow(c: Civil): number {
  return new Date(Date.UTC(c.y, c.m, c.d, 12)).getUTCDay();
}

function isWeekend(c: Civil): boolean {
  const w = dow(c);
  return w === 0 || w === 6;
}

function addDays(c: Civil, n: number): Civil {
  const dt = new Date(Date.UTC(c.y, c.m, c.d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate() };
}

function rollToBusinessDay(c: Civil): Civil {
  let x = c;
  while (isWeekend(x)) x = addDays(x, 1);
  return x;
}

function isoOf(c: Civil): string {
  const mm = String(c.m + 1).padStart(2, '0');
  const dd = String(c.d).padStart(2, '0');
  return `${c.y}-${mm}-${dd}`;
}

function toDay(c: Civil): PickupDay {
  return { iso: isoOf(c), weekday: WEEKDAYS[dow(c)] };
}

function parseIso(iso: string): Civil {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Invalid pickup day: ${iso}`);
  return { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) };
}

/**
 * The soonest collection day a seller may choose.
 *
 * Booked before the cut-off (14:00 SAST by default) → tomorrow; at/after →
 * the day after. Either way the result is rolled off the weekend, so a Friday
 * booking is always Monday.
 */
export function soonestPickupDate(now: Date, cutoffHour = 14): PickupDay {
  const { y, m, d, h } = sastCivil(now);
  const base = addDays({ y, m, d }, h < cutoffHour ? 1 : 2);
  return toDay(rollToBusinessDay(base));
}

/** The next business day after a given day. */
export function nextPickupDay(day: PickupDay): PickupDay {
  return toDay(rollToBusinessDay(addDays(parseIso(day.iso), 1)));
}

/**
 * The end-of-day deadline for collecting a Pargo parcel: the next calendar day
 * after the parcel became collectable, rolled to Monday if that is a weekend.
 */
export function pickupDeadline(from: Date): PickupDay {
  const { y, m, d } = sastCivil(from);
  return toDay(rollToBusinessDay(addDays({ y, m, d }, 1)));
}

/**
 * The instant a collection day begins, as a real Date, for
 * `Transaction.collectionNotBeforeAt`. 08:00 SAST — the start of the courier
 * collection window.
 */
export function pickupInstant(day: PickupDay, hour = 8): Date {
  const hh = String(hour).padStart(2, '0');
  return new Date(`${day.iso}T${hh}:00:00+02:00`);
}

/**
 * The Bob Go `collection_min_date` wire value for a pickup day
 * (`YYYY-MM-DDT08:00:00+02:00`). Bob Go normalises to its own calendar.
 */
export function collectionMinDate(day: PickupDay, hour = 8): string {
  const hh = String(hour).padStart(2, '0');
  return `${day.iso}T${hh}:00:00+02:00`;
}

/** Whole days between two SAST calendar dates (positive when `to` is later). */
export function daysBetween(from: PickupDay, to: PickupDay): number {
  const a = Date.UTC(parseIso(from.iso).y, parseIso(from.iso).m, parseIso(from.iso).d);
  const b = Date.UTC(parseIso(to.iso).y, parseIso(to.iso).m, parseIso(to.iso).d);
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * The Bob Go `collection_min_date` value for a stored instant — the SAST
 * calendar day of `d` at the collection-window start. Used when booking, where
 * we hold `Transaction.collectionNotBeforeAt` (a Date) rather than a PickupDay.
 */
export function collectionMinDateFromDate(d: Date, hour = 8): string {
  const c = sastCivil(d);
  const hh = String(hour).padStart(2, '0');
  return `${isoOf({ y: c.y, m: c.m, d: c.d })}T${hh}:00:00+02:00`;
}

/**
 * Split a stored `collectionWindow` ("HH:MM-HH:MM") into Bob Go's
 * `collection_after` / `collection_before` ("HH:MM:SS") values. Unknown or
 * absent windows yield an empty object — Bob Go then uses the account default.
 */
export function windowToBobGo(
  w: string | null | undefined,
): { after?: string; before?: string } {
  if (!w) return {};
  const m = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(w.trim());
  if (!m) return {};
  return { after: `${m[1]}:00`, before: `${m[2]}:00` };
}

/**
 * Parse the accept endpoint's optional body into the schedule the service
 * stores. Anything malformed is dropped (the sale still accepts; the picker
 * simply falls back to Bob Go's next-business-day default) — a bad date string
 * must never block the seller from accepting.
 */
export function parseAcceptSchedule(body: {
  collectionNotBefore?: string;
  collectionWindow?: string;
}): { collectionNotBefore?: Date; collectionWindow?: string } {
  const out: { collectionNotBefore?: Date; collectionWindow?: string } = {};
  if (body?.collectionNotBefore) {
    const d = new Date(body.collectionNotBefore);
    if (!Number.isNaN(d.getTime())) out.collectionNotBefore = d;
  }
  if (
    body?.collectionWindow &&
    /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(body.collectionWindow)
  ) {
    out.collectionWindow = body.collectionWindow;
  }
  return out;
}
