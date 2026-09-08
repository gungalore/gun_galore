// backend/src/kyc/aws-kyc-findings.spec.ts
//
// End-to-end over the REAL verdict path: an ExtractedIdentity reading goes
// in, and the actual statusFromFindings that decides a seller's fate comes
// out. Nothing is stubbed but the face scores, which is the only part AWS
// returns that we cannot capture in a fixture.
//
// ⚠️ NO LONGER PARSED FROM THE SIX REAL __fixtures__/textract/*.json FILES.
// Those were real Textract AnalyzeDocument responses and exercised THAT
// reader's own parsing quirks — a page number glued onto a value, a box
// border read as a digit. None of that transfers to a Gemini JSON reading,
// so it does not belong in this file's coverage any more (an open item
// flagged in docs/design/licence-centre/PHASE-0-PLAN.md §1B: a real-document
// regression corpus against the new reader still needs building, and this
// suite does not attempt to invent one). What follows instead is HAND-BUILT
// ExtractedIdentity fixtures using the same two real documents' known
// values — the operator's own green book and smart card, same numbers the
// deleted textract-extract.spec.ts asserted — so the verdict ladder below
// is still exercised against real, Luhn-valid SA ID numbers rather than
// arbitrary invented ones.
//
// KycModelService's constructor takes nothing REQUIRED — the model is an
// optional argument, and none of the verdict methods touch it — so the
// verdict can be exercised directly without standing up a Nest module. That
// is worth preserving: it is what makes this test possible, and it is why
// LlmService was made optional rather than required when the service moved
// off the Anthropic SDK on 2026-09-07.

import { KycModelService } from './kyc-model.service';
import { crossCheckIdentity } from './kyc-cross-check';
import {
  buildAwsFindings,
  dobFromIdNumber,
  legibilityScore,
  LIVENESS_NOT_RUN,
  type ExtractedIdentity,
  type FaceComparison,
} from './aws-kyc-findings';

// The operator's own green book — the same real, Luhn-valid document
// textract-extract.spec.ts used to read via Textract's raw JSON before it
// was deleted 2026-09-08. Values unchanged: surname DE BEER, names RUANDA,
// born 1997-07-24.
const GREEN_BOOK_IDENTITY: ExtractedIdentity = {
  documentType: 'GREEN_BOOK',
  idNumber: '9707240045089',
  surname: 'DE BEER',
  names: 'RUANDA',
  dateOfBirth: '1997-07-24',
  notes: [],
};

// The operator's own smart ID card. Surname FOURIE, names PETRUS WILLEM
// ADRIAAN, born 1959-04-01.
const SMART_CARD_IDENTITY: ExtractedIdentity = {
  documentType: 'SMART_ID_CARD',
  idNumber: '5904015035080',
  surname: 'FOURIE',
  names: 'PETRUS WILLEM ADRIAAN',
  dateOfBirth: '1959-04-01',
  notes: [],
};

const svc = new KycModelService();

const MATCH: FaceComparison = { similarity: 97, noFaceInTarget: false };
const NO_FACE: FaceComparison = { similarity: null, noFaceInTarget: true };

