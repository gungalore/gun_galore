import {
  type CompetencyCategory,
  type LinkedLicence,
  endorsementSpec,
  parseEndorsements,
  parseUnitStandards,
  unitStandardSpec,
} from '../common/sa-competency';

// ────────────────────────────────────────────────────────────────────
// WHAT EACH DOCUMENT SAYS ABOUT A FIREARM, ON THE ROW ITSELF.
//
// The Document Centre is being regrouped around the member's firearms: one
// row per licensed firearm, grouped by category, the competencies that cover
// them underneath, and the training certificates behind those.
//
// ⚠️ list() ALREADY WORKED ALL OF THIS OUT AND THREW IT AWAY. It categorises
// licences, reads their action, parses every competency's endorsements and
// derives dates off them — and then returned a row carrying none of it, so
// the page had no way to draw the grouping without re-reading encrypted blobs
// it cannot open. Nothing here is new knowledge; it is the knowledge that was
// already on the floor of that method, put on the row.
//
// ⚠️ PURE, AND DELIBERATELY SO. Every rule below is a judgement about a
// firearm — which category, which action, which licence a competency's date
// follows — and each one is wrong in a way a member would notice. They are
// testable here without a database, a member session or an AES key.
// ────────────────────────────────────────────────────────────────────

/**
 * The order every list of categories is rendered in.
 *
 * ⚠️ ONE ORDER, NOT THE ORDER THEY WERE PRINTED IN. Two members with the same
 * certificate must read identically, and a set has no order of its own — the
 * same reason proficiencyCover sorts its endorsements by the ENDORSEMENTS
 * table rather than by what the OCR happened to see first.
 */
export const CATEGORY_ORDER: readonly CompetencyCategory[] = [
  'handgun',
  'rifle-carbine',
  'shotgun',
  'muzzle-loader',
];

/**
 * A licence in the shape the derivation wants, plus what `follows` needs to
 * name one.
 *
 * ⚠️ `createdAt` IS A TIE-BREAK AND NOTHING ELSE. It decides which of two
 * licences sharing one expiry date gets named; no date is computed from it.
 */
export interface DatedLicence extends LinkedLicence {
  createdAt?: Date;
}

/** A unit standard as a member reads it: the code, and what it is called. */
export interface UnitStandardRow {
  code: string;
  title: string;
}

export interface FirearmFacets {
  /** The one firearm category this document is about, or null. */
  category: CompetencyCategory | null;
  /** Whether that firearm is self-loading. Licences only. */
  selfLoading: boolean | null;
  /** Every category a competency certificate covers, in CATEGORY_ORDER. */
  covers: CompetencyCategory[];
  /** Which licence a derived competency date follows. */
  follows: { id: string; title: string } | null;
  /** The codes printed on a statement of results, titled. */
  unitStandards: UnitStandardRow[];
}

/** Only what these rules read. Deliberately not the whole Credential row. */
export interface FacetRow {
  kind: string;
  coversKinds: readonly string[];
  /** The category AFTER list()'s backfill, not the stored column. */
  firearmCategory: string | null;
  /** The action AFTER list()'s backfill, not the stored column. */
  firearmSelfLoading: boolean | null;
  expiresOn: Date | null;
  dateSource: string | null;
  details: Record<string, string>;
}

/**
 * The text that says which firearms a document is about.
 *
 * ⚠️ TWO KEYS, BECAUSE THE EXTRACTOR WRITES TWO. A SAPS 524 competency puts
 * its endorsement line in `covers`; a statement of results puts its codes in
 * `unit_standard` (document-fields.ts WANTED). motivation-documents.service
 * already reads them with exactly this fallback — the same document must not
 * resolve differently on two screens.
 */
export function coversText(details: Record<string, string>): string {
  return (details.covers ?? details.unit_standard ?? '').trim();
}

function asCategory(value: string | null): CompetencyCategory | null {
  return CATEGORY_ORDER.includes(value as CompetencyCategory)
    ? (value as CompetencyCategory)
    : null;
}

/**
 * Is this row a firearm licence, or a document that carries one?
 *
 * The same predicate list() uses to build the derivation's licence set — a
 * page listing several firearms is filed under one kind and covers another.
 */
function isLicence(row: FacetRow): boolean {
  return (
    row.kind === 'FIREARM_LICENCE' || row.coversKinds.includes('FIREARM_LICENCE')
  );
}

/** In CATEGORY_ORDER, deduplicated. */
function ordered(found: ReadonlySet<CompetencyCategory>): CompetencyCategory[] {
  return CATEGORY_ORDER.filter((c) => found.has(c));
}

/**
 * The codes on a statement of results, with the titles the table knows.
 *
 * ⚠️ AN UNRECOGNISED CODE KEEPS ITS OWN NUMBER AS ITS TITLE, and is never
 * dropped. parseUnitStandards admits a code we do not carry only when a unit
 * standard TITLE follows it on the page, so it is a real SAQA unit we have not
 * met — a dealer, instructor or security-officer standard. Hiding it would
 * tell a member their certificate proves less than it does.
 */
export function unitStandardsOf(
  details: Record<string, string>,
): UnitStandardRow[] {
  return parseUnitStandards(coversText(details)).map((code) => ({
    code,
    title: unitStandardSpec(code)?.title ?? code,
  }));
}

