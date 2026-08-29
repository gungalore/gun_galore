import type { MotivationUploadKind } from '@prisma/client';
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
//   card. The same header every time, often a form number or a unit-standard
//   code. These are here, and a marker settles them for nothing.
//
//   VARIES PER PERSON — proof of address is a municipal bill or a bank
//   statement or a lease; a letter of good standing is on whatever letterhead
//   the association uses; a dedicated-status certificate likewise. There is no
//   marker to find, and inventing one would file a bank statement as a lease
//   because both said "account". These go to the model, which is the thing
//   models are actually good at.
//
// ⚠️ SO A MISS HERE IS NOT A FAILURE. It is the router saying "this one needs
// judgement", and the model is the next step, not the fallback for a broken
// library. Never add a marker for a document that genuinely varies just to
// avoid a model call.
//
// ⚠️ AND A MARKER IS A MARKER, NOT A MENTION. "Statement of results" inside
// the body of a certificate is not a statement of results; SAPS 517 named in
// a footnote is not a SAPS 517. Every pattern here is anchored to something
// only the real document carries — a form number, a council's full name, a
// registered unit-standard code — and the strength ladder below decides when
// two of them appear on one page.
// ────────────────────────────────────────────────────────────────────

/**
 * How much weight a marker carries.
 *
 * ⚠️ A PAGE OFTEN CARRIES SEVERAL. The operator's own competency certificate
 * would carry both "SAPS 524" and a unit-standard code; it is a competency
 * certificate that lists units, not a statement of results. The strongest
 * marker wins, and ties fall through to the model rather than being guessed.
 */
export type MarkerStrength = 'definitive' | 'strong' | 'supporting';

export interface DocumentMarker {
  /** What the presence of this pattern means. */
  kind: MotivationUploadKind;
  strength: MarkerStrength;
  /** Why this pattern is safe — quoted from a real document where possible. */
  because: string;
  test: (text: string) => boolean;
}

const has = (re: RegExp) => (text: string) => re.test(text);

/** Every registered unit-standard code, as one alternation. */
const UNIT_CODES = new RegExp(
  `(?<!\\d)(${UNIT_STANDARDS.map((u) => u.code).join('|')})(?!\\d)`,
);

export const DOCUMENT_MARKERS: readonly DocumentMarker[] = [
  // ── SAPS forms. The number IS the document. ────────────────────
  {
    kind: 'COMPETENCY_CERTIFICATE',
    strength: 'definitive',
    because:
      'SAPS 524 is the competency certificate itself — the document issued to the holder. ' +
      'SAPS 517 is the APPLICATION for one and must never be confused with it. ' +
      'Confirmed in sa-competency-reference.md from three genuine specimens.',
    test: has(/\bSAPS\s*524\b/i),
  },

  // ── PFTC statement of results. ─────────────────────────────────
  {
    kind: 'PROFICIENCY_CERTIFICATE',
    strength: 'definitive',
    because:
      'The council\'s full name appears in the letterhead of every PFTC statement of ' +
      'results across three provider templates and eleven years of the operator\'s own ' +
      'documents. Paired with the heading so a provider mentioning the council in a ' +
      'footer is not mistaken for one.',
    test: (t) =>
      /SOUTH AFRICAN PROFESSIONAL\s+FIREARM TRAINERS COUNCIL/i.test(t) &&
      /STATEMENT OF RESULTS/i.test(t),
  },
  {
    kind: 'PROFICIENCY_CERTIFICATE',
    strength: 'strong',
    because:
      'A registered unit-standard code beside its title. The code alone is not enough — ' +
      'an SCV number and a company registration number both produced six-digit ' +
      'false positives on real documents, which is why parseUnitStandards anchors ' +
      'the title. A provider certificate carries the same pair and is the same evidence.',
    test: (t) =>
      UNIT_CODES.test(t) &&
      /(handle\s+and\s+use|knowledge\s+of\s+the\s+firearms\s+control\s+act)/i.test(
        t,
      ),
  },

  // ── The licence card. ──────────────────────────────────────────
  {
    kind: 'CURRENT_LICENCE',
    strength: 'strong',
    because:
      'A competency certificate names a firearm TYPE; only a licence prints a licence ' +
      'number against a specific firearm. Requires both so a competency certificate ' +
      'mentioning "licence" in its conditions is not mistaken for one.',
    test: (t) =>
      /\b(licence|license)\s*(no|number)\b/i.test(t) &&
      /\b(serial\s*(no|number)|kaliber|calibre|caliber)\b/i.test(t),
  },

  // ── The identity document. ─────────────────────────────────────
  {
    kind: 'IDENTITY_DOCUMENT',
    strength: 'strong',
    because:
      'The green book and the smart card both print these two phrases. A 13-digit ' +
      'number alone is not enough — every document in this pack carries the holder\'s ' +
      'identity number, so it would match all of them.',
    test: (t) =>
      /\b(IDENTITY\s+DOCUMENT|IDENTITEITSDOKUMENT|REPUBLIC OF SOUTH AFRICA)\b/i.test(
        t,
      ) && /\b(I\.?D\.?\s*(NO|NUMBER)|IDENTITY\s*NUMBER)\b/i.test(t),
  },
];

/**
 * Kinds we deliberately do NOT try to match on a marker.
 *
 * ⚠️ THIS LIST IS AS IMPORTANT AS THE ONE ABOVE, AND IT IS THE OPERATOR'S.
 * Each of these is a different document every time it arrives — a municipal
 * bill or a bank statement or a lease; an association's own letterhead; a
 * club's own certificate design. A keyword library cannot tell them apart
 * without inventing a rule that will be wrong for somebody, and being wrong
 * here files a document under a requirement it does not satisfy.
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
  /** Every marker that fired, for the log and for a human checking a mistake. */
  matched: { kind: MotivationUploadKind; because: string }[];
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

  const hits = DOCUMENT_MARKERS.filter((m) => m.test(body));
  if (!hits.length) return null;

  const best = Math.max(...hits.map((m) => RANK[m.strength]));
  const top = hits.filter((m) => RANK[m.strength] === best);
  const kinds = new Set(top.map((m) => m.kind));
  if (kinds.size !== 1) return null;

  return {
    kind: top[0].kind,
    strength: top[0].strength,
    matched: hits.map((m) => ({ kind: m.kind, because: m.because })),
  };
}
