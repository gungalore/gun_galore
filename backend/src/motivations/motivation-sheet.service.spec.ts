import { MotivationLicenceType, MotivationStatus } from '@prisma/client';
import { encryptJson } from '../common/blob-crypto';
import { MotivationSheetService } from './motivation-sheet.service';
import { MotivationSharedService } from './motivation-shared.service';
import { MemberProfileAnswersService } from './member-profile-answers.service';
import { missingRequired } from './motivation-fields';

// ────────────────────────────────────────────────────────────────────
// GET /motivations/:id/sheet — the one read behind the review screen.
//
// ⚠️ THIS SERVICE COMPUTES `state`, AND NOTHING ELSE IN THE SYSTEM MAY. That
// is why the endpoint exists: the frontend used to carry a hand-written mirror
// of isVisible(), and the two had to be kept in step by a comment. A flag
// honoured by one side and not the other either puts a question in front of
// somebody we have already answered, or hides one the server insists on.
//
// The other property worth guarding is the counting. The live walkthrough
// found FOUR progress systems on one screen — a rail, a footer count, a
// per-letter panel and a chip cloud — which could and did contradict each
// other, including a step showing a green tick while its own panel read 0%.
// `missing` is one list, and three views read it.
// ────────────────────────────────────────────────────────────────────

const S13 = MotivationLicenceType.S13_SELF_DEFENCE;

const ORIGINAL_SECRET = process.env.ID_HASH_SECRET;
beforeAll(() => {
  process.env.ID_HASH_SECRET = 'test-secret-for-motivation-sheet';
});
afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.ID_HASH_SECRET;
  else process.env.ID_HASH_SECRET = ORIGINAL_SECRET;
});

function build(
  answers: Record<string, string> = {},
  opts: {
    provenance?: Record<string, unknown>;
    profile?: Record<string, string>;
    uploads?: { id: string; kind: string; mimeType: string; extractionOk: boolean }[];
    licenceType?: MotivationLicenceType;
  } = {},
) {
  const prisma = {
    user: { findUnique: jest.fn(async () => ({ id: 'user-1' })) },
    motivation: {
      findFirst: jest.fn(async (): Promise<any> => ({
        id: 'mo-1',
        referenceNumber: 'MO000066',
        licenceType: opts.licenceType ?? S13,
        label: null,
        status: MotivationStatus.DRAFT,
        answersEncrypted: encryptJson(answers),
        answerProvenance: opts.provenance ?? {},
        uploads: opts.uploads ?? [],
      })),
    },
    memberProfileAnswers: {
      findUnique: jest.fn(async (): Promise<any> =>
        opts.profile
          ? { answersEncrypted: encryptJson(opts.profile), answerProvenance: {} }
          : null,
      ),
      upsert: jest.fn(async () => ({})),
    },
  };
  const shared = new MotivationSharedService(prisma as never);
  return {
    svc: new MotivationSheetService(
      prisma as never,
      shared,
      new MemberProfileAnswersService(prisma as never),
    ),
    prisma,
  };
}

const itemFor = (items: any[], key: string) => items.find((i) => i.key === key);

