import { MotivationLicenceType, MotivationUploadKind } from '@prisma/client';
import { documentStatus } from './motivation-documents';

// The point of this module is to name what is missing instead of saying
// "some documents are missing", because the alternative to naming them is a
// wasted trip to a police station. And to accept things nobody asked for
// without making the applicant feel they got it wrong.

const S13 = MotivationLicenceType.S13_SELF_DEFENCE;
const S16 = MotivationLicenceType.S16_DEDICATED_HUNTER;
const K = MotivationUploadKind;

describe('what SAPS will not process without', () => {
  it('names the specific documents still missing', () => {
    const s = documentStatus(S13, [K.IDENTITY_DOCUMENT]);
    expect(s.missingRequired).toEqual([
      K.COMPETENCY_CERTIFICATE,
      K.ADDRESS_CONFIRMATION,
      K.SAFE_PHOTO,
    ]);
    expect(s.requiredHave).toBe(1);
    expect(s.requiredTotal).toBe(4);
  });

  it('is satisfied once they are all there', () => {
    const s = documentStatus(S13, [
      K.IDENTITY_DOCUMENT,
      K.COMPETENCY_CERTIFICATE,
      K.ADDRESS_CONFIRMATION,
      K.SAFE_PHOTO,
    ]);
    expect(s.missingRequired).toEqual([]);
    expect(s.requiredHave).toBe(s.requiredTotal);
  });

  it('demands the safe photographs on every licence type', () => {
    // Operator, 2026-08-19: three photographs of the safe, not optional.
    for (const t of Object.values(MotivationLicenceType)) {
      expect(documentStatus(t, []).missingRequired).toContain(K.SAFE_PHOTO);
    }
  });

  it('counts KINDS, not files — three safe photographs are one need', () => {
    const s = documentStatus(S13, [K.SAFE_PHOTO, K.SAFE_PHOTO, K.SAFE_PHOTO]);
    const safe = s.needs.find((n) => n.kind === K.SAFE_PHOTO)!;
    expect(safe.have).toBe(true);
  });

  it('requires association proof for a dedicated application, not for s13', () => {
    // Dedicated status IS the basis of a section 16 case, so it stops being a
    // nicety. A self-defence applicant has no association to prove.
    expect(documentStatus(S16, []).missingRequired).toContain(K.ASSOCIATION_CARD);
    expect(documentStatus(S13, []).missingRequired).not.toContain(
      K.ASSOCIATION_CARD,
    );
  });

  it('asks a renewal for the licence being renewed', () => {
    expect(
      documentStatus(MotivationLicenceType.S24_RENEWAL, []).missingRequired,
    ).toContain(K.CURRENT_LICENCE);
  });
});

describe('the things that strengthen it', () => {
  it('are listed but never counted as missing requirements', () => {
    // An incident report is what makes a self-defence motivation land; its
    // absence is not a reason SAPS turns someone away.
    const s = documentStatus(S13, []);
    const incident = s.needs.find((n) => n.kind === K.INCIDENT_REPORT)!;
    expect(incident.tier).toBe('strengthens');
    expect(s.missingRequired).not.toContain(K.INCIDENT_REPORT);
  });

  it('explain themselves in the applicant\'s terms', () => {
    const s = documentStatus(S13, []);
    const safe = s.needs.find((n) => n.kind === K.SAFE_PHOTO)!;
    expect(safe.why).toMatch(/three photographs/i);
    const incident = s.needs.find((n) => n.kind === K.INCIDENT_REPORT)!;
    expect(incident.why).toMatch(/more weight than general crime figures/i);
  });

  it('gives every listed need a label and a reason', () => {
    for (const t of Object.values(MotivationLicenceType)) {
      for (const n of documentStatus(t, []).needs) {
        expect(n.label).toBeTruthy();
        expect(n.why).toBeTruthy();
      }
    }
  });
});

