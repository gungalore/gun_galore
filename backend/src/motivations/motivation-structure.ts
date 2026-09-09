import * as crypto from 'node:crypto';
import { MotivationLicenceType } from '@prisma/client';

// ────────────────────────────────────────────────────────────────────
// THE FIXED SKELETON — twelve numbered headings, the same ones every time.
//
// ⚠️ THIS FILE USED TO DO THE OPPOSITE, AND THE REVERSAL IS DELIBERATE.
// It randomised headings, openings and cadence from a stored seed, to stop a
// reviewer recognising our documents. MOTIVATION-GUIDE-BOOK failure mode 9
// records what that produced: "Randomising headings, openings and cadence to
// defeat template detection, which produced inline headings and a document
// that read as stitched together."
//
// The premise was wrong, not the implementation. A Designated Firearms Officer
// does not compare applicants' letters for plagiarism; they compare the facts
// in the letter to the annexures behind it. Consistent headings make that job
// faster, which is the only thing the layout is for — and the professionally
// prepared packs a DFO already knows all use the same spine, mirroring the
// SAPS 271's own sections. Varying ours made our documents harder to check and
// solved a problem nobody has reported.
//
// So the structure is still decided HERE, in code, and the model is still
// handed a plan and told to phrase it. What changed is that the plan is now a
// pure function of the licence type and of five facts about the applicant —
// no draws, no permutations. Variation lives where it always belonged: in the
// facts, which differ per applicant anyway.
//
// Book Part 4.2 (the fixed skeleton), Part 5 (which sections each section of
// the Act omits) and Part 7.1 (headings numbered, on their own line, no
// trailing colon, never varied in wording between documents).
//
// The second half of the file is the detector: fingerprint() reduces a
// document to its STRUCTURE with the content stripped out. ⚠️ It is a
// MEASUREMENT now, not a trigger — with the skeleton fixed, two documents of
// the same type are SUPPOSED to score alike, and regenerating on a high score
// would spend a second model call to arrive at the same plan. What it is still
// good for is noticing that two documents came out structurally identical,
// which would mean the facts stopped reaching the writer.
//
// PURE AND I/O-FREE on purpose: no Prisma, no Nest, no model client. It is the
// most heavily tested part of the module because it is the hardest to notice
// going wrong.
// ────────────────────────────────────────────────────────────────────

export type SectionId =
  | 'introduction'
  | 'personal_circumstances'
  // ── The purpose section — heading 3, four ids ──────────────────────
  //
  // ⚠️ FOUR IDS FOR ONE SLOT, ON PURPOSE. They all sit at number 3 and only
  // one of them is ever in a plan. They are separate ids rather than one
  // 'purpose' id because the HEADING differs in kind, not merely in wording —
  // "My hunting" and "Why a section 13 firearm will not provide sufficient
  // protection" are not alternates of each other — and because each carries a
  // different brief.
  //
  //  - `the_threat`          s13 and s14
  //  - `the_quarry`          s15 hunting, s16 dedicated hunter
  //  - `the_discipline`      s15 sport, s16 dedicated sports shooter
  //  - `use_since_licensing` s24, which argues continuity rather than need
  | 'the_threat'
  | 'the_quarry'
  | 'the_discipline'
  | 'use_since_licensing'
  /**
   * What the applicant already does about the risk, and where each measure
   * stops. Section 13 and 14 only.
   *
   * ⚠️ THIS IS THE SECOND LIMB OF THE SECTION 13 TEST IN ALL BUT NAME. A
   * Registrar deciding a self-defence application is answering one question —
   * is a firearm NECESSARY — and "necessary" means the alternatives fall
   * short. Book Part 5.1 brief 4: "a document that lists security measures
   * without saying where each one stops has asked for a firearm as a first
   * resort."
   */
  | 'existing_measures'
  | 'the_firearm'
  /**
   * The battery: the table of what is already licensed, then one sentence per
   * firearm on why it cannot do this job.
   *
   * ⚠️ CONDITIONAL ON HOLDING SOMETHING, NOT ON AN OVERLAP. It used to be
   * called `comparison` and appeared only where the applicant held a firearm
   * in the SAME CLASS as the one applied for. Book Part 5.1 brief 6 and Part
   * 6.5 make it the battery section: every held firearm gets a row and a
   * sentence, because the DFO reads the licence record against the request
   * whether or not two entries happen to be the same class. On a first
   * application it is omitted and the introduction says "No firearm is
   * currently licensed to me" instead.
   */
  | 'held_firearms'
  | 'experience'
  /**
   * Association membership and dedicated status.
   *
   * Mandatory for both section 16 routes (dedicated status is what the section
   * turns on), present on a section 15 only where the applicant is in fact a
   * member — and on a section 15 it names membership and NEVER dedicated
   * status, which is the wording the Act's definition still turns on.
   */
  | 'association'
  | 'storage_safety'
  /** The six SAPS 271 declaration items — present only if one is a Yes. */
  | 'compliance_history'
  /**
   * The ONLY section that quotes the Act. Approved motivations quote the
   * licence section verbatim and answer each quoted element with a fact; ours
   * once quoted a regulation and then listed certificates, the quote left
   * hanging with nothing applied beneath it. Quoting belongs HERE and nowhere
   * else; everywhere else is plain language.
   */
  | 'statutory_application'
  | 'conclusion';

