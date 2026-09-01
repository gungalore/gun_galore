// ────────────────────────────────────────────────────────────────────
// MATCHING A PHRASE THAT HAS BEEN THROUGH AN OCR.
//
// ⚠️ THE CLASSIFIER NEEDED 99.5% CHARACTER ACCURACY AND NOTHING DELIVERS THAT.
// Measured by corrupting the real document texts in document-markers.spec.ts
// with the confusions a real engine makes, and re-running readMarkers():
//
//     character accuracy   classified correctly
//         99.5%                   95%
//         99%                     90%
//         98%                     80%
//         95%                     52%
//
// Tesseract benchmarks around 92% on English print. No independent English
// figure exists for PP-OCRv4 at all. Google Vision only clears the bar because
// it does undocumented deskew and denoise work server-side.
//
// ⚠️ BUT THAT REQUIREMENT IS A PROPERTY OF OUR ANCHORS, NOT OF OCR. The same
// measurement showed which documents degrade fastest and why. The old plastic
// competency card depends on ONE ~38-character exact phrase with no fallback
// and is already wrong 22% of the time at 99.5% accuracy. The licence card
// depends on one 26-character phrase. Meanwhile SAPS 524 and the PFTC
// statements degrade slowly — because each carries SEVERAL independent short
// markers, and any one of them can carry the classification alone.
//
// So redundancy is the lever, not the engine. This module supplies two kinds:
// tolerance to the substitutions an engine actually makes, and tolerance to
// losing a word outright.
// ────────────────────────────────────────────────────────────────────

/**
 * Glyphs an OCR confuses, grouped by what they look like.
 *
 * ⚠️ EVERY GROUP HERE IS A SHAPE COLLISION, NOT A GUESS. These are the
 * confusions that show up in real engine output because the glyphs are
 * genuinely similar at low resolution: a zero and a capital O, a one and a
 * lowercase L, a five and an S. Adding a pair that does NOT collide visually
 * would widen the match for nothing and invite a false positive.
 */
const CONFUSABLE: readonly string[] = [
  '0oOQ',
  '1lI|i',
  '5sS',
  '8bB',
  '2zZ',
  '6G',
  '9gq',
  'cC(',
  'uUvV',
];

// ⚠️ DELIBERATELY NARROW, AND IT WAS NARROWED AFTER A SURPRISE. The first
// draft also grouped i with j, n with h, and f with t. Those are much weaker
// collisions than a zero with an O, and the cost showed up immediately: a
// test expecting "fjrearms" NOT to match "firearms" failed, because i and j
// had been made interchangeable.
//
// Every pair added here widens what the classifier will accept, and this
// classifier decides which statutory document somebody has uploaded. The
// word-level allowance below already supplies the robustness; the character
// classes only need to cover collisions that genuinely happen, and a
// descender (i vs j) or an ascender (n vs h) is not one of them.

/** Character -> the character class that will match anything it could be read as. */
const CLASS = new Map<string, string>();
for (const group of CONFUSABLE) {
  for (const ch of group) {
    const prev = CLASS.get(ch.toLowerCase()) ?? '';
    CLASS.set(ch.toLowerCase(), prev + group);
  }
}

function escapeClass(s: string): string {
  return s.replace(/[\\\]^-]/g, (m) => `\\${m}`);
}

/** One character of a phrase, as a pattern that tolerates being misread. */
function charPattern(ch: string): string {
  const lower = ch.toLowerCase();
  const group = CLASS.get(lower);
  if (!group) {
    // Not confusable with anything: escape it and move on.
    return lower.replace(/[.*+?^${}()|[\]\\]/g, (m) => `\\${m}`);
  }
  return `[${escapeClass([...new Set(group.toLowerCase() + group)].join(''))}]`;
}

/**
 * A word, as a regex that survives the substitutions an engine makes.
 *
 * ⚠️ SUBSTITUTIONS ONLY — NOT DELETIONS. A character class cannot express "or
 * this character is missing", and making every character optional would match
 * very nearly anything. Dropped characters are handled a level up, by allowing
 * a whole WORD to go missing, which is both safer and closer to what actually
 * happens: OCR tends to mangle a word rather than quietly shorten a phrase.
 */
export function looseWord(word: string): RegExp {
  return new RegExp([...word].map(charPattern).join(''), 'i');
}

export interface PhraseOptions {
  /**
   * How many of the phrase's words may be unrecognisable.
   *
   * ⚠️ THIS IS THE REDUNDANCY, AND IT IS WHY THE FRAGILE DOCUMENTS WERE
   * FRAGILE. "Section 10 of the Firearms Control Act, 2000" dies to one bad
   * character when it must match end to end. Allowing one word to be lost
   * means a mangled "Fjrearrns" costs nothing, because the remaining words
   * still identify the phrase beyond doubt.
   */
  allowMissing?: number;
  /**
   * Words that must survive whatever else does.
   *
   * ⚠️ WITHOUT THIS, ALLOWANCE BECOMES A FALSE POSITIVE. "Competency
   * certificate" with one word optional would match a page containing only
   * the word "certificate", which every training provider's certificate has.
   * The distinctive word is the one carrying the meaning and it is not
   * allowed to be the one that goes missing.
   */
  required?: readonly string[];
}

