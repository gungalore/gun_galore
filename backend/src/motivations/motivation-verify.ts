// ────────────────────────────────────────────────────────────────────
// MECHANICAL VERIFICATION OF A BUILT DOCUMENT.
//
// The writer is a model; the pack is a legal submission. Between the two sit
// checks that must never be probabilistic: the serial number on the cover of
// a motivation IS the firearm being licensed, an annexure letter cited in the
// body IS a promise about what the DFO will find behind the tab, and the ID
// number is the applicant. A model verifier opines on these; this module
// KNOWS, for free, deterministically.
//
// This is the cheap half of the pipeline's verification pair — the model
// half is MotivationClaudeService.verifyDocument(). Two verifiers per
// document, per the operator, and not more.
// ────────────────────────────────────────────────────────────────────

import { readSaId } from './sa-id';

export interface AnnexureRef {
  letter: string;
  label: string;
}

/** Every annexure letter the document cites: "Annexure D", "(Annexure K: …)". */
export function citedAnnexures(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\bAnnexure\s+([A-Z])\b/g)) out.add(m[1]);
  return [...out].sort();
}

/** Digits only — how two renderings of one ID number are compared. */
const digits = (v: string) => v.replace(/\D+/g, '');

/**
 * Squash to a comparable token: lowercase, no spaces or punctuation. The same
 * calibre arrives as "6.35 mm Browning", "6,35mm Browning" and ".223 REM" /
 * "223 Rem" depending on who typed it — the letters and digits are the
 * identity, the furniture is not.
 */
const squash = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Everything the applicant actually told us, as one searchable body of text. */
const answerText = (answers: Record<string, string>) =>
  Object.values(answers)
    .filter((v) => typeof v === 'string' && v.trim())
    .join('\n');

// ── DATES ─────────────────────────────────────────────────────────────
//
// The approved corpus contains "a member in good standing with KSSC since
// 11 July 1905". It passed SAPS. It must never leave here: a date from before
// the applicant existed is not a quality problem a reviewer forgives, it is
// proof nobody read the document.

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const MONTH_INDEX = new Map<string, number>(
  MONTH_NAMES.flatMap((name, i): [string, number][] => [
    [name.toLowerCase(), i],
    [name.slice(0, 3).toLowerCase(), i],
  ]),
);
// The one abbreviation nobody writes with three letters.
MONTH_INDEX.set('sept', 8);

const MS_PER_DAY = 86_400_000;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

