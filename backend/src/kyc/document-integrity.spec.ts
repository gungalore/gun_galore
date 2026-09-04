// backend/src/kyc/document-integrity.spec.ts
//
// These tests are written against the GATE, not against the numbers. The
// score is only ever consumed by statusFromFindings, which reads it in
// three bands, so the bands are what must hold — a later tweak from 75 to
// 80 is free, a tweak from 55 to 45 silently starts rejecting people.

import { assessDocumentIntegrity } from './document-integrity';

// Mirrors claude-kyc.service.ts. Duplicated deliberately: if those move,
// these tests should fail and force someone to look here.
const AUTO_APPROVE_FLOOR = 70;
const AUTO_REJECT_CEILING = 50;

const rejects = (n: number) => n < AUTO_REJECT_CEILING;
const canVerify = (n: number) => n >= AUTO_APPROVE_FLOOR;

const GOOD = {
  idNumber: '9707240045089',
  printedDob: '1997-07-24',
  dobFromId: '1997-07-24',
  documentKind: 'GREEN_BOOK' as const,
  legibility: 92,
};

describe('assessDocumentIntegrity', () => {
  it('a consistent document can auto-verify', () => {
    const r = assessDocumentIntegrity(GOOD);
    expect(canVerify(r.score)).toBe(true);
    expect(rejects(r.score)).toBe(false);
  });

  it('NEVER claims certainty — the artwork was never inspected', () => {
    const r = assessDocumentIntegrity(GOOD);
    expect(r.score).toBeLessThan(100);
    expect(r.source).toBe('rules');
    // The record must SAY what nobody checked, not merely omit it.
    expect(r.notChecked.join(' ')).toMatch(/artwork|coat of arms/i);
  });

  // 🚨 THE REGRESSION THIS MODULE EXISTS TO PREVENT. The integrity gate is
  // evaluated BEFORE the legibility gate, so scoring an unreadable document
  // 0 would reject an honest seller with a bad camera for forgery, and they
  // would never reach the RETAKE that was the correct answer.
  it('an unreadable document is NOT rejected — it must fall through to RETAKE', () => {
    const r = assessDocumentIntegrity({
      idNumber: null,
      printedDob: null,
      dobFromId: null,
      documentKind: null,
      legibility: 18,
    });
    expect(rejects(r.score)).toBe(false);
    expect(canVerify(r.score)).toBe(false);
    expect(r.checked).toHaveLength(0);
  });

  it('a contradicted date of birth blocks auto-approval but does not auto-reject', () => {
    const r = assessDocumentIntegrity({
      ...GOOD,
      printedDob: '1985-01-02',
    });
    expect(canVerify(r.score)).toBe(false);
    // OCR can misread a printed date. A human looks; we do not accuse.
    expect(rejects(r.score)).toBe(false);
    expect(r.flags.join(' ')).toMatch(/contradicts/);
  });

  it('an unrecognised layout blocks auto-approval', () => {
    const r = assessDocumentIntegrity({ ...GOOD, documentKind: 'OTHER' });
    expect(canVerify(r.score)).toBe(false);
    expect(r.flags.join(' ')).toMatch(/recognised SA ID layout/);
  });

  it('a missing printed date is recorded as unchecked, not as a contradiction', () => {
    const r = assessDocumentIntegrity({ ...GOOD, printedDob: null });
    // Not a flag — absence of evidence is not evidence of tampering.
    expect(r.flags).toHaveLength(0);
    expect(canVerify(r.score)).toBe(true);
    expect(r.notChecked.join(' ')).toMatch(/could not be compared/);
  });

  it('records the check-digit test as having actually run', () => {
    const r = assessDocumentIntegrity(GOOD);
    expect(r.checked.join(' ')).toMatch(/check-digit|Luhn/i);
  });
});