/**
 * Does this text contain this phrase, allowing for OCR damage?
 *
 * Words may appear with any whitespace or punctuation between them, in order.
 * Each word tolerates the usual glyph confusions, and up to `allowMissing` of
 * them may fail entirely — except any word named in `required`.
 */
export function hasPhrase(
  text: string,
  phrase: string,
  opts: PhraseOptions = {},
): boolean {
  return matchPhrase(text, phrase, opts) !== false;
}

/**
 * As hasPhrase, but reporting whether every word was actually found.
 *
 * 'exact' means the phrase was read cleanly. 'loose' means it was recognised
 * only because a word was allowed to be missing — a real match, on a damaged
 * document, and not one to auto-file on.
 */
export function matchPhrase(
  text: string,
  phrase: string,
  opts: PhraseOptions = {},
): ClauseMatch {
  const words = phrase.split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const allowMissing = Math.max(0, opts.allowMissing ?? 0);
  const required = new Set((opts.required ?? []).map((w) => w.toLowerCase()));

  // ⚠️ MATCHED IN ORDER AND FORWARD-ONLY. Requiring the words to appear in
  // sequence is most of what stops a bag of common words matching an
  // unrelated page: "certificate ... competency" the wrong way round is not
  // the heading we are looking for.
  let from = 0;
  let missing = 0;
  for (const word of words) {
    const re = looseWord(word);
    const rest = text.slice(from);
    const at = rest.search(re);
    if (at < 0) {
      if (required.has(word.toLowerCase()) || ++missing > allowMissing)
        return false;
      continue;
    }
    const m = rest.match(re);
    from += at + (m ? m[0].length : word.length);
  }
  return missing === 0 ? 'exact' : 'loose';
}

/**
 * A phrase matcher, as a predicate the marker table can hold beside a RegExp.
 *
 * Returned as a closure rather than a RegExp because the word-skipping cannot
 * be expressed as one pattern — and because a marker's `all` list is more
 * readable when a tolerant phrase reads as a phrase.
 */
/**
 * How well a clause matched.
 *
 * ⚠️ 'loose' IS THE SAFETY VALVE AND IT IS WHY THIS IS NOT A BOOLEAN. Loosening
 * the anchors bought a lot of recall on damaged documents and cost something
 * real: measured, a SAPS 271 whose title AND form number were both mangled
 * started being filed as the granted licence, 7 times in 400 at 3% character
 * error, where the strict anchors never did it once.
 *
 * That is not tunable away. Once both of an application's distinguishing marks
 * are destroyed it genuinely is indistinguishable from the licence it applies
 * for, by text alone. So the answer is not a better threshold, it is refusing
 * to call a damaged read CERTAIN: readMarkers downgrades any verdict that
 * needed the allowance, and motivation-extract.service.ts only skips the model
 * for a 'definitive' one. A fuzzy match still classifies — it just has to be
 * confirmed rather than auto-filed.
 */
export type ClauseMatch = false | 'exact' | 'loose';

export interface PhraseClause {
  (body: string): ClauseMatch;
  /**
   * The phrase this clause was built from.
   *
   * ⚠️ CARRIED SO THE TABLE STAYS INTROSPECTABLE. document-markers.spec.ts
   * enforces "one phrase is a mention, a pair is a marker" by reading each
   * clause's text, and a bare closure would have made that rule unenforceable
   * — the test would have had to be weakened to accommodate the refactor,
   * which is exactly the wrong direction for a rule protecting a classifier.
   */
  phrase: string;
}

export function phrase(text: string, opts?: PhraseOptions): PhraseClause {
  const fn = (body: string): ClauseMatch => matchPhrase(body, text, opts);
  return Object.assign(fn, { phrase: text });
}

/**
 * Test a marker clause against a body, whichever kind of clause it is.
 *
 * Existing markers are RegExp and stay RegExp: a short distinctive token like
 * "SAPS 524" is already robust and gains nothing from tolerance, while a
 * pattern with alternation and word boundaries would be harder to read
 * rewritten as a phrase.
 */
export type Clause =
  | RegExp
  | PhraseClause
  // A plain boolean predicate is still allowed: `false` is already part of
  // ClauseMatch, so naming both would be redundant, and clauseMatches promotes
  // a bare `true` to 'exact'.
  | ((body: string) => boolean | 'exact' | 'loose');

export function clauseMatches(clause: Clause, body: string): ClauseMatch {
  if (typeof clause !== 'function') return clause.test(body) ? 'exact' : false;
  const got = clause(body);
  if (got === true) return 'exact';
  if (got === false) return false;
  return got;
}

/** What a clause is looking for, for a log line or a rule about the table. */
export function clauseText(clause: Clause): string {
  return typeof clause === 'function'
    ? ((clause as PhraseClause).phrase ?? '')
    : clause.source;
}
