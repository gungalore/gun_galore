import {
  DOCUMENT_MARKERS,
  MODEL_ONLY_KINDS,
  readMarkers,
} from './document-markers';

// ────────────────────────────────────────────────────────────────────
// TELLING A DOCUMENT APART BY WHAT IS PRINTED ON IT.
//
// Two classes, and only one belongs in the library. Operator, 2026-08-29:
// "there are a few documents that will always differ from person to person,
// proof of address, letter of good standing, dedicated shooter certificate. I
// need the AI to interpret these documents and decide what they are... The
// documents that is standard format we can train the OCR library on."
//
// So these tests check two things in equal measure: that a standard-format
// document is caught by a marker, and that a document which genuinely varies
// is NOT — because a marker that fires on a bank statement files it under a
// requirement it does not satisfy, and nothing on screen would say so.
//
// The text below is taken from the operator's own documents where possible.
// ────────────────────────────────────────────────────────────────────

/** The 2014 NSN statement of results, as OCR would read its top half. */
const PFTC_SOR = `
STATEMENT OF RESULTS
SOUTH AFRICAN PROFESSIONAL
FIREARM TRAINERS COUNCIL
Training Provider Name : NSN Shooting Academy
SAPS Accreditation Number: 4000114   Provider Code : 041904002286
The Following Unit Standard/s Have Been Awarded
SAQAID  Description                                            US Completed On
117705  Knowledge of the Firearms Control Act, 2000            2014/01/23
119649  Handle and use a Handgun                               2014/01/23
`;

/** The One Shot provider certificate — same evidence, different layout. */
const PROVIDER_CERT = `
ONE SHOT FIREARM TRAINING
CERTIFICATE
Has completed the following proficiency firearm training
119650 – Handle and Use a Self-loading rifle or carbine
PFTC Accreditation Number: T1802001
Reg.No. 2017/510807/07
`;

describe('standard-format documents are caught by a marker', () => {
  it('reads a PFTC statement of results', () => {
    const v = readMarkers(PFTC_SOR);
    expect(v?.kind).toBe('PROFICIENCY_CERTIFICATE');
    expect(v?.strength).toBe('definitive');
  });

  it('reads a provider certificate carrying the same codes', () => {
    // Different layout, same evidence — a unit standard beside its title.
    const v = readMarkers(PROVIDER_CERT);
    expect(v?.kind).toBe('PROFICIENCY_CERTIFICATE');
    expect(v?.strength).toBe('strong');
  });

  it('reads a SAPS 524 competency certificate', () => {
    const v = readMarkers('SAPS 524\nCOMPETENCY CERTIFICATE\nissued to');
    expect(v?.kind).toBe('COMPETENCY_CERTIFICATE');
    expect(v?.strength).toBe('definitive');
  });

  it('⚠️ NEVER MISTAKES SAPS 517 FOR SAPS 524', () => {
    // 517 is the APPLICATION for a competency certificate; 524 is the
    // certificate. Filing an application as the certificate would show a pack
    // as complete while the thing SAPS asks for is missing.
    expect(readMarkers('SAPS 517 Application for a competency certificate')).toBeNull();
    expect(readMarkers('SAPS 517(a) further competency')).toBeNull();
  });
});

describe('⚠️ documents that differ per person are LEFT to the model', () => {
  // Each of these is a different document every time it arrives. A marker
  // here would be a rule that is wrong for somebody, and being wrong files a
  // document under a requirement it does not satisfy.

  it('does not try to classify a proof of address', () => {
    for (const text of [
      'CITY OF CAPE TOWN\nMunicipal account\nAccount number 123456789\nAmount due',
      'FNB\nBank statement\nStatement period 01 May to 31 May\nBalance brought forward',
      'LEASE AGREEMENT\nbetween the Lessor and the Lessee\nMonthly rental',
    ]) {
      expect(readMarkers(text)).toBeNull();
    }
  });

  it('does not try to classify a letter of good standing', () => {
    // Every association writes its own, on its own letterhead.
    expect(
      readMarkers(
        'SA HUNTERS AND GAME CONSERVATION ASSOCIATION\n' +
          'To whom it may concern\n' +
          'This is to confirm that the member is in good standing',
      ),
    ).toBeNull();
  });

  it('does not try to classify a dedicated-status certificate', () => {
    expect(
      readMarkers(
        'CERTIFICATE OF DEDICATED SPORTS SHOOTER STATUS\nawarded to\nvalid until',
      ),
    ).toBeNull();
  });

  it('names every kind it deliberately leaves alone', () => {
    // ⚠️ THE LIST IS PART OF THE DESIGN, NOT A GAP. A future contributor
    // reading a "missing" classifier should find the reason, not add one.
    for (const kind of [
      'ADDRESS_CONFIRMATION',
      'GOOD_STANDING_LETTER',
      'ASSOCIATION_CARD',
      'ASSOCIATION_ENDORSEMENT',
    ] as const) {
      expect(MODEL_ONLY_KINDS).toContain(kind);
    }
  });

  it('has no marker for any kind on the model-only list', () => {
    // The two lists must not overlap, or the library quietly overrides the
    // judgement the operator asked the model to make.
    for (const m of DOCUMENT_MARKERS) {
      expect({ kind: m.kind, modelOnly: MODEL_ONLY_KINDS.includes(m.kind) }).toEqual(
        { kind: m.kind, modelOnly: false },
      );
    }
  });
});

