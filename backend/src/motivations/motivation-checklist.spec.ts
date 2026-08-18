import { MotivationLicenceType, MotivationUploadKind } from '@prisma/client';
import { buildAnnexures, buildChecklist } from './motivation-checklist';

// The checklist is what turns a document into a package the applicant can walk
// into a police station with. The properties that matter: it never claims to be
// complete about SAPS's own requirements, it letters annexures in reading order
// rather than upload order, and a missing safe photograph shows as an open box
// rather than silently not existing.

const ALL = Object.values(MotivationLicenceType);

describe('annexure lettering', () => {
  it('letters in reading order, not upload order', () => {
    // The applicant scanned the safe first and their ID last; a reviewer still
    // expects identity as Annexure A.
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
    // Three photographs of one safe are all "Annexure C" — how the real
    // samples do it and how a reviewer expects to find them.
    const a = buildAnnexures([
      MotivationUploadKind.IDENTITY_DOCUMENT,
      MotivationUploadKind.SAFE_PHOTO,
      MotivationUploadKind.SAFE_PHOTO,
      MotivationUploadKind.SAFE_PHOTO,
    ]);
    expect(a).toHaveLength(2);
    const safe = a.find((x) => x.kind === MotivationUploadKind.SAFE_PHOTO)!;
    expect(safe.count).toBe(3);
    expect(safe.letter).toBe('B');
  });

  it('has no gaps in the lettering when kinds are sparse', () => {
    const a = buildAnnexures([
      MotivationUploadKind.CHARACTER_REFERENCE,
      MotivationUploadKind.IDENTITY_DOCUMENT,
    ]);
    expect(a.map((x) => x.letter)).toEqual(['A', 'B']);
  });

  it('returns nothing when nothing was uploaded', () => {
    expect(buildAnnexures([])).toEqual([]);
  });
});

describe('the submission checklist', () => {
  it('always lists the motivation and the PAJA request as present', () => {
    for (const t of ALL) {
      const items = buildChecklist(t, []).flatMap((s) => s.items);
      const motivation = items.find((i) => /this motivation/i.test(i.label));
      const paja = items.find((i) => /PAJA/i.test(i.label));
      expect(motivation?.present).toBe(true);
      expect(paja?.present).toBe(true);
    }
  });

  it('ticks what is in the pack and leaves the rest open', () => {
    const sections = buildChecklist(MotivationLicenceType.S13_SELF_DEFENCE, [
      MotivationUploadKind.IDENTITY_DOCUMENT,
    ]);
    const inPack = sections.find((s) => s.title === 'In this pack')!;
    expect(inPack.items.some((i) => i.present && /identity/i.test(i.label))).toBe(
      true,
    );

    // Everything the applicant must obtain themselves is an OPEN box — we do
    // not hold it and must never imply otherwise.
    const theirs = sections.find((s) => /You must add these/i.test(s.title))!;
    expect(theirs.items.every((i) => i.present === false)).toBe(true);
  });

  it('shows a missing safe photograph as an open box, with the reason', () => {
    // The operator's point: a photograph of the safe and its anchoring is the
    // only thing that evidences the safekeeping the motivation asserts.
    const sections = buildChecklist(MotivationLicenceType.S16_DEDICATED_SPORT, [
      MotivationUploadKind.IDENTITY_DOCUMENT,
    ]);
    const worth = sections.find((s) => s.title === 'Worth adding')!;
    const safe = worth.items.find((i) => /photograph of the safe$/i.test(i.label));
    expect(safe).toBeDefined();
    expect(safe!.present).toBe(false);
    expect(safe!.note).toMatch(/anchored/i);
  });

  it('drops the "worth adding" section once everything recommended is present', () => {
    const every = Object.values(MotivationUploadKind);
    const sections = buildChecklist(
      MotivationLicenceType.S24_RENEWAL,
      every,
    );
    expect(sections.some((s) => s.title === 'Worth adding')).toBe(false);
  });

  it('NEVER claims the SAPS-side list is exhaustive', () => {
    // The dangerous failure is false assurance: a checklist that confidently
    // omits something a particular DFO wants is worse than no checklist,
    // because the applicant trusted it. Requirements differ by station.
    for (const t of ALL) {
      const theirs = buildChecklist(t, []).find((s) =>
        /You must add these/i.test(s.title),
      )!;
      expect(theirs.intro).toMatch(/not exhaustive/i);
      expect(theirs.intro).toMatch(/confirm/i);
      expect(
        theirs.items.some((i) => /anything else your DFO asks/i.test(i.label)),
      ).toBe(true);
    }
  });

  it('never promises an outcome anywhere in the checklist', () => {
    for (const t of ALL) {
      const text = JSON.stringify(buildChecklist(t, [])).toLowerCase();
      for (const banned of [
        'approv',
        'chance',
        'guarantee',
        'success',
        'likely',
      ]) {
        expect(text).not.toContain(banned);
      }
    }
  });

  it('recommends association proof for dedicated status but not for self-defence', () => {
    const ds = buildChecklist(MotivationLicenceType.S16_DEDICATED_HUNTER, []);
    const sd = buildChecklist(MotivationLicenceType.S13_SELF_DEFENCE, []);
    const has = (secs: ReturnType<typeof buildChecklist>) =>
      JSON.stringify(secs).includes('Association membership proof');
    expect(has(ds)).toBe(true);
    expect(has(sd)).toBe(false);
  });
});
