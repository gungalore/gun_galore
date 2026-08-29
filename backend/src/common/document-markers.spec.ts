import {
  DOCUMENT_MARKERS,
  MODEL_ONLY_KINDS,
  readMarkers,
} from './document-markers';

// ────────────────────────────────────────────────────────────────────
// TELLING A DOCUMENT APART BY WHAT IS PRINTED ON IT.
//
// Every fixture below is BOILERPLATE TRANSCRIBED FROM A REAL DOCUMENT the
// operator supplied on 2026-08-29 — the fixed wording only, never a name, an
// identity number or a licence number. That matters twice: the markers are
// only ever allowed to key on boilerplate, and this file is committed.
//
// ⚠️ THE FIRST VERSION OF THE LIBRARY WAS WRITTEN FROM MEMORY AND MISSED THREE
// OF THESE NINE. The competency card, the licence card and the green identity
// book all returned null and went to the model. Each miss has a named test
// below, so the same assumption cannot come back.
//
// Two classes of document, and only one belongs in the library. Operator:
// "there are a few documents that will always differ from person to person,
// proof of address, letter of good standing, dedicated shooter certificate. I
// need the AI to interpret these documents and decide what they are... The
// documents that is standard format we can train the OCR library on."
// ────────────────────────────────────────────────────────────────────

/** The paper competency certificate — five copies, 2016 to 2025. */
const SAPS_524 = `SAPS 524
SOUTH AFRICAN POLICE SERVICE
COMPETENCY CERTIFICATE
Section 10 of the Firearms Control Act, 2000 (Act No 60 of 2000)
Initials and surname
Identity number
Type of competency certificate   COMPETENCY TO POSSESS A FIREARM HANDGUN
Competency certificate number
It is hereby certified that the above person has successfully completed the
prescribed test on the knowledge of the Firearms Control Act, 2000
f/THE REGISTRAR   Name in block letters   Rank in block letters   Persal number`;

/** The older plastic card. Note "relevent" — that spelling is on the card. */
const COMPETENCY_CARD = `COMPETENCY CERTIFICATE
Section 10 of the Firearms Control Act, 60 of 2000
COMPETENCY TO POSSESS A FIREARM
HANDGUN
VUURWAPENLISENSIEFIREARMLICENCE
Completed the relevent tests as prescribed by the Firearms Control Act, 2000.`;

/** The licence card — six of them, sections 15 and 16. */
const LICENCE_CARD = `Licence To Possess a Firearm
Firearms Control Act, 60 of 2000
SECTION 16
Serial Number   Make   Calibre
Type  HANDGUN   Model NONE
Barrel Serial No   Receiver Serial No   Frame Serial No
VUURWAPENLISENSIEFIREARMLICENCE`;

/** PFTC statement of results, 2021 and 2025 template. */
const PFTC_NEW = `STATEMENT OF RESULTS
SOUTH AFRICAN PROFESSIONAL FIREARM TRAINERS COUNCIL
Training Provider Name:   SAPS Accreditation Number:   Provider Code:
Assessor Name:   Assessor Number:   SCV Number: K/00000 -K900001
Scan to verify the authenticity of this SOR.   Authentication Code:
Learner Name:   Identification Number:
The following Unit Standards have been awarded
SAQA ID   Unit Standards Title   SCV Number   Date of issue
119652    Handle and Use a Shotgun
To validate this Statement of Results (SoR):`;

/** PFTC statement of results, 2014 template — different column headings. */
const PFTC_OLD = `STATEMENT OF RESULTS
SOUTH AFRICAN PROFESSIONAL FIREARM TRAINERS COUNCIL
Training Provider Name :   SAPS Accreditation Number :   Provider Code :
Learner Name :   National ID Number :   Certificate Number :
The Following Unit Standard/s Have Been Awarded
SAQAID   Description   US Completed On
117705   Knowledge of the Firearms Control Act, 2000 (Act No 60 of 2000)
119649   Handle and use a Handgun`;

const ONE_SHOT = `ONE SHOT FIREARM TRAINING
CERTIFICATE
Has completed the following proficiency firearm training
119652 - Handle and Use a Shotgun
S/C/V Numbers:
PFTC Accreditation Number:   SAPS Accreditation Number:
Reg.No. 2017/510807/07`;

const PROGUN = `NORTH WEST GUNS CC T/A PROGUN
Certificate of Proficiency
This is to certify that
is awarded this certificate as evidence of Successful Completion of a Registered
HANDLE AND USE MANUALLY OPERATED RIFLE OR CARBINE : SAQA 119651
TRAINING COURSE
SAPS ACCREDITED TRAINING PROVIDER`;