/**
 * The heading NUMBER, fixed by the book and shared by the four purpose ids.
 *
 * ⚠️ THE NUMBERS DO NOT RE-SEQUENCE WHEN A SECTION IS OMITTED. A section 15
 * document runs 1, 3, 5, 6, 7, 8, 9, 11, 12 — the gaps are the point. The
 * spine mirrors the SAPS 271's own sections, so a DFO who reads these packs
 * regularly can see at a glance that heading 10 is absent because there is
 * nothing to declare, rather than counting to work out which section they are
 * looking at. Book Part 4.2 and Part 7.8.
 */
const SECTION_NUMBER: Record<SectionId, number> = {
  introduction: 1,
  personal_circumstances: 2,
  the_threat: 3,
  the_quarry: 3,
  the_discipline: 3,
  use_since_licensing: 3,
  existing_measures: 4,
  the_firearm: 5,
  held_firearms: 6,
  experience: 7,
  association: 8,
  storage_safety: 9,
  compliance_history: 10,
  statutory_application: 11,
  conclusion: 12,
};

/** The heading TITLE, word for word from book Part 4.2. */
const SECTION_TITLES: Record<SectionId, string> = {
  introduction: 'Introduction',
  personal_circumstances: 'My circumstances',
  the_threat: 'Why I need a firearm for self-defence',
  the_quarry: 'My hunting',
  the_discipline: 'My sport shooting',
  use_since_licensing: 'How I have used this firearm since it was licensed',
  existing_measures: 'What I already do and where it stops',
  the_firearm: 'The firearm applied for and why it suits the purpose',
  held_firearms: 'Firearms already licensed to me',
  experience: 'My competency and training',
  association: 'Association membership and dedicated status',
  storage_safety: 'Safe storage and transport',
  compliance_history: 'My record',
  statutory_application: 'Section applied to my application',
  conclusion: 'Declaration and request',
};

/**
 * Per-type heading overrides. Two sections earn one, and only two.
 *
 *  - `statutory_application` has to name the section it is quoting. A reviewer
 *    reads the contents page before the body, and "section 16" standing over a
 *    self-defence application is worse than no heading at all. The bare
 *    fallback above is never printed; every type sets it.
 *  - `association` on a section 15 says MEMBERSHIP and stops there. Book Part
 *    5.3 brief 8: "Nothing about dedicated status." The section 1 definition of
 *    an occasional hunter still excludes association members — the 2006
 *    amendment that would have removed those words never commenced — so a
 *    section 15 document that claims dedicated status argues itself out of the
 *    section it is applying under.
 *
 * The purpose heading needs no override: it is carried by which of the four
 * purpose ids the skeleton uses.
 */
