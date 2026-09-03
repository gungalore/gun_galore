import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUCKETS, PERIODS, defaultBucket, fetchSeries, type Period } from './desk-pulse';

// ────────────────────────────────────────────────────────────────────
// THE WINDOWS THE SERVER ALWAYS ACCEPTED.
//
// 🚨 `type Period` STOPPED AT '90d' WHILE THE COMMENT DIRECTLY ABOVE IT LISTED
// all five resolvePeriod() takes. The cutover map recorded "the legacy
// switcher offers 7d, 30d, 90d, 365d and all time; Pulse offers the first
// three" as work outstanding — and the work was two entries in a union,
// because every fetcher passes the value straight through. A year-on-year or
// all-time read had nowhere to happen for want of a type.
//
// ⚠️ AND THE SUFFIX IS LOAD-BEARING. resolvePeriod falls back to its default
// on anything it does not recognise, so '30' returns a real, plausible chart
// for the wrong window with no error anywhere. Same for bucket.
// ────────────────────────────────────────────────────────────────────

function stub() {
  const spy = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => '[]',
  }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

describe('the period vocabulary matches the server', () => {
  it('offers all five resolvePeriod accepts', () => {
    expect(PERIODS.map((p) => p.value)).toEqual(['7d', '30d', '90d', '365d', 'all']);
  });

  it('every value keeps its suffix exactly', () => {
    // '30' and '30d' are different requests and only one is right; the wrong
    // one is indistinguishable on screen from the right one.
    for (const p of PERIODS) {
      expect(p.value === 'all' || /^\d+d$/.test(p.value)).toBe(true);
    }
  });

  it('labels an all-time read in words, not by stripping a "d"', () => {
    // The header used to read `period.replace('d','') + ' days'`, which
    // renders "Last all days" the moment the fifth option exists.
    const all = PERIODS.find((p) => p.value === 'all');
    expect(all?.label).toBe('All time');
    expect(all?.label).not.toContain('days');
  });
});

describe('the bucket vocabulary matches the server', () => {
  it('offers exactly what resolveBucket accepts', () => {
    expect(BUCKETS.map((b) => b.value)).toEqual(['day', 'week', 'month']);
  });
});

describe('🚨 the default bucket keeps a long window readable', () => {
  it('a year is weekly and all-time is monthly', () => {
    // 365 daily points on a sparkline is a smear; "all" is worse. The chart
    // would still be correct and still be unreadable, which is the kind of
    // wrong nobody files a bug about.
    expect(defaultBucket('365d')).toBe('week');
    expect(defaultBucket('all')).toBe('month');
  });

  it('short windows stay daily', () => {
    for (const p of ['7d', '30d', '90d'] as Period[]) {
      expect(defaultBucket(p)).toBe('day');
    }
  });

  it('every offered period has a default', () => {
    for (const p of PERIODS) {
      expect(BUCKETS.map((b) => b.value)).toContain(defaultBucket(p.value));
    }
  });
});

describe('the series request', () => {
  it('sends both the period and a bucket', async () => {
    const spy = stub();
    await fetchSeries('365d', 'week');
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain('period=365d');
    expect(url).toContain('bucket=week');
  });

  it('supplies the window-appropriate bucket when none is chosen', async () => {
    const spy = stub();
    await fetchSeries('all');
    expect(String(spy.mock.calls[0][0])).toContain('bucket=month');
  });

  it('an explicit choice beats the default', async () => {
    const spy = stub();
    await fetchSeries('all', 'day');
    expect(String(spy.mock.calls[0][0])).toContain('bucket=day');
  });
});
