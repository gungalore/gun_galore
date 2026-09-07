import { describe, expect, it } from 'vitest';
import {
  buildSections,
  chipCounts,
  competencySubline,
  defaultOpenSections,
  firearmName,
  firearmSubline,
  matchesQuery,
  placeRow,
  renewByIso,
  trainingName,
} from './document-centre-sections';
import { CredentialKind, CredentialRow } from './licence-centre-api';

// ────────────────────────────────────────────────────────────────────
// The four ways a grouped list can lose a document, and the order it puts
// them in. Every one of these is a thing the old flat list could not get
// wrong — see the header of the module under test.
// ────────────────────────────────────────────────────────────────────

let seq = 0;

function row(over: Partial<CredentialRow> = {}): CredentialRow {
  seq += 1;
  return {
    id: `c${seq}`,
    kind: 'FIREARM_LICENCE',
    title: '',
    issuedOn: null,
    expiresOn: null,
    confirmed: true,
    neverExpires: false,
    issuedOnUnknown: false,
    coversKinds: [],
    remindersMuted: false,
    state: 'valid',
    renewalDue: false,
    details: {},
    available: true,
    mimeType: 'image/jpeg',
    byteSize: 100,
    createdAt: '2026-01-01T00:00:00.000Z',
    autoFiled: false,
    namedConfident: true,
    readUncertain: [],
    readNotes: [],
    attention: [],
    duplicateOf: null,
    otherSide: null,
    dateSource: 'read',
    dateSourceNote: null,
    ...over,
  };
}

function view(rows: CredentialRow[]) {
  return buildSections({ rows });
}

function section(rows: CredentialRow[], id: string) {
  const v = view(rows).find((s) => s.section.id === id);
  if (!v) throw new Error(`no section ${id}`);
  return v;
}

function idsIn(rows: CredentialRow[], id: string): string[] {
  return section(rows, id).groups.flatMap((g) => g.rows.map((n) => n.row.id));
}

describe('placing a row', () => {
  it('puts a licence under Your firearms', () => {
    expect(placeRow(row({ kind: 'FIREARM_LICENCE' }))).toBe('firearms');
  });

  it('puts a document that ALSO covers a licence under Your firearms', () => {
    expect(
      placeRow(row({ kind: 'OTHER', coversKinds: ['FIREARM_LICENCE'] })),
    ).toBe('firearms');
  });

  it('gives training certificates their own section, never competency', () => {
    expect(placeRow(row({ kind: 'PROFICIENCY' }))).toBe('training');
    expect(placeRow(row({ kind: 'COMPETENCY_CERTIFICATE' }))).toBe('competency');
  });

  it('places the retired kinds rather than dropping them', () => {
    // Postgres cannot drop an enum value, so a member can still be holding one.
    expect(placeRow(row({ kind: 'GOOD_STANDING' }))).toBe('associations');
    expect(placeRow(row({ kind: 'SAFE_PHOTO_BOLTS' }))).toBe('safe');
  });

  it('falls through to Anything else rather than vanishing', () => {
    expect(placeRow(row({ kind: 'NOT_A_KIND' as CredentialKind }))).toBe('other');
  });

  it('shows every row exactly once across every section', () => {
    const rows = [
      row({ kind: 'FIREARM_LICENCE' }),
      row({ kind: 'COMPETENCY_CERTIFICATE' }),
      row({ kind: 'PROFICIENCY' }),
      row({ kind: 'IDENTITY_DOCUMENT' }),
      row({ kind: 'OTHER' }),
    ];
    const seen = view(rows).flatMap((s) => [
      ...s.groups.flatMap((g) => g.rows.map((n) => n.row.id)),
      ...s.photos.map((n) => n.row.id),
    ]);
    expect(seen.sort()).toEqual(rows.map((r) => r.id).sort());
  });
});

