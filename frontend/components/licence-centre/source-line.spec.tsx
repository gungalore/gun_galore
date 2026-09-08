import { describe, expect, it } from 'vitest';
import { sourceLine } from './source-line';

describe('sourceLine — the string after "from"', () => {
  it('⚠️ NEVER MISSPELLS A MAKE READ OFF A LICENCE', () => {
    // The bug this file exists for. Five owned-firearm rows on one live
    // application read "from mAUSER .30-06 SPRINGFIELD".
    expect(sourceLine('MAUSER .30-06 SPRINGFIELD')).toBe(
      'MAUSER .30-06 SPRINGFIELD',
    );
    expect(sourceLine('CZ 6.35MM BROWNING')).toBe('CZ 6.35MM BROWNING');
    expect(sourceLine('HOWA 6.5MM CREEDMOOR')).toBe('HOWA 6.5MM CREEDMOOR');
    expect(sourceLine('NORDISKE PRECISION 223 REM')).toBe(
      'NORDISKE PRECISION 223 REM',
    );
  });

  it('leaves a title-cased name alone as well', () => {
    // Not every make is shouted. "Howa 6.5mm Creedmoor" is a name too.
    expect(sourceLine('Howa 6.5mm Creedmoor')).toBe('Howa 6.5mm Creedmoor');
  });

  it('still folds a plain sentence, which is what it was written for', () => {
    expect(sourceLine('Your account address')).toBe('your account address');
    expect(sourceLine('Your licence card')).toBe('your licence card');
  });

  it('leaves an already-lower-case string untouched', () => {
    expect(sourceLine('your account cellphone number')).toBe(
      'your account cellphone number',
    );
    // An interior capital, and it already starts lower — nothing to do.
    expect(sourceLine('the ID number from your identity check')).toBe(
      'the ID number from your identity check',
    );
  });

  it('survives empty and whitespace', () => {
    expect(sourceLine('')).toBe('');
    expect(sourceLine('   ')).toBe('');
  });
});
