import {
  legalSourceSpecs,
  parseLegalSource,
  type LegalSourceSpec,
} from './legal-parser';

const ACT = legalSourceSpecs().find((s) => s.documentType === 'ACT')!;
const REG = legalSourceSpecs().find((s) => s.documentType === 'REGULATIONS')!;
const AMEND = legalSourceSpecs().find(
  (s) => s.documentType === 'AMENDMENT_ACT',
)!;

function parse(text: string, spec: LegalSourceSpec) {
  return parseLegalSource(text, spec).provisions;
}

describe('the legal parser', () => {
  it('reads an Act section whose heading sits on the line above', () => {
    const provisions = parse(
      [
        'IT THEREFORE ENACTED',
        'CHAPTER 5',
        'COMPETENCY CERTIFICATES',
        'Application for competency certificate',
        '9. (1) An application must be delivered to the Designated Firearms Officer.',
        '(2) The applicant must be 21 years or older.',
        'Licence to possess firearm for self-defence',
        '13. (1) A firearm may be a handgun which is not fully automatic.',
        '(2) The Registrar may issue a licence to a person who needs it.',
        'SCHEDULE 1',
        '1. Something in a schedule.',
      ].join('\n'),
      ACT,
    );

    expect(provisions.map((p) => p.sectionNumber)).toEqual(['9', '13']);
    expect(provisions[0].heading).toBe('Application for competency certificate');
    expect(provisions[1].heading).toBe(
      'Licence to possess firearm for self-defence',
    );
    expect(provisions[1].chapter).toBe('Chapter 5 — COMPETENCY CERTIFICATES');
    expect(provisions[1].citation).toContain('s 13');
    expect(provisions[1].text).toContain('handgun');
  });

  it('reads a regulation whose heading sits on the same line', () => {
    const provisions = parse(
      [
        'Chapter 2',
        '2. General provisions relating to accreditation',
        '(1) An applicant must apply to the Registrar.',
        '(2) The application must be delivered.',
        '3. Accreditation of public collector',
        '(1) The applicant must satisfy the Registrar.',
        'Annexure A (Regulation 97)',
        '1. A form.',
      ].join('\n'),
      REG,
    );

    expect(provisions.map((p) => p.sectionNumber)).toEqual(['2', '3']);
    expect(provisions[0].heading).toBe(
      'General provisions relating to accreditation',
    );
    expect(provisions[0].text).not.toContain(
      'General provisions relating to accreditation',
    );
    expect(provisions[1].citation).toContain('reg 3');
  });

  it('keeps an amendment section whole and stops before the short title', () => {
    const provisions = parse(
      [
        'Amendment of section 1 of Act 60 of 2000',
        '1. Section 1 is hereby amended by the substitution for the definition of "ammunition".',
        '(a) by the substitution for the definition of "cartridge".',
        'Amendment of section 4 of Act 60 of 2000',
        '3. Section 4 is amended.',
        'Short title and commencement',
        '54. This Act is called the Amendment Act.',
      ].join('\n'),
      AMEND,
    );

    expect(provisions.map((p) => p.sectionNumber)).toEqual(['1', '3']);
    expect(provisions[0].heading).toBe('Amendment of section 1 of Act 60 of 2000');
    expect(provisions[0].text).toContain('definition of "cartridge"');
  });

  it('reads the OCR forms: comma separators, dollar-prefixed and brace-suffixed numbers', () => {
    const provisions = parse(
      [
        'IT THEREFORE ENACTED',
        'Requirements for import, export or in-transit permit',
        '74, (1) A permit may be issued to a fit and proper person.',
        'Defaced, lost or stolen permits',
        '$2. (1) The holder must report the loss.',
        'Restrictions on possession of ammunition',
        '9}. (1) No person may possess more than 200 cartridges.',
        'SCHEDULE 1',
      ].join('\n'),
      ACT,
    );

    expect(provisions.map((p) => p.sectionNumber)).toEqual(['74', '82', '91']);
  });

  it('strips page furniture and page numbers from headings', () => {
    const provisions = parse(
      [
        'IT THEREFORE ENACTED',
        'CHAPTER 1',
        'Definitions 5',
        '1. In this Act, unless the context indicates otherwise--',
        'GOVERNMENT GAZETTE, 10 APRIL 2001',
        'No. 22214',
        '2. The purpose of this Act is to--',
        'SCHEDULE 1',
      ].join('\n'),
      ACT,
    );

    expect(provisions[0].heading).toBe('Definitions');
    expect(provisions[0].text).toContain('unless the context');
    expect(provisions[0].text).not.toContain('GOVERNMENT GAZETTE');
  });
});