/**
 * Everything one row says about a firearm.
 *
 * @param licences The member's settled licences, as list() builds them.
 */
export function firearmFacets(
  row: FacetRow,
  licences: readonly DatedLicence[] = [],
): FirearmFacets {
  const covers = coversOf(row);
  return {
    category: categoryOf(row),
    /**
     * ⚠️ LICENCES ONLY, AND NEVER INFERRED FROM A COMPETENCY. A certificate is
     * endorsed per action for rifles (119651 manual, 119650 self-loading) and
     * can carry both at once, so there is no single answer to give — and a
     * competency does not describe a firearm the member owns anyway.
     */
    selfLoading: row.kind === 'FIREARM_LICENCE' ? row.firearmSelfLoading : null,
    covers,
    follows: followsOf(row, covers, licences),
    unitStandards:
      row.kind === 'PROFICIENCY' ? unitStandardsOf(row.details) : [],
  };
}

function categoryOf(row: FacetRow): CompetencyCategory | null {
  if (isLicence(row)) return asCategory(row.firearmCategory);

  if (row.kind === 'PROFICIENCY') {
    /**
     * A statement of results names its firearm in its unit standard codes and
     * nowhere else — there is no type row to read.
     *
     * ⚠️ 117705 IS NOT A FIREARM. The knowledge-of-the-Act unit is on every
     * statement and endorses nothing, so a page carrying only it belongs under
     * no firearm at all. It has no `endorsement` in UNIT_STANDARDS, which is
     * what makes it fall out here rather than needing a special case.
     *
     * ⚠️ AND TWO FIREARM UNITS ON ONE PAGE GIVE NULL, NOT A GUESS. A member
     * who did handgun and shotgun on one course has a statement belonging to
     * both groups; the row carries one category, so there is no honest answer,
     * and filing it under the first would put it under the wrong firearm half
     * the time. Same rule as categoryFromText: null rather than a guess.
     */
    const found = new Set<CompetencyCategory>();
    for (const code of parseUnitStandards(coversText(row.details))) {
      const endorsement = unitStandardSpec(code)?.endorsement;
      const category = endorsement
        ? endorsementSpec(endorsement)?.category
        : undefined;
      if (category) found.add(category);
    }
    const only = ordered(found);
    return only.length === 1 ? only[0] : null;
  }

  return null;
}

function coversOf(row: FacetRow): CompetencyCategory[] {
  if (row.kind !== 'COMPETENCY_CERTIFICATE') return [];
  const found = new Set<CompetencyCategory>();
  for (const endorsement of parseEndorsements(coversText(row.details))) {
    const category = endorsementSpec(endorsement)?.category;
    if (category) found.add(category);
  }
  return ordered(found);
}

/**
 * Which licence this competency's date follows.
 *
 * Operator, 2026-09-07: "state which licence will cause the competency to
 * expire." deriveCertificateExpiry already says it in prose; this is the same
 * answer as a pointer, so the page can draw the line between the two rows
 * instead of asking the member to match two dates by eye.
 *
 * ⚠️ ONLY FOR A DATE WE DERIVED. `dateSource === 'derived'` is the record that
 * WE put the date there off a licence. A date the member typed, or one we read
 * off a card, follows nothing — naming a licence beside it would be a false
 * account of where the date came from, on the one screen they would check
 * first if a reminder were ever wrong.
 *
 * ⚠️ MATCHED ON THE DATE, NOT RE-DERIVED. Re-running the derivation here would
 * be a second implementation of s10(2) that can disagree with the one that
 * wrote the date — and the disagreement would be invisible, because both
 * render a date. Matching what is stored can only ever name a licence that
 * really does end on that day, or name nothing.
 *
 * ⚠️ NEVER A MUZZLE LOADER. It takes no licence at all (s3(2)) and runs its
 * own ten-year clock under s10(3), so a muzzle-loader row can never be the
 * licence a certificate follows.
 */
function followsOf(
  row: FacetRow,
  covers: readonly CompetencyCategory[],
  licences: readonly DatedLicence[],
): { id: string; title: string } | null {
  if (row.kind !== 'COMPETENCY_CERTIFICATE') return null;
  if (row.dateSource !== 'derived' || !row.expiresOn) return null;

  const on = row.expiresOn.getTime();
  const covered = new Set(covers);
  const matches = licences.filter(
    (l) =>
      !!l.id &&
      !!l.expiresOn &&
      l.expiresOn.getTime() === on &&
      l.category !== 'muzzle-loader' &&
      covered.has(l.category),
  );
  if (!matches.length) return null;

  /**
   * ⚠️ EVERY MATCH SHARES THE DATE BY CONSTRUCTION, so "the latest one" is
   * already settled by the equality above and the only thing left to decide is
   * which of several licences ending on the same day to name. The one filed
   * first: it is the one the derivation has been following longest, and it is
   * stable across loads, where "whichever the database returned first" is not.
   */
  const best = matches.reduce((a, b) =>
    (b.createdAt?.getTime() ?? 0) < (a.createdAt?.getTime() ?? 0) ? b : a,
  );
  return { id: best.id as string, title: best.title ?? '' };
}
