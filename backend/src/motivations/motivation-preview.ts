import { MotivationLicenceType } from '@prisma/client';
import { CARD_SETS } from './motivation-cards';
import { LICENCE_TYPE_LABELS, OWNED_ROWS } from './motivation-fields';
import { answerValue } from '../common/card-placeholder';

// ────────────────────────────────────────────────────────────────────
// "WHAT YOUR MOTIVATION WILL SAY" — the live preview under the sheet.
//
// ⚠️ NO MODEL CALL, EVER, AND THAT IS THE POINT. This runs on every saved
// answer, debounced, so a member can watch a tapped card turn into a sentence.
// A model call there would cost real money per keystroke, take seconds, and —
// worst of the three — produce DIFFERENT prose each time, so the member would
// watch the document rewrite itself around them and learn to distrust it.
//
// ⚠️ IT IS A PREVIEW, NOT A DRAFT, AND THE DIFFERENCE IS STATED ON SCREEN.
// What the writer eventually produces is argument; this is the ledger of facts
// that argument will be built from, in the writer's section order. Nothing
// here is ever stored, rendered into a PDF, or shown to the Registrar.
//
// ⚠️ IT MAY ONLY REPEAT WHAT IT IS GIVEN. Every sentence below is either a
// tapped card (the applicant's own words, verbatim) or a stored answer
// interpolated into fixed template text. It never infers, never fills a gap
// and never softens an absence — a section we hold nothing for says so, and
// the sheet renders that line faint so the member can see what is still
// missing. Inventing a plausible sentence here would teach somebody their
// application is further along than it is.
// ────────────────────────────────────────────────────────────────────

/** One section of the preview, in the order the document runs. */
export interface PreviewSection {
  /** Matches motivation-structure.ts's SectionId where one exists. */
  id: string;
  heading: string;
  /**
   * The paragraphs we can already write, in order. Empty when we hold nothing
   * for this section — the sheet then renders `placeholder`.
   */
  paragraphs: string[];
  /**
   * What this section will say once it has something to say. Rendered faint
   * and italic; never mistaken for content, never empty.
   */
  placeholder: string;
  /**
   * The sentences in `paragraphs` that came from a card the member tapped.
   *
   * ⚠️ THE SHEET MARKS THESE, AND THAT IS THE FEEDBACK LOOP THE WHOLE PREVIEW
   * EXISTS FOR. A member taps a tile and sees that exact sentence appear,
   * highlighted, in the document. Without it the preview is a wall of text
   * that happens to change.
   */
  fromCards: string[];
}

const NOTHING_YET = 'Nothing here yet.';

/** Trim, drop placeholders, and treat whitespace as absent. */
function val(answers: Record<string, string>, key: string): string {
  return answerValue(answers[key] ?? '').trim();
}

/**
 * The sentences behind a stored `cards` answer.
 *
 * ⚠️ BY KEY, AGAINST THE CARD SET — AN UNKNOWN KEY IS SKIPPED, NOT PRINTED.
 * A stored value we no longer offer (an option the operator retired) must not
 * reach the preview as a raw slug like `precinct_crime`. Skipping it shows the
 * member one fewer sentence, which is honest; printing the key would be the
 * document talking to itself.
 */
export function cardSentences(
  answers: Record<string, string>,
  key: string,
  setName = key,
): string[] {
  const set = CARD_SETS[setName];
  if (!set) return [];
  const chosen = (answers[key] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const k of chosen) {
    const found = set.find((o) => o.key === k);
    if (found) out.push(found.sentence);
  }
  return out;
}

function section(
  id: string,
  heading: string,
  placeholder: string,
  paragraphs: (string | null | undefined)[],
  fromCards: string[] = [],
): PreviewSection {
  return {
    id,
    heading,
    placeholder,
    paragraphs: paragraphs.filter((p): p is string => !!p && !!p.trim()),
    fromCards,
  };
}

/** "a, b and c" — never "a, b, c" and never an Oxford comma. */
function list(items: string[]): string {
  const clean = items.filter(Boolean);
  if (!clean.length) return '';
  if (clean.length === 1) return clean[0];
  return `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`;
}

/** The owned firearms we hold enough about to name. */
function ownedLines(answers: Record<string, string>): string[] {
  const out: string[] = [];
  for (let n = 1; n <= OWNED_ROWS; n++) {
    const p = `existing_firearm_${n}_`;
    const make = val(answers, `${p}make`);
    const model = val(answers, `${p}model`);
    const calibre = val(answers, `${p}calibre`);
    if (!make && !model && !calibre) continue;
    const named = [make, model].filter(Boolean).join(' ');
    const uses = cardSentences(answers, `${p}primary_use`, 'primary_use');
    const use = uses.length
      ? uses[0].replace(/^I /, '').replace(/\.$/, '')
      : val(answers, `${p}use`);
    const head = [named, calibre && `in ${calibre}`].filter(Boolean).join(' ');
    out.push(use ? `${head}, which I ${use}` : head);
  }
  return out;
}

