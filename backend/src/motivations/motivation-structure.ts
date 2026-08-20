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
  | 'experience'
  | 'the_firearm'
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
  the_firearm: [
    'The firearm applied for:',
    'The firearm and why it suits the purpose:',
    'Suitability of the firearm:',
    'Why this firearm:',
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
 * Which sections each licence type uses, and which may move.
 *
 * `fixedFirst` and `fixedLast` never move — a motivation that does not open by
 * saying what it is applying for, or closes without an undertaking, reads as
 * broken regardless of how novel its middle is. Everything in `movable` is
 * permuted by seed.
 *
 * NOTE the constraint this encodes: variation is only allowed where it does not
 * damage the document. Shuffling for its own sake would trade the product's
 * whole purpose (a well-made motivation) for novelty.
 */
const SECTION_SETS: Record<
  MotivationLicenceType,
  { fixedFirst: SectionId[]; movable: SectionId[]; fixedLast: SectionId[] }
> = {
  S13_SELF_DEFENCE: {
    fixedFirst: ['introduction'],
    movable: ['personal_circumstances', 'experience', 'the_firearm'],
    fixedLast: ['storage_safety', 'compliance_history', 'conclusion'],
  },
  S15_OCCASIONAL_HUNTER: {
    fixedFirst: ['introduction'],
    movable: ['experience', 'the_firearm', 'personal_circumstances'],
    fixedLast: ['storage_safety', 'compliance_history', 'conclusion'],
  },
  S16_DEDICATED_HUNTER: {
    fixedFirst: ['introduction'],
    movable: ['experience', 'the_firearm'],
    fixedLast: ['storage_safety', 'compliance_history', 'conclusion'],
  },
  S16_DEDICATED_SPORT: {
    fixedFirst: ['introduction'],
    movable: ['experience', 'the_firearm'],
    fixedLast: ['storage_safety', 'compliance_history', 'conclusion'],
  },
  S24_RENEWAL: {
    fixedFirst: ['introduction'],
    movable: ['experience', 'the_firearm'],
    fixedLast: ['storage_safety', 'compliance_history', 'conclusion'],
  },
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

/**
 * Build the plan for a motivation. Deterministic: the same (type, seed) always
 * produces the same plan, which is what lets an admin reproduce and explain a
 * document months later.
 */
export function planFor(
  licenceType: MotivationLicenceType,
  seed: number,
): StructurePlan {
  const rng = mulberry32(seed);
  const set = SECTION_SETS[licenceType];

  const order: SectionId[] = [
    ...set.fixedFirst,
    ...shuffle(rng, set.movable),
    ...set.fixedLast,
  ];

  const sections = order.map((id) => ({
    id,
    heading: pick(rng, HEADING_ALTERNATES[id]),
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
    paragraphs:
      id === 'introduction' || id === 'conclusion'
        ? 1
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