/** Runs the real verdict, with a cross-check that agrees with the document. */
function verdict(
  identity: ExtractedIdentity,
  parts: Partial<Parameters<typeof buildAwsFindings>[0]> = {},
) {
  const findings = buildAwsFindings({
    identity,
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

describe('legibilityScore — field completeness only, since the 2026-09-08 Gemini cut-over', () => {
  it('a fully-read real document scores full marks', () => {
    expect(legibilityScore(GREEN_BOOK_IDENTITY)).toBe(100);
    expect(legibilityScore(SMART_CARD_IDENTITY)).toBe(100);
  });

  it('three fields read, but no ID number, is still a retake', () => {
    // The failure mode this guards: everything BUT the one field everything
    // downstream needs came out — whether because the model could not read
    // it, or because it read something that failed readSaId's Luhn check
    // upstream in readIdentityDocument(). Either way it arrives here null,
    // and that is deliberately worth more than three clean fields.
    const noId: ExtractedIdentity = {
      documentType: 'SMART_ID_CARD',
      idNumber: null,
      surname: 'FOURIE',
      names: 'PETRUS WILLEM ADRIAAN',
      dateOfBirth: '1959-04-01',
      notes: [],
    };
    expect(legibilityScore(noId)).toBeLessThan(50);
    // (3 of 5 weight) * 100 = 60, capped at 40 because idNumber is null.
    expect(legibilityScore(noId)).toBe(40);
  });

  it('caps at 40 even when nothing else was read either', () => {
    const nothing: ExtractedIdentity = {
      documentType: 'OTHER',
      idNumber: null,
      surname: null,
      names: null,
      dateOfBirth: null,
      notes: [],
    };
    expect(legibilityScore(nothing)).toBe(0);
  });

  it('an ID number alone scores 40 uncapped — the cap only ever LOWERS a score', () => {
    const idOnly: ExtractedIdentity = {
      documentType: 'OTHER',
      idNumber: '9707240045089',
      surname: null,
      names: null,
      dateOfBirth: null,
      notes: [],
    };
    // idNumber carries weight 2 of 5 -> 40. The cap in legibilityScore only
    // fires when idNumber is MISSING, so a present ID number is never
    // pulled down by it, even alone.
    expect(legibilityScore(idOnly)).toBe(40);
  });
});

describe('dobFromIdNumber', () => {
  it('reads the date the digits themselves imply', () => {
    expect(dobFromIdNumber('9707240045089')).toBe('1997-07-24');
    expect(dobFromIdNumber('5904015035080')).toBe('1959-04-01');
  });

  it('refuses a checksum-broken number outright', () => {
    expect(dobFromIdNumber('9707240045088')).toBeNull();
  });
});

describe('buildAwsFindings — the gates neither provider can answer', () => {
  // 🚨 THE CENTRAL TEST OF THE CUT-OVER. With no liveness challenge run,
  // anti-spoofing was not checked. Auto-verifying here would mean the gate
  // was deleted silently.
  it('will NOT auto-verify when no liveness challenge ran', () => {
    const { findings, status } = verdict(GREEN_BOOK_IDENTITY);
    expect(findings.face_match.selfie_live_capture).toBe(LIVENESS_NOT_RUN);
    expect(findings.provenance.livenessRan).toBe(false);
    expect(status).not.toBe('VERIFIED');
  });

  // The opposite error: an honest seller must not be ACCUSED because a
  // check nobody ran came back unknown.
  it('does not reject anyone merely because liveness was not checked', () => {
    expect(verdict(GREEN_BOOK_IDENTITY).status).not.toBe('REJECTED');
    expect(verdict(SMART_CARD_IDENTITY).status).not.toBe('REJECTED');
  });

  it('auto-verifies a real document once a liveness challenge passes', () => {
    const { status } = verdict(GREEN_BOOK_IDENTITY, { livenessConfidence: 96 });
    expect(status).toBe('VERIFIED');
  });

  it('a failed liveness challenge rejects', () => {
    const { status } = verdict(GREEN_BOOK_IDENTITY, { livenessConfidence: 12 });
    expect(status).toBe('REJECTED');
  });

  it('says in writing that liveness was not checked', () => {
    const { findings } = verdict(GREEN_BOOK_IDENTITY);
    expect(findings.provenance.notes.join(' ')).toMatch(/NO LIVENESS CHALLENGE RAN/);
    expect(findings.recommendation_reason).toMatch(/anti-spoofing unchecked/i);
  });

  it('records that the artwork was never inspected', () => {
    const { findings } = verdict(GREEN_BOOK_IDENTITY);
    expect(findings.provenance.engine).toBe('aws');
    expect(findings.provenance.integrity.source).toBe('rules');
    expect(findings.provenance.integrity.notChecked.join(' ')).toMatch(/artwork/i);
  });

  it('flags a printed date of birth that disagrees with the ID number digits', () => {
    const mismatched: ExtractedIdentity = {
      ...GREEN_BOOK_IDENTITY,
      dateOfBirth: '1990-01-01', // the ID number's own digits say 1997-07-24
    };
    const findings = buildAwsFindings({
      identity: mismatched,
      vsDocument: MATCH,
      livenessConfidence: 96,
    });
    expect(findings.document.issues.join(' ')).toMatch(/contradicts/i);
  });
});

describe('buildAwsFindings — face results', () => {
  it('an unreadable document photo asks for a retake, not a rejection', () => {
    const { findings, status } = verdict(GREEN_BOOK_IDENTITY, {
      vsDocument: NO_FACE,
      livenessConfidence: 96,
    });
    expect(findings.face_match.document_photo_visible).toBe(0);
    expect(status).toBe('RETAKE');
  });

  it('a confident face mismatch rejects', () => {
    const { status } = verdict(GREEN_BOOK_IDENTITY, {
      vsDocument: { similarity: 8, noFaceInTarget: false },
      livenessConfidence: 96,
    });
    expect(status).toBe('REJECTED');
  });

  it('carries the Home Affairs comparison through when one was made', () => {
    const { findings } = verdict(GREEN_BOOK_IDENTITY, {
      vsHomeAffairs: { similarity: 91, noFaceInTarget: false },
    });
    expect(findings.face_match.same_person_vs_ha_photo).toBe(91);
  });

  it('omits the Home Affairs score entirely when no comparison was made', () => {
    // Must be ABSENT, not 0 — the anchored gate reads 0 as a failed match.
    const { findings } = verdict(GREEN_BOOK_IDENTITY);
    expect('same_person_vs_ha_photo' in findings.face_match).toBe(false);
  });

  it('overall_confidence never exceeds the weakest gate', () => {
    const { findings } = verdict(GREEN_BOOK_IDENTITY);
    expect(findings.overall_confidence).toBeLessThanOrEqual(
      findings.face_match.selfie_live_capture,
    );
  });
});
