import type { MotivationUploadKind } from '@prisma/client';
import { type Clause, clauseMatches, phrase } from './ocr-tolerant';
import { UNIT_STANDARDS } from './sa-competency';

// ────────────────────────────────────────────────────────────────────
// TELLING A DOCUMENT APART BY WHAT IS PRINTED ON IT.
//
// ⚠️ TWO CLASSES OF DOCUMENT, AND ONLY ONE OF THEM BELONGS HERE.
// Operator, 2026-08-29: "there are a few documents that will always differ
// from person to person, proof of address, letter of good standing, dedicated
// shooter certificate. I need the AI to interpret these documents and decide
// what they are, that's why we have AI. The documents that is standard format
// we can train the OCR library on."
//
//   STANDARD FORMAT — a SAPS form, a PFTC statement of results, a licence
//   card, an identity document. The same wording every time. These are here.
//
//   VARIES PER PERSON — proof of address is a municipal bill or a bank
//   statement or a lease; a letter of good standing is on whatever letterhead
//   the association uses. There is no marker to find, and inventing one would
//   file a lease under a requirement it does not satisfy. See MODEL_ONLY_KINDS.
//
// ⚠️ EVERY PATTERN HERE WAS READ OFF A REAL DOCUMENT, NOT RECALLED.
// The operator supplied twenty of their own on 2026-08-29 — five SAPS 524s,
// six licence cards, five PFTC statements across two template generations,
// three provider certificates, a green identity book — plus a photograph of
// the older plastic competency card. Every anchor below is quoted from one of
// them. The first version of this file was written from memory and MISSED
// THREE OF THE NINE, which is the whole reason the rule is now "quote it or
// leave it out".
// ────────────────────────────────────────────────────────────────────

/**
 * How much weight a marker carries.
 *
 * ⚠️ A PAGE OFTEN CARRIES SEVERAL. A SAPS 524 carries its form number AND the
 * heading pair; a competency certificate can list the unit standards behind
 * it. The strongest wins, and ties fall through to the model.
 */
export type MarkerStrength = 'definitive' | 'strong' | 'supporting';

export interface DocumentMarker {
  /** What the presence of this pattern means. */
  kind: MotivationUploadKind;
  strength: MarkerStrength;
  /** Short name for the log and for a human checking a misfile. */
  name: string;
  /** Why this pattern is safe — quoted from a real document. */
  because: string;
  /**
   * Every one of these must appear. Two or more wherever possible: one phrase
   * is a mention, a pair is a marker.
   */
  all: Clause[];
  /**
   * ⚠️ TEXT THAT VETOES THE MARKER, HOWEVER WELL THE REST MATCHES.
   *
   * This exists because the APPLICATION for a document quotes the document.
   * SAPS 271 is titled "Application for a licence to possess a firearm" and
   * SAPS 517 is the application for a competency certificate — both carry the
   * exact heading of the thing they apply for. Filing an application as the
   * granted document shows a statutory requirement satisfied while the thing
   * SAPS actually asks for is missing, and nothing on screen would say so.
   *
   * We generate SAPS 271 ourselves, so a member uploading their own copy of
   * one is not a hypothetical.
   */
  never?: Clause[];
}

/** Every registered unit-standard code, as one alternation. */
const UNIT_CODES = new RegExp(
  `(?<!\\d)(${UNIT_STANDARDS.map((u) => u.code).join('|')})(?!\\d)`,
);

/**
 * A unit standard's title, in any of the wordings real providers print.
 *
 * Observed across the operator's documents: PFTC prints "Handle and Use a
 * Manually Operated Rifle or Carbine"; Progun prints "HANDLE AND USE MANUALLY
 * OPERATED RIFLE OR CARBINE" (no "a"); NSN prints "HANDLE AND USE OF A
 * HANDGUN". For 117705, PFTC prints "Knowledge of the Firearms Control Act"
 * and NSN prints "DEMONSTRATE KNOWLEDGE OF THE FIREARMS CONTROL ACT".
 * The anchor has to survive all of them or it stops recognising real
 * certificates — a silent failure, since the document still uploads.
 */
const UNIT_TITLE =
  /(handle\s*and\s*use|knowledge\s*of\s*the\s*firearms\s*control\s*act)/i;

