import { MotivationLicenceType } from '@prisma/client';
import {
  AMERICANISMS,
  NOT_SOUTH_AFRICAN_DIVISIONS,
  PRODUCT_PAGE_WORDS,
  bestFirearmMatch,
} from './motivation-reason';
import type { ArsenalRow } from './motivation-arsenal';

// ────────────────────────────────────────────────────────────────────
// THE WHOLE DOCUMENT, NOT ONE PARAGRAPH.
//
// `validateReason()` has policed product-page vocabulary, Americanisms and
// invented association rules since the reason generator shipped — and it has
// only ever seen the ONE paragraph it generates. MO000071 passed every gate
// and shipped 150 words on short-recoil actions, tilting barrels, polymer
// frames and "dust, lint, and variable maintenance cycles", then another
// section on "high magazine capacities" and "terminal ballistics".
//
// ⚠️ "HIGH MAGAZINE CAPACITIES" AND "TERMINAL BALLISTICS" ARE PHRASES A
// REGISTRAR READS AGAINST THE APPLICANT. They are not merely off-register:
// they describe an appetite rather than a need, in a document whose entire
// job is to establish a need. Prompt rule 15 has said so from the first
// draft; nothing applied it past the reason paragraph.
//
// ⚠️ AND THIS IS THE DETERMINISTIC HALF. It runs beside `packConsistency` in
// the generation service, so a failure costs ONE regeneration and then fails
// the run to an admin — never to the applicant, who cannot fix the writer's
// vocabulary by answering another question.
//
// PURE — text in, complaints out. No Nest, no Prisma, no clock.
// ────────────────────────────────────────────────────────────────────

/**
 * Marketing copy, over and above the reason paragraph's own list.
 *
 * ⚠️ EVERY ONE OF THESE IS OFF MO000071. They are not hypothetical bad
 * writing; they are what the model produced unprompted for a self-defence
 * application, in a document the applicant was expected to sign.
 */
const CATALOGUE_PHRASES = [
  'terminal ballistic',
  'stopping power',
  'magazine capacit',
  'high capacity',
  'short-recoil',
  'short recoil',
  'tilting barrel',
  'polymer frame',
  'safe action',
  'striker-fired',
  'striker fired',
  'foot-pound',
  'foot pound',
  'muzzle energy',
  'muzzle velocity',
  'grain bullet',
  'expansion',
  'penetration',
  'ergonomic',
  'reliability under',
  'maintenance cycle',
  'proven track record',
  'battle-proven',
  'combat-proven',
  'state-of-the-art',
  'cutting-edge',
] as const;

/**
 * Filler, throat-clearing and self-praise.
 *
 * ⚠️ THESE ARE THE WORDS THAT MAKE A DOCUMENT READ AS GENERATED, and they are
 * worse than merely bland: "I am a law-abiding citizen" and "responsible
 * firearm owner" are UNEVIDENCED CLAIMS about the applicant's character in a
 * document a Registrar checks against a record they already hold, and "peace
 * of mind" and "in case" are the two reasons section 13(2) exists to refuse.
 * MOTIVATION-GUIDE-BOOK Part 8.3.
 */
const SLOP_PHRASES = [
  'in today',
  'it is important to note',
  'it goes without saying',
  'as mentioned above',
  'as stated above',
  'furthermore',
  'moreover',
  'in conclusion',
  'i would like to take this opportunity',
  'kindly',
  'humbly request',
  'your esteemed',
  'at the end of the day',
  'peace of mind',
  'ensure the safety',
  'demonstrating my commitment',
  'showcase',
  'leverage',
  'utilise',
  'in order to',
  'a wide range of',
  'the realities of',
  'these realities',
  'compliance with all regulatory requirements',
  'responsible firearm owner',
  'responsible gun owner',
  'law-abiding',
  'law abiding',
  'in case',
  'you never know',
] as const;

/**
 * Claims about a clean record, which are SAPS's to verify and not ours to make.
 *
 * ⚠️ ITEMS G.62 TO G.67 OF THE SAPS 271 ARE THE DECLARATION, and the CFR checks
 * them against its own record. A motivation that asserts a clean record has
 * volunteered a statement it cannot prove into a document where a false one is
 * an offence under s120(9)(f) — and the reviewer already knows the answer.
 */
const RECORD_CLAIMS = [
  'no criminal record',
  'no previous convictions',
  'never been convicted',
  'clean record',
  'clear record',
  'of sound mind',
  'stable mental',
  'not inclined to violence',
] as const;