describe('Your firearms', () => {
  it('groups by category, with the unread category last', () => {
    const rows = [
      row({ category: null }),
      row({ category: 'shotgun' }),
      row({ category: 'handgun' }),
      row({ category: 'rifle-carbine' }),
      row({ category: 'muzzle-loader' }),
    ];
    expect(section(rows, 'firearms').groups.map((g) => g.label)).toEqual([
      'Handgun',
      'Rifle and carbine',
      'Shotgun',
      'Muzzle loader',
      'Category not read',
    ]);
  });

  it('sorts soonest first, then undated, then never-expires', () => {
    const soon = row({ category: 'handgun', expiresOn: '2027-01-04' });
    const later = row({ category: 'handgun', expiresOn: '2033-03-12' });
    const undated = row({ category: 'handgun', expiresOn: null });
    const kept = row({
      category: 'handgun',
      neverExpires: true,
      state: 'no-expiry',
    });
    const order = idsIn([kept, undated, later, soon], 'firearms');
    expect(order).toEqual([soon.id, later.id, undated.id, kept.id]);
  });

  it("uses the member's own title over the make we read", () => {
    expect(
      firearmName(row({ title: "Dad's .303", details: { make: 'Tikka' } })),
    ).toBe("Dad's .303");
  });

  it('names an untitled licence by make, model and calibre', () => {
    expect(
      firearmName(
        row({ details: { make: 'Tikka', model: 'T3x', calibre: '.308 Win' } }),
      ),
    ).toBe('Tikka T3x · .308 Win');
  });

  it('falls back to the kind label when the card read nothing', () => {
    expect(firearmName(row({ details: {} }))).toBe('Firearm licence');
  });

  it('says the section, the action and the lodging date', () => {
    const parts = firearmSubline(
      row({
        details: { section: 'Section 13' },
        selfLoading: true,
        renewalDue: true,
        expiresOn: '2027-01-04',
      }),
    );
    expect(parts[0]).toBe('Section 13 · self-defence');
    expect(parts[1]).toBe('self-loading');
    expect(parts[2]).toContain('SAPS 517(g)');
    expect(parts[2]).toContain('6 Oct 2026');
  });

  it('leaves section 16 unnamed, because the card does not say which', () => {
    expect(firearmSubline(row({ details: { section: 'S16(1)' } }))[0]).toBe(
      'Section 16',
    );
  });

  it('counts back 90 days for the lodging date', () => {
    expect(renewByIso('2027-01-04')).toBe('2026-10-06');
    expect(renewByIso(null)).toBeNull();
  });
});

describe('Competency', () => {
  it('shows a certificate covering two categories ONCE, under the first', () => {
    const both = row({
      kind: 'COMPETENCY_CERTIFICATE',
      covers: ['rifle-carbine', 'shotgun'],
    });
    const v = section([both], 'competency');
    expect(v.groups.map((g) => g.label)).toEqual(['Rifle and carbine']);
    expect(v.groups.flatMap((g) => g.rows).length).toBe(1);
  });

  it('says what else it covers on its own sub-line', () => {
    expect(
      competencySubline(
        row({
          kind: 'COMPETENCY_CERTIFICATE',
          covers: ['rifle-carbine', 'shotgun'],
        }),
      ),
    ).toContain('also shotgun');
  });

  it('names the licence a derived date follows, and says we worked it out', () => {
    expect(
      competencySubline(
        row({
          kind: 'COMPETENCY_CERTIFICATE',
          follows: { id: 'x', title: 'Sako 85' },
          dateSource: 'derived',
        }),
      ),
    ).toEqual(['Follows your Sako 85 licence', 'worked out for you']);
  });
});

describe('Training certificates', () => {
  it('names the row by its unit standards', () => {
    expect(
      trainingName(
        row({
          kind: 'PROFICIENCY',
          unitStandards: [{ code: '119649', title: 'Handle and use a handgun' }],
        }),
      ),
    ).toBe('119649 · Handle and use a handgun');
  });

  it('puts a 117705-only certificate under Knowledge of the Act', () => {
    const act = row({
      kind: 'PROFICIENCY',
      unitStandards: [{ code: '117705', title: 'Knowledge of the Act' }],
      category: 'handgun',
    });
    expect(section([act], 'training').groups.map((g) => g.label)).toEqual([
      'Knowledge of the Act',
    ]);
  });

  it('folds a certificate and its statement of results into one row', () => {
    const front = row({
      kind: 'PROFICIENCY',
      details: { document_side: 'front' },
      createdAt: '2026-02-01T00:00:00.000Z',
    });
    const back = row({
      kind: 'PROFICIENCY',
      details: { document_side: 'back' },
      createdAt: '2026-02-02T00:00:00.000Z',
      otherSide: { id: front.id, title: null },
    });
    front.otherSide = { id: back.id, title: null };
    expect(idsIn([front, back], 'training')).toEqual([back.id]);
  });

  it('leaves a lone page as its own row when its partner is not here', () => {
    const front = row({
      kind: 'PROFICIENCY',
      details: { document_side: 'front' },
      otherSide: { id: 'gone', title: null },
    });
    expect(idsIn([front], 'training')).toEqual([front.id]);
  });
});

