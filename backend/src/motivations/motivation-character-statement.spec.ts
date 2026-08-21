import {
  buildCharacterStatement,
  buildCharacterStatements,
  CHARACTER_STATEMENT_VERSION,
  StatementBlock,
} from './motivation-character-statement';

// ────────────────────────────────────────────────────────────────────
// WHAT THESE TESTS ARE ACTUALLY PROTECTING.
//
// Not layout — that is checked by looking at the rendered page. These guard
// the things that make the form honest, every one of which is a plausible
// "improvement" somebody could make later in good faith:
//
//   · dropping "No" and "I am not able to say" to tidy up the tick boxes,
//   · prefilling Part D with a helpful draft the referee can adapt,
//   · trimming the regulation 13(8) notice because it is long,
//   · keeping the offence warning while cutting the sentence that says a
//     negative answer is allowed.
//
// Each of those turns a statement by a third party into something the
// applicant effectively wrote. The last one is the worst: a warning about a
// criminal offence with no stated way to decline is pressure, and it would be
// applied to somebody who is doing the applicant a favour.
// ────────────────────────────────────────────────────────────────────

const INPUT = {
  applicantName: 'Gerhard Fourie',
  referenceNumber: 'MOT-2026-000123',
  licenceTypeLabel: 'Section 16 — dedicated hunter',
};

const textOf = (blocks: StatementBlock[]): string =>
  blocks
    .map((b) =>
      'text' in b
        ? b.text
        : 'label' in b && typeof b.label === 'string'
          ? b.label
          : '',
    )
    .join(' \n ');

