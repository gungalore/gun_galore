import { MotivationLicenceType, MotivationUploadKind } from '@prisma/client';
import { buildAnnexures, buildChecklist } from './motivation-checklist';

// The checklist is a LIVE surface on the platform and in the PWA, not a PDF
// page — the pack stays digital until it is printed. So what matters here is
// that it reports real state, that it never claims to hold something it does
// not, and that it carries the operator's actual guidance rather than a
// generic version I invented.

const ALL = Object.values(MotivationLicenceType);

describe('annexure lettering', () => {
  it('letters in reading order, not upload order', () => {
    const a = buildAnnexures([
      MotivationUploadKind.SAFE_PHOTO_CLOSED,
      MotivationUploadKind.IDENTITY_DOCUMENT,
      MotivationUploadKind.COMPETENCY_CERTIFICATE,
    ]);
    expect(a.map((x) => x.kind)).toEqual([
      MotivationUploadKind.IDENTITY_DOCUMENT,
      MotivationUploadKind.COMPETENCY_CERTIFICATE,
      MotivationUploadKind.SAFE_PHOTO_CLOSED,
    ]);
    expect(a.map((x) => x.letter)).toEqual(['A', 'B', 'C']);
  });

  it('groups several files of one kind under one letter', () => {
    const a = buildAnnexures([
      MotivationUploadKind.IDENTITY_DOCUMENT,
      MotivationUploadKind.SAFE_PHOTO_CLOSED,
      MotivationUploadKind.SAFE_PHOTO_CLOSED,
      MotivationUploadKind.SAFE_PHOTO_CLOSED,
    ]);
    expect(a).toHaveLength(2);
    expect(
      a.find((x) => x.kind === MotivationUploadKind.SAFE_PHOTO_CLOSED)!.count,
    ).toBe(3);
  });

  it('gives the safe ONE letter, however many shots are under it', () => {
    // ⚠️ REVERSED ON 2026-08-20, AND THE EARLIER REASONING WAS NOT WRONG SO
    // MUCH AS OUTVOTED. The three shots were given three consecutive letters
    // on 2026-08-19 so that a reviewer looking for the roll bolts could be
    // sent to a letter rather than to "one of the photographs in Annexure B".
    //
    // Then the operator supplied the annexure list a professional writer
    // actually files, and it letters the safe once: "F. PHOTOS OF SAFE". Four
    // letters for the safe pushed a nineteen-document pack out to S where a
    // professional one ends at O — every letter after the safe was shifted,
    // on a document whose whole job is to look like one a DFO has read
    // before.
    //
    // Nothing about the evidence changed: they are still three upload kinds,
    // the requirement engine still knows which shot is missing, and the
    // printed copies still caption themselves "(1 of 3)", "(2 of 3)" — so the
    // roll bolts are still individually citable.
    const a = buildAnnexures([
      MotivationUploadKind.IDENTITY_DOCUMENT,
      MotivationUploadKind.SAFE_PHOTO_BOLTS,
      MotivationUploadKind.SAFE_PHOTO_CLOSED,
      MotivationUploadKind.SAFE_PHOTO_AJAR,
    ]);
    expect(a.map((x) => x.letter)).toEqual(['A', 'B']);
    expect(a[1].label).toBe('Photographs of your safe');
    // The count is what drives "(n of 3)" on each printed copy, so all three
    // have to be accumulated under the one letter rather than the first
    // winning and the rest being dropped.
    expect(a[1].count).toBe(3);
  });

  it('counts the installation shot under the same safe letter', () => {
    const a = buildAnnexures([
      MotivationUploadKind.SAFE_PHOTO_CLOSED,
      MotivationUploadKind.SAFE_PHOTO_AJAR,
      MotivationUploadKind.SAFE_PHOTO_BOLTS,
      MotivationUploadKind.SAFE_INSTALLATION,
    ]);
    expect(a).toHaveLength(1);
    expect(a[0].letter).toBe('A');
    expect(a[0].count).toBe(4);
  });

  it('letters the association membership and good standing together', () => {
    // The reference pack's "K. MEMBERSHIP CERTIFICATES" is plural and covers
    // both. The ENDORSEMENT stays separate because it is about the firearm,
    // not the membership.
    const a = buildAnnexures([
      MotivationUploadKind.ASSOCIATION_CARD,
      MotivationUploadKind.GOOD_STANDING_LETTER,
      MotivationUploadKind.ASSOCIATION_ENDORSEMENT,
    ]);
    expect(a.map((x) => x.letter)).toEqual(['A', 'B']);
    expect(a[0].count).toBe(2);
    expect(a[1].kind).toBe(MotivationUploadKind.ASSOCIATION_ENDORSEMENT);
  });

  it('still letters a photograph uploaded before the split', () => {
    // SAFE_PHOTO is retired, not removed. A row written before 2026-08-19 must
    // not fall out of the printed index.
    const a = buildAnnexures([MotivationUploadKind.SAFE_PHOTO]);
    expect(a).toHaveLength(1);
    expect(a[0].label).toMatch(/safe/i);
  });

  it('returns nothing when nothing was uploaded', () => {
    expect(buildAnnexures([])).toEqual([]);
  });
});