const TYPE_TITLES: Record<
  MotivationLicenceType,
  Partial<Record<SectionId, string>>
> = {
  S13_SELF_DEFENCE: {
    statutory_application: 'Section 13 applied to my application',
  },
  S14_RESTRICTED_SELF_DEFENCE: {
    // Book Part 5.2 brief 3: this heading replaces the section 13 purpose
    // heading and carries both limbs of s14(4).
    the_threat: 'Why a section 13 firearm will not provide sufficient protection',
    statutory_application: 'Section 14 applied to my application',
  },
  S15_OCCASIONAL_HUNTER: {
    association: 'Association membership',
    statutory_application: 'Section 15 applied to my application',
  },
  S16_DEDICATED_HUNTER: {
    statutory_application: 'Section 16 applied to my application',
  },
  S16_DEDICATED_SPORT: {
    statutory_application: 'Section 16 applied to my application',
  },
  S24_RENEWAL: {
    statutory_application: 'Section 24 applied to my application',
  },
};

/**
 * The heading as it is printed and as the writer is told to write it.
 *
 * ⚠️ NUMBERED, AND NO TRAILING COLON. Book Part 7.1. The colon was how the PDF
 * renderer told a heading from a paragraph; the number does that job better,
 * because a paragraph can end in a colon and none of them starts with "7. ".
 */
export function headingFor(
  licenceType: MotivationLicenceType,
  id: SectionId,
): string {
  const title = TYPE_TITLES[licenceType]?.[id] ?? SECTION_TITLES[id];
  return `${SECTION_NUMBER[id]}. ${title}`;
}

export interface SectionPlan {
  id: SectionId;
  /** The heading to print, exactly as printed. Fixed per (type, id). */
  heading: string;
  /** Roughly how many paragraphs this section should run to. */
  paragraphs: number;
}

export interface StructurePlan {
  /**
   * ⚠️ AN IDENTIFIER NOW, NOT AN INPUT. The structure no longer varies, so the
   * seed does not change the plan. It is kept, stored and reported because it
   * ties a filed document to the row that produced it, and because a
   * regeneration takes a fresh one so the two attempts can be told apart.
   */
  seed: number;
  sections: SectionPlan[];
  /** Fixed. Kept as a field because the prompt renders a guide from it. */
  opening: 'purpose_first';
  closing: 'declaration';
  cadence: 'plain';
}

/**
 * How many paragraphs each section runs to, from the book's own briefs.
 *
 * ⚠️ A BUDGET, NOT A QUOTA, and the anti-padding rule outranks it in both
 * directions. Book Part 4.3: "A shorter document built only from the
 * applicant's facts beats a longer one padded to the band."
 */
const PARAGRAPHS: Record<SectionId, number> = {
  introduction: 1,
  personal_circumstances: 3,
  the_threat: 3,
  the_quarry: 3,
  the_discipline: 3,
  use_since_licensing: 2,
  existing_measures: 2,
  the_firearm: 2,
  // The table carries the facts; the prose is one sentence per firearm.
  held_firearms: 1,
  experience: 1,
  association: 1,
  storage_safety: 1,
  compliance_history: 1,
  // Quote an element, answer it with a fact, then the next. The count is the
  // number of elements the section's statute block sets out.
  statutory_application: 4,
  conclusion: 1,
};

const TYPE_PARAGRAPHS: Record<
  MotivationLicenceType,
  Partial<Record<SectionId, number>>
