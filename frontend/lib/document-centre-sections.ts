import {
  DocSection,
  DocSectionId,
  SAFE_PHOTO_KINDS,
  SECTIONS,
} from '@/components/document-centre/kinds';
import { needsDateCheck } from './document-review-rules';
import { sectionCaption } from './licence-labels';
import {
  CredentialRow,
  CredentialUsage,
  FirearmCategory,
  KIND_LABELS,
  formatDate,
} from './licence-centre-api';

// ────────────────────────────────────────────────────────────────────
// WHERE EVERY DOCUMENT GOES, AND IN WHAT ORDER.
//
// The vault sorts by what a FORM calls a document. A member thinks about
// their firearms, and about the chain of paper behind each one. This module
// is the whole of that re-arrangement, and it is pure on purpose: it takes
// rows and returns rows, touches no DOM, and is therefore the one part of the
// restructure that can be pinned by a test.
//
// ⚠️ THE RULE THIS FILE EXISTS TO KEEP: EVERY ROW APPEARS EXACTLY ONCE.
// The old flat list could not get this wrong — one heading per kind, one row
// per row. Grouping can, in four separate ways, and three of them are silent:
//
//   • a competency covering two categories, printed under both, is one page
//     showing as two documents;
//   • a proficiency's certificate and its statement of results are two server
//     rows and ONE document to the member;
//   • a duplicate upload is a row the member did not mean to make;
//   • a kind in no section at all simply vanishes — which is why placeRow
//     falls through to "Anything else" rather than dropping.
//
// The first three fold; the fourth cannot happen. All four are tested.
// ────────────────────────────────────────────────────────────────────

/** The four categories in the order the sections read them. */
export const CATEGORY_ORDER: readonly FirearmCategory[] = [
  'handgun',
  'rifle-carbine',
  'shotgun',
  'muzzle-loader',
];

export const CATEGORY_LABEL: Record<FirearmCategory, string> = {
  handgun: 'Handgun',
  'rifle-carbine': 'Rifle and carbine',
  shotgun: 'Shotgun',
  'muzzle-loader': 'Muzzle loader',
};

/**
 * The two group keys that are not a firearm category.
 *
 * `act` is unit standard 117705, which names no firearm — it is the knowledge
 * paper everybody sits, and filing it under whichever category happened to be
 * on the same page would be an invention. `unknown` is "the reading did not
 * say", which is not a category either and must never be printed as one.
 */
const ACT_UNIT_STANDARD = '117705';
const GROUP_LABEL: Record<string, string> = {
  ...CATEGORY_LABEL,
  act: 'Knowledge of the Act',
  unknown: 'Category not read',
};

/** Group order: the four categories, then the Act, then whatever we could not read. */
const GROUP_ORDER = [...CATEGORY_ORDER, 'act', 'unknown'];

// ── pages of one document ───────────────────────────────────────────
//
// Lifted out of app/licence-centre/page.tsx unchanged. It decided which half
// of a two-sided document stands for both in the list, and it could not be
// tested where it was.

/** Which page of a proficiency a row is, as the reader recorded it. */
export function pageSide(r: CredentialRow): 'front' | 'back' | null {
  const s = (r.details?.document_side ?? '').toLowerCase();
  return s === 'front' || s === 'back' ? s : null;
}

/** What the member calls the page: the statement of results, or the certificate. */
export function pageLabel(r: CredentialRow): string {
  const s = pageSide(r);
  return s === 'back'
    ? 'Statement of results'
    : s === 'front'
      ? 'Certificate'
      : r.title;
}

/** Of a pair, the row that stands for both in the list: the statement, else the older. */
export function leadsPair(r: CredentialRow, other: CredentialRow): boolean {
  const s = pageSide(r);
  const t = pageSide(other);
  if (s === 'back') return true;
  if (s === 'front') return false;
  if (t === 'back') return false;
  if (t === 'front') return true;
  return (
    r.createdAt < other.createdAt ||
    (r.createdAt === other.createdAt && r.id < other.id)
  );
}

// ── what a row is called ────────────────────────────────────────────

/**
 * A licensed firearm, named the way its owner names it.
 *
 * ⚠️ THE MEMBER'S OWN TITLE WINS, ALWAYS. Five rows all reading "Firearm
 * licence" is the thing this section exists to stop, and a member who has
 * renamed one to "Dad's .303" must not have that overwritten by a make we
 * read off the card.
 */