describe('the live checklist', () => {
  it('separates what WE produce from what the applicant must bring', () => {
    const c = buildChecklist(MotivationLicenceType.S13_SELF_DEFENCE, []);
    const ours = c.sections.find((s) => s.key === 'ours')!;
    const theirs = c.sections.find((s) => s.key === 'theirs')!;
    expect(ours.items.every((i) => i.owner === 'us')).toBe(true);
    expect(theirs.items.every((i) => i.owner === 'applicant')).toBe(true);
    // We must never imply we hold something we do not.
    expect(theirs.items.every((i) => i.done === false)).toBe(true);
  });

  it('reflects real state — uploads and the finished document', () => {
    const before = buildChecklist(MotivationLicenceType.S24_RENEWAL, [], false);
    const after = buildChecklist(
      MotivationLicenceType.S24_RENEWAL,
      [MotivationUploadKind.IDENTITY_DOCUMENT],
      true,
    );
    expect(after.oursDone).toBeGreaterThan(before.oursDone);
    const motivation = after.sections[0].items.find((i) => i.key === 'motivation')!;
    expect(motivation.done).toBe(true);
    expect(before.sections[0].items.find((i) => i.key === 'motivation')!.done).toBe(
      false,
    );
  });

  it('gives progress counts the UI can render as a ring', () => {
    const c = buildChecklist(MotivationLicenceType.S16_DEDICATED_SPORT, [
      MotivationUploadKind.IDENTITY_DOCUMENT,
      MotivationUploadKind.ASSOCIATION_CARD,
    ]);
    expect(c.oursTotal).toBeGreaterThan(c.oursDone);
    expect(c.oursDone).toBe(2); // the two uploads; document not ready
    expect(c.theirsTotal).toBeGreaterThan(0);
  });

  it('carries the THREE specific safe photographs as three separate rows', () => {
    // Straight from the operator's own list, and three ROWS rather than three
    // sub-items under one row: sub-items had no `done` flag, so they rendered
    // permanently unticked while the parent went green on the first photo.
    const c = buildChecklist(MotivationLicenceType.S13_SELF_DEFENCE, []);
    const keys = c.sections[0].items.map((i) => i.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'upload_safe_photo_closed',
        'upload_safe_photo_ajar',
        'upload_safe_photo_bolts',
      ]),
    );
    const labels = c.sections[0].items
      .filter((i) => i.key.startsWith('upload_safe_photo'))
      .map((i) => i.label.toLowerCase());
    expect(labels).toHaveLength(3);
    expect(labels[0]).toMatch(/closed/);
    expect(labels[1]).toMatch(/half open.*key in the door/);
    expect(labels[2]).toMatch(/roll bolts/);
  });

  it('ticks each safe shot on its own, not all three on the first photo', () => {
    // The whole point of the split. Under the old single kind, one photograph
    // of a closed door satisfied the entire safe requirement.
    const c = buildChecklist(MotivationLicenceType.S13_SELF_DEFENCE, [
      MotivationUploadKind.SAFE_PHOTO_CLOSED,
    ]);
    const byKey = new Map(c.sections[0].items.map((i) => [i.key, i.done]));
    expect(byKey.get('upload_safe_photo_closed')).toBe(true);
    expect(byKey.get('upload_safe_photo_ajar')).toBe(false);
    expect(byKey.get('upload_safe_photo_bolts')).toBe(false);
  });

  it('warns not to sign the SAPS form in advance', () => {
    // The operator's list is explicit: it must be signed in front of the DFO.
    // Getting this wrong costs a wasted trip to the station.
    const theirs = buildChecklist(
      MotivationLicenceType.S15_OCCASIONAL_HUNTER,
      [],
    ).sections.find((s) => s.key === 'theirs')!;
    const form = theirs.items.find((i) => i.key === 'saps_form')!;
    expect(form.note).toMatch(/do NOT sign it beforehand/i);
    expect(form.note).toMatch(/in front of the DFO/i);
  });

  it('tells them to keep their originals and their own copy', () => {
    const theirs = buildChecklist(
      MotivationLicenceType.S24_RENEWAL,
      [],
    ).sections.find((s) => s.key === 'theirs')!;
    // "Keep the originals; hand over copies" was withdrawn on 2026-08-20: it
    // read as a universal rule and contradicted the row above it, where SAPS
    // asks for the ORIGINAL competency certificate by name. What the note has
    // to do now is send the originals along without asserting that SAPS keeps
    // any of them.
    expect(theirs.items.find((i) => i.key === 'originals')!.note).toMatch(
      /original competency certificate/i,
    );
    expect(theirs.items.some((i) => i.key === 'own_copy')).toBe(true);
  });

  it('NEVER claims the station-side list is exhaustive', () => {
    // False assurance is the dangerous failure: a list that confidently omits
    // what a particular DFO wants is worse than none, because it was trusted.
    for (const t of ALL) {
      const theirs = buildChecklist(t, []).sections.find(
        (s) => s.key === 'theirs',
      )!;
      expect(theirs.intro).toMatch(/not exhaustive/i);
      expect(theirs.intro).toMatch(/confirm/i);
      expect(theirs.items.some((i) => i.key === 'dfo_extras')).toBe(true);
    }
  });

  it('flags the items that go stale for pre-launch verification', () => {
    // The fee and the form reference are the two most likely to be quietly out
    // of date, so they are marked rather than trusted.
    const theirs = buildChecklist(
      MotivationLicenceType.S13_SELF_DEFENCE,
      [],
    ).sections.find((s) => s.key === 'theirs')!;
    const flagged = theirs.items.filter((i) => i.verifyBeforeUse);
    // safe_inspection REPLACED saps_541 on 2026-08-20: there is no SAPS 541.
    // The forms index runs 517 to 540 and forms/english/e541.pdf returns 404.
    // What replaced it — install a safe within 14 days, then a premises
    // inspection — still differs between stations, so it stays flagged.
    //
    // acknowledgement: the applicant must not leave without proof of the date
    // they lodged, but the form number and exactly what the counter hands
    // over are the kind of detail that changes.
    //
    // proof_of_residence was flagged on 2026-08-20 and unflagged on
    // 2026-08-21: the operator settled it directly. It needs a name, an
    // address and a date inside three months; certification did not come into
    // it. Nothing left to verify, so nothing left to flag.
    expect(flagged.map((i) => i.key).sort()).toEqual([
      'acknowledgement',
      'fee',
      'safe_inspection',
      'saps_form',
    ]);
  });

  it('never promises an outcome', () => {
    // ⚠️ "GUARANTEE" IS SCANNED IN CONTEXT, NOT AS A BARE SUBSTRING, and the
    // reason is a real false positive rather than a hypothetical one. SAPS's
    // own application page says the fee is paid in "cash or a bank-guaranteed
    // cheque", so quoting them verbatim in the fee note tripped a rule that
    // exists to stop us claiming a licence is guaranteed.
    //
    // The narrowing is deliberately minimal: only the payment instrument is
    // excused, by requiring that "guarantee" not be preceded by "bank-".
    // "guaranteed approval" and "we guarantee" still fail, which is the point
    // of the rule.
    const OUTCOME_WORDS = [
      /approv/,
      /chance/,
      /(?<!bank-)guarantee/,
      /success/,
      /likely/,
    ];
    for (const t of ALL) {
      const text = JSON.stringify(buildChecklist(t, [])).toLowerCase();
      for (const banned of OUTCOME_WORDS) {
        expect(text).not.toMatch(banned);
      }
    }
  });

  it('still catches a real outcome promise', () => {
    // Proves the narrowing above did not simply switch the rule off.
    const bad = 'we guarantee approval and success is likely';
    for (const banned of [
      /approv/,
      /chance/,
      /(?<!bank-)guarantee/,
      /success/,
      /likely/,
    ]) {
      // eslint-disable-next-line jest/no-conditional-expect
      if (banned.source.includes('chance')) continue;
      expect(bad).toMatch(banned);
    }
  });

  it('asks for association proof on dedicated status but not self-defence', () => {
    const has = (t: MotivationLicenceType) =>
      JSON.stringify(buildChecklist(t, [])).includes('Association membership');
    expect(has(MotivationLicenceType.S16_DEDICATED_HUNTER)).toBe(true);
    expect(has(MotivationLicenceType.S13_SELF_DEFENCE)).toBe(false);
  });

  it('prompts for an incident report on self-defence, and says why', () => {
    const c = buildChecklist(MotivationLicenceType.S13_SELF_DEFENCE, []);
    const incident = c.sections[0].items.find(
      (i) => i.key === 'upload_incident_report',
    )!;
    expect(incident.note).toMatch(/stronger than general crime figures/i);
  });
});

