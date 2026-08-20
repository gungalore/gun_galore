import {
  CredentialSource,
  credentialChoices,
  credentialOffer,
  toIsoDay,
  validLongEnough,
} from './motivation-credentials';
import { normaliseFirearmType } from './saps-vocabulary';

// What the vault fills into a licence application. Getting a serial into the
// wrong row, or overwriting something the applicant typed, puts a wrong claim
// on a form they sign — so the rules below are the point of the module, not
// incidental behaviour.

const licence = (
  over: Partial<CredentialSource> & { details?: Record<string, string> } = {},
): CredentialSource => ({
  id: 'c1',
  kind: 'FIREARM_LICENCE',
  title: 'My .308',
  expiresOn: '2030-01-01',
  confirmed: true,
  details: {
    make: 'Tikka',
    calibre: '.308 Win',
    frame_serial: 'F12345',
    barrel_serial: 'B67890',
    licence_number: 'LIC-001',
    firearm_type: 'Bolt Action Rifle',
  },
  ...over,
});

const competency = (
  over: Partial<CredentialSource> = {},
): CredentialSource => ({
  id: 'k1',
  kind: 'COMPETENCY_CERTIFICATE',
  title: 'My competency',
  expiresOn: '2029-06-30',
  confirmed: true,
  details: { competency_number: 'COMP-999', holder_name: 'A Person' },
  ...over,
});

const TYPE = 'S16_DEDICATED_SPORT' as never;