export function firearmName(row: CredentialRow): string {
  const own = row.title?.trim();
  if (own) return own;
  const made = [row.details.make, row.details.model]
    .map((v) => v?.trim())
    .filter((v): v is string => !!v)
    .join(' ');
  const calibre = row.details.calibre?.trim();
  if (made && calibre) return `${made} · ${calibre}`;
  return made || calibre || KIND_LABELS[row.kind] || row.kind;
}

/**
 * A training certificate, named by the unit standards it carries.
 *
 * "119649 · Handle and use a handgun" is what is printed on the paper and what
 * a DFO asks for by number. The title is the fallback, not the lead.
 */
export function trainingName(row: CredentialRow): string {
  const us = row.unitStandards ?? [];
  if (us.length > 0) {
    return us.map((u) => `${u.code} · ${u.title}`).join(' · ');
  }
  return row.title?.trim() || KIND_LABELS[row.kind] || row.kind;
}

/** Whatever this row should be called in its section. */
export function rowName(row: CredentialRow, section: DocSectionId): string {
  if (section === 'firearms') return firearmName(row);
  if (section === 'training') return trainingName(row);
  return row.title?.trim() || KIND_LABELS[row.kind] || row.kind;
}

// ── the sub-lines ───────────────────────────────────────────────────

/**
 * Ninety days before the expiry — the section 24(1) deadline for lodging a
 * renewal, which is the date that actually matters to somebody holding a
 * licence that runs out next year.
 *
 * ⚠️ UTC ARITHMETIC ON A DATE-ONLY STRING. `new Date('2027-01-04')` is
 * midnight UTC; adding a local-time offset here would slide the answer a day
 * either way depending on where the member is sitting.
 */