describe('the four item states', () => {
  it('needs_you — a required field nobody has answered', async () => {
    const { svc } = build();
    const sheet = await svc.sheetFor('c1', 'mo-1');
    expect(itemFor(sheet.items, 'firearm_make').state).toBe('needs_you');
    expect(itemFor(sheet.items, 'firearm_make').value).toBe('');
  });

  it('filled — a value we are confident about, with no task attached', async () => {
    // The operator's standing rule (2026-08-25): fill it in, arm it, let them
    // change it. A value we read is not a confirmation step we invented.
    const { svc } = build(
      { firearm_make: 'CZ' },
      {
        provenance: {
          firearm_make: { source: 'READ', from: 'your licence card', at: '2026-09-01T00:00:00.000Z' },
        },
      },
    );
    const item = itemFor((await svc.sheetFor('c1', 'mo-1')).items, 'firearm_make');
    expect(item.state).toBe('filled');
    expect(item.provenance.from).toBe('your licence card');
  });

  it('suggested — and ONLY when the value was inferred rather than read', async () => {
    const { svc } = build(
      { firearm_make: 'CZ' },
      {
        provenance: {
          firearm_make: {
            source: 'READ',
            from: 'your licence card',
            at: '2026-09-01T00:00:00.000Z',
            inferred: true,
          },
        },
      },
    );
    const item = itemFor((await svc.sheetFor('c1', 'mo-1')).items, 'firearm_make');
    expect(item.state).toBe('suggested');
  });

  it('na — a field behind an unmet showIf', async () => {
    const { svc } = build({ marital_status: 'Single' });
    const item = itemFor((await svc.sheetFor('c1', 'mo-1')).items, 'spouse_name');
    expect(item.state).toBe('na');
  });

  it('na — an internal field, whatever anybody answered', async () => {
    // ⚠️ THE THREE FIELDS WE FILL IN AND NEVER ASK. police_station_province,
    // press_clippings and competency_renews_with_licence used to be hidden by
    // a formOnly/showIf contradiction; `internal` replaced it, and the sheet
    // is now the only thing that honours it.
    const { svc } = build({ fill_saps271: 'My dealer will fill it in' });
    const sheet = await svc.sheetFor('c1', 'mo-1');
    for (const key of ['police_station_province', 'press_clippings']) {
      expect(itemFor(sheet.items, key).state).toBe('na');
    }
  });
});

describe('nothing is masked on the applicant own screen', () => {
  it('returns the full name and ID number, not a masked one', async () => {
    // ⚠️ THE LIVE WALKTHROUGH FOUND "GE••••••••" AND "8905 •••• •••" ON THE
    // APPLICANT'S OWN APPLICATION. `sensitive` is for logs, admin views and
    // anything another person can see. They are about to sign these onto a
    // police form and have to be able to check them.
    const { svc } = build({
      full_name: 'Johan Pretorius',
      id_number: '8905125800087',
    });
    const sheet = await svc.sheetFor('c1', 'mo-1');
    expect(itemFor(sheet.items, 'full_name').value).toBe('Johan Pretorius');
    expect(itemFor(sheet.items, 'id_number').value).toBe('8905125800087');
  });
});

describe('the sections', () => {
  it('returns the eight, in the order the sheet renders them', async () => {
    const { svc } = build();
    const sheet = await svc.sheetFor('c1', 'mo-1');
    expect(sheet.sections.map((s) => s.id)).toEqual([
      'firearm',
      'you',
      'competency',
      'own',
      'premises',
      'case',
      'declarations',
      'pack',
    ]);
  });

  it('gives every section a one-sentence blurb', async () => {
    const { svc } = build();
    for (const s of (await svc.sheetFor('c1', 'mo-1')).sections) {
      expect(s.blurb.trim()).not.toBe('');
      expect(s.blurb.split('.').filter(Boolean).length).toBeLessThanOrEqual(2);
    }
  });

  it('gives every item a section that exists', async () => {
    // ⚠️ A REQUIRED KEY WITH NO SECTION IS UNREACHABLE — somebody told
    // something is outstanding with nowhere on the page to answer it. This is
    // the same failure frontend/lib/wizard-coverage.spec.ts was written for.
    const { svc } = build();
    const sheet = await svc.sheetFor('c1', 'mo-1');
    const ids = new Set(sheet.sections.map((s) => s.id));
    for (const item of sheet.items) expect(ids.has(item.section)).toBe(true);
  });
});

describe('one number, three views', () => {
  it('agrees with missingRequired for an empty application', async () => {
    const { svc } = build();
    const sheet = await svc.sheetFor('c1', 'mo-1');
    expect([...sheet.missing].sort()).toEqual([...missingRequired(S13, {})].sort());
  });

  it('accounts for every missing key in exactly one section', async () => {
    // The progress pill, the chip dots and the footer all read this one list.
    // A key counted twice, or in no section, is how four progress systems
    // disagreed on the old screen.
    const { svc } = build();
    const sheet = await svc.sheetFor('c1', 'mo-1');
    const perSection = sheet.sections.flatMap((s) => s.missing);
    expect([...perSection].sort()).toEqual([...sheet.missing].sort());
  });

  it('never reports an internal field as missing', async () => {
    const { svc } = build();
    const sheet = await svc.sheetFor('c1', 'mo-1');
    expect(sheet.missing).not.toContain('press_clippings');
    expect(sheet.missing).not.toContain('police_station_province');
  });
});

