// ────────────────────────────────────────────────────────────────────
// Pure formatting/selection helpers for the SAPS precinct card and the
// station picker. No DOM, no fetch — everything here takes typed data and
// returns typed data, so the decisions (which four categories lead, what
// colour a rising number gets) are testable without a browser.
// ────────────────────────────────────────────────────────────────────

import type {
  CrimeStatsStation,
  PrecinctCategoryFigures,
} from './motivations-api';

/** "Sea Point · Cape Town, Western Cape" — one line for a combobox option. */
export function stationLabel(station: CrimeStatsStation): string {
  return `${station.name} · ${station.district}, ${station.province}`;
}

/**
 * The categories most likely to matter to a self-defence motivation, in the
 * order a reader should see them.
 *
 * ⚠️ NOT "the four biggest counts". A precinct's largest category is often
 * something with no bearing on a threat-to-life argument (shoplifting,
 * drug possession), and leading with it would bury the property and violent
 * crime figures the motivation actually needs three rows down. This is a
 * fixed preference order; the release's own category names are matched
 * case-insensitively so a small wording difference between releases doesn't
 * drop a category the member needs to see.
 */
const HEADLINE_PREFERENCE = [
  'murder',
  'attempted murder',
  'robbery aggravating circumstances',
  'aggravated robbery',
  'robbery at residential premises',
  'robbery at non-residential premises',
  'burglary at residential premises',
  'assault gbh',
  'assault with intent to inflict grievous bodily harm',
  'attempted robbery',
];

/**
 * Pick up to `limit` categories to lead with — preferred ones first, in
 * `HEADLINE_PREFERENCE` order, then whatever is left over in the order the
 * release gave it, until the limit is reached.
 *
 * ⚠️ NEVER DROPS BELOW WHAT'S AVAILABLE. A release with two categories shows
 * two, not four blanks — the card's job is to report what SAPS actually
 * published for this precinct, not to promise a shape it can't fill.
 */
export function pickHeadlineCategories(
  categories: readonly PrecinctCategoryFigures[],
  limit = 4,
): PrecinctCategoryFigures[] {
  if (categories.length <= limit) return [...categories];

  const norm = (s: string) => s.trim().toLowerCase();
  const picked: PrecinctCategoryFigures[] = [];

  for (const want of HEADLINE_PREFERENCE) {
    if (picked.length >= limit) break;
    const hit = categories.find(
      (c) => !picked.includes(c) && norm(c.category).includes(want),
    );
    if (hit) picked.push(hit);
  }

  // Fill any remaining slots from the release's own order, so a precinct
  // whose recorded crime doesn't match our preference list still shows
  // something rather than fewer than `limit` rows.
  for (const c of categories) {
    if (picked.length >= limit) break;
    if (!picked.includes(c)) picked.push(c);
  }

  return picked;
}

export type YoyTone = 'amber' | 'neutral';

export interface YoyChip {
  text: string;
  tone: YoyTone;
}

/**
 * The year-on-year change, as a chip — or null when the release has nothing
 * to compare against (no matching quarter a year back).
 *
 * ⚠️ NEVER 'red' AS A TONE. This is a SAPS-recorded fact going into a
 * motivation, not a validation error — see the CLAUDE.md note on this card.
 * A rise is 'amber' (worth a second look), a fall or flat reading is
 * 'neutral'. Never map either to the red the rest of the app reserves for
 * errors and CTAs.
 */
export function yoyChip(pct: number | null): YoyChip | null {
  if (pct === null || Number.isNaN(pct)) return null;
  const rounded = Math.round(pct * 10) / 10;
  if (rounded > 0) return { text: `+${rounded}%`, tone: 'amber' };
  if (rounded < 0) return { text: `−${Math.abs(rounded)}%`, tone: 'neutral' };
  return { text: '0%', tone: 'neutral' };
}

/**
 * "63 092", grouped by thousands with a plain space.
 *
 * ⚠️ NOT toLocaleString('en-ZA') — Node and the browser disagree on which
 * space character en-ZA groups with (a hairline vs a no-break space), and the
 * mismatch between the server-rendered and client-rendered digit surfaces as
 * a React hydration warning on an otherwise correct page. This is
 * deterministic in both.
 */
export function groupThousands(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