const prettyDate = (d: Date) =>
  `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

/**
 * A real calendar date, or null.
 *
 * Rejects a rolled-over date the way sa-id.ts does — left alone, 31 February
 * silently becomes 3 March and an impossible date reads as a possible one.
 */
function utcDate(year: number, month: number, day: number): Date | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month, day));
  return d.getUTCFullYear() === year &&
    d.getUTCMonth() === month &&
    d.getUTCDate() === day
    ? d
    : null;
}

interface FoundDate {
  /** Exactly as the text renders it, so the issue names what to go and look at. */
  raw: string;
  /** Where it sits, so the sentence around it can be read. */
  at: number;
  /**
   * Every defensible reading of `raw`. "07/03/2019" is 7 March to a South
   * African and 3 July to an American, and the writer is a model trained on
   * both — so a numeric date is condemned only when EVERY reading of it is
   * impossible. Ambiguity must never cost a customer their document.
   */
  candidates: Date[];
}

/**
 * Full calendar dates, in the renderings a motivation actually uses.
 *
 * ⚠️ DAY, MONTH AND YEAR, OR NOTHING. A bare year is deliberately not a date
 * here: "the Firearms Control Act 60 of 2000" and "the 2023/24 crime
 * statistics" are the commonest four-digit numbers in these documents, and
 * neither is a claim about when something happened to the applicant.
 */
function datesIn(text: string): FoundDate[] {
  const found: FoundDate[] = [];
  const push = (raw: string, at: number, ...candidates: (Date | null)[]) => {
    const real = candidates.filter((d): d is Date => d !== null);
    if (real.length) found.push({ raw, at, candidates: real });
  };

  // "11 July 1905", "11th July 1905", "this 22nd day of August 2026".
  for (const m of text.matchAll(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:day\s+of\s+)?([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/g,
  )) {
    const month = MONTH_INDEX.get(m[2].toLowerCase());
    if (month === undefined) continue;
    push(m[0], m.index ?? 0, utcDate(Number(m[3]), month, Number(m[1])));
  }

  // "July 11, 1905" — the American order, which a model emits unprompted.
  for (const m of text.matchAll(
    /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g,
  )) {
    const month = MONTH_INDEX.get(m[1].toLowerCase());
    if (month === undefined) continue;
    push(m[0], m.index ?? 0, utcDate(Number(m[3]), month, Number(m[2])));
  }

  // ISO — how the wizard stores every date answer.
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    push(
      m[0],
      m.index ?? 0,
      utcDate(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
    );
  }

  // "11/07/1905". Same separator both times, four-digit year: a two-digit
  // year cannot be told from a page number and is not worth the guess.
  for (const m of text.matchAll(/\b(\d{1,2})([/.-])(\d{1,2})\2(\d{4})\b/g)) {
    const [a, b, year] = [Number(m[1]), Number(m[3]), Number(m[4])];
    push(m[0], m.index ?? 0, utcDate(year, b - 1, a), utcDate(year, a - 1, b));
  }

  return found;
}

/** The sentence position `at` sits in, bounded by a full stop or a line break. */
function sentenceAt(text: string, at: number): string {
  const opens = Math.max(
    text.lastIndexOf('.', at - 1),
    text.lastIndexOf('\n', at - 1),
  );
  const closes = [text.indexOf('.', at), text.indexOf('\n', at)].filter(
    (i) => i >= 0,
  );
  return text.slice(opens + 1, Math.min(...closes, text.length));
}

/**
 * ⚠️ NOT EVERY DATE IS A CLAIM ABOUT THE APPLICANT. "The Firearms Control Act
 * 60 of 2000 came into operation on 1 July 2004" predates a 21-year-old
 * applicant and is nonetheless true. A sentence that cites the law and says
 * nothing in the first person is talking about the law, not about a life.
 *
 * The first-person half is what keeps the real defect in scope: the corpus's
 * "member in good standing with KSSC since 11 July 1905" sits in an "I am"
 * sentence, and a bulleted "Membership: KSSC since 11 July 1905" cites no
 * statute at all.
 */
const STATUTE_SENTENCE = /\b(?:Act|Regulations?|Gazette|Constitution)\b/;
const FIRST_PERSON = /\b(?:I|me|my|mine)\b/;

// ── MAKES ─────────────────────────────────────────────────────────────
//
// ⚠️ TEMPLATE ROT. The approved corpus contains a "History of CZ" section
// inside a Glock motivation — a dealer's template with the brand essay left
// behind. SAPS approved it anyway; a DFO who notices reads the entire pack as
// boilerplate, and everything true in it with it.

/**
 * Manufacturers common enough in South Africa to headline somebody's
 * boilerplate. This is a rot detector, not a catalogue: a make missing from
 * this list costs nothing, and an ordinary English word added to it costs a
 * customer a failed document.
 */
const FIREARM_MAKES = [
  'Accuracy International',
  'Anschutz',
  'Arex',
  'Barrett',
  'Benelli',
  'Beretta',
  'Bergara',
  'Blaser',
  'Brno',
  'Browning',
  'Canik',
  'Christensen Arms',
  'Colt',
  'CZ',
  'Fabarm',
  'FN',
  'Franchi',
  'Glock',
  'Heckler & Koch',
  'Heym',
  'Howa',
  'Kimber',
  'Krieghoff',
  'Marlin',
  'Mauser',
  'Merkel',
  'Mossberg',
  'Musgrave',
  'Norinco',
  'Perazzi',
  'Remington',
  'Rigby',
  'Rizzini',
  'Rossi',
  'Ruger',
  'Sabatti',
  'Sako',
  'Savage',
  'Sig Sauer',
  'Smith & Wesson',
  'Springfield',
  'Steyr',
  'Stoeger',
  'Taurus',
  'Tikka',
  'Uberti',
  'Vektor',
  'Walther',
  'Weatherby',
  'Weihrauch',
  'Winchester',
  'Zastava',
];

/**
 * How many times a make the FactPack never mentions has to appear in BODY
 * TEXT before it counts as rot rather than argument.
 *
 * ⚠️ DELIBERATELY HIGH. A passing mention of another marque is ordinary
 * reasoning — "the Production division is dominated by the Glock 17, whose
 * trigger is lighter than mine" inside a CZ motivation is true, useful, and
 * names Glock twice in one breath. A brand essay left behind by a template
 * names its subject over and over, and it also keeps its heading, which
 * `headlinesAMake` catches on the first occurrence.
 */
const FOREIGN_MAKE_MENTIONS = 5;

const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "Smith & Wesson" also arrives as "Smith and Wesson" and "Smith&Wesson". */
const makePattern = (make: string) =>
  new RegExp(
    `\\b${make
      .split(/\s*&\s*/)
      .map((part) => part.split(/\s+/).map(escapeRe).join('\\s+'))
      .join('\\s*(?:&|and)\\s*')}\\b`,
    'gi',
  );

/**
 * The word immediately before `at`, on the same line. Empty when the match
 * starts a line — ⚠️ deliberately, because a line break is not a preceding
 * word, and reading across one is how a serial number two lines up
 * ("ZA2226548") came to look like a calibre.
 */
function wordBefore(text: string, at: number): string {
  const m = /(\S+)[^\S\n]*$/.exec(text.slice(0, at));
  return m ? m[1] : '';
}

/**
 * ⚠️ A MAKE RIDING A CARTRIDGE NUMBER IS A CALIBRE, NOT A CLAIM. Half the
 * famous cartridges carry a manufacturer's name — ".308 Winchester", "7 mm
 * Remington Magnum", "30-06 Springfield", "6,35mm Browning" — and a document
 * may discuss any of them without asserting who built this firearm.
 */
const CALIBRE_TOKEN = /^[.,]?\d[\d.,]*(?:[-–x×]\d[\d.,]*)?(?:mm)?$/i;

/** How often `make` is named as a maker in `text`. */
function makeMentions(text: string, make: string): number {
  let count = 0;
  for (const m of text.matchAll(makePattern(make))) {
    const prior = wordBefore(text, m.index ?? 0);
    if (CALIBRE_TOKEN.test(prior) || /^mm$/i.test(prior)) continue;
    count++;
  }
  return count;
}

/**
 * Whether `make` HEADLINES a line of the document.
 *
 * ⚠️ THE ROT KEEPS ITS HEADING. The corpus defect is literally a line reading
 * "History of CZ" above a Glock's motivation, and no genuine motivation
 * contains a bare few-word line naming a marque the applicant has nothing to
 * do with. So a heading is rot at the FIRST occurrence, where body text has to
 * earn it by repetition. A heading here is short, comma-free and few-worded —
 * wrapped prose is none of those.
 */
function headlinesAMake(text: string, make: string): boolean {
  return text.split(/\r?\n/).some((line) => {
    const heading = line.trim();
    if (!heading || heading.length > 60 || heading.includes(',')) return false;
    if (heading.split(/\s+/).length > 6) return false;
    return makeMentions(heading, make) > 0;
  });
}

/**
 * Everything mechanically wrong with a built document, as human sentences.
 *
 * Empty means clean. ⚠️ EVERY CHECK ONLY FIRES WHEN THE ANSWER EXISTS — a
 * pack with no serial answered cannot fail the serial check; absence of an
 * answer is the wizard's business, not this module's.
 */
export function packConsistency(
  text: string,
  answers: Record<string, string>,
  annexures: AnnexureRef[],
  // The clock is injected rather than read, the same rule sa-id.ts and the PDF
  // renderer follow: a document re-verified months later must reach the same
  // verdict it was built on. Optional, so the caller is unchanged.
  asAt = new Date(),
): string[] {
  const issues: string[] = [];
  const doc = squash(text);

  // ── annexure citations are promises ───────────────────────────────
  const offered = new Set(annexures.map((a) => a.letter));
  for (const letter of citedAnnexures(text)) {
    if (!offered.has(letter)) {
      issues.push(
        `The document cites Annexure ${letter}, but the pack has no annexure ${letter} — a DFO turning to that tab finds nothing.`,
      );
    }
  }

  // ── the firearm is the firearm ────────────────────────────────────
  const serial = (answers.firearm_serial ?? '').trim();
  if (serial && !doc.includes(squash(serial))) {
    issues.push(
      `The firearm's serial number (${serial}) does not appear in the document — the motivation must identify the exact firearm applied for.`,
    );
  }
  const calibre = (answers.firearm_calibre ?? '').trim();
  if (calibre && !doc.includes(squash(calibre))) {
    issues.push(
      `The calibre the applicant gave (${calibre}) does not appear in the document.`,
    );
  }

  // ── the applicant is the applicant ────────────────────────────────
  const id = digits(answers.id_number ?? '');
  if (id.length === 13 && !digits(text).includes(id)) {
    issues.push(
      'The applicant’s ID number does not appear in the document — a motivation is filed under an identity, not a name alone.',
    );
  }

  // ── serial numbers that are NOT this firearm must not be invented ──
  // The other direction of the serial check: if the document contains what
  // reads as a serial for the applied-for firearm ("Serial Number: X") that
  // does not match the answer, the writer substituted one. Owned-firearm
  // serials legitimately appear, so only the labelled applied-for form is
  // policed.
  if (serial) {
    for (const m of text.matchAll(/Serial\s*(?:Number|No)\.?\s*:?\s*([A-Z0-9-]{4,})/gi)) {
      const found = squash(m[1]);
      const owned = [1, 2, 3, 4, 5, 6].some((n) =>
        [
          answers[`existing_firearm_${n}_frame_serial`],
          answers[`existing_firearm_${n}_barrel_serial`],
        ].some((v) => v && squash(v) === found),
      );
      if (found !== squash(serial) && !owned) {
        issues.push(
          `The document states a serial number (${m[1]}) that is neither the firearm applied for nor one the applicant listed as already owned.`,
        );
      }
    }
  }

  // ── every date the document asserts must be possible ──────────────
  //
  // The birth date comes from the ID number rather than a date field because
  // the ID is the one date the applicant cannot get wrong — Home Affairs
  // already checked it. No readable ID, no check: this module never guesses
  // at an identity.
  const born = readSaId(answers.id_number ?? '', asAt).dateOfBirth;
  if (born) {
    // ⚠️ A DATE THE APPLICANT GAVE IS THEIRS, NOT THE WRITER'S. Competency and
    // licence EXPIRY are both answers and both legitimately in the future, so
    // anything the FactPack already carries passes untouched. What is left is
    // a date the writer produced on its own.
    const givenDates = new Set(
      datesIn(answerText(answers)).flatMap((d) => d.candidates.map(isoDay)),
    );
    // ⚠️ +1 DAY. Dates compare as UTC midnights and the applicant is in SAST
    // (UTC+2), so a document generated just after midnight in Pretoria carries
    // a date this clock still reads as tomorrow.
    const horizon = asAt.getTime() + MS_PER_DAY;
    const seen = new Set<string>();
    for (const found of datesIn(text)) {
      const key = found.candidates.map(isoDay).join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      if (found.candidates.some((d) => givenDates.has(isoDay(d)))) continue;
      const sentence = sentenceAt(text, found.at);
      if (STATUTE_SENTENCE.test(sentence) && !FIRST_PERSON.test(sentence)) {
        continue;
      }
      if (found.candidates.every((d) => d.getTime() < born.getTime())) {
        issues.push(
          `The document states a date (${found.raw}) from before the applicant was born on ${prettyDate(born)} — the approved corpus has a membership "since 11 July 1905", and that is the error this catches.`,
        );
      } else if (found.candidates.every((d) => d.getTime() > horizon)) {
        issues.push(
          `The document states a future date (${found.raw}) that the applicant never gave — a motivation may only assert dates the applicant supplied.`,
        );
      }
    }
  }

  // ── the makes discussed are the makes in the FactPack ─────────────
  //
  // A make is grounded when it appears ANYWHERE in the applicant's answers,
  // not merely in firearm_make: the comparison section names the firearms
  // they already hold, and a hunting history names the .375 their father lent
  // them. Only a marque the FactPack never mentions at all can be rot.
  const make = (answers.firearm_make ?? '').trim();
  if (make) {
    const given = answerText(answers);
    for (const other of FIREARM_MAKES) {
      if (makeMentions(given, other) > 0) continue;
      const count = makeMentions(text, other);
      if (!headlinesAMake(text, other) && count < FOREIGN_MAKE_MENTIONS) {
        continue;
      }
      issues.push(
        `The document gives ${other} a section of its own (${count} mentions), but the applicant applies for a ${make} and holds no ${other} — this is another firearm's motivation left behind in the template.`,
      );
    }
  }

  return issues;
}