/**
 * The application forms that quote the documents they apply for.
 *
 * ⚠️ THE VETO HAD TO BE LOOSENED WITH THE ANCHORS, AND A TEST PROVED IT.
 * Making the licence anchor tolerant while leaving this strict widens what
 * matches and NOT what refuses — so a SAPS 271 whose title the OCR mangled
 * would sail past a veto that no longer recognised it and be filed as the
 * granted licence. ocr-degradation.spec.ts caught exactly that: 2 in 200
 * corrupted applications misfiled, at only 1% character error, in the first
 * version of this change.
 *
 * That is the worst outcome this whole table exists to prevent. Filing an
 * application as the granted document shows a statutory requirement satisfied
 * while the thing SAPS actually asks for is missing, and nothing on screen
 * would say so. A veto firing slightly too often costs a trip through the
 * model; a veto missing costs somebody their application.
 *
 * ⚠️ AND THE FORM NUMBERS ARE TOLERANT TOO, WHICH THE FIRST ATTEMPT GOT WRONG.
 * The reasoning for keeping them strict was that a three-digit number is only
 * four characters of signal and would start colliding with the section
 * numbers, serials and dates these documents are full of. Measured, that fear
 * was misplaced and the cost was real: with a strict "SAPS 271" one bad
 * character removed the veto's ONLY other chance to fire, so misfiling rose
 * from 0 to 17 in 400 at 3% character error.
 *
 * The collision does not happen because the digits are far apart — looseWord
 * accepts 2/z/Z and 1/l/I for "271", none of which reach "524" — so the
 * competency certificate's own form number cannot trip the application veto.
 *
 * Two INDEPENDENT chances is the point. The veto now fails only when both the
 * form number and the English title are damaged in the same read, rather than
 * when either one is.
 */
const IS_AN_APPLICATION = [
  // ⚠️ THE BARE WORD, AND IT IS THE ONE THAT ACTUALLY CARRIES THE VETO.
  // Measured: the misfiles were NOT cases where the licence anchor matched
  // loosely — they were cases where it matched EXACTLY, because a SAPS 271 is
  // literally titled "Application for a licence to possess a firearm" and
  // contains the licence heading as a substring. So the damage that causes a
  // misfile is always damage to the VETO, never to the anchor, and no amount
  // of care about how the anchor matched can catch it.
  //
  // A licence card does not print the word "application" anywhere; neither
  // does a competency certificate or a statement of results. One tolerant
  // word is therefore both the broadest and the safest trigger available, and
  // it fails only when the word is deleted outright rather than misread.
  phrase('application'),
  phrase('SAPS 271', { required: ['271'] }),
  phrase('SAPS 517', { required: ['517'] }),
  phrase('SAPS 518', { required: ['518'] }),
  phrase('application for a licence to possess', {
    allowMissing: 1,
    required: ['application'],
  }),
  phrase('application for a competency certificate', {
    allowMissing: 1,
    required: ['application'],
  }),
  /application\s+(form\s+)?for\s+(a|the)\s+(licence|license|competency)/i,
];

