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
    // ⚠️ MODEL, SERIAL, EXPIRY — AND THE MAKE IS THE ROW'S TITLE, so the four
    // the operator asked for are all on the line and none is printed twice.
    //
    // Operator, 2026-09-07: "when listing the fire arms I already own it
    // should only be the make, model, serial number and expiry date listed,
    // nothing else." That SUPERSEDES 2026-08-28's "just the calibre and make
    // as it is in the licence centre", which is why the calibre has gone from
    // this line. The calibre is not removed from the application — it remains
    // a registry field, it still prints on the SAPS 271, and the
    // duplicate-calibre argument in the motivation is built out of it. It is
    // simply not how a person picks their own firearm out of a list.
    //
    // ⚠️ THREE SERIAL KEYS, IN PRECEDENCE ORDER, AND ONLY THE FIRST IS SHOWN.
    // `_serial` is replacing `_frame_serial` / `_barrel_serial`; a draft saved
    // before that change still holds the old pair, and listing all three would
    // print the same number three times. summaryLineFor resolves it.
    return [
      `existing_firearm_${slot}_model`,
      `existing_firearm_${slot}_serial`,
      `existing_firearm_${slot}_expiry`,
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

export type Partitioned =
  | { kind: 'plain'; key: string }
  | { kind: 'item'; slot: string; keys: string[] };

/**
 * A section's keys, in render order, with each repeating item bundled.
 *
 * ⚠️ AN ITEM TAKES THE POSITION OF ITS FIRST FIELD. Building the items and
 * appending them after the loose fields is the obvious implementation and it is
 * wrong: it hoists every loose field ahead of every collapsible, however far
 * down the section it actually sits. `overlap_justification` is declared last
 * in the registry and only exists once there IS an overlap — appended-items
 * ordering put it FIRST, so "Firearms you already own" opened with a
 * 2000-character "anything you want us to lead with" textarea sitting above the
 * firearms it is asking about.
 *
 * Pure, and tested, because that failure is invisible: nothing errors, nothing
 * is lost, the section is simply in the wrong order.
 */
export function partitionKeys(section: string, keys: string[]): Partitioned[] {
  const out: Partitioned[] = [];
  const at = new Map<string, number>();
  for (const key of keys) {
    const slot = slotOfKey(section, key);
    if (slot === null) {
      out.push({ kind: 'plain', key });
      continue;
    }
    const seen = at.get(slot);
    if (seen === undefined) {
      at.set(slot, out.length);
      out.push({ kind: 'item', slot, keys: [key] });
      continue;
    }
    (out[seen] as { keys: string[] }).keys.push(key);
  }
  return out;
}


/**
 * The one line under a repeating row's title.
 *
 * ⚠️ NOT `summaryKeysFor(...).map(val)`, WHICH IS WHAT THE PAGE USED TO DO.
 * Two things that mapping cannot express, and both put something wrong in
 * front of a member:
 *  - PRECEDENCE. An owned firearm's serial lives in `_serial` on a new answer
 *    set and in `_frame_serial` / `_barrel_serial` on a draft saved before the
 *    collapse. Mapping every key prints the same number up to three times;
 *    mapping only the new one shows a blank line for an older draft.
 *  - PLACEHOLDERS. A licence card prints NONE where a firearm has no separate
 *    frame serial, and NONE is a non-empty string, so `.filter(Boolean)` keeps
 *    it. The operator's own Glock card reads "Model NONE".
 *
 * `val` is the page's key-to-value getter, so this stays pure and testable.
 */
export function summaryLineFor(
  section: string,
  slot: string,
  val: (key: string) => string,
): string {
  const clean = (v: string) => {
    const t = (v ?? '').trim();
    return PLACEHOLDER.test(t) ? '' : t;
  };
  if (section === OWNED_SECTION) {
    const at = (col: string) => clean(val(`existing_firearm_${slot}_${col}`));
    const serial = at('serial') || at('barrel_serial') || at('frame_serial');
    return [at('model'), serial, at('expiry')].filter(Boolean).join(' · ');
  }
  return summaryKeysFor(section, slot).map(val).map(clean).filter(Boolean).join(' · ');
}

/**
 * What a card prints to mean "nothing here". A deliberate second copy of the
 * server's rule in backend/src/common/card-placeholder.ts — the browser bundle
 * has no import path to backend/. Anchored, so a real value that merely
 * contains one of these words is untouched.
 */
const PLACEHOLDER =
  /^(?:none|n\.?\/?a\.?|nil|null|not\s*applicable|geen|unknown|onbekend|[-–—.]+)$/i;
