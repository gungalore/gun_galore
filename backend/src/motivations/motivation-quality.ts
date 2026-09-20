import { QUARRY } from './motivation-quarry';
import { CATALOGUE_PHRASES } from './motivation-scope';

// ────────────────────────────────────────────────────────────────────
// MEASURING A MOTIVATION, SO "RICHER" IS A NUMBER RATHER THAN A FEELING.
//
// ⚠️ THE PROBLEM THIS EXISTS FOR. Prompt changes to the writer are argued about
// from memory: a document is read, it feels thinner or fuller than the last one,
// and a change is kept or reverted on that. There is no baseline, so there is no
// way to tell a change that added specifics from one that added words — and the
// two look identical in a rendered pack.
//
// ⚠️ SO IT COUNTS THINGS THAT CANNOT BE PADDED. Named species, distances in
// metres, annexure citations, the share of sentences carrying any of them, and
// the longest run of sentences carrying none. A model asked for more detail
// produces more words and the same number of specifics; that shows up here as
// `words` rising while `specificity` and `longestGenericRun` do not move. Which
// is exactly the distinction MOTIVATION-CORPUS-LEARNINGS.md draws when it
// measures an approved 40-page pack at under 400 words of applicant prose.
//
// ⚠️ THE VOCABULARY IS THE APP'S OWN, NOT A NEW LIST. Species come from QUARRY
// (the same table that decides which animal the plate draws), banned phrases
// from CATALOGUE_PHRASES (the same list `documentScope` refuses on). A second
// list here would drift from the one the gate enforces, and then the scorecard
// and the gate would disagree about the same document.
//
// ⚠️ PURE, AND DELIBERATELY NOT A GATE. Nothing here decides whether a document
// may ship — `documentScope` and `validateReason` do that. This measures, and a
// measurement that also refuses is a measurement nobody will run on a bad
// document.
// ────────────────────────────────────────────────────────────────────

/**
 * Terrain words, as the measurement vocabulary.
 *
 * ⚠️ SPELLED OUT RATHER THAN DERIVED FROM HUNT_TERRAIN. That table's keys are
 * `open_plains`, `coastal_thicket` and so on — slugs, not the words a document
 * uses — and folding slugs to words here would be a second normalisation to
 * keep in step. These are the words the approved packs and the writer's own
 * brief actually use.
 */
const TERRAIN_WORDS = [
  'bushveld',
  'thornveld',
  'highveld',
  'karoo',
  'grassland',
  'plains',
  'mountain',
  'mountains',
  'thicket',
  'dune',
  'farmland',
  'coastal',
  'scrub',
  'veld',
] as const;

export interface MotivationQuality {
  words: number;
  paragraphs: number;
  sentences: number;
  /** Distinct species named, as QUARRY spells them. */
  species: string[];
  /** Terrain words used. */
  terrain: string[];
  /** Distances stated, verbatim, in metres or kilometres. */
  distances: string[];
  /** Annexure letters cited, deduped and sorted. */
  annexures: string[];
  /** Catalogue phrases found — the same list the gate refuses on. */
  banned: string[];
  /** Sentences carrying a species, a distance, an annexure or a figure. */
  specific: number;
  /** `specific / sentences`, 0 to 1. The headline number. */
  specificity: number;
  /** Longest run of consecutive sentences carrying nothing concrete. */
  longestGenericRun: number;
  /** Mean sentence length in characters — padding shows up here first. */
  meanSentenceChars: number;
  /**
   * Sentences that repeat an earlier sentence, near-verbatim.
   *
   * ⚠️ THE SAMPLE'S FAULT, MEASURED. MO000002 listed the same quarry set and
   * the same range phrase in two adjacent sections; specificity cannot see
   * that, because both copies are specific. This counts it.
   */
  duplicateSentences: number;
  /** Distinct phrases (8 words) that occur more than once, worst first. */
  repeatedPhrases: string[];
}

