import { MotivationLicenceType } from '@prisma/client';
import { buildSaps271 } from './saps271-map';
import { SOURCE_PRIVATE } from './motivation-fields';
import { SAPS271_COORDS } from './saps271-coords';

// ────────────────────────────────────────────────────────────────────
// SECTION F — THE CURRENT OWNER'S HALF.
//
// It had zero mapped boxes until now, which meant we could collect every
// answer from a seller and still have nowhere on the form to print it. It is
// also the part an applicant most often gets sent back for.
//
// Two disciplines run through these tests:
//
//   NOTHING IS GUESSED. The form asks for a surname and initials separately;
//   we hold one full name. There is no rule that splits "van der Merwe"
//   correctly, and a wrong surname on a declaration signed under section
//   120(9)(f) of the Firearms Control Act is not a cosmetic error.
//
//   NOTHING IS BORROWED. Section F is HIS. Not one box in it may ever be
//   defaulted from the applicant's own details — they are two different people
//   and the form exists to tell them apart.
// ────────────────────────────────────────────────────────────────────

const S16 = MotivationLicenceType.S16_DEDICATED_SPORT;
/**
 * ⚠️ THE ROUTE IS STATED, NEVER IMPLIED.
 *
 * Every test in this file except the item 1.2 block is about the PRIVATE sale,
 * so it says so. The map infers nothing from merely holding a seller —
 * operator, 2026-08-28: "the tich should be either dealer or private. not
 * default to fucking private. We have a option to select where this firearm is
 * coming from" — and a helper that quietly supplied the answer would hide the
 * one behaviour these tests exist to pin.
 *
 * The item 1.2 tests below call buildSaps271 directly for that reason.
 */
const build = (over: Parameters<typeof buildSaps271>[0]) =>
  buildSaps271({
    ...over,
    answers: { firearm_source: SOURCE_PRIVATE, ...(over.answers ?? {}) },
  });

const SELLER = {
  fullName: 'Petrus Johannes Malan',
  idNumber: '7204125008087',
};

