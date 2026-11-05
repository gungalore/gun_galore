import { isMotivationOnly, normaliseOutputMode } from './motivation-output';

describe('the output mode', () => {
  it('defaults to the complete pack', () => {
    expect(normaliseOutputMode(undefined)).toBe('FULL_PACK');
    expect(normaliseOutputMode('nonsense')).toBe('FULL_PACK');
  });

  it('recognises the motivation-only letter', () => {
    expect(normaliseOutputMode('MOTIVATION_ONLY')).toBe('MOTIVATION_ONLY');
    expect(isMotivationOnly('MOTIVATION_ONLY')).toBe(true);
    expect(isMotivationOnly('FULL_PACK')).toBe(false);
  });
});
