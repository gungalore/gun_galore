import { CredentialKind, MotivationLicenceType } from '@prisma/client';
import {
  CREDENTIAL_TO_UPLOAD,
  CredentialSource,
  credentialChoices,
  credentialOffer,
  dedicatedDisciplineOf,
  isDateKey,
  primaryUploadKind,
  toIsoDay,
  uploadKindsFor,
  validLongEnough,
} from './motivation-credentials';
import { OWNED_ROWS } from './motivation-fields';
import { normaliseFirearmType } from './saps-vocabulary';
import { type Endorsement, ENDORSEMENT_LABELS } from '../common/sa-competency';

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

/**
 * credentialOffer with the endorsement argument defaulted.
 *
 * ⚠️ THE DEFAULT IS A REAL ENDORSEMENT, NOT null. `needed: null` means "the
 * application has not said what firearm it is for", and that state now offers
 * NO competency at all — so defaulting to null would silently disable the
 * competency half of every test below and they would still pass. 'handgun'
 * stands for "the applicant has described their firearm"; the fixtures here
 * carry no `covers` line, and an unreadable certificate covers everything (see
 * competencyCovers — unknown is a yes, deliberately), so it changes nothing
 * about the documents these tests are actually about.
 *
 * Tests that are ABOUT the endorsement call credentialOffer directly.
 */
const offerWith = (
  licenceType: MotivationLicenceType,
  credentials: CredentialSource[],
  answered: Record<string, string>,
  needed: Endorsement | null = 'handgun',
) => credentialOffer(licenceType, credentials, answered, needed);

