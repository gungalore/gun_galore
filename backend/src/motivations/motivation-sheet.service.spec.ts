import { MotivationLicenceType, MotivationStatus } from '@prisma/client';
import { encryptJson } from '../common/blob-crypto';
import {
  MotivationSheetService,
  ownedRowsFor,
} from './motivation-sheet.service';
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
    uploads?: {
      id: string;
      kind: string;
      mimeType: string;
      extractionOk: boolean;
      /** The second role one document plays — see the good-standing suite. */
      coversKinds?: string[];
    }[];
    licenceType?: MotivationLicenceType;
    seller?: { status: string; invitedName?: string } | null;
    /** Document Centre rows, for the competency/proficiency pair. */
    credentials?: { id: string; kind: string; otherSideId: string | null }[];
    /** Statements of results, for the 117705 read. */
    statements?: { ocrTextEncrypted: string | null }[];
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
    // ⚠️ STUBBED, BECAUSE sellerState FAILS SOFT. Without this the lookup
    // throws, the catch returns 'NONE', and a test asserting the F row would
    // fail for the wrong reason — or worse, one asserting its ABSENCE would
    // pass for the wrong reason.
    motivationSellerConsent: {
      findUnique: jest.fn(async (): Promise<any> =>
        opts.seller
          ? {
              status: opts.seller.status,
              invitedName: opts.seller.invitedName ?? 'Pieter',
              openedAt: null,
            }
          : null,
      ),
    },
    // The Document Centre, for the competency/proficiency pair. Default empty:
    // a first-time applicant holds nothing, which is the state the section has
    // to render correctly before any other.
    credential: {
      findMany: jest.fn(async (): Promise<any> => opts.credentials ?? []),
    },
    // Every proficiency statement this member has ever handed in, for the
    // 117705 read. See MotivationSharedService.proficiencyFor.
    motivationUpload: {
      findMany: jest.fn(async (): Promise<any> => opts.statements ?? []),
    },
  };
  const shared = new MotivationSharedService(prisma as never, new MemberProfileAnswersService(prisma as never));
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

// ────────────────────────────────────────────────────────────────────
// WHICH OWNED-FIREARM ROWS EXIST — the decision the page is TOLD, never
// makes. The registry serves all fourteen whatever a member owns.
// ────────────────────────────────────────────────────────────────────

describe('ownedRowsFor', () => {
  const row = (n: number, cols: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(cols).map(([k, v]) => [`existing_firearm_${n}_${k}`, v]),
    );

  it('⚠️ RETURNS NOTHING FOR THE ROWS NOBODY OWNS', () => {
    // Five firearms rendered as fourteen on the live sheet: nine empty rows,
    // no heading between them, each carrying the eleven-tile "what it is for"
    // grid. "Firearms you own" was 15,840px of a 26,351px page.
    const answers = {
      ...row(1, { make: 'MAUSER', calibre: '.30-06 SPRINGFIELD' }),
      ...row(2, { make: 'CZ', calibre: '6.35MM BROWNING' }),
    };
    expect(ownedRowsFor(answers).map((r) => r.index)).toEqual([1, 2]);
  });

  it('heads a fold the way a member says which rifle they mean', () => {
    const answers = row(3, {
      make: 'HOWA',
      calibre: '6.5MM CREEDMOOR',
      serial: 'B477423',
      expiry: '2032-11-28',
    });
    expect(ownedRowsFor(answers)[0]).toEqual({
      index: 3,
      summary: 'HOWA · 6.5MM CREEDMOOR',
      note: 'B477423 · licence expires 2032-11-28',
    });
  });

  it('⚠️ COUNTS A "NONE" ROW AS TAKEN AND STILL DOES NOT PRINT IT', () => {
    // A card printing NONE against the frame is evidence somebody has been in
    // the row, and is not a serial. ownedRowTaken must see it; the header
    // must not, or the fold reads "Firearm 4 · NONE".
    const answers = row(4, { make: 'MARLIN', serial: 'NONE' });
    const [only] = ownedRowsFor(answers);
    expect(only.index).toBe(4);
    expect(only.summary).toBe('MARLIN');
    expect(only.note).toBeNull();
  });

  it('never heads a fold with an empty string', () => {
    // A row started from something that is not make, model or calibre still
    // needs a name a member can tap.
    expect(ownedRowsFor(row(7, { licence_no: 'ABC/123' }))[0].summary).toBe(
      'Firearm 7',
    );
  });

  it('returns them in row order, whatever order the answers arrive in', () => {
    const answers = { ...row(9, { make: 'B' }), ...row(2, { make: 'A' }) };
    expect(ownedRowsFor(answers).map((r) => r.index)).toEqual([2, 9]);
  });
});


