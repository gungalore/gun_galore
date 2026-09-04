// backend/src/kyc/aws-kyc-findings.spec.ts
//
// End-to-end over the REAL verdict path: a real Textract response for a
// real SA identity document goes in, and the actual statusFromFindings
// that decides a seller's fate comes out. Nothing is stubbed but the face
// scores, which is the only part AWS returns that we cannot capture in a
// fixture.
//
// ClaudeKycService's constructor takes no dependencies, so the verdict can
// be exercised directly without standing up a Nest module. That is worth
// preserving — it is what makes this test possible.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ClaudeKycService } from './claude-kyc.service';
import { crossCheckIdentity } from './kyc-cross-check';
import {
  buildAwsFindings,
  legibilityScore,
  LIVENESS_NOT_RUN,
  type FaceComparison,
} from './aws-kyc-findings';
import type { TextractResponse } from './textract-extract';

const fixture = (name: string): TextractResponse =>
  JSON.parse(
    readFileSync(join(__dirname, '__fixtures__', 'textract', `${name}.json`), 'utf8'),
  );

const GREEN_BOOK = fixture('id-green-book');
const SMART_CARD = fixture('id-smart-card');

const svc = new ClaudeKycService();

const MATCH: FaceComparison = { similarity: 97, noFaceInTarget: false };
const NO_FACE: FaceComparison = { similarity: null, noFaceInTarget: true };

/** Runs the real verdict, with a cross-check that agrees with the document. */
function verdict(
  textract: TextractResponse,
  parts: Partial<Parameters<typeof buildAwsFindings>[0]> = {},
) {
  const findings = buildAwsFindings({
    textract,
    vsDocument: MATCH,
    ...parts,
  });
  const cc = crossCheckIdentity({
    enteredIdNumber: findings.document.extracted_id_number ?? '',
    enteredDob: findings.document.extracted_dob ?? '',
    doc: {
      idNumber: findings.document.extracted_id_number,
      surname: findings.document.extracted_surname,
      names: findings.document.extracted_names,
      dob: findings.document.extracted_dob,
      legibility: findings.document.legibility,
    },
    ha: {
      firstName: findings.document.extracted_names ?? '',
      surname: findings.document.extracted_surname ?? '',
      dob: findings.document.extracted_dob ?? '',
    },
  });
  return { findings, status: svc.statusFromFindings(findings, cc, 'standard') };
}

describe('legibilityScore', () => {
  it('real documents are legible enough NOT to trigger a retake', () => {
    // The retake ceiling is 50. A real document scoring below it would send
    // an honest seller round the camera loop forever.
    expect(legibilityScore(GREEN_BOOK)).toBeGreaterThanOrEqual(50);
    expect(legibilityScore(SMART_CARD)).toBeGreaterThanOrEqual(50);
  });

  it('confident OCR with no ID number is still a retake', () => {
    // The failure mode this guards: a card averaging 96% confidence where
    // the one field everything downstream needs was never read.
    const noId: TextractResponse = {
      Blocks: [
        { BlockType: 'LINE', Text: 'REPUBLIC OF SOUTH AFRICA', Confidence: 99 },
        { BlockType: 'LINE', Text: 'SURNAME', Confidence: 99 },
      ],
    } as TextractResponse;
    expect(legibilityScore(noId)).toBeLessThan(50);
  });
});

describe('buildAwsFindings — the gates AWS cannot answer', () => {
  // 🚨 THE CENTRAL TEST OF THE CUT-OVER. With no liveness challenge run,
  // anti-spoofing was not checked. Auto-verifying here would mean the gate
  // was deleted silently.
  it('will NOT auto-verify when no liveness challenge ran', () => {
    const { findings, status } = verdict(GREEN_BOOK);
    expect(findings.face_match.selfie_live_capture).toBe(LIVENESS_NOT_RUN);
    expect(findings.provenance.livenessRan).toBe(false);
    expect(status).not.toBe('VERIFIED');
  });

  // The opposite error: an honest seller must not be ACCUSED because a
  // check nobody ran came back unknown.
  it('does not reject anyone merely because liveness was not checked', () => {
    expect(verdict(GREEN_BOOK).status).not.toBe('REJECTED');
    expect(verdict(SMART_CARD).status).not.toBe('REJECTED');
  });

  it('auto-verifies a real document once a liveness challenge passes', () => {
    const { status } = verdict(GREEN_BOOK, { livenessConfidence: 96 });
    expect(status).toBe('VERIFIED');
  });

  it('a failed liveness challenge rejects', () => {
    const { status } = verdict(GREEN_BOOK, { livenessConfidence: 12 });
    expect(status).toBe('REJECTED');
  });

  it('says in writing that liveness was not checked', () => {
    const { findings } = verdict(GREEN_BOOK);
    expect(findings.provenance.notes.join(' ')).toMatch(/NO LIVENESS CHALLENGE RAN/);
    expect(findings.recommendation_reason).toMatch(/anti-spoofing unchecked/i);
  });

  it('records that the artwork was never inspected', () => {
    const { findings } = verdict(GREEN_BOOK);
    expect(findings.provenance.engine).toBe('aws');
    expect(findings.provenance.integrity.source).toBe('rules');
    expect(findings.provenance.integrity.notChecked.join(' ')).toMatch(/artwork/i);
  });
});

describe('buildAwsFindings — face results', () => {
  it('an unreadable document photo asks for a retake, not a rejection', () => {
    const { findings, status } = verdict(GREEN_BOOK, {
      vsDocument: NO_FACE,
      livenessConfidence: 96,
    });
    expect(findings.face_match.document_photo_visible).toBe(0);
    expect(status).toBe('RETAKE');
  });

  it('a confident face mismatch rejects', () => {
    const { status } = verdict(GREEN_BOOK, {
      vsDocument: { similarity: 8, noFaceInTarget: false },
      livenessConfidence: 96,
    });
    expect(status).toBe('REJECTED');
  });

  it('carries the Home Affairs comparison through when one was made', () => {
    const { findings } = verdict(GREEN_BOOK, {
      vsHomeAffairs: { similarity: 91, noFaceInTarget: false },
    });
    expect(findings.face_match.same_person_vs_ha_photo).toBe(91);
  });

  it('omits the Home Affairs score entirely when no comparison was made', () => {
    // Must be ABSENT, not 0 — the anchored gate reads 0 as a failed match.
    const { findings } = verdict(GREEN_BOOK);
    expect('same_person_vs_ha_photo' in findings.face_match).toBe(false);
  });

  it('overall_confidence never exceeds the weakest gate', () => {
    const { findings } = verdict(GREEN_BOOK);
    expect(findings.overall_confidence).toBeLessThanOrEqual(
      findings.face_match.selfie_live_capture,
    );
  });
});
