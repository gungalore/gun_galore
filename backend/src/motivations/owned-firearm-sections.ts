import { MotivationLicenceType } from '@prisma/client';
import { sectionFromText, type LicenceSection } from '../common/sa-competency';
import { answerValue } from '../common/card-placeholder';
import { OWNED_ROWS } from './motivation-fields';

// ────────────────────────────────────────────────────────────────────
// WHICH SECTION IS EACH FIREARM THE APPLICANT ALREADY OWNS LICENSED UNDER?
//
// ⚠️ IT EXISTS BECAUSE THE REASON GENERATOR STATED ONE IT WAS NEVER GIVEN.
// The arsenal handed to the model carries make, model, calibre, type, serial
// and expiry — and no section. The prompt then told it to name "the section it
// is licensed under" for every held firearm, so it did the only thing it
// could: it took the section of the APPLICATION and wrote "all licensed under
// section 16". The operator's Howa 6.5mm Creedmoor is section 15.
//
// That is rule 12's own crime — asserting a fact nobody supplied — written
// into the prompt by hand. A wrong section on a signed motivation tells the
// Registrar the applicant does not know what their own licences say.
//
// ⚠️ THE VAULT HAS ALWAYS KNOWN. `section` is in WANTED.FIREARM_LICENCE and
// has been read off every licence card the member has scanned since the
// Licence Centre shipped. Nothing joined it to the owned-firearm rows.
//
// ⚠️ SERIAL ONLY, AND NEVER MAKE-AND-CALIBRE. Two of a member's firearms can
// share a make and a calibre — the corpus's own example battery holds four
// 9mm handguns — and picking the wrong one writes the wrong section, which is
// the exact failure this module exists to stop. A row whose serial we cannot
// match simply has no section, and the prompt then forbids the claim.
//
// PURE — no Nest, no Prisma, no clock.
// ────────────────────────────────────────────────────────────────────

/** A licence card as the vault read it. */
export interface LicenceDetails {
  /** The `details` blob: section, frame_serial, barrel_serial, make, … */
  details: Record<string, string>;
}

/** How a section is written in the paragraph. */
export function sectionPhrase(s: LicenceSection): string {
  // "S16A" is section 16A; the rest are plain numbers. S20's two values name a
  // permit rather than a section and are not written as one.
  if (s.startsWith('S20')) return '';
  return `section ${s.slice(1)}`;
}

/** Serial comparison: case and punctuation are transcription noise. */
const norm = (v: string) =>
  answerValue(v ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/** Every serial a licence card prints. A card usually repeats one number. */
function serialsOf(details: Record<string, string>): string[] {
  return ['serial', 'frame_serial', 'barrel_serial', 'receiver_serial']
    .map((k) => norm(details[k] ?? ''))
    .filter(Boolean);
}

/**
 * Section per owned-firearm row, for the rows we can actually prove one for.
 *
 * @returns row index (1-based) → "section 15". Rows with no serial, no match,
 *          or an unreadable section are ABSENT — never guessed.
 */
export function ownedFirearmSections(
  answers: Record<string, string>,
  licences: readonly LicenceDetails[],
): Record<number, string> {
  const bySerial = new Map<string, string>();
  for (const l of licences) {
    const section = sectionFromText(l.details?.section);
    if (!section) continue;
    const phrase = sectionPhrase(section);
    if (!phrase) continue;
    for (const s of serialsOf(l.details ?? {})) {
      // ⚠️ FIRST CARD WINS, AND A CONFLICT IS DROPPED. Two cards claiming
      // different sections for one serial means one of them was misread, and
      // writing either is a coin toss on somebody's application.
      const seen = bySerial.get(s);
      if (seen === undefined) bySerial.set(s, phrase);
      else if (seen !== phrase) bySerial.set(s, '');
    }
  }

  const out: Record<number, string> = {};
  for (let n = 1; n <= OWNED_ROWS; n++) {
    const p = `existing_firearm_${n}_`;
    for (const col of ['serial', 'barrel_serial', 'frame_serial']) {
      const s = norm(answers[`${p}${col}`] ?? '');
      if (!s) continue;
      const phrase = bySerial.get(s);
      if (phrase) {
        out[n] = phrase;
        break;
      }
    }
  }
  return out;
}

/**
 * The section number this application itself is lodged under.
 *
 * ⚠️ ALWAYS ALLOWED IN THE PARAGRAPH, because the closing sentence names it —
 * "Applying under section 16 as a dedicated sport shooter". Every OTHER
 * section a paragraph mentions is a claim about a firearm the applicant
 * already holds, and must come off that firearm's own licence card.
 *
 * ⚠️ A RENEWAL IS LODGED UNDER SECTION 24 AND SAYS SO. What it does not know
 * is the section of the licence being renewed, which is not held as a
 * structured value — that firearm's section comes from its card like any
 * other.
 */
export function appliedSectionNumber(t: MotivationLicenceType): string {
  switch (t) {
    case MotivationLicenceType.S13_SELF_DEFENCE:
      return '13';
    case MotivationLicenceType.S15_OCCASIONAL_HUNTER:
      return '15';
    case MotivationLicenceType.S16_DEDICATED_HUNTER:
    case MotivationLicenceType.S16_DEDICATED_SPORT:
      return '16';
    case MotivationLicenceType.S24_RENEWAL:
      return '24';
    default:
      return '';
  }
}
