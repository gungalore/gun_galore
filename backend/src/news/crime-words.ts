// ────────────────────────────────────────────────────────────────────
// THE CHEAP PRE-FILTER: WHICH HEADLINES ARE WORTH ASKING A MODEL ABOUT.
//
// A night's poll brings in ~700 items and perhaps a fifth are crime. Sending
// all 700 to the model costs seven hundred items of tokens to learn that a
// school netball result is not a robbery. So a word list decides what is
// PLAUSIBLY crime and the model decides what IS — never the other way round.
//
// ⚠️ TUNED FOR RECALL, NOT PRECISION. A false positive costs one item of one
// batched model call; a false negative is a clipping the applicant never sees
// and can never ask for. So "police" and "court" are in the list even though
// most of what they catch is not crime — the model throws those out for a
// fraction of a cent.
//
// ⚠️ AFRIKAANS AND isiZULU TOO. The registry carries Maroela Media,
// Eikestadnuus, Paarl Post, Vaalweekblad and Ilanga; an English-only list
// makes six titles quietly invisible while their feeds poll perfectly.
// ────────────────────────────────────────────────────────────────────

/**
 * ⚠️ MATCHED ON WORD BOUNDARIES, with an optional SUFFIX only. "rape" must
 * not fire inside "grapes" and "gun" must not fire inside "shotgun-shy" — but
 * "robbed", "robbery" and "robbers" all have to fire on "rob". Hence a
 * leading boundary plus a trailing `[a-z]{0,4}`, rather than either a bare
 * substring search (which matches "grapes") or a strict `\b…\b` (which misses
 * every inflection). The asymmetry is deliberate: a word may grow a tail, and
 * the odd compound it lets through costs one item of one batched model call.
 */
const WORDS = [
  // English — violence
  'murder',
  'murdered',
  'kill',
  'killed',
  'killing',
  'shot',
  'shooting',
  'shootout',
  'stab',
  'stabbed',
  'stabbing',
  'assault',
  'attack',
  'attacked',
  'rape',
  'raped',
  'rapist',
  'gunman',
  'gunmen',
  'gunpoint',
  'gun',
  'firearm',
  'weapon',
  'body',
  'corpse',
  'homicide',
  'manslaughter',
  // English — property
  'rob',
  'robbed',
  'robbery',
  'robber',
  'hijack',
  'hijacked',
  'hijacking',
  'carjack',
  'burglar',
  'burglary',
  'break-in',
  'housebreaking',
  'theft',
  'stolen',
  'steal',
  'stole',
  'looting',
  'looted',
  'heist',
  'cash-in-transit',
  'atm',
  'bombing',
  'extortion',
  'kidnap',
  'kidnapped',
  'kidnapping',
  'ransom',
  'hostage',
  // English — policing and courts
  'saps',
  'police',
  'policeman',
  'arrest',
  'arrested',
  'suspect',
  'suspects',
  'crime',
  'criminal',
  'gang',
  'gangster',
  'court',
  'sentenced',
  'convicted',
  'accused',
  'manhunt',
  'wanted',
  'ambush',
  'siege',
  'vigilante',
  'trafficking',
  'dagga',
  'drugs',
  'mandrax',
  // Afrikaans
  'moord',
  'vermoor',
  'roof',
  'rooftog',
  'beroof',
  'kaping',
  'gekaap',
  'geskiet',
  'skiet',
  'gesteek',
  'inbraak',
  'ingebreek',
  'verkrag',
  'verkragting',
  'aanranding',
  'aangerand',
  'polisie',
  'gearresteer',
  'misdaad',
  'misdadigers',
  'gesteel',
  'diefstal',
  'hof',
  'vonnis',
  'skuldig',
  'verdagte',
  'ontvoer',
  'ontvoering',
  'bende',
  // isiZulu / isiXhosa
  'ubugebengu',
  'amaphoyisa',
  'ukubulala',
  'wabulawa',
  'ubulawe',
  'inkunzi',
  'igebengu',
  'amasela',
  'isela',
  'boshiwe',
  'inkantolo',
  'ukudlwengula',
  'ulwaphulo',
  'ubusela',
] as const;

const PATTERN = new RegExp(
  `(?:^|[^a-z\\u00c0-\\u024f])(?:${WORDS.map(escapeRe).join('|')})[a-z\\u00c0-\\u024f]{0,4}(?![a-z\\u00c0-\\u024f])`,
  'i',
);

/**
 * Is this headline+standfirst worth a model call?
 *
 * Reads ONLY the headline and the standfirst — the same two fields the model
 * is given and the same two a printed clipping shows. Nothing else exists.
 */
export function looksLikeCrime(
  headline: string,
  standfirst?: string | null,
): boolean {
  return PATTERN.test(`${headline} ${standfirst ?? ''}`);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}
