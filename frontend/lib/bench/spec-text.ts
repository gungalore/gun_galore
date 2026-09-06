/**
 * THE BENCH — plain words for the spec card's header and dimension rows.
 *
 * The reference file stores a cartridge's case type as the numbered string the
 * sheet prints (`"1 rimless"`) and its origin as a two-letter country code
 * (`"US"`). Both went straight onto the card, so the header read
 * `1 rimless · US · 2012` where SPEC §6.3 asks for `Rimless · United States ·
 * 2012`.
 *
 * ⚠️ PURE, AND SEPARATE FROM THE CARD, SO IT CAN BE TESTED. Every function
 * here takes a string off the wire and returns something to print. Nothing
 * fetches, nothing renders, nothing throws — an unrecognised value comes back
 * as printed rather than as a blank, because a blank in the header is
 * indistinguishable from "we have no figure" and this is a display map, not a
 * validation.
 *
 * COPY: these are product facts (a case shape, a country). Nothing here names
 * where a figure comes from — see the note at the foot of
 * components/bench/contract.ts.
 */

/**
 * The case-head shapes, keyed by the word the sheet prints after its number.
 *
 * Four is the whole set; the number is an index into the sheet's own list and
 * carries no meaning on screen, so it is stripped before the lookup rather
 * than being part of the key. A fifth shape appearing in the data therefore
 * still prints — as its own word, unnumbered — instead of vanishing.
 */
const CASE_TYPES: Record<string, string> = {
  rimless: 'Rimless',
  rimmed: 'Rimmed',
  belted: 'Belted',
  rebated: 'Rebated',
};

/**
 * The origins that actually occur in the reference file, as country names.
 *
 * ⚠️ AN UNKNOWN CODE PRINTS ITSELF. A two-letter code is ugly beside "United
 * Kingdom" but it is still true, and the alternative — dropping it — loses the
 * only origin the card was given.
 */
const ORIGINS: Record<string, string> = {
  US: 'United States',
  GB: 'United Kingdom',
  DE: 'Germany',
  FI: 'Finland',
  SE: 'Sweden',
  AT: 'Austria',
  CZ: 'Czech Republic',
  CH: 'Switzerland',
  FR: 'France',
  IT: 'Italy',
  BE: 'Belgium',
  RU: 'Russia',
  ZA: 'South Africa',
  NO: 'Norway',
  ES: 'Spain',
};

/** Trim, and treat an empty or whitespace-only string as absent. */
function clean(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/**
 * `"1 rimless"` → `"Rimless"`; `"3 belted"` → `"Belted"`.
 *
 * The leading index is stripped whatever follows it, so a shape this map has
 * never seen prints as the sheet wrote it rather than as a number.
 */
export function caseTypeText(type: string | null | undefined): string | null {
  const t = clean(type);
  if (t === null) return null;
  const stripped = t.replace(/^\d+\s*/, '').trim();
  if (stripped === '') return null;
  return CASE_TYPES[stripped.toLowerCase()] ?? stripped;
}

/** `"US"` → `"United States"`. Anything else comes back as printed. */
export function originText(origin: string | null | undefined): string | null {
  const o = clean(origin);
  if (o === null) return null;
  return ORIGINS[o.toUpperCase()] ?? o;
}

/**
 * Is this a belted case?
 *
 * ⚠️ IT DECIDES WHAT THE DRAWING NOTE SAYS, NOT WHAT THE DRAWING DRAWS. The
 * belt sits about 5 mm ahead of the head at the rim's own diameter, and NO
 * figure in `Dims` locates it: `R1` is the rim, `R` its thickness, and the
 * belt's length has no letter at all. A belt drawn from the rim diameter alone
 * would be a feature invented at the one point of the case a reloader measures
 * against a shell holder. So the belt is not drawn and the note says so.
 */
export function isBeltedType(type: string | null | undefined): boolean {
  return caseTypeText(type) === 'Belted';
}

/** The header line: `Rimless · United States · 2012`. Empty when nothing is known. */
export function headerMeta(c: {
  type?: string | null;
  origin?: string | null;
  year?: number | null;
}): string {
  return [caseTypeText(c.type), originText(c.origin), c.year ?? null]
    .filter((v): v is string | number => v !== null && v !== undefined && v !== '')
    .join(' · ');
}

/**
 * The printed tolerances, keyed by dimension letter.
 *
 * ⚠️ READ DEFENSIVELY AND NEVER PARSED. `dims` arrives as a loose record, and
 * `tolerances` is a JSON column whose values are text exactly as the sheet
 * printed them (`"-0.20"`, `"+0.30/-0.10"`, `"±0.05"`). Turning one into a
 * number and re-formatting it would state a tolerance nobody wrote; it is
 * shown verbatim beside the figure or not at all.
 *
 * A non-string value (a number that slipped through, a nested object) is
 * dropped rather than coerced.
 */
export function tolerancesOf(
  dims: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const raw = dims?.tolerances;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const t = typeof v === 'string' ? v.trim() : '';
    if (t !== '') out[k] = t;
  }
  return out;
}

/**
 * `"37.84 mm (1.490″)"` + `"-0.20"` → `"37.84 mm (1.490″) −0.20"`.
 *
 * The hyphen the sheet prints is replaced with a real minus sign so the sign
 * does not read as a dash between two figures; nothing else about the string
 * is touched.
 */
export function withTolerance(value: string, tol: string | undefined): string {
  const t = typeof tol === 'string' ? tol.trim() : '';
  if (t === '') return value;
  return `${value} ${t.replace(/-/g, '−')}`;
}
