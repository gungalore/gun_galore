import {
  type DatedLicence,
  firearmFacets,
} from './credential-firearm-facets';

// ────────────────────────────────────────────────────────────────────
// THE DOCUMENT CENTRE IS GROUPED BY FIREARM, AND THIS IS WHAT IT GROUPS ON.
//
// One row per licensed firearm, by category; the competencies that cover them
// underneath; the training certificates behind those. Every fact that
// grouping needs lives inside an AES-GCM blob or in a column the page never
// receives, so if these five fields are wrong the page files a member's
// firearm under the wrong heading — or under none — and nothing on screen
// says so.
// ────────────────────────────────────────────────────────────────────

const NOTHING: DatedLicence[] = [];

function row(over: Partial<Parameters<typeof firearmFacets>[0]> = {}) {
  return {
    kind: 'OTHER',
    coversKinds: [] as string[],
    firearmCategory: null,
    firearmSelfLoading: null,
    expiresOn: null,
    dateSource: null,
    details: {} as Record<string, string>,
    ...over,
  };
}

describe('what a licence row says about its firearm', () => {
  it('carries its category and its action', () => {
    const out = firearmFacets(
      row({
        kind: 'FIREARM_LICENCE',
        firearmCategory: 'rifle-carbine',
        firearmSelfLoading: false,
      }),
      NOTHING,
    );
    expect(out.category).toBe('rifle-carbine');
    expect(out.selfLoading).toBe(false);
    // A licence covers nothing and proves no unit standard.
    expect(out.covers).toEqual([]);
    expect(out.unitStandards).toEqual([]);
    expect(out.follows).toBeNull();
  });

  it('keeps an unknown action as null rather than as "manual"', () => {
    // ⚠️ THE .223 THE CARD DID NOT DESCRIBE. false would file it as a manual
    // rifle and let a manual-rifle competency follow it — the exact confusion
    // deriveCertificateExpiry's known-action rule exists to stop.
    const out = firearmFacets(
      row({ kind: 'FIREARM_LICENCE', firearmCategory: 'rifle-carbine' }),
      NOTHING,
    );
    expect(out.selfLoading).toBeNull();
  });
});

describe('what a competency certificate covers', () => {
  const covering = (covers: string, over = {}) =>
    firearmFacets(
      row({ kind: 'COMPETENCY_CERTIFICATE', details: { covers }, ...over }),
      NOTHING,
    );

  it('lists every category it covers, in one fixed order', () => {
    // Printed rifle-first; rendered handgun-first, because two members with
    // the same certificate must read identically.
    const out = covering('S/L-RIFLE/CARB, HANDGUN');
    expect(out.covers).toEqual(['handgun', 'rifle-carbine']);
    // A certificate is not itself a firearm the member owns.
    expect(out.category).toBeNull();
    expect(out.selfLoading).toBeNull();
  });

  it('deduplicates the two rifle actions onto one category', () => {
    const out = covering('119650, 119651');
    expect(out.covers).toEqual(['rifle-carbine']);
  });

  it('covers nothing when the endorsement line could not be read', () => {
    // ⚠️ EMPTY MEANS "WE COULD NOT READ IT", not "it covers nothing" — the
    // distinction H5 was about. The page must render an unknown, not a claim.
    expect(covering('').covers).toEqual([]);
  });
});