/**
 * The whole preview for one application.
 *
 * Deterministic: the same answers always produce the same text, which is what
 * lets a spec assert it and what stops the document appearing to change its
 * mind while somebody is reading it.
 */
export function buildPreview(
  licenceType: MotivationLicenceType,
  answers: Record<string, string>,
): PreviewSection[] {
  const name = val(answers, 'full_name');
  const idNumber = val(answers, 'id_number');
  const address = val(answers, 'residential_address');
  const occupation = val(answers, 'occupation');
  const employer = val(answers, 'employer_name');

  const type = val(answers, 'firearm_type');
  const make = val(answers, 'firearm_make');
  const model = val(answers, 'firearm_model');
  const calibre = val(answers, 'firearm_calibre');
  const firearm = [make, model].filter(Boolean).join(' ');

  const out: PreviewSection[] = [];

  // ── Introduction ────────────────────────────────────────────────
  //
  // Fixed, because every approved pack on file opens the same way: name, ID,
  // address, occupation, then one sentence naming the firearm and the section.
  // The two randomised openings that used to alternate here are gone —
  // MOTIVATION-UX-REVIEW.md §3.5.
  out.push(
    section(
      'introduction',
      'Personal details',
      'Your name, ID number and address open the motivation. We take them from your documents.',
      [
        name && idNumber
          ? `I am ${name}, identity number ${idNumber}.`
          : name
            ? `I am ${name}.`
            : null,
        address ? `I reside at ${address}.` : null,
        occupation
          ? employer
            ? `I am employed as ${occupation} at ${employer}.`
            : `I work as ${occupation}.`
          : null,
        firearm || calibre
          ? `I apply under ${LICENCE_TYPE_LABELS[licenceType]} for a ${[firearm, calibre && `in ${calibre}`].filter(Boolean).join(' ')}.`
          : null,
      ],
    ),
  );

  // ── The case, by licence type ───────────────────────────────────
  if (licenceType === MotivationLicenceType.S13_SELF_DEFENCE) {
    const reasons = cardSentences(answers, 's13_reasons');
    const movements = cardSentences(answers, 's13_movements');
    const carry = cardSentences(answers, 's13_carry_style');
    const station = val(answers, 'police_station');
    out.push(
      section(
        'the_threat',
        'My circumstances',
        'Tap the circumstances that are true of you and they appear here, in your own words.',
        [
          ...reasons,
          station ? `My nearest police station is ${station}.` : null,
          ...movements,
          ...carry,
          val(answers, 'threat_circumstances'),
        ],
        [...reasons, ...movements, ...carry],
      ),
    );
  } else if (licenceType === MotivationLicenceType.S24_RENEWAL) {
    out.push(
      section(
        'experience',
        'The licence I hold',
        'The licence number and expiry come off your card. Nothing here is typed.',
        [
          val(answers, 'existing_licence_number')
            ? `I hold licence ${val(answers, 'existing_licence_number')}, which expires on ${val(answers, 'licence_expiry') || 'a date on the card'}.`
            : null,
          val(answers, 'continued_use'),
        ],
      ),
    );
  } else {
    const game = cardSentences(answers, 'hunt_game_class');
    const terrain = cardSentences(answers, 'hunt_terrain');
    const where = cardSentences(answers, 'hunt_where');
    const why = cardSentences(answers, 'hunt_reasons');
    const sport = cardSentences(answers, 'sport_reasons');
    const formats = cardSentences(answers, 'sport_formats');
    const cards = [...game, ...terrain, ...where, ...why, ...sport, ...formats];
    out.push(
      section(
        game.length || !sport.length ? 'the_quarry' : 'the_discipline',
        'What I hunt and shoot',
        'Tap what you hunt or shoot and it appears here. We fill in the species and the ranges.',
        [...cards, val(answers, 'hunting_history'), val(answers, 'competition_record')],
        cards,
      ),
    );
  }

  // ── Competency ──────────────────────────────────────────────────
  const competencyFor = val(answers, 'competency_for');
  out.push(
    section(
      'experience',
      'My competency',
      'Read off your competency certificate. Nothing to type.',
      [
        val(answers, 'competency_number')
          ? `I hold competency certificate ${val(answers, 'competency_number')}${competencyFor ? `, endorsed for ${competencyFor}` : ''}${val(answers, 'competency_issued') ? `, issued on ${val(answers, 'competency_issued')}` : ''}.`
          : null,
      ],
    ),
  );

  // ── The firearm and the calibre ─────────────────────────────────
  out.push(
    section(
      'the_firearm',
      'The firearm applied for',
      'Read off the licence card, the invoice or the advert you uploaded.',
      [
        firearm
          ? `The firearm is a ${[type && type.toLowerCase(), firearm].filter(Boolean).join(' ')}${calibre ? ` in ${calibre}` : ''}.`
          : null,
        val(answers, 'firearm_fit_reason'),
      ],
    ),
  );

  // ── What they already hold, and how this one differs ────────────
  const owned = ownedLines(answers);
  const angles = cardSentences(answers, 'overlap_angle');
  out.push(
    section(
      'held_firearms',
      'Firearms I already own',
      'The firearms on your licences, with what each one is for.',
      [
        owned.length ? `I already hold ${list(owned)}.` : null,
        ...angles,
        val(answers, 'overlap_justification'),
      ],
      angles,
    ),
  );

  // ── Security and storage ────────────────────────────────────────
  const security: string[] = [];
  const enclosure = val(answers, 'premises_enclosure');
  const access = val(answers, 'premises_access_control');
  if (enclosure) security.push(enclosure.toLowerCase());
  if (access) security.push(access.toLowerCase());
  if (val(answers, 'alarm_present') === 'Yes') {
    const company = val(answers, 'alarm_company');
    security.push(company ? `an alarm monitored by ${company}` : 'an alarm');
  }
  if (val(answers, 'armed_response') === 'Yes') security.push('armed response');
  if (val(answers, 'burglar_bars') === 'Yes') security.push('burglar bars');
  if (val(answers, 'security_gates') === 'Yes') security.push('security gates');

  const safeType = val(answers, 'safe_type');
  const mountedTo = val(answers, 'safe_mounted_to');
  out.push(
    section(
      'storage_safety',
      'Security and safe storage',
      'Tap what your property has and we write this paragraph for you.',
      [
        security.length ? `My property has ${list(security)}.` : null,
        safeType
          ? `The firearm will be stored in a ${safeType.toLowerCase()}${mountedTo ? `, fixed to the ${mountedTo.toLowerCase() === 'both' ? 'wall and the floor' : mountedTo.toLowerCase()}` : ''}.`
          : null,
        val(answers, 'safe_key_holder') === 'Only me'
          ? 'I am the only person who can open it.'
          : null,
        val(answers, 'safe_storage_detail'),
      ],
    ),
  );

  // ── The statutory section ───────────────────────────────────────
  out.push(
    section(
      'statutory_application',
      'Application under the Act',
      'We quote the section you are applying under and answer each of its requirements with your facts.',
      [],
    ),
  );

  // ── History ─────────────────────────────────────────────────────
  //
  // ⚠️ A CLEAN RECORD PRODUCES NO PARAGRAPH, HERE AS EVERYWHERE ELSE. Six "No"
  // answers are not an argument and printing them would be padding — ABSOLUTE
  // RULE 7, and the same reasoning that puts the six yes/no keys in
  // NEVER_PROMPTED. A disclosure, by contrast, always shows: it is the one
  // thing the document must meet head-on.
  const disclosures = [
    val(answers, 'history_conviction_detail'),
    val(answers, 'history_pending_case_detail'),
    val(answers, 'history_lost_stolen_detail'),
    val(answers, 'history_negligence_detail'),
    val(answers, 'history_declared_unfit_detail'),
    val(answers, 'history_confiscated_detail'),
  ].filter(Boolean);
  out.push(
    section(
      'compliance_history',
      'My record',
      'Answer the six declaration questions. A "no" adds nothing here — only something you disclose does.',
      disclosures,
    ),
  );

  out.push(
    section(
      'conclusion',
      'Conclusion',
      'We close the motivation once the rest of it is written.',
      [],
    ),
  );

  return out;
}

/**
 * The preview as the drawer wants it: every section, none dropped.
 *
 * ⚠️ AN EMPTY SECTION IS KEPT, DELIBERATELY. The drawer is also a map of what
 * the document will contain, so a member scrolling it can see that "The
 * calibre" is a section they will never have to write. Dropping empties would
 * make the preview grow section headings as they answered, which reads as the
 * document being invented around them.
 */
export function previewFor(
  licenceType: MotivationLicenceType,
  answers: Record<string, string>,
): { sections: PreviewSection[]; empty: boolean } {
  const sections = buildPreview(licenceType, answers);
  return {
    sections,
    empty: sections.every((s) => s.paragraphs.length === 0),
  };
}

export { NOTHING_YET };