describe('the profile layers underneath the application', () => {
  it('offers a profile answer the application has not overridden', async () => {
    const { svc } = build({}, { profile: { marital_status: 'Married' } });
    const item = itemFor((await svc.sheetFor('c1', 'mo-1')).items, 'marital_status');
    expect(item.value).toBe('Married');
    expect(item.state).toBe('filled');
    expect(item.scope).toBe('profile');
  });

  it('lets this application win where the member changed it here', async () => {
    const { svc } = build(
      { marital_status: 'Divorced' },
      { profile: { marital_status: 'Married' } },
    );
    const item = itemFor((await svc.sheetFor('c1', 'mo-1')).items, 'marital_status');
    expect(item.value).toBe('Divorced');
  });
});

describe('cards and their own-words box', () => {
  it('serves the tiles on a cards field', async () => {
    const { svc } = build();
    const item = itemFor((await svc.sheetFor('c1', 'mo-1')).items, 's13_reasons');
    expect(item.kind).toBe('cards');
    expect(item.options.length).toBeGreaterThan(3);
    expect(item.options[0].sentence).toMatch(/^I /);
  });

  it('pairs a card set with the optional long box under it', async () => {
    const { svc } = build();
    const item = itemFor((await svc.sheetFor('c1', 'mo-1')).items, 's13_reasons');
    expect(item.ownWordsKey).toBe('threat_circumstances');
  });

  it('pairs every owned row purpose with the same set', async () => {
    // One pairing serves all fourteen rows — the lookup strips the row number.
    const { svc } = build();
    const sheet = await svc.sheetFor('c1', 'mo-1');
    const row3 = itemFor(sheet.items, 'existing_firearm_3_primary_use');
    expect(row3.kind).toBe('cards');
    expect(row3.scope).toBe('profile');
  });
});

describe('documents', () => {
  it('letters what is attached, and flags what we could not read', async () => {
    const { svc } = build(
      {},
      {
        uploads: [
          { id: 'u1', kind: 'IDENTITY_DOCUMENT', mimeType: 'image/jpeg', extractionOk: true },
          { id: 'u2', kind: 'PROOF_OF_ADDRESS', mimeType: 'application/pdf', extractionOk: false },
        ],
      },
    );
    const sheet = await svc.sheetFor('c1', 'mo-1');
    expect(sheet.documents).toHaveLength(2);
    expect(sheet.documents[0].letter).toBeTruthy();
    expect(sheet.documents[0].state).toBe('read');
    // ⚠️ THE MEMBER'S WORDS, NOT THE ENUM'S. This shipped rendering
    // "ADDRESS_CONFIRMATION" on the shelf, clipped to "ADDRESS_CO" in a 72px
    // tile. A label nobody outside this codebase has seen is not a label.
    expect(sheet.documents[0].label).toBe('Copy of your ID');
    expect(sheet.documents[0].label).not.toBe(sheet.documents[0].kind);
    // Gold, not red: a document we could not read is still attached and still
    // goes in the pack.
    expect(sheet.documents[1].state).toBe('check');
  });

  it('separates what is attached from what is still wanted', async () => {
    const { svc } = build();
    const sheet = await svc.sheetFor('c1', 'mo-1');
    expect(sheet.documents).toEqual([]);
    // An empty shelf and a full needs list is what a first-timer correctly
    // looks like, not an error state.
    expect(sheet.needs.needs.length).toBeGreaterThan(0);
  });
});

describe('the preview rides along', () => {
  it('comes back with the sheet, so the drawer needs no second call on load', async () => {
    const { svc } = build({ full_name: 'Johan Pretorius' });
    const sheet = await svc.sheetFor('c1', 'mo-1');
    expect(sheet.preview.length).toBeGreaterThan(3);
    expect(sheet.preview[0].paragraphs.join(' ')).toContain('Johan Pretorius');
  });

  it('previewOnly returns the same sections', async () => {
    const { svc } = build({ full_name: 'Johan Pretorius' });
    const sheet = await svc.sheetFor('c1', 'mo-1');
    await expect(svc.previewOnly('c1', 'mo-1')).resolves.toEqual(sheet.preview);
  });
});
