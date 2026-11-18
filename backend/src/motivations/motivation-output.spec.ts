import {
  isMotivationOnly,
  isPrintReady,
  normaliseOutputMode,
} from './motivation-output';

describe('the output mode', () => {
  it('defaults to the motivation on its own', () => {
    expect(normaliseOutputMode(undefined)).toBe('MOTIVATION_ONLY');
    expect(normaliseOutputMode('nonsense')).toBe('MOTIVATION_ONLY');
  });

  it('recognises the motivation-only letter', () => {
    expect(normaliseOutputMode('MOTIVATION_ONLY')).toBe('MOTIVATION_ONLY');
    expect(isMotivationOnly('MOTIVATION_ONLY')).toBe(true);
    expect(isPrintReady('MOTIVATION_ONLY')).toBe(false);
  });

  /**
   * ⚠️ THE OLD NAME IS A PACK, NOT A TYPO. Every row written before 2026-11-05
   * holds FULL_PACK and means "this member is getting the annexures"; reading it
   * as motivation-only would take their pack away without asking.
   */
  it('reads the retired full-pack name as print-ready', () => {
    expect(normaliseOutputMode('FULL_PACK')).toBe('PRINT_READY');
  });

  it('recognises print-ready', () => {
    expect(normaliseOutputMode('PRINT_READY')).toBe('PRINT_READY');
    expect(isPrintReady('PRINT_READY')).toBe(true);
    expect(isMotivationOnly('PRINT_READY')).toBe(false);
  });
});