> = {
  /**
   * ⚠️ ONE PARAGRAPH FOR THE FIREARM, AND THE ROOM WAS THE INSTRUCTION.
   * Given two to four, the model filled them with a catalogue — short recoil,
   * tilting barrel, polymer frame, "variable maintenance cycles". Book Part
   * 5.1 brief 5: one paragraph, at most sixty words, four facts.
   */
  S13_SELF_DEFENCE: { the_firearm: 1 },
  // Book Part 5.2: circumstances three to four paragraphs (section K's facts
  // all have to appear), the purpose section three to four, the firearm two.
  S14_RESTRICTED_SELF_DEFENCE: {
    personal_circumstances: 4,
    the_threat: 4,
  },
  S15_OCCASIONAL_HUNTER: { statutory_application: 3 },
  S16_DEDICATED_HUNTER: {
    the_quarry: 4,
    the_firearm: 3,
    association: 2,
    statutory_application: 3,
  },
  S16_DEDICATED_SPORT: {
    the_discipline: 4,
    the_firearm: 3,
    association: 2,
    statutory_application: 3,
  },
  S24_RENEWAL: { the_firearm: 1, statutory_application: 2 },
};

/**
 * The order each licence type's document runs in, and which of the twelve
 * headings it carries at all.
 *
 * ⚠️ THESE ORDERS ARE NOT OURS TO INVENT, AND THEY NO LONGER PERMUTE. Book
 * Part 4.2 fixes the spine; Part 5 says which headings each section of the Act
 * omits — 2 and 4 for everything except a self-defence application, and for a
 * renewal as well, which shows continuity rather than need.
 *
 * The conditional members (`held_firearms`, `association`, `compliance_history`)
 * appear in every skeleton that can carry them and are dropped by planFor when
 * the applicant's own facts do not support them. See PlanOptions.
 */
const SECTION_SKELETONS: Record<
  MotivationLicenceType,
  readonly SectionId[]
> = {
  S13_SELF_DEFENCE: [
    'introduction',
    'personal_circumstances',
    'the_threat',
    'existing_measures',
    'the_firearm',
    'held_firearms',
    'experience',
    'storage_safety',
    'compliance_history',
    'statutory_application',
    'conclusion',
  ],
  // Identical spine to the section 13. What differs is the purpose heading,
  // the weight of the circumstances section (section K of the SAPS 271 is
  // completed for section 14 and no other section) and the briefs.
  S14_RESTRICTED_SELF_DEFENCE: [
    'introduction',
    'personal_circumstances',
    'the_threat',
    'existing_measures',
    'the_firearm',
    'held_firearms',
    'experience',
    'storage_safety',
    'compliance_history',
    'statutory_application',
    'conclusion',
  ],
  // ⚠️ THE PURPOSE ID IS SUBSTITUTED PER APPLICANT. A section 15 is hunting OR
  // sport — book failure mode 5 is treating it as hunting only — so the
  // skeleton names the hunting id and planFor swaps in `the_discipline` where
  // the applicant answered the sport cards and not the hunting ones.
  S15_OCCASIONAL_HUNTER: [
    'introduction',
    'the_quarry',
    'the_firearm',
    'held_firearms',
    'experience',
    'association',
    'storage_safety',
    'compliance_history',
    'statutory_application',
    'conclusion',
  ],
  S16_DEDICATED_HUNTER: [
    'introduction',
    'the_quarry',
    'the_firearm',
    'held_firearms',
    'experience',
    'association',
    'storage_safety',
    'compliance_history',
    'statutory_application',
    'conclusion',
  ],
  S16_DEDICATED_SPORT: [
    'introduction',
    'the_discipline',
    'the_firearm',
    'held_firearms',
    'experience',
    'association',
    'storage_safety',
    'compliance_history',
    'statutory_application',
    'conclusion',
  ],
  S24_RENEWAL: [
    'introduction',
    'use_since_licensing',
    'the_firearm',
    'held_firearms',
    'experience',
    'association',
    'storage_safety',
    'compliance_history',
    'statutory_application',
    'conclusion',
  ],
};