// ────────────────────────────────────────────────────────────────────
// THE RENEWAL DEADLINE.
//
// We ask a renewal applicant for their expiry date and, until 2026-08-20,
// said nothing whatever about the one rule attached to it. buildChecklist had
// no S24 branch, so a person who came straight to a renewal motivation
// without ever opening the Licence Centre had no surface that would tell
// them.
// ────────────────────────────────────────────────────────────────────

describe('the renewal deadline', () => {
  const theirsFor = (t: MotivationLicenceType) =>
    buildChecklist(t, []).sections.find((s) => s.key === 'theirs')!;

  it('tells a renewal applicant about the 90 days', () => {
    const items = theirsFor(MotivationLicenceType.S24_RENEWAL).items;
    const row = items.find((i) => i.key === 's24_ninety_days');
    expect(row).toBeDefined();
    expect(row!.note).toMatch(/at least 90 days/i);
    // ⚠️ FLAGGED, NOT ASSERTED. licence-dates.ts carries a standing gate
    // against printing a day count as the statutory figure until an attorney
    // signs it off, so this row is marked for pre-launch verification like
    // the fee and the form numbers.
    expect(row!.verifyBeforeUse).toBe(true);
  });

  it('says what protection is lost, never what happens if you are late', () => {
    // ⚠️ SECTIONS 24 AND 28 ARE UNDER A SUSPENDED DECLARATION OF
    // UNCONSTITUTIONALITY pending confirmation. Describing the consequence of
    // a lapsed licence would be stating as settled a question that is in
    // front of a court.
    const text = JSON.stringify(theirsFor(MotivationLicenceType.S24_RENEWAL))
      .toLowerCase();
    expect(text).toContain('stays valid until the application is decided');

    // ⚠️ THE BAN IS ON CONSEQUENCE CLAIMS, NOT ON THE WORD "EXPIRES".
    // The first version of this test banned "expires" outright and failed
    // against its own copy, which says "at least 90 days before your licence
    // expires" — a statement of WHEN the deadline is, which is exactly what
    // an applicant needs. What must never appear is an assertion about what
    // befalls a licence that lapsed.
    for (const banned of [
      'becomes illegal',
      'unlawful',
      'criminal',
      'commit an offence',
      'confiscat',
      'must surrender',
      'hand it in to the police',
      'no longer entitled',
      'you will lose',
    ]) {
      expect(text).not.toContain(banned);
    }
  });

  it('does not show the renewal rows to a first-time applicant', () => {
    // "Lodge 90 days before the expiry date" on a first application is not
    // merely irrelevant, it is confusing: there is no expiry date yet.
    for (const t of Object.values(MotivationLicenceType)) {
      if (t === MotivationLicenceType.S24_RENEWAL) continue;
      const keys = theirsFor(t).items.map((i) => i.key);
      expect(keys).not.toContain('s24_ninety_days');
      expect(keys).not.toContain('s24_keep_acknowledgement');
    }
  });

  it('still gives a renewal everything on the common list', () => {
    // The S24 rows are an ADDITION, not a replacement — a renewal applicant
    // still needs the photographs, the fee and the acknowledgement.
    const keys = theirsFor(MotivationLicenceType.S24_RENEWAL).items.map(
      (i) => i.key,
    );
    for (const common of ['passport_photos', 'fee', 'acknowledgement', 'originals']) {
      expect(keys).toContain(common);
    }
  });
});