/** ⚠️ A TRAINING certificate that says COMPETENCY. Not the SAPS document. */
const NSN_COMPETENCY_COURSE = `SASSETA REG NO:   SHOOTING RANGE NO:   TRAINER PROVIDER NO:
THIS IS TO CERTIFY THAT
NAME   ID NUMBER
HAS SUCCESSFULLY COMPLETED A
DEMONSTRATE KNOWLEDGE OF THE FIREARMS CONTROL ACT 2000 (ACT 60 OF 2000)  117705
HANDLE AND USE OF A HANDGUN  119649
COMPETENCY COURSE
RANGE MASTER   ASSESSOR   CERTIFICATE NO
"WE SUPPORT RESPONSIBLE GUN OWNERSHIP"`;

const GREEN_ID_BOOK = `I.D. No.
S.A.CITIZEN
SURNAME
FORENAMES
COUNTRY OF BIRTH   SOUTH AFRICA
DATE OF BIRTH
DATE ISSUED
ISSUED BY AUTHORITY OF THE DIRECTOR-GENERAL HOME AFFAIRS`;

describe('every document the operator actually holds', () => {
  it.each([
    ['SAPS 524, paper', SAPS_524, 'COMPETENCY_CERTIFICATE', 'definitive'],
    ['competency card', COMPETENCY_CARD, 'COMPETENCY_CERTIFICATE', 'definitive'],
    ['licence card', LICENCE_CARD, 'CURRENT_LICENCE', 'definitive'],
    ['PFTC statement, 2025', PFTC_NEW, 'PROFICIENCY_CERTIFICATE', 'definitive'],
    ['PFTC statement, 2014', PFTC_OLD, 'PROFICIENCY_CERTIFICATE', 'definitive'],
    ['One Shot certificate', ONE_SHOT, 'PROFICIENCY_CERTIFICATE', 'strong'],
    ['Progun certificate', PROGUN, 'PROFICIENCY_CERTIFICATE', 'strong'],
    ['green identity book', GREEN_ID_BOOK, 'IDENTITY_DOCUMENT', 'definitive'],
  ])('reads a %s', (_label, text, kind, strength) => {
    const v = readMarkers(text);
    expect({ kind: v?.kind, strength: v?.strength }).toEqual({ kind, strength });
  });
});

describe('⚠️ the three the library used to miss', () => {
  // Each of these returned null and went to the model, because the first
  // version of the file was written from recall instead of from a document.

  it('the competency CARD carries no form number at all', () => {
    // SAPS issued competency as a plastic card before moving to paper. There
    // is no "SAPS 524" anywhere on it, so the form-number marker cannot help.
    expect(COMPETENCY_CARD).not.toMatch(/SAPS\s*524/i);
    expect(readMarkers(COMPETENCY_CARD)?.kind).toBe('COMPETENCY_CERTIFICATE');
  });

  it('the licence CARD never prints the words "licence number"', () => {
    // It heads "Licence To Possess a Firearm" and labels the firearm with
    // "Serial Number" and "Calibre". The generic licence-number marker
    // matched none of the operator's six cards.
    expect(LICENCE_CARD).not.toMatch(/licen[cs]e\s*(no|number)/i);
    expect(readMarkers(LICENCE_CARD)?.kind).toBe('CURRENT_LICENCE');
  });

  it('the green book prints neither "identity document" nor "RSA"', () => {
    // The identity page says "I.D. No.", "FORENAMES" and the Home Affairs
    // authority line — and none of the phrases the old marker required.
    expect(GREEN_ID_BOOK).not.toMatch(/IDENTITY\s+DOCUMENT/i);
    expect(GREEN_ID_BOOK).not.toMatch(/REPUBLIC\s+OF\s+SOUTH\s+AFRICA/i);
    expect(readMarkers(GREEN_ID_BOOK)?.kind).toBe('IDENTITY_DOCUMENT');
  });

  it('still reads the green book when the photo crops the bottom line off', () => {
    const cropped = GREEN_ID_BOOK.replace(
      /ISSUED BY AUTHORITY OF THE DIRECTOR-GENERAL HOME AFFAIRS/,
      '',
    );
    expect(readMarkers(cropped)?.kind).toBe('IDENTITY_DOCUMENT');
  });
});

