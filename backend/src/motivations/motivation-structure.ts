import * as crypto from 'node:crypto';
import { MotivationLicenceType } from '@prisma/client';

// ────────────────────────────────────────────────────────────────────
// ANTI-TEMPLATE VARIATION — the thing this product lives or dies on.
//
// The operator chose full automation with no human in the loop. That makes one
// failure mode existential: if every motivation we produce has the same shape,
// a DFO or CFR reviewer eventually recognises the pattern, and the moment they
// do, every document we have ever produced is tainted — including the ones our
// paying customers already submitted. It is not enough for the WORDS to differ.
// The SHAPE has to differ too.
//
// So the structure is decided HERE, in code, from a stored seed — not by the
// model. Claude is handed a plan and told to phrase it. Two consequences worth
// stating: the variation is reproducible (an admin can show exactly why two
// documents differ), and it is verifiable (we check the returned document
// actually follows the plan, rather than trusting that it did).
//
// The second half of the file is the detector: fingerprint() reduces a document
// to its STRUCTURE with the content stripped out, so two motivations written
// about completely different people still score high if they were built the
// same way. That is the early-warning signal — measured continuously, surfaced
// on the admin page, rather than discovered by a regulator.
//
// PURE AND I/O-FREE on purpose: no Prisma, no Nest, no Anthropic. It is the
// most heavily tested part of the module because it is the hardest to notice
// going wrong.
// ────────────────────────────────────────────────────────────────────

