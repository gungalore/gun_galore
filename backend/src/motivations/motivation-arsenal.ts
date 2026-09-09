import { answerValue } from '../common/card-placeholder';
import type { CandidateUses } from './firearm-uses.service';
import { OWNED_ROWS, ownedFirearmSerial, ownedRowTaken } from './motivation-fields';

// ────────────────────────────────────────────────────────────────────
// THE FIREARMS THE APPLICANT ALREADY HOLDS, AS ROWS THE WRITER MAY NAME.
//
// ⚠️ THE WRITER WAS GIVEN A COUNT AND ORDERED TO ARGUE FROM IT. The fact pack
// carried `<derived name="firearms already held">5</derived>` and nothing
// else — no makes, calibres, types, sections or serials — while `overlapNote`
// instructed it to "meet that head on: say what this one does that the one
// held does not". So it invented five firearms' worth of detail to obey an
// instruction it had no data for, including two licence sections. From
// MO000071, section 9: "a MARLIN rifle in .45-70 Government under section 15".
// The Marlin is a section 16. A DFO holding the licence copies in Annexure G
// reads the contradiction off the page.
//
// ⚠️ AND A GUESS THAT IS RIGHT BY CHANCE IS STILL A GUESS. Three of the five
// sections it invented happen to match the cards. That is not a mitigation and
// it is not a partial success; it is the same defect with a better roll.
//
// ⚠️ ONE ARRAY, THREE READERS. This block, the owned-firearms table in the
// printed pack and SAPS 271 item 2.1 must agree serial for serial. They agree
// because they are the same rows.
//
// PURE — no Nest, no Prisma. Sections are resolved by the caller (they need
// the vault) and handed in.
// ────────────────────────────────────────────────────────────────────

export interface ArsenalRow {
  /** 1-based, matching the `existing_firearm_N_` key prefix. */
  index: number;
  make: string;
  model: string;
  type: string;
  calibre: string;
  serial: string;
  /** "section 16", or '' where no licence card established one. */
  section: string;
  /** What the licence or an endorsement says it is FOR, or ''. */
  licensedFor: string;
  /**
   * What a firearm of this CLASS is plausibly used for in South Africa.
   *
   * ⚠️ GENERATED FROM THE CALIBRE, TYPE AND ACTION — NOT READ OFF ANYTHING,
   * AND NOT THE APPLICANT'S OWN WORDS. See firearm-uses.service.ts for the
   * operator's override of guide-book Part 1 rule 7 and the reasoning behind
   * it. `licensedFor` still wins wherever the applicant actually stated a use;
   * this is what the writer cherry-picks from when they did not.
   *
   * ⚠️ ONE ENTRY PER DISCIPLINE, AND THEY ARE NEVER MERGED. A section 15 row
   * carries an occasional-HUNTING list and an occasional-SPORT list, because
   * the card does not say which the applicant holds it for and the two are
   * different arguments. Operator, 2026-09-09: "that would give two lists
   * instead of one consolidated list".
   */
  candidateUses?: CandidateUses[];
  expires: string;
  /** One line, as the prompt renders it. */
  line: string;
}

/**
 * How one row reads in the prompt.
 *
 * ⚠️ ABSENT FIELDS ARE ABSENT, NOT EMPTY STRINGS. A row printed as
 * `section=""` invites the model to fill it; a row with no section attribute
 * at all is a row the rule can be written against — "state its section only
 * where the row carries one".
 */
