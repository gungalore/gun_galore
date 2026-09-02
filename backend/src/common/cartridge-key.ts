/**
 * The canonical cartridge key.
 *
 * Moved here from the Load Lab when that module was removed. It is shared by
 * the Bench, the C.I.P. sheet lookup and the reloading extractor, none of
 * which should have to depend on a retired feature to spell a cartridge.
 *
 * 🚨 THE OUTPUT OF THIS FUNCTION IS PERSISTED DATA, NOT A RUNTIME DETAIL. It
 * is `CartridgeSpec`'s primary key and the `cartridgeKey` column on 50,789
 * `ManualLoad` rows, and the Bench keys its own tables the same way. Changing
 * what it returns — a new alias, a different strip order, one more character
 * class — does not error and does not fail a build. It silently re-keys every
 * new lookup away from every row already stored, and the joins simply stop
 * finding anything.
 *
 * So: this file is append-only in spirit. cartridge-key.spec.ts pins the exact
 * output for a spread of real cartridge spellings; if a change makes that spec
 * fail, the change is wrong, not the spec.
 *
 * Strips parentheticals, expands common abbreviations, drops punctuation, so
 * the GRT spelling (".308 Win. (7.62x51)") and the manual's (".308
 * Winchester") land on the same key.
 */

/**
 * ⚠️ DO NOT ADD C.I.P.'s OWN ABBREVIATIONS HERE. motivations/cip-sheet.service
 * normalises "govt"/"auto" on its own side, deliberately, and its comment
 * explains why: a word added to this shared map re-keys every stored row,
 * whereas normalising at the call site leaves the database untouched.
 */
export const CART_ALIASES: Record<string, string> = {
  win: 'winchester',
  rem: 'remington',
  mag: 'magnum',
  spr: 'springfield',
  sprg: 'springfield',
  spring: 'springfield',
  spfld: 'springfield',
  sprfld: 'springfield',
  wby: 'weatherby',
  creed: 'creedmoor',
  nato: '',
  rcbs: '',
};

export function cartridgeKey(name: string): string {
  let s = (name || '').toLowerCase();
  s = s.replace(/\([^)]*\)/g, ' '); // drop parenthetical aliases/specs
  s = s.replace(/(\d)\s*mm\b/g, '$1'); // "6.5mm"→"6.5", "9.3x62mm"→"9.3x62" (Somchem site uses mm)
  s = s.replace(/[a-z]+/g, (w) => CART_ALIASES[w] ?? w); // expand abbreviations
  return s.replace(/[^a-z0-9]/g, '');
}