describe('⚠️ a TRAINING certificate is not the SAPS certificate', () => {
  // The most dangerous confusion in the whole pack. A provider's course
  // certificate and the statutory competency certificate both say
  // "competency"; only one of them satisfies section 9(2)(q)-(s). Filing the
  // course certificate as the SAPS one shows the requirement met while the
  // document SAPS asks for is missing, and nothing on screen would say so.

  it('reads NSN\'s "COMPETENCY COURSE" as proficiency, not competency', () => {
    const v = readMarkers(NSN_COMPETENCY_COURSE);
    expect(v?.kind).toBe('PROFICIENCY_CERTIFICATE');
  });

  it('is separated by section 10, which no training certificate cites', () => {
    // It quotes the Act — every firearms document does — but never the
    // section that creates the competency certificate.
    expect(NSN_COMPETENCY_COURSE).toMatch(/FIREARMS CONTROL ACT/i);
    expect(NSN_COMPETENCY_COURSE).not.toMatch(/section\s*10/i);
  });

  it('is separated by the word after "competency"', () => {
    expect(NSN_COMPETENCY_COURSE).toMatch(/COMPETENCY COURSE/i);
    expect(NSN_COMPETENCY_COURSE).not.toMatch(/competency\s+certificate/i);
  });
});

describe('⚠️ an APPLICATION is not the document it applies for', () => {
  // SAPS 271 is titled "Application for a licence to possess a firearm" and
  // SAPS 517 is the application for a competency certificate. Both carry the
  // exact heading of the thing they ask for. We GENERATE SAPS 271 ourselves,
  // so a member uploading their own copy is not hypothetical.

  it('does not read SAPS 271 as the licence it applies for', () => {
    const saps271 = `SAPS 271
APPLICATION FOR A LICENCE TO POSSESS A FIREARM
Serial number   Calibre   Make   Type`;
    expect(readMarkers(saps271)).toBeNull();
  });

  it('does not read SAPS 517 as the competency certificate', () => {
    const saps517 = `SAPS 517
APPLICATION FOR A COMPETENCY CERTIFICATE
Section 10 of the Firearms Control Act, 2000 (Act No 60 of 2000)`;
    expect(readMarkers(saps517)).toBeNull();
  });

  it('records that it vetoed, rather than silently finding nothing', () => {
    // A veto and a no-hit both return null, and they mean different things to
    // anybody debugging a document that would not file.
    const saps271 = `SAPS 271
APPLICATION FOR A LICENCE TO POSSESS A FIREARM
Serial number   Calibre`;
    // The veto is visible on a page that also has a surviving marker.
    const withBoth = `${saps271}\n${GREEN_ID_BOOK}`;
    const v = readMarkers(withBoth);
    expect(v?.vetoed).toContain('licence-to-possess-card');
  });
});

describe('⚠️ both PFTC template generations still circulate', () => {
  it('reads the 2014 column headings', () => {
    expect(PFTC_OLD).toMatch(/SAQAID/);
    expect(PFTC_OLD).toMatch(/Unit Standard\/s Have Been Awarded/i);
    expect(readMarkers(PFTC_OLD)?.kind).toBe('PROFICIENCY_CERTIFICATE');
  });

  it('reads the 2025 column headings', () => {
    expect(PFTC_NEW).toMatch(/SAQA ID/);
    expect(PFTC_NEW).toMatch(/Unit Standards have been awarded/i);
    expect(readMarkers(PFTC_NEW)?.kind).toBe('PROFICIENCY_CERTIFICATE');
  });

  // ⚠️ THE TABLE HEADING IS THE LAST RESORT, SO IT IS TESTED DIRECTLY.
  // With the letterhead present the council marker catches these; with it
  // cropped, the unit code and its title still do. The heading only earns its
  // keep on a statement whose CODE is one we do not carry, or whose title the
  // OCR mangled — and that is the case asserted here, because an end-to-end
  // fixture passes through the other two markers and proves nothing about
  // this one. A version understanding only the 2025 wording passed the whole
  // suite until this test existed.
  it.each([
    ['2014 wording', 'The Following Unit Standard/s Have Been Awarded\nSAQAID  Description'],
    ['2025 wording', 'The following Unit Standards have been awarded\nSAQA ID  Unit Standards Title'],
  ])('reads a statement by its table alone — %s', (_l, heading) => {
    // 999999 is not a code we carry, and the title is deliberately unreadable.
    const garbled = `STATEMENT OF RESULTS
${heading}
999999  Hnd1e ard Ue a Sh0tgun`;
    expect(readMarkers(garbled)?.kind).toBe('PROFICIENCY_CERTIFICATE');
  });

  it('reads a statement with the letterhead cropped away', () => {
    const noHeader = PFTC_NEW.replace(
      /SOUTH AFRICAN PROFESSIONAL FIREARM TRAINERS COUNCIL/,
      '',
    );
    expect(readMarkers(noHeader)?.kind).toBe('PROFICIENCY_CERTIFICATE');
  });
});

