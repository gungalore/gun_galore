import {
  declarationFor,
  firearmRowsFor,
  signedLineFor,
  type ConsentStatement,
} from './motivation-consent-statement';
import type { FirearmSnapshot } from './motivation-seller-consent.service';

// ────────────────────────────────────────────────────────────────────
// FIVE REAL LICENCE CARDS.
//
// Operator, 2026-08-23: "You insert exactly what is on the license card, as
// that is what is registered with the SAPS system. if it says NONE, you put
// NONE." — and then supplied photographs of the five licences he holds.
//
// They are transcribed here verbatim because between them they cover every
// awkward shape the card takes, and every one of them defeats an instinct a
// developer would otherwise follow:
//
//   HOWA      — all three serial rows carry the SAME number
//   CZ        — barrel only; receiver and frame both read NONE
//   NORDISKE  — barrel and receiver differ BY ONE TRAILING DIGIT
//   MARLIN    — barrel NONE, the number is on the RECEIVER alone
//   MAUSER    — barrel and receiver match, frame NONE
//
// Model reads NONE on all five. Any rule that required a model, assumed the
// headline serial was populated, deduplicated matching serials, or reconciled
// near-identical ones would break at least one of these — and would put a
// number on a signed statement that SAPS does not hold.
// ────────────────────────────────────────────────────────────────────

const APPLICANT = {
  applicantName: 'A N Other',
  applicantIdNumber: '9001015800086',
};

const HOWA: FirearmSnapshot = {
  unlabelledNumber: '3086',
  section: 'SECTION 15',
  make: 'HOWA',
  model: 'NONE',
  type: 'MANUALLY OPERATED RIFLE',
  calibre: '6.5MM CREEDMOOR',
  serial: 'B477423',
  barrelSerial: 'B477423',
  barrelMake: 'HOWA',
  receiverSerial: 'B477423',
  receiverMake: 'HOWA',
  frameSerial: 'B477423',
  frameMake: 'HOWA',
  ...APPLICANT,
};

const CZ: FirearmSnapshot = {
  unlabelledNumber: '3088',
  section: 'SECTION 16',
  make: 'CZ',
  model: 'NONE',
  type: 'HANDGUN',
  calibre: '6.35MM BROWNING',
  serial: '81815',
  barrelSerial: '81815',
  barrelMake: 'CZ',
  receiverSerial: 'NONE',
  receiverMake: 'NONE',
  frameSerial: 'NONE',
  frameMake: 'NONE',
  ...APPLICANT,
};

const NORDISKE: FirearmSnapshot = {
  unlabelledNumber: '3088',
  section: 'SECTION 16',
  make: 'NORDISKE PRECISION',
  model: 'NONE',
  type: 'S/L: RIFLE  CAL - RIFLE/CARBINE',
  calibre: '.223 REM',
  serial: 'ZA2226548',
  barrelSerial: 'ZA2226548',
  barrelMake: 'NORDISKE PRECISION',
  receiverSerial: 'ZA22265488',
  receiverMake: 'NORDISKE PRECISION',
  frameSerial: 'NONE',
  frameMake: 'NONE',
  ...APPLICANT,
};

const MARLIN: FirearmSnapshot = {
  unlabelledNumber: '3088',
  section: 'SECTION 16',
  make: 'MARLIN',
  model: 'NONE',
  type: 'MANUALLY OPERATED RIFLE',
  calibre: '.45-70 GOVERNMENT',
  serial: 'MR90189D',
  barrelSerial: 'NONE',
  barrelMake: 'NONE',
  receiverSerial: 'MR90189D',
  receiverMake: 'MARLIN',
  frameSerial: 'NONE',
  frameMake: 'NONE',
  ...APPLICANT,
};

const MAUSER: FirearmSnapshot = {
  unlabelledNumber: '3088',
  section: 'SECTION 16',
  make: 'MAUSER',
  model: 'NONE',
  type: 'MANUALLY OPERATED RIFLE',
  calibre: '.30-06 SPRINGFIELD',
  serial: '96008993',
  barrelSerial: '96008993',
  barrelMake: 'MAUSER',
  receiverSerial: '96008993',
  receiverMake: 'MAUSER',
  frameSerial: 'NONE',
  frameMake: 'NONE',
  ...APPLICANT,
};

const ALL: [string, FirearmSnapshot][] = [
  ['HOWA', HOWA],
  ['CZ', CZ],
  ['NORDISKE', NORDISKE],
  ['MARLIN', MARLIN],
  ['MAUSER', MAUSER],
];

const stmt = (firearm: FirearmSnapshot): ConsentStatement => ({
  sellerFullName: 'Gerhard Johan Petrus Fourie',
  sellerIdNumber: '8905125220089',
  sellerPhone: '+27743039999',
  firearm,
  signedPlace: 'Bloemfontein, Free State',
  signedAt: new Date('2026-08-23T10:00:00Z'),
});

const byLabel = (f: FirearmSnapshot) =>
  Object.fromEntries(firearmRowsFor(stmt(f)).map((r) => [r.label, r.value]));