describe('section F', () => {
  it('writes no owner DETAILS before the seller has given any', () => {
    // ⚠️ THE TICK AND THE BLOCK ANSWER DIFFERENT QUESTIONS. Item 1.2 asks WHAT
    // KIND of owner this is, and the applicant has answered that the moment
    // they pick "From a private owner" — before anyone has approached the
    // seller. The block below it asks WHO, and that stays blank until he says.
    const out = build({ licenceType: S16, answers: {} });
    expect(Object.keys(out.text).filter((k) => k.startsWith('f_'))).toEqual([]);
    expect(out.ticks.filter((t) => t.startsWith('f_'))).toEqual([
      'f_owner_type_a',
    ]);
  });

  it('writes nothing whatever in section F on an unanswered route', () => {
    // Nobody has said where the firearm is coming from and nobody has been
    // asked. An untouched section F must stay untouched.
    const out = buildSaps271({ licenceType: S16, answers: {} });
    expect(Object.keys(out.text).filter((k) => k.startsWith('f_'))).toEqual([]);
    expect(out.ticks.filter((t) => t.startsWith('f_'))).toEqual([]);
  });

  it('marks the owner as a private person and fills what he gave', () => {
    const out = build({ licenceType: S16, answers: {}, seller: SELLER });

    expect(out.ticks).toContain('f_owner_type_a');
    expect(out.text.f_full_names).toBe('Petrus Johannes Malan');
    expect(out.text.f_id_number).toBe('7204125008087');
    // The declaration block repeats both, and it is the block he signs.
  });

  it('REFUSES to split a full name into a surname', () => {
    // ⚠️ THE ONE THING THIS SECTION MUST NOT DO. Any splitting rule gets
    // "van der Merwe", "du Toit" or a double-barrelled name wrong, and the
    // error lands on a sworn declaration.
    const out = build({ licenceType: S16, answers: {}, seller: SELLER });

    expect(out.text.f_surname).toBeUndefined();
    expect(out.text.f_initials).toBeUndefined();
    expect(out.leftBlank).toContainEqual({
      field: 'f_surname',
      because:
        'the seller gave one full name and we will not guess which part of it is the surname',
    });
  });

  it('uses a surname and initials when he gave them separately', () => {
    const out = build({
      licenceType: S16,
      answers: {},
      seller: { ...SELLER, surname: 'Malan', initials: 'P J' },
    });
    expect(out.text.f_surname).toBe('Malan');
    expect(out.text.f_initials).toBe('P J');
    expect(out.leftBlank.map((b) => b.field)).not.toContain('f_surname');
  });


  it('never prints his signature, and says why', () => {
    // A photograph of a signature is enough for us to fill the form and check
    // the details agree. It is not what a DFO accepts.
    const out = build({ licenceType: S16, answers: {}, seller: SELLER });
    expect(out.leftBlank).toContainEqual({
      field: 'f_signature',
      because: 'the current owner signs the printed form himself, in black ink',
    });
    expect(out.text).not.toHaveProperty('f_signature');
  });

  it('never borrows the applicant’s details for the owner’s boxes', () => {
    // ⚠️ TWO DIFFERENT PEOPLE. The applicant's own identity number is in
    // `answers`; not one section F box may pick it up.
    const out = build({
      licenceType: S16,
      answers: {
        g_id_number: '8905125220089',
        id_number: '8905125220089',
        full_name: 'Gerhard Fourie',
        residential_address: '36 Sterappel Crescent',
      },
      seller: { fullName: 'Petrus Malan' },
    });

    const fValues = Object.entries(out.text)
      .filter(([k]) => k.startsWith('f_'))
      .map(([, v]) => v);
    expect(fValues).not.toContain('8905125220089');
    expect(fValues).not.toContain('Gerhard Fourie');
    expect(fValues).not.toContain('36 Sterappel Crescent');
    expect(out.text.f_id_number).toBeUndefined();
  });

  it('prints a half-answered section rather than nothing', () => {
    // He photographs his card first and signs later. What he has given must
    // appear; what he has not must simply be absent, not blank strings.
    const out = build({ licenceType: S16, answers: {}, seller: { fullName: 'P Malan' } });
    expect(out.text.f_full_names).toBe('P Malan');
    expect(out.text.f_cellphone).toBeUndefined();
    expect(out.text.f_place).toBeUndefined();
  });
});

describe('section E — the three serials and their makes', () => {
  it('fills every serial row the licence card carries', () => {
    // ⚠️ FOUR OF THESE SIX BOXES HAD NOWHERE TO PRINT. A real card carries a
    // barrel, frame and receiver serial, each with its OWN make, and they
    // genuinely differ — one reads barrel CZ / receiver NONE, another barrel
    // NONE / receiver MARLIN. The vault has read all six for a while.
    const out = build({
      licenceType: S16,
      answers: {
        firearm_make: 'MARLIN',
        barrel_serial: 'NONE',
        barrel_make: 'NONE',
        frame_serial: 'NONE',
        frame_make: 'NONE',
        receiver_serial: 'MR90189D',
        receiver_make: 'MARLIN',
      },
    });

    expect(out.text.e_make).toBe('MARLIN');
    expect(out.text.e_barrel_serial).toBe('NONE');
    expect(out.text.e_barrel_make).toBe('NONE');
    expect(out.text.e_frame_make).toBe('NONE');
    expect(out.text.e_receiver_make).toBe('MARLIN');
    expect(out.text.e_receiver_serial).toBe('MR90189D');
  });

  it('prints NONE verbatim, because that is what SAPS holds', () => {
    // Operator, 2026-08-23: "You insert exactly what is on the license card,
    // as that is what is registered with the SAPS system. if it says NONE, you
    // put NONE." Tidying it to blank would make our form disagree with the
    // register it is meant to match.
    const out = build({
      licenceType: S16,
      answers: { barrel_serial: 'NONE', barrel_make: 'NONE' },
    });
    expect(out.text.e_barrel_serial).toBe('NONE');
    expect(out.text.e_barrel_make).toBe('NONE');
  });
});