describe('⚠️ every wording providers actually print for a unit title', () => {
  // Three providers, three spellings of the same standard. An anchor that
  // fits only one silently stops recognising the others — and the document
  // still uploads, so nothing looks broken.
  it.each([
    ['PFTC', '119651 Handle and Use a Manually Operated Rifle or Carbine'],
    ['Progun, no "a"', 'HANDLE AND USE MANUALLY OPERATED RIFLE OR CARBINE : SAQA 119651'],
    ['NSN, "use OF a"', 'HANDLE AND USE OF A HANDGUN  119649'],
    ['PFTC 117705', '117705 Knowledge of the Firearms Control Act, 2000'],
    ['NSN 117705', 'DEMONSTRATE KNOWLEDGE OF THE FIREARMS CONTROL ACT 2000  117705'],
  ])('reads %s', (_label, text) => {
    expect(readMarkers(text)?.kind).toBe('PROFICIENCY_CERTIFICATE');
  });
});

describe('a marker is a marker, not a mention', () => {
  it('does not fire on the council named in a footer', () => {
    expect(
      readMarkers('Accredited by the SOUTH AFRICAN PROFESSIONAL FIREARM TRAINERS COUNCIL'),
    ).toBeNull();
  });

  it('does not read a bare six-digit number as a unit standard', () => {
    // All three of these appear on the operator's own documents.
    expect(readMarkers('SCV Number: K/00000 -K900001')).toBeNull();
    expect(readMarkers('Reg.No. 2017/510807/07')).toBeNull();
    expect(readMarkers('https://pftcdms.co.za/client/upload-list/certificate/673334')).toBeNull();
  });

  it('⚠️ NEEDS THE TITLE, NOT JUST A REGISTERED CODE', () => {
    // Unlike the numbers above, these ARE real codes — only the title anchor
    // can reject them.
    expect(readMarkers('Invoice 119649\nAmount due R450.00')).toBeNull();
    expect(readMarkers('Ref 117705')).toBeNull();
  });

  it('does not call every document an ID because it carries an ID number', () => {
    // Every document in this pack prints the holder's identity number.
    expect(readMarkers('Learner Name: A Person\nIdentification Number: 9001015800086')).toBeNull();
    expect(readMarkers('ID Number: 9001015800086')).toBeNull();
  });

  it('does not call a competency certificate a licence', () => {
    // It names a firearm TYPE and says COMPETENCY to possess, not LICENCE to.
    const v = readMarkers(SAPS_524);
    expect(v?.kind).toBe('COMPETENCY_CERTIFICATE');
  });
});

describe('⚠️ documents that differ per person are LEFT to the model', () => {
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
      readMarkers('CERTIFICATE OF DEDICATED SPORTS SHOOTER STATUS\nawarded to\nvalid until'),
    ).toBeNull();
  });

  it('has no marker for any kind on the model-only list', () => {
    // The two lists must not overlap, or the library quietly overrides the
    // judgement the operator asked the model to make.
    for (const m of DOCUMENT_MARKERS) {
      expect({ name: m.name, modelOnly: MODEL_ONLY_KINDS.includes(m.kind) }).toEqual({
        name: m.name,
        modelOnly: false,
      });
    }
  });
});

describe('the shape of the library itself', () => {
  it('⚠️ EVERY MARKER REQUIRES AT LEAST TWO PHRASES, OR IS A FORM NUMBER', () => {
    // One phrase is a mention; a pair is a marker. The single exception is a
    // SAPS form number, which IS the document.
    for (const m of DOCUMENT_MARKERS) {
      const singleton = m.all.length < 2;
      expect({
        name: m.name,
        ok: !singleton || /SAPS/.test(m.all[0].source),
      }).toEqual({ name: m.name, ok: true });
    }
  });

  it('gives every marker a reason quoted from a document', () => {
    for (const m of DOCUMENT_MARKERS) {
      expect({ name: m.name, hasReason: m.because.length > 40 }).toEqual({
        name: m.name,
        hasReason: true,
      });
    }
  });

  it('vetoes the application forms on every marker they could trip', () => {
    // Anything keyed on a heading that an application also carries.
    for (const name of [
      'licence-to-possess-card',
      'competency-certificate-section-10',
      'saps-524-form-number',
    ]) {
      const m = DOCUMENT_MARKERS.find((x) => x.name === name);
      expect({ name, vetoed: (m?.never ?? []).length > 0 }).toEqual({
        name,
        vetoed: true,
      });
    }
  });
});