// ────────────────────────────────────────────────────────────────────
// SECTION F — THE SELLER'S HALF.
//
// ⚠️ THE SHEET SHIPPED WITHOUT IT ENTIRELY. saps271Coverage only pushes F when
// it is TOLD where the seller stands, and this service passed no context — so
// there was no F row in the coverage at all, the pack meter showed no "Current
// owner" line, and `sellerSigned` in the page (which reads F.done) was false
// however signed the consent was. A seller signed at 12:02 and the line under
// the panel still read "When they sign, Part F … fills in from what they give
// us", directly under a panel already saying "The owner has signed".
// ────────────────────────────────────────────────────────────────────

describe('the seller half reaches the sheet', () => {
  const sections = (c: unknown) =>
    (c as { sections: { id: string; status?: string; note?: string }[] }).sections;

  it('⚠️ CARRIES AN F ROW ONCE THE SELLER HAS SIGNED', async () => {
    const { svc } = build(
      { firearm_source: 'From a private owner' },
      { seller: { status: 'COMPLETED', invitedName: 'Pieter Botha' } },
    );
    const sheet = await svc.sheetFor('clerk_1', 'mo-1');
    const f = sections(sheet.coverage).find((x) => x.id === 'F');
    expect(f).toBeDefined();
    expect(f!.status).toBe('complete');
    expect(f!.note).toContain('Pieter Botha');
  });

  it('says who it is waiting on while the invite is out', async () => {
    const { svc } = build(
      { firearm_source: 'From a private owner' },
      { seller: { status: 'INVITED', invitedName: 'Pieter Botha' } },
    );
    const sheet = await svc.sheetFor('clerk_1', 'mo-1');
    const f = sections(sheet.coverage).find((x) => x.id === 'F');
    expect(f!.status).toBe('theirs');
    expect(f!.note).toContain('Nothing for you to do');
  });

  it('⚠️ SHOWS NO F ROW WHEN NOBODY HAS BEEN ASKED', async () => {
    // Part F is not the applicant's work. A row scoring them 0% on somebody
    // else's half reads as their failure.
    const { svc } = build({ firearm_source: 'From a dealer' });
    const sheet = await svc.sheetFor('clerk_1', 'mo-1');
    expect(sections(sheet.coverage).find((x) => x.id === 'F')).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────
// THE COMPETENCY/PROFICIENCY PAIR.
//
// The pure rules live in motivation-credential-slots.spec.ts. What is asserted
// here is the half that only the service can get wrong: which Document Centre
// rows count as ONE document, and what "already on this application" removes
// from the offer.
// ────────────────────────────────────────────────────────────────────
describe('the Document Centre count behind the pair', () => {
  const handgun = { firearm_type: 'Handgun', firearm_action: 'Semi-automatic' };

  it('⚠️ A TWO-PAGE PROFICIENCY IS ONE DOCUMENT, NOT TWO', async () => {
    // Operator, 2026-09-07: "the proficiencies are still double in that
    // dropdown." The certificate and its statement of results are two
    // Credential rows joined by otherSideId and one thing to attach; counting
    // rows offers "2 in your Licence Centre" over a list showing one.
    const { svc } = build(handgun, {
      credentials: [
        { id: 'c-a', kind: 'PROFICIENCY', otherSideId: 'c-b' },
        { id: 'c-b', kind: 'PROFICIENCY', otherSideId: 'c-a' },
      ],
    });
    const sheet = await svc.sheetFor('clerk_1', 'mo-1');
    expect(sheet.credentials.proficiency.inCentre).toBe(1);
  });

  it('⚠️ BUT A LONE FOLLOWER STILL COUNTS — its lead was deleted, it is still a document', async () => {
    const { svc } = build(handgun, {
      credentials: [{ id: 'c-b', kind: 'PROFICIENCY', otherSideId: 'c-a' }],
    });
    const sheet = await svc.sheetFor('clerk_1', 'mo-1');
    expect(sheet.credentials.proficiency.inCentre).toBe(1);
  });

  it('⚠️ DOES NOT OFFER WHAT IS ALREADY ATTACHED HERE', async () => {
    const { svc } = build(handgun, {
      credentials: [
        { id: 'c-1', kind: 'COMPETENCY_CERTIFICATE', otherSideId: null },
      ],
      uploads: [
        {
          id: 'u-1',
          kind: 'COMPETENCY_CERTIFICATE',
          mimeType: 'image/jpeg',
          extractionOk: true,
          sourceCredentialId: 'c-1',
        } as never,
      ],
    });
    const sheet = await svc.sheetFor('clerk_1', 'mo-1');
    expect(sheet.credentials.competency.inCentre).toBe(0);
    expect(sheet.credentials.competency.held).toHaveLength(1);
    expect(sheet.credentials.competency.held[0].origin).toBe('vault');
  });

  it('asks for the statement of results when only the certificate is here', async () => {
    const { svc } = build(handgun, {
      uploads: [
        {
          id: 'u-1',
          kind: 'COMPETENCY_CERTIFICATE',
          mimeType: 'image/jpeg',
          extractionOk: true,
          sourceCredentialId: null,
        } as never,
      ],
    });
    const sheet = await svc.sheetFor('clerk_1', 'mo-1');
    expect(sheet.credentials.neededLabel).toBe('Handgun');
    expect(sheet.credentials.pairNote).toContain('statement of results');
    expect(sheet.credentials.competency.held[0].origin).toBe('member');
  });
});

// ────────────────────────────────────────────────────────────────────
// THE SHEET AND THE GENERATOR MUST COUNT THE SAME THING.
//
// Operator, 2026-09-08, every row green and the declaration ticked: the button
// answered "Some required answers are still missing", naming `marital_status`
// and `safe_present` — both answered, both `scope: 'profile'`.
//
// ⚠️ A PROFILE ANSWER IS NOT IN `answersEncrypted`, AND THAT IS THE POINT OF
// THE SCOPE. It lives on the member so a second application inherits it. The
// sheet layered the two; generate() read the blob alone. Two readers of one
// number, which is the failure this whole surface was built to end.
// ────────────────────────────────────────────────────────────────────
describe('the profile is part of what the application says', () => {
  it('⚠️ COUNTS A PROFILE ANSWER AS ANSWERED', async () => {
    const { svc } = build(
      { firearm_type: 'Handgun' },
      { profile: { marital_status: 'Single', safe_present: 'Yes' } },
    );
    const sheet = await svc.sheetFor('clerk_1', 'mo-1');
    expect(sheet.missing).not.toContain('marital_status');
    expect(sheet.missing).not.toContain('safe_present');
  });

  it('⚠️ AND THE APPLICATION STILL WINS THE CONFLICT', () => {
    // A profile answer is an OFFER; a value on this application is the member
    // having changed it here. Reversing that would silently overwrite a
    // correction with the value it corrected.
    return build(
      { marital_status: 'Married' },
      { profile: { marital_status: 'Single' } },
    )
      .svc.sheetFor('clerk_1', 'mo-1')
      .then((sheet) => {
        expect(
          sheet.items.find((i) => i.key === 'marital_status')?.value,
        ).toBe('Married');
      });
  });
});

// ────────────────────────────────────────────────────────────────────
// ONE CERTIFICATE, TWO ROLES, ONE ROW ON THE CHECKLIST.
//
// A SA Hunters or NARFO membership certificate declares the member "in good
// standing" AND awards the dedicated status, on one page with one validity
// window — which is why DEDICATED_DISCIPLINE maps to BOTH upload kinds and
// why the vault records the second role in `coversKinds`.
//
// ⚠️ THE SHEET WAS READING PAST THE SECOND HALF OF IT. Operator, 2026-09-09:
// "it askes for my letter of good standing if my status says its valid until
// next year." Their MO000075 carried exactly one such row — ASSOCIATION_CARD
// with {GOOD_STANDING_LETTER} against it — and the checklist asked for a paper
// already in the pack. The other two callers of documentStatus had counted
// coversKinds since the day the kind was consolidated.
// ────────────────────────────────────────────────────────────────────

describe('a certificate that is also the letter of good standing', () => {
  const card = (coversKinds: string[]) => ({
    id: 'u-1',
    kind: 'ASSOCIATION_CARD',
    mimeType: 'image/jpeg',
    extractionOk: true,
    coversKinds,
  });

  it('⚠️ STOPS ASKING FOR THE LETTER once one document covers both', async () => {
    const { svc } = build(
      {},
      {
        licenceType: MotivationLicenceType.S16_DEDICATED_SPORT,
        uploads: [card(['GOOD_STANDING_LETTER'])],
      },
    );
    const sheet = await svc.sheetFor('clerk_1', 'mo-1');
    // ⚠️ `needs` IS THE WHOLE TIER LIST — what the pack wants, attached or
    // not. `missingRequired` is what is still outstanding, which is what the
    // member is chased for.
    expect(sheet.needs.missingRequired).not.toContain('GOOD_STANDING_LETTER');
    expect(sheet.needs.missingRequired).not.toContain('ASSOCIATION_CARD');
  });

  it('still asks where the document covers only itself', async () => {
    const { svc } = build(
      {},
      {
        licenceType: MotivationLicenceType.S16_DEDICATED_SPORT,
        uploads: [card([])],
      },
    );
    const sheet = await svc.sheetFor('clerk_1', 'mo-1');
    expect(sheet.needs.missingRequired).toContain('GOOD_STANDING_LETTER');
    // The card itself is attached either way, so only the second role moves.
    expect(sheet.needs.missingRequired).not.toContain('ASSOCIATION_CARD');
  });
});