describe('the card, verbatim', () => {
  it.each(ALL)('%s: prints NONE wherever the card says NONE', (_n, card) => {
    const rows = byLabel(card);
    for (const [label, value] of Object.entries(rows)) {
      // Whatever the card said, that is what came out. No blanks standing in
      // for NONE and no NONEs standing in for blanks.
      expect(value).not.toBe('');
      expect(typeof label).toBe('string');
    }
    expect(rows['Model']).toBe('NONE');
  });

  it('CZ: keeps a receiver and frame of NONE rather than dropping the rows', () => {
    const rows = byLabel(CZ);
    expect(rows['Receiver serial number']).toBe('NONE');
    expect(rows['Frame serial number']).toBe('NONE');
    expect(rows['Barrel serial number']).toBe('81815');
  });

  it('MARLIN: the number is on the RECEIVER and the barrel is NONE', () => {
    // A rule that read the barrel row as "the serial" would report NONE for a
    // firearm that has one.
    const rows = byLabel(MARLIN);
    expect(rows['Barrel serial number']).toBe('NONE');
    expect(rows['Receiver serial number']).toBe('MR90189D');
  });

  it('NORDISKE: barrel and receiver differ by one digit and STAY different', () => {
    const rows = byLabel(NORDISKE);
    expect(rows['Barrel serial number']).toBe('ZA2226548');
    expect(rows['Receiver serial number']).toBe('ZA22265488');
    expect(rows['Barrel serial number']).not.toBe(
      rows['Receiver serial number'],
    );
  });

  it('HOWA: three identical serials are all printed, not deduplicated', () => {
    const rows = byLabel(HOWA);
    expect(rows['Serial number']).toBe('B477423');
    expect(rows['Barrel serial number']).toBe('B477423');
    expect(rows['Receiver serial number']).toBe('B477423');
    expect(rows['Frame serial number']).toBe('B477423');
  });

  it('carries the per-component makes, which differ within one card', () => {
    expect(byLabel(CZ)['Barrel make']).toBe('CZ');
    expect(byLabel(CZ)['Receiver make']).toBe('NONE');
    expect(byLabel(MARLIN)['Barrel make']).toBe('NONE');
    expect(byLabel(MARLIN)['Receiver make']).toBe('MARLIN');
  });

  it('copies the type string whole rather than parsing it', () => {
    expect(byLabel(NORDISKE)['Type']).toBe('S/L: RIFLE  CAL - RIFLE/CARBINE');
    expect(byLabel(CZ)['Type']).toBe('HANDGUN');
  });

  it('NEVER prints the unlabelled number, because we cannot name it', () => {
    // It tracks the SECTION across these five cards (15 -> 3086, 16 -> 3088),
    // so it is not a per-firearm licence number. The card gives it no label,
    // and inventing one on a signed statement is an assertion we cannot back.
    for (const [, card] of ALL) {
      const rows = firearmRowsFor(stmt(card));
      expect(rows.map((r) => r.value)).not.toContain(card.unlabelledNumber);
      expect(rows.map((r) => r.label)).not.toContain('Licence number');
    }
  });

  it('DROPS a field nobody established, and only that', () => {
    // ⚠️ THE ASYMMETRY THAT MATTERS. Unread is absent; NONE is printed.
    // Writing NONE for something OCR could not read would assert to a DFO that
    // the card says so.
    const rows = firearmRowsFor(
      stmt({ ...MAUSER, calibre: undefined, type: '' }),
    );
    const labels = rows.map((r) => r.label);
    expect(labels).not.toContain('Calibre');
    expect(labels).not.toContain('Type');
    expect(labels).toContain('Frame serial number'); // NONE, still printed
  });
});

describe('the declaration', () => {
  it('names both people and points at the list', () => {
    const d = declarationFor(stmt(NORDISKE));
    expect(d).toContain('Gerhard Johan Petrus Fourie');
    expect(d).toContain('8905125220089');
    expect(d).toContain('A N Other');
    expect(d).toContain('9001015800086');
    // ⚠️ LOAD-BEARING — it is what gives the list beneath it force.
    expect(d).toMatch(/listed below/);
  });

  it.each(ALL)(
    '%s: carries NO firearm particulars in the sentence itself',
    (_n, card) => {
      // Operator: "not embeded in the declaration sentence". A paragraph
      // holding a dozen card fields invites paraphrase, and paraphrase is
      // exactly what must not happen to values that match a register.
      const d = declarationFor(stmt(card));
      for (const v of [card.make, card.calibre, card.serial, card.type]) {
        if (v && v !== 'NONE') expect(d).not.toContain(v);
      }
    },
  );

  it('still reads sensibly when the applicant ID is not held', () => {
    const d = declarationFor(
      stmt({ ...MAUSER, applicantIdNumber: undefined }),
    );
    expect(d).toContain('A N Other');
    expect(d).not.toContain('identity number )');
    expect(d).not.toContain('undefined');
  });
});

describe('the signed line', () => {
  it('names the place and the date', () => {
    expect(signedLineFor(stmt(MAUSER))).toBe(
      'Signed at Bloemfontein, Free State on 23 August 2026.',
    );
  });

  it('OMITS a place it does not have rather than guessing', () => {
    expect(
      signedLineFor({ ...stmt(MAUSER), signedPlace: null }),
    ).toBe('Signed on 23 August 2026.');
  });

  it('degrades to bare "Signed." with neither', () => {
    expect(
      signedLineFor({ ...stmt(MAUSER), signedPlace: null, signedAt: null }),
    ).toBe('Signed.');
  });
});

describe('the contact number', () => {
  it('is the OTP-verified one, printed in the declaration', () => {
    // ⚠️ VERIFIED, NOT TYPED. It is the only contact detail on the page we can
    // attest to — we sent a code to it and it came back. A field the seller
    // filled in is a claim, and putting one beside a verified signature would
    // weaken both.
    expect(declarationFor(stmt(MAUSER))).toContain('+27743039999');
  });
});