export interface PlanOptions {
  /**
   * True when the applicant holds at least one licensed firearm.
   *
   * Drives heading 6. False is a first application, where the book puts "No
   * firearm is currently licensed to me" in the introduction instead — a
   * sentence, not a section, because there is no table to draw and no gap to
   * argue.
   */
  holdsFirearms?: boolean;
  /**
   * True when any of the six SAPS 271 declaration items (G.62 to G.67) is a
   * Yes. Drives heading 10.
   *
   * ⚠️ THE HEADING IS OMITTED ENTIRELY WHEN EVERY ANSWER IS NO, and nothing is
   * said. Book Part 5.1 brief 10. A paragraph volunteering "I have no criminal
   * record" is on the banned list twice over: SAPS checks it themselves, and
   * an unevidenced claim of good character is what the reviewer is reading the
   * annexures to decide.
   */
  hasRecord?: boolean;
  /**
   * True when the applicant belongs to an accredited association. Drives
   * heading 8 on a section 15 and on a renewal; the section 16 routes carry it
   * always, because dedicated status is what those sections turn on.
   *
   * ⚠️ ON A RENEWAL THIS STANDS IN FOR THE UNDERLYING SECTION, which the
   * product does not yet record. Book Part 5.6 brief 8 says the section is for
   * section 16 renewals only. Gating on membership gives a section 16 renewal
   * its section, and at worst gives a section 15 member a true paragraph
   * naming their association — which is the safe direction to be wrong in.
   */
  isAssociationMember?: boolean;
  /**
   * Which variant a section 15 is. Ignored for every other type.
   *
   * Book Part 5.3: "The generator picks one from the applicant's answer; the
   * document never mixes both unless the applicant genuinely does both, and
   * then hunting leads." So this is one choice, not two sections — see
   * `s15Purpose` in motivation-fields.ts, which reads it off the answers.
   */
  purpose?: 'hunting' | 'sport';
}

/**
 * Build the plan for a motivation.
 *
 * Deterministic, and now trivially so: the same (type, options) always
 * produces the same plan, and the seed is carried through untouched. That is
 * what lets an admin reproduce and explain a document months later — and,
 * since the structure no longer varies, what makes a REGENERATION a second
 * attempt at the same plan rather than a different document.
 */
export function planFor(
  licenceType: MotivationLicenceType,
  seed: number,
  opts: PlanOptions = {},
): StructurePlan {
  const budget = TYPE_PARAGRAPHS[licenceType];

  const sections = SECTION_SKELETONS[licenceType]
    .map((id) =>
      id === 'the_quarry' &&
      licenceType === MotivationLicenceType.S15_OCCASIONAL_HUNTER &&
      opts.purpose === 'sport'
        ? ('the_discipline' as SectionId)
        : id,
    )
    .filter((id) => {
      if (id === 'held_firearms') return opts.holdsFirearms === true;
      if (id === 'compliance_history') return opts.hasRecord === true;
      if (id === 'association') {
        return (
          licenceType === MotivationLicenceType.S16_DEDICATED_HUNTER ||
          licenceType === MotivationLicenceType.S16_DEDICATED_SPORT ||
          opts.isAssociationMember === true
        );
      }
      return true;
    })
    .map((id) => ({
      id,
      heading: headingFor(licenceType, id),
      paragraphs: budget[id] ?? PARAGRAPHS[id],
    }));

  return {
    seed,
    sections,
    opening: 'purpose_first',
    closing: 'declaration',
    cadence: 'plain',
  };
}

/** Headings in order — what we check the generated document against. */
export function expectedHeadings(plan: StructurePlan): string[] {
  return plan.sections.map((s) => s.heading);
}

/**
 * Did the model actually follow the plan?
 *
 * We ask for a structure and then VERIFY it, rather than trusting the
 * instruction landed. A document that ignored the plan is not merely untidy —
 * it means the variation engine did nothing, which is the failure we cannot
 * afford to have go unnoticed.
 */