describe('duplicates', () => {
  it('folds a copy under its original instead of giving it a row', () => {
    const orig = row({ category: 'handgun' });
    const copy = row({
      category: 'handgun',
      duplicateOf: { id: orig.id, title: null },
    });
    const v = section([orig, copy], 'firearms');
    const nodes = v.groups.flatMap((g) => g.rows);
    expect(nodes.map((n) => n.row.id)).toEqual([orig.id]);
    expect(nodes[0].copies.map((c) => c.id)).toEqual([copy.id]);
    // The copy is not counted as a document of its own.
    expect(v.count).toBe(1);
  });

  it('lets a copy stand alone when its original is filtered out', () => {
    const orig = row({ category: 'handgun', title: 'Tikka' });
    const copy = row({
      category: 'handgun',
      title: 'Howa',
      duplicateOf: { id: orig.id, title: null },
    });
    expect(
      buildSections({ rows: [orig, copy], query: 'howa' })
        .find((s) => s.section.id === 'firearms')!
        .groups.flatMap((g) => g.rows.map((n) => n.row.id)),
    ).toEqual([copy.id]);
  });
});

describe('the safe', () => {
  it('draws photographs as a grid and the certificate as a row', () => {
    const photo = row({ kind: 'SAFE_PHOTOGRAPHS', neverExpires: true });
    const cert = row({ kind: 'SAFE_INSTALLATION' });
    const v = section([photo, cert], 'safe');
    expect(v.photos.map((n) => n.row.id)).toEqual([photo.id]);
    expect(v.groups.flatMap((g) => g.rows.map((n) => n.row.id))).toEqual([
      cert.id,
    ]);
    expect(v.count).toBe(2);
  });
});

describe('the chips', () => {
  const due = row({ state: 'expiring', category: 'handgun' });
  const undated = row({
    category: 'handgun',
    confirmed: false,
    dateSource: null,
  });
  const quiet = row({ category: 'handgun' });
  const rows = [due, undated, quiet];
  const usage = { [quiet.id]: [{} as never] };

  it('counts each chip off the rows it stands for', () => {
    expect(chipCounts(rows, usage)).toEqual({
      renewals: 1,
      dates: 1,
      motivations: 1,
    });
  });

  it('filters to the rows a chip counts', () => {
    expect(
      buildSections({ rows, chips: ['renewals'] })
        .find((s) => s.section.id === 'firearms')!
        .groups.flatMap((g) => g.rows.map((n) => n.row.id)),
    ).toEqual([due.id]);
  });

  it('unions several chips rather than intersecting them', () => {
    const shown = buildSections({ rows, chips: ['renewals', 'dates'] })
      .find((s) => s.section.id === 'firearms')!
      .groups.flatMap((g) => g.rows.map((n) => n.row.id));
    expect(shown.sort()).toEqual([due.id, undated.id].sort());
  });

  it('collapses a section that holds rows but matched none of them', () => {
    const v = buildSections({
      rows: [...rows, row({ kind: 'IDENTITY_DOCUMENT' })],
      chips: ['renewals'],
    }).find((s) => s.section.id === 'about-you')!;
    expect(v.emptied).toBe(true);
    expect(v.summary).toBe('None of these here');
  });

  it('leaves an empty section saying what belongs in it', () => {
    const v = section([], 'safe');
    expect(v.emptied).toBe(false);
    expect(v.summary).toContain('installation certificate');
  });
});

describe('search', () => {
  it('finds a row by a value in its details', () => {
    const r = row({ details: { calibre: '.308 Win' } });
    expect(matchesQuery(r, '.308')).toBe(true);
    expect(matchesQuery(r, '9 mm')).toBe(false);
  });

  it('finds a row by its licence number', () => {
    expect(matchesQuery(row({ details: { licence_number: '13/01/2022' } }), '2022')).toBe(true);
  });

  it('still finds a row by what it IS', () => {
    expect(matchesQuery(row({ kind: 'COMPETENCY_CERTIFICATE' }), 'competency')).toBe(true);
  });
});

describe('what opens by default', () => {
  it('opens the two sections a member came for', () => {
    expect(defaultOpenSections(view([row({ kind: 'IDENTITY_DOCUMENT' })]))).toEqual(
      ['firearms', 'competency'],
    );
  });

  it('opens any other section holding something a chip points at', () => {
    const open = defaultOpenSections(
      view([row({ kind: 'ADDRESS_CONFIRMATION', confirmed: false, dateSource: null })]),
    );
    expect(open).toContain('about-you');
  });
});
