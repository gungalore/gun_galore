// backend/src/kyc/aws-kyc-findings.ts
//
// Maps the AWS + Gemini reading onto the EXISTING KycClaudeFindings shape,
// so the whole verdict ladder downstream — statusFromFindings,
// crossCheckIdentity, retakeReason, the admin dossier, the persisted JSON —
// keeps working untouched. The cut-over replaces who ANSWERS the questions,
// not what the questions are.
//
// ⚠️ TEXTRACT LEFT 2026-09-08. Operator: "we will also be losing AWS
// textract and only be using gemini going forward. Gemini can write
// straight into json and you can make it work from there." The identity
// document is now read by AwsKycService.readIdentityDocument() (a Gemini
// call, JSON-schema enforced) instead of Textract's AnalyzeDocument — see
// that method's comment for what a schema can and cannot guarantee. This
// file's job did not change: turn a document reading plus two face
// comparisons into the same KycClaudeFindings shape the older Claude-vision
// flow produced. textract-extract.ts (the pure OCR-parsing module, and its
// six-real-document regression suite) is deleted along with it — there is
// no separate parsing layer any more, because the model now writes straight
// into the ExtractedIdentity shape below rather than a raw provider
// response this file had to parse.
//
// Pure on purpose: no SDK, no Nest, no network. What is no longer testable
// here: __fixtures__/textract/*.json was six of the operator's own real
// documents run through Textract, and it exercised the parsing quirks of
// THAT reader — a page number glued onto a value, a box border read as a
// digit. None of that transfers to a Gemini JSON reading (flagged as an
// open item in docs/design/licence-centre/PHASE-0-PLAN.md §1B), so
// aws-kyc-findings.spec.ts now exercises this file's own logic — scoring,
// the verdict ladder — against hand-built ExtractedIdentity fixtures rather
// than parsed Textract JSON. The real-document regression corpus is gone
// until someone rebuilds it against the new reader; that is not done here.
//
// ── THE TWO GATES NEITHER PROVIDER CAN ANSWER ─────────────────────────
//
// statusFromFindings treats two scores as INTEGRITY gates — below 50 is an
// instant REJECT, and 70+ is required to auto-verify:
//
//   document.looks_genuine_sa_id   — is the card a forgery?
//   face_match.selfie_live_capture — is the selfie a live person, or a
//                                    photo of a photo / a screen?
//
// Claude used to answer both by looking. Gemini now reads the document;
// Rekognition matches faces. NEITHER does anti-spoofing or forgery
// detection from a still — that was true of Textract before, and it is
// equally true of Gemini now, so the gap this section describes is
// UNCHANGED by the 2026-09-08 cut-over:
//
//   • looks_genuine_sa_id is answered narrowly and honestly by
//     document-integrity.ts — internal consistency, with a written record
//     of what nobody checked.
//
//   • selfie_live_capture has exactly one real answer available: AWS Face
//     Liveness, which is a CHALLENGE-RESPONSE VIDEO SESSION, not a score
//     you can compute from a still image. The browser must run the
//     challenge (AWS Amplify's FaceLivenessDetector) against a session id
//     this backend creates, and only then can GetFaceLivenessSessionResults
//     return a real confidence. This stays on AWS — see aws-kyc.service.ts.
//
// 🚨 SO WHEN NO LIVENESS SESSION RAN, THIS RETURNS "UNKNOWN" (60), NOT 100.
// That is the whole point. 100 would delete the anti-spoofing gate while
// leaving a confident-looking number in the dossier next to the words
// "live capture" — a measurement with no model behind it. The consequence
// of an honest 60 is that sellers park in UNDER_REVIEW for a human instead
// of auto-verifying on a check nobody ran. That is the correct failure
// direction, and it is visible rather than silent.

import type { KycClaudeFindings } from './kyc-model.service';
import {
  assessDocumentIntegrity,
  type IntegrityAssessment,
} from './document-integrity';
import { readSaId } from '../motivations/sa-id';

/**
 * No liveness challenge ran. Sits between AUTO_REJECT_CEILING (50) and
 * AUTO_APPROVE_FLOOR (70): cannot reject anyone, cannot approve anyone.
 */
export const LIVENESS_NOT_RUN = 60;

export type DocumentKind = 'SMART_ID_CARD' | 'GREEN_BOOK' | 'OTHER';

/**
 * What AwsKycService.readIdentityDocument() reads off the identity
 * document. The model writes straight into this shape — `json.schema`
 * enforces it on the way in — so there is no separate raw-provider-response
 * type to parse any more, unlike the TextractResponse this replaced.
 */
