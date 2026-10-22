import { describe, expect, it } from 'vitest';
import {
  pargoDistanceLabel,
  pargoOptionLabel,
  pargoStoreName,
} from './pargo-pickup';

describe('pargoStoreName', () => {
  it('drops Bob Go\'s "Click & Collect" product name', () => {
    expect(
      pargoStoreName('Pargo Click & Collect – Clicks – Pinehurst'),
    ).toBe('Clicks – Pinehurst');
  });

  it('handles "Click and Collect" and a plain pickup-point name', () => {
    expect(pargoStoreName('Pargo Click and Collect - Stor-Age')).toBe(
      'Stor-Age',
    );
    expect(pargoStoreName('Pargo pickup point – Clicks')).toBe('Clicks');
  });

  it('strips a trailing approximate-distance suffix', () => {
    expect(
      pargoStoreName('Pargo – Clicks – Pinehurst (approx. 0.1 km)'),
    ).toBe('Clicks – Pinehurst');
  });

  it('returns an empty string when only the carrier is named', () => {
    expect(pargoStoreName('Pargo pickup point')).toBe('');
    expect(pargoStoreName(null)).toBe('');
  });
});

describe('pargoOptionLabel', () => {
  it('names the store under the Pargo brand', () => {
    expect(pargoOptionLabel('Pargo Click & Collect – Clicks – Pinehurst')).toBe(
      'Pargo – Clicks – Pinehurst',
    );
  });

  it('falls back to a plain carrier label', () => {
    expect(pargoOptionLabel(undefined)).toBe('Pargo pickup point');
  });
});

describe('pargoDistanceLabel', () => {
  it('formats kilometres and the under-100m case', () => {
    expect(pargoDistanceLabel(0.6)).toBe('0.6 km away');
    expect(pargoDistanceLabel(0.05)).toBe('Less than 100 m away');
  });

  it('returns null when the quote carried no distance', () => {
    expect(pargoDistanceLabel(undefined)).toBeNull();
    expect(pargoDistanceLabel(null)).toBeNull();
  });
});