describe('every box we write is a box the form has', () => {
  it('never names a field that has no coordinate', () => {
    // ⚠️ A TYPO IN A FIELD NAME IS SILENT. put() writes into a plain object,
    // so `f_postal_addres` would compile, store, and simply never appear on
    // the printed page — the value would be lost between the applicant and the
    // DFO with nothing to show for it.
    const out = build({
      licenceType: S16,
      answers: {
        firearm_type: 'Rifle',
        firearm_make: 'MARLIN',
        barrel_serial: 'NONE',
        receiver_serial: 'MR90189D',
        receiver_make: 'MARLIN',
        safe_present: 'Yes',
        safe_type: 'Rifle safe',
        safe_mounted: 'Yes',
        safe_mounted_to: 'Wall',
        existing_firearm_1_make: 'CZ 550',
      },
      seller: {
        ...SELLER,
        surname: 'Malan',
        initials: 'P J',
        residentialAddress: '12 Kerkstraat',
        residentialPostalCode: '9660',
        postalAddress: 'PO Box 4',
        postalPostalCode: '9660',
        cellphone: '0821112222',
        email: 'piet@example.co.za',
        firearmAddress: '12 Kerkstraat',
        firearmPostalCode: '9660',
        designation: 'Owner',
        place: 'Bothaville',
        signedOn: '2026-08-28',
      },
      motivationReference: 'MO000042',
    });

    const known = new Set(Object.keys(SAPS271_COORDS));
    const unknownText = Object.keys(out.text).filter((k) => !known.has(k));
    const unknownTicks = out.ticks.filter((t) => !known.has(t));

    expect(unknownText).toEqual([]);
    expect(unknownTicks).toEqual([]);
    // And this fixture really did exercise section F, or the guard proves
    // nothing about the part that was just added.
    //
    // It was 18 until 2026-08-28, when items 79-87 stopped being written —
    // eight boxes that belong to the estate block. What is left is the Type A
    // block itself, items 4 to 15.
    expect(
      Object.keys(out.text).filter((k) => k.startsWith('f_')).length,
    ).toBeGreaterThanOrEqual(10);
  });
});

describe('section D — main or additional licence holder', () => {
  it('ticks the main box when they say so', () => {
    const out = build({
      licenceType: S16,
      answers: { licence_holder_type: 'Main firearm licence holder' },
    });
    expect(out.ticks).toContain('d_holder_main');
    expect(out.ticks).not.toContain('d_holder_additional');
  });

  it('ticks the additional box when they say so', () => {
    const out = build({
      licenceType: S16,
      answers: { licence_holder_type: 'Additional firearm licence holder' },
    });
    expect(out.ticks).toContain('d_holder_additional');
    expect(out.ticks).not.toContain('d_holder_main');
  });

  it('⚠️ says so rather than guessing when they have not answered', () => {
    // Both boxes were going in blank on every application and nothing said so.
    // Defaulting to "main" would be right most of the time and a false
    // statement the rest: an additional licence under section 12(1) is issued
    // to somebody living at the holder's premises — a real status we cannot
    // infer.
    const out = build({ licenceType: S16, answers: {} });
    expect(out.ticks).not.toContain('d_holder_main');
    expect(out.ticks).not.toContain('d_holder_additional');
    expect(out.leftBlank).toContainEqual({
      field: 'licence_holder_type',
      because:
        'you have not said whether this is your main licence or an additional one',
    });
  });
});

describe('postal codes go one digit per box', () => {
  it('splits the seller’s codes across their four boxes', () => {
    const out = build({
      licenceType: S16,
      answers: {},
      seller: {
        fullName: 'P Malan',
        residentialPostalCode: '9660',
        postalPostalCode: '9661',
      },
    });
    // The map still carries the whole value; it is the COORDINATE that decides
    // whether it is drawn as one string or one digit per box, and the shape of
    // every postal-code field is asserted in saps271-cells.spec.ts.
    expect(out.text.f_residential_postal_code).toBe('9660');
    expect(out.text.f_postal_postal_code).toBe('9661');
    // Item 80's code is NOT here: that box belongs to the estate block and is
    // never written. See "items 79 to 87" below.
  });
});

