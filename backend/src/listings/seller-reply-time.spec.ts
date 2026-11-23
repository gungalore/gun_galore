import {
  MIN_REPLY_SAMPLES,
  medianMinutes,
  replyLabelFor,
} from './seller-reply-time';

describe('medianMinutes', () => {
  it('returns null for no samples', () => {
    expect(medianMinutes([])).toBeNull();
  });

  it('ignores non-finite and negative values', () => {
    expect(medianMinutes([NaN, -5, Infinity, 10])).toBe(10);
  });

  it('averages the middle pair for an even count', () => {
    expect(medianMinutes([10, 20, 30, 40])).toBe(25);
  });

  it('takes the middle value for an odd count', () => {
    expect(medianMinutes([90, 10, 40])).toBe(40);
  });
});

describe('replyLabelFor', () => {
  it('refuses to promise a time below the sample floor', () => {
    const r = replyLabelFor([5, 6]);
    expect(r.sampleSize).toBe(2);
    expect(MIN_REPLY_SAMPLES).toBe(3);
    expect(r.label).toMatch(/not yet known/i);
  });

  it.each([
    [[5, 10, 20], 'within an hour'],
    [[90, 120, 240], 'within a few hours'],
    [[600, 1_440, 900], 'within a day'],
    [[1_500, 2_880, 2_000], 'within 2 days'],
    [[3_000, 10_080, 5_000], 'within a week'],
    [[20_000, 12_000, 30_000], 'longer than a week'],
  ])('buckets %j as %s', (samples, expected) => {
    expect(replyLabelFor(samples).label).toContain(expected);
  });

  it('uses the median, so one very slow reply does not change the badge', () => {
    expect(replyLabelFor([10, 15, 40_000]).label).toContain('within an hour');
  });
});