/** Predictions and pressure. Rule 3, enforced. */
const OUTCOME_PHRASES = [
  'should succeed',
  'likely to be approved',
  'meets the threshold',
  'must grant',
  'favourable consideration',
  'successful application',
  'entitled to a licence',
  'my right to own',
  'constitutional right',
  'urgently',
  'urgent',
  'judicial review',
  'procedurally unfair',
] as const;

/**
 * Self-defence vocabulary, forbidden on a hunting or sport application.
 *
 * ⚠️ THE MIRROR OF SPORTING_WORDS, AND IT WAS MISSING. `validateReason` has
 * policed these in the ONE reason paragraph since it shipped; nothing policed
 * them anywhere else in a section 15 or 16 document. The exception is the same
 * shape in both directions: a sentence describing a firearm the applicant
 * already holds under section 13 or 14 must be able to say what that licence
 * is for. MOTIVATION-GUIDE-BOOK Part 1 rule 6.
 */
const DEFENCE_VOCAB = [
  'self-defence',
  'self defence',
  'home defence',
  'home-defence',
  'defensive',
  'protection',
  'protect myself',
  'concealed',
  'conceal',
  'backup',
  'back-up',
  'carry on my person',
  'attacker',
  'hijack',
  'intruder',
] as const;

/**
 * Hunting, sport and reloading vocabulary.
 *
 * ⚠️ FORBIDDEN ON AN S13 EXCEPT WHERE IT DESCRIBES A LICENCE ALREADY HELD.
 * The comparison section MUST be able to say "licensed under section 16 for
 * hunting; a section 16 firearm may not be used for self-defence" — that is
 * the whole argument, and it is the strongest paragraph in an S13. So the
 * check is not "does this word appear" but "does it appear in a sentence that
 * is about something other than a firearm the applicant already holds".
 */
const SPORTING_WORDS = [
  'hunting',
  'hunt',
  'quarry',
  'game',
  'sport shooting',
  'sports shooting',
  'competition',
  'competitive',
  'discipline',
  'reloading',
  'handload',
  'target shooting',
  'plinking',
  'culling',
] as const;

/** Reloading, which is never an S13 fact at all. */
const RELOADING_WORDS = ['reload', 'handload', 'propellant', 'primer'] as const;

/** Split into sentences, keeping enough context to judge each one. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const lc = (v: string) => v.toLowerCase();

/** A word-boundary hit, so "programme" does not trip on "program ". */
function contains(haystack: string, needle: string): boolean {
  const n = lc(needle);
  const i = lc(haystack).indexOf(n);
  if (i < 0) return false;
  // Anchored at a word start, exactly as validateReason's `has()` is.
  return i === 0 || !/[a-z0-9]/i.test(haystack[i - 1]);
}

/**
 * How a held firearm is named for matching.
 *
 * The arsenal rows carry make, model and calibre; the writer re-spells all
 * three, so the comparison is by token overlap through `bestFirearmMatch`.
 */
function batteryNames(arsenal: readonly ArsenalRow[]): string[] {
  return arsenal.map((r) =>
    [r.make, r.model, r.type, r.calibre].filter(Boolean).join(' '),
  );
}

export interface ScopeContext {
  licenceType: MotivationLicenceType;
  arsenal: readonly ArsenalRow[];
}

/**
 * Everything the document says that the pack does not support.
 *
 * Returns one plain sentence per fault, naming the offending words, for an
 * operator to read. Empty means the document is in scope.
 */
