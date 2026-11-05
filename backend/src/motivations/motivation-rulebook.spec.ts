import { appendRulebook } from './motivation-rulebook';

const RULE = {
  associationName: 'Natshoot (NHSA)',
  code: 'Com13',
  title: '100m, Small-Bore Centre-Fire Rifle Exercise',
  text: 'FIREARMS PERMITTED: All Action Centre-fire Rifles...\nSHOOTING DISTANCE: 100 metres.',
};

const BODY = [
  '1. Introduction',
  '',
  'I am applying.',
  '',
  '10. Association membership and dedicated status',
  '',
  'I am a member of NHSA.',
  '',
  "11. The association's rules for this exercise",
  '',
  'The rules that follow are those my association publishes for this exercise.',
  '',
  '12. Safe storage and transport',
  '',
  'My safe is bolted to the wall.',
].join('\n');

describe('appendRulebook', () => {
  it('inserts the published text after the heading, before the next section', () => {
    const out = appendRulebook(
      BODY,
      "11. The association's rules for this exercise",
      RULE,
    );
    const rulesAt = out.indexOf('FIREARMS PERMITTED');
    const nextAt = out.indexOf('12. Safe storage');
    expect(rulesAt).toBeGreaterThan(out.indexOf('11. The association'));
    expect(rulesAt).toBeLessThan(nextAt);
  });

  // ⚠️ Verbatim, not summarised and not reflowed.
  it('keeps the text exactly as published', () => {
    const out = appendRulebook(
      BODY,
      "11. The association's rules for this exercise",
      RULE,
    );
    expect(out).toContain(RULE.text);
  });

  it('names the source and the exercise', () => {
    const out = appendRulebook(
      BODY,
      "11. The association's rules for this exercise",
      RULE,
    );
    expect(out).toContain('Source: Natshoot (NHSA) exercise rules, Com13');
    expect(out).toContain(RULE.title);
  });

  // A type with no association section must not gain a floating rulebook.
  it('leaves the body untouched when the heading is absent', () => {
    expect(appendRulebook(BODY, "11. The association's rules", RULE)).toBe(BODY);
  });

  it('still appends when the section is last', () => {
    const body = '1. Introduction\n\nHello.\n\n11. The association\'s rules for this exercise\n\nLead-in.';
    const out = appendRulebook(
      body,
      "11. The association's rules for this exercise",
      RULE,
    );
    expect(out).toContain('FIREARMS PERMITTED');
  });
});
