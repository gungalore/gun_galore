import type { NewsIncident } from './motivations-api';

// ────────────────────────────────────────────────────────────────────
// PRESS CLIPPINGS — pure helpers behind the "Reported near you" picker.
//
// `press_clippings` is a hidden S13 registry field, written through the same
// answer-change path as every visible one — see `police_station` for the
// established pattern of a field the generic renderer must never show as a
// box of its own (police_station_province in station-picker.tsx /
// field-grid.tsx is the same idea). Its value on the wire is a JSON array of
// chosen NewsIncident ids. Nothing here touches the DOM, so the parsing,
// capping and ordering rules are testable without a browser.
// ────────────────────────────────────────────────────────────────────

/** The registry key. Import this rather than repeating the string literal. */
export const PRESS_CLIPPINGS_KEY = 'press_clippings';

/** A motivation may carry at most this many clippings. */
export const MAX_CLIPPINGS = 8;

/** The one-line reason an unchecked card disables at the cap. */
export const CLIPPING_LIMIT_REASON = `You can attach up to ${MAX_CLIPPINGS} clippings — remove one to add another.`;

/**
 * De-duplicate and cap a list of ids, keeping the FIRST occurrence of each.
 *
 * That first-occurrence order is also the CLICK order, since
 * `toggleClippingId` below only ever appends a newly-chosen id to the end —
 * never re-sorts by where the incident happens to sit in the list the API
 * returned.
 */
function normalise(ids: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== 'string' || !id) continue;
    if (out.includes(id)) continue;
    out.push(id);
    if (out.length >= MAX_CLIPPINGS) break;
  }
  return out;
}

/**
 * Read the `press_clippings` answer. Never throws — a blank answer, an old
 * or foreign shape, or plain garbage all come back as an empty list rather
 * than crashing the step they load into.
 */
export function parseClippingIds(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return normalise(parsed);
}

/** Write the answer back — always capped and de-duplicated, never assumed. */
export function serialiseClippingIds(ids: readonly string[]): string {
  return JSON.stringify(normalise(ids));
}

/**
 * Add or remove one id, preserving click order — a later pick lands at the
 * end of the list, not wherever its incident sits among the ones the API
 * returned. A no-op once the cap is already reached and `id` is not already
 * selected: the picker disables the control at that point, and this is the
 * defensive twin of that, so a stray call can never push past 8.
 */
export function toggleClippingId(
  ids: readonly string[],
  id: string,
): string[] {
  const current = normalise(ids);
  if (current.includes(id)) return current.filter((x) => x !== id);
  if (current.length >= MAX_CLIPPINGS) return current;
  return [...current, id];
}

/**
 * "Armed robbery" — from whatever shape the crime type arrives in. A
 * classifier can as easily send `armed_robbery` as prose, so this lowercases
 * and re-capitalises the first letter rather than assuming either shape.
 * `null` (no classification) stays `null` — never a manufactured label.
 */
export function crimeTypeLabel(crimeType: string | null): string | null {
  if (!crimeType) return null;
  const cleaned = crimeType.replace(/[_-]+/g, ' ').trim().toLowerCase();
  if (!cleaned) return null;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** "3 km away", or null when the incident carries no distance. */
export function formatDistanceKm(distanceKm: number | null): string | null {
  if (distanceKm === null || Number.isNaN(distanceKm)) return null;
  return `${Math.max(0, Math.round(distanceKm))} km away`;
}

/**
 * "12 Mar 2026" — the same en-ZA day/month/year shape as `formatDate` in
 * licence-centre-api.ts, pinned to UTC so a date the paper printed never
 * shifts a day depending on the reader's own timezone.
 */
export function formatPublishedOn(publishedOn: string): string {
  const d = new Date(publishedOn);
  if (Number.isNaN(d.getTime())) return publishedOn;
  return d.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * "3 km away · Lowvelder · 12 Mar 2026" — the one line under every card's
 * headline. Distance leads when we have it and is skipped, not blanked, when
 * we don't; the paper's name and the date are always present.
 */
export function incidentMetaLine(
  incident: Pick<NewsIncident, 'distanceKm' | 'sourceName' | 'publishedOn'>,
): string {
  const parts: string[] = [];
  const distance = formatDistanceKm(incident.distanceKm);
  if (distance) parts.push(distance);
  parts.push(incident.sourceName);
  parts.push(formatPublishedOn(incident.publishedOn));
  return parts.join(' · ');
}
