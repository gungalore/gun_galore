import {
  MANDATORY_UNIT_STANDARD,
  UNIT_STANDARDS,
  endorsementFromUnitStandard,
  parseEndorsements,
  parseUnitStandards,
  readStatementOfResults,
  unitStandardSpec,
} from './sa-competency';

// ────────────────────────────────────────────────────────────────────
// THE STATEMENT OF RESULTS, AND THE CODES ON IT.
//
// A training provider issues a page listing the SAQA unit standards passed, by
// number. Operator, 2026-08-29: "that is the page we are looking for, not the
// certificate itself."
//
// ⚠️ THESE TESTS EXIST BECAUSE A CODE USED TO RESOLVE TO NOTHING, SILENTLY.
// document-fields.ts already routed the extractor's `unit_standard` into the
// motivation's `competency_for`, and that answer is read as LABELS —
// parseEndorsements('119649') returned []. An empty resolution does not raise:
// per the note on LEGACY_LABELS it reads as "we have not seen the certificate
// yet", so the eligibility check turned itself off with no log line and nothing
// on screen. Verified by running it before the fix.
// ────────────────────────────────────────────────────────────────────

describe('the code table', () => {
  it('holds the mandatory legal-knowledge standard', () => {
    // s 9(2)(q) — "the prescribed test on knowledge of this Act". No practical
    // unit substitutes for it.
    expect(MANDATORY_UNIT_STANDARD).toBe('117705');
    expect(unitStandardSpec('117705')?.title).toMatch(/Firearms Control Act/i);
  });

  it('⚠️ gives 117705 NO endorsement', () => {
    // It proves knowledge of the Act, not the handling of any firearm. A
    // statement carrying only 117705 proves no firearm type at all.
    expect(unitStandardSpec('117705')?.endorsement).toBeUndefined();
  });

  it('maps one code per firearm type, as SAPS does', () => {
    // Operator, 2026-08-29: "handgun is handgun. whether its a semi auto
    // pistol or revolver, they all fall under the same code" — and the same
    // for shotgun.
    expect(endorsementFromUnitStandard('119649')).toBe('handgun');
    expect(endorsementFromUnitStandard('119652')).toBe('shotgun');
    expect(endorsementFromUnitStandard('243200')).toBe('muzzle-loader');
  });

  it('splits rifle/carbine by action, which is the ONE split with a basis', () => {
    expect(endorsementFromUnitStandard('119651')).toBe('rifle-mo');
    expect(endorsementFromUnitStandard('119650')).toBe('rifle-sl');
  });

  it('⚠️ 123515 IS A BUSINESS HANDGUN STANDARD, not a shotgun one', () => {
    // The reference calls this "the worst error in the document": v2 mapped
    // 123515 to "self-loading shotgun". It is s 9(2)(s), NQF 4, and filing it
    // as a private shotgun unit misstates what the holder has done.
    const spec = unitStandardSpec('123515');
    expect(spec?.endorsement).toBe('handgun');
    expect(spec?.businessPurposes).toBe(true);
  });

  it('marks every 1235xx code as business purposes and nothing else', () => {
    for (const u of UNIT_STANDARDS) {
      expect({ code: u.code, business: Boolean(u.businessPurposes) }).toEqual({
        code: u.code,
        business: u.code.startsWith('1235'),
      });
    }
  });

  it('has no duplicate codes', () => {
    const codes = UNIT_STANDARDS.map((u) => u.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('parseUnitStandards', () => {
  it('finds every code on a statement', () => {
    expect(
      parseUnitStandards('US 117705 PASSED\nUS 119649 PASSED\nUS 119652 PASSED'),
    ).toEqual(['117705', '119649', '119652']);
  });

  it('dedupes — a statement is a table and repeats its own rows', () => {
    expect(parseUnitStandards('119649 ... 119649 (summary)')).toEqual(['119649']);
  });

  it('⚠️ WILL NOT PULL SIX DIGITS OUT OF A LONGER NUMBER', () => {
    // An ID number, a certificate number and a date all live on this page.
    expect(parseUnitStandards('ID 9001010001088')).toEqual([]);
    expect(parseUnitStandards('Cert 1234567')).toEqual([]);
    expect(parseUnitStandards('20260630')).toEqual([]);
  });

  // ── THE THREE PHANTOMS THE OPERATOR'S OWN DOCUMENTS PRODUCED ──────
  //
  // A bare six-digit scan found all three on the real set. Each would have
  // filed a statement under a firearm the holder never trained on, or reported
  // a company registration number as an unknown unit standard.

  it('⚠️ does not read the SCV number as a code', () => {
    // 2021 statement, North West Guns.
    expect(parseUnitStandards('SCV Number: K/10358 -K919835')).toEqual([]);
  });

  it('⚠️ does not read a print-header URL as a code', () => {
    // The 2021 statement was printed from a browser and carries its own URL.
    expect(
      parseUnitStandards(
        'https://pftcdms.co.za/client/upload-list/certificate/673334',
      ),
    ).toEqual([]);
  });

  it('⚠️ does not read a company registration number as a code', () => {
    // 2025 certificate footer.
    expect(
      parseUnitStandards('Reg.No. 2017/510807/07 Jacobus Burger 2'),
    ).toEqual([]);
  });

  it('⚠️ AND STILL FINDS THE ROW TWO LINES BELOW THE SCV NUMBER', () => {
    // The case that broke a looser window: 919835 found "Handle and Use"
    // further down the page and was reported as a code.
    expect(
      parseUnitStandards(
        'SCV Number: K/10358 -K919835\nSAQA ID Unit Standards Title\n' +
          '119651 Handle and Use a Manually Operated Rifle or Carbine',
      ),
    ).toEqual(['119651']);
  });

  it('reads a code from a certificate, where an en-dash separates it', () => {
    // The provider's own certificate carries the code too, punctuated
    // differently: "119650 – Handle and Use a Self-loading rifle or carbine".
    expect(
      parseUnitStandards(
        '119650 – Handle and Use a Self-loading rifle or carbine',
      ),
    ).toEqual(['119650']);
  });

  it('learns a code it has never seen, when a title stands beside it', () => {
    // ⚠️ THE SECOND ARM. Without it a genuinely new SAQA unit — dealer,
    // instructor, security officer — is dropped silently and the document
    // looks like it proved less than it did.
    expect(parseUnitStandards('998877 Handle and use a crossbow')).toEqual([
      '998877',
    ]);
  });

  it('accepts a known code with no title, as a stored answer has none', () => {
    // competency_for holds bare values, not table rows.
    expect(parseUnitStandards('competency_for: 119649')).toEqual(['119649']);
  });

  it('returns nothing for a page with no codes', () => {
    expect(parseUnitStandards('')).toEqual([]);
    expect(parseUnitStandards('Statement of Results — no results captured')).toEqual(
      [],
    );
  });
});

describe('readStatementOfResults', () => {
  it('reads the operator own 2014 handgun statement, two rows on one page', () => {
    // ⚠️ THE CASE THAT DEFINES THE RULE. Operator, 2026-08-29: "I did my
    // 117705 with my handgun. but i have to supply that statement of results
    // along with the rifle statement of results if I apply for a rifle."
    // One page, two rows, eleven years before the rifle application.
    const r = readStatementOfResults(
      'SAQAID Description US Completed On\n' +
        '117705 Knowledge of the Firearms Control Act, 2000 (Act No 60 of 2000) 2014/01/23\n' +
        '119649 Handle and use a Handgun 2014/01/23',
    );
    expect(r.known).toEqual(['117705', '119649']);
    expect(r.hasMandatoryKnowledge).toBe(true);
    // ⚠️ ONE endorsement, not two. 117705 proves knowledge of the Act, not
    // the handling of any firearm.
    expect(r.endorsements).toEqual(['handgun']);
  });

  it('reads a full statement: several codes, one page', () => {
    // ⚠️ ONE STATEMENT OFTEN CARRIES SEVERAL. Operator: "some statement of
    // results will have multiple codes for people that did all at once with
    // one certificate."
    const r = readStatementOfResults(
      'US 117705\nUS 119649\nUS 119651\nUS 119652',
    );
    expect(r.hasMandatoryKnowledge).toBe(true);
    expect(r.endorsements).toEqual(['handgun', 'rifle-mo', 'shotgun']);
    expect(r.unknown).toEqual([]);
  });

  it('⚠️ REPORTS A MISSING 117705 RATHER THAN INFERRING IT AWAY', () => {
    // Operator: "the 117705 must always be requested by the system and alerted
    // if it's missing." A statement proving three firearm types still does not
    // satisfy s 9(2)(q).
    const r = readStatementOfResults('119649 119651 119652');
    expect(r.hasMandatoryKnowledge).toBe(false);
    expect(r.endorsements).toHaveLength(3);
  });

  it('orders endorsements the same way whatever order they were printed in', () => {
    const a = readStatementOfResults('119652 119649');
    const b = readStatementOfResults('119649 119652');
    expect(a.endorsements).toEqual(b.endorsements);
  });

  it('surfaces a code it does not recognise rather than dropping it', () => {
    // ⚠️ A DROPPED CODE MAKES A DOCUMENT LOOK LIKE IT PROVED LESS THAN IT DID.
    // Providers list dealer, instructor and security-officer units too.
    //
    // ⚠️ AND IT NEEDS ITS TITLE. An unknown number with nothing beside it is
    // noise, not a unit standard — that is exactly what the SCV number and the
    // company registration number are. Written as a real row.
    const r = readStatementOfResults(
      '117705 Knowledge of the Firearms Control Act\n' +
        '119649 Handle and use a Handgun\n' +
        '123456 Handle and use a dealer stock register',
    );
    expect(r.unknown).toEqual(['123456']);
    expect(r.known).toEqual(['117705', '119649']);
    expect(r.endorsements).toEqual(['handgun']);
  });

  it('⚠️ treats an unknown number with NO title as noise, not a code', () => {
    // The whole point of the second arm's anchor.
    const r = readStatementOfResults('117705 Knowledge of the Act, ref 123456');
    expect(r.unknown).toEqual([]);
    expect(r.known).toEqual(['117705']);
  });

  it('flags a business-purposes statement for a human to look at', () => {
    const r = readStatementOfResults('117705 123515');
    expect(r.businessPurposes).toBe(true);
    expect(r.endorsements).toEqual(['handgun']);
  });

  it('is empty and honest about a page with nothing on it', () => {
    const r = readStatementOfResults('');
    expect(r).toEqual({
      endorsements: [],
      hasMandatoryKnowledge: false,
      known: [],
      unknown: [],
      businessPurposes: false,
    });
  });
});

describe('parseEndorsements now reads codes as well as words', () => {
  it('⚠️ THE REGRESSION THIS CLOSES', () => {
    // Ran before the fix and returned []. A statement of results read by OCR
    // arrives as digits, and every other branch of parseEndorsements matches
    // type WORDS.
    expect(parseEndorsements('119649')).toEqual(['handgun']);
    expect(parseEndorsements('117705, 119649, 119652')).toEqual([
      'handgun',
      'shotgun',
    ]);
  });

  it('still reads the words, unchanged', () => {
    // The card path must not regress: most stored answers are labels.
    expect(parseEndorsements('Handgun')).toEqual(['handgun']);
    expect(parseEndorsements('Shotgun')).toEqual(['shotgun']);
  });

  it('reads a page carrying both codes and words without double-counting', () => {
    expect(parseEndorsements('Handgun (US 119649)')).toEqual(['handgun']);
  });
});