describe('what the Licence Centre offers a motivation', () => {
  it('fills the competency number off the certificate', () => {
    const o = credentialOffer(TYPE, [competency()], {});
    expect(o.values.competency_number).toBe('COMP-999');
    expect(o.items[0].from).toBe('My competency');
  });

  it('fills a firearm into the first row, normalising the type', () => {
    const o = credentialOffer(TYPE, [licence()], {});
    expect(o.values.existing_firearm_1_make).toBe('Tikka');
    expect(o.values.existing_firearm_1_calibre).toBe('.308 Win');
    expect(o.values.existing_firearm_1_frame_serial).toBe('F12345');
    expect(o.values.existing_firearm_1_barrel_serial).toBe('B67890');
    expect(o.values.existing_firearm_1_licence_no).toBe('LIC-001');
    // "Bolt Action Rifle" is not one of the form's four words.
    expect(o.values.existing_firearm_1_type).toBe('Rifle');
  });

  it('NEVER overwrites something the applicant typed', () => {
    const answered = {
      competency_number: 'WHAT-I-TYPED',
      existing_firearm_1_make: 'Sako',
    };
    const o = credentialOffer(TYPE, [competency(), licence()], answered);
    expect(o.values.competency_number).toBeUndefined();
    // Row 1 is theirs now, so the licence must go somewhere else entirely —
    // never half into a row that already describes a different firearm.
    expect(o.values.existing_firearm_1_calibre).toBeUndefined();
    expect(o.values.existing_firearm_2_make).toBe('Tikka');
  });

  it('treats a row as taken if ANY of its six columns is filled', () => {
    // The dangerous case: only the serial is typed. Filling make and calibre
    // around it would produce a form describing a firearm that does not exist.
    for (const col of [
      'type',
      'calibre',
      'make',
      'barrel_serial',
      'frame_serial',
      'licence_no',
    ]) {
      const o = credentialOffer(TYPE, [licence()], {
        [`existing_firearm_1_${col}`]: 'something',
      });
      expect(o.values.existing_firearm_1_make).toBeUndefined();
      expect(o.values.existing_firearm_2_make).toBe('Tikka');
    }
  });

  it('gives each firearm its own row, in vault order', () => {
    const two = [
      licence({ id: 'a', title: 'Rifle' }),
      licence({
        id: 'b',
        title: 'Pistol',
        details: {
          make: 'Glock',
          calibre: '9mm',
          frame_serial: 'G1',
          licence_number: 'LIC-002',
          firearm_type: 'Semi-Auto Pistol',
        },
      }),
    ];
    const o = credentialOffer(TYPE, two, {});
    expect(o.values.existing_firearm_1_make).toBe('Tikka');
    expect(o.values.existing_firearm_2_make).toBe('Glock');
    expect(o.values.existing_firearm_2_type).toBe('Handgun');
    // No serial may ever appear against two different firearms.
    expect(o.values.existing_firearm_2_frame_serial).toBe('G1');
    expect(o.values.existing_firearm_1_frame_serial).toBe('F12345');
  });

  it('says which documents it could take nothing from, and why', () => {
    const blank = licence({ id: 'z', title: 'A blurry photo', details: {} });
    const o = credentialOffer(TYPE, [blank], {});
    expect(o.values.existing_firearm_1_make).toBeUndefined();
    expect(o.skipped).toHaveLength(1);
    expect(o.skipped[0].title).toBe('A blurry photo');
    expect(o.skipped[0].why).toMatch(/make, calibre or serial/);
  });

  it('stops at the six rows the form has, and says so', () => {
    const seven = Array.from({ length: 7 }, (_, i) =>
      licence({
        id: `c${i}`,
        title: `Gun ${i + 1}`,
        details: { make: `Make${i}`, licence_number: `L${i}` },
      }),
    );
    const o = credentialOffer(TYPE, seven, {});
    expect(o.values.existing_firearm_6_make).toBe('Make5');
    expect(o.values.existing_firearm_7_make).toBeUndefined();
    expect(o.skipped.some((s) => /room for 6/.test(s.why))).toBe(true);
  });

  it('never offers a key the licence type does not have', () => {
    // S13 has no dedicated-status fields. Offering association_name there
    // would write an answer the form cannot show and nobody can correct.
    const o = credentialOffer(
      'S13_SELF_DEFENCE' as never,
      [
        {
          id: 'd1',
          kind: 'DEDICATED_HUNTER',
          title: 'Dedicated hunter',
          expiresOn: null,
          confirmed: true,
          details: { association: 'SAHGCA', status_number: 'DH-1' },
        },
      ],
      {},
    );
    expect(o.values.association_name).toBeUndefined();
  });

  it('takes association details off a dedicated hunter certificate', () => {
    const o = credentialOffer(
      'S16_DEDICATED_HUNTER' as never,
      [
        {
          id: 'd1',
          kind: 'DEDICATED_HUNTER',
          title: 'My dedicated hunter status',
          expiresOn: '2028-03-01',
          confirmed: true,
          details: { association: 'SAHGCA', status_number: 'DH-1' },
        },
      ],
      {},
    );
    expect(o.values.association_name).toBe('SAHGCA');
    expect(o.values.association_number).toBe('DH-1');
  });

  it('⚠️ NEVER treats a professional hunter registration as dedicated status', () => {
    // A PH registration is a provincial occupational licence to hunt for a
    // client. It evidences nothing under section 16, and filing it as
    // association membership would put a false claim in an application.
    const o = credentialOffer(
      'S16_DEDICATED_HUNTER' as never,
      [
        {
          id: 'p1',
          kind: 'PROFESSIONAL_HUNTER',
          title: 'My PH registration',
          expiresOn: '2027-01-01',
          confirmed: true,
          details: {
            registration_number: 'PH-42',
            province: 'Limpopo',
            association: 'Limpopo Nature Conservation',
          },
        },
      ],
      {},
    );
    expect(o.values.association_name).toBeUndefined();
    expect(o.values.association_number).toBeUndefined();
    expect(o.items).toHaveLength(0);
  });

  it('reports an empty vault as empty rather than silently offering nothing', () => {
    const o = credentialOffer(TYPE, [], {});
    expect(o.empty).toBe(true);
    expect(o.items).toHaveLength(0);
  });

  it('ignores blank and whitespace-only readings', () => {
    const o = credentialOffer(
      TYPE,
      [competency({ details: { competency_number: '   ' } })],
      {},
    );
    expect(o.values.competency_number).toBeUndefined();
    expect(o.skipped).toHaveLength(1);
  });
});

describe('normaliseFirearmType', () => {
  // The SAPS 271 offers exactly four types, and both the dropdown holding the
  // answer and the printed form accept only those four.
  it('maps what a certificate says onto the form’s four words', () => {
    expect(normaliseFirearmType('Semi-Auto Pistol')).toBe('Handgun');
    expect(normaliseFirearmType('Revolver')).toBe('Handgun');
    expect(normaliseFirearmType('BOLT ACTION RIFLE')).toBe('Rifle');
    expect(normaliseFirearmType('.22 Carbine')).toBe('Rifle');
    expect(normaliseFirearmType('Double Barrel Shotgun')).toBe('Shotgun');
    expect(normaliseFirearmType('Combination gun')).toBe('Combination');
  });

  it('⚠️ reads a combination gun as a combination, not a shotgun', () => {
    // A combination gun IS a rifle and a shotgun in one frame, so its
    // description contains both words. Testing "shotgun" first filed every
    // one of them as a shotgun — which both copies of this function used to
    // do, on a form the applicant signs.
    expect(normaliseFirearmType('rifle/shotgun combination')).toBe(
      'Combination',
    );
    expect(normaliseFirearmType('Combo shotgun/rifle')).toBe('Combination');
  });

  it('returns nothing rather than guessing', () => {
    // A blank the applicant fills in is recoverable. A confident wrong type
    // on a form describing a firearm they own is not.
    expect(normaliseFirearmType('Blunderbuss')).toBe('');
    expect(normaliseFirearmType('')).toBe('');
    expect(normaliseFirearmType(undefined)).toBe('');
  });
});