describe('what the Licence Centre offers a motivation', () => {
  it('picks the longest-running certificate when several are held', () => {
    // Operator, 2026-08-28, asked which of several competency certificates
    // should win: "longest-running expiry wins."
    //
    // ⚠️ THE SHORTER ONE IS DELIBERATELY FIRST IN THE ARRAY. offer() is
    // first-wins, so before the sort this test would have returned COMP-SHORT
    // — and nothing on screen would have looked wrong, because both
    // certificates are the member's own and both numbers are real.
    const o = offerWith(
      TYPE,
      [
        competency({
          id: 'short',
          expiresOn: '2027-01-01',
          details: { competency_number: 'COMP-SHORT' },
        }),
        competency({
          id: 'long',
          expiresOn: '2033-01-01',
          details: { competency_number: 'COMP-LONG' },
        }),
      ],
      {},
    );
    expect(o.values.competency_number).toBe('COMP-LONG');
  });

  it('prefers a dated certificate over one whose expiry could not be read', () => {
    // A blank date is not evidence of a long life. Sorting null first would
    // let the least-known document beat a dated one.
    const o = offerWith(
      TYPE,
      [
        competency({
          id: 'undated',
          expiresOn: null,
          details: { competency_number: 'COMP-UNDATED' },
        }),
        competency({
          id: 'dated',
          expiresOn: '2028-01-01',
          details: { competency_number: 'COMP-DATED' },
        }),
      ],
      {},
    );
    expect(o.values.competency_number).toBe('COMP-DATED');
  });

  it('fills the competency number off the certificate', () => {
    const o = offerWith(TYPE, [competency()], {});
    expect(o.values.competency_number).toBe('COMP-999');
    expect(o.items[0].from).toBe('My competency');
  });

  it('fills a firearm into the first row, normalising the type', () => {
    const o = offerWith(TYPE, [licence()], {});
    expect(o.values.existing_firearm_1_make).toBe('Tikka');
    expect(o.values.existing_firearm_1_calibre).toBe('.308 Win');
    // ⚠️ ONE SERIAL. The two boxes were collapsed on 2026-09-07: a licence
    // card prints the same number against the barrel, the receiver and the
    // frame, so two boxes asked two questions with one answer. The barrel is
    // the number the card prints first, so it is the one taken.
    expect(o.values.existing_firearm_1_serial).toBe('B67890');
    expect(o.values.existing_firearm_1_frame_serial).toBeUndefined();
    expect(o.values.existing_firearm_1_barrel_serial).toBeUndefined();
    expect(o.values.existing_firearm_1_licence_no).toBe('LIC-001');
    // "Bolt Action Rifle" is not one of the form's four words.
    expect(o.values.existing_firearm_1_type).toBe('Rifle');
  });

  it('⚠️ THE MARLIN: BARREL NONE, FRAME NONE, RECEIVER MR90189D', () => {
    // Operator, 2026-09-09: "the Marlin has NONE for the barrel but does have
    // a serial for the reciever, make sure its there. Its missing inside the
    // 271."
    //
    // The SAPS 271's item 2.1 has no receiver column, so a receiver serial
    // rides in the frame box. The choice between them was `||`, which tests
    // for EMPTINESS — and a card reading "FRAME: NONE" makes that the truthy
    // string "NONE", so the receiver serial was never reached. The row stored
    // NONE, ownedFirearmSerial read it through answerValue which strips the
    // placeholder, and the firearm printed on the form with its serial boxes
    // BLANK.
    const marlin = licence({
      id: 'c-marlin',
      details: {
        make: 'Marlin',
        model: '1895',
        calibre: '.45-70 Government',
        barrel_serial: 'NONE',
        frame_serial: 'NONE',
        receiver_serial: 'MR90189D',
        licence_number: 'LIC-045',
        firearm_type: 'Lever Action Rifle',
      },
    });
    const o = offerWith(TYPE, [marlin], {});
    expect(o.values.existing_firearm_1_serial).toBe('MR90189D');
    // The row therefore HAS a serial, which is what item 2.1 prints.
    // ownedFirearmSerial reads `_serial` first; motivation-fields.spec.ts
    // covers that reader on its own.
  });

  it('⚠️ KEEPS THE CARD’S "NONE" WHERE IT IS THE WHOLE TRUTH', () => {
    // Only which row WINS changed. A card with nothing on either row still
    // stores the card's own word — the printed seller-consent declaration
    // reproduces what the card says, NONE included.
    const noSerials = licence({
      id: 'c-none',
      details: {
        make: 'Musgrave',
        calibre: '.30-06',
        barrel_serial: 'NONE',
        frame_serial: 'NONE',
        receiver_serial: 'NONE',
        licence_number: 'LIC-046',
        firearm_type: 'Bolt Action Rifle',
      },
    });
    const o = offerWith(TYPE, [noSerials], {});
    expect(o.values.existing_firearm_1_serial).toBeFalsy();
  });

  it('still prefers the frame row when it carries a real number', () => {
    const both = licence({
      id: 'c-both',
      details: {
        make: 'CZ',
        calibre: '9mm',
        barrel_serial: 'NONE',
        frame_serial: 'F12345',
        receiver_serial: 'R99999',
        licence_number: 'LIC-047',
        firearm_type: 'Pistol',
      },
    });
    const o = offerWith(TYPE, [both], {});
    expect(o.values.existing_firearm_1_serial).toBe('F12345');
  });

  it('lists the four things the operator asked for, per firearm', () => {
    // Operator, 2026-09-07: "when listing the fire arms I already own it
    // should only be the make, model, serial number and expiry date listed,
    // nothing else."
    //
    // ⚠️ THE EXPIRY IS THE VAULT'S COLUMN, and it is a date — so it comes
    // through the settled gate like every other date. The fixture is
    // confirmed, so it carries.
    const o = offerWith(
      TYPE,
      [licence({ details: { ...licence().details, model: 'T3x' } })],
      {},
    );
    expect(o.values.existing_firearm_1_make).toBe('Tikka');
    expect(o.values.existing_firearm_1_model).toBe('T3x');
    expect(o.values.existing_firearm_1_serial).toBe('B67890');
    expect(o.values.existing_firearm_1_expiry).toBe('2030-01-01');
  });

  it('⚠️ never offers a card placeholder as a serial, a model or a make', () => {
    // A licence prints NONE in a row that does not apply — the operator's own
    // Glock card reads "Model NONE". Seen live on 2026-09-07 as "Firearm 6 —
    // frame serial NONE · barrel serial NONE", offered, accepted and written
    // into a form somebody signs. The fallback chain must SKIP it rather than
    // stop on it, or the frame serial that does exist is never consulted.
    const o = offerWith(
      TYPE,
      [
        licence({
          details: {
            make: 'Glock',
            model: 'NONE',
            calibre: '9mm',
            barrel_serial: 'N/A',
            frame_serial: 'ZABA01892',
            licence_number: 'LIC-009',
            firearm_type: 'Semi-Auto Pistol',
          },
        }),
      ],
      {},
    );
    expect(o.values.existing_firearm_1_model).toBeUndefined();
    expect(o.values.existing_firearm_1_serial).toBe('ZABA01892');
    expect(Object.values(o.values)).not.toContain('NONE');
    expect(Object.values(o.values)).not.toContain('N/A');
  });

  it('NEVER overwrites something the applicant typed', () => {
    const answered = {
      competency_number: 'WHAT-I-TYPED',
      existing_firearm_1_make: 'Sako',
    };
    const o = offerWith(TYPE, [competency(), licence()], answered);
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
      const o = offerWith(TYPE, [licence()], {
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
    const o = offerWith(TYPE, two, {});
    expect(o.values.existing_firearm_1_make).toBe('Tikka');
    expect(o.values.existing_firearm_2_make).toBe('Glock');
    expect(o.values.existing_firearm_2_type).toBe('Handgun');
    // No serial may ever appear against two different firearms.
    expect(o.values.existing_firearm_2_serial).toBe('G1');
    expect(o.values.existing_firearm_1_serial).toBe('B67890');
  });

  it('says which documents it could take nothing from, and why', () => {
    const blank = licence({ id: 'z', title: 'A blurry photo', details: {} });
    const o = offerWith(TYPE, [blank], {});
    expect(o.values.existing_firearm_1_make).toBeUndefined();
    expect(o.skipped).toHaveLength(1);
    expect(o.skipped[0].title).toBe('A blurry photo');
    expect(o.skipped[0].why).toMatch(/make, calibre or serial/);
  });

  it('⚠️ LISTS EVERY FIREARM THE MEMBER OWNS, not the first six', () => {
    // Operator, 2026-09-07: "all fire arms the applicant owns must be in that
    // list." The registry carried six rows and the loop stopped there, so a
    // member with more got a row on the form for six of their firearms and,
    // for each of the rest, one copy of "the form has room for 6 firearms and
    // they are all filled". Item 2.1 of the blank SAPS 271 is FOURTEEN rows.
    expect(OWNED_ROWS).toBe(14);
    const many = Array.from({ length: OWNED_ROWS }, (_, i) =>
      licence({
        id: `c${i}`,
        title: `Gun ${i + 1}`,
        details: { make: `Make${i}`, licence_number: `L${i}` },
      }),
    );
    const o = offerWith(TYPE, many, {});
    expect(o.values.existing_firearm_7_make).toBe('Make6');
    expect(o.values[`existing_firearm_${OWNED_ROWS}_make`]).toBe(
      `Make${OWNED_ROWS - 1}`,
    );
    expect(o.skipped).toEqual([]);
  });

  it('names the leftovers ONCE, not once per licence', () => {
    // ⚠️ THE RUN-ON LINE. Four extra licences used to produce four copies of
    // the same sentence, rendered end to end, naming none of the firearms it
    // was talking about.
    const tooMany = Array.from({ length: OWNED_ROWS + 3 }, (_, i) =>
      licence({
        id: `c${i}`,
        title: `Gun ${i + 1}`,
        details: { make: `Make${i}`, licence_number: `L${i}` },
      }),
    );
    const o = offerWith(TYPE, tooMany, {});
    const full = o.skipped.filter((s) => /room for/.test(s.why));
    expect(full).toHaveLength(1);
    expect(full[0].title).toBe('Gun 15, Gun 16, Gun 17');
    expect(full[0].why).toContain(`room for ${OWNED_ROWS}`);
  });

  it('never offers a key the licence type does not have', () => {
    // S13 has no dedicated-status fields. Offering association_name there
    // would write an answer the form cannot show and nobody can correct.
    const o = offerWith(
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
    const o = offerWith(
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
    const o = offerWith(
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
    const o = offerWith(TYPE, [], {});
    expect(o.empty).toBe(true);
    expect(o.items).toHaveLength(0);
  });

  it('ignores blank and whitespace-only readings', () => {
    const o = offerWith(
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

describe('the confirmed contract, enforced PER VALUE', () => {
  // ⚠️ THIS CONTRACT CHANGED ON 2026-08-28, AND THE OLD ONE HAD A COST.
  // It read "NEVER OFFERS A VALUE OFF AN UNCONFIRMED DOCUMENT", enforced by a
  // blanket filter. Operator: "what you own still is empty on the step 3 and
  // there are a bunch of firearm licenses that is in the vault." The vault
  // held five FIREARM_LICENCE rows and ZERO confirmed ones — phone uploads
  // arrive unconfirmed and the confirm prompt only ever ran on the desktop
  // path — so the blanket filter emptied "What you own" for everybody.
  //
  // The gate is now per VALUE, on the rule this module already stated
  // elsewhere: "THE CONFIRMATION GATE PROTECTS DATES, NOT NUMBERS." An
  // unconfirmed document supplies facts and not dates.
  it('fills a make and a serial off an unconfirmed licence', () => {
    const offer = offerWith(
      'S16_DEDICATED_SPORT',
      [
        {
          id: 'a',
          kind: 'FIREARM_LICENCE',
          title: 'Fresh off the phone',
          expiresOn: null,
          confirmed: false,
          details: {
            make: 'CZ',
            calibre: '.308',
            frame_serial: 'F-1',
            licence_number: 'L-1',
          },
        },
      ],
      {},
    );
    expect(offer.values.existing_firearm_1_make).toBe('CZ');
    expect(offer.values.existing_firearm_1_calibre).toBe('.308');
    expect(offer.values.existing_firearm_1_serial).toBe('F-1');
  });

  it('fills a competency NUMBER off an unconfirmed certificate', () => {
    const offer = offerWith(
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
    expect(offer.values.competency_number).toBe('C-999');
  });

  it('⚠️ STILL REFUSES A DATE OFF AN UNCONFIRMED DOCUMENT', () => {
    // The half of the old contract that must never be relaxed. A date nobody
    // has checked is the one thing the confirmation gate exists for.
    const offer = offerWith(
      'S16_DEDICATED_SPORT',
      [
        {
          id: 'a',
          kind: 'DEDICATED_DISCIPLINE',
          title: 'Fresh off the phone',
          expiresOn: null,
          confirmed: false,
          details: { association: 'SA Hunters', joined_on: '2019-04-01' },
        },
      ],
      {},
    );
    // The association NAME carries — it is a fact.
    expect(Object.values(offer.values)).toContain('SA Hunters');
    // The joining DATE does not.
    expect(Object.values(offer.values)).not.toContain('2019-04-01');
  });

  it('a confirmed document may supply dates as before', () => {
    const offer = offerWith(
      'S16_DEDICATED_SPORT',
      [
        {
          id: 'a',
          kind: 'DEDICATED_DISCIPLINE',
          title: 'Checked by the member',
          expiresOn: null,
          confirmed: true,
          details: { association: 'SA Hunters', joined_on: '2019-04-01' },
        },
      ],
      {},
    );
    expect(Object.values(offer.values)).toContain('2019-04-01');
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
    const o = offerWith(TYPE2, [licence()], rowOne);
    const proposed = Object.keys(o.values).filter((k) =>
      k.startsWith('existing_firearm_'),
    );
    expect(proposed).toEqual([]);
  });

  it('matches on the licence number even if the serials were retyped', () => {
    const o = offerWith(TYPE2, [licence()], {
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
    const o = offerWith(TYPE2, [other], rowOne);
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
    const o = offerWith(TYPE2, [noFrame('c3', 'LIC-003', 'B333')], {
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
    const o = offerWith(
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
    const o = offerWith(T, [body('c1', 'NHSA', '111')], {});
    expect(o.values.association_number).toBe('111');
  });

  it('two documents from one body are ONE membership', () => {
    const o = offerWith(
      T,
      [body('c1', 'SA Hunters', '108828'), body('c2', 'sa hunters', '108828')],
      {},
    );
    expect(o.values.association_name).toBe('SA Hunters');
    expect(o.values.association_2_name).toBeUndefined();
  });

  it('skips a body the applicant already listed by hand', () => {
    const o = offerWith(T, [body('c1', 'NHSA', '111')], {
      association_name: 'NHSA',
    });
    expect(o.values.association_2_name).toBeUndefined();
  });

  it('reports a fourth association as out of room, not silently', () => {
    const o = offerWith(
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

  it('⚠️ a document with no readable association fills NO slot', () => {
    // It would offer a membership number with nothing to attribute it to —
    // an unattributed number on a signed form — and burn a slot doing it.
    const nameless = body('c9', '', '999');
    delete (nameless.details as Record<string, string>).association;
    const o = offerWith('S16_DEDICATED_SPORT' as never, [nameless], {});
    expect(
      Object.keys(o.values).filter((k) => k.startsWith('association')),
    ).toEqual([]);
    expect(o.skipped.some((s) => /which association/.test(s.why))).toBe(true);
  });
});


// -----------------------------------------------------------------
// A DEDICATED HUNTER'S PAPERS ARE NOT EVIDENCE OF A DEDICATED SPORT SHOOTER.
//
// The offer loop tested `DEDICATED_KINDS.has(c.kind)` and nothing else, and
// all three association kinds are in that set. So a member holding SAHGCA
// dedicated-HUNTER papers who applied under S16_DEDICATED_SPORT had
// association_name filled from them, under a label reading "Your
// sport-shooting association", and reached a signed SAPS 271 claiming sport
// status on hunting evidence. Section 1 of the Firearms Control Act defines a
// "dedicated sports person" as a member of an accredited SPORTS-SHOOTING
// organisation.
//
// The distinguishing fact was already read and stored and then dropped:
// `status_type` is in WANTED for the kind and rides in the details blob this
// module is handed whole.
// -----------------------------------------------------------------
describe('the discipline the document actually awards', () => {
  const SPORT = 'S16_DEDICATED_SPORT' as never;
  const HUNTER = 'S16_DEDICATED_HUNTER' as never;

  const paper = (
    statusType: string | null,
    over: Partial<CredentialSource> = {},
  ): CredentialSource => ({
    id: 'd1',
    kind: 'DEDICATED_DISCIPLINE',
    title: 'My status certificate',
    expiresOn: '2028-03-01',
    confirmed: true,
    details: {
      association: 'SAHGCA',
      membership_number: '108828',
      ...(statusType === null ? {} : { status_type: statusType }),
    },
    ...over,
  });

  it('⚠️ keeps a dedicated HUNTER document out of a dedicated SPORT application', () => {
    const o = offerWith(SPORT, [paper('dedicated hunter')], {});
    expect(o.values.association_name).toBeUndefined();
    expect(o.values.association_number).toBeUndefined();
    expect(o.items).toHaveLength(0);
    // Refused OUT LOUD. A silent skip leaves the block empty and the prefill
    // looking broken, with nothing the member can act on.
    expect(o.skipped.some((k) => /dedicated HUNTER status/.test(k.why))).toBe(
      true,
    );
  });

  it('⚠️ and the mirror - a SPORT document out of a HUNTER application', () => {
    const o = offerWith(HUNTER, [paper('dedicated sport shooter')], {});
    expect(o.values.association_name).toBeUndefined();
    expect(
      o.skipped.some((k) => /dedicated SPORT SHOOTER status/.test(k.why)),
    ).toBe(true);
  });

  it('takes the document that matches, on either type', () => {
    expect(
      offerWith(SPORT, [paper('dedicated sport shooter')], {}).values
        .association_name,
    ).toBe('SAHGCA');
    expect(
      offerWith(HUNTER, [paper('dedicated hunter')], {}).values
        .association_name,
    ).toBe('SAHGCA');
  });

  it('⚠️ AN UNKNOWN DISCIPLINE PASSES - absence is not evidence of the wrong one', () => {
    // Same rule competencyCovers already follows. The document may not print a
    // discipline, the reader may not have got it, or it may say something we
    // do not recognise; in none of those do we KNOW it is wrong, and refusing
    // an honest applicant's own paper on a fact we do not hold is the worse
    // failure, because they cannot see why.
    for (const t of [SPORT, HUNTER]) {
      expect(offerWith(t, [paper(null)], {}).values.association_name).toBe(
        'SAHGCA',
      );
      expect(
        offerWith(t, [paper('life member, category 2')], {}).values
          .association_name,
      ).toBe('SAHGCA');
    }
  });

  it('"both" passes on either application - one document, two statuses', () => {
    for (const t of [SPORT, HUNTER]) {
      expect(offerWith(t, [paper('both')], {}).values.association_name).toBe(
        'SAHGCA',
      );
      expect(
        offerWith(t, [paper('dedicated sport shooter and dedicated hunter')], {})
          .values.association_name,
      ).toBe('SAHGCA');
    }
  });

  it('⚠️ "professional hunter" is refused on BOTH, and never read as "hunter"', () => {
    // The phrase contains the word "hunter". A substring test would have made
    // a provincial occupational licence into dedicated hunting status - the
    // exact false claim PROFESSIONAL_HUNTER is kept out of DEDICATED_KINDS to
    // prevent.
    for (const t of [SPORT, HUNTER]) {
      const o = offerWith(t, [paper('professional hunter')], {});
      expect(o.values.association_name).toBeUndefined();
      expect(
        o.skipped.some((k) => /professional hunter registration/.test(k.why)),
      ).toBe(true);
    }
  });

  it('reads the discipline off dedicatedDisciplineOf, retired kinds included', () => {
    const of = (statusType: string, kind = 'DEDICATED_DISCIPLINE') =>
      dedicatedDisciplineOf({ kind, details: { status_type: statusType } });
    expect(of('Dedicated Sport Shooter')).toBe('sport');
    expect(of('DEDICATED HUNTER')).toBe('hunter');
    expect(of('Professional Hunter')).toBe('professional');
    expect(of('both')).toBe('both');
    expect(of('')).toBe('unknown');
    expect(of('committee member')).toBe('unknown');
    // A row the 2026-08-20 migration moved carries no status_type of its own;
    // its retired kind is the only record of the discipline it ever had.
    expect(dedicatedDisciplineOf({ kind: 'DEDICATED_HUNTER', details: {} })).toBe(
      'hunter',
    );
    expect(dedicatedDisciplineOf({ kind: 'DEDICATED_STATUS', details: {} })).toBe(
      'sport',
    );
    // ...and a status_type that WAS read always beats it.
    expect(
      dedicatedDisciplineOf({
        kind: 'DEDICATED_HUNTER',
        details: { status_type: 'dedicated sport shooter' },
      }),
    ).toBe('sport');
  });

  it('never refuses on a licence type that has no association block', () => {
    // S13 and S15 have no such fields, so there is nothing to protect - and a
    // skipped line about the wrong discipline would be noise about a form that
    // never asked.
    const o = offerWith(
      'S13_SELF_DEFENCE' as never,
      [paper('dedicated hunter')],
      {},
    );
    expect(o.skipped.some((k) => /dedicated/i.test(k.why))).toBe(false);
  });

  it('⚠️ a wrong-discipline document does not burn the slot the right one needs', () => {
    // If the refusal ran after the slot was claimed, the hunting certificate
    // would take slot 1 and the sports club would be listed as association 2 -
    // demoting the body the whole application rests on.
    const club: CredentialSource = {
      ...paper('dedicated sport shooter'),
      id: 'd2',
      title: 'My SAGA card',
      details: {
        association: 'SAGA',
        membership_number: '55',
        status_type: 'dedicated sport shooter',
      },
    };
    const o = offerWith(SPORT, [paper('dedicated hunter'), club], {});
    expect(o.values.association_name).toBe('SAGA');
    expect(o.values.association_2_name).toBeUndefined();
  });
});

// -----------------------------------------------------------------
// ITEM 60 - THE MEMBERSHIP'S "VALID UNTIL" DATE.
//
// The per-association loop dedupes on the association NAME and the `continue`
// fired BEFORE the expiry offer. Credentials arrive createdAt-ascending with
// no preference for the document that carries a date, so the ordinary case
// broke it: the status certificate is uploaded first, takes slot 0 and prints
// no expiry; the letter of good standing from the same body - the one document
// whose whole purpose is the validity window - hit the dedup and contributed
// nothing, silently. Item 60 went to the DFO blank with the date in the vault.
// -----------------------------------------------------------------
describe('the association expiry comes off the document that carries one', () => {
  const T = 'S16_DEDICATED_SPORT' as never;

  /** The status certificate: no expiry printed on it, and uploaded first. */
  const statusCard = (association = 'SA Hunters'): CredentialSource => ({
    id: 'card',
    kind: 'DEDICATED_DISCIPLINE',
    title: 'My dedicated status certificate',
    expiresOn: null,
    confirmed: true,
    details: {
      association,
      status_number: 'SA115153SS',
      joined_on: '2015-02-01',
    },
  });

  /** The sworn letter: it is the one with the validity window. */
  const letter = (
    association = 'SA Hunters',
    expiresOn = '2027-03-31',
  ): CredentialSource => ({
    id: 'letter',
    kind: 'DEDICATED_DISCIPLINE',
    title: 'My letter of good standing',
    expiresOn,
    confirmed: true,
    details: {
      association,
      good_standing_number: 'GS00124584',
      good_standing: 'yes',
      membership_number: '108828',
    },
  });

  it('⚠️ fills item 60 from the letter though the certificate took the slot', () => {
    const o = offerWith(T, [statusCard(), letter()], {});
    expect(o.values.association_name).toBe('SA Hunters');
    expect(o.values.association_expiry).toBe('2027-03-31');
    // And the member is told which paper the date came from.
    expect(o.items.find((i) => i.key === 'association_expiry')?.from).toBe(
      'My letter of good standing',
    );
  });

  it('still fills it when the letter is the document that took the slot', () => {
    const o = offerWith(T, [letter(), statusCard()], {});
    expect(o.values.association_expiry).toBe('2027-03-31');
  });

  it('⚠️ NEVER borrows another body’s date', () => {
    // Body A's name in item 56 beside body B's date in item 60 is two true
    // facts making one false statement, on a form signed under s120(9)(f).
    const o = offerWith(
      T,
      [statusCard('SA Hunters'), letter('NATSHOOT', '2029-12-31')],
      {},
    );
    expect(o.values.association_name).toBe('SA Hunters');
    expect(o.values.association_expiry).toBeUndefined();
    expect(o.values.association_2_name).toBe('NATSHOOT');
  });

  it('prefers the letter of good standing over another dated paper', () => {
    const other: CredentialSource = {
      ...letter('SA Hunters', '2030-01-01'),
      id: 'other',
      title: 'Some other dated paper',
      details: { association: 'SA Hunters', membership_number: '108828' },
    };
    const o = offerWith(T, [statusCard(), other, letter()], {});
    expect(o.values.association_expiry).toBe('2027-03-31');
  });

  it('takes the longest-running of two letters from the same body', () => {
    const renewed: CredentialSource = {
      ...letter('SA Hunters', '2029-03-31'),
      id: 'renewed',
      title: 'This year’s letter',
    };
    const o = offerWith(T, [letter(), renewed], {});
    expect(o.values.association_expiry).toBe('2029-03-31');
  });

  it('⚠️ offers it even when the applicant typed the association in by hand', () => {
    // Their own answer seeds the dedup set, so under the old code every one of
    // their documents for that body took the `continue` - and the member who
    // had done the most work was the one who could never be given the date.
    const o = offerWith(T, [letter()], { association_name: 'SA Hunters' });
    expect(o.values.association_expiry).toBe('2027-03-31');
  });

  it('offers nothing where no document from that body carries a date', () => {
    const o = offerWith(T, [statusCard()], {});
    expect(o.values.association_expiry).toBeUndefined();
  });

  it('never overwrites a date the applicant typed', () => {
    const o = offerWith(T, [statusCard(), letter()], {
      association_expiry: '2026-12-31',
    });
    expect(o.values.association_expiry).toBeUndefined();
  });

  it('⚠️ names a same-body document that gave nothing, instead of dropping it', () => {
    const spare: CredentialSource = {
      ...statusCard(),
      id: 'spare',
      title: 'An older copy of the same certificate',
    };
    const o = offerWith(T, [statusCard(), spare], {});
    expect(
      o.skipped.some((k) => k.title === 'An older copy of the same certificate'),
    ).toBe(true);
    // But the letter that DID supply the date is not reported as useless.
    const o2 = offerWith(T, [statusCard(), letter()], {});
    expect(
      o2.skipped.some((k) => k.title === 'My letter of good standing'),
    ).toBe(false);
  });
});

// -----------------------------------------------------------------
// A JOIN DATE IS NOT A DEDICATED-SINCE DATE.
//
// The vault's `joined_on` was written into `dedicated_since` - labelled
// "Dedicated status held since" - under an offer line reading "Member since",
// and printed into the 271's "Date joined" box. For a SAHGCA or NARFO member
// they are routinely years apart: you join, and then you qualify. It is also
// what deriveFacts counts `years_dedicated` from, so the motivation itself
// argued from a join date.
// -----------------------------------------------------------------
describe('when they joined, and when they became dedicated', () => {
  const T = 'S16_DEDICATED_SPORT' as never;
  const card: CredentialSource = {
    id: 'j1',
    kind: 'DEDICATED_DISCIPLINE',
    title: 'My association card',
    expiresOn: '2028-01-01',
    confirmed: true,
    details: {
      association: 'NATSHOOT',
      membership_number: '42',
      joined_on: '2015-02-01',
    },
  };

  it('⚠️ puts the vault joined_on in the JOIN box, not in dedicated_since', () => {
    const o = offerWith(T, [card], {});
    expect(o.values.association_joined).toBe('2015-02-01');
    expect(o.values.dedicated_since).toBeUndefined();
  });

  it('leaves dedicated_since for the member - no vault document carries it', () => {
    // It is REQUIRED, so it is still asked. Filling it with a join date was
    // worse than asking: the member signs it and the writer argues from it.
    const o = offerWith(T, [card], {});
    expect(o.items.some((i) => i.key === 'dedicated_since')).toBe(false);
  });

  it('slots two and three keep their own join boxes', () => {
    const second: CredentialSource = {
      ...card,
      id: 'j2',
      title: 'My SAGA card',
      details: {
        association: 'SAGA',
        membership_number: '7',
        joined_on: '2018-06-06',
      },
    };
    const o = offerWith(T, [card, second], {});
    expect(o.values.association_joined).toBe('2015-02-01');
    expect(o.values.association_2_joined).toBe('2018-06-06');
  });

  it('⚠️ a join date is a DATE, so an unsettled document supplies none', () => {
    // isDateKey is suffix-matched and `_joined` was not in the pattern - so
    // association_2_joined and association_3_joined had been slipping past the
    // settled gate since the day they were added, and slot one would have made
    // it three.
    const unsettled = { ...card, confirmed: false };
    const o = offerWith(T, [unsettled], {});
    expect(o.values.association_name).toBe('NATSHOOT');
    expect(o.values.association_joined).toBeUndefined();
    expect(isDateKey('association_joined')).toBe(true);
    expect(isDateKey('association_2_joined')).toBe(true);
  });
});

describe('CREDENTIAL_TO_UPLOAD is exhaustive over the enum', () => {
  // ⚠️ THE COMPILER ENFORCES THIS NOW — the map is typed
  // Record<CredentialKind, MotivationUploadKind[]> rather than
  // Record<string, string[]>. This spec exists to say WHY, because the next
  // person to widen it will hit the type error and want to relax it.
  //
  // Untyped, a missing entry compiled clean and failed silently and totally:
  // primaryUploadKind() returned undefined, buildLibrary dropped the row from
  // the picker, and addFromLibrary refused it with "That document does not
  // answer anything on this application" — a document stored, invisible, and
  // still counting against the member's cap.
  it('names every CredentialKind, including the ones that fill nothing', () => {
    for (const kind of Object.values(CredentialKind)) {
      expect(CREDENTIAL_TO_UPLOAD).toHaveProperty(kind);
    }
  });

  it('treats "fills nothing" as an empty array, never a missing key', () => {
    // An empty array is a legitimate answer: a Professional Hunter
    // registration is kept and chased for expiry and simply has no slot on a
    // motivation. ⚠️ AND IT IS TRUTHY — the callers must test `.length`, which
    // is what uploadKindsFor exists for.
    expect(CREDENTIAL_TO_UPLOAD.PROFESSIONAL_HUNTER).toEqual([]);
    expect(CREDENTIAL_TO_UPLOAD.OTHER).toEqual([]);
    expect(uploadKindsFor('PROFESSIONAL_HUNTER')).toHaveLength(0);
    expect(primaryUploadKind('PROFESSIONAL_HUNTER')).toBeUndefined();
  });

  it('returns nothing for a kind it has never heard of', () => {
    expect(uploadKindsFor('NOT_A_KIND')).toEqual([]);
    expect(primaryUploadKind('NOT_A_KIND')).toBeUndefined();
  });
});


// -------------------------------------------------------------------
// ITEM 60 - THE ASSOCIATION'S "VALID UNTIL" DATE.
//
// Operator, 2026-08-28: "Expiry dat of accredited associasian should also be
// inserted from the letter of good standing date. that should have a valid
// until date."
//
// The vault already read it. DEDICATED_DISCIPLINE is in neither
// NO_EXPIRY_ON_THE_PAGE nor NEVER_EXPIRES, so Credential.expiresOn has held
// the date off the page all along - and nothing carried it to the form, so
// item 60 went to the DFO blank while the answer sat in the applicant's own
// vault.
//
// GOOD_STANDING as a CredentialKind is RETIRED and its rows were migrated to
// DEDICATED_DISCIPLINE, so a set keyed on it would match nothing in the live
// vault. The upload kind GOOD_STANDING_LETTER is a different enum and is
// still current - that is what the field's docSourced points at.
// -------------------------------------------------------------------

const dedicated = (
  over: Partial<CredentialSource> = {},
): CredentialSource => ({
  id: 'g1',
  kind: 'DEDICATED_DISCIPLINE' as CredentialKind,
  title: 'SAHGCA good standing 2026',
  expiresOn: '2027-03-31',
  confirmed: true,
  details: {
    association: 'SAHGCA',
    membership_number: '108828',
    joined_on: '2019-04-01',
  },
  ...over,
});

describe('the association expiry, item 60', () => {
  const expiry = (o: ReturnType<typeof credentialOffer>) =>
    o.items.find((i) => i.key === 'association_expiry');

  it('offers the valid-until date off the letter of good standing', () => {
    const o = offerWith(TYPE, [dedicated()], {});
    expect(o.values.association_expiry).toBe('2027-03-31');
    expect(expiry(o)?.from).toBe('SAHGCA good standing 2026');
  });

  it('takes the date from the SAME document that named the association', () => {
    // ⚠️ THE WHOLE REASON THIS LIVES IN THE PER-ASSOCIATION LOOP. A member
    // holding a document from each of three bodies is the normal case. Taking
    // the longest-running expiry across all of them would print one body's
    // name in item 56 beside another body's date in item 60 - two true facts
    // making one false statement.
    const o = offerWith(
      TYPE,
      [
        dedicated({ id: 'a', details: { association: 'SAHGCA', joined_on: '2019-04-01' }, expiresOn: '2027-03-31' }),
        dedicated({ id: 'b', details: { association: 'NARFO', joined_on: '2020-01-01' }, expiresOn: '2099-01-01' }),
      ],
      {},
    );
    expect(o.values.association_name).toBe('SAHGCA');
    expect(o.values.association_expiry).toBe('2027-03-31');
    expect(expiry(o)?.credentialId).toBe('a');
    // The second body still gets its own slot; it just has no expiry box.
    expect(o.values.association_2_name).toBe('NARFO');
    expect(o.values.association_2_expiry).toBeUndefined();
  });

  it('never offers a date off a document nobody has checked', () => {
    // The per-value confirmed gate. A date that reaches a signed form has to
    // have been read by someone. The association's NAME still comes through.
    const o = offerWith(TYPE, [dedicated({ confirmed: false })], {});
    expect(o.values.association_name).toBe('SAHGCA');
    expect(o.values.association_expiry).toBeUndefined();
  });

  it('offers nothing where the letter carries no validity window', () => {
    const o = offerWith(TYPE, [dedicated({ expiresOn: null })], {});
    expect(o.values.association_expiry).toBeUndefined();
  });

  it('never dates a hand-typed association from another body’s document', () => {
    // ⚠️ THE slot === 0 GUARD, AND IT IS NOT REDUNDANT. The applicant typed
    // SAHGCA into item 56 themselves, so the vault's SAHGCA paper is skipped
    // and the NARFO one takes slot 2. Without the guard NARFO's expiry would
    // land in item 60 — the only expiry box on the form — and date the
    // applicant's SAHGCA membership off another association's letter.
    const o = offerWith(
      TYPE,
      [
        dedicated({
          id: 'b',
          details: { association: 'NARFO', joined_on: '2020-01-01' },
          expiresOn: '2099-01-01',
        }),
      ],
      { association_name: 'SAHGCA' },
    );
    expect(o.values.association_2_name).toBe('NARFO');
    expect(o.values.association_expiry).toBeUndefined();
  });

  it('never overwrites a date the applicant typed themselves', () => {
    const o = offerWith(TYPE, [dedicated()], {
      association_expiry: '2026-12-31',
    });
    expect(o.values.association_expiry).toBeUndefined();
    expect(expiry(o)).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────
// H10 (a) and H12 — the values the vault already held and never carried.
// ────────────────────────────────────────────────────────────────────

describe('what the competency certificate now fills', () => {
  // ⚠️ 'rifle-sl' EVERYWHERE IN THIS BLOCK, BECAUSE THE FIXTURE IS A
  // SELF-LOADING RIFLE CERTIFICATE. Since 2026-09-07 the offer picks the
  // certificate by what the application's firearm needs, so a block about what
  // a certificate FILLS has to ask for the firearm it covers — otherwise it is
  // testing the exclusion rule by accident and would pass while filling
  // nothing.
  const NEEDS: Endorsement = 'rifle-sl';
  const cert = (over: Partial<CredentialSource> = {}): CredentialSource => ({
    id: 'k9',
    kind: 'COMPETENCY_CERTIFICATE',
    title: 'My competency',
    expiresOn: '2030-06-30',
    issuedOn: '2025-06-06',
    confirmed: true,
    dateSettled: true,
    details: { competency_number: 'C-123', covers: 'S/L-RIFLE/CARB/SHOTGUN' },
    ...over,
  });

  it('H10 — carries what the certificate covers, as the box’s own labels', () => {
    // ⚠️ WITHOUT THIS THE ELIGIBILITY BLOCKER COULD NEVER FIRE. The
    // competency-missing-endorsement rule reads `competency_for` and says
    // nothing when it is empty — deliberately — so a member whose handgun-only
    // competency cannot cover the rifle they are applying for got silence from
    // the one check written to catch exactly that.
    const o = offerWith('S16_DEDICATED_HUNTER', [cert()], {}, NEEDS);
    expect(o.values.competency_for).toBeTruthy();
    // ⚠️ AND ONLY VALUES THE CONSTRAINED FIELD ALREADY OFFERS. The validator
    // bins the WHOLE key if any comma part is not a current choice, so a raw
    // copy of a photographed line would silently discard the answer.
    for (const part of o.values.competency_for.split(',')) {
      expect(ENDORSEMENT_LABELS).toContain(part.trim());
    }
  });

  it('H10 — offers nothing at all from a covers line it cannot read', () => {
    // '' is the right answer: the applicant ticks the boxes, which is what they
    // would have done anyway. That is a different outcome from us writing a
    // guess they then sign.
    const o = offerWith(
      'S16_DEDICATED_HUNTER',
      [cert({ details: { competency_number: 'C-1', covers: 'mystery' } })],
      {},
      NEEDS,
    );
    expect(o.values.competency_for).toBeUndefined();
  });

  it('H12 — fills both competency dates from the vault’s own columns', () => {
    // ⚠️ THE EXPIRY IS THE VAULT'S ARITHMETIC AND MUST STAY THAT WAY. A SAPS
    // 524 prints no expiry; it is derived from the licences held in the
    // categories the certificate covers and rolls forward with every renewal.
    // Deriving it a second time here would give the member two different
    // deadlines for one certificate depending on which screen they looked at.
    const o = offerWith('S16_DEDICATED_HUNTER', [cert()], {}, NEEDS);
    expect(o.values.competency_issued).toBe('2025-06-06');
    expect(o.values.competency_expiry).toBe('2030-06-30');
  });

  it('H12 — withholds both dates while nobody stands behind them', () => {
    // Facts may come off an unsettled row; dates may not. The number still
    // carries, which is the per-value gate working as intended.
    const o = offerWith(
      'S16_DEDICATED_HUNTER',
      [cert({ confirmed: false, dateSettled: false })],
      {},
      NEEDS,
    );
    expect(o.values.competency_number).toBe('C-123');
    expect(o.values.competency_issued).toBeUndefined();
    expect(o.values.competency_expiry).toBeUndefined();
  });

  it('⚠️ A DATE THE CENTRE ARMED ITSELF IS SETTLED, THOUGH NOBODY TICKED', () => {
    // The normal state for a phone upload: dateSource set, confirmedAt null,
    // the reminder sweep already texting people about the same value. Reading
    // `confirmed` alone withheld from the form every date the sweep was acting
    // on.
    const o = offerWith(
      'S16_DEDICATED_HUNTER',
      [cert({ confirmed: false, dateSettled: true })],
      {},
      NEEDS,
    );
    expect(o.values.competency_expiry).toBe('2030-06-30');
  });
});

describe('H12 — where they work', () => {
  const letter = (over: Partial<CredentialSource> = {}): CredentialSource => ({
    id: 'e1',
    kind: 'EMPLOYMENT_CONFIRMATION',
    title: 'My employment letter',
    expiresOn: null,
    confirmed: false,
    details: {
      occupation: 'Farm manager',
      employer_name: 'Rietfontein Boerdery',
      employer_address: '12 Kerk Street, Bloemfontein',
      employer_postal_code: '9301',
    },
    ...over,
  });

  it('fills all four boxes the letter answers', () => {
    // Four boxes on the 271, one document that answers all of them, and no
    // branch here at all until now — so a member who had uploaded the letter
    // still typed every one. `occupation` is REQUIRED, which is the part that
    // bites.
    const o = offerWith('S13_SELF_DEFENCE', [letter()], {});
    expect(o.values.occupation).toBe('Farm manager');
    expect(o.values.employer_name).toBe('Rietfontein Boerdery');
    expect(o.values.employer_address).toBe('12 Kerk Street, Bloemfontein');
    expect(o.values.employer_postal_code).toBe('9301');
  });

  it('⚠️ NEVER OVERWRITES WHAT THEY TYPED', () => {
    const o = offerWith('S13_SELF_DEFENCE', [letter()], {
      occupation: 'Self-employed',
    });
    expect(o.values.occupation).toBeUndefined();
  });
});

describe('H12 — the licence being renewed', () => {
  it('fills both required fields when exactly one licence is held', () => {
    // A section 24 started from the Licence Centre arrives with a seed naming
    // the licence; one started BY HAND arrives with nothing, and both of these
    // are REQUIRED fields.
    const o = offerWith('S24_RENEWAL', [licence()], {});
    expect(o.values.existing_licence_number).toBe('LIC-001');
    expect(o.values.licence_expiry).toBe('2030-01-01');
  });

  it('⚠️ REFUSES TO CHOOSE BETWEEN TWO LICENCES', () => {
    // These two fields say WHICH firearm the whole application is about.
    // Picking the wrong one produces a renewal for a gun nobody was renewing.
    const o = offerWith(
      'S24_RENEWAL',
      [licence(), licence({ id: 'c2', details: { licence_number: 'LIC-002' } })],
      {},
    );
    expect(o.values.existing_licence_number).toBeUndefined();
    expect(o.values.licence_expiry).toBeUndefined();
    expect(o.skipped.some((s) => /more than one licence/i.test(s.why))).toBe(
      true,
    );
  });

  it('does not touch those fields on any other licence type', () => {
    const o = offerWith('S13_SELF_DEFENCE', [licence()], {});
    expect(o.values.existing_licence_number).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────
// THE FIREARM CHOOSES THE COMPETENCY.
//
// Operator, 2026-09-07, driving a fresh Section 13 (self-defence, handgun) on
// production: "the wrong competency chosen before it even knows which firearm
// is being applied for". The panel filled the competency number, what it
// covers, and both its dates off a "Semi-auto Rifle + Shotgun" certificate
// while a "Competency - Handgun" sat unused in the same vault — and then
// refused to revise it, because offer() is "theirs wins, always" and a written
// answer is indistinguishable from a typed one.
// ────────────────────────────────────────────────────────────────────
describe('which competency certificate gets offered', () => {
  const T = 'S13_SELF_DEFENCE' as MotivationLicenceType;
  const cert = (
    id: string,
    covers: string,
    expiresOn: string | null,
  ): CredentialSource => ({
    id,
    kind: 'COMPETENCY_CERTIFICATE',
    title: `Competency ${id}`,
    expiresOn,
    confirmed: true,
    details: { competency_number: `C-${id}`, covers },
  });

  it('⚠️ takes the one that COVERS the firearm, not the one that runs longest', () => {
    // The operator's own vault, in miniature: the rifle certificate runs six
    // years longer, and it is the wrong document for a handgun application.
    const o = credentialOffer(
      T,
      [
        cert('rifle', 'S/L-RIFLE/CARB/SHOTGUN', '2033-01-01'),
        cert('handgun', 'HANDGUN', '2027-01-01'),
      ],
      {},
      'handgun',
    );
    expect(o.values.competency_number).toBe('C-handgun');
  });

  it('says why the other one was left alone', () => {
    const o = credentialOffer(
      T,
      [
        cert('rifle', 'S/L-RIFLE/CARB/SHOTGUN', '2033-01-01'),
        cert('handgun', 'HANDGUN', '2027-01-01'),
      ],
      {},
      'handgun',
    );
    expect(
      o.skipped.some(
        (s) => s.title === 'Competency rifle' && /does not cover/.test(s.why),
      ),
    ).toBe(true);
  });

  it('⚠️ OFFERS NOTHING AT ALL while the firearm is unknown', () => {
    // create() builds the answer rows before firearm_type can exist. Guessing
    // there is what put the wrong certificate on a form somebody signs, and
    // offer() will not revise it afterwards. The auto-attach path refuses to
    // guess in the identical situation.
    const o = credentialOffer(
      T,
      [cert('handgun', 'HANDGUN', '2027-01-01')],
      {},
      null,
    );
    expect(o.values.competency_number).toBeUndefined();
    expect(o.values.competency_for).toBeUndefined();
    expect(o.values.competency_expiry).toBeUndefined();
  });

  it('does not go quiet about it — it says the firearm is what it is waiting for', () => {
    // An empty competency section with no explanation reads as a broken
    // prefill. ONE line for the whole block, however many certificates.
    const o = credentialOffer(
      T,
      [
        cert('a', 'HANDGUN', '2027-01-01'),
        cert('b', 'S/L-RIFLE/CARB/SHOTGUN', '2033-01-01'),
      ],
      {},
      null,
    );
    const waiting = o.skipped.filter((s) => /which firearm/.test(s.why));
    expect(waiting).toHaveLength(1);
    expect(waiting[0].title).toBe('Competency a, Competency b');
  });

  it('⚠️ KEEPS A CERTIFICATE WHOSE COVERS LINE COULD NOT BE READ', () => {
    // Unknown is a yes, deliberately — the same rule competencyCovers states
    // for auto-link. An unreadable line is not evidence of the wrong firearm,
    // and withholding a member's own document on a fact we do not hold is the
    // opposite failure.
    const o = credentialOffer(
      T,
      [cert('mystery', 'something nobody can parse', '2030-01-01')],
      {},
      'handgun',
    );
    expect(o.values.competency_number).toBe('C-mystery');
  });

  it('prefers a certificate we KNOW covers it over an unreadable longer one', () => {
    // Both are permitted candidates. Only one of them is known to be right,
    // and "longest expiry wins" is the tie-break, not the rule.
    const o = credentialOffer(
      T,
      [
        cert('mystery', 'unreadable smudge', '2099-01-01'),
        cert('handgun', 'HANDGUN', '2027-01-01'),
      ],
      {},
      'handgun',
    );
    expect(o.values.competency_number).toBe('C-handgun');
  });

  it('still breaks a tie on the longest expiry, among the ones that cover', () => {
    // Operator, 2026-08-28: "longest-running expiry wins." Unchanged — it just
    // runs second now.
    const o = credentialOffer(
      T,
      [
        cert('short', 'HANDGUN', '2027-01-01'),
        cert('long', 'HANDGUN', '2033-01-01'),
      ],
      {},
      'handgun',
    );
    expect(o.values.competency_number).toBe('C-long');
  });

  it('offers no competency at all when none of them covers the firearm', () => {
    // A blank the applicant fills in is recoverable. A competency number for
    // the wrong firearm type on a signed application is refused before it is
    // considered — and it is the pack we assembled that says so.
    const o = credentialOffer(
      T,
      [cert('rifle', 'S/L-RIFLE/CARB/SHOTGUN', '2033-01-01')],
      {},
      'handgun',
    );
    expect(o.values.competency_number).toBeUndefined();
    expect(o.skipped.some((s) => /does not cover/.test(s.why))).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────
  // THE COMBINATION GUN — one of the four choices on a REQUIRED field, and a
  // permanent refusal until now.
  //
  // `needed` is `Endorsement | null`, so it cannot say "two". A combination
  // gun has a rifled barrel AND a smooth bore, so requiredEndorsement
  // correctly declines to name one endorsement — and says so by returning
  // null, which ALSO means "they have not told us which firearm yet". The
  // member was therefore told, for the life of the application, "we will fill
  // your competency in as soon as you have said which firearm this application
  // is for". They had said. And the competency number we were already holding
  // was withheld behind a sentence that was false.
  // ────────────────────────────────────────────────────────────────
  const combination = {
    firearm_type: 'Combination',
    firearm_action: 'Manually operated',
  };

  it('⚠️ FILLS A COMBINATION GUN from a certificate covering BOTH halves', () => {
    const o = credentialOffer(
      T,
      [cert('both', 'MANUALLY OPERATED RIFLE/CARBINE, SHOTGUN', '2033-01-01')],
      combination,
      // Null, exactly as requiredEndorsement returns for this firearm.
      null,
    );
    expect(o.values.competency_number).toBe('C-both');
    expect(o.skipped.some((s) => /which firearm/.test(s.why))).toBe(false);
  });

  it('⚠️ refuses a certificate covering only HALF of it, and says which half', () => {
    // "It does not cover the firearm this application is for" would leave
    // somebody holding a perfectly good shotgun competency wondering what was
    // wrong with it.
    const o = credentialOffer(
      T,
      [cert('shotgun-only', 'SHOTGUN', '2033-01-01')],
      combination,
      null,
    );
    expect(o.values.competency_number).toBeUndefined();
    expect(
      o.skipped.some((s) =>
        /only part of what a combination firearm needs/.test(s.why),
      ),
    ).toBe(true);
  });

  it('still says nothing has been chosen while the firearm really IS unknown', () => {
    // The half of null that was always true, and must stay: create() builds
    // the rows before any firearm answer exists.
    const o = credentialOffer(
      T,
      [cert('a', 'HANDGUN', '2027-01-01')],
      { firearm_type: 'Combination' }, // no action yet
      null,
    );
    expect(o.values.competency_number).toBeUndefined();
    expect(o.skipped.some((s) => /which firearm/.test(s.why))).toBe(true);
  });

  it('⚠️ does not tell a member to answer a question they have answered', () => {
    // Registry drift — a firearm_type value this build cannot map. Ours, not
    // theirs. Admitting we are stuck beats asking them to do something they
    // have done.
    const o = credentialOffer(
      T,
      [cert('a', 'HANDGUN', '2027-01-01')],
      { firearm_type: 'Blunderbuss', firearm_action: 'Manually operated' },
      null,
    );
    expect(
      o.skipped.some((s) => /which firearm this application is for/.test(s.why)),
    ).toBe(false);
    expect(
      o.skipped.some((s) => /could not work out which competency/.test(s.why)),
    ).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────
  // ONE CERTIFICATE, OR NONE OF THEM.
  //
  // The loop used to run every covering certificate and lean on offer()'s
  // first-wins-per-key rule. Fine while one document answers everything, and
  // silently wrong the moment it does not: A supplies the NUMBER, A's dates are
  // held back or were never read, and B — a different piece of paper, possibly
  // an expired one — supplies the two dates. The applicant then signs a SAPS
  // 271 naming one certificate beside another certificate's dates. Every value
  // is true of some document; the statement the form makes is false. The
  // association block guards exactly this and names it: "two true facts making
  // one false statement".
  // ────────────────────────────────────────────────────────────────
  describe('the number and the dates come off the SAME certificate', () => {
    const dated = (
      id: string,
      covers: string,
      over: Partial<CredentialSource> = {},
    ): CredentialSource => ({
      id,
      kind: 'COMPETENCY_CERTIFICATE',
      title: `Competency ${id}`,
      expiresOn: null,
      confirmed: true,
      details: { competency_number: `C-${id}`, covers },
      ...over,
    });

    it('⚠️ NEVER TAKES A SECOND CERTIFICATE’S DATES', () => {
      const o = credentialOffer(
        T,
        [
          // Chosen: it covers, and it runs longest. Its issue date was never
          // read.
          dated('chosen', 'HANDGUN', {
            expiresOn: '2033-01-01',
            issuedOn: null,
          }),
          // Also covers, and DOES carry dates. Under first-wins-per-key these
          // used to fill the two date boxes beside the other one's number.
          dated('other', 'HANDGUN', {
            expiresOn: '2028-01-01',
            issuedOn: '2023-02-02',
          }),
        ],
        {},
        'handgun',
      );
      expect(o.values.competency_number).toBe('C-chosen');
      expect(o.values.competency_expiry).toBe('2033-01-01');
      // The one that matters: not '2023-02-02' off the other certificate.
      expect(o.values.competency_issued).toBeUndefined();
      expect(o.items.every((i) => i.credentialId !== 'other')).toBe(true);
    });

    it('says what happened to the one it did not use', () => {
      const o = credentialOffer(
        T,
        [
          dated('chosen', 'HANDGUN', { expiresOn: '2033-01-01' }),
          dated('other', 'HANDGUN', { expiresOn: '2028-01-01' }),
        ],
        {},
        'handgun',
      );
      const note = o.skipped.find((s) => s.title === 'Competency other');
      expect(note?.why).toContain('Competency chosen');
      expect(note?.why).toContain('same certificate');
    });

    it('falls to the next one when the first carries no readable number', () => {
      // "The certificate" is the best-ranked one that actually yields a
      // number — not the best-ranked one full stop.
      const o = credentialOffer(
        T,
        [
          {
            ...dated('blank', 'HANDGUN', { expiresOn: '2033-01-01' }),
            details: { covers: 'HANDGUN' },
          },
          dated('good', 'HANDGUN', {
            expiresOn: '2028-01-01',
            issuedOn: '2023-02-02',
          }),
        ],
        {},
        'handgun',
      );
      expect(o.values.competency_number).toBe('C-good');
      expect(o.values.competency_issued).toBe('2023-02-02');
      expect(o.values.competency_expiry).toBe('2028-01-01');
      expect(
        o.skipped.some((s) => /could not read a certificate number/.test(s.why)),
      ).toBe(true);
    });
  });
});

// ────────────────────────────────────────────────────────────────────
// THE MARLIN.
//
// Operator, 2026-09-07: "the marlin should also be already added, it shouldnt
// be like it is now." The panel offered to add MARLIN .45-70 GOVERNMENT as
// Firearm 6 while the Marlin was already listed at position 2, and reported
// three other already-listed firearms as not fitting the form.
//
// One ordering bug did both: the already-on-form test ran AFTER the row cap,
// so a firearm that was already listed was first counted against the rows and
// then, if the rows had run out, named as a leftover.
// ────────────────────────────────────────────────────────────────────
describe('a firearm already on the form is invisible to the loop', () => {
  const T = 'S16_DEDICATED_SPORT' as MotivationLicenceType;

  /** A card that prints NONE for both serials — the Marlin's shape. */
  const marlin = (id = 'm1'): CredentialSource => ({
    id,
    kind: 'FIREARM_LICENCE',
    title: 'MARLIN .45-70 GOVERNMENT',
    expiresOn: '2031-05-05',
    confirmed: true,
    details: {
      make: 'MARLIN',
      calibre: '.45-70 GOVERNMENT',
      frame_serial: 'NONE',
      barrel_serial: 'NONE',
      firearm_type: 'Rifle',
    },
  });

  it('⚠️ is not offered again when the row carries no serial and no licence number', () => {
    // Nothing identifies it but its make and calibre, because the card says
    // NONE to everything else. Without the last-resort match it is offered
    // for ever, and a signed form claims two Marlins.
    const o = credentialOffer(
      T,
      [marlin()],
      {
        existing_firearm_2_make: 'Marlin',
        existing_firearm_2_calibre: '.45-70 Government',
      },
      null,
    );
    expect(
      Object.keys(o.values).filter((k) => k.startsWith('existing_firearm_')),
    ).toEqual([]);
  });

  it('⚠️ IS NOT COUNTED AS A LEFTOVER EITHER, when the form is full', () => {
    // The half the old ordering got wrong. Every row taken, and the one
    // licence we are considering is already in one of them: nothing to offer,
    // and above all NOT reported as a firearm that did not fit.
    const full: Record<string, string> = {
      existing_firearm_2_make: 'Marlin',
      existing_firearm_2_calibre: '.45-70 Government',
    };
    for (let n = 1; n <= OWNED_ROWS; n++) full[`existing_firearm_${n}_make`] ??= `Gun ${n}`;
    const o = credentialOffer(T, [marlin()], full, null);
    expect(o.values).toEqual({});
    expect(o.skipped.map((s) => s.why)).not.toContain(
      `the form has room for ${OWNED_ROWS} firearms and they are all filled`,
    );
  });

  it('⚠️ SAYS SO WHEN THE MATCH IS ONLY A GUESS', () => {
    // ⚠️ THE COMMENT ON alreadyOnForm HAS ALWAYS CLAIMED THIS AND THE CODE HAS
    // NEVER DONE IT: "The cost is a member who owns two identical firearms ...
    // they are told one is already listed and add the second by hand." Nobody
    // was told — the guess used the same silent `continue` as a licence-number
    // match. So a member who genuinely owns two Marlins, both printing NONE for
    // their serials and neither carrying a readable licence number, lost the
    // second one off a signed declaration with no trace on any screen.
    //
    // A serial or licence-number match is a FACT and still says nothing. This
    // one is an inference about two rows with no numbers on either of them, and
    // an inference the member cannot see is the one they cannot correct.
    const o = credentialOffer(
      T,
      [marlin()],
      {
        existing_firearm_2_make: 'Marlin',
        existing_firearm_2_calibre: '.45-70 Government',
      },
      null,
    );
    expect(o.values).toEqual({});
    expect(o.skipped).toHaveLength(1);
    expect(o.skipped[0].why).toContain('already listed as Firearm 2');
    expect(o.skipped[0].why).toContain('add the second one by hand');
  });

  it('⚠️ and says NOTHING when the serial settles it', () => {
    // The other side of the same rule. Nothing is missing, the firearm is on
    // the form, and a note about it would be noise on every load.
    const o = credentialOffer(
      T,
      [licence()],
      { existing_firearm_1_serial: 'B67890' },
      null,
    );
    expect(
      Object.keys(o.values).filter((k) => k.startsWith('existing_firearm_')),
    ).toEqual([]);
    expect(o.skipped).toEqual([]);
  });

  it('matches a draft written before the two serial boxes were collapsed', () => {
    // ⚠️ THE MIGRATION CASE. A row saved yesterday holds _barrel_serial and no
    // _serial. Reading only the new key would call it a different firearm and
    // list it twice.
    const o = credentialOffer(
      T,
      [licence()],
      { existing_firearm_1_barrel_serial: 'B67890' },
      null,
    );
    expect(
      Object.keys(o.values).filter((k) => k.startsWith('existing_firearm_')),
    ).toEqual([]);
  });

  it('⚠️ ONE CARD PHOTOGRAPHED TWICE IS ONE FIREARM', () => {
    // The rows this run has just filled are not in `answered` — nothing is
    // saved yet — so the only test there was called row 1 free again and the
    // offer proposed the same Marlin as Firearm 1 AND Firearm 2, before the
    // applicant had touched anything.
    const o = credentialOffer(T, [marlin('m1'), marlin('m2')], {}, null);
    expect(o.values.existing_firearm_1_make).toBe('MARLIN');
    expect(o.values.existing_firearm_2_make).toBeUndefined();
  });

  it('STILL offers a second firearm that only looks similar', () => {
    // The guard must not swallow a real second rifle. This row has a serial of
    // its own, so make-and-calibre is never consulted.
    const o = credentialOffer(
      T,
      [marlin()],
      {
        existing_firearm_1_make: 'Marlin',
        existing_firearm_1_calibre: '.45-70 Government',
        existing_firearm_1_serial: 'MR-000123',
      },
      null,
    );
    expect(o.values.existing_firearm_2_make).toBe('MARLIN');
  });
});