export const DOCUMENT_MARKERS: readonly DocumentMarker[] = [
  // ── The SAPS competency certificate. ───────────────────────────
  {
    kind: 'COMPETENCY_CERTIFICATE',
    strength: 'definitive',
    name: 'saps-524-form-number',
    because:
      'The form number printed top-right on all five of the operator\'s paper ' +
      'competency certificates. SAPS 524 is the certificate; SAPS 517 is the ' +
      'APPLICATION for one and is vetoed below.',
    all: [/\bSAPS\s*524\b/i],
    never: IS_AN_APPLICATION,
  },
  {
    kind: 'COMPETENCY_CERTIFICATE',
    strength: 'definitive',
    name: 'competency-certificate-section-10',
    because:
      '⚠️ THIS IS THE ONE THAT CATCHES THE OLD PLASTIC CARD. SAPS issued ' +
      'competency as a card before moving to paper, and the card carries NO ' +
      'form number — so the SAPS 524 marker above misses it entirely and it ' +
      'went to the model. Both formats print the heading "COMPETENCY ' +
      'CERTIFICATE" directly above the section: the paper says "Section 10 of ' +
      'the Firearms Control Act, 2000 (Act No 60 of 2000)", the card says ' +
      '"Section 10 of the Firearms Control Act, 60 of 2000". The pair also ' +
      'separates it from a TRAINING provider\'s certificate, which says ' +
      '"COMPETENCY COURSE" and never cites section 10.',
    // ⚠️ TOLERANT, BECAUSE THIS WAS THE WORST ANCHOR IN THE TABLE. Measured
    // by corrupting the real text: at 99.5% character accuracy this marker
    // already failed 22% of the time, and at 98% it failed 68% of the time —
    // because a 38-character phrase matched end to end dies to ONE bad
    // character, and the plastic card has no form number to fall back on.
    // One word may now be lost; "competency" may not be, or every training
    // provider's certificate would match.
    all: [
      phrase('competency certificate', { required: ['competency'] }),
      phrase('section 10 of the firearms control act', { allowMissing: 1 }),
    ],
    never: IS_AN_APPLICATION,
  },

  // ── The firearm licence. ───────────────────────────────────────
  {
    kind: 'CURRENT_LICENCE',
    strength: 'definitive',
    name: 'licence-to-possess-card',
    because:
      '⚠️ THE LICENCE CARD NEVER PRINTS THE WORDS "LICENCE NUMBER". All six ' +
      'of the operator\'s cards head with "Licence To Possess a Firearm" over ' +
      '"Firearms Control Act, 60 of 2000", then label the firearm with ' +
      '"Serial Number", "Calibre" and "Type" — so the generic licence-number ' +
      'marker below matched none of them. Paired with a firearm field so a ' +
      'letter mentioning somebody\'s licence to possess a firearm is not one. ' +
      '"Licence to possess" also cannot collide with the competency ' +
      'certificate\'s "COMPETENCY to possess a firearm".',
    // ⚠️ TOLERANT FOR THE SAME REASON, second-worst in the table: 89% correct
    // at 99.5% character accuracy, 56% at 98%. The card never prints "licence
    // number", so this 26-character phrase is its only definitive anchor and
    // there is nothing shorter to fall back on. "firearm" must survive —
    // without it, a letter mentioning somebody's licence would match. The
    // firearm-field clause below stays a RegExp: it is already an alternation
    // of four short tokens appearing five times on the card, which is its own
    // redundancy and measured as never being the clause that failed.
    all: [
      phrase('licence to possess a firearm', {
        allowMissing: 1,
        required: ['firearm'],
      }),
      /\b(serial\s*(no|number)|calibre|caliber|kaliber)\b/i,
    ],
    // ⚠️ SAPS 271 IS TITLED "Application for a licence to possess a firearm",
    // and we generate it ourselves. Without this veto our own output would
    // read back as the licence it applies for.
    never: IS_AN_APPLICATION,
  },
  {
    kind: 'CURRENT_LICENCE',
    strength: 'strong',
    name: 'licence-number-with-firearm',
    because:
      'The paper licence, which does label its number. A competency ' +
      'certificate names a firearm TYPE; only a licence prints a number ' +
      'against a specific firearm, so both are required.',
    all: [
      /\b(licence|license)\s*(no|number)\b/i,
      /\b(serial\s*(no|number)|kaliber|calibre|caliber)\b/i,
    ],
    never: IS_AN_APPLICATION,
  },

  // ── Proficiency: the PFTC statement of results. ────────────────
  {
    kind: 'PROFICIENCY_CERTIFICATE',
    strength: 'definitive',
    name: 'pftc-statement-of-results',
    because:
      'The council\'s full name in the letterhead under the heading, on every ' +
      'PFTC statement across both template generations the operator holds ' +
      '(2014 and 2021/2025). Paired with the heading so a provider naming the ' +
      'council in a footer is not mistaken for one.',
    all: [
      /SOUTH\s+AFRICAN\s+PROFESSIONAL\s+FIREARM\s+TRAINERS\s+COUNCIL/i,
      /STATEMENT\s+OF\s+RESULTS/i,
    ],
  },
  {
    kind: 'PROFICIENCY_CERTIFICATE',
    strength: 'definitive',
    name: 'unit-standards-awarded-table',
    because:
      '⚠️ THE COLUMN HEADINGS CHANGED BETWEEN TEMPLATE GENERATIONS AND BOTH ' +
      'ARE STILL IN CIRCULATION. The 2014 statement prints "The Following ' +
      'Unit Standard/s Have Been Awarded" over a "SAQAID" column; the 2021 and ' +
      '2025 ones print "The following Unit Standards have been awarded" over ' +
      '"SAQA ID". Keying on either wording alone would silently stop reading ' +
      'half the statements people actually hold, so both spellings are ' +
      'allowed and the SAQA column is what confirms it.',
    all: [
      /unit\s+standard(\/?s)?\s+(have|has)\s+been\s+awarded/i,
      /\bSAQA\s?ID\b/i,
    ],
  },
  {
    kind: 'PROFICIENCY_CERTIFICATE',
    strength: 'strong',
    name: 'unit-code-beside-its-title',
    because:
      'A registered unit-standard code beside its title — what the three ' +
      'provider certificates carry instead of a PFTC table. The code alone is ' +
      'not enough: an SCV number (K900001), a document id in a print header ' +
      '(673334) and a company registration number (2017/510807/07) all ' +
      'produced six-digit false positives on these very documents.',
    all: [UNIT_CODES, UNIT_TITLE],
  },

  // ── The identity document. ─────────────────────────────────────
  {
    kind: 'IDENTITY_DOCUMENT',
    strength: 'definitive',
    name: 'green-book-authority-line',
    because:
      '⚠️ THE GREEN BOOK PRINTS NEITHER "IDENTITY DOCUMENT" NOR "REPUBLIC OF ' +
      'SOUTH AFRICA" ON ITS IDENTITY PAGE. The first version of this file ' +
      'required one of those and therefore missed the operator\'s book ' +
      'completely. What the page actually carries, bottom right, is "ISSUED BY ' +
      'AUTHORITY OF THE DIRECTOR-GENERAL HOME AFFAIRS" — on every copy, and ' +
      'on nothing else a member would upload here.',
    all: [
      /ISSUED\s+BY\s+AUTHORITY\s+OF/i,
      /DIRECTOR[\s-]*GENERAL/i,
      /HOME\s+AFFAIRS/i,
    ],
  },
  {
    kind: 'IDENTITY_DOCUMENT',
    strength: 'strong',
    name: 'green-book-identity-page',
    because:
      'The identity page\'s own field labels, for a photograph that crops the ' +
      'authority line off the bottom. "FORENAMES" is the distinctive one — SA ' +
      'documents otherwise say "first names", "names" or "initials" — and ' +
      '"S.A.CITIZEN" is printed under the barcode with no space, which is why ' +
      'the space is optional here.',
    all: [/\bFORENAMES\b/i, /\bS\.?\s?A\.?\s?CITIZEN\b|COUNTRY\s+OF\s+BIRTH/i],
  },
  {
    kind: 'IDENTITY_DOCUMENT',
    strength: 'definitive',
    name: 'smart-id-card-heading',
    because:
      'The white smart card\'s own two-line heading, read off a specimen the ' +
      'operator supplied 2026-08-29: "REPUBLIC OF SOUTH AFRICA" over ' +
      '"NATIONAL IDENTITY CARD". ⚠️ THE SECOND LINE IS THE LOAD-BEARING ONE — ' +
      '"Republic of South Africa" alone heads passports, birth certificates ' +
      'and most government paper, and would file all of them as an identity ' +
      'document. Note it is NATIONAL identity card: a pattern written for ' +
      '"IDENTITY CARD" exactly, anchored at a line start, would miss it.',
    all: [
      /REPUBLIC\s+OF\s+SOUTH\s+AFRICA/i,
      /NATIONAL\s+IDENTITY\s+CARD/i,
    ],
    never: IS_AN_APPLICATION,
  },
  {
    kind: 'IDENTITY_DOCUMENT',
    strength: 'strong',
    name: 'smart-id-card-fields',
    because:
      'The smart card\'s field labels, for a photograph that catches the ' +
      'details but not the heading — a glare-washed top edge is the ordinary ' +
      'case on a laminated card. Verified against the specimen, which prints ' +
      'them with colons and a capital B: "Nationality:", "Identity Number:", ' +
      '"Country of Birth:". (Wikipedia lists "Date of birth" and "Country of ' +
      'birth" lower-case; the card does not. Matching is case-insensitive, so ' +
      'this changes nothing — but it is why the specimen outranks the source.)',
    all: [/\bNationality\b/i, /\bCountry\s+of\s+Birth\b/i, /\bIdentity\s*Number\b/i],
    // ⚠️ A PASSPORT CARRIES Nationality AND Date of Birth TOO, and a passport
    // is NOT what SAPS asks for. Vetoed rather than relied on to differ.
    never: [/\bpass?port\b|\bpaspoort\b/i, ...IS_AN_APPLICATION],
  },
  {
    kind: 'IDENTITY_DOCUMENT',
    strength: 'strong',
    name: 'identity-document-heading',
    because:
      'The heading pair, for formats that do print it. A 13-digit number ' +
      'alone would match every document in the pack, since they all carry the ' +
      'holder\'s identity number.',
    all: [
      /\b(IDENTITY\s+DOCUMENT|IDENTITEITSDOKUMENT|IDENTITEITSKAART|IDENTITY\s+CARD)\b/i,
      /\b(I\.?\s?D\.?\s*(NO|NUMBER)|IDENTITY\s*NUMBER|IDENTITEITSNOMMER)\b/i,
    ],
  },
];

