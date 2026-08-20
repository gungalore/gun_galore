import { MotivationLicenceType, MotivationUploadKind } from '@prisma/client';
import { documentStatus, pickableKinds } from './motivation-documents';

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
      K.SAFE_PHOTO_CLOSED,
      K.SAFE_PHOTO_AJAR,
      K.SAFE_PHOTO_BOLTS,
    ]);
    expect(s.requiredHave).toBe(1);
    // ⚠️ FOUR, NOT SIX — the three safe shots are ONE row on screen now, and
    // the counter has to match the rows the member can see or "1 of 6" reads
    // as a miscount beside four lines. missingRequired above still names all
    // three shots, because that is what is actually missing.
    expect(s.requiredTotal).toBe(4);
  });

  it('is satisfied once they are all there', () => {
    const s = documentStatus(S13, [
      K.IDENTITY_DOCUMENT,
      K.COMPETENCY_CERTIFICATE,
      K.ADDRESS_CONFIRMATION,
      K.SAFE_PHOTO_CLOSED,
      K.SAFE_PHOTO_AJAR,
      K.SAFE_PHOTO_BOLTS,
    ]);
    expect(s.missingRequired).toEqual([]);
    expect(s.requiredHave).toBe(s.requiredTotal);
  });

  it('demands all THREE safe photographs on every licence type', () => {
    // Operator, 2026-08-19: "enforce three photos. closed safe, half open with
    // key in door, full open showing roll bolts."
    for (const t of Object.values(MotivationLicenceType)) {
      const missing = documentStatus(t, []).missingRequired;
      expect(missing).toContain(K.SAFE_PHOTO_CLOSED);
      expect(missing).toContain(K.SAFE_PHOTO_AJAR);
      expect(missing).toContain(K.SAFE_PHOTO_BOLTS);
    }
  });

  it('is NOT satisfied by three copies of the same shot', () => {
    // The reason the three shots are three kinds. Counting files could never
    // have enforced this: nothing on MotivationUpload records WHICH shot a
    // file is, so three photographs of one closed door would have counted as
    // three photographs of a safe.
    const s = documentStatus(S13, [
      K.SAFE_PHOTO_CLOSED,
      K.SAFE_PHOTO_CLOSED,
      K.SAFE_PHOTO_CLOSED,
    ]);
    // ⚠️ THE ONE SAFE ROW STAYS UNTICKED. It stands for all three shots, so
    // going green on the closed one would tell somebody their safe evidence
    // is complete when a DFO will send them back for the other two.
    const safe = s.needs.find((n) => n.kind === K.SAFE_PHOTO_CLOSED)!;
    expect(safe.have).toBe(false);
    expect(safe.parts!.map((p) => p.have)).toEqual([true, false, false]);
    expect(s.missingRequired).toContain(K.SAFE_PHOTO_AJAR);
    expect(s.missingRequired).toContain(K.SAFE_PHOTO_BOLTS);
  });

  it('⚠️ STILL NAMES ALL THREE SHOTS, on the one collapsed row', () => {
    // The row collapses; the instruction must not. An applicant who reads
    // "photographs of your safe" and sends one has satisfied the phrase while
    // the pack is short two photographs nobody noticed — so every shot is
    // named in the why, and each is a separately ticked part.
    const s = documentStatus(S13, [K.SAFE_PHOTO_CLOSED]);
    const safe = s.needs.find((n) => n.kind === K.SAFE_PHOTO_CLOSED)!;
    const why = safe.why.toLowerCase();
    expect(why).toMatch(/closed/);
    expect(why).toMatch(/half open/);
    expect(why).toMatch(/roll bolts/);
    expect(why).toMatch(/three/);

    const parts = safe.parts!.map((p) => p.label.toLowerCase());
    expect(parts[0]).toMatch(/closed/);
    expect(parts[1]).toMatch(/half open.*key in the door/);
    expect(parts[2]).toMatch(/roll bolts/);
  });

  it('treats a photograph uploaded before the split as extra evidence', () => {
    // SAFE_PHOTO is retired, not removed. It could be any of the three shots,
    // so claiming it satisfies one of them would assert what we do not know.
    const s = documentStatus(S13, [K.SAFE_PHOTO]);
    expect(s.extras).toEqual([K.SAFE_PHOTO]);
    expect(s.missingRequired).toContain(K.SAFE_PHOTO_CLOSED);
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
    const s = documentStatus(S13, [K.IDENTITY_DOCUMENT, K.SAFE_PHOTO_AJAR]);
    expect(s.extras).toEqual([]);
  });

  it('reports each extra kind once, however many files were attached', () => {
    const s = documentStatus(S13, [K.OTHER, K.OTHER, K.OTHER]);
    expect(s.extras).toEqual([K.OTHER]);
  });
});

