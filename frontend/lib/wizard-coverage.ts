// ────────────────────────────────────────────────────────────────────
// EVERY QUESTION HAS A HOME, OR THE FORM GOES IN WITH A BLANK BOX.
//
// ⚠️ THIS EXISTS BECAUSE FOUR SECTIONS HAD NO STEP AND NOTHING SAID SO.
// The wizard was built from an artboard drawn for one licence type — a section
// 16 dedicated sport shooter — so it had steps for the seven sections that
// applicant sees and none for the other four:
//
//   Experience             12 fields  what you hunt or compete in (S15, S16)
//   Your circumstances      3 fields  the threat case            (S13)
//   The existing licence    3 fields  what is being renewed      (S24)
//   The SAPS 271 form       1 field   the fill-it-in opt-in
//
// Nineteen questions the classic wizard asks and the new one silently did not.
// A member would have finished every step, been told nothing was outstanding,
// and been unable to generate a pack — with no error naming the reason.
//
// The failure is silent by construction: a section with no step simply never
// renders, and `missingRequired` counts it against a member who was never
// given anywhere to answer it. So it is asserted, not watched for.
// ────────────────────────────────────────────────────────────────────

import type { MotivationField } from '@/lib/motivations-api';

export interface StepLike {
  key: string;
  sections?: string[];
}

/**
 * Registry sections that no step claims.
 *
 * Pass the fields for ONE licence type; the registry serves a different set
 * per type and a section can be required on one and absent on another.
 */
export function homelessSections(
  fields: MotivationField[],
  steps: StepLike[],
): string[] {
  const claimed = new Set(steps.flatMap((s) => s.sections ?? []));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of fields) {
    if (seen.has(f.section)) continue;
    seen.add(f.section);
    if (!claimed.has(f.section)) out.push(f.section);
  }
  return out;
}

/**
 * Steps claiming a section the registry never serves.
 *
 * The gentler failure — an empty step rather than a lost question — but it
 * still puts a heading with nothing under it in front of somebody, and it is
 * usually a typo in a section name that the other direction cannot catch.
 */
export function emptyClaims(
  fields: MotivationField[],
  steps: StepLike[],
): string[] {
  const real = new Set(fields.map((f) => f.section));
  const out: string[] = [];
  for (const s of steps) {
    for (const sec of s.sections ?? []) {
      if (!real.has(sec) && !out.includes(sec)) out.push(sec);
    }
  }
  return out;
}

/** A section claimed by more than one step — two homes is as wrong as none. */
export function duplicateClaims(steps: StepLike[]): string[] {
  const count = new Map<string, number>();
  for (const s of steps) {
    for (const sec of s.sections ?? []) {
      count.set(sec, (count.get(sec) ?? 0) + 1);
    }
  }
  return [...count.entries()].filter(([, n]) => n > 1).map(([sec]) => sec);
}
