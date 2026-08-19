import {
  REMINDER_STAGES,
  daysUntil,
  dueStage,
  expiryState,
  parseIsoDate,
  toIsoDate,
} from './licence-dates';

// The expiry date is the one value in the Centre that must never be wrong by a
// day: it is what every reminder is computed from, and a reminder on the wrong
// day is worse than no reminder, because the member stops checking themselves.

describe('reading a date off a document', () => {
  it('accepts a real ISO date as UTC midnight', () => {
    const d = parseIsoDate('2026-08-19')!;
    expect(d.toISOString()).toBe('2026-08-19T00:00:00.000Z');
  });

  it('refuses everything that is not exactly yyyy-mm-dd', () => {
    // Each of these is something `new Date()` would happily accept, and every
    // one of them would put a wrong date behind a reminder.
    for (const bad of [
      '2026',
      'March 2026',
      '19/08/2026',
      '2026/08/19',
      '19 Aug 2026',
      'next March',
      '',
      '   ',
      'null',
    ]) {
      expect(parseIsoDate(bad)).toBeNull();
    }
  });

  it('refuses a date that does not exist', () => {
    // Date.UTC rolls 31 February forward to 3 March without complaint. The
    // round-trip check is the only thing that catches it.
    expect(parseIsoDate('2026-02-31')).toBeNull();
    expect(parseIsoDate('2026-13-01')).toBeNull();
    expect(parseIsoDate('2026-00-10')).toBeNull();
    expect(parseIsoDate('2026-04-31')).toBeNull();
  });

  it('keeps a real leap day', () => {
    expect(parseIsoDate('2028-02-29')).not.toBeNull();
    expect(parseIsoDate('2027-02-29')).toBeNull();
  });

  it('refuses a year that has to be a misread', () => {
    expect(parseIsoDate('1823-04-01')).toBeNull();
    expect(parseIsoDate('9999-04-01')).toBeNull();
  });

  it('handles null and undefined without throwing', () => {
    expect(parseIsoDate(null)).toBeNull();
    expect(parseIsoDate(undefined)).toBeNull();
  });

  it('round-trips through toIsoDate', () => {
    expect(toIsoDate(parseIsoDate('2029-12-31')!)).toBe('2029-12-31');
  });
});

describe('counting the days left', () => {
  const now = new Date('2026-08-19T10:00:00.000Z');

  it('counts whole days, rounding down', () => {
    // 1.9 days left is honestly "1 day". Rounding up would have us say two
    // days on the morning of the day before.
    expect(daysUntil(new Date('2026-08-21T08:00:00.000Z'), now)).toBe(1);
    expect(daysUntil(new Date('2026-08-20T10:00:00.000Z'), now)).toBe(1);
  });

  it('goes negative once the date has passed', () => {
    expect(daysUntil(new Date('2026-08-18T10:00:00.000Z'), now)).toBe(-1);
  });
});

describe('how a document reads on the list', () => {
  const now = new Date('2026-08-19T00:00:00.000Z');
  const confirmed = new Date('2026-01-01T00:00:00.000Z');

  it('is UNKNOWN until the member has confirmed the date', () => {
    // The whole safety rail. A date nobody has checked must never show green,
    // because nothing is watching it.
    expect(expiryState(new Date('2030-01-01'), null, now)).toBe('unknown');
    expect(expiryState(null, confirmed, now)).toBe('unknown');
    expect(expiryState(null, null, now)).toBe('unknown');
  });

  it('is VALID well out, EXPIRING inside the first stage, EXPIRED after', () => {
    expect(expiryState(new Date('2030-01-01'), confirmed, now)).toBe('valid');
    expect(expiryState(new Date('2026-10-01'), confirmed, now)).toBe('expiring');
    expect(expiryState(new Date('2026-08-18'), confirmed, now)).toBe('expired');
  });

  it('turns EXPIRED on the day, not the day after', () => {
    // A licence is not valid on a day after the one printed on it.
    expect(
      expiryState(
        new Date('2026-08-19T00:00:00.000Z'),
        confirmed,
        new Date('2026-08-19T23:59:00.000Z'),
      ),
    ).toBe('expired');
  });
});

describe('which reminder is due', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const plus = (days: number) =>
    new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  it('sends nothing while the document is still far out', () => {
    expect(dueStage(plus(400), now, {})).toBeNull();
    expect(dueStage(plus(181), now, {})).toBeNull();
  });

  it('opens at T-180', () => {
    expect(dueStage(plus(180), now, {})).toBe('T180');
    expect(dueStage(plus(150), now, {})).toBe('T180');
  });

  it('walks through the stages as the date closes', () => {
    const sent: Record<string, boolean> = {};
    const seq: string[] = [];
    for (const days of [180, 120, 100, 30, 0]) {
      const s = dueStage(plus(days), now, sent)!;
      seq.push(s);
      sent[s] = true;
    }
    expect(seq).toEqual(['T180', 'T120', 'T100', 'T30', 'D0']);
  });

  it('sends ONE message, not four, for a document added late', () => {
    // Somebody uploads a licence with 25 days left. Firing T-180, T-120,
    // T-100 and T-30 in the same minute is four messages saying one thing.
    expect(dueStage(plus(25), now, {})).toBe('T30');
  });

  it('still catches a document the sweep missed for a week', () => {
    // `lte`, not a band: a box that was down on the exact night must not mean
    // the stage is skipped forever.
    expect(dueStage(plus(95), now, {})).toBe('T100');
  });

  it('never repeats a stage that has already gone out', () => {
    expect(dueStage(plus(150), now, { T180: true })).toBeNull();
    expect(dueStage(plus(110), now, { T180: true })).toBe('T120');
  });

  it('reports the expiry itself, once', () => {
    expect(dueStage(plus(0), now, {})).toBe('D0');
    expect(dueStage(plus(-30), now, { D0: true })).toBeNull();
  });

  it('still says something about a document that expired before it was added', () => {
    // Uploading an already-expired licence should tell them so, not go quiet.
    expect(dueStage(plus(-5), now, {})).toBe('D0');
  });
});

describe('the stage table itself', () => {
  it('runs from furthest out to the day itself', () => {
    expect(REMINDER_STAGES.map((s) => s.days)).toEqual([180, 120, 100, 30, 0]);
  });

  it('gives every stage its own claim column', () => {
    const cols = REMINDER_STAGES.map((s) => s.column);
    expect(new Set(cols).size).toBe(cols.length);
  });
});