// The wizard's "document type" menu is served from here rather than kept in
// the frontend, because the two lists had already drifted: the client omitted
// two kinds outright and described the safe photograph in the singular.
describe('the upload picker', () => {
  it('leads with what is required, in the order it is asked for', () => {
    const picks = pickableKinds(S13);
    expect(picks.slice(0, 6).map((p) => p.kind)).toEqual([
      K.IDENTITY_DOCUMENT,
      K.COMPETENCY_CERTIFICATE,
      K.ADDRESS_CONFIRMATION,
      K.SAFE_PHOTO_CLOSED,
      K.SAFE_PHOTO_AJAR,
      K.SAFE_PHOTO_BOLTS,
    ]);
  });

  it('offers every kind exactly once', () => {
    for (const t of Object.values(MotivationLicenceType)) {
      const kinds = pickableKinds(t).map((p) => p.kind);
      expect(new Set(kinds).size).toBe(kinds.length);
    }
  });

  it('never offers the retired kind, so no new row can carry one', () => {
    for (const t of Object.values(MotivationLicenceType)) {
      expect(pickableKinds(t).map((p) => p.kind)).not.toContain(K.SAFE_PHOTO);
    }
  });

  it('still offers the anchoring shot, which none of the three covers', () => {
    // All three of the operator's shots are of the DOOR. How the safe is
    // fixed to the wall is the one thing about storage a DFO inspects in
    // person, so it stays on offer even though it is not required — and the
    // checklist still recommends it, which would be a row nobody could tick
    // if the picker had dropped it.
    for (const t of Object.values(MotivationLicenceType)) {
      expect(pickableKinds(t).map((p) => p.kind)).toContain(K.SAFE_INSTALLATION);
    }
  });

  it('stops calling a document needed once it is attached', () => {
    // The tag means STILL OUTSTANDING. Computed against an empty upload list
    // it would never clear, and the applicant would photograph all three shots
    // and watch the menu go on asking for them.
    const before = pickableKinds(S13, {}, []);
    expect(before.find((p) => p.kind === K.SAFE_PHOTO_AJAR)).toMatchObject({
      tier: 'required',
      have: false,
    });

    const after = pickableKinds(S13, {}, [K.SAFE_PHOTO_AJAR]);
    expect(after.find((p) => p.kind === K.SAFE_PHOTO_AJAR)).toMatchObject({
      tier: 'required',
      have: true,
    });
    // …and only that one. The other two shots are untouched.
    expect(after.find((p) => p.kind === K.SAFE_PHOTO_CLOSED)!.have).toBe(false);
    expect(after.find((p) => p.kind === K.SAFE_PHOTO_BOLTS)!.have).toBe(false);
  });

  it('reports have for the optional kinds too, not only the required ones', () => {
    const picks = pickableKinds(S13, {}, [K.SAFE_INSTALLATION]);
    expect(picks.find((p) => p.kind === K.SAFE_INSTALLATION)!.have).toBe(true);
    expect(picks.find((p) => p.kind === K.OTHER)!.have).toBe(false);
  });

  it('still offers the ones nobody is required to bring', () => {
    const kinds = pickableKinds(S13).map((p) => p.kind);
    // These two were the ones the hand-maintained frontend list had lost.
    expect(kinds).toContain(K.EMPLOYMENT_CONFIRMATION);
    expect(kinds).toContain(K.PREVIOUS_MOTIVATION);
    expect(kinds).toContain(K.OTHER);
  });

  it('promotes the existing licence only once it is asked for', () => {
    expect(
      pickableKinds(S13).find((p) => p.kind === K.CURRENT_LICENCE)!.tier,
    ).toBe('extra');
    expect(
      pickableKinds(S13, { existing_firearm_1_calibre: '.308 Winchester' }).find(
        (p) => p.kind === K.CURRENT_LICENCE,
      )!.tier,
    ).toBe('required');
  });

  it('gives every option a label', () => {
    for (const t of Object.values(MotivationLicenceType)) {
      for (const p of pickableKinds(t)) expect(p.label).toBeTruthy();
    }
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