export function renewByIso(expiresOn: string | null): string | null {
  if (!expiresOn) return null;
  const d = new Date(`${expiresOn}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - 90);
  return d.toISOString().slice(0, 10);
}

/** The pieces under a firearm's name, in order. Joined with ' · ' by the row. */
export function firearmSubline(row: CredentialRow): string[] {
  const out: string[] = [];
  const cap = sectionCaption(row.details.section);
  if (cap) out.push(cap);
  if (row.selfLoading) out.push('self-loading');
  if (row.renewalDue) {
    const by = renewByIso(row.expiresOn);
    if (by) out.push(`renew by ${formatDate(by)}, lodge SAPS 517(g) with it`);
  }
  return out;
}

/**
 * The pieces under a competency certificate's name.
 *
 * ⚠️ "also shotgun" IS HOW A CERTIFICATE COVERING TWO CATEGORIES STAYS ONE
 * ROW. It is filed under the first category it covers and says the rest here;
 * printing it under both headings would show one page as two documents, and a
 * member counting their certificates would count wrong.
 */
export function competencySubline(row: CredentialRow): string[] {
  const out: string[] = [];
  if (row.follows) out.push(`Follows your ${row.follows.title} licence`);
  const extra = (row.covers ?? []).slice(1);
  if (extra.length > 0) {
    out.push(
      `also ${extra.map((c) => CATEGORY_LABEL[c].toLowerCase()).join(' and ')}`,
    );
  }
  if (row.dateSource === 'derived') out.push('worked out for you');
  return out;
}

// ── the attention chips ─────────────────────────────────────────────

export type ChipId = 'renewals' | 'dates' | 'motivations' | 'duplicates';

export interface ChipCounts {
  renewals: number;
  dates: number;
  motivations: number;
  /**
   * Extra files the server flagged as copies of an earlier row.
   *
   * ⚠️ THIS ONE COUNTS ROWS, WHERE THE OTHERS COUNT DOCUMENTS. A copy is not
   * a document of its own — it folds under the original — so the honest thing
   * to say is "you have two extra files to clear", not "two documents".
   */
  duplicates: number;
}

export type UsageMap = Record<string, CredentialUsage[]>;

function isRenewal(r: CredentialRow): boolean {
  return r.state === 'expiring' || r.state === 'expired';
}

/**
 * Is this row an extra file the server flagged as a copy of an earlier one?
 *
 * ⚠️ THE FLAG, NOT THE HASH. Two photographs of one card are two different
 * files, so `sha256` cannot see them; the server compares what the documents
 * SAY (see credential-duplicates.ts) and stamps `duplicateOfId`. `duplicateOf`
 * is that id resolved to a title at read time, and it may be null while the
 * original still exists — but for "is this a copy" the id alone is enough.
 */
export function isCopyWith(r: CredentialRow): boolean {
  return !!r.duplicateOf?.id && r.duplicateOf.id !== r.id;
}

/** The originals that have at least one copy among these rows. */
function copyParents(rows: readonly CredentialRow[]): Set<string> {
  const parents = new Set<string>();
  for (const r of rows) {
    if (isCopyWith(r)) parents.add(r.duplicateOf!.id);
  }
  return parents;
}

/**
 * One document, with every page the vault holds of it.
 *
 * ⚠️ EVERY NUMBER ON THIS PAGE COUNTS THESE, NEVER ROWS. A training
 * certificate and its statement of results are two rows and one document;
 * the list already folded them into one line, and the header above it still
 * said "8 certificates" over four lines because the sentence was built from
 * the rows. Operator, 2026-09-07: "once they are combined they should be seen
 * as 1 document." So the fold happens here, once, and the chips, the summary,
 * the count and the total all read off the same result. A page whose partner
 * is not in the list (filtered out, or never uploaded) stands as a document
 * of its own — otherwise it would vanish with its partner.
 */
export interface Document {
  /** The row that stands for it in the list. */
  lead: CredentialRow;
  /** Every row of it, the lead included. */
  pages: CredentialRow[];
}

export function documentsOf(rows: readonly CredentialRow[]): Document[] {
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  const out: Document[] = [];
  for (const r of rows) {
    const partner = r.otherSide ? byId.get(r.otherSide.id) : undefined;
    if (partner && !leadsPair(r, partner)) continue;
    out.push({ lead: r, pages: partner ? [r, partner] : [r] });
  }
  return out;
}

/** A document is due, or unchecked, when any page of it is. */
function docNeeds(d: Document, test: (r: CredentialRow) => boolean): boolean {
  return d.pages.some(test);
}

export function chipCounts(
  rows: readonly CredentialRow[],
  usage: UsageMap,
): ChipCounts {
  const docs = documentsOf(rows);
  return {
    renewals: docs.filter((d) => docNeeds(d, isRenewal)).length,
    dates: docs.filter((d) => docNeeds(d, needsDateCheck)).length,
    motivations: docs.filter((d) =>
      docNeeds(d, (r) => (usage[r.id]?.length ?? 0) > 0),
    ).length,
    // ⚠️ ROWS, NOT DOCUMENTS. Every other count here folds the pages of one
    // document together; this one is the number of stray FILES, which is what
    // the member has to act on. Counting documents would always read 0.
    duplicates: (rows ?? []).filter(isCopyWith).length,
  };
}

/**
 * ⚠️ SEVERAL CHIPS ARE A UNION, NOT AN INTERSECTION. Tapping "3 renewals due"
 * and "2 dates to check" asks to see five documents, not the empty
 * intersection of the two — the chips are the counts made tappable, and a
 * count that shows nothing when you add a second one to it reads as broken.
 */
export function rowMatchesChips(
  row: CredentialRow,
  chips: readonly ChipId[],
  usage: UsageMap,
): boolean {
  if (chips.length === 0) return true;
  return chips.some((c) =>
    c === 'renewals'
      ? isRenewal(row)
      : c === 'dates'
        ? needsDateCheck(row)
        : c === 'duplicates'
          ? isCopyWith(row)
          : (usage[row.id]?.length ?? 0) > 0,
  );
}

/**
 * Does the search box find this row?
 *
 * ⚠️ THE DETAIL VALUES ARE IN THE HAYSTACK, and that is the point of the
 * change: a member looks for ".308" or for the last four digits of a licence
 * number, and neither is in the title or the type. The values never leave the
 * browser — they are already on the row this list is rendering.
 */
export function matchesQuery(row: CredentialRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    row.title,
    KIND_LABELS[row.kind] ?? row.kind,
    ...Object.values(row.details ?? {}),
    ...(row.unitStandards ?? []).flatMap((u) => [u.code, u.title]),
  ];
  return hay.some((v) => (v ?? '').toLowerCase().includes(q));
}

// ── the sections themselves ─────────────────────────────────────────

/** A row, with any copies of it that folded underneath. */
export interface RowNode {
  row: CredentialRow;
  /** Later uploads the server flagged as copies of this one. */
  copies: CredentialRow[];
}

export interface GroupView {
  key: string;
  /** Null in an ungrouped section — there is one group and it has no heading. */
  label: string | null;
  rows: RowNode[];
}

export interface SectionView {
  section: DocSection;
  groups: GroupView[];
  /**
   * Photographs of the safe, drawn as a grid rather than as rows.
   * Empty for every section but 'safe'.
   */
  photos: RowNode[];
  /** Documents showing, after the chips and the search box. Pages fold. */
  count: number;
  /** Documents the section holds, before either. Pages fold. */
  total: number;
  /** It holds something, and the filters matched none of it. */
  emptied: boolean;
  /** The one line the header shows while the section is shut. */
  summary: string;
  /**
   * Rows in here that any attention chip would light up — a renewal, a date
   * nobody has checked, a document already inside a motivation. Counted over
   * everything the section HOLDS, not over what the filters left, so it does
   * not change as the member taps chips.
   */
  attention: number;
}

/** Which section a row belongs to. Falls through, never drops. */
export function placeRow(row: CredentialRow): DocSectionId {
  // ⚠️ coversKinds FIRST, and only for the firearms section. One page can be
  // a licence and something else at the same time, and the licence half is
  // what a member goes looking for it under.
  if (
    row.kind === 'FIREARM_LICENCE' ||
    (row.coversKinds ?? []).includes('FIREARM_LICENCE')
  ) {
    return 'firearms';
  }
  const hit = SECTIONS.find((s) => s.kinds.includes(row.kind));
  return hit ? hit.id : 'other';
}

function groupKey(row: CredentialRow, section: DocSection): string {
  if (section.grouping === 'covers') {
    return (row.covers ?? [])[0] ?? row.category ?? 'unknown';
  }
  if (section.grouping === 'training') {
    const codes = (row.unitStandards ?? []).map((u) => u.code);
    if (codes.length > 0 && codes.every((c) => c === ACT_UNIT_STANDARD)) {
      return 'act';
    }
  }
  return row.category ?? 'unknown';
}

/**
 * Soonest first, then the ones nobody has dated, then the ones that never
 * expire.
 *
 * ⚠️ THAT ORDER, AND NOT "UNDATED LAST". A licence with no expiry on it is
 * not settled — it is the one thing on the page nothing can remind on — so it
 * sits above the documents that are settled precisely because they have no
 * date to run out.
 */
function expiryRank(r: CredentialRow): number {
  if (r.neverExpires || r.state === 'no-expiry') return 2;
  return r.expiresOn ? 0 : 1;
}

function byExpiry(a: CredentialRow, b: CredentialRow): number {
  const ra = expiryRank(a);
  const rb = expiryRank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) {
    const c = (a.expiresOn ?? '').localeCompare(b.expiresOn ?? '');
    if (c !== 0) return c;
  }
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function plural(n: number, noun: [string, string]): string {
  return `${n} ${n === 1 ? noun[0] : noun[1]}`;
}

function summaryFor(
  section: DocSection,
  docs: readonly Document[],
  emptied: boolean,
): string {
  if (emptied) return 'None of these here';
  if (docs.length === 0) return section.emptyLine;
  const parts = [plural(docs.length, section.noun)];
  const due = docs.filter((d) => docNeeds(d, isRenewal)).length;
  if (due > 0) parts.push(due === 1 ? '1 renewal due' : `${due} renewals due`);
  const dates = docs.filter((d) => docNeeds(d, needsDateCheck)).length;
  if (dates > 0) {
    parts.push(dates === 1 ? '1 date to check' : `${dates} dates to check`);
  }
  return parts.join(' · ');
}

export interface BuildOptions {
  rows: readonly CredentialRow[];
  usage?: UsageMap;
  chips?: readonly ChipId[];
  query?: string;
}

/**
 * The whole list, in one pass: place, filter, fold, group, sort, summarise.
 *
 * Returns EVERY section, including the empty ones — an empty section is not
 * nothing to show, it is the line telling a member what belongs in it and the
 * link for putting one there.
 */
export function buildSections({
  rows,
  usage = {},
  chips = [],
  query = '',
}: BuildOptions): SectionView[] {
  const all = rows ?? [];

  const placed = new Map<DocSectionId, CredentialRow[]>(
    SECTIONS.map((s) => [s.id, [] as CredentialRow[]]),
  );
  for (const r of all) placed.get(placeRow(r))?.push(r);

  const filtering = chips.length > 0 || query.trim().length > 0;

  return SECTIONS.map((section) => {
    const held = placed.get(section.id) ?? [];

    /**
     * ⚠️ A COPY IS NEVER A ROW, SO THE 'duplicates' CHIP HAS TO REACH ITS
     * ORIGINAL. The filter below keeps a row that matches a chip; an original
     * is not a copy, so selecting "Duplicates" would keep nothing and the
     * copies would have nothing to fold under — the member taps the count and
     * the list empties. When 'duplicates' is on, an original is kept for the
     * copy's sake, which is the row the copy actually renders beneath.
     */
    const parents = chips.includes('duplicates')
      ? copyParents(held.filter((r) => matchesQuery(r, query)))
      : null;
    const kept = held.filter(
      (r) =>
        (rowMatchesChips(r, chips, usage) || !!parents?.has(r.id)) &&
        matchesQuery(r, query),
    );

    // ── one document, not two pages ──────────────────────────────
    const docs = documentsOf(kept);
    const unpaired = docs.map((d) => d.lead);

    // ── a copy folds under its original ──────────────────────────
    //
    // Only when the original survived the filters. A copy whose original is
    // not on screen has to stand as its own row, or it disappears with it.
    const surviving = new Set(unpaired.map((r) => r.id));
    const nodes = new Map<string, RowNode>();
    const folded: CredentialRow[] = [];
    for (const r of unpaired) {
      const orig = r.duplicateOf?.id;
      if (orig && orig !== r.id && surviving.has(orig)) {
        folded.push(r);
      } else {
        nodes.set(r.id, { row: r, copies: [] });
      }
    }
    for (const c of folded) {
      const parent = c.duplicateOf ? nodes.get(c.duplicateOf.id) : undefined;
      if (parent) parent.copies.push(c);
      // A copy whose original folded into something else keeps its own row.
      else nodes.set(c.id, { row: c, copies: [] });
    }

    let standing = [...nodes.values()];

    // ── the safe is a grid and one row, not five rows ────────────
    const photos =
      section.id === 'safe'
        ? standing.filter((n) => SAFE_PHOTO_KINDS.includes(n.row.kind))
        : [];
    if (photos.length > 0) {
      const shown = new Set(photos.map((n) => n.row.id));
      standing = standing.filter((n) => !shown.has(n.row.id));
    }

    const groups: GroupView[] = [];
    if (section.grouping === null) {
      standing.sort((a, b) => byExpiry(a.row, b.row));
      if (standing.length > 0) {
        groups.push({ key: 'all', label: null, rows: standing });
      }
    } else {
      const buckets = new Map<string, RowNode[]>();
      for (const n of standing) {
        const k = groupKey(n.row, section);
        const list = buckets.get(k);
        if (list) list.push(n);
        else buckets.set(k, [n]);
      }
      const keys = [...buckets.keys()].sort((a, b) => {
        const ia = GROUP_ORDER.indexOf(a);
        const ib = GROUP_ORDER.indexOf(b);
        return (
          (ia === -1 ? GROUP_ORDER.length : ia) -
          (ib === -1 ? GROUP_ORDER.length : ib)
        );
      });
      for (const k of keys) {
        const list = (buckets.get(k) ?? []).sort((a, b) =>
          byExpiry(a.row, b.row),
        );
        groups.push({ key: k, label: GROUP_LABEL[k] ?? k, rows: list });
      }
    }

    const count = standing.length + photos.length;
    const emptied = filtering && held.length > 0 && count === 0;
    const heldDocs = documentsOf(held);
    return {
      section,
      groups,
      photos: photos.sort((a, b) => byExpiry(a.row, b.row)),
      count,
      total: heldDocs.length,
      emptied,
      summary: summaryFor(section, docs, emptied),
      // ⚠️ 'duplicates' IS IN THE LIST. A copy folds under its original, so a
      // section holding nothing but a stray extra file would otherwise open
      // for nobody, and the one screen that offers to clear it would stay shut
      // behind a chip the member had to notice first.
      attention: heldDocs.filter((d) =>
        docNeeds(d, (r) =>
          rowMatchesChips(
            r,
            ['renewals', 'dates', 'motivations', 'duplicates'],
            usage,
          ),
        ),
      ).length,
    };
  });
}

/**
 * Which sections start open.
 *
 * ⚠️ IT IS NOT "ALL OF THEM" AND IT IS NOT "THE FIRST ONE". Your firearms and
 * Competency are what a member came for, so they open; everything else opens
 * only when it holds something a chip is pointing at, because a section that
 * opens for no reason is one more screen of scrolling between the member and
 * the licence that is running out.
 */
export function defaultOpenSections(
  views: readonly SectionView[],
): DocSectionId[] {
  const open = new Set<DocSectionId>(['firearms', 'competency']);
  for (const v of views) if (v.attention > 0) open.add(v.section.id);
  return SECTIONS.map((s) => s.id).filter((id) => open.has(id));
}