describe('which licence a competency date follows', () => {
  const HANDGUN_2033 = new Date('2033-09-30T00:00:00Z');
  const RIFLE_2035 = new Date('2035-01-01T00:00:00Z');

  const licences: DatedLicence[] = [
    {
      id: 'lic-handgun',
      category: 'handgun',
      selfLoading: null,
      expiresOn: HANDGUN_2033,
      title: 'GLOCK 19',
      createdAt: new Date('2024-01-01T00:00:00Z'),
    },
    {
      id: 'lic-rifle-old',
      category: 'rifle-carbine',
      selfLoading: false,
      expiresOn: RIFLE_2035,
      title: 'MAUSER .30-06',
      createdAt: new Date('2024-02-01T00:00:00Z'),
    },
    {
      id: 'lic-rifle-new',
      category: 'rifle-carbine',
      selfLoading: false,
      expiresOn: RIFLE_2035,
      title: 'TIKKA T3X',
      createdAt: new Date('2026-05-01T00:00:00Z'),
    },
  ];

  const cert = (over = {}) =>
    firearmFacets(
      row({
        kind: 'COMPETENCY_CERTIFICATE',
        // The codes, because "RIFLE/CARB" with no action token beside it is
        // two clauses parseEndorsements will not guess between.
        details: { covers: '119649, 119651' },
        dateSource: 'derived',
        expiresOn: RIFLE_2035,
        ...over,
      }),
      licences,
    );

  it('points at the licence whose date it took', () => {
    // ⚠️ ONE CERTIFICATE TAKES ONE DATE — the longest licence behind it, even
    // where that licence is in the other half of what it covers. The whole
    // point of naming it: a handgun-and-rifle certificate reading 2035 is
    // standing on a rifle, and the member cannot tell that from the date.
    const out = cert();
    expect(out.covers).toEqual(['handgun', 'rifle-carbine']);
    // Two rifles end on that day; the one filed first is named, so the answer
    // does not change with the row order the database happened to return.
    expect(out.follows).toEqual({ id: 'lic-rifle-old', title: 'MAUSER .30-06' });
  });

  it('names nothing when the member put the date there', () => {
    // ⚠️ A DATE THEY TYPED FOLLOWS NOTHING. Naming a licence beside it is a
    // false account of where the date came from, on the one screen they would
    // check first if a reminder were ever wrong.
    expect(cert({ dateSource: null }).follows).toBeNull();
    expect(cert({ dateSource: 'read' }).follows).toBeNull();
  });

  it('names nothing when no licence it covers ends on that day', () => {
    // The five-year fallback, and a date read off some other document. Either
    // way there is no licence to point at, and inventing one would be a lie
    // the page would render as a link.
    expect(cert({ expiresOn: new Date('2029-06-15T00:00:00Z') }).follows).toBeNull();
  });

  it('never crosses into a category the certificate does not cover', () => {
    // A handgun-only certificate must not be shown following a rifle, even
    // when the dates coincide: s10(2) ties it to the licence it RELATES to.
    const out = firearmFacets(
      row({
        kind: 'COMPETENCY_CERTIFICATE',
        details: { covers: 'HANDGUN' },
        dateSource: 'derived',
        expiresOn: RIFLE_2035,
      }),
      licences,
    );
    expect(out.follows).toBeNull();
  });

  it('never names a muzzle-loader licence', () => {
    // A muzzle loader takes no licence at all (s3(2)) and runs its own
    // ten-year clock under s10(3), so it can never be what a certificate
    // follows — however a muzzle-loader row came to be in the vault.
    const out = firearmFacets(
      row({
        kind: 'COMPETENCY_CERTIFICATE',
        details: { covers: 'MUZZLE LOADING FIREARM' },
        dateSource: 'derived',
        expiresOn: RIFLE_2035,
      }),
      [
        {
          id: 'lic-ml',
          category: 'muzzle-loader',
          expiresOn: RIFLE_2035,
          title: 'PEDERSOLI .50',
        },
      ],
    );
    expect(out.follows).toBeNull();
  });
});

describe('what a statement of results proves', () => {
  const statement = (unit_standard: string) =>
    firearmFacets(row({ kind: 'PROFICIENCY', details: { unit_standard } }), NOTHING);

  it('reads its firearm and its unit standards off the codes', () => {
    const out = statement('117705, 119649');
    expect(out.category).toBe('handgun');
    expect(out.unitStandards).toEqual([
      {
        code: '117705',
        title:
          'Demonstrate knowledge of the Firearms Control Act applicable to possessing a firearm',
      },
      { code: '119649', title: 'Handle and use a handgun' },
    ]);
  });

  it('⚠️ 117705 ON ITS OWN IS UNDER NO FIREARM', () => {
    // Knowledge of the Act endorses nothing. It is on every statement and is
    // required for every application, but it belongs to no firearm group —
    // filing it under one would put a page about the law under somebody's
    // rifle.
    const out = statement('117705');
    expect(out.category).toBeNull();
    expect(out.unitStandards).toHaveLength(1);
  });

  it('gives no category to a statement carrying two firearms', () => {
    // ⚠️ NULL RATHER THAN A GUESS. A handgun-and-shotgun course belongs to
    // both groups and the row carries one category, so filing it under the
    // first would put it under the wrong firearm half the time.
    const out = statement('117705, 119649, 119652');
    expect(out.category).toBeNull();
    expect(out.unitStandards.map((u) => u.code)).toEqual([
      '117705',
      '119649',
      '119652',
    ]);
  });

  it('keeps a code we do not carry, titled with its own number', () => {
    // parseUnitStandards only admits an unknown code when a unit standard
    // TITLE follows it, so this is a real SAQA unit we have not met. Dropping
    // it would tell the member their certificate proves less than it does.
    const out = statement('123456 Handle and use something we have never met');
    expect(out.unitStandards).toEqual([{ code: '123456', title: '123456' }]);
    expect(out.category).toBeNull();
  });

  it('reads the codes from `covers` too, where that is where they landed', () => {
    // The two extractors do not agree on a key; the same document must not
    // resolve differently on two screens. See coversText.
    const out = firearmFacets(
      row({ kind: 'PROFICIENCY', details: { covers: '119652' } }),
      NOTHING,
    );
    expect(out.category).toBe('shotgun');
  });
});

describe('every other kind', () => {
  it('says nothing about a firearm at all', () => {
    for (const kind of ['IDENTITY_DOCUMENT', 'SAFE_PHOTOGRAPHS', 'OTHER']) {
      const out = firearmFacets(row({ kind, details: { covers: 'HANDGUN' } }), NOTHING);
      expect(out).toEqual({
        category: null,
        selfLoading: null,
        covers: [],
        follows: null,
        unitStandards: [],
      });
    }
  });

  it('categorises a document that COVERS a firearm licence', () => {
    // A page listing several firearms is filed under one kind and covers
    // another; list() already treats it as a licence for the derivation, so
    // the grouping must agree with it.
    const out = firearmFacets(
      row({
        kind: 'OTHER',
        coversKinds: ['FIREARM_LICENCE'],
        firearmCategory: 'shotgun',
      }),
      NOTHING,
    );
    expect(out.category).toBe('shotgun');
  });
});