describe('toIsoDay', () => {
  it('reads the UTC day, matching how the vault stores expiries', () => {
    expect(toIsoDay(new Date('2026-08-19T00:00:00Z'))).toBe('2026-08-19');
    expect(toIsoDay(new Date('2026-08-19T23:59:59Z'))).toBe('2026-08-19');
    expect(toIsoDay(new Date('2026-01-05T00:00:00Z'))).toBe('2026-01-05');
  });
});

describe('credentialChoices', () => {
  const cert = (
    id: string,
    title: string,
    details: Record<string, string>,
    kind = 'COMPETENCY_CERTIFICATE',
  ) => ({ id, kind, title, expiresOn: null, details, confirmed: true });

  it('⚠️ OFFERS EVERY COMPETENCY, because the offer only ever picks one', () => {
    // The case that made this necessary: a renewed certificate and the
    // expired original, or a handgun competency and a rifle one. credentialOffer
    // fills the first and stops, which is right for one document and wrong
    // for two — then the only correct behaviour is to ask.
    const { competency } = credentialChoices([
      cert('a', 'Competency 2019', { competency_number: 'C-111' }),
      cert('b', 'Competency 2024', { competency_number: 'C-222' }),
    ]);
    expect(competency.map((c) => c.values.competency_number)).toEqual([
      'C-111',
      'C-222',
    ]);
  });

  it('reads the fallback key when the primary one is absent', () => {
    const { competency } = credentialChoices([
      cert('a', 'Competency', { certificate_number: 'C-333' }),
    ]);
    expect(competency[0].values.competency_number).toBe('C-333');
  });

  it('⚠️ DROPS A CERTIFICATE WITH NO NUMBER ON IT', () => {
    // An entry that does nothing when picked is worse than no entry: it reads
    // as "we have this on file" and then silently fills nothing.
    const { competency } = credentialChoices([
      cert('a', 'Blurred photo', { holder_name: 'G Fourie' }),
    ]);
    expect(competency).toHaveLength(0);
  });

  it('⚠️ KEEPS THE ASSOCIATION NAME AND NUMBER TOGETHER', () => {
    // Offering them as independent picks lets somebody with two associations
    // end up with one body's name against the other's number — a false
    // statement on a section 16 application.
    const { dedicated } = credentialChoices([
      cert('a', 'SAGA card', { association: 'SAGA', status_number: 'S-1' }, 'DEDICATED_STATUS'),
      cert('b', 'NATSHOOT card', { association: 'NATSHOOT', membership_number: 'N-2' }, 'DEDICATED_HUNTER'),
    ]);
    expect(dedicated).toHaveLength(2);
    expect(dedicated[0].values).toEqual({
      association_name: 'SAGA',
      association_number: 'S-1',
    });
    expect(dedicated[1].values).toEqual({
      association_name: 'NATSHOOT',
      association_number: 'N-2',
    });
  });

  it('⚠️ NEVER OFFERS A PROFESSIONAL HUNTER REGISTRATION as dedicated status', () => {
    // Same reason it is excluded from the offer: a PH registration is a
    // provincial nature-conservation qualification to hunt for a client, not
    // section 16 dedicated status, and filing it as association membership
    // puts a wrong claim in somebody's application.
    const { dedicated } = credentialChoices([
      cert('a', 'PH registration', { association: 'DEDAT', status_number: 'PH-9' }, 'PROFESSIONAL_HUNTER'),
    ]);
    expect(dedicated).toHaveLength(0);
  });

  it('takes a card with only one half of the pair', () => {
    const { dedicated } = credentialChoices([
      cert('a', 'Card', { association: 'SAGA' }, 'DEDICATED_STATUS'),
    ]);
    expect(dedicated[0].values).toEqual({ association_name: 'SAGA' });
  });

  it('ignores unrelated kinds and an empty vault', () => {
    expect(credentialChoices([])).toEqual({ competency: [], dedicated: [] });
    const only = credentialChoices([
      cert('a', 'Rifle licence', { licence_no: 'L-1' }, 'FIREARM_LICENCE'),
    ]);
    expect(only).toEqual({ competency: [], dedicated: [] });
  });
});