// THE LICENCES FOR FIREARMS THEY ALREADY HOLD.
//
// Operator, 2026-08-19: "all current licences (if applicable, might be a first
// time application), all these are not optional." So: required when they own
// something, never mentioned when they do not.
describe('the licences for what they already own', () => {
  const OWNS = { existing_firearm_1_calibre: '.308 Winchester' };

  it('is required once they tell us they own a firearm', () => {
    const s = documentStatus(S13, [], OWNS);
    expect(s.missingRequired).toContain(K.CURRENT_LICENCE);
    expect(s.needs.find((n) => n.kind === K.CURRENT_LICENCE)!.tier).toBe(
      'required',
    );
  });

  it('is never asked of a first-time applicant', () => {
    // Somebody applying for their first firearm has no licence to produce, and
    // a requirement they cannot satisfy reads as a rejection.
    const s = documentStatus(S13, []);
    expect(s.missingRequired).not.toContain(K.CURRENT_LICENCE);
    expect(s.needs.some((n) => n.kind === K.CURRENT_LICENCE)).toBe(false);
  });

  it('ignores an empty calibre row — a blank answer is not ownership', () => {
    const s = documentStatus(S13, [], { existing_firearm_1_calibre: '  ' });
    expect(s.missingRequired).not.toContain(K.CURRENT_LICENCE);
  });

  it('is satisfied by the upload, not counted as an extra', () => {
    const s = documentStatus(S13, [K.CURRENT_LICENCE], OWNS);
    expect(s.missingRequired).not.toContain(K.CURRENT_LICENCE);
    expect(s.extras).toEqual([]);
  });

  it('does not double up on a renewal, which already required it', () => {
    const s = documentStatus(MotivationLicenceType.S24_RENEWAL, [], OWNS);
    expect(s.needs.filter((n) => n.kind === K.CURRENT_LICENCE)).toHaveLength(1);
  });
});

describe('documents nobody asked for', () => {
  it('accepts them and reports them as extras, not as errors', () => {
    // Someone attaching a range record or a letter from their farm manager
    // must never be told it does not belong.
    const s = documentStatus(S13, [
      K.IDENTITY_DOCUMENT,
      K.EMPLOYMENT_CONFIRMATION,
      K.PREVIOUS_MOTIVATION,
      K.OTHER,
    ]);
    expect(s.extras).toEqual(
      expect.arrayContaining([
        K.EMPLOYMENT_CONFIRMATION,
        K.PREVIOUS_MOTIVATION,
        K.OTHER,
      ]),
    );
    // …and they do not pretend to satisfy anything that was required.
    expect(s.missingRequired).toContain(K.COMPETENCY_CERTIFICATE);
  });

  it('does not report an asked-for document as an extra', () => {
    const s = documentStatus(S13, [K.IDENTITY_DOCUMENT, K.SAFE_PHOTO]);
    expect(s.extras).toEqual([]);
  });

  it('reports each extra kind once, however many files were attached', () => {
    const s = documentStatus(S13, [K.OTHER, K.OTHER, K.OTHER]);
    expect(s.extras).toEqual([K.OTHER]);
  });
});

describe('the posture', () => {
  it('never claims we refuse to proceed', () => {
    // "Required" means SAPS requires it, not that we block. Someone whose
    // competency is still being processed is exactly who should be drafting a
    // motivation now.
    const text = JSON.stringify(documentStatus(S13, [])).toLowerCase();
    for (const banned of ['you cannot', 'we cannot proceed', 'blocked', 'refuse']) {
      expect(text).not.toContain(banned);
    }
  });

  it('never promises an outcome', () => {
    for (const t of Object.values(MotivationLicenceType)) {
      const text = JSON.stringify(documentStatus(t, [])).toLowerCase();
      for (const banned of ['approv', 'guarantee', 'chance', 'success']) {
        expect(text).not.toContain(banned);
      }
    }
  });
});
