import type { NewsIncident } from '../news/news.types';

// ────────────────────────────────────────────────────────────────────
// WHICH REPORTS MAY BE OFFERED TO AN APPLICANT, AND PRINTED IN THEIR PACK.
//
// ⚠️ THE PICKER OFFERED A CHILD-RAPE CASE. Walking MO000072's "Where you
// travel" step produced, among the reports near the applicant, a child rape in
// Atlantis and an Afrikaans story about a court appearance being postponed.
// The first is a headline nobody wants inside a document they sign and hand to
// a police official; the second is not evidence of anything at all — a court
// diary entry is a report about a case, not about a neighbourhood.
//
// ⚠️ AND THE COST OF BEING WRONG RUNS ONE WAY. A crime report wrongly excluded
// costs the applicant one clipping out of a dozen. A sexual offence printed as
// their own annexure is in front of a DFO with their name on the cover, and
// there is no taking it back. So this excludes on ANY of three independent
// signals and does not try to be clever about it.
//
// PURE — incidents in, incidents out. No Nest, no Prisma, no clock.
// ────────────────────────────────────────────────────────────────────

/**
 * The categories a motivation argues from.
 *
 * ⚠️ SAPS'S OWN WORDS, so a clipping sits beside the precinct table using the
 * same vocabulary the figures do — which is the whole reason the two are
 * annexed together.
 *
 * ⚠️ 'other' IS DELIBERATELY ABSENT, AND IT IS A REAL COST. NEWS_CRIME_TYPES
 * keeps 'other' because a crime we cannot classify is still a crime near the
 * applicant, and a smash-and-grab lands there. It is excluded here anyway,
 * because 'other' is also where a court-diary item, a fraud trial and a
 * municipal dispute end up — and the pack cannot tell them apart. One less
 * cutting beats one wrong one.
 */
const PACKABLE_TYPES = new Set([
  'murder',
  'attempted murder',
  'house robbery',
  'business robbery',
  'armed robbery',
  'hijacking',
  'assault',
  'burglary',
]);

/**
 * A report about a courtroom rather than about a neighbourhood.
 *
 * ⚠️ THE HEADLINE IS THE TEST, NOT THE CATEGORY. A court report about a murder
 * IS classified 'murder' and passes the category filter — and "Murder accused's
 * case postponed to November" tells a Registrar nothing about the risk on the
 * applicant's route. What matters to the motivation is the incident; what a
 * court did about it months later is a different document.
 */
const COURT_WORDS = [
  'court',
  'postpone',
  'remand',
  'bail',
  'sentenc',
  'convict',
  'acquit',
  'verdict',
  'trial',
  'plea',
  'appear',
  'testif',
  'witness stand',
  'judgment',
  'judgement',
  'magistrate',
  'prosecut',
  'inquest',
  'uitgestel',
  'hof',
  'borgtog',
  'vonnis',
];

/**
 * Words that mark a report we will not put in front of a police official under
 * an applicant's name, whatever it was classified as.
 *
 * ⚠️ CATEGORY AND HEADLINE ARE CHECKED SEPARATELY BECAUSE THE CLASSIFIER IS A
 * MODEL. A sexual offence miscategorised as 'assault' passes the type filter,
 * and the type filter is the only thing standing between it and an annexure.
 */
const NEVER_WORDS = [
  'rape',
  'raped',
  'verkrag',
  'sexual assault',
  'sexually',
  'molest',
  'indecent assault',
  'child porn',
  'grooming',
  'human trafficking',
  'suicide',
  'selfmoord',
];

const lc = (v: string | null | undefined) => (v ?? '').toLowerCase();

/** Does this text carry any of these stems, at a word start? */
function anyOf(text: string, stems: readonly string[]): boolean {
  const t = lc(text);
  return stems.some((w) => {
    const i = t.indexOf(w);
    return i >= 0 && (i === 0 || !/[a-z]/.test(t[i - 1]));
  });
}

/**
 * May this report be offered to an applicant and printed in their pack?
 *
 * ⚠️ THE STANDFIRST IS READ AS WELL AS THE HEADLINE. A paper leads with
 * "Community outraged after Atlantis attack" and says what the attack was in
 * the second line. A filter that reads only the headline passes it.
 */
export function packableIncident(i: NewsIncident): boolean {
  if (!PACKABLE_TYPES.has(lc(i.crimeType))) return false;
  const text = `${i.headline} ${i.standfirst ?? ''}`;
  if (anyOf(text, NEVER_WORDS)) return false;
  if (anyOf(text, COURT_WORDS)) return false;
  return true;
}

/** The same rule over a list, order preserved. */
export function packableIncidents(
  incidents: readonly NewsIncident[],
): NewsIncident[] {
  return incidents.filter(packableIncident);
}