export function documentScope(text: string, ctx: ScopeContext): string[] {
  const issues: string[] = [];
  const names = batteryNames(ctx.arsenal);
  const byName = new Map(names.map((n, i) => [n, ctx.arsenal[i]]));
  /**
   * ⚠️ SECTION 14 IS A SELF-DEFENCE DOCUMENT AND TAKES THE SAME SCOPE RULES.
   * No hunting, sport, competition or reloading words outside a sentence about
   * a firearm already held under section 15, 16 or 17.
   */
  const isS13 =
    ctx.licenceType === MotivationLicenceType.S13_SELF_DEFENCE ||
    ctx.licenceType === MotivationLicenceType.S14_RESTRICTED_SELF_DEFENCE;
  const isSporting =
    ctx.licenceType === MotivationLicenceType.S15_OCCASIONAL_HUNTER ||
    ctx.licenceType === MotivationLicenceType.S16_DEDICATED_HUNTER ||
    ctx.licenceType === MotivationLicenceType.S16_DEDICATED_SPORT;

  /**
   * ⚠️ FIRST HIT PER PHRASE, NOT EVERY HIT. A document that says "platform"
   * four times has one fault, and reporting it four times buries the other
   * three faults under it in a 500-character failure reason.
   */
  const flag = (msg: string) => {
    if (!issues.includes(msg)) issues.push(msg);
  };

  for (const w of [...CATALOGUE_PHRASES, ...PRODUCT_PAGE_WORDS]) {
    if (contains(text, w)) {
      flag(
        `the document says "${w}", which is catalogue copy rather than a reason`,
      );
    }
  }
  for (const w of AMERICANISMS) {
    if (contains(text, w)) {
      flag(`the document says "${w}" — this is filed in South African English`);
    }
  }
  for (const d of NOT_SOUTH_AFRICAN_DIVISIONS) {
    if (contains(text, d)) {
      flag(`the document names "${d}", which is not shot in South Africa`);
    }
  }
  for (const w of SLOP_PHRASES) {
    if (contains(text, w)) {
      flag(`the document says "${w}" — filler, and it reads as generated`);
    }
  }
  for (const w of RECORD_CLAIMS) {
    if (contains(text, w)) {
      flag(
        `the document claims "${w}"; the SAPS 271 declaration and the CFR settle that, and the motivation must not volunteer it`,
      );
    }
  }
  for (const w of OUTCOME_PHRASES) {
    if (contains(text, w)) {
      flag(
        `the document says "${w}", which predicts or presses for an outcome`,
      );
    }
  }
  /**
   * ⚠️ NO EXCLAMATION MARK AND NO MARKDOWN, EVER. The body is set by pdfkit
   * straight from this text: a stray "**" or "- " prints as itself on a
   * document lodged with the Registrar, and an exclamation mark in a letter to
   * a police official is the register giving way.
   */
  if (text.includes('!')) {
    flag('the document contains an exclamation mark');
  }
  if (/(^|\n)\s*[-*•]\s+/.test(text) || /\*\*|^#{1,6}\s/m.test(text)) {
    flag('the document contains markdown or a bulleted list');
  }

  /**
   * ⚠️ THE SUBJECT CARRIES ACROSS SENTENCES, AND JUDGING ONE AT A TIME REFUSED
   * DOCUMENTS THAT WERE WRITTEN CORRECTLY.
   *
   * Heading 6 is "Firearms already licensed to me", and the book asks for one
   * sentence per firearm on why it cannot do this job. Nobody writes that by
   * repeating the make every time — they name it, then say "It is a centrefire
   * rifle designed for specific shooting disciplines, and its physical form
   * means it cannot be carried on my person."
   *
   * A per-sentence window cannot see that "It" is the Howa named in the
   * sentence before, so the mirror rule below read that as a section 13
   * document reaching for sport vocabulary out of nowhere and refused the
   * whole pack. Measured on MO000074, 2026-09-09: three refusals, every one of
   * them a sentence in heading 6 doing exactly what heading 6 is for.
   *
   * So the subject is remembered WITHIN A PARAGRAPH and reset at the blank
   * line. That is the unit a writer actually works in — one firearm, named,
   * then discussed — and it keeps the rule's teeth: a paragraph that never
   * names a held firearm or its section still gets no sport vocabulary at all.
   */
  for (const para of text.split(/\n\s*\n/)) {
    let heldInParagraph = false;
    for (const s of sentences(para)) {
      const match = bestFirearmMatch(s, names);
      const row = match ? byName.get(match) : undefined;
      if (row || /\bsection\s+1[3-7]\b/i.test(s)) heldInParagraph = true;

      /**
       * ⚠️ A SECTION NAMED FOR A HELD FIREARM MUST BE THE ONE ON ITS CARD.
       * MO000071, section 9: "a MARLIN rifle in .45-70 Government under section
       * 15". The Marlin is a section 16, and a DFO holding the licence copies in
       * Annexure G reads the contradiction off the page. Three of the model's
       * five guesses happened to be right, which is the same defect with a
       * better roll.
       */
      for (const m of s.matchAll(/\bsection\s+(\d{1,2}[A-Z]?)\b/gi)) {
        const said = `section ${m[1].toLowerCase()}`;
        if (!row) continue;
        if (!row.section) {
          flag(
            `the document puts the applicant's ${match} under ${said}, and no licence card established a section for it`,
          );
        } else if (lc(row.section) !== said) {
          flag(
            `the document puts the applicant's ${match} under ${said}; the licence card says ${row.section}`,
          );
        }
      }

      /**
       * ⚠️ AND A PURPOSE IT WAS NEVER GIVEN IS RULE 12'S OWN CRIME. "long-range
       * game harvesting", "dedicated precision sport shooting rifle chambered
       * for extended-range accuracy", "very small pocket calibre intended for
       * specific restricted sport use" — five firearms, five invented roles,
       * none of them supplied by anything.
       */
      /**
       * ⚠️ A GENERATED USE COUNTS AS SOMETHING THE PACK STATES. Operator
       * override, 2026-09-09: candidate uses are now generated per firearm
       * CLASS from the calibre, type, action and section, and attached to the
       * row, so a row carrying `<uses>` DOES have something behind the
       * sentence. Their reasoning, and the Act agrees with it: "The use of the
       * firearm I declare is not set in stone… Main thing is that I do it
       * safely and legally." See firearm-uses.service.ts.
       *
       * ⚠️ A ROW WITH NEITHER STILL REFUSES — the model was down, the calibre
       * was unreadable, the type was blank. Then there really is nothing behind
       * the sentence and this rule stands exactly as written. That is why
       * `forClass` returns [] instead of throwing.
       *
       * ⚠️ THE SECTION IS NOT OVERRIDDEN. The check above, on a section that
       * contradicts the card, is untouched: a section is checkable against a
       * document in the same pack, and a use is not.
       */
      if (
        row &&
        !row.licensedFor &&
        !row.candidateUses?.some((g) => g.uses.length)
      ) {
        for (const w of SPORTING_WORDS) {
          if (contains(s, w)) {
            flag(
              `the document says the applicant's ${match} is for "${w}", and nothing in the pack states what it is licensed for`,
            );
            break;
          }
        }
      }

      /**
       * ⚠️ A COMPETENCY HAS NO PRINTED EXPIRY, SO ANY DATE IS DERIVED. MO000071
       * wrote "competency certificate C9882094 … remains valid until 2026-08-26"
       * into a document dated 9 September 2026 — telling the Registrar, in the
       * applicant's own voice, that the certificate behind the application had
       * lapsed. `applicationBlockers` refuses to generate on a competency that
       * really has expired; this refuses to PRINT a validity date at all.
       */
      if (
        /competenc/i.test(s) &&
        /valid until|expires? on|expiry|remains valid|until \d/i.test(s)
      ) {
        flag(
          'the document states a date until which the competency is valid; a SAPS competency certificate prints no expiry, so any such date is derived',
        );
      }

      /**
       * ⚠️ THE MIRROR RULE. A hunting or sport document carries no self-defence
       * vocabulary either — except where it describes a firearm already held
       * under section 13 or 14, which is exactly the sentence that disposes of
       * the overlap. Same shape as the S13 rule below, same exception, opposite
       * direction.
       */
      if (isSporting) {
        const heldDefensive =
          (row && /section 1[34]/i.test(row.section)) ||
          /\bsection\s+1[34]\b/i.test(s);
        if (!heldDefensive) {
          for (const w of DEFENCE_VOCAB) {
            if (contains(s, w)) {
              flag(
                `a hunting or sport application says "${w}" outside any sentence about a firearm already held under section 13 or 14`,
              );
              break;
            }
          }
        }
      }

      if (!isS13) continue;

      /**
       * ⚠️ S13 SCOPE, JUDGED PER SENTENCE. A self-defence application has no
       * hunting or sport content — except where it is describing a licence the
       * applicant already holds, which is exactly the argument the section is
       * making. A sentence naming a held firearm, or naming section 15 or 16, is
       * allowed the vocabulary; every other sentence is not.
       */
      const aboutHeld =
        !!row || /\bsection\s+1[56]\b/i.test(s) || heldInParagraph;
      if (!aboutHeld) {
        for (const w of SPORTING_WORDS) {
          if (contains(s, w)) {
            flag(
              `a self-defence application says "${w}" outside any sentence about a firearm already held`,
            );
            break;
          }
        }
      }

      /**
       * ⚠️ RELOADING IS NEVER S13 CONTENT, held firearm or not. It is hunting
       * and sport material that reached MO000071 as "experience" because the
       * profile row is asked on every licence type.
       */
      for (const w of RELOADING_WORDS) {
        if (contains(s, w)) {
          flag(`a self-defence application discusses "${w}"`);
          break;
        }
      }
    }
  }

  return issues;
}