export interface ExtractedIdentity {
  documentType: DocumentKind;
  /**
   * A Luhn-valid 13-digit SA ID number, or null.
   *
   * ⚠️ ALREADY VALIDATED BY THE TIME IT GETS HERE. readIdentityDocument()
   * runs readSaId() (motivations/sa-id.ts) on whatever the model reports
   * and nulls the field out on a checksum failure BEFORE this object is
   * built — a schema enforces shape, never semantics, so a well-formed
   * 13-digit string that is not a real SA ID number must never survive
   * into this field. Every function below is entitled to assume that.
   */
  idNumber: string | null;
  surname: string | null;
  names: string | null;
  /**
   * YYYY-MM-DD, or null. The document's own printed date when the model
   * could read one; falls back to the date the ID number's own digits
   * imply when it could not (readIdentityDocument computes both and notes
   * it in `notes` when the two disagree — see dobFromIdNumber below).
   */
  dateOfBirth: string | null;
  /** What was discarded, backfilled or flagged on the way, for the audit row. */
  notes: string[];
}

export interface FaceComparison {
  /** Highest similarity 0-100. null when no face was found to compare. */
  similarity: number | null;
  /** True when the TARGET image contained no detectable face at all. */
  noFaceInTarget: boolean;
}

export interface AwsScanParts {
  /** The identity document, already read by Gemini and Luhn-checked. */
  identity: ExtractedIdentity;
  /** Rekognition CompareFaces: selfie vs the photo on the document. */
  vsDocument: FaceComparison;
  /** Rekognition CompareFaces: selfie vs the official Home Affairs photo. */
  vsHomeAffairs?: FaceComparison;
  /**
   * Face Liveness confidence 0-100 from a COMPLETED session, or undefined
   * when no challenge ran. Never invent a value here.
   */
  livenessConfidence?: number;
}

export interface AwsFindings extends KycClaudeFindings {
  /**
   * Provenance. Persisted with the findings so nobody reading a dossier
   * mistakes a rule-based integrity score for the vision judgement it
   * replaced, or an un-run liveness gate for a passed one.
   */
  provenance: {
    engine: 'aws';
    integrity: IntegrityAssessment;
    livenessRan: boolean;
    notes: string[];
  };
}

/**
 * The birth date an SA ID number's own YYMMDD prefix implies, as
 * 'YYYY-MM-DD', or null when the number is not Luhn-valid.
 *
 * ⚠️ WAS ITS OWN CENTURY-GUESSING IMPLEMENTATION IN textract-extract.ts
 * (deleted 2026-09-08 with the rest of that file — it compared against
 * "the century that does not put the birth in the future"). This now
 * defers to readSaId() in motivations/sa-id.ts instead, which picks the
 * century that yields a PLAUSIBLE ADULT (age 16-120). That is a different
 * rule, deliberately: it is the SAME rule the licence stack already applies
 * to every ID number a member types in, and a KYC-verified seller is an
 * adult by construction, so one rule doing this judgement is better than
 * two independently-tuned copies of it living a few directories apart.
 */
