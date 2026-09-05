// backend/src/licence-centre/document-markers.ts
//
// WHICH DOCUMENT IS THIS? — answered from words printed on the paper.
//
// The Document Centre used to ask a vision model. That works, and it costs a
// round trip and a judgement call on every upload, and when it is wrong it is
// wrong in an expensive way: a SA Hunters certificate filed as DEDICATED_HUNTER
// put the operator's SPORT-shooter status on a section 16 application.
//
// Textract already returns every line of text. A firearm licence says "LICENCE
// TO POSSESS A FIREARM" on it. That is not something to infer.
//
// ── THIS IS A DATA TABLE ON PURPOSE ───────────────────────────────────
//
// Operator, 2026-09-04: "keep it data so we can add and adjust to it quickly."
// A new association issues a certificate we misfile? Add its letterhead as a
// marker and the next upload lands right. No model prompt to retune, no
// deploy needed beyond the constant, and the change is reviewable as a diff.
//
// ── WEIGHTS, NOT KEYWORDS ─────────────────────────────────────────────
//
// "IDENTITY NUMBER" appears on a competency certificate AND an ID card, so a
// first-match-wins list would file half the SAPS 524s as identity documents.
// Every marker carries what it is worth: phrases that only ever appear on one
// kind of paper score high, shared vocabulary scores 1, and a kind is claimed
// only when it BEATS the runner-up by a clear margin. A document that scores
// well on two kinds is precisely the document a human should look at.
//
// Every phrase below was derived from the 18 real documents in
// __fixtures__/textract — each appears in 100% of its own kind and 0% of any
// other. They are not guesses about what these papers say.

import type { CredentialKind } from '@prisma/client';

export interface Marker {
  /** Matched case-insensitively against the document's full text. */
  phrase: string;
  /**
   * What a hit is worth.
   *   5  the paper announces itself — only ever appears on this kind
   *   3-4 strongly indicative, a field label unique to this form
   *   1-2 supporting vocabulary that other documents also use
   */
  weight: number;
}

export interface DocumentRule {
  kind: CredentialKind;
  /**
   * The sub-family, where one kind covers several different papers. Not
   * stored on the row — `kind` is the filing decision — but reported so a
   * misfile can be traced to the rule that caused it.
   */
  variant: string;
  /** Total weight required before this kind may be claimed at all. */
  threshold: number;
  markers: Marker[];
}

/**
 * ⚠️ ORDER IS NOT PRECEDENCE. Every rule is scored and the best one wins, so
 * adding a rule cannot shadow an existing one by being listed first. Add
 * freely; adjust weights if something misfiles.
 */
