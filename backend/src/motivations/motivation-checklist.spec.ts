import { MotivationLicenceType, MotivationUploadKind } from '@prisma/client';
import {
  ChecklistProgress,
  annexureByKind,
  buildAnnexures,
  buildChecklist,
} from './motivation-checklist';

// The checklist is a LIVE surface on the platform and in the PWA, not a PDF
// page — the pack stays digital until it is printed. So what matters here is
// that it reports real state, that it never claims to hold something it does
// not, and that it carries the operator's actual guidance rather than a
// generic version I invented.

const ALL = Object.values(MotivationLicenceType);

describe('annexure lettering', () => {
  it('letters in reading order, not upload order', () => {
    const a = buildAnnexures([
      MotivationUploadKind.SAFE_PHOTOGRAPHS,
      MotivationUploadKind.IDENTITY_DOCUMENT,
      MotivationUploadKind.COMPETENCY_CERTIFICATE,
    ]);
    expect(a.map((x) => x.kind)).toEqual([
      MotivationUploadKind.IDENTITY_DOCUMENT,
      MotivationUploadKind.COMPETENCY_CERTIFICATE,
      MotivationUploadKind.SAFE_PHOTOGRAPHS,
    ]);
    expect(a.map((x) => x.letter)).toEqual(['A', 'B', 'C']);
  });

  it('groups several files of one kind under one letter', () => {
    const a = buildAnnexures([
      MotivationUploadKind.IDENTITY_DOCUMENT,
      MotivationUploadKind.SAFE_PHOTOGRAPHS,
      MotivationUploadKind.SAFE_PHOTOGRAPHS,
      MotivationUploadKind.SAFE_PHOTOGRAPHS,
    ]);
    expect(a).toHaveLength(2);
    expect(
      a.find((x) => x.kind === MotivationUploadKind.SAFE_PHOTOGRAPHS)!.count,
    ).toBe(3);
  });

  it('gives the safe ONE letter, however many shots are under it', () => {
    // ⚠️ THE SHOTS TOOK THREE CONSECUTIVE LETTERS FOR A DAY, on 2026-08-19,
    // so a reviewer looking for the roll bolts could be sent to a letter
    // rather than to "one of the photographs in Annexure B". Then the operator
    // supplied the annexure list a professional writer actually files, and it
    // letters the safe once: "F. PHOTOS OF SAFE". Four letters for the safe
    // pushed a nineteen-document pack out to S where a professional one ends
    // at O — every letter after the safe shifted, on a document whose whole
    // job is to look like one a DFO has read before.
    //
    // Since 2026-08-23 the shots are one KIND as well as one letter, and the
    // count is what makes them individually citable: the printed copies
    // caption themselves "(1 of 3)", "(2 of 3)".
    const a = buildAnnexures([
      MotivationUploadKind.IDENTITY_DOCUMENT,
      MotivationUploadKind.SAFE_PHOTOGRAPHS,
      MotivationUploadKind.SAFE_PHOTOGRAPHS,
      MotivationUploadKind.SAFE_PHOTOGRAPHS,
    ]);
    expect(a.map((x) => x.letter)).toEqual(['A', 'B']);
    expect(a[1].label).toBe('Photographs of your safe');
    // The count is what drives "(n of 3)" on each printed copy, so all three
    // have to be accumulated under the one letter rather than the first
    // winning and the rest being dropped.
    expect(a[1].count).toBe(3);
  });

  it('keeps a pre-collapse row under the same safe letter, not a new one', () => {
    // ⚠️ THE RETIRED KINDS STAY IN THE LETTER GROUP. A member who filed
    // before 2026-08-23 has rows carrying SAFE_PHOTO_AJAR and friends, and
    // dropping them from the group would give each one a letter of its own —
    // the exact letter-shifting the group exists to prevent, on the packs of
    // the people who filed first.
    const a = buildAnnexures([
      MotivationUploadKind.SAFE_PHOTOGRAPHS,
      MotivationUploadKind.SAFE_PHOTO_CLOSED,
      MotivationUploadKind.SAFE_PHOTO_AJAR,
      MotivationUploadKind.SAFE_PHOTO_BOLTS,
      MotivationUploadKind.SAFE_INSTALLATION,
    ]);
    expect(a).toHaveLength(1);
    expect(a[0].letter).toBe('A');
    expect(a[0].count).toBe(5);
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
    // SAFE_PHOTO is retired, not removed. A row written before it was retired
    // must not fall out of the printed index.
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

  it('carries the THREE specific safe photographs on ONE row', () => {
    // ⚠️ THE ROW COLLAPSED; THE INSTRUCTION MUST NOT. Operator, 2026-08-23:
    // "I dont like the safe picture being seperate four uploads, looks shit."
    // One row — but its note is now the only place a member is told which
    // pictures to take, so losing "roll bolts" from it would be a real
    // regression dressed up as tidying.
    const c = buildChecklist(MotivationLicenceType.S13_SELF_DEFENCE, []);
    const rows = c.sections[0].items.filter((i) =>
      i.key.startsWith('upload_safe_photo'),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('upload_safe_photographs');

    const note = (rows[0].note ?? '').toLowerCase();
    expect(note).toMatch(/closed/);
    expect(note).toMatch(/half open.*key in the door/);
    // ⚠️ THE ROLL BOLTS ARE THE ONES IN THE WALL. This asserted the
    // opposite until 2026-08-23 — "fully open so the roll bolts show", meaning
    // the locking bolts in the door, with the anchoring demoted to an optional
    // fourth shot. Operator: "no bolts needs be in the door. They need to be
    // roll bolts in the wall." A door photograph proves the lock works on a
    // box somebody can carry out of the house; the wall bolts are the point.
    expect(note).toMatch(/roll bolts that hold the safe to the wall/);
    // And the door shot must be GONE, not merely deprioritised.
    expect(note).not.toMatch(/fully open/);
  });

  it('does not tick the safe row on the first photograph', () => {
    // Under the ORIGINAL single kind, one photograph of a closed door
    // satisfied the entire safe requirement. It is one kind again — so the
    // count, not the kind, is what stops that happening: buildChecklist is
    // handed one entry per FILE and will not tick until three are in.
    const byKeyFor = (n: number) =>
      new Map(
        buildChecklist(
          MotivationLicenceType.S13_SELF_DEFENCE,
          Array.from({ length: n }, () => MotivationUploadKind.SAFE_PHOTOGRAPHS),
        ).sections[0].items.map((i) => [i.key, i.done]),
      );
    expect(byKeyFor(1).get('upload_safe_photographs')).toBe(false);
    expect(byKeyFor(2).get('upload_safe_photographs')).toBe(false);
    expect(byKeyFor(3).get('upload_safe_photographs')).toBe(true);
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

// ────────────────────────────────────────────────────────────────────
// RESOLVING AN UPLOAD TO ITS ANNEXURE.
//
// Both bugs these tests cover shipped to production and were found by opening
// a real 21-page pack — not by any of the 520 tests that were passing at the
// time. The blind spot was the same in both cases: everything was tested
// through buildAnnexures' RETURN VALUE, and nothing tested what a caller does
// with it.
// ────────────────────────────────────────────────────────────────────

describe('resolving an upload to its annexure', () => {
  const KINDS = [
    MotivationUploadKind.IDENTITY_DOCUMENT,
    MotivationUploadKind.SAFE_PHOTOGRAPHS,
    // The retired kinds are in the group too, and a real member's older
    // application still carries them.
    MotivationUploadKind.SAFE_PHOTO_CLOSED,
    MotivationUploadKind.SAFE_PHOTO_AJAR,
    MotivationUploadKind.SAFE_PHOTO_BOLTS,
    MotivationUploadKind.ASSOCIATION_CARD,
    MotivationUploadKind.GOOD_STANDING_LETTER,
    MotivationUploadKind.CURRENT_LICENCE,
  ];

  it('resolves EVERY member of a letter group, not just the first', () => {
    // ⚠️ THE BUG THIS EXISTS FOR. buildAnnexures collapses a letter group
    // onto one entry, keyed by whichever member came first. A map built as
    // `new Map(entries.map(e => [e.kind, e]))` therefore has no key for the
    // others — and the pack printed "Annexure ? — SAFE_PHOTO_AJAR" as the
    // caption on a real applicant's copy, raw enum name and all. Still live
    // for the association pair, and for the retired safe kinds an older
    // application carries.
    const entries = buildAnnexures(KINDS, ['PRIOR_NOTICE_REQUEST']);
    const byKind = annexureByKind(entries);

    for (const kind of KINDS) {
      const entry = byKind.get(kind);
      expect(entry).toBeDefined();
      expect(entry!.letter).toMatch(/^[A-Z]$/);
      // Never the raw enum name — that is what a missing lookup produces.
      expect(entry!.label).not.toBe(kind);
      expect(entry!.label).not.toMatch(/^[A-Z_]+$/);
    }
  });

  it('gives every member of a group the same letter', () => {
    const byKind = annexureByKind(
      buildAnnexures(KINDS, ['PRIOR_NOTICE_REQUEST']),
    );
    const safe = [
      MotivationUploadKind.SAFE_PHOTOGRAPHS,
      MotivationUploadKind.SAFE_PHOTO_CLOSED,
      MotivationUploadKind.SAFE_PHOTO_AJAR,
      MotivationUploadKind.SAFE_PHOTO_BOLTS,
    ].map((k) => byKind.get(k)!.letter);
    expect(new Set(safe).size).toBe(1);

    const assoc = [
      MotivationUploadKind.ASSOCIATION_CARD,
      MotivationUploadKind.GOOD_STANDING_LETTER,
    ].map((k) => byKind.get(k)!.letter);
    expect(new Set(assoc).size).toBe(1);
    // …and the two groups are not the same letter as each other.
    expect(safe[0]).not.toBe(assoc[0]);
  });

  it('agrees with the index it is indexed by', () => {
    // ⚠️ THE SECOND BUG. The copies used to be lettered from
    // buildAnnexures(kinds) while the INDEX was built from
    // buildAnnexures(kinds, ['PRIOR_NOTICE_REQUEST']). The generated document
    // takes a letter, so every annexure after it shifted by one: the index
    // read "Annexure F — Existing firearm licence(s)" and the licence pages
    // were captioned "Annexure E".
    //
    // Resolving through the SAME entry list is what makes that impossible,
    // and this asserts the property rather than the mechanism.
    const index = buildAnnexures(KINDS, ['PRIOR_NOTICE_REQUEST']);
    const byKind = annexureByKind(index);

    for (const kind of KINDS) {
      const fromCopies = byKind.get(kind)!;
      const fromIndex = index.find((e) => e.letter === fromCopies.letter)!;
      expect(fromIndex.label).toBe(fromCopies.label);
    }

    // And the generated document still holds a letter of its own that no
    // upload can claim.
    const pn = index.find((e) => e.kind === 'PRIOR_NOTICE_REQUEST')!;
    expect([...byKind.values()].map((e) => e.letter)).not.toContain(pn.letter);
  });

  it('never maps the generated document to an upload kind', () => {
    const byKind = annexureByKind(
      buildAnnexures([MotivationUploadKind.IDENTITY_DOCUMENT], [
        'PRIOR_NOTICE_REQUEST',
      ]),
    );
    for (const entry of byKind.values()) {
      expect(entry.generated).toBeUndefined();
    }
  });

  it('is empty when nothing was uploaded', () => {
    expect(annexureByKind(buildAnnexures([], ['PRIOR_NOTICE_REQUEST'])).size).toBe(
      0,
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// B4 — THE RICHER ROW: state, closer, captureRoutes.
//
// Three things are being protected here:
//
//  1. `done` and `oursDone` must mean exactly what they meant before. The new
//     `state` sits beside them and never feeds them; folding a third-party
//     signal into `done` would move the progress ring an existing screen
//     already renders, with no type error to catch it.
//  2. 'waiting-on-someone' must never collapse into 'not-started'. An invited
//     seller and a seller nobody has asked look identical through a boolean,
//     and telling an applicant "not started" is telling them to redo work they
//     already did.
//  3. Only two capture routes exist, and rows we do not hold must offer none.
// ────────────────────────────────────────────────────────────────────

describe('the richer checklist row', () => {
  const S16 = 'S16_DEDICATED_SPORT' as MotivationLicenceType;
  const every = (p: ChecklistProgress) => p.sections.flatMap((s) => s.items);
  const row = (p: ChecklistProgress, key: string) =>
    every(p).find((i) => i.key === key)!;

  it('gives every row a closer sentence — no row is left as a bare requirement', () => {
    const p = buildChecklist(S16, []);
    for (const item of every(p)) {
      expect(typeof item.closer).toBe('string');
      expect(item.closer.trim().length).toBeGreaterThan(0);
    }
  });

  it('never contradicts done: state==="done" implies done', () => {
    for (const kinds of [[], ['IDENTITY_DOCUMENT'], ['IDENTITY_DOCUMENT', 'SAFE_PHOTOGRAPHS']]) {
      const p = buildChecklist(S16, kinds as MotivationUploadKind[], true);
      for (const item of every(p)) {
        if (item.state === 'done') expect(item.done).toBe(true);
        if (item.done) expect(item.state).toBe('done');
      }
    }
  });

  it('leaves done and oursDone exactly where they were', () => {
    // The regression guard. Adding state must not make anything "more done".
    const bare = buildChecklist(S16, []);
    expect(bare.oursDone).toBe(0);

    const withId = buildChecklist(S16, ['IDENTITY_DOCUMENT'] as MotivationUploadKind[]);
    expect(withId.oursDone).toBe(1);
    expect(row(withId, 'upload_identity_document').done).toBe(true);
    expect(row(withId, 'upload_identity_document').state).toBe('done');

    // And a row somebody else is finishing is still NOT done.
    const waiting = buildChecklist(S16, [], false, {
      waitingOn: { upload_firearm_source_proof: 'Sent to Piet Malan.' },
    });
    expect(waiting.oursDone).toBe(0);
    expect(row(waiting, 'upload_firearm_source_proof').done).toBe(false);
  });

  it('distinguishes waiting on someone from never started', () => {
    const p = buildChecklist(S16, [], false, {
      waitingOn: { upload_firearm_source_proof: 'Sent to Piet Malan.' },
    });
    expect(row(p, 'upload_firearm_source_proof').state).toBe('waiting-on-someone');
    expect(row(p, 'upload_firearm_source_proof').closer).toBe('Sent to Piet Malan.');
    // Its neighbour, which nobody was asked for, stays plainly not started.
    expect(row(p, 'upload_identity_document').state).toBe('not-started');
  });

  it('prefers done over waiting — a signed document is not still pending', () => {
    const p = buildChecklist(S16, ['FIREARM_SOURCE_PROOF'] as MotivationUploadKind[], false, {
      waitingOn: { upload_firearm_source_proof: 'Sent to Piet Malan.' },
    });
    expect(row(p, 'upload_firearm_source_proof').state).toBe('done');
  });

  it('offers exactly two capture routes, and only on rows we can hold', () => {
    const p = buildChecklist(S16, ['IDENTITY_DOCUMENT'] as MotivationUploadKind[], true);
    for (const item of every(p)) {
      if (!item.captureRoutes) continue;
      expect(item.captureRoutes).toEqual(['qr', 'upload']);
    }
    // Uploadable rows offer them, done or not — a wrong page must be replaceable.
    expect(row(p, 'upload_identity_document').captureRoutes).toEqual(['qr', 'upload']);
    expect(row(p, 'upload_address_confirmation').captureRoutes).toEqual(['qr', 'upload']);
    // Things we generate cannot be uploaded to.
    expect(row(p, 'motivation').captureRoutes).toBeUndefined();
    expect(row(p, 'paja').captureRoutes).toBeUndefined();
  });

  it('never offers a capture route on something the applicant brings by hand', () => {
    // These are certified copies, passport photographs, fingerprints and a
    // fee. Offering an upload would imply we could hold them, which we cannot.
    const p = buildChecklist(S16, []);
    const theirs = p.sections.find((s) => s.key === 'theirs')!;
    expect(theirs.items.length).toBeGreaterThan(0);
    for (const item of theirs.items) {
      expect(item.captureRoutes).toBeUndefined();
      expect(item.owner).toBe('applicant');
      expect(item.closer).toBe('You bring this with you to the counter.');
    }
  });

  it('says who writes the motivation, and changes its mind once it is written', () => {
    expect(row(buildChecklist(S16, [], false), 'motivation').closer).toMatch(/we write this/i);
    expect(row(buildChecklist(S16, [], true), 'motivation').closer).toMatch(/we have written/i);
  });

  it('keeps every item key stable — a rename orphans a member’s hand-ticks', () => {
    // Not exhaustive by design; these are the keys most likely to be touched
    // while editing this module.
    const keys = every(buildChecklist(S16, [])).map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining([
      'motivation',
      'paja',
      'upload_identity_document',
      'upload_competency_certificate',
      'upload_firearm_source_proof',
    ]));
  });
});