// ────────────────────────────────────────────────────────────────────
// THE BOXES THAT HAD NO WRITER.
//
// Eighteen boxes were measured, carried coordinates, and were never filled by
// anything — so they went to a DFO blank while the answers sat in the
// applicant's own record. They were found by sweeping the map for coordinate
// keys that appear nowhere in the fill logic, after the operator caught the
// first two by eye.
//
// Whatever is still unwritten after this is unwritten ON PURPOSE, and each one
// says why where it is decided.
// ────────────────────────────────────────────────────────────────────

describe('boxes that were measured and never filled', () => {
  it('writes the applicant’s own postal codes', () => {
    // Only the SELLER's were ever written, so an applicant's address went in
    // without its code while the current owner's did not.
    const out = build({
      licenceType: S16,
      answers: {
        residential_postal_code: '7580',
        postal_postal_code: '7579',
        employer_postal_code: '8001',
      },
    });
    expect(out.text.g_residential_postal_code).toBe('7580');
    expect(out.text.g_postal_postal_code).toBe('7579');
    expect(out.text.g_business_postal_code).toBe('8001');
  });

  it('writes the accredited association a section 16 rests on', () => {
    // ⚠️ SEVEN BOXES AND THE WORD "association" APPEARED NOWHERE IN THE FILL
    // LOGIC. The Act requires a sworn statement from the chairperson of an
    // accredited association; the form asks which one; we sent it blank.
    const out = build({
      licenceType: S16,
      answers: {
        association_name: 'SA Hunters',
        association_number: '108828',
        dedicated_since: '2019-04-01',
      },
    });
    expect(out.ticks).toContain('g_association_yes');
    expect(out.text.g_association_name).toBe('SA Hunters');
    expect(out.text.g_association_number).toBe('108828');
    expect(out.text.g_association_joined).toBe('20190401');
  });

  it('never ticks "no association" just because nothing was answered', () => {
    // An unanswered question is not a "no", and on a section 16 it would
    // contradict the rest of the applicant's own pack.
    const out = build({ licenceType: S16, answers: {} });
    expect(out.ticks).not.toContain('g_association_no');
    expect(out.ticks).not.toContain('g_association_yes');
    expect(out.leftBlank.map((b) => b.field)).toContain('association_name');
  });

  it('gives a spouse identified by passport their boxes', () => {
    // ⚠️ THE BRANCH THAT DID NOT EXIST. The old code ticked the SA box unless
    // the type was Passport — and did nothing at all when it was. A spouse's
    // identification vanished off the form entirely.
    const out = build({
      licenceType: S16,
      answers: {
        marital_status: 'Married',
        spouse_name: 'Anna Fourie',
        spouse_id_type: 'Passport',
        spouse_passport_number: 'A01234567',
      },
    });
    expect(out.ticks).toContain('g_spouse_id_type_passport');
    expect(out.text.g_spouse_passport).toBe('A01234567');
    expect(out.ticks).not.toContain('g_spouse_id_type_sa');
  });

  it('still handles a spouse on an SA identity number', () => {
    const out = build({
      licenceType: S16,
      answers: {
        marital_status: 'Married',
        spouse_id_type: 'SA ID',
        spouse_id_number: '9001010001088',
      },
    });
    expect(out.ticks).toContain('g_spouse_id_type_sa');
    expect(out.text.g_spouse_id_number).toBe('9001010001088');
  });
});

describe('telephone numbers, which the form splits in two', () => {
  it('splits a plain South African landline at the dialling code', () => {
    const out = build({
      licenceType: S16,
      answers: { home_telephone: '021 123 4567', work_telephone: '0219876543' },
    });
    expect(out.text.g_home_dialling_code).toBe('021');
    expect(out.text.g_home_telephone).toBe('1234567');
    expect(out.text.g_work_dialling_code).toBe('021');
    expect(out.text.g_work_telephone).toBe('9876543');
  });

  it('refuses to split anything it cannot split safely', () => {
    // ⚠️ A WRONGLY SPLIT TELEPHONE NUMBER IS A WRONG TELEPHONE NUMBER. An
    // international number has no three-digit local code to take, so the whole
    // thing goes in the number box and the code box stays empty.
    const out = build({
      licenceType: S16,
      answers: { home_telephone: '+27 21 123 4567' },
    });
    expect(out.text.g_home_dialling_code).toBeUndefined();
    expect(out.text.g_home_telephone).toBe('+27 21 123 4567');
  });

  it('writes nothing at all when there is no number', () => {
    const out = build({ licenceType: S16, answers: {} });
    expect(out.text.g_home_dialling_code).toBeUndefined();
    expect(out.text.g_home_telephone).toBeUndefined();
  });
});