/** Sentences, split on terminal punctuation. */
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function escapeRe(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every spelling of every species, longest first.
 *
 * ⚠️ LONGEST FIRST, OR "Kudu" MATCHES INSIDE "Greater Kudu" AND THE COUNT
 * DOUBLES. A species and its alias are one animal, so the longer spelling is
 * tried first and the shorter one is skipped once the longer has matched.
 */
function speciesSpellings(): { spelling: string; name: string }[] {
  const out: { spelling: string; name: string }[] = [];
  for (const q of QUARRY) {
    for (const s of [q.name, ...(q.aliases ?? [])]) {
      out.push({ spelling: s, name: q.name });
    }
  }
  return out.sort((a, b) => b.spelling.length - a.spelling.length);
}

const SPECIES = speciesSpellings();

/**
 * Score one motivation body.
 *
 * @param body  The prose the writer produced — headings and paragraphs, as the
 *   renderer receives it. Tables and the cover are not part of it.
 */
export function scoreMotivation(body: string): MotivationQuality {
  const text = body ?? '';
  const sentences = sentencesOf(text);
  const lower = text.toLowerCase();

  const words = text.split(/\s+/).filter(Boolean).length;
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean).length;

  // ── species, longest spelling first, one hit per animal ──────────
  const species = new Set<string>();
  for (const { spelling, name } of SPECIES) {
    if (species.has(name)) continue;
    const re = new RegExp(`\\b${escapeRe(spelling)}\\b`, 'i');
    if (re.test(text)) species.add(name);
  }

  const terrain = [
    ...new Set(
      TERRAIN_WORDS.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(text)),
    ),
  ];

  const distances = [
    ...new Set(
      (text.match(/\b\d[\d.,]*\s*(?:m|metres|meters|km)\b/gi) ?? []).map((d) =>
        d.trim(),
      ),
    ),
  ];

  const annexures = [
    ...new Set([...text.matchAll(/\bAnnexure\s+([A-Z])\b/g)].map((m) => m[1])),
  ].sort();

  const banned = [
    ...new Set(
      CATALOGUE_PHRASES.filter((p) => lower.includes(p)).map((p) => String(p)),
    ),
  ];

  // ── how much of the prose carries something checkable ────────────
  const speciesRe = new RegExp(
    `\\b(${SPECIES.map((s) => escapeRe(s.spelling)).join('|')})\\b`,
    'i',
  );
  const distanceRe = /\b\d[\d.,]*\s*(?:m|metres|meters|km)\b/i;
  const annexureRe = /\bAnnexure\s+[A-Z]\b/;

  let specific = 0;
  let run = 0;
  let longestGenericRun = 0;
  for (const s of sentences) {
    const concrete =
      speciesRe.test(s) ||
      distanceRe.test(s) ||
      annexureRe.test(s) ||
      /\d/.test(s);
    if (concrete) {
      specific++;
      run = 0;
    } else {
      run++;
      longestGenericRun = Math.max(longestGenericRun, run);
    }
  }

  // ── repetition, within one document ───────────────────────────────
  //
  // ⚠️ THE SAMPLE'S FAULT, AND SPECIFICITY IS BLIND TO IT. MO000002 named the
  // same quarry set and the same range phrase in two adjacent sections; both
  // copies are "specific", so the headline number never moved. What repeats is
  // the shape of a stitched document, and a reviewer notices it.
  const normalise = (v: string) =>
    v
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const sentenceCounts = new Map<string, number>();
  for (const s of sentences) {
    const key = normalise(s);
    if (key.split(' ').filter(Boolean).length < 6) continue;
    sentenceCounts.set(key, (sentenceCounts.get(key) ?? 0) + 1);
  }
  const duplicateSentences = [...sentenceCounts.values()].filter(
    (n) => n > 1,
  ).length;

  const REPEAT_NGRAM = 8;
  const docWords = normalise(text).split(' ').filter(Boolean);
  const gramCounts = new Map<string, number>();
  for (let i = 0; i + REPEAT_NGRAM <= docWords.length; i++) {
    const gram = docWords.slice(i, i + REPEAT_NGRAM).join(' ');
    gramCounts.set(gram, (gramCounts.get(gram) ?? 0) + 1);
  }
  const repeatedPhrases = [...gramCounts.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 5)
    .map(([gram]) => gram);

  return {
    words,
    paragraphs,
    sentences: sentences.length,
    species: [...species].sort(),
    terrain,
    distances,
    annexures,
    banned,
    specific,
    specificity: sentences.length ? specific / sentences.length : 0,
    longestGenericRun,
    meanSentenceChars: sentences.length
      ? Math.round(
          sentences.reduce((n, s) => n + s.length, 0) / sentences.length,
        )
      : 0,
    duplicateSentences,
    repeatedPhrases,
  };
}

/**
 * A one-line summary, for a script's stdout.
 *
 * ⚠️ THE ORDER IS THE ARGUMENT. Specificity and the generic run come before the
 * word count, because a longer document that is no more specific is the failure
 * this whole file is about.
 */
export function summarise(q: MotivationQuality): string {
  const pct = Math.round(q.specificity * 100);
  return [
    `spec ${q.specific}/${q.sentences} (${pct}%)`,
    `generic-run ${q.longestGenericRun}`,
    `${q.words}w`,
    `${q.sentences}sent`,
    `species ${q.species.length}`,
    `terrain ${q.terrain.length}`,
    `dist ${q.distances.length}`,
    `annex ${q.annexures.length}`,
    `dup ${q.duplicateSentences}`,
    `rep ${q.repeatedPhrases.length}`,
    q.banned.length ? `BANNED ${q.banned.join('/')}` : 'banned 0',
  ].join(' | ');
}