/**
 * The S13 word budget.
 *
 * ⚠️ 900–1,400 WORDS OF MOTIVATION. MO000071's body ran about 1,300 including
 * 150 words of product copy and a cartridge section that argued nothing, so
 * the budget holds once those shrink and the exposure section grows. Reported
 * rather than failed: a document 40 words short is not a document a DFO
 * rejects, and failing the run would cost the applicant a pack over a
 * paragraph break.
 */
export const S13_MIN_WORDS = 900;
export const S13_MAX_WORDS = 1400;

/**
 * Fold the Americanisms the writer sometimes reaches for into the spellings
 * this document is filed in.
 *
 * ⚠️ MO000074 WAS THROWN AWAY OVER "organization" AND "specialized". The scope
 * check is right that they do not belong — book rule 3, plain South African
 * usage — but it is a MECHANICAL check, and a mechanical failure costs the
 * applicant the whole pack: one regeneration, the same two words, then FAILED
 * and an SMS reading "we could not finish document MO000074". Two spellings
 * are not a reason to refuse somebody their licence application.
 *
 * ⚠️ THIS CHANGES SPELLING AND NOTHING ELSE. Every pair below is the same word
 * — the -ise/-ize alternation and four nouns SA English spells differently.
 * No fact moves, no sentence is rewritten, nothing is added or dropped. That
 * is what makes it safe to do silently, and it is the only kind of edit that
 * would be.
 *
 * ⚠️ STEMS, NOT WHOLE WORDS, SO EVERY INFLECTION FOLLOWS. "organiz" catches
 * organize, organized, organizing and organization in one pair — the same
 * reason AMERICANISMS is written as stems.
 *
 * ⚠️ AND THE CHECK STAYS. This runs BEFORE it, so the check now fires only on
 * something this could not fix — which is the signal worth having.
 */
