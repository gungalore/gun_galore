import { createHash } from 'crypto';
import { MotivationLicenceType } from '@prisma/client';
import {
  FactPack,
  generationSystemPrompt,
  generationUserPrompt,
} from './motivation-prompts';
import { planFor } from './motivation-structure';

// ────────────────────────────────────────────────────────────────────
// THE GENERATION PROMPT MUST STAY CACHEABLE — AND MUST STILL SAY THE SAME
// THING.
//
// The provider discounts a repeated prompt PREFIX by 90%, but only once that
// prefix clears 4 096 tokens. The system prompt alone measures ~4 210-4 280 on
// the chars/4 estimate this file uses — inside the floor, but by so little that
// an ordinary edit could drop it under and switch the discount off silently.
// So the statute block, which is a pure function of the licence type, is sent
// at the HEAD of the user message rather than after the plan.
//
// Two things are pinned here, and they are opposites of each other:
//
//  1. THE PREFIX IS REAL. Two different applicants of the same licence type,
//     on different plan seeds, must produce byte-identical text from the first
//     character up to the first thing that is actually about one of them.
//  2. NOTHING WAS REWORDED TO GET IT. The change that introduced this file
//     REORDERED blocks and nothing else, so the SET of non-empty lines is
//     identical to what the builder produced before it. The hashes below were
//     taken from the pre-reorder builder.
//
// ⚠️ IF A HASH FAILS, ASK WHICH CHANGE YOU MADE. Reordering blocks cannot move
// it; rewording, adding or dropping a line can and should. A deliberate wording
// change updates the hash in the same commit. A hash updated to make a red test
// green is how a rule quietly leaves the prompt.
// ────────────────────────────────────────────────────────────────────

/** The estimate the operator's cache arithmetic is done in. */
const tokens = (chars: number) => Math.round(chars / 4);
const CACHE_FLOOR_TOKENS = 4096;

const TYPES = Object.values(MotivationLicenceType) as MotivationLicenceType[];

/** Two unrelated applicants, so anything per-member shows up as a difference. */
function packFor(licenceType: MotivationLicenceType, who: 'a' | 'b'): FactPack {
  return {
    licenceType,
    answers:
      who === 'a'
        ? {
            full_name: 'Jan Pietersen',
            occupation: 'Security consultant',
            threat_circumstances:
              'I travel between farms after dark.\n\nTwo robberies happened on the R64 last year.',
            firearm_type: 'Handgun',
            firearm_make: 'Glock',
            firearm_model: '19',
            firearm_calibre: '9mm',
            home_telephone: '011 555 0100',
            history_conviction: 'No',
          }
        : {
            full_name: 'Thandi Mokoena',
            occupation: 'Farmer',
            threat_circumstances: 'Different circumstances entirely.',
            firearm_type: 'Rifle',
            firearm_make: 'Tikka',
            firearm_model: 'T3x',
            firearm_calibre: '.308',
          },
    derived: who === 'a' ? { age: '43' } : { age: '29' },
    overlapNote:
      who === 'a'
        ? 'The applicant already holds a handgun under section 13.'
        : undefined,
    research:
      who === 'a'
        ? 'Precinct crime figures for the area, from published sources.'
        : undefined,
    annexures:
      who === 'a'
        ? [
            { letter: 'A', label: 'Identity Document' },
            { letter: 'B', label: 'Competency Certificate' },
          ]
        : undefined,
  };
}

/** How far two strings agree, in characters. */
function sharedPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * The set of non-empty lines, order and blank lines discarded.
 *
 * Order is exactly what the reorder changed, so it must NOT be part of the
 * identity being compared. Everything else — every word of every line, and how
 * many times each appears — must survive.
 */
function contentIdentity(prompt: string): { lines: number; sha: string } {
  const lines = prompt
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .sort();
  return {
    lines: lines.length,
    sha: createHash('sha256').update(lines.join('\n')).digest('hex'),
  };
}

/**
 * Taken from the builder as it stood BEFORE the blocks were reordered, over
 * `packFor(type, 'a')` and `planFor(type, 7)`.
 *
 * ⚠️ RE-BASELINED ONCE, DELIBERATELY, ON 2026-09-07. The conclusion brief
 * carried a worked example reading "a licence under section 16 … for dedicated
 * sport shooting" — correct for one licence type and wrong for the other four,
 * in the one paragraph whose job is to say what is being applied for. Fixing it
 * is a content change, which is exactly what these hashes exist to catch, so
 * the baseline was moved rather than the assertion weakened.
 *
 * The line COUNTS are unchanged in every type, which is the check that the
 * re-baseline was a rewording and not a loss: 106 / 106 / 102 / 102 / 94, the
 * same numbers this table has always held. If you find yourself editing these
 * hashes again, edit the counts only when you meant to add or remove a line.
 *
 * ⚠️ RE-BASELINED AGAIN, TWICE, ON 2026-09-08 — the Motivation Centre rebuild.
 * Phase 1 renamed the two self-defence long boxes (they stopped being the
 * primary input; the applicant taps s13_reasons and s13_movements instead), so
 * S13 alone moved. Phase 2 then halved the word bands on every type — S13
 * 1200-2500 → 900-1400, S15/S16 → 1200-1800, S24 → 600-900 — because roughly
 * 60% of the approved corpus's page count is manufacturer copy and quoted
 * regulation that rule 7 already forbids, and the renderer now prints the
 * particulars and the battery as tables rather than prose. See PROSE_TARGET.
 *
 * Both were content changes and both moved the baseline rather than weakening
 * the assertion. All five line counts held at 106/106/102/102/94 through both.
 */