/**
 * Kinds we deliberately do NOT try to match on a marker.
 *
 * ⚠️ THIS LIST IS AS IMPORTANT AS THE ONE ABOVE, AND IT IS THE OPERATOR'S.
 * Each is a different document every time it arrives — a municipal bill or a
 * bank statement or a lease; an association's own letterhead; a club's own
 * certificate design. A keyword library cannot tell them apart without
 * inventing a rule that will be wrong for somebody, and being wrong here files
 * a document under a requirement it does not satisfy.
 *
 * Anything in this list goes straight to the model. That is not a gap to close
 * later; it is the design.
 */
export const MODEL_ONLY_KINDS: readonly MotivationUploadKind[] = [
  'ADDRESS_CONFIRMATION',
  'GOOD_STANDING_LETTER',
  'ASSOCIATION_CARD',
  'ASSOCIATION_ENDORSEMENT',
  'EMPLOYMENT_CONFIRMATION',
  'CHARACTER_REFERENCE',
  'SHOOTING_ACTIVITY_LOG',
  'FIREARM_SOURCE_PROOF',
  'SAFE_PHOTOGRAPHS',
];

export interface MarkerVerdict {
  kind: MotivationUploadKind;
  strength: MarkerStrength;
  /** Every marker that fired, for the log and for a human checking a misfile. */
  matched: { kind: MotivationUploadKind; name: string; because: string }[];
  /** Markers that matched their text but were vetoed, and why. */
  vetoed: string[];
}

