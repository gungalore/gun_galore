// ────────────────────────────────────────────────────────────────────
// WHICH REPEATING ITEM A FIELD BELONGS TO.
//
// Operator, 2026-08-24: "for something like the firearm details where there is
// a lot of inputs, hide each firearm's detail underneath a theme-matching
// dropdown. Do the same for similar items."
//
// The wizard collapses each owned firearm and each association into its own
// disclosure. That needs one thing the registry does not state: given a field
// key, which item is it part of. This is that, on its own, because it is pure,
// it is the part that breaks silently, and the page component it is used from
// cannot be unit-tested without a DOM and a live application.
//
// ⚠️ PRESENTATION ONLY. Nothing here changes the registry, groupBySection, the
// required-field counting or what is saved. A field that belongs to no item is
// returned as null and renders loose, exactly where it always did.
// ────────────────────────────────────────────────────────────────────

export const OWNED_SECTION = 'Firearms you already own';
export const ASSOCIATION_SECTION = 'Dedicated status';

/**
 * The item a key belongs to, or null if it stands alone.
 *
 * ⚠️ ASSOCIATION 1 HAS NO NUMBER IN ITS KEYS, AND THAT ASYMMETRY IS THE WHOLE
 * REASON THIS IS TESTED. The first association is `association_name`,
 * `association_number` and `dedicated_since`; only the second and third are
 * `association_2_*` / `association_3_*`. A single `_(\d)_` regex — the obvious
 * implementation, and the one the page's own row-visibility filter uses for a
 * different purpose — matches only 2 and 3, which would leave the first
 * association's three boxes loose above two tidy collapsibles. It looks like a
 * styling slip and is actually a missing case.
 *
 * `dedicated_since` is deliberately included: it is association 1's joining
 * date (2 and 3 use `association_N_joined`), so it belongs in that item.
 */
export function slotOfKey(section: string, key: string): string | null {
  if (section === OWNED_SECTION) {
    return /^existing_firearm_(\d+)_/.exec(key)?.[1] ?? null;
  }
  if (section === ASSOCIATION_SECTION) {
    if (
      key === 'association_name' ||
      key === 'association_number' ||
      key === 'dedicated_since'
    ) {
      return '1';
    }
    return /^association_(\d)_/.exec(key)?.[1] ?? null;
  }
  return null;
}

/** The key holding an item's display name, per slot. */
export function nameKeyFor(section: string, slot: string): string | null {
  if (section === OWNED_SECTION) return `existing_firearm_${slot}_make`;
  if (section === ASSOCIATION_SECTION) {
    return slot === '1' ? 'association_name' : `association_${slot}_name`;
  }
  return null;
}

/** The keys making up an item's one-line summary, in order, per slot. */
export function summaryKeysFor(section: string, slot: string): string[] {
  if (section === OWNED_SECTION) {
    return [
      `existing_firearm_${slot}_calibre`,
      `existing_firearm_${slot}_type`,
    ];
  }
  if (section === ASSOCIATION_SECTION) {
    return [
      slot === '1' ? 'association_number' : `association_${slot}_number`,
    ];
  }
  return [];
}

/** Whether a section's fields collapse into per-item disclosures at all. */
export function isRepeatingSection(section: string): boolean {
  return section === OWNED_SECTION || section === ASSOCIATION_SECTION;
}
