import type { StructurePlan } from './motivation-structure';
import {
  BODY_BOTTOM,
  BODY_TOP,
  BODY_SIZE,
  BODY_LEADING,
  CONTENT_W,
  SECTION_INDENT,
} from './motivation-pdf-chrome';

// ────────────────────────────────────────────────────────────────────
// KEEPING THE BODY PAGES FULL.
//
// Operator, 2026-10-15: "sometimes it writes just one sentence on a page and
// the rest is empty, how can we mitigate that?"
//
// ⚠️ THE CAUSE IS A SECTION THAT IS DELIBERATELY EMPTY, NOT A LAYOUT BUG. The
// writer is given a TOTAL word band and a per-section PARAGRAPH budget, never a
// per-section LENGTH, so it can hit the total with one fat section and several
// one-line ones. A one-line section then sits near the foot of a page and the
// next element — a feature, the declaration, an annexure — forces a break, and
// the page prints almost nothing.
//
// ⚠️ THIS MEASURES, IT DOES NOT PAD. Rule 7 forbids padding and the house rule
// is explicit: "a shorter document built only from the applicant's facts beats
// a longer one padded to the band." A note from here goes onto a retry the
// mechanical checks already triggered, and it names the section and the floor —
// it is the writer's job to meet it with the specifics the brief already asks
// for (the threats, the route, each discipline, the comparison), not with
// filler. Nothing here ever fails a run on its own.
//
// GEOMETRY mirrors the body draw in motivation-pdf.service.ts (BODY_SIZE,
// BODY_LEADING, the indented column, BODY_TOP..BODY_BOTTOM). It is an ESTIMATE
// of the printed fill — the answer to "roughly how much of a page is a section"
// — not a measurement of the rendered PDF. It moves if the layout moves.
// ────────────────────────────────────────────────────────────────────

// Average glyph width and word length for this corpus (South African English,
// prose). Coarse on purpose: the number only has to be right enough to tell a
// paragraph from a sentence.
const AVG_GLYPH_EM = 0.5;
const AVG_WORD_CHARS = 6;

/** The indented body column, in points. */
export const BODY_COLUMN_PT = CONTENT_W - SECTION_INDENT;
/** One body line's advance, in points. */
export const LINE_ADVANCE_PT = BODY_SIZE * 1.15 + BODY_LEADING;
/** Body lines that fit between the banner and the footer. */
export const LINES_PER_PAGE = Math.max(
  1,
  Math.floor((BODY_BOTTOM - BODY_TOP) / LINE_ADVANCE_PT),
);
/** Words on one full body line. */
export const WORDS_PER_LINE = Math.max(
  1,
  Math.floor(BODY_COLUMN_PT / (BODY_SIZE * AVG_GLYPH_EM) / AVG_WORD_CHARS),
);
/** Words in a full page of unbroken body prose. */
export const WORDS_PER_PAGE = LINES_PER_PAGE * WORDS_PER_LINE;

/**
 * The fill the operator asked for, as fractions of a body page.
 *
 * ⚠️ APPLIED PER PAGE, NOT PER SECTION. Every section at 40 % of a page would
 * be 12 × ~215 words — well over the total band, i.e. padding by arithmetic.
 * The page is what must not look empty; the section floor below is the smaller
 * number that keeps two sections from leaving a page half blank.
 */
export const PAGE_FILL_TARGET = 0.5;
export const PAGE_FILL_FLOOR = 0.4;

/**
 * The per-section floor, as a fraction of a page.
 *
 * ~18 % keeps a section to a real passage (two to four sentences) without
 * forcing the total band up; below this a section reads as a stub and is the
 * thing that leaves a page empty. See PAGE_FILL_* for why this is not 0.4.
 */
const SECTION_FILL = 0.18;
const DEFAULT_FLOOR = Math.round(WORDS_PER_PAGE * SECTION_FILL);

/**
 * Sections that are SHORT BY DESIGN — one brief paragraph, or a table's caption
 * — and must not be floored to a passage. Getting this list wrong in either
 * direction is safe: too short and a thin section slips through, too long and a
 * section is floored it cannot fill, which the retry reports and never fails.
 */
const SHORT_BY_DESIGN = new Set<string>([
  'introduction',
  'held_firearms',
  'experience',
  'association',
  'storage_safety',
  'compliance_history',
  'conclusion',
]);
const SHORT_FLOOR = Math.max(40, Math.round(DEFAULT_FLOOR * 0.45));

/** The minimum words a section should carry, by its id. */
export function sectionFloor(sectionId: string): number {
  return SHORT_BY_DESIGN.has(sectionId) ? SHORT_FLOOR : DEFAULT_FLOOR;
}

function wordCount(line: string): number {
  return line.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Words under each heading, in plan order.
 *
 * ⚠️ HEADINGS ARE MATCHED EXACTLY as they are printed (Part 7.1), the same way
 * followsPlan matches them. A heading the writer did not emit is simply absent
 * — a missing section is a structural fault `followsPlan` already reports, and
 * it is not this module's to raise.
 */
export function sectionWordCounts(
  text: string,
  headings: readonly string[],
): { heading: string; words: number }[] {
  const key = (s: string) => s.trim().toLowerCase();
  const known = new Map(headings.map((h) => [key(h), h]));
  const counts = new Map<string, number>();
  let current: string | null = null;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const heading = known.get(key(line));
    if (heading) {
      current = heading;
      if (!counts.has(heading)) counts.set(heading, 0);
      continue;
    }
    if (current) counts.set(current, (counts.get(current) ?? 0) + wordCount(line));
  }

  return headings
    .filter((h) => counts.has(h))
    .map((h) => ({ heading: h, words: counts.get(h) ?? 0 }));
}

/**
 * The retry notes for sections under their floor.
 *
 * Appended to the advisory feedback of a retry the mechanical checks already
 * triggered — never fatal, never a reason to knock a document back on its own.
 */
export function thinSectionNotes(
  text: string,
  plan: StructurePlan,
  _licenceType: string,
): string[] {
  const headings = plan.sections.map((s) => s.heading);
  const floorByHeading = new Map(
    plan.sections.map((s) => [s.heading.trim().toLowerCase(), sectionFloor(s.id)]),
  );
  const out: string[] = [];
  for (const { heading, words } of sectionWordCounts(text, headings)) {
    const floor = floorByHeading.get(heading.trim().toLowerCase()) ?? DEFAULT_FLOOR;
    if (words < floor) {
      out.push(
        `the section "${heading}" ran only ${words} words; the brief asks for at least ${floor} — go back over that section and write in the specific detail it names (not padding, and introduce no fact the pack does not carry)`,
      );
    }
  }
  return out;
}

/** Roughly what fraction of a body page a section's words fill. */
export function estimatedFill(words: number): number {
  return Math.max(0, words) / WORDS_PER_PAGE;
}