describe('validLongEnough', () => {
  const today = new Date('2026-08-20T00:00:00Z');

  it('⚠️ REFUSES A LETTER THAT EXPIRES BEFORE A DECISION COMES BACK', () => {
    // SAPS takes months over a section 16. A letter of good standing with
    // three weeks left is one the DFO rejects or the Registrar queries long
    // before anyone decides — and attaching it silently hands somebody a pack
    // that looks complete and is already stale.
    expect(validLongEnough('2026-09-10', today)).toBe(false);
    expect(validLongEnough('2026-11-17', today)).toBe(false);
  });

  it('takes one with three months or more left', () => {
    expect(validLongEnough('2026-11-18', today)).toBe(true);
    expect(validLongEnough('2027-06-30', today)).toBe(true);
  });

  it('⚠️ TAKES A DOCUMENT WITH NO EXPIRY AT ALL', () => {
    // The dedicated status certificate carries an issue date and nothing
    // else — the operator's says 11 Jun 2024 and never runs out. Treating a
    // missing expiry as "expired" would refuse to reuse the one document that
    // genuinely cannot go stale.
    expect(validLongEnough(null, today)).toBe(true);
  });

  it('refuses one that has already run out, and one it cannot read', () => {
    expect(validLongEnough('2025-06-30', today)).toBe(false);
    expect(validLongEnough('not a date', today)).toBe(false);
  });
});

