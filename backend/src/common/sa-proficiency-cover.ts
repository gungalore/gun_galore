import {
  Endorsement,
  ENDORSEMENTS,
  MANDATORY_UNIT_STANDARD,
  readStatementOfResults,
  unitStandardSpec,
} from './sa-competency';

// ────────────────────────────────────────────────────────────────────
// DOES THIS MEMBER HOLD 117705, ANYWHERE?
//
// Operator, 2026-08-28: "One code we always have to have the certificate of
// is code 117705, which is the knowledge of the Firearms Control Act... the
// 117705 must always be requested by the system and alerted if it's missing."
//
// ⚠️ THE QUESTION IS ABOUT THE MEMBER, NOT ABOUT A DOCUMENT, AND THE
// DIFFERENCE IS THE WHOLE FEATURE. Operator, same thread: "I did my 117705
// with my handgun. but i have to supply that statement of results along with
// the rifle statement of results if I apply for a rifle. So both codes needs
// to be visible."
//
// So 117705 sits on a 2014 handgun statement and the rifle unit sits on a 2021
// one, and a rifle application needs BOTH pages. A per-document check would
// look at the rifle statement, find no 117705, and alert on a member who has
// held it for a decade — while a member who genuinely never did the knowledge
// course looks identical. Reading every statement together is the only way to
// tell those two people apart.
//
// ⚠️ AND "WE HAVE NOT READ IT" IS NOT "IT IS MISSING". A phone photograph at
// an angle, a PDF, a Vision outage, or a document uploaded before we began
// keeping OCR text all produce no codes — and reporting that as an absent
// statutory requirement would send somebody back to a training provider for a
// reprint of a course they passed. The three states below are kept apart for
// exactly that reason, and only one of them is an accusation.
// ────────────────────────────────────────────────────────────────────

export type MandatoryKnowledge =
  /** 117705 read off one of their documents. Nothing to ask for. */
  | 'CONFIRMED'
  /** Statements read, and none of them carried it. This is the alert. */
  | 'MISSING'
  /** Nothing readable. We must ask, but we must not accuse. */
  | 'UNREAD';

export interface ProficiencyCover {
  state: MandatoryKnowledge;
  /** Every registered code found, across every document, deduplicated. */
  held: string[];
  /** What those codes let them apply for. */
  endorsements: Endorsement[];
  /** Codes printed that we do not recognise. Surfaced, never dropped. */
  unknown: string[];
  /** How many of the documents handed in yielded no readable code. */
  unreadable: number;
  /** The member-facing line, or null when there is nothing to say. */
  alert: string | null;
}

const MANDATORY_TITLE = 'Knowledge of the Firearms Control Act';

/**
 * Read every proficiency document a member holds as one body of evidence.
 *
 * Pass the OCR text of EVERY statement of results and provider certificate
 * they have given us — the ones on this application AND the ones already in
 * their Document Centre. Passing only this application's would reintroduce
 * exactly the per-document mistake this exists to prevent.
 */
export function proficiencyCover(
  texts: readonly (string | null | undefined)[],
): ProficiencyCover {
  const held = new Set<string>();
  const unknown = new Set<string>();
  const found = new Set<Endorsement>();
  let unreadable = 0;

  for (const raw of texts) {
    const text = (raw ?? '').trim();
    if (!text) {
      unreadable++;
      continue;
    }
    const sor = readStatementOfResults(text);
    if (!sor.known.length && !sor.unknown.length) {
      // A page we could read words off, but no unit standard on it. For this
      // question that is the same as not having read it.
      unreadable++;
      continue;
    }
    for (const c of sor.known) held.add(c);
    for (const c of sor.unknown) unknown.add(c);
    for (const e of sor.endorsements) found.add(e);
  }

  const heldList = [...held].sort();
  // ⚠️ AN UNRECOGNISED CODE STILL COUNTS AS HAVING READ THE PAGE. We know
  // which units are printed on it; 117705 is simply not among them, and that
  // is evidence of absence rather than absence of evidence. Keying MISSING on
  // the RECOGNISED codes alone would report a statement full of codes we do
  // not carry as unreadable, and the member would get the softer prompt for a
  // gap we can actually see.
  const readSomething = heldList.length > 0 || unknown.size > 0;
  const state: MandatoryKnowledge = held.has(MANDATORY_UNIT_STANDARD)
    ? 'CONFIRMED'
    : readSomething
      ? 'MISSING'
      : 'UNREAD';

  return {
    state,
    held: heldList,
    // ENDORSEMENTS order, not the order they were printed in, so two members
    // with the same training read identically.
    endorsements: ENDORSEMENTS.map((e) => e.value).filter((v) => found.has(v)),
    unknown: [...unknown].sort(),
    unreadable,
    alert: alertFor(state, heldList),
  };
}

/**
 * The line a member reads.
 *
 * ⚠️ IT NAMES THE CODE AND WHAT IT IS. "117705" alone means nothing to
 * somebody holding a folder of certificates; "Knowledge of the Firearms
 * Control Act" is what is actually printed next to it on the page they need
 * to find.
 *
 * ⚠️ AND IT PROMISES NOTHING ABOUT THE OUTCOME. It says what SAPS asks for,
 * never what SAPS will decide.
 */
function alertFor(state: MandatoryKnowledge, held: string[]): string | null {
  if (state === 'CONFIRMED') return null;

  if (state === 'UNREAD') {
    return (
      `We could not read any unit standard codes off your proficiency ` +
      `documents. Every application needs ${MANDATORY_UNIT_STANDARD} ` +
      `(${MANDATORY_TITLE}) as well as the code for the firearm type — ` +
      `please check that the statement of results showing ` +
      `${MANDATORY_UNIT_STANDARD} is in the pack.`
    );
  }

  // A statement whose codes we all failed to recognise: we know 117705 is not
  // on it, but we cannot name what is, so do not pretend to.
  if (!held.length) {
    return (
      `We read your proficiency documents but did not find ${MANDATORY_UNIT_STANDARD} ` +
      `(${MANDATORY_TITLE}) on any of them. SAPS asks for that one on every ` +
      `application, whichever firearm it is for.`
    );
  }

  const names = held
    .map((c) => {
      const spec = unitStandardSpec(c);
      return spec ? `${c} (${spec.title})` : c;
    })
    .join(', ');

  return (
    `We can see ${names}, but not ${MANDATORY_UNIT_STANDARD} ` +
    `(${MANDATORY_TITLE}). SAPS asks for that one on every application, ` +
    `whichever firearm it is for. It is often on an earlier statement of ` +
    `results — the one from your first course — so add that page too.`
  );
}