describe('section G item 1 — which competency, and for what', () => {
  it('ticks D, because every licence this form serves is a possession licence', () => {
    // Not a guess: sections 13, 15 and 16 are all possession licences, and
    // possession rests on a category-D competency. A competency to trade, to
    // manufacture or to work as a gunsmith could never be what one of these
    // applications rests on.
    const out = build({ licenceType: S16, answers: {} });
    expect(out.ticks).toContain('g_competency_type_d');
    expect(out.ticks).not.toContain('g_competency_type_a');
    expect(out.ticks).not.toContain('g_competency_type_b');
    expect(out.ticks).not.toContain('g_competency_type_c');
  });

  it('ticks the firearms the certificate actually covers', () => {
    const out = build({
      licenceType: S16,
      answers: {
        competency_for: 'Handgun, Rifle or carbine - manually operated, Shotgun',
      },
    });
    expect(out.ticks).toContain('g_competency_for_handgun');
    expect(out.ticks).toContain('g_competency_for_rifle');
    expect(out.ticks).toContain('g_competency_for_shotgun');
  });

  it('folds both rifle endorsements into the form’s one rifle box', () => {
    // The form has three boxes; competency is endorsed per type AND action, so
    // a self-loading rifle and a manually operated one both land on "Rifle".
    const out = build({
      licenceType: S16,
      answers: {
        competency_for: 'Rifle or carbine - semi-automatic (self-loading)',
      },
    });
    expect(out.ticks).toContain('g_competency_for_rifle');
    expect(out.ticks).not.toContain('g_competency_for_handgun');
    expect(out.ticks).not.toContain('g_competency_for_shotgun');
  });

  it('ticks nothing for an endorsement the form has no box for', () => {
    const out = build({ licenceType: S16, answers: { competency_for: 'Muzzle-loader' } });
    for (const t of ['g_competency_for_handgun', 'g_competency_for_rifle', 'g_competency_for_shotgun']) {
      expect(out.ticks).not.toContain(t);
    }
  });
});

describe('section F item 15 — other licence holders', () => {
  it('ticks what the current owner said', () => {
    expect(
      build({ licenceType: S16, answers: {}, seller: { additionalHolders: true } }).ticks,
    ).toContain('f_additional_holders_yes');
    expect(
      build({ licenceType: S16, answers: {}, seller: { additionalHolders: false } }).ticks,
    ).toContain('f_additional_holders_no');
  });

  it('ticks neither when he has not been asked', () => {
    // A "no" we invented would be a statement about somebody else's household.
    const out = build({ licenceType: S16, answers: {}, seller: { fullName: 'P Malan' } });
    expect(out.ticks).not.toContain('f_additional_holders_yes');
    expect(out.ticks).not.toContain('f_additional_holders_no');
  });
});


// ────────────────────────────────────────────────────────────────────
// ITEMS 79 TO 87 ARE NEVER WRITTEN, ON ANY ROUTE.
//
// They were filled from the seller until 2026-08-28. Operator, on why they
// belong to Type E: "the declaration is there because of the nature of Type E,
// because there is no living person the license could belong too. Someone has
// to keep the firearms. If it is Type A, the license will be in a living
// persons name and they will need to have it in a safe at their house of
// residence according to law. So no need to declare you are keeping it safe in
// Type A's case or Type B as a dealer."
//
// ⚠️ AND THE CONSENT IS NOT LOST BY LEAVING THEM BLANK. It is captured on our
// own signed annexure - his two declarations, his signature, and both sides of
// his licence card. See motivation-seller-consent.service.ts.
// ────────────────────────────────────────────────────────────────────