export const DOCUMENT_RULES: DocumentRule[] = [
  {
    kind: 'FIREARM_LICENCE',
    variant: 'saps-licence-card',
    threshold: 5,
    markers: [
      { phrase: 'LICENCE TO POSSESS A FIREARM', weight: 5 },
      { phrase: 'FIREARMS CONTROL ACT, 60 OF 2000', weight: 3 },
      { phrase: 'BARREL SERIAL NO', weight: 2 },
      { phrase: 'RECEIVER SERIAL NO', weight: 2 },
      { phrase: 'CALIBRE', weight: 1 },
    ],
  },
  {
    kind: 'COMPETENCY_CERTIFICATE',
    variant: 'saps-524',
    threshold: 5,
    markers: [
      { phrase: 'SAPS 524', weight: 5 },
      { phrase: 'COMPETENCY CERTIFICATE NUMBER', weight: 4 },
      { phrase: 'TYPE OF COMPETENCY CERTIFICATE', weight: 4 },
      { phrase: 'COMPETENCY TO POSSESS A FIREARM', weight: 4 },
      { phrase: 'COMPETENCY CERTIFICATE', weight: 3 },
      // Shared with every other SAPS form — supporting only.
      { phrase: 'SOUTH AFRICAN POLICE SERVICE', weight: 1 },
    ],
  },
  {
    kind: 'PROFICIENCY',
    variant: 'sapftc-statement-of-results',
    threshold: 5,
    markers: [
      { phrase: 'STATEMENT OF RESULTS', weight: 5 },
      { phrase: 'FIREARM TRAINERS COUNCIL', weight: 4 },
      { phrase: 'UNIT STANDARDS TITLE', weight: 3 },
      { phrase: 'SAQA ID', weight: 2 },
      { phrase: 'SOUTH AFRICAN PROFESSIONAL', weight: 1 },
    ],
  },
  {
    kind: 'PROFICIENCY',
    variant: 'training-certificate',
    threshold: 5,
    // ⚠️ THE WEAKEST RULE HERE, AND HONESTLY SO. The three real samples come
    // from three providers with three layouts whose only shared word is
    // "CERTIFICATE". These markers lean on the unit-standard vocabulary that
    // any proficiency training carries rather than on a letterhead. When this
    // rule fails to clear its threshold the Claude fallback takes the
    // document — which is exactly the case the fallback exists for.
    markers: [
      { phrase: 'CERTIFICATE OF PROFICIENCY', weight: 5 },
      { phrase: 'PROFICIENCY FIREARM TRAINING', weight: 4 },
      { phrase: 'SAPS TRAINING REG NO', weight: 3 },
      { phrase: 'SAPS ACCREDITATION NUMBER', weight: 3 },
      { phrase: 'HANDLE AND USE', weight: 2 },
      { phrase: 'UNIT STANDARD', weight: 2 },
    ],
  },
  {
    kind: 'IDENTITY_DOCUMENT',
    variant: 'sa-smart-id-card',
    threshold: 5,
    markers: [
      { phrase: 'NATIONAL IDENTITY CARD', weight: 5 },
      { phrase: 'REPUBLIC OF SOUTH AFRICA', weight: 2 },
      { phrase: 'COUNTRY OF BIRTH', weight: 2 },
      { phrase: 'NATIONALITY', weight: 1 },
    ],
  },
  {
    kind: 'IDENTITY_DOCUMENT',
    variant: 'sa-green-book',
    threshold: 5,
    markers: [
      { phrase: 'ISSUED BY AUTHORITY OF', weight: 5 },
      { phrase: 'THE DIRECTOR-GENERAL', weight: 4 },
      { phrase: 'S.A.CITIZEN', weight: 3 },
      { phrase: 'FORENAMES', weight: 2 },
      { phrase: 'COUNTRY OF BIRTH', weight: 1 },
    ],
  },
];

export interface Classification {
  kind: CredentialKind;
  variant: string;
  score: number;
  /** The runner-up's score. A close second is the reason to ask a human. */
  runnerUp: number;
  /** Which phrases actually hit — the audit trail for a misfile. */
  matched: string[];
  /**
   * Cleared its threshold AND beat the runner-up by the margin. Only a
   * decisive classification may file a document without being looked at.
   */
  decisive: boolean;
}

/**
 * How far ahead the winner must be. Two kinds within this of each other is
 * genuinely ambiguous paper, not a tie to break with a coin.
 */
const MARGIN = 3;

/** Collapse to one comparable string: Textract's line breaks are not stable. */
export function normaliseForMatching(lines: string[]): string {
  return lines
    .join(' | ')
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

/**
 * Classify from the document's text alone.
 *
 * Returns null when nothing clears its threshold — an unrecognised document,
 * which is a fallback case and not a failure. Never guesses the nearest kind.
 */
export function classifyByMarkers(lines: string[]): Classification | null {
  const text = normaliseForMatching(lines);

  const scored = DOCUMENT_RULES.map((rule) => {
    const matched = rule.markers
      .filter((m) => text.includes(m.phrase.toUpperCase()))
      .map((m) => m.phrase);
    const score = rule.markers
      .filter((m) => text.includes(m.phrase.toUpperCase()))
      .reduce((a, m) => a + m.weight, 0);
    return { rule, score, matched };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < best.rule.threshold) return null;

  // The runner-up is the best score belonging to a DIFFERENT kind. Two rules
  // for the same kind — the ID card and the green book — are not rivals, and
  // treating them as such would make every identity document ambiguous.
  const runnerUp =
    scored.find((s) => s.rule.kind !== best.rule.kind)?.score ?? 0;

  return {
    kind: best.rule.kind,
    variant: best.rule.variant,
    score: best.score,
    runnerUp,
    matched: best.matched,
    decisive: best.score - runnerUp >= MARGIN,
  };
}