export function followsPlan(
  documentText: string,
  plan: StructurePlan,
): { ok: boolean; missing: string[]; outOfOrder: boolean } {
  const lines = documentText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const missing: string[] = [];
  const positions: number[] = [];

  for (const heading of expectedHeadings(plan)) {
    const idx = lines.findIndex(
      (l) => l.toLowerCase() === heading.toLowerCase(),
    );
    if (idx === -1) missing.push(heading);
    else positions.push(idx);
  }

  const outOfOrder = positions.some((p, i) => i > 0 && p < positions[i - 1]);
  return { ok: missing.length === 0 && !outOfOrder, missing, outOfOrder };
}

// ── The detector ────────────────────────────────────────────────────

/** Drop the content, keep the shape. */
function structuralTokens(documentText: string): string[] {
  const lines = documentText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const tokens: string[] = [];

  for (const line of lines) {
    // ⚠️ NUMBERED, NOT COLON-TERMINATED. Headings stopped ending in a colon
    // when the skeleton was fixed (Part 7.1), and this test was the colon.
    // Left alone it classified every heading as prose and the fingerprint
    // silently stopped measuring structure at all.
    if (/^\d{1,2}\.\s/.test(line) && line.length <= 80) {
      // A heading. Keep it as a marker, normalised.
      tokens.push('H:' + line.toLowerCase().replace(/[^a-z ]/g, '').trim());
      continue;
    }
    // Sentence openers carry the rhythm of the writing; the rest is content.
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      const cleaned = sentence
        // Strip proper nouns — capitalised words that are NOT sentence-initial.
        // Two documents about different people must not look different merely
        // because the names differ.
        .replace(/(?<!^)(?<![.!?]\s)\b[A-Z][a-z]{2,}\b/g, '')
        // Numbers are content too: calibres, dates, membership numbers.
        .replace(/\d+/g, '')
        .toLowerCase()
        .replace(/[^a-z\s]/g, ' ')
        .trim();
      const words = cleaned.split(/\s+/).filter(Boolean);
      if (words.length >= 3) tokens.push('S:' + words.slice(0, 3).join(' '));
    }
  }
  return tokens;
}

const SHINGLE = 3;

/**
 * Reduce a document to a set of hashed structural shingles.
 *
 * Hashed, not stored raw, because these go in a queryable column and even
 * stripped sentence-openers are the applicant's own phrasing. 12 hex chars is
 * plenty — a collision costs us a slightly wrong similarity score, nothing more.
 */
export function fingerprint(documentText: string): string[] {
  const tokens = structuralTokens(documentText);
  if (tokens.length < SHINGLE) return [];
  const out = new Set<string>();
  for (let i = 0; i + SHINGLE <= tokens.length; i++) {
    out.add(
      crypto
        .createHash('sha256')
        .update(tokens.slice(i, i + SHINGLE).join('|'))
        .digest('hex')
        .slice(0, 12),
    );
  }
  return [...out];
}

/** Jaccard overlap, 0..1. Two empty fingerprints are treated as identical. */
export function similarity(a: readonly string[], b: readonly string[]): number {
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  let shared = 0;
  for (const x of new Set(a)) if (setB.has(x)) shared++;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : shared / union;
}

/** Worst overlap against everything we have produced for this licence type. */
export function maxSimilarity(
  candidate: readonly string[],
  previous: readonly (readonly string[])[],
): number {
  let worst = 0;
  for (const p of previous) {
    const s = similarity(candidate, p);
    if (s > worst) worst = s;
  }
  return worst;
}

/**
 * Above this, regenerate with a new seed.
 *
 * Motivations for the same licence type share vocabulary by necessity — the Act
 * has particular words and there are only so many ways to say "the firearm will
 * be stored in a safe bolted to a wall". A threshold that is too low would spin
 * on every document and burn the beta budget on retries. 0.55 is deliberately
 * loose: it catches "these are the same document" without punishing "these are
 * two people applying for the same thing". Tune from the admin sameness report
 * once there is real data — that is what it is for.
 */
export const SIMILARITY_REGENERATE_THRESHOLD = 0.55;