const SPELLING: readonly (readonly [RegExp, string])[] = [
  [/\bcaliber\b/gi, 'calibre'],
  [/\bdefense\b/gi, 'defence'],
  [/\boffense\b/gi, 'offence'],
  [/meters\b/gi, 'metres'],
  [/authoriz/gi, 'authoris'],
  [/utiliz/gi, 'utilis'],
  [/recogniz/gi, 'recognis'],
  [/organiz/gi, 'organis'],
  [/analyz/gi, 'analys'],
  [/specializ/gi, 'specialis'],
  [/maximiz/gi, 'maximis'],
  [/minimiz/gi, 'minimis'],
  // The corpus's own word: the association's shooting programme.
  [/\bprogram\b/gi, 'programme'],
];

/** Keep the writer's capitalisation: "Organization" -> "Organisation". */
function likeFor(replacement: string, matched: string): string {
  if (!matched) return replacement;
  return matched[0] === matched[0].toUpperCase()
    ? replacement[0].toUpperCase() + replacement.slice(1)
    : replacement;
}

export function southAfricanise(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SPELLING) {
    out = out.replace(pattern, (m) => likeFor(replacement, m));
  }
  return dropOpeningFiller(out);
}

/**
 * Connectives that can be deleted from the head of a sentence, losing nothing.
 *
 * ⚠️ MO000074 WAS THROWN AWAY OVER ONE OF THESE. A complete 1 432-word section
 * 13 motivation was refused, and the applicant told "we could not finish
 * document MO000074", because a sentence began:
 *
 *   "Furthermore, my daily work commute takes me through high-risk precincts
 *    where violent crime is prevalent."
 *
 * `SLOP_PHRASES` is right that it reads as generated — book Part 8.3 — but the
 * check is MECHANICAL, and a mechanical failure costs the whole pack. Deleting
 * the word costs the sentence nothing at all.
 *
 * ⚠️ FOUR WORDS, AND THE REST OF SLOP_PHRASES STAYS FATAL. This is the line,
 * and it is not "which phrases are worst": it is which can be REMOVED without
 * changing what the sentence says. "Peace of mind", "in case", "law-abiding"
 * and "responsible firearm owner" are CLAIMS sitting inside a sentence — cut
 * them and the sentence means something else, or nothing. Those must still
 * fail, because a document making them is a document that should not be filed.
 *
 * ⚠️ SENTENCE-INITIAL ONLY. "At the end of the day" mid-sentence may be part of
 * a real answer about somebody's routine — a night-shift worker's commute is
 * exactly that — and deleting it there would edit a fact.
 */
const OPENING_FILLER = [
  'furthermore',
  'moreover',
  'in conclusion',
  'at the end of the day',
] as const;

function dropOpeningFiller(text: string): string {
  let out = text;
  for (const phrase of OPENING_FILLER) {
    // Start of the text, or straight after a full stop or a newline.
    const re = new RegExp(
      `(^|[.!?]\\s+|\\n\\s*)${phrase}\\s*,\\s*([a-z])`,
      'gi',
    );
    out = out.replace(re, (_m, lead: string, next: string) => {
      return `${lead}${next.toUpperCase()}`;
    });
  }
  return out;
}
