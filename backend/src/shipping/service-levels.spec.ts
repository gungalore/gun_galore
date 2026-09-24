import {
  DEFAULT_COLLECTION_CUTOFF,
  collectionCutoffFor,
  cutoffHour,
  deliveryDaysFor,
  resolveServiceLevel,
} from './service-levels';

describe('service-levels (static lookup)', () => {
  it('resolves Pargo to its 12:00 pickup-point cut-off', () => {
    expect(collectionCutoffFor('pargo')).toBe('12:00');
    const days = deliveryDaysFor('pargo');
    expect(days.min).toBeGreaterThanOrEqual(1);
    expect(days.max).toBeGreaterThanOrEqual(days.min);
  });

  it('prefers a per-service row over the provider default', () => {
    expect(collectionCutoffFor('tcg')).toBe('15:00');
    expect(collectionCutoffFor('tcg', 'LSP')).toBe('10:30');
    expect(resolveServiceLevel('tcg', 'LSP').sameDay).toBe(true);
  });

  it('falls back to the conservative default for an unmapped provider', () => {
    const info = resolveServiceLevel('some-new-courier', 'XYZ');
    expect(info.collectionCutoff).toBe(DEFAULT_COLLECTION_CUTOFF);
    expect(info.deliveryDaysMax).toBeGreaterThanOrEqual(info.deliveryDaysMin);
  });

  it('is case-insensitive and handles nulls', () => {
    expect(collectionCutoffFor('PARGO')).toBe('12:00');
    expect(collectionCutoffFor(null)).toBe(DEFAULT_COLLECTION_CUTOFF);
    expect(collectionCutoffFor(undefined, null)).toBe(DEFAULT_COLLECTION_CUTOFF);
  });

  it('parses a cutoff to a whole hour, defaulting safely', () => {
    expect(cutoffHour('12:00')).toBe(12);
    expect(cutoffHour('15:30')).toBe(15);
    expect(cutoffHour('garbage')).toBe(14);
    expect(cutoffHour(null)).toBe(14);
    expect(cutoffHour('99:00')).toBe(14);
  });
});