describe('when two markers disagree', () => {
  it('⚠️ A TIE GOES TO THE MODEL, NOT TO ARRAY ORDER', () => {
    // Two kinds claiming a page at equal strength is exactly what a model
    // should judge. Picking the first would make the answer depend on the
    // order somebody happened to write the list in.
    const both = `${GREEN_ID_BOOK}\nLicence To Possess a Firearm\nSerial Number  Calibre`;
    expect(readMarkers(both)).toBeNull();
  });

  it('lets a definitive marker beat a strong one on the same page', () => {
    // A competency certificate that lists the units behind it is still a
    // competency certificate.
    const v = readMarkers(`${SAPS_524}\n119649 Handle and use a Handgun`);
    expect(v?.kind).toBe('COMPETENCY_CERTIFICATE');
  });

  it('reports every marker that fired, by name', () => {
    const v = readMarkers(SAPS_524);
    expect(v!.matched.length).toBeGreaterThan(1);
    for (const m of v!.matched) expect(m.name).toBeTruthy();
  });
});

describe('an empty or unreadable page', () => {
  it('is null rather than a guess', () => {
    expect(readMarkers('')).toBeNull();
    expect(readMarkers('   \n  ')).toBeNull();
  });
});

describe('⚠️ the white smart ID card', () => {
  // The operator had no copy at first — "I also dont have a white ID card we
  // can use, so search online" — so this began as a marker built from a
  // description, deliberately held at `strong`. They then supplied a real
  // specimen, and the heading it revealed is NOT what the search implied:
  // "NATIONAL IDENTITY CARD", not "IDENTITY CARD", under "REPUBLIC OF SOUTH
  // AFRICA". Boilerplate only below — the specimen is another person's card.

  const SMART_CARD = `REPUBLIC OF SOUTH AFRICA
NATIONAL IDENTITY CARD
Surname:
Names:
Sex:
Nationality:   RSA
Identity Number:
Date of Birth:
Country of Birth:   RSA
Status:   CITIZEN
Signature:`;

  it('reads the card from its heading', () => {
    const v = readMarkers(SMART_CARD);
    expect({ kind: v?.kind, strength: v?.strength }).toEqual({
      kind: 'IDENTITY_DOCUMENT',
      strength: 'definitive',
    });
  });

  it('⚠️ THE HEADING IS "NATIONAL IDENTITY CARD", NOT "IDENTITY CARD"', () => {
    // A pattern written from the searched description would have anchored on
    // the wrong two words. The specimen is why this is right.
    expect(SMART_CARD).toMatch(/NATIONAL IDENTITY CARD/);
  });

  it('⚠️ DOES NOT FILE EVERY GOVERNMENT DOCUMENT THAT SAYS "RSA"', () => {
    // "Republic of South Africa" heads passports, birth certificates, unabridged
    // marriage certificates and most government paper. The second line is the
    // whole marker.
    expect(
      readMarkers('REPUBLIC OF SOUTH AFRICA\nUNABRIDGED BIRTH CERTIFICATE'),
    ).toBeNull();
  });

  it('still reads the card when glare washes the heading out', () => {
    // The ordinary failure on a laminated card photographed under a light.
    const noHeading = SMART_CARD.split('\n').slice(2).join('\n');
    const v = readMarkers(noHeading);
    expect({ kind: v?.kind, strength: v?.strength }).toEqual({
      kind: 'IDENTITY_DOCUMENT',
      strength: 'strong',
    });
  });

  it('⚠️ DOES NOT FILE A PASSPORT AS AN IDENTITY DOCUMENT', () => {
    // A passport is NOT what SAPS asks for, and it shares most of the card's
    // field labels. Written as a real passport reads — heading, then the
    // overlapping labels — rather than as an ID card with the word "passport"
    // stapled on, which is a document that does not exist and would prove
    // nothing about the veto.
    const passport = `REPUBLIC OF SOUTH AFRICA
PASSPORT / PASPOORT
Surname:
Names:
Nationality:   RSA
Identity Number:
Date of Birth:
Country of Birth:   RSA`;
    expect(readMarkers(passport)).toBeNull();
  });

  it('does not fire on a form that merely asks for these details', () => {
    const form = `SAPS 271 APPLICATION
Nationality   Country of birth   Identity Number`;
    expect(readMarkers(form)).toBeNull();
  });

  it('leaves the other documents in the pack alone', () => {
    // SAPS 524 prints "Identity number" but neither of the other two labels.
    expect(readMarkers(SAPS_524)?.kind).toBe('COMPETENCY_CERTIFICATE');
    expect(readMarkers(GREEN_ID_BOOK)?.strength).toBe('definitive');
  });
});