describe('the confirmed contract, enforced', () => {
  it('⚠️ NEVER OFFERS A VALUE OFF AN UNCONFIRMED DOCUMENT', () => {
    // "FALSE MEANS DO NOT OFFER IT" was documented on CredentialSource and
    // never checked — safe only while every caller pre-filtered. The offer is
    // the ONE-BUTTON fill: values written without the member looking at each,
    // onto a document they sign. The choices dropdown may show unconfirmed
    // documents, because there the member is looking at the value; this path
    // must not.
    const offer = credentialOffer(
      'S16_DEDICATED_SPORT',
      [
        {
          id: 'a',
          kind: 'COMPETENCY_CERTIFICATE',
          title: 'Fresh off the phone',
          expiresOn: null,
          details: { competency_number: 'C-999' },
          confirmed: false,
        },
      ],
      {},
    );
    expect(offer.values.competency_number).toBeUndefined();
    expect(offer.items).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────
// THE SAME FIREARM MUST NOT BE OFFERED TWICE.
//
// Rows are claimed from the first free slot, so once a licence has been
// filled into row 1, the very same credential was offered again as "Firearm
// 2" — and then 3, and 4, for as long as there were empty rows. Accepting
// that puts six entries on a SAPS 271 describing one rifle, on a form the
// applicant signs.
//
// Live on MO000017: one .223 NORDISKE PRECISION in row 1, and the offer
// proposing the identical make, calibre and serial as Firearm 2.
// ────────────────────────────────────────────────────────────────────
describe('a firearm already on the form', () => {
  const TYPE2 = 'S16_DEDICATED_SPORT' as never;

  const rowOne = {
    existing_firearm_1_type: 'Rifle',
    existing_firearm_1_calibre: '.308 Win',
    existing_firearm_1_make: 'Tikka',
    existing_firearm_1_frame_serial: 'F12345',
    existing_firearm_1_barrel_serial: 'B67890',
    existing_firearm_1_licence_no: 'LIC-001',
  };

  it('is not offered again for the next free row', () => {
    const o = credentialOffer(TYPE2, [licence()], rowOne);
    const proposed = Object.keys(o.values).filter((k) =>
      k.startsWith('existing_firearm_'),
    );
    expect(proposed).toEqual([]);
  });

  it('matches on the licence number even if the serials were retyped', () => {
    const o = credentialOffer(TYPE2, [licence()], {
      ...rowOne,
      existing_firearm_1_frame_serial: 'typed it differently',
      existing_firearm_1_barrel_serial: '',
    });
    expect(
      Object.keys(o.values).filter((k) => k.startsWith('existing_firearm_')),
    ).toEqual([]);
  });

  it('STILL offers a genuinely different firearm', () => {
    // The guard must not swallow the second rifle somebody actually owns.
    const other = licence({
      id: 'c2',
      title: 'My .22',
      details: {
        make: 'CZ',
        calibre: '.22 LR',
        frame_serial: 'F99999',
        barrel_serial: 'B99999',
        licence_number: 'LIC-002',
        firearm_type: 'Bolt Action Rifle',
      },
    });
    const o = credentialOffer(TYPE2, [other], rowOne);
    expect(o.values.existing_firearm_2_make).toBe('CZ');
    expect(o.values.existing_firearm_2_licence_no).toBe('LIC-002');
  });

  it('⚠️ does NOT treat a blank frame serial as a match', () => {
    // A licence that reads NONE for the frame number is common — plenty of
    // rifles have no frame serial. Matching on it would make every such
    // firearm a duplicate of every other, and the applicant would be unable
    // to list their second rifle at all.
    const noFrame = (id: string, lic: string, barrel: string) =>
      licence({
        id,
        details: {
          make: 'Musgrave',
          calibre: '.30-06',
          frame_serial: 'NONE',
          barrel_serial: barrel,
          licence_number: lic,
          firearm_type: 'Bolt Action Rifle',
        },
      });
    const o = credentialOffer(TYPE2, [noFrame('c3', 'LIC-003', 'B333')], {
      existing_firearm_1_frame_serial: 'NONE',
      existing_firearm_1_licence_no: 'LIC-999',
      existing_firearm_1_barrel_serial: 'B111',
    });
    expect(o.values.existing_firearm_2_licence_no).toBe('LIC-003');
  });
});

// ────────────────────────────────────────────────────────────────────
// ONE SLOT PER ASSOCIATION.
//
// The professional motivations list three associations, each with its own
// membership number and joined date. One slot meant the first vault document
// claimed association_name and every other body silently fell off the
// application. And two documents from the SAME body are one membership —
// listing it twice on a signed form is a false claim of two.
// ────────────────────────────────────────────────────────────────────
describe('several associations', () => {
  const T = 'S16_DEDICATED_SPORT' as never;
  const body = (
    id: string,
    association: string,
    membership: string,
  ): CredentialSource => ({
    id,
    kind: 'DEDICATED_DISCIPLINE' as never,
    title: association,
    expiresOn: '2027-06-30',
    confirmed: true,
    details: {
      association,
      membership_number: membership,
      status_number: `SS-${membership}`,
      joined_on: '2019-08-17',
    },
  });

  it('fills each association into its own slot', () => {
    const o = credentialOffer(
      T,
      [body('c1', 'NHSA', '111'), body('c2', 'KSSC', '222')],
      {},
    );
    expect(o.values.association_name).toBe('NHSA');
    expect(o.values.association_2_name).toBe('KSSC');
    expect(o.values.association_2_number).toBe('222');
    expect(o.values.association_2_joined).toBe('2019-08-17');
  });

  it('prefers the MEMBERSHIP number for the membership box', () => {
    // The status number is a different reference; putting it in a box
    // labelled "Membership number" mislabels it on a signed form.
    const o = credentialOffer(T, [body('c1', 'NHSA', '111')], {});
    expect(o.values.association_number).toBe('111');
  });

  it('two documents from one body are ONE membership', () => {
    const o = credentialOffer(
      T,
      [body('c1', 'SA Hunters', '108828'), body('c2', 'sa hunters', '108828')],
      {},
    );
    expect(o.values.association_name).toBe('SA Hunters');
    expect(o.values.association_2_name).toBeUndefined();
  });

  it('skips a body the applicant already listed by hand', () => {
    const o = credentialOffer(T, [body('c1', 'NHSA', '111')], {
      association_name: 'NHSA',
    });
    expect(o.values.association_2_name).toBeUndefined();
  });

  it('reports a fourth association as out of room, not silently', () => {
    const o = credentialOffer(
      T,
      [
        body('c1', 'A1', '1'),
        body('c2', 'A2', '2'),
        body('c3', 'A3', '3'),
        body('c4', 'A4', '4'),
      ],
      {},
    );
    expect(o.values.association_3_name).toBe('A3');
    expect(o.skipped.some((k) => /room for three/.test(k.why))).toBe(true);
  });
});
