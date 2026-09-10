import { phraseIn, sentencesWith } from './motivation-scope';

// ────────────────────────────────────────────────────────────────────
// MENDING A SENTENCE INSTEAD OF BINNING A DOCUMENT.
//
// ⚠️ THE GATE IS ALL-OR-NOTHING AND THE DOCUMENT IS NINE HUNDRED WORDS. One
// refused phrase anywhere and the whole pack is thrown away and the applicant
// is emailed to say we could not finish it. MO000075 was refused four times
// across 2026-09-09 and 10, and by the fourth it was structurally clean —
// structureOk, sameness 0.00 — and failing on TWO WORDS:
//
//   "...meaning it cannot engage targets at extended rifle distances."
//
// That sentence is doing exactly what heading 6 is for. Only the idiom is
// wrong.
//
// ⚠️ AND EACH ATTEMPT TRIPPED A DIFFERENT WORD — "platform", then "terminal
// ballistic", then "engage targets". That is the signature of variance, not of
// a bug left to find: across nine hundred words and forty-odd refused phrases,
// a model will occasionally reach for one. Regenerating the whole document to
// fix two words pays for fifteen hundred words to be rewritten AND rolls the
// dice again on every phrase that was fine.
//
// So this rewrites the offending SENTENCES and leaves the rest alone.
//
// ⚠️ IT IS NARROW ON PURPOSE. It runs only when EVERY outstanding complaint is
// about a word. Everything else the gate refuses is a CLAIM — a wrong section,
// an annexure that does not exist, a purpose nobody stated — and those are the
// writer corrupting facts, which is an admin's problem and must still fail.
// A repair pass that "fixed" a wrong serial by rephrasing it would be the worst
// thing in this file.
//
// PURE — text and complaints in, a request out; the caller owns the model call
// and re-runs the full gate over whatever comes back.
// ────────────────────────────────────────────────────────────────────

export interface RepairTarget {
  /** The sentence exactly as it appears, so the splice can be an exact swap. */
  sentence: string;
  /** The phrases that must not survive in it. */
  phrases: string[];
}

/**
 * What needs mending, or null if this is not a job for a rewrite.
 *
 * ⚠️ NULL IS THE COMMON ANSWER AND THE SAFE ONE. Any complaint that is not
 * about a word, or any word we cannot find a sentence for, and the whole repair
 * is abandoned — the document fails exactly as it does today. A partial repair
 * on a document with a real fault in it is worse than no repair.
 */
export function repairTargets(
  text: string,
  issues: readonly string[],
): RepairTarget[] | null {
  if (!issues.length) return null;

  const bySentence = new Map<string, Set<string>>();
  for (const issue of issues) {
    const phrase = phraseIn(issue);
    // Not a vocabulary complaint: this is a claim, and claims are not mended.
    if (!phrase) return null;

    const found = sentencesWith(text, phrase);
    // The gate saw it and we cannot: something disagrees, so change nothing.
    if (!found.length) return null;

    for (const s of found) {
      const set = bySentence.get(s) ?? new Set<string>();
      set.add(phrase);
      bySentence.set(s, set);
    }
  }

  /**
   * ⚠️ BOUNDED, BECAUSE A DOCUMENT NEEDING WHOLESALE REWRITING IS NOT A
   * DOCUMENT WITH A SLIP IN IT. Past a handful of sentences the honest answer
   * is that the draft is wrong, and regenerating is what should happen.
   */
  if (bySentence.size === 0 || bySentence.size > 4) return null;

  return [...bySentence].map(([sentence, phrases]) => ({
    sentence,
    phrases: [...phrases],
  }));
}

/** The schema the provider enforces on the reply. */
export const REPAIR_SCHEMA = {
  type: 'object',
  properties: {
    sentences: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          original: { type: 'string' },
          replacement: { type: 'string' },
        },
        required: ['original', 'replacement'],
      },
    },
  },
  required: ['sentences'],
} as const;

export const REPAIR_SYSTEM = [
  'You edit one sentence at a time in a South African firearm licence',
  'motivation. The applicant signs and lodges it.',
  '',
  'You are given sentences and, for each, words that may not appear in the',
  'document. Rewrite each sentence so those words are gone.',
  '',
  'RULES, and the first one is the whole job:',
  '1. CHANGE NOTHING ELSE. Same meaning, same claim, same firearm, same',
  '   numbers, same order. You are removing a word, not improving a sentence.',
  '2. INTRODUCE NO NEW FACT. No figure, date, calibre, distance, serial or',
  '   claim that is not already in the sentence you were given. If a word',
  '   cannot be removed without inventing something, remove the clause it is',
  '   in instead — a shorter sentence is always acceptable.',
  '3. Plain, sober South African English. First person, as the applicant.',
  '4. Return the original verbatim so it can be matched, and the replacement.',
  '',
  'Ordinary words carry the same meaning: a rifle is a rifle; a shooter SHOOTS',
  'AT targets, or fires a course of fire; a discipline is fast or close-range',
  'rather than "dynamic"; a shot is accurate rather than "efficient".',
].join('\n');

export function repairUserPrompt(targets: readonly RepairTarget[]): string {
  return [
    'Rewrite each sentence so the listed words do not appear. Change nothing',
    'else about it.',
    '',
    ...targets.flatMap((t) => [
      `SENTENCE: ${t.sentence}`,
      `MUST NOT CONTAIN: ${t.phrases.map((p) => `"${p}"`).join(', ')}`,
      '',
    ]),
  ].join('\n');
}

/**
 * Put the replacements back.
 *
 * ⚠️ AN EXACT SWAP, AND NOTHING ELSE. The model is asked to echo the original
 * so this can find it; if it comes back altered the sentence is simply left as
 * it was, and the gate that follows will refuse the document as it would have
 * anyway. Nothing here trusts the reply enough to search for a near match — a
 * fuzzy splice into a document somebody signs is not worth the sentence it
 * saves.
 */
export function applyRepairs(
  text: string,
  replacements: readonly { original: string; replacement: string }[],
): string {
  let out = text;
  for (const { original, replacement } of replacements) {
    if (!original || !replacement) continue;
    if (!out.includes(original)) continue;
    out = out.replace(original, replacement);
  }
  return out;
}
