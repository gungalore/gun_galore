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
    // ⚠️ THE SAFE PHOTOGRAPHS LEFT THIS TIER ON 2026-08-20 AND RETURNED ON
    // 2026-08-21. They were removed on documentary reasoning — no SAPS list
    // mentions them, and reg 13(12) conditions the ISSUE of the licence
    // rather than the lodging of it — and the operator, who has actually
    // lodged these, answered plainly: "We do need the Safe pictures."
    const s = documentStatus(S13, [K.IDENTITY_DOCUMENT]);
    expect(s.missingRequired).toEqual([
      K.COMPETENCY_CERTIFICATE,
      K.ADDRESS_CONFIRMATION,
      K.SAFE_PHOTOGRAPHS,
    ]);
    expect(s.requiredHave).toBe(1);
    // FOUR ROWS, FOUR KINDS, since the safe became one kind on 2026-08-23. The
    // counter has to match the rows the member can actually see.
    expect(s.requiredTotal).toBe(4);
  });

  it('is satisfied once they are all there', () => {
    const s = documentStatus(S13, [
      K.IDENTITY_DOCUMENT,
      K.COMPETENCY_CERTIFICATE,
      K.ADDRESS_CONFIRMATION,
      // Three photographs, one kind. ⚠️ `uploaded` is one entry per FILE,
      // which is what makes the safe row countable at all.
      K.SAFE_PHOTOGRAPHS,
      K.SAFE_PHOTOGRAPHS,
      K.SAFE_PHOTOGRAPHS,
    ]);
    expect(s.missingRequired).toEqual([]);
    expect(s.requiredHave).toBe(s.requiredTotal);
  });

  it('demands THREE safe photographs on every licence type', () => {
    // Operator, 2026-08-19: "enforce three photos. closed safe, half open with
    // key in door, full open showing roll bolts." And again on 2026-08-21,
    // when the documentary reading had moved them down a tier: "We do need
    // the Safe pictures."
    //
    // ⚠️ DO NOT DEMOTE THESE AGAIN ON THE STRENGTH OF WHAT SAPS's WEBSITE
    // DOES NOT SAY. The absence of a mention is weak evidence; a pack handed
    // back at the counter is not.
    //
    // ⚠️ AND DO NOT DROP THE COUNT WITH THE KINDS. The three shots became one
    // kind on 2026-08-23, so minFiles is the whole of what stops a single
    // photograph ticking the row.
    for (const t of Object.values(MotivationLicenceType)) {
      const missing = documentStatus(t, []).missingRequired;
      expect(missing).toContain(K.SAFE_PHOTOGRAPHS);

      const safe = documentStatus(t, []).needs.find(
        (n) => n.kind === K.SAFE_PHOTOGRAPHS,
      );
      expect(safe!.tier).toBe('required');
      expect(safe!.minFiles).toBe(3);
    }
  });

  it('still tells them the safe is inspected as well as photographed', () => {
    // The one thing the documentary pass was right about, kept: reg 13(12)
    // makes compliant storage a condition of ISSUE, and SAPS gives 14 days
    // after lodging to install before the DFO inspects the premises. An
    // applicant who thinks the photographs are the end of it is surprised
    // later.
    const safe = documentStatus(S13, []).needs.find(
      (n) => n.kind === K.SAFE_PHOTOGRAPHS,
    )!;
    expect(safe.why).toMatch(/inspects your premises/i);
    expect(safe.why).toMatch(/13\(12\)/);
  });

  it('does not go green on one photograph, or on two', () => {
    // ⚠️ THE ROW STAYS UNTICKED UNTIL THREE ARE IN. Going green on the first
    // would tell somebody their safe evidence is complete when a DFO will send
    // them back for the other two — and missingRequired has to agree with the
    // row, or the page prints "You have everything SAPS asks for" directly
    // above a counter reading 3 of 4.
    for (const count of [1, 2]) {
      const s = documentStatus(
        S13,
        Array.from({ length: count }, () => K.SAFE_PHOTOGRAPHS),
      );
      expect(s.needs.find((n) => n.kind === K.SAFE_PHOTOGRAPHS)!.have).toBe(
        false,
      );
      expect(s.missingRequired).toContain(K.SAFE_PHOTOGRAPHS);
    }

    const three = documentStatus(S13, [
      K.SAFE_PHOTOGRAPHS,
      K.SAFE_PHOTOGRAPHS,
      K.SAFE_PHOTOGRAPHS,
    ]);
    expect(three.needs.find((n) => n.kind === K.SAFE_PHOTOGRAPHS)!.have).toBe(
      true,
    );
    expect(three.missingRequired).not.toContain(K.SAFE_PHOTOGRAPHS);
  });

  it('⚠️ STILL NAMES EVERY SHOT, on the one collapsed row', () => {
    // The row collapsed; the instruction must not. This text is now the ONLY
    // place a member is told which pictures to take — there is no longer a menu
    // entry per shot to carry the message — so losing "roll bolts" here would be
    // a real regression dressed up as tidying.
    const s = documentStatus(S13, [K.SAFE_PHOTOGRAPHS]);
    const safe = s.needs.find((n) => n.kind === K.SAFE_PHOTOGRAPHS)!;
    const why = safe.why.toLowerCase();
    expect(why).toMatch(/closed/);
    expect(why).toMatch(/half open/);
    expect(why).toMatch(/key in the door/);
    expect(why).toMatch(/roll bolts/);
    expect(why).toMatch(/three/);
    // The anchoring shot, which no photograph of the door shows.
    expect(why).toMatch(/bolted to the wall or floor/);
  });

  it('⚠️ NAMES THE SHOTS WITHOUT THE ROW HAVING TO BE SELECTED', () => {
    // `why` renders only on the SELECTED row. The four menu entries used to
    // name the shots whether or not anything was selected, and that is the
    // thing most easily lost by collapsing them — so a short line rides on the
    // need itself, shown while the row is still short.
    const safe = documentStatus(S13, []).needs.find(
      (n) => n.kind === K.SAFE_PHOTOGRAPHS,
    )!;
    const note = safe.minFilesNote!.toLowerCase();
    expect(note).toMatch(/closed/);
    expect(note).toMatch(/key in the door/);
    expect(note).toMatch(/roll bolts/);
  });

  it('treats a row still carrying a retired safe kind as extra evidence', () => {
    // The 2026-08-23 backfill moved every SAFE_PHOTO row onto SAFE_PHOTOGRAPHS,
    // so a row still carrying the old value can only be one written during the
    // deploy. It reads as extra evidence rather than as a satisfied
    // requirement, which is the safe way round.
    const s = documentStatus(S13, [K.SAFE_PHOTO]);
    expect(s.extras).toEqual([K.SAFE_PHOTO]);
    expect(s.needs.find((n) => n.kind === K.SAFE_PHOTOGRAPHS)!.have).toBe(false);
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
    const s = documentStatus(S13, [K.IDENTITY_DOCUMENT, K.SAFE_PHOTOGRAPHS]);
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
    expect(picks.slice(0, 4).map((p) => p.kind)).toEqual([
      K.IDENTITY_DOCUMENT,
      K.COMPETENCY_CERTIFICATE,
      K.ADDRESS_CONFIRMATION,
      // ONE ENTRY FOR THE SAFE. Operator, 2026-08-23: "I dont like the safe
      // picture being seperate four uploads, looks shit."
      K.SAFE_PHOTOGRAPHS,
    ]);
  });

  it('offers every kind exactly once', () => {
    for (const t of Object.values(MotivationLicenceType)) {
      const kinds = pickableKinds(t).map((p) => p.kind);
      expect(new Set(kinds).size).toBe(kinds.length);
    }
  });

  it('never offers a retired kind, so no new row can carry one', () => {
    // Postgres cannot drop an enum value, so "retired" has to mean NEVER
    // OFFERED. All five safe kinds SAFE_PHOTOGRAPHS replaced belong here:
    // offering one would put a photograph outside the only kind the checklist
    // now looks for.
    for (const t of Object.values(MotivationLicenceType)) {
      const kinds = pickableKinds(t).map((p) => p.kind);
      expect(kinds).not.toContain(K.SAFE_PHOTO);
      expect(kinds).not.toContain(K.SAFE_PHOTO_CLOSED);
      expect(kinds).not.toContain(K.SAFE_PHOTO_AJAR);
      expect(kinds).not.toContain(K.SAFE_PHOTO_BOLTS);
      expect(kinds).not.toContain(K.SAFE_INSTALLATION);
    }
  });

  it('keeps the anchoring shot alive in the words, now the kind is gone', () => {
    // SAFE_INSTALLATION was its own kind precisely because all three door shots
    // miss the one thing a DFO inspects in person — how the safe is fixed to
    // the building. Retiring the kind must not retire the ask.
    for (const t of Object.values(MotivationLicenceType)) {
      const safe = documentStatus(t, []).needs.find(
        (n) => n.kind === K.SAFE_PHOTOGRAPHS,
      )!;
      expect(safe.why).toMatch(/bolted to the wall or floor/i);
    }
  });

  it('stops calling a document needed once enough is attached', () => {
    // The tag means STILL OUTSTANDING. Computed against an empty upload list
    // it would never clear, and the applicant would photograph all three shots
    // and watch the menu go on asking for them.
    const before = pickableKinds(S13, {}, []);
    expect(before.find((p) => p.kind === K.SAFE_PHOTOGRAPHS)).toMatchObject({
      tier: 'required',
      have: false,
    });

    // ⚠️ ONE PHOTOGRAPH IS NOT ENOUGH, and the picker has to agree with the
    // checklist about that — otherwise the menu clears the "needed" tag while
    // the row beside it is still amber.
    const one = pickableKinds(S13, {}, [K.SAFE_PHOTOGRAPHS]);
    expect(one.find((p) => p.kind === K.SAFE_PHOTOGRAPHS)!.have).toBe(false);

    const three = pickableKinds(S13, {}, [
      K.SAFE_PHOTOGRAPHS,
      K.SAFE_PHOTOGRAPHS,
      K.SAFE_PHOTOGRAPHS,
    ]);
    expect(three.find((p) => p.kind === K.SAFE_PHOTOGRAPHS)).toMatchObject({
      tier: 'required',
      have: true,
    });
  });

  it('reports have for the optional kinds too, not only the required ones', () => {
    const picks = pickableKinds(S13, {}, [K.EMPLOYMENT_CONFIRMATION]);
    expect(picks.find((p) => p.kind === K.EMPLOYMENT_CONFIRMATION)!.have).toBe(
      true,
    );
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