const RANK: Record<MarkerStrength, number> = {
  definitive: 3,
  strong: 2,
  supporting: 1,
};

/**
 * Read the markers on a page of OCR'd text.
 *
 * Returns null where nothing fired, or where the strongest markers disagree —
 * both of which mean "ask the model", not "give up".
 *
 * ⚠️ A TIE IS NOT A COIN TOSS. Two different kinds claiming a page at the same
 * strength is exactly the case a model should judge; picking the first in
 * array order would make the answer depend on the order somebody happened to
 * write the list in.
 */
export function readMarkers(text: string): MarkerVerdict | null {
  const body = (text ?? '').toString();
  if (!body.trim()) return null;

  const hits: DocumentMarker[] = [];
  const vetoed: string[] = [];
  const loose = new Set<string>();
  for (const m of DOCUMENT_MARKERS) {
    const got = m.all.map((c) => clauseMatches(c, body));
    if (got.some((g) => g === false)) continue;
    if (m.never?.some((c) => clauseMatches(c, body) !== false)) {
      vetoed.push(m.name);
      continue;
    }
    // ⚠️ REMEMBER WHETHER THIS NEEDED THE ALLOWANCE. See ClauseMatch: a marker
    // recognised only because a word was permitted to be missing is a real
    // match on a damaged document, and it must not be auto-filed.
    if (got.some((g) => g === 'loose')) loose.add(m.name);
    hits.push(m);
  }
  if (!hits.length) return null;

  const best = Math.max(...hits.map((m) => RANK[m.strength]));
  const top = hits.filter((m) => RANK[m.strength] === best);
  const kinds = new Set(top.map((m) => m.kind));
  if (kinds.size !== 1) return null;

  // ⚠️ A DAMAGED READ IS NOT A DEFINITIVE ONE, AND THIS IS THE WHOLE SAFETY
  // PROPERTY OF THE TOLERANCE. motivation-extract.service.ts skips the model
  // entirely for a 'definitive' verdict, so anything that reached its match by
  // allowing a word to be missing must not claim that. Measured: with the
  // loosened anchors a mangled SAPS 271 was filed as the granted licence 7
  // times in 400 at 3% character error, which strict matching never did — and
  // filing an application as the document it applies for shows a statutory
  // requirement satisfied while the thing SAPS asks for is missing.
  //
  // Downgrading rather than refusing keeps the recall the tolerance bought:
  // the document is still classified, it just gets confirmed instead of
  // auto-filed.
  const wasLoose = top.some((m) => loose.has(m.name));
  const strength: MarkerStrength =
    wasLoose && top[0].strength === 'definitive' ? 'strong' : top[0].strength;

  return {
    kind: top[0].kind,
    strength,
    matched: hits.map((m) => ({
      kind: m.kind,
      name: m.name,
      because: m.because,
    })),
    vetoed,
  };
}