function renderRow(r: Omit<ArsenalRow, 'line'>): string {
  const bits: string[] = [];
  const put = (k: string, v: string) => {
    if (v) bits.push(`${k}="${v.replace(/"/g, "'")}"`);
  };
  put('make', r.make);
  put('model', r.model);
  put('type', r.type);
  put('calibre', r.calibre);
  put('serial', r.serial);
  put('section', r.section);
  /**
   * ⚠️ AN ABSENT PURPOSE IS SAID OUT LOUD, BECAUSE SILENCE READS AS PERMISSION.
   *
   * `put` omits an empty value, so a row whose purpose nobody stated simply had
   * no `licensed_for` at all — and the writer filled the gap, every time. On
   * MO000074 (2026-09-09) it wrote that the Mauser, the Marlin and the Howa
   * were each "for hunting"; nothing in the pack says so, and `documentScope`
   * refused the document three times over for it.
   *
   * Rule 12 and MOTIVATION-GUIDE-BOOK Part 1 rule 7 both say the same thing:
   * a held firearm's purpose comes from the applicant's stated use or from an
   * endorsement naming that serial, and where neither exists the writer names
   * the firearm and its calibre and says nothing about what it is for. The
   * model cannot follow a rule about an attribute it cannot see is missing.
   *
   * ⚠️ NOT A PURPOSE DERIVED FROM THE SECTION. "Section 16 means dedicated
   * hunting or sport" is true of the Act and is not a fact about THIS licence —
   * which of the two it was issued for is exactly what nobody has stated. The
   * section is already on the row above; naming it is what the writer is for.
   */
  if (r.licensedFor) put('licensed_for', r.licensedFor);
  else if (!r.candidateUses?.some((g) => g.uses.length))
    bits.push(
      'licensed_for="NOT STATED — say nothing about what this firearm is for; ' +
        'name it, its calibre and its section, and stop"',
    );
  put('expires', r.expires);
  /**
   * ⚠️ THE CANDIDATE USES, AND ONLY WHERE THE APPLICANT STATED NOTHING.
   *
   * A use the applicant actually gave is the better fact and needs no help;
   * offering alternatives beside it would invite the writer to pick a nicer one
   * than the truth. So `licensed_for` wins outright and these are what the
   * writer works from when there is nothing to win against.
   *
   * See firearm-uses.service.ts for whose decision this is and why.
   */
  const groups = (r.candidateUses ?? []).filter((g) => g.uses.length);
  if (!r.licensedFor && groups.length) {
    const lists = groups
      .map((g) => {
        const uses = g.uses
          .map((u) => `      <use>${u.replace(/[<>]/g, '')}</use>`)
          .join('\n');
        const label = g.label.replace(/["<>]/g, '');
        return `    <uses for="${label}">\n${uses}\n    </uses>`;
      })
      .join('\n');
    return `<firearm ${bits.join(' ')}>\n${lists}\n  </firearm>`;
  }
  return `<firearm ${bits.join(' ')}/>`;
}

/**
 * The rows, read off the application's own answers.
 *
 * @param sections row index → "section 16", from the member's licence cards.
 *                 A row with no entry carries no section, deliberately.
 */
/**
 * A tapped `section_held` card key as the paragraph writes it.
 *
 * Returns undefined when nothing was tapped, so the caller can fall through to
 * the vault; returns '' for "I am not sure", which is a stated answer and must
 * NOT fall through.
 */
function sectionFromAnswer(key: string): string | undefined {
  if (!key) return undefined;
  if (key === 'unsure') return '';
  const m = /^section_(\d{2})$/.exec(key);
  return m ? `section ${m[1]}` : undefined;
}

export function arsenalRows(
  answers: Record<string, string>,
  sections: Record<number, string> = {},
  /**
   * Row index → the uses a firearm of that class is suited to.
   *
   * ⚠️ RESOLVED BY THE CALLER, LIKE `sections`, AND FOR THE SAME REASON: this
   * module is pure and the lookup needs Prisma and a model. See
   * firearm-uses.service.ts.
   */
  uses: Record<number, CandidateUses[]> = {},
): ArsenalRow[] {
  const out: ArsenalRow[] = [];
  for (let n = 1; n <= OWNED_ROWS; n++) {
    if (!ownedRowTaken(answers, n)) continue;
    const p = `existing_firearm_${n}_`;
    const a = (col: string) => answerValue(answers[`${p}${col}`] ?? '').trim();

    const row = {
      index: n,
      make: a('make'),
      model: a('model'),
      type: a('type'),
      calibre: a('calibre'),
      serial: ownedFirearmSerial(answers, n),
      /**
       * ⚠️ THE MEMBER'S ANSWER BEATS THE VAULT LOOKUP, AND THE ORDER MATTERS.
       * `existing_firearm_N_section_held` is filled from the licence card by
       * credentialOffer and can then be CORRECTED by the member — a bad OCR on
       * one card is exactly the case the row exists for. Reading the vault
       * first would overwrite that correction on every generation and the
       * member would never find out why.
       *
       * ⚠️ AND "I am not sure" IS AN ANSWER, NOT A GAP. It resolves to no
       * section, so the prompt forbids the claim and the validator refuses one
       * — which is the correct output, and better than falling through to a
       * vault row that may be about a different firearm entirely.
       */
      section: sectionFromAnswer(a('section_held')) ?? sections[n] ?? '',
      /**
       * ⚠️ ONLY WHAT SOMETHING STATED. `primary_use` is the member's own words
       * or a card they tapped; an endorsement fills it too once §5.5a lands.
       * Where it is empty the row says nothing about purpose and the prompt
       * forbids the writer supplying one — which is rule 12, enforced by
       * absence rather than by hope.
       */
      licensedFor: a('use') || a('primary_use'),
      candidateUses: uses[n],
      expires: a('expiry'),
    };
    // A row with nothing nameable on it is not evidence of a firearm.
    if (!row.make && !row.calibre && !row.serial) continue;
    out.push({ ...row, line: renderRow(row) });
  }
  return out;
}

/**
 * The `<arsenal>` block, or '' when the applicant holds nothing.
 *
 * ⚠️ AN EMPTY BLOCK IS NOT SENT. A first-time applicant holds no firearms, and
 * a block reading "<arsenal></arsenal>" is an invitation to explain the
 * absence. The prompt's comparison section is already conditional on the
 * overlap; this matches it.
 */
export function arsenalBlock(rows: readonly ArsenalRow[]): string {
  if (!rows.length) return '';
  return [
    '<arsenal>',
    'Every firearm the applicant holds, exactly as read from their licences.',
    'A field that is absent was not read and must NOT be supplied: name the',
    'firearm with what is here and stop. State a section only where the row',
    'carries one. Never describe a section 15 or 16 firearm with self-defence,',
    'protection, carry, backup or home-defence words.',
    'A row may carry one or more <uses for="…"> lists. Those are uses a',
    'firearm of that CLASS is suited to in South Africa — not the applicant’s',
    'own words, and not read off any document.',
    'A section 15 or 16 row carries TWO lists, one for hunting and one for',
    'sport, because the licence card does not say which the applicant holds it',
    'for. CHOOSE THE LIST FIRST — the one consistent with the rest of this',
    'document — and then ONE sentence from inside it. Never mix the two lists',
    'for one firearm, never use more than one sentence per firearm, never list',
    'them, and never contradict the section on the row.',
    ...rows.map((r) => r.line),
    '</arsenal>',
  ].join('\n');
}