const BEFORE_THE_REORDER: Record<
  MotivationLicenceType,
  { lines: number; sha: string }
> = {
  /**
   * ⚠️ RE-BASELINED 2026-09-09, AND THE LINE COUNT MOVED — 106 → 98 — WHICH
   * EVERY EARLIER RE-BASELINE DELIBERATELY DID NOT. MOTIVATION-S13-OUTPUT-
   * REVIEW.md §1.5: the S13 skeleton lost `personal_circumstances`,
   * `the_calibre` and `compliance_history` and gained `existing_measures`, so
   * the STRUCTURE block genuinely carries two fewer sections and their briefs.
   * The note above says to edit the counts only when a line was meant to be
   * added or removed; eight were, on purpose.
   */
  S13_SELF_DEFENCE: {
    lines: 98,
    sha: '8fea1dbf6577b0563fdde736831894dbe0775199984cf4a3588c13f60b095c94',
  },
  S15_OCCASIONAL_HUNTER: {
    lines: 106,
    sha: '782aa8f79e49bedb78aafae1b50c5e15911f74490b1fd90b4ea6149cecdbdb09',
  },
  S16_DEDICATED_HUNTER: {
    lines: 102,
    sha: 'f80304303820def343bdfdd3b667b5bbf40da68c742a883017030fba70912dfd',
  },
  S16_DEDICATED_SPORT: {
    lines: 102,
    sha: '78a42e1a8657ca1cebf4da303b2f6d24fd4c5c0c31bc13e134ea03291b4aa3e8',
  },
  S24_RENEWAL: {
    lines: 94,
    sha: '69f5d15abf4a1105b172192801fa00d4f31b9951a235615e8a13a14f52f8c1e8',
  },
};

/**
 * The measured floor for the user message's stable head, in characters.
 *
 * The real figures at the time of writing are 1 781 (s13) to 2 494 (s15) — the
 * lead line, the whole statute block for that type, and the STRUCTURE heading
 * that follows it. This asserts well under the smallest of them: the point is
 * that the statute is up there at all, not that it never gets edited.
 */
const MIN_STABLE_USER_HEAD = 1500;

describe('generation prompt — cacheable prefix', () => {
  it('sends a system prompt that does not vary by applicant', () => {
    for (const t of TYPES) {
      // It takes the licence type and nothing else, which is the whole design:
      // a per-type prefix is still a stable prefix.
      expect(generationSystemPrompt(t)).toBe(generationSystemPrompt(t));
      expect(generationSystemPrompt(t)).not.toContain('Jan Pietersen');
    }
  });

  it('opens the user message with the same text for two different applicants', () => {
    for (const t of TYPES) {
      const a = generationUserPrompt(packFor(t, 'a'), planFor(t, 7));
      const b = generationUserPrompt(packFor(t, 'b'), planFor(t, 99));
      expect(sharedPrefix(a, b)).toBeGreaterThanOrEqual(MIN_STABLE_USER_HEAD);
    }
  });

  it('carries the statute above anything about the applicant', () => {
    for (const t of TYPES) {
      const p = generationUserPrompt(packFor(t, 'a'), planFor(t, 7));
      // The statute is stable per type; the plan's headings, the overlap
      // direction, the research and the facts are not.
      expect(p.indexOf('<statutory-text>')).toBeGreaterThan(-1);
      expect(p.indexOf('<statutory-text>')).toBeLessThan(
        p.indexOf('STRUCTURE — use these headings'),
      );
      expect(p.indexOf('</statutory-text>')).toBeLessThan(
        p.indexOf('<applicant-facts>'),
      );
    }
  });

  it('clears the 4 096-token floor the discount needs, on every licence type', () => {
    for (const t of TYPES) {
      const system = generationSystemPrompt(t);
      const a = generationUserPrompt(packFor(t, 'a'), planFor(t, 7));
      const b = generationUserPrompt(packFor(t, 'b'), planFor(t, 99));
      const prefix = tokens(system.length + sharedPrefix(a, b));
      // ~4 700-4 880 today. The system prompt alone is ~4 210-4 280, so the
      // statute block is what puts the headroom there.
      expect(prefix).toBeGreaterThan(CACHE_FLOOR_TOKENS);
    }
  });
});

describe('generation prompt — the reorder changed no content', () => {
  it('produces the same set of non-empty lines as before the reorder', () => {
    for (const t of TYPES) {
      const p = generationUserPrompt(packFor(t, 'a'), planFor(t, 7));
      expect(contentIdentity(p)).toEqual(BEFORE_THE_REORDER[t]);
    }
  });

  it('still keeps the untrusted-input notice next to the values it is about', () => {
    // Deliberately NOT hoisted with the other stable text — see the note on
    // UNTRUSTED_NOTICE. It is ~60 tokens, so it buys nothing at the front and
    // the adjacency is the whole point of it.
    for (const t of TYPES) {
      const p = generationUserPrompt(packFor(t, 'a'), planFor(t, 7));
      const notice = p.indexOf('UNTRUSTED INPUT');
      const facts = p.indexOf('<applicant-facts>');
      expect(notice).toBeGreaterThan(p.indexOf('</statutory-text>'));
      expect(notice).toBeLessThan(facts);
      // Nothing between them but the notice's own paragraph.
      expect(facts - notice).toBeLessThan(600);
    }
  });
});
