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
/**
 * ⚠️ RE-BASELINED A THIRD TIME ON 2026-09-09 — the fixed skeleton.
 *
 * MOTIVATION-GUIDE-BOOK Part 4.2 replaced the seeded heading alternates with
 * twelve numbered headings that never vary, Part 5 said which of them each
 * section of the Act omits, and the calibre section was folded into the
 * firearm section. Three briefs were rewritten to the book (the battery, the
 * record, competency), two were added (association, the renewal's record of
 * use), and the opening / closing / cadence draws collapsed to one value each.
 *
 * ⚠️ AND THE COUNTS MOVED IN BOTH DIRECTIONS, which is the check that this was
 * a restructure and not a loss. The section 13 gained four lines (98 → 102):
 * it got `personal_circumstances` back — the book keeps it and bans the form
 * data that made it read as padding — while losing the calibre section. The
 * section 15 lost five (106 → 101) because the calibre went and nothing
 * replaced it. The two section 16 routes went 102 → 101 for the same reason.
 * Edit these counts only when a line was meant to be added or removed.
 */
/**
 * ⚠️ RE-BASELINED A FIFTH TIME ON 2026-09-09 — the card, and nothing else.
 *
 * MO000075 failed on one word. The `the_firearm` brief asked for "the action,
 * the barrel, the capacity, the mass" and the writer answered with "built on
 * the Howa 1500 platform, utilising a turn-bolt, push-feed repeating action
 * housed in a robust one-piece forged steel receiver" — exactly what that ask
 * invites, and refused by documentScope on "platform".
 *
 * Operator, 2026-09-09: "we dont need the barrel length, capacity or the maas.
 * we need whats on the license card, nothing else." So the invitation is gone
 * rather than the words being banned around it: the firearm is described with
 * the type, make, model and calibre a licence card carries, and the section
 * spends itself on the USE instead of on the object.
 *
 * ⚠️ FOUR TYPES MOVED BY ONE LINE AND TWO DID NOT, which is the check. S13 and
 * S14 carry their own `the_firearm` override — the S14 one already banned
 * product copy in as many words — so they use none of this and are unchanged
 * at 110 and 109. The three sporting types and the renewal use the general
 * brief and each gained the one paragraph.
 */
/**
 * ⚠️ RE-BASELINED A FOURTH TIME ON 2026-09-09 — the capability carve-out.
 *
 * `renderOverlap` gained eight lines telling the writer that terminal
 * ballistics, muzzle energy and velocity, penetration, expansion and bullet
 * weight may be named ONLY in a sentence saying what a firearm already held
 * cannot do — and nowhere else, with magazine capacity banned outright.
 * Operator's decision after being told the words were on the refuse list; see
 * COMPARISON_TERMS in motivation-scope.ts, which enforces the same boundary.
 *
 * ⚠️ AND EVERY TYPE MOVED BY EXACTLY EIGHT, which is the check that this was
 * an addition and not a loss: 101 → 109 on five of them and 102 → 110 on the
 * section 13, whose skeleton is one line longer. The overlap block renders on
 * every type here because every fixture pack carries an overlap note. Edit
 * these counts only when a line was meant to be added or removed.
 */
/**
 * RE-BASELINED A FIFTH TIME ON 2026-09-10 - the brief stopped quoting its own
 * bad example.
 *
 * The general `the_firearm` brief carried a fully formed catalogue sentence,
 * naming a real make and model, as an example of what NOT to write. MO000075
 * came back having rewritten it almost word for word on an application for
 * that very rifle, tripped documentScope on "platform" twice, and the
 * applicant was emailed to say we could not finish their document. The
 * example is now described rather than quoted; see the note on the brief.
 *
 * WHICH TYPES MOVED IS THE CHECK, AND IT IS A SHARP ONE. Section 13 and
 * section 14 carry their OWN `the_firearm` override and use none of the
 * general brief, so their hashes are byte-identical - proof the edit landed
 * where it was aimed and nowhere else. The four types that share the general
 * brief moved their hash and held their line count exactly (110, 110, 110,
 * 104), which is the signature of a rewording rather than an addition. If a
 * future edit here moves a LINE COUNT, that is a different kind of change and
 * wants its own note.
 */
const BEFORE_THE_REORDER: Record<
  MotivationLicenceType,
  { lines: number; sha: string }
> = {
  /**
   * ⚠️ RE-BASELINED TWICE ON 2026-09-09. First the S13 skeleton lost three
   * sections and gained one (below). Then the guide book landed and moved
   * EVERY type: system rule 4 gained the "not every subsection is a test"
   * paragraph naming ss 13(4), 14(6), 15(4) and 16(3); rule 10 gained the
   * no-clean-record rule (SAPS 271 items G.62 to G.67 are the declaration and
   * the CFR checks them); and the conclusion brief was rewritten to the book's
   * Part 8.5 order. All content changes, all baselined rather than weakened.
   *
   * ⚠️ AND THE LINE COUNT MOVED — 106 → 98 on the S13 — WHICH
   * EVERY EARLIER RE-BASELINE DELIBERATELY DID NOT. MOTIVATION-S13-OUTPUT-
   * REVIEW.md §1.5: the S13 skeleton lost `personal_circumstances`,
   * `the_calibre` and `compliance_history` and gained `existing_measures`, so
   * the STRUCTURE block genuinely carries two fewer sections and their briefs.
   * The note above says to edit the counts only when a line was meant to be
   * added or removed; eight were, on purpose.
   */
  /**
   * ⚠️ 99 LINES, ONE MORE THAN THE SECTION 13. Section 14's skeleton keeps
   * `personal_circumstances` — the section 13 dropped it — because SAPS 271
   * section K is completed for this section and no other, and the DFO
   * transcribes the premises facts out of the document.
   */
  S14_RESTRICTED_SELF_DEFENCE: {
    lines: 109,
    sha: '79ab014471c4de1c90a80cdd51c0d62b64cdb98f3e9b32681ade84122231d959',
  },
  S13_SELF_DEFENCE: {
    lines: 110,
    sha: '89b9170f78cdf52bd28c60d8e8a89ab84d1d5c186f9fdb2108e3537f3d2b7233',
  },
  S15_OCCASIONAL_HUNTER: {
    lines: 110,
    sha: 'a27a801ed9b5da7c9e487f6b7919e35ea2c922b138a7af93fca7d6027dcd8d1f',
  },
  S16_DEDICATED_HUNTER: {
    lines: 110,
    sha: '12854c1a7a501e237167a985e5f7761dd2ff9daac19a8c914e04b6df0f037204',
  },
  S16_DEDICATED_SPORT: {
    lines: 110,
    sha: '031890448aa3336f0b27ba6f65db5f0f2322400d3f6c239a77533f3e4bb8361c',
  },
  S24_RENEWAL: {
    lines: 104,
    sha: 'f5b146a9bf2cc5822cded1f2fc14f49ff8499b7106693df61e657ce6e048006c',
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