describe('character reference forms', () => {
  it('produces two forms, numbered', () => {
    const forms = buildCharacterStatements(INPUT);
    expect(forms).toHaveLength(2);
    expect(forms.map((f) => f.index)).toEqual([1, 2]);
    expect(forms[0].subtitle).toContain('first');
    expect(forms[1].subtitle).toContain('second');
    expect(forms.every((f) => f.version === CHARACTER_STATEMENT_VERSION)).toBe(
      true,
    );
  });

  it('is deterministic — the same application always yields the same form', () => {
    // The pack is re-rendered from stored answers on every download. A form
    // that varied per call would mean the copy a referee returns is not the
    // copy the applicant sent.
    expect(buildCharacterStatement(INPUT, 1)).toEqual(
      buildCharacterStatement(INPUT, 1),
    );
  });

  describe('the three questions regulation 13(7) asks', () => {
    const declares = buildCharacterStatement(INPUT, 1).blocks.filter(
      (b): b is Extract<StatementBlock, { kind: 'declare' }> =>
        b.kind === 'declare',
    );

    it('asks all three, in the order of the subregulation', () => {
      expect(declares).toHaveLength(3);
      expect(declares.map((d) => d.number)).toEqual(['1', '2', '3']);
      expect(declares[0].text).toMatch(/13\(7\)\(a\)/);
      expect(declares[1].text).toMatch(/13\(7\)\(b\)/);
      expect(declares[2].text).toMatch(/13\(7\)\(c\)/);
    });

    it('tracks what each paragraph actually requires', () => {
      expect(declares[0].text).toMatch(/fit and proper person/i);
      expect(declares[1].text).toMatch(/stable mental condition/i);
      expect(declares[1].text).toMatch(/inclined to violence/i);
      expect(declares[2].text).toMatch(/intoxicating or narcotic effect/i);
    });

    it('lets every question be answered negatively', () => {
      // ⚠️ THE LOAD-BEARING TEST IN THIS FILE. reg 13(7) says the referee must
      // state WHETHER the applicant is these things — the answer is allowed to
      // be no. A form offering only "Yes" is not a statement by the referee,
      // it is a signature block, and it puts words in the mouth of somebody
      // who never said them.
      for (const d of declares) {
        expect(d.options).toContain('Yes');
        expect(d.options).toContain('No');
        expect(d.options).toContain('I am not able to say');
      }
    });

    it('gives room to explain a negative answer', () => {
      const blocks = buildCharacterStatement(INPUT, 1).blocks;
      const explain = blocks.find(
        (b) => b.kind === 'lines' && /No/.test(b.label ?? ''),
      );
      expect(explain).toBeDefined();
    });
  });

  describe('what the referee is told before they sign', () => {
    const all = textOf(buildCharacterStatement(INPUT, 1).blocks);

    it('says it is voluntary and that they may be contacted (reg 13(8))', () => {
      expect(all).toMatch(/voluntary/i);
      expect(all).toMatch(/may contact you/i);
      expect(all).toMatch(/13\(8\)/);
      expect(all).toMatch(/not compelled/i);
    });

    it('says where their personal details go', () => {
      expect(all).toMatch(/identity number and contact details go to the police/i);
    });

    it('warns about the offence AND says a negative answer is allowed', () => {
      // ⚠️ BOTH HALVES OR NEITHER. Telling a member of the public they may be
      // prosecuted for a wrong answer, without telling them they are free to
      // answer "No", is pressure dressed as compliance.
      expect(all).toMatch(/120\(9\)\(f\)/);
      expect(all).toMatch(/offence/i);
      expect(all).toMatch(/are proper answers/i);
    });

    it('tells the applicant to keep their hands off it', () => {
      expect(all).toMatch(/should not complete any part of it for you/i);
    });
  });

  describe('what is filled in and what is not', () => {
    const blocks = buildCharacterStatement(INPUT, 1).blocks;
    const fields = blocks.filter(
      (b): b is Extract<StatementBlock, { kind: 'field' }> => b.kind === 'field',
    );

    it('prefills only the applicant and the reference', () => {
      const filled = fields.filter((f) => f.value);
      expect(filled.map((f) => f.value)).toEqual([
        'Gerhard Fourie',
        'MOT-2026-000123',
      ]);
    });

    it('leaves every field about the referee blank', () => {
      for (const f of fields) {
        if (/applicant|reference/i.test(f.label)) continue;
        expect(f.value).toBeUndefined();
      }
      expect(fields.some((f) => /identity or passport/i.test(f.label))).toBe(
        true,
      );
      expect(fields.some((f) => /contact number/i.test(f.label))).toBe(true);
    });

    it('supplies no draft wording for the free-text section', () => {
      // ⚠️ NO SAMPLE PARAGRAPH, EVER. Two referees returning our sentences is
      // the most obvious possible sign that the applicant wrote both — and it
      // would be true. Part D must be ruled lines and a prompt, nothing else.
      const partD = blocks.slice(
        blocks.findIndex(
          (b) => b.kind === 'part' && /ANYTHING ELSE/i.test(b.title),
        ),
      );
      const upToSignature = partD.slice(
        0,
        partD.findIndex((b) => b.kind === 'part' && /DECLARATION/i.test(b.title)),
      );
      expect(upToSignature.some((b) => b.kind === 'lines')).toBe(true);
      expect(upToSignature.some((b) => b.kind === 'text')).toBe(false);
      const note = upToSignature.find((b) => b.kind === 'note');
      expect(note && 'text' in note ? note.text : '').toMatch(
        /in your own words/i,
      );
    });
  });

  it('carries a declaration and a signature', () => {
    const blocks = buildCharacterStatement(INPUT, 1).blocks;
    expect(blocks.some((b) => b.kind === 'sign')).toBe(true);
    const decl = blocks.find(
      (b) => b.kind === 'text' && /true to the best of my knowledge/i.test(b.text),
    );
    expect(decl).toBeDefined();
  });

  it('offers the commissioner block without implying one is required', () => {
    // Sworn statements are what section 16(2) demands of the ASSOCIATION, not
    // of a character referee. The block is there for the Designated Firearms
    // Officer who asks anyway — it must not read as a step everybody takes.
    const all = textOf(buildCharacterStatement(INPUT, 1).blocks);
    expect(all).toMatch(/only if you have been asked/i);
    expect(all).toMatch(/do not sign above until you are in front of them/i);
    expect(
      buildCharacterStatement(INPUT, 1).blocks.some(
        (b) => b.kind === 'commissioner',
      ),
    ).toBe(true);
  });

  it('keeps the draft marker until an attorney has read the wording', () => {
    // The form quotes the Regulations and warns a member of the public about a
    // criminal offence. The suffix is the only thing that says nobody with a
    // practising certificate has checked it.
    expect(CHARACTER_STATEMENT_VERSION).toMatch(/-draft$/);
  });
});
