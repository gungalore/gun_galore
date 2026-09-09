import { answerValue } from '../common/card-placeholder';
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
  put('licensed_for', r.licensedFor);
  put('expires', r.expires);
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
    ...rows.map((r) => r.line),
    '</arsenal>',
  ].join('\n');
}