export function dobFromIdNumber(idNumber: string): string | null {
  const facts = readSaId(idNumber);
  if (!facts.valid || !facts.dateOfBirth) return null;
  const d = facts.dateOfBirth;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * ⚠️⚠️⚠️ THIS FUNCTION MEASURES SOMETHING NARROWER THAN ITS NAME SUGGESTS,
 * SINCE THE 2026-09-08 GEMINI CUT-OVER — READ THIS BEFORE TOUCHING IT.
 *
 * WHAT IT USED TO MEASURE. Against Textract, this was mean OCR confidence
 * (Block.Confidence, averaged over every LINE) SCALED by how many of the
 * four identity fields were actually found. Confidence was Textract's own
 * signal for "how sure am I that I read these pixels correctly" — a real
 * measurement, independent of whether the text made sense. A card
 * photographed at an angle, half in shadow, scored low even when every
 * field happened to come out right, because the OCR engine itself was
 * unsure it had read them correctly.
 *
 * WHAT REPLACED IT, AND WHY. A vision-language model reports no such
 * signal. It exposes no per-character or per-line confidence the way an
 * OCR engine does, and asking it to invent one — "on a scale of 0-100, how
 * sure are you?" — would not be a measurement, it would be the model
 * grading its own homework: a number with no calibration behind it, shaped
 * like data but answering nothing. So that half of the score is simply
 * GONE, not approximated. What is left is exactly what the name still
 * says: field completeness, on the same 2/1/1/1 weighting
 * (idNumber/surname/names/dateOfBirth) this function always used for that
 * half, now scaled to 0-100 on its own rather than multiplied against a
 * confidence figure that no longer exists.
 *
 * THE CONSEQUENCE, STATED PLAINLY SO NOBODY HAS TO REDISCOVER IT. This is
 * now a COMPLETENESS measure, not a LEGIBILITY one, and the two can point
 * in opposite directions. A smudged, glared or badly-lit document that the
 * model reads WRONGLY but CONFIDENTLY — a 6 misread as an 8, a blurred
 * surname the model fills in with its best guess rather than reporting
 * null — will report all four fields "found" and score 100 here, exactly
 * as if the document were pristine. Textract's low per-line confidence on
 * that same photograph would have caught it and forced a RETAKE; this
 * function cannot, because nothing upstream of it any longer says how sure
 * the reader was — only whether it was willing to answer at all. THAT IS A
 * REAL REDUCTION IN WHAT THIS NUMBER CAN TELL YOU, not a wash.
 *
 * What still catches SOME of that: the model is instructed to output null
 * rather than guess (see IDENTITY_READ_SYSTEM_PROMPT in aws-kyc.service.ts),
 * so an honest "I can't read this" still shows up as a missing field and
 * still scores low. What is lost is the case where the model is confidently
 * WRONG rather than honestly uncertain. Textract could not tell a right
 * reading from a wrong one either — no OCR engine can — but its confidence
 * figure at least correlated with image quality, which gave the
 * smudged-document case a real chance of being caught before it reached a
 * human. This function no longer has that signal at all.
 *
 * Do not "restore" it by asking the model for a confidence score — see the
 * reasoning above for why that would be theatre wearing a number's clothes.
 * If this gap ever needs closing, the fix is a real, independent
 * measurement computed on the bytes themselves (an image-sharpness or
 * blur metric, for instance) — never a bigger prompt asking the reader to
 * mark its own work.
 */
export function legibilityScore(identity: ExtractedIdentity): number {
  const weights: [unknown, number][] = [
    [identity.idNumber, 2],
    [identity.surname, 1],
    [identity.names, 1],
    [identity.dateOfBirth, 1],
  ];
  const total = weights.reduce((a, [, w]) => a + w, 0);
  const found = weights.reduce((a, [v, w]) => a + (v ? w : 0), 0);
  const scaled = (found / total) * 100;

  // No ID number means nothing downstream can proceed — force a retake
  // rather than letting confident surrounding text carry the score. KEEP
  // THIS EXACTLY AS IT IS: it matters MORE now that the OCR-confidence half
  // is gone, not less — it is the one thing left that can still force a
  // retake on its own.
  if (!identity.idNumber) return Math.min(scaled, 40);
  return Math.round(scaled);
}

export function buildAwsFindings(parts: AwsScanParts): AwsFindings {
  const { identity } = parts;
  const legibility = legibilityScore(identity);
  const integrity = assessDocumentIntegrity({
    idNumber: identity.idNumber,
    printedDob: identity.dateOfBirth,
    dobFromId: identity.idNumber ? dobFromIdNumber(identity.idNumber) : null,
    documentKind: identity.documentType,
    legibility,
  });

  const notes: string[] = [...identity.notes];

  // "Clear enough to compare against" is best answered by whether the
  // comparison actually worked, rather than by an invented sharpness
  // threshold: if Rekognition found and used the face, it was usable.
  const documentPhotoVisible = parts.vsDocument.noFaceInTarget ? 0 : 95;
  if (parts.vsDocument.noFaceInTarget) {
    notes.push('no face could be detected in the photo on the identity document');
  }

  const livenessRan = typeof parts.livenessConfidence === 'number';
  if (!livenessRan) {
    notes.push(
      'NO LIVENESS CHALLENGE RAN — anti-spoofing was not checked. Scored 60 (unknown): cannot reject, cannot auto-approve. Requires an AWS Face Liveness session driven by the browser.',
    );
  }

  const faceIssues: string[] = [];
  if (parts.vsDocument.noFaceInTarget) {
    faceIssues.push('the photo on your ID could not be found or is not clear enough');
  }
  if (!livenessRan) {
    faceIssues.push('liveness was not checked');
  }

  return {
    face_match: {
      same_person: parts.vsDocument.similarity ?? 0,
      selfie_live_capture: parts.livenessConfidence ?? LIVENESS_NOT_RUN,
      document_photo_visible: documentPhotoVisible,
      ...(parts.vsHomeAffairs
        ? { same_person_vs_ha_photo: parts.vsHomeAffairs.similarity ?? 0 }
        : {}),
      issues: faceIssues,
    },
    document: {
      looks_genuine_sa_id: integrity.score,
      document_type: identity.documentType,
      extracted_id_number: identity.idNumber,
      extracted_surname: identity.surname,
      extracted_names: identity.names,
      extracted_dob: identity.dateOfBirth,
      legibility,
      issues: [...integrity.flags, ...identity.notes],
    },
    // Deliberately the MINIMUM of the gates rather than an average: an
    // average lets a strong face match paper over an unchecked liveness
    // gate, which is exactly the impression this file exists to prevent.
    overall_confidence: Math.min(
      parts.vsDocument.similarity ?? 0,
      integrity.score,
      parts.livenessConfidence ?? LIVENESS_NOT_RUN,
      legibility,
    ),
    // The real verdict is statusFromFindings'. This field is advisory and
    // must never read as more certain than the weakest gate.
    recommendation: 'ADMIN_REVIEW',
    recommendation_reason: livenessRan
      ? 'Gemini document read + AWS Rekognition; verdict is decided by statusFromFindings.'
      : 'Gemini document read + AWS Rekognition, NO liveness challenge — anti-spoofing unchecked.',
    provenance: {
      engine: 'aws',
      integrity,
      livenessRan,
      notes,
    },
  };
}