describe('items 79 to 87 - the estate declaration block', () => {
  const EVERYTHING = {
    fullName: 'Petrus Johannes Malan',
    idNumber: '7204125008087',
    residentialAddress: '12 Kerkstraat, Bothaville',
    residentialPostalCode: '9660',
    firearmAddress: '12 Kerkstraat, Bothaville',
    firearmPostalCode: '9660',
    designation: 'Owner',
    place: 'Bothaville',
    signedOn: '2026-08-28',
  };

  const BOXES = [
    'f_firearm_address',
    'f_firearm_address_2',
    'f_firearm_postal_code',
    'f_owner_name',
    'f_owner_id',
    'f_designation',
    'f_place',
    'f_declaration_date',
  ] as const;

  it('writes none of them even when the seller gave every value', () => {
    // ⚠️ HOLDING THE ANSWER IS NOT A REASON TO PRINT IT. Every one of these
    // is captured on the consent form and deliberately goes no further.
    const out = build({ licenceType: S16, answers: {}, seller: EVERYTHING });
    for (const k of BOXES) expect(out.text[k]).toBeUndefined();
  });

  it('still fills the Type A block above them', () => {
    // The removal is items 79-87 and nothing else - his own particulars at
    // items 4 to 15 are still his half of the form and still printed.
    const out = build({ licenceType: S16, answers: {}, seller: EVERYTHING });
    expect(out.text.f_full_names).toBe('Petrus Johannes Malan');
    expect(out.text.f_id_number).toBe('7204125008087');
    expect(out.text.f_residential_address).toBe('12 Kerkstraat, Bothaville');
    expect(out.text.f_residential_postal_code).toBe('9660');
  });

  it('keeps their coordinates measured, for the day Type E is built', () => {
    // Measured off the form's own ruling lines. Deleting the geometry would
    // mean re-deriving it under deadline the day an estate route is built.
    for (const k of BOXES) expect(SAPS271_COORDS[k]).toBeDefined();
  });
});

const OWNER_TICKS = [
  'f_owner_type_a',
  'f_owner_type_b',
  'f_owner_type_c',
  'f_owner_type_d',
  'f_owner_type_e',
] as const;

const ownerTicks = (out: ReturnType<typeof buildSaps271>) =>
  out.ticks.filter((t) => (OWNER_TICKS as readonly string[]).includes(t));