describe('a marker is a marker, not a mention', () => {
  it('does not fire on a council named in a footer without the heading', () => {
    expect(
      readMarkers(
        'Accredited by the SOUTH AFRICAN PROFESSIONAL FIREARM TRAINERS COUNCIL',
      ),
    ).toBeNull();
  });

  it('does not read a bare six-digit number as a unit standard', () => {
    // The SCV number, the print-header URL and the company registration
    // number all produced six-digit false positives on real documents.
    expect(readMarkers('SCV Number: K/10358 -K919835')).toBeNull();
    expect(readMarkers('Reg.No. 2017/510807/07')).toBeNull();
  });

  it('⚠️ NEEDS THE TITLE, NOT JUST A REGISTERED CODE', () => {
    // The two guards are independent and only this one is load-bearing for a
    // number that IS a real code. 119649 printed as an invoice line, a phone
    // extension or a page reference is not a proficiency certificate — and
    // unlike the numbers above, the code list cannot reject it.
    expect(readMarkers('Invoice 119649\nAmount due R450.00')).toBeNull();
    expect(readMarkers('Ref 117705')).toBeNull();
  });

  it('reads the code even where OCR mangles the spacing around it', () => {
    // The guard must not be so tight that a real statement slips past it.
    const v = readMarkers('119651\nHandle  and  Use  a  Shotgun');
    expect(v?.kind).toBe('PROFICIENCY_CERTIFICATE');
  });

  it('does not call a competency certificate a licence', () => {
    // It names a firearm TYPE; only a licence prints a licence number against
    // a specific firearm with its serial.
    expect(
      readMarkers('COMPETENCY CERTIFICATE\nCompetent to possess a handgun'),
    ).toBeNull();
  });

  it('does not call every document an ID because it carries an ID number', () => {
    // Every document in this pack carries the holder's identity number.
    expect(
      readMarkers('Learner Name: A Person\nIdentification Number: 8905125220089'),
    ).toBeNull();
  });
});

describe('when two markers disagree', () => {
  it('⚠️ A TIE GOES TO THE MODEL, NOT TO ARRAY ORDER', () => {
    // Picking the first match would make the answer depend on the order
    // somebody happened to write the list in.
    const both =
      'IDENTITY DOCUMENT\nI.D. NUMBER 8905125220089\n' +
      'Licence No 12345  Serial Number AB123  Calibre .308';
    expect(readMarkers(both)).toBeNull();
  });

  it('lets a definitive marker beat a strong one on the same page', () => {
    // A competency certificate that lists the units behind it is a competency
    // certificate, not a statement of results.
    const v = readMarkers(
      'SAPS 524 COMPETENCY CERTIFICATE\n119649 Handle and use a Handgun',
    );
    expect(v?.kind).toBe('COMPETENCY_CERTIFICATE');
  });

  it('reports every marker that fired, for a human checking a mistake', () => {
    const v = readMarkers(
      'SAPS 524 COMPETENCY CERTIFICATE\n119649 Handle and use a Handgun',
    );
    expect(v?.matched.length).toBeGreaterThan(1);
    for (const m of v?.matched ?? []) expect(m.because).toBeTruthy();
  });
});

describe('an empty or unreadable page', () => {
  it('is null rather than a guess', () => {
    expect(readMarkers('')).toBeNull();
    expect(readMarkers('   \n  ')).toBeNull();
  });
});