/** Deterministic PRNG. Same seed, same plan, forever. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rng() * xs.length)];
}

/** Fisher-Yates, seeded. */
function shuffle<T>(rng: () => number, xs: readonly T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export type SectionId =
  | 'introduction'
  | 'personal_circumstances'
  // ── The purpose sections ───────────────────────────────────────────
  //
  // ⚠️ THREE IDS FOR ONE JOB, ON PURPOSE. Operator, 2026-08-20: "We need
  // to talk about the discipline they will be shooting or the animals they
  // will hunt or varmint or why the self defence is applicable."
  //
  // Before this the document went straight from the applicant's circumstances
  // to the firearm, which meant it could assert a need without ever setting
  // out what the firearm is FOR. That is the section a paid writer spends
  // their effort on, and it is the one a reviewer reads to decide whether the
  // applicant has thought about this at all.
  //
  // They are separate ids rather than one 'purpose' id with per-type headings
  // because the HEADINGS have to differ in kind, not just in wording — "The
  // quarry and the ground I hunt" and "The discipline and its course of fire"
  // are not alternates of each other, and a self-defence applicant must never
  // be handed either.
  | 'the_quarry'
  | 'the_discipline'
  | 'the_threat'
  | 'experience'
  | 'the_firearm'
  // ── The three sections the approved corpus has and we did not ──────
  //
  // Read off a corpus of motivations SAPS has already approved — four section
  // 16 dedicated sport documents, a section 16 dedicated hunter pack, a
  // section 13 pack with area crime statistics. Every one of them carries
  // these three, and their absence was the widest gap between what we produce
  // and what a DFO has already signed off on.
  //
  // `the_calibre` is separate from `the_firearm` because they answer different
  // questions. The firearm section argues the PLATFORM — action, barrel,
  // capacity, how it is carried and handled. The calibre section argues the
  // CARTRIDGE against the requirement: what it carries at the range the shot
  // is actually taken at, and what that means for a humane kill or for a
  // course of fire. Folded into one section they collapse into a paragraph
  // that is shallow about both, which is exactly what the gap analysis found
  // in the generated section 15 draft — the ballistic argument one line deep.
  //
  // `comparison` is CONDITIONAL — see SECTION_SKELETONS and planFor. It
  // answers "you already hold one of these". Where an overlap exists, the gap
  // analysis calls its absence the single likeliest ground of refusal; where
  // none exists it is pure padding, an argument against a problem the
  // applicant does not have. So it is in no plan by default.
  //
  // `statutory_application` is the ONLY section that quotes the Act. Approved
  // motivations quote the licence section and the general application
  // regulation verbatim and then answer each quoted element with a fact. Our
  // draft quoted the regulation and then simply listed certificates — the
  // quote left hanging with nothing applied beneath it. Quoting belongs HERE
  // and nowhere else in the document; everywhere else is plain language.
  //
  // ⚠️ NOT `discipline_rules`, deliberately. Courses of fire, the PAJA notice
  // and the annexure index are PACK ASSEMBLY (motivation-pdf-merge.ts) —
  // cited, not rewritten. A writer section for them would set the model to
  // reproducing a rulebook it has no way to verify, which is the invention
  // failure mode this whole module exists to prevent.
  | 'the_calibre'
  | 'comparison'
  | 'statutory_application'
  | 'storage_safety'
  | 'compliance_history'
  | 'conclusion';

export interface SectionPlan {
  id: SectionId;
  /** The heading to print. One of several alternates, chosen by seed. */
  heading: string;
  /** Roughly how many paragraphs this section should run to. */
  paragraphs: number;
}

export interface StructurePlan {
  seed: number;
  sections: SectionPlan[];
  /** How the document opens — changes the whole feel of the first paragraph. */
  opening: 'chronological' | 'need_first' | 'circumstance_first' | 'purpose_first';
  /** How it closes. */
  closing: 'summary' | 'undertaking' | 'forward_looking';
  /** Sentence-length register the prose should sit at. */
  cadence: 'plain' | 'measured' | 'detailed';
}

/**
 * Heading alternates. Same meaning, different words — a reviewer skimming two
 * documents should not see the same table of contents twice.
 */
const HEADING_ALTERNATES: Record<SectionId, readonly string[]> = {
  introduction: [
    'Introduction:',
    'Purpose of this application:',
    'Background to this application:',
    'Why I am applying:',
  ],
  personal_circumstances: [
    'My circumstances:',
    'Personal circumstances:',
    'My situation:',
    'Circumstances relevant to this application:',
  ],
  experience: [
    'Experience and training:',
    'My experience:',
    'Training and track record:',
    'Relevant experience:',
  ],
  the_quarry: [
    'The quarry and the ground I hunt:',
    'What I hunt, and where:',
    'The species and the terrain:',
    'The game I hunt and the conditions:',
  ],
  the_discipline: [
    'The discipline and its requirements:',
    'The discipline I shoot:',
    'My discipline and its course of fire:',
    'What the discipline demands:',
  ],
  the_threat: [
    'Why a firearm, and why now:',
    'The risk I am seeking to meet:',
    'My exposure to risk:',
    'The circumstances that give rise to this application:',
  ],
  the_firearm: [
    'The firearm applied for:',
    'The firearm and why it suits the purpose:',
    'Suitability of the firearm:',
    'Why this firearm:',
  ],
  // The generic sets for the three corpus sections. Where the heading has to
  // differ in KIND per licence type rather than merely in wording, the
  // overrides in TYPE_HEADING_ALTERNATES win and these are the fallback.
  the_calibre: [
    'The calibre:',
    'The cartridge and what it has to do:',
    'Why this calibre:',
    'The calibre and its suitability:',
  ],
  comparison: [
    'Comparison with the firearms I already hold:',
    'Why this firearm does not duplicate what I hold:',
    'How this firearm differs from the ones I have:',
    'My existing firearms, and why this one is additional:',
  ],
  statutory_application: [
    'Application in terms of the Act:',
    'How I meet the requirements of the Act:',
    'The statutory requirements, applied to my circumstances:',
    'Compliance with the Firearms Control Act 60 of 2000:',
  ],
  storage_safety: [
    'Safe storage:',
    'Storage and safekeeping:',
    'How the firearm will be secured:',
    'Safekeeping arrangements:',
  ],
  compliance_history: [
    'Compliance history:',
    'My record:',
    'Licensing history:',
    'Previous applications and licences:',
  ],
  conclusion: [
    'Conclusion:',
    'In closing:',
    'Summary:',
    'Undertaking:',
  ],
};

/**
 * Per-type heading overrides.
 *
 * ⚠️ ONLY WHERE THE HEADING DIFFERS IN KIND, not merely in wording — the same
 * rule that gave the purpose sections three ids instead of one. Two sections
 * earn an override:
 *
 *  - `statutory_application` has to name the section it is quoting. A reviewer
 *    reads the table of contents before the body, and "section 16" standing
 *    over a self-defence application is worse than no heading at all.
 *  - `the_calibre` argues the cartridge against a requirement, and the
 *    requirement differs in kind by type: a humane kill on a named species, a
 *    course of fire, or a shot taken inside a house. The heading says which.
 *
 * `comparison` gets no override. "Why is this not a duplicate of what you
 * already hold" is the same question whoever is asking it.
 *
 * Anything not listed here falls back to HEADING_ALTERNATES.
 */
const TYPE_HEADING_ALTERNATES: Partial<
  Record<MotivationLicenceType, Partial<Record<SectionId, readonly string[]>>>
> = {
  S13_SELF_DEFENCE: {
    the_calibre: [
      'The calibre and why it suits defensive use:',
      'Why this cartridge for self-defence:',
      'The cartridge and what I need it to do:',
      'Calibre, control and the defensive role:',
    ],
    statutory_application: [
      'Application in terms of section 13 of the Act:',
      'How I meet the requirements of section 13:',
      'Section 13 applied to my circumstances:',
      'The statutory test for self-defence, applied:',
    ],
  },
  S15_OCCASIONAL_HUNTER: {
    the_calibre: [
      'The calibre and the quarry it must take:',
      'Why this cartridge suits the species I hunt:',
      'The cartridge and a humane kill:',
      'Calibre, range and the animals I hunt:',
    ],
    statutory_application: [
      'Application in terms of section 15 of the Act:',
      'How I meet the requirements of section 15:',
      'Section 15 applied to my circumstances:',
      'The statutory test for occasional hunting and sport shooting, applied:',
    ],
  },
  S16_DEDICATED_HUNTER: {
    the_calibre: [
      'The calibre and the quarry it must take:',
      'Why this cartridge suits the species I hunt:',
      'The cartridge and a humane kill:',
      'Calibre, range and the animals I hunt:',
    ],
    statutory_application: [
      'Application in terms of section 16 of the Act:',
      'How I meet the requirements of section 16:',
      'Section 16 applied to my circumstances:',
      'The statutory test for dedicated status, applied:',
    ],
  },
  S16_DEDICATED_SPORT: {
    the_calibre: [
      'The calibre and the course of fire:',
      'Why this cartridge suits the discipline:',
      'The cartridge and what the discipline demands of it:',
      'Calibre, class and course of fire:',
    ],
    statutory_application: [
      'Application in terms of section 16 of the Act:',
      'How I meet the requirements of section 16:',
      'Section 16 applied to my circumstances:',
      'The statutory test for dedicated status, applied:',
    ],
  },
  // No calibre override: a renewal gets no calibre section at all. See
  // SECTION_SKELETONS.
  S24_RENEWAL: {
    statutory_application: [
      'Application in terms of section 24 of the Act:',
      'How I meet the requirements for renewal:',
      'Section 24 applied to this renewal:',
      'The statutory test for renewal, applied:',
    ],
  },
};

function headingAlternatesFor(
  licenceType: MotivationLicenceType,
  id: SectionId,
): readonly string[] {
  return TYPE_HEADING_ALTERNATES[licenceType]?.[id] ?? HEADING_ALTERNATES[id];
}

/**
 * A slot in a skeleton: one section, or a small group whose members may swap
 * among themselves while the group as a whole keeps its place in the order.
 */
type SectionSlot = SectionId | readonly SectionId[];

/**
 * The order each licence type's document runs in.
 *
 * ⚠️ THESE ORDERS ARE NOT OURS TO INVENT. They are read off motivations SAPS
 * has already approved, plus the one correction the gap analysis makes to our
 * own section 15 draft: NEED BEFORE FIREARM. A reviewer reads top-down, and
 * every approved document in the corpus runs identity → competence → security
 * → purpose → firearm fit → statute → conclusion. We had ONE shared shape for
 * all five types, which is how an S15 came to argue the rifle before it had
 * said a word about what it would be hunting.
 *
 * ⚠️ THIS COSTS SHAPE VARIATION, AND THAT IS A DELIBERATE TRADE. The old plan
 * permuted four sections freely — 24 orders for an S13; a skeleton permutes
 * one pair, which is 2. The rule at the top of this file decides it: variation
 * is only allowed where it does not damage the document, and an order taken
 * from documents a DFO has already approved is not something to shuffle for
 * novelty. What carries the anti-template load now is FIVE skeletons instead
 * of one, the conditional comparison section, heading alternates four deep per
 * section (per type, where they differ in kind) and the opening / closing /
 * cadence draws. ⚠️ Watch the admin sameness report: if same-type documents
 * start scoring high against each other, this is the first place to look, and
 * the fix is more heading alternates rather than loosening the order.
 *
 * The pair that still permutes is experience and storage. They are independent
 * of each other and the corpus itself runs them both ways round, so swapping
 * them is corpus-supported rather than invented.
 *
 * `comparison` appears in every skeleton but is DROPPED unless the applicant
 * actually holds a same-class firearm — see planFor.
 */
const SECTION_SKELETONS: Record<
  MotivationLicenceType,
  readonly SectionSlot[]
> = {
  // Corpus S13: personal details → daily pattern of life → the threat → why a
  // firearm and why this one → competency → security → statute. Circumstances
  // sit at 2 because they are what the threat argument is built ON; below it,
  // the threat lands on a reader who does not yet know where this applicant
  // lives, works or drives.
  S13_SELF_DEFENCE: [
    'introduction',
    'personal_circumstances',
    'the_threat',
    'the_firearm',
    'the_calibre',
    ['experience', 'storage_safety'],
    'compliance_history',
    'comparison',
    'statutory_application',
    'conclusion',
  ],
  // Gap analysis, fix 5: the draft ran competency → storage → firearm →
  // hunting, so every "which is why this rifle suits it" pointed forward at a
  // section the reader had not reached. The quarry now comes first.
  S15_OCCASIONAL_HUNTER: [
    'introduction',
    'personal_circumstances',
    ['experience', 'storage_safety'],
    'the_quarry',
    'the_firearm',
    'the_calibre',
    'compliance_history',
    'comparison',
    'statutory_application',
    'conclusion',
  ],
  S16_DEDICATED_HUNTER: [
    'introduction',
    ['experience', 'storage_safety'],
    'the_quarry',
    'the_firearm',
    'the_calibre',
    'compliance_history',
    'comparison',
    'statutory_application',
    'conclusion',
  ],
  S16_DEDICATED_SPORT: [
    'introduction',
    ['experience', 'storage_safety'],
    'the_discipline',
    'the_firearm',
    'the_calibre',
    'compliance_history',
    'comparison',
    'statutory_application',
    'conclusion',
  ],
  // ⚠️ A RENEWAL GETS NO PURPOSE SECTION, and that is not an oversight.
  // Section 24 renews an EXISTING licence: the purpose was accepted when it
  // was granted, and re-arguing it invites a reviewer to reopen a question
  // nobody asked. A renewal's job is to show continued compliance and
  // continued use, which is what the sections it does have are for.
  //
  // ⚠️ AND NO CALIBRE SECTION EITHER, for the same reason one step on. The
  // calibre section argues the cartridge against a stated requirement; with no
  // purpose section there is no stated requirement, so it would be suitability
  // argued against nothing — the padding the anti-padding rule exists to stop.
  // The renewal keeps its order otherwise: experience and the firearm still
  // swap, exactly as they did before, and the two corpus sections it does gain
  // sit ahead of the conclusion.
  S24_RENEWAL: [
    'introduction',
    ['experience', 'the_firearm'],
    'storage_safety',
    'compliance_history',
    'comparison',
    'statutory_application',
    'conclusion',
  ],
};

const OPENINGS: StructurePlan['opening'][] = [
  'chronological',
  'need_first',
  'circumstance_first',
  'purpose_first',
];
const CLOSINGS: StructurePlan['closing'][] = [
  'summary',
  'undertaking',
  'forward_looking',
];
const CADENCES: StructurePlan['cadence'][] = ['plain', 'measured', 'detailed'];

export interface PlanOptions {
  /**
   * True when the applicant already holds a firearm in the same class as the
   * one applied for — that is, when the FactPack will carry an `overlapNote`.
   * Drives the conditional comparison section.
   *
   * ⚠️ PASSED IN, NEVER RE-DERIVED HERE. The overlap is decided by
   * `overlapFromAnswers` in motivation-overlap.ts, which knows how to read
   * calibres out of the registry fields and classify them into quarry classes.
   * Working it out a second time from the answers would give us two answers to
   * one question, and the day they disagreed the document would either argue
   * against an overlap the writer was never briefed on, or stay silent about
   * one it was — the second being the refusal ground the whole section exists
   * to close.
   */
  hasOverlap?: boolean;
}

/**
 * Build the plan for a motivation. Deterministic: the same
 * (type, seed, options) always produces the same plan, which is what lets an
 * admin reproduce and explain a document months later.
 *
 * ⚠️ `hasOverlap` IS PART OF THAT KEY, alongside the seed. Reproducing a plan
 * from a stored `variantSeed` alone will differ from the filed document
 * whenever there was an overlap. It is still reproducible — the overlap is a
 * pure function of the applicant's stored answers — but it has to be
 * recomputed, not assumed.
 */
export function planFor(
  licenceType: MotivationLicenceType,
  seed: number,
  opts: PlanOptions = {},
): StructurePlan {
  const rng = mulberry32(seed);

  const order: SectionId[] = [];
  for (const slot of SECTION_SKELETONS[licenceType]) {
    // A group keeps the skeleton's positions; only its members swap.
    if (typeof slot === 'string') order.push(slot);
    else order.push(...shuffle(rng, slot));
  }

  // ⚠️ THE PURPOSE SECTION MUST COME BEFORE THE FIREARM SECTION.
  //
  // The two are a pair: the purpose section defines the requirement (this
  // quarry at these ranges, this course of fire, this exposure) and the
  // firearm section answers it (therefore this calibre, this barrel, this
  // action). Run the other way round the document justifies a choice before
  // stating the problem, and every "which is why this rifle suits it" in the
  // firearm section points at a section the reader has not reached yet.
  //
  // The free shuffle this was written against produced exactly that on the
  // first seed it was tried on: "Suitability of the firearm" at 2, "What I
  // hunt, and where" at 3.
  //
  // ⚠️ NOW A BACKSTOP, NOT THE MECHANISM. The skeletons already order the pair
  // correctly, so this never fires today. It stays because the property is
  // load-bearing and cheap to hold: an edit to a skeleton, or a purpose
  // section dropped into a permuting group, would otherwise invert the pair
  // silently and the only symptom would be a document that reads backwards.
  const purposeIdx = order.findIndex(
    (id) => id === 'the_quarry' || id === 'the_discipline' || id === 'the_threat',
  );
  const firearmIdx = order.indexOf('the_firearm');
  if (purposeIdx !== -1 && firearmIdx !== -1 && purposeIdx > firearmIdx) {
    [order[purposeIdx], order[firearmIdx]] = [
      order[firearmIdx],
      order[purposeIdx],
    ];
  }

  // ⚠️ NO OVERLAP, NO COMPARISON SECTION. The section answers "you already
  // hold one of these", and there are two ways to get it wrong. Leaving it out
  // when the applicant DOES hold a same-class firearm is, on the gap analysis,
  // the single likeliest ground of refusal — a reviewer sees both entries on
  // the licence record and is left to draw their own conclusion. Putting it in
  // when they do not is worse than useless: the document opens an argument
  // about a difficulty nobody raised, and the writer, briefed with no
  // overlapNote to work from, has nothing to fill it with but invention.
  const sections = order
    .filter((id) => id !== 'comparison' || opts.hasOverlap === true)
    .map((id) => ({
      id,
      heading: pick(rng, headingAlternatesFor(licenceType, id)),
      // Introduction and conclusion stay short; the body carries the argument.
      //
      // ⚠️ BODY SECTIONS RUN 2-4, RAISED FROM 1-3. Operator, 2026-08-20: the
      // motivation has to show the applicant knows what they are doing with a
      // firearm, and a section allotted a single paragraph cannot demonstrate
      // competence — it can only assert it. The floor of 2 is the change that
      // matters; the ceiling moved with it so the range stays three wide.
      //
      // ⚠️ THIS IS ROOM, NOT AN INSTRUCTION TO FILL IT. The anti-padding rule
      // in the system prompt is untouched and still forbids potted histories
      // and general essays, and the prompt now says plainly where the extra
      // paragraph is meant to come from: the applicant's own training, storage
      // and handling, in their own detail.
      //
      // ⚠️ THE STATUTORY SECTION ALONE HAS A FLOOR OF 3. It is the one section
      // that quotes the Act, and the quote is only half its job: the approved
      // pattern is quote an element, answer it with a fact, then the next.
      // Quote / apply / quote / apply does not fit in two paragraphs, and a
      // section squeezed to two reverts to the exact defect found in our own
      // draft — regulation pasted in and left hanging with nothing beneath it.
      paragraphs:
        id === 'introduction' || id === 'conclusion'
          ? 1
          : id === 'statutory_application'
            ? 3 + Math.floor(rng() * 2) // 3-4
            : 2 + Math.floor(rng() * 3), // 2-4
    }));

  return {
    seed,
    sections,
    opening: pick(rng, OPENINGS),
    closing: pick(rng, CLOSINGS),
    cadence: pick(rng, CADENCES),
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
    if (line.endsWith(':') && line.length <= 80) {
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
