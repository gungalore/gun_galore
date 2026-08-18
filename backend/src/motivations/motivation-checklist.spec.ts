import { MotivationLicenceType, MotivationUploadKind } from '@prisma/client';
import {
  buildAnnexures,
  buildChecklist,
  SAFE_PHOTO_SHOTS,
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
      MotivationUploadKind.SAFE_PHOTO,
      MotivationUploadKind.IDENTITY_DOCUMENT,
      MotivationUploadKind.COMPETENCY_CERTIFICATE,
    ]);
    expect(a.map((x) => x.kind)).toEqual([
      MotivationUploadKind.IDENTITY_DOCUMENT,
      MotivationUploadKind.COMPETENCY_CERTIFICATE,
      MotivationUploadKind.SAFE_PHOTO,
    ]);
    expect(a.map((x) => x.letter)).toEqual(['A', 'B', 'C']);
  });

  it('groups several files of one kind under one letter', () => {
    const a = buildAnnexures([
      MotivationUploadKind.IDENTITY_DOCUMENT,
      MotivationUploadKind.SAFE_PHOTO,
      MotivationUploadKind.SAFE_PHOTO,
      MotivationUploadKind.SAFE_PHOTO,
    ]);
    expect(a).toHaveLength(2);
    expect(a.find((x) => x.kind === MotivationUploadKind.SAFE_PHOTO)!.count).toBe(3);
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

  it('carries the THREE specific safe photographs, not a vague instruction', () => {
    // Straight from the operator's own list. Guessing at this would have
    // produced "a photo of your safe" and a rejected application.
    const c = buildChecklist(MotivationLicenceType.S13_SELF_DEFENCE, []);
    const safe = c.sections[0].items.find((i) => i.key === 'upload_safe_photo')!;
    expect(safe.subItems).toHaveLength(3);
    const labels = safe.subItems!.map((s) => s.label.toLowerCase());
    expect(labels[0]).toMatch(/locked.*no key/);
    expect(labels[1]).toMatch(/half open.*key in the lock/);
    expect(labels[2]).toMatch(/bolts.*wall/);
    expect(SAFE_PHOTO_SHOTS).toHaveLength(3);
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
    expect(theirs.items.find((i) => i.key === 'originals')!.note).toMatch(
      /keep the originals/i,
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
    expect(flagged.map((i) => i.key).sort()).toEqual(['fee', 'saps_form']);
  });

  it('never promises an outcome', () => {
    for (const t of ALL) {
      const text = JSON.stringify(buildChecklist(t, [])).toLowerCase();
      for (const banned of ['approv', 'chance', 'guarantee', 'success', 'likely']) {
        expect(text).not.toContain(banned);
      }
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
