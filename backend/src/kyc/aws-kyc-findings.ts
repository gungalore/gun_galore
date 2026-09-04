// backend/src/kyc/aws-kyc-findings.ts
//
// Maps AWS results onto the EXISTING KycClaudeFindings shape, so the whole
// verdict ladder downstream — statusFromFindings, crossCheckIdentity,
// retakeReason, the admin dossier, the persisted JSON — keeps working
// untouched. The cut-over replaces who ANSWERS the questions, not what the
// questions are.
//
// Pure on purpose: no SDK, no Nest, no network. Every rule below is
// testable against the real Textract responses in __fixtures__.
//
// ── THE TWO GATES AWS CANNOT ANSWER ───────────────────────────────────
//
// statusFromFindings treats two scores as INTEGRITY gates — below 50 is an
// instant REJECT, and 70+ is required to auto-verify:
//
//   document.looks_genuine_sa_id   — is the card a forgery?
//   face_match.selfie_live_capture — is the selfie a live person, or a
//                                    photo of a photo / a screen?
//
// Claude answered both by looking. Textract does OCR; Rekognition matches
// faces. NEITHER does anti-spoofing or forgery detection from a still.
//
//   • looks_genuine_sa_id is answered narrowly and honestly by
//     document-integrity.ts — internal consistency, with a written record
//     of what nobody checked.
//
//   • selfie_live_capture has exactly one real answer in AWS: Face
//     Liveness, which is a CHALLENGE-RESPONSE VIDEO SESSION, not a score
//     you can compute from a still image. The browser must run the
//     challenge (AWS Amplify's FaceLivenessDetector) against a session id
//     this backend creates, and only then can GetFaceLivenessSessionResults
//     return a real confidence.
//
// 🚨 SO WHEN NO LIVENESS SESSION RAN, THIS RETURNS "UNKNOWN" (60), NOT 100.
// That is the whole point. 100 would delete the anti-spoofing gate while
// leaving a confident-looking number in the dossier next to the words
// "live capture" — a measurement with no model behind it. The consequence
// of an honest 60 is that sellers park in UNDER_REVIEW for a human instead
// of auto-verifying on a check nobody ran. That is the correct failure
// direction, and it is visible rather than silent.

import type { KycClaudeFindings } from './claude-kyc.service';
import {
  assessDocumentIntegrity,
  type IntegrityAssessment,
} from './document-integrity';
import {
  dobFromIdNumber,
  extractIdentity,
  type TextractResponse,
} from './textract-extract';

/**
 * No liveness challenge ran. Sits between AUTO_REJECT_CEILING (50) and
 * AUTO_APPROVE_FLOOR (70): cannot reject anyone, cannot approve anyone.
 */
export const LIVENESS_NOT_RUN = 60;

export interface FaceComparison {
  /** Highest similarity 0-100. null when no face was found to compare. */
  similarity: number | null;
  /** True when the TARGET image contained no detectable face at all. */
  noFaceInTarget: boolean;
}

export interface AwsScanParts {
  /** Textract AnalyzeDocument response for the identity document. */
  textract: TextractResponse;
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
 * Mean Textract confidence, scaled by how much of the identity actually
 * came out. Raw OCR confidence alone is misleading — a card can average
 * 96% while the ID number itself was never read.
 *
 * The ID number carries double weight because everything downstream keys
 * on it; without one, legibility is held below the RETAKE ceiling no
 * matter how confident the OCR was about the surrounding text.
 */
export function legibilityScore(res: TextractResponse): number {
  const confs = (res.Blocks ?? [])
    .filter((b) => b.BlockType === 'LINE' && typeof b.Confidence === 'number')
    .map((b) => b.Confidence as number);
  const meanConf =
    confs.length > 0 ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;

  const id = extractIdentity(res);
  const weights: [unknown, number][] = [
    [id.idNumber, 2],
    [id.surname, 1],
    [id.names, 1],
    [id.dateOfBirth, 1],
  ];
  const total = weights.reduce((a, [, w]) => a + w, 0);
  const found = weights.reduce((a, [v, w]) => a + (v ? w : 0), 0);

  const scaled = meanConf * (found / total);
  // No ID number means nothing downstream can proceed — force a retake
  // rather than letting confident surrounding text carry the score.
  if (!id.idNumber) return Math.min(scaled, 40);
  return Math.round(scaled);
}

export function buildAwsFindings(parts: AwsScanParts): AwsFindings {
  const id = extractIdentity(parts.textract);
  const legibility = legibilityScore(parts.textract);
  const integrity = assessDocumentIntegrity({
    idNumber: id.idNumber,
    printedDob: id.dateOfBirth,
    dobFromId: id.idNumber ? dobFromIdNumber(id.idNumber) : null,
    documentKind: id.documentType,
    legibility,
  });

  const notes: string[] = [...id.notes];

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
      document_type: id.documentType,
      extracted_id_number: id.idNumber,
      extracted_surname: id.surname,
      extracted_names: id.names,
      extracted_dob: id.dateOfBirth,
      legibility,
      issues: [...integrity.flags, ...id.notes],
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
      ? 'AWS Textract + Rekognition; verdict is decided by statusFromFindings.'
      : 'AWS Textract + Rekognition, NO liveness challenge — anti-spoofing unchecked.',
    provenance: {
      engine: 'aws',
      integrity,
      livenessRan,
      notes,
    },
  };
}