describe('item 1.2 — the owner-type tick', () => {
  const withSource = (firearm_source: string) =>
    buildSaps271({ licenceType: S16, answers: { firearm_source }, seller: SELLER });

  it('ticks A and fills the block on a private sale', () => {
    const out = withSource('From a private owner');
    expect(ownerTicks(out)).toEqual(['f_owner_type_a']);
    expect(out.text.f_full_names).toBe('Petrus Johannes Malan');
  });

  it('ticks B on a dealer purchase and fills NOTHING else in section F', () => {
    // ⚠️ THE POINT OF THE FIX. Operator, 2026-08-28: "F. Type B and SAP 350
    // can be left alone, a dealer needs to fill in those." Ticking B is a true
    // statement; it is also the whole of what we may say on that route.
    const out = withSource('From a dealer');
    expect(ownerTicks(out)).toEqual(['f_owner_type_b']);
    expect(out.text.f_full_names).toBeUndefined();
    expect(out.text.f_id_number).toBeUndefined();
    expect(out.text.f_residential_address).toBeUndefined();
    expect(out.text.f_owner_name).toBeUndefined();
    // And it says why, rather than leaving a silent blank.
    // ⚠️ IT NAMES WHO FILLS IT IN. Operator, 2026-08-28: "Type B - Leave it
    // blank and state that dealer must fill in that section - Upload or scan
    // document : Invoice (but not mandatory)." A blank box with no
    // explanation sends somebody to a counter to be turned away.
    const said = out.leftBlank.find((b) => b.field === 'firearm_source');
    expect(said?.because).toContain('dealer completes section F');
    expect(said?.because).toContain('invoice');
    expect(said?.because).toContain('not required');
  });

  it('routes a stored estate answer to E, not to A', () => {
    // "Inherited from a deceased estate" is retired as a CHOICE, but an
    // application written before that decision still carries it — and under
    // the old rule it printed "private owner".
    const out = withSource('Inherited from a deceased estate');
    expect(ownerTicks(out)).toEqual(['f_owner_type_e']);
    expect(out.text.f_full_names).toBeUndefined();
    expect(
      out.leftBlank.find((b) => b.field === 'firearm_source')?.because,
    ).toContain('executor');
  });

  it('infers NOTHING from merely holding a seller', () => {
    // ⚠️ THE FORM ASKS THE QUESTION AND SO DO WE. Operator, 2026-08-28: "the
    // tick should be either dealer or private. not default to fucking
    // private." An earlier attempt treated a completed seller consent as an
    // answer to the routing question. It is not one — it is a side effect of
    // another part of the flow, and letting it decide item 1.2 is the same
    // mistake, in a smaller costume, as the unconditional tick it replaced.
    const out = buildSaps271({ licenceType: S16, answers: {}, seller: SELLER });
    expect(ownerTicks(out)).toEqual([]);
    expect(out.text.f_full_names).toBeUndefined();
    expect(
      out.leftBlank.find((b) => b.field === 'firearm_source')?.because,
    ).toContain('have not told us');
  });

  it('ticks nothing at all on an explicit "not decided yet"', () => {
    // "Not decided yet" is a real answer plenty of applications carry - the
    // motivation is written before the firearm is found, and is what a dealer
    // or a seller is then shown. It routes to none of the five blocks.
    const out = withSource('Not decided yet');
    expect(ownerTicks(out)).toEqual([]);
    expect(out.text.f_full_names).toBeUndefined();
    expect(
      out.leftBlank.find((b) => b.field === 'firearm_source')?.because,
    ).toContain('have not told us');
  });

  it('ticks nothing where there is neither an answer nor a seller', () => {
    const out = buildSaps271({ licenceType: S16, answers: {} });
    expect(ownerTicks(out)).toEqual([]);
    // And says nothing about a seller we do not have.
    expect(
      out.leftBlank.find((b) => b.field === 'firearm_source'),
    ).toBeUndefined();
  });

  it('never ticks two owner types at once, on any answer', () => {
    // Two ticks in item 1.2 routes the reader to two different blocks and
    // makes the form unanswerable.
    for (const firearm_source of [
      'From a private owner',
      'From a dealer',
      'Inherited from a deceased estate',
      'Not decided yet',
      '',
      'something we have never heard of',
    ]) {
      const out = buildSaps271({
        licenceType: S16,
        answers: { firearm_source },
        seller: SELLER,
      });
      expect({ firearm_source, ticks: ownerTicks(out) }).toEqual({
        firearm_source,
        ticks: ownerTicks(out).slice(0, 1),
      });
    }
  });

  it('never ticks C or D, which the platform does not offer', () => {
    for (const firearm_source of [
      'From a private owner',
      'From a dealer',
      'Inherited from a deceased estate',
      'Not decided yet',
      'Company',
      'Imported firearm',
      '',
    ]) {
      const out = buildSaps271({
        licenceType: S16,
        answers: { firearm_source },
        seller: SELLER,
      });
      expect(out.ticks).not.toContain('f_owner_type_c');
      expect(out.ticks).not.toContain('f_owner_type_d');
    }
  });

  it('gives all five ticks their own box on one printed row', () => {
    // They are one row of five 19.1pt cells. Two ticks resolving to the same
    // coordinates would be a measuring error that looks like nothing at all.
    const specs = OWNER_TICKS.map(
      (k) => SAPS271_COORDS[k] as { page: number; x: number; y: number },
    );
    expect(new Set(specs.map((s) => s.x)).size).toBe(5);
    expect(new Set(specs.map((s) => s.page))).toEqual(new Set([2]));
    expect(new Set(specs.map((s) => s.y)).size).toBe(1);
  });
});
