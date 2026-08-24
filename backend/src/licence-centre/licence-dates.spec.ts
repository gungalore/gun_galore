import {
  EXPIRING_WITHIN_DAYS,
  REMINDER_STAGES,
  withinRenewalWindow,
  competencyLapses,
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

describe('competencyLapses', () => {
  // ⚠️ THIS IS THE FALLBACK, NOT THE RULE — AND THE COMMENT THAT USED TO SIT
  // HERE QUOTED THE UN-AMENDED ACT. It read: 'SECTION 10(2): "A competency
  // certificate lapses after five years from its date of issue." Read from the
  // Act, not recalled.' That IS the original s10(2), and it was replaced by
  // the Firearms Control Amendment Act 28 of 2006, commenced 10 January 2011.
  // The current s10(2) says a competency remains valid for the same period as
  // the LICENCE it relates to — it has no independent lifespan and rolls
  // forward with every grant or renewal in that firearm type.
  //
  // So this arithmetic is right only where a firearm type holds no licence at
  // all (SA Firearm Competency Reference §5.2), and derivedExpiryFor now
  // offers it only to a member with no licence on file. The function stays
  // because the fallback is real; the framing was wrong.
  it('adds five years to the issue date', () => {
    expect(toIsoDate(competencyLapses(new Date('2025-06-06T00:00:00Z')))).toBe(
      '2030-06-06',
    );
  });

  it('⚠️ HANDLES 29 FEBRUARY without inventing a day', () => {
    // 2024-02-29 + 5 years has no 29 February to land on. JavaScript rolls it
    // to 1 March, which is a real date and one day later than a strict reading
    // — close enough for a suggestion the member confirms, and worth knowing
    // rather than discovering.
    expect(toIsoDate(competencyLapses(new Date('2024-02-29T00:00:00Z')))).toBe(
      '2029-03-01',
    );
  });

  it('does not mutate what it is given', () => {
    const issued = new Date('2025-06-06T00:00:00Z');
    competencyLapses(issued);
    expect(toIsoDate(issued)).toBe('2025-06-06');
  });
});

// ────────────────────────────────────────────────────────────────────
// NINETY DAYS, AND WHY IT IS NOT THE SAME NUMBER AS THE RENEWAL OFFER.
//
// The amber threshold was 180 and is now 90 — common practice, and the number
// in the Act: section 24(1) requires the renewal application at least 90 days
// before expiry. But 90 days is the DEADLINE, so a renewal first offered there
// arrives on the last day it can be lodged. The offer therefore keeps its own
// six-month window.
//
// These were one number sharing one meaning. Pinning them apart is the point
// of this block: whichever moves next, the other must not follow silently.
// ────────────────────────────────────────────────────────────────────
describe('the amber line and the renewal offer are different lines', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const confirmed = new Date('2025-01-01T00:00:00.000Z');
  const plus = (days: number) =>
    new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  it('stays green until 90 days out', () => {
    expect(expiryState(plus(120), confirmed, now)).toBe('valid');
    expect(expiryState(plus(91), confirmed, now)).toBe('valid');
  });

  it('turns amber AT 90 days, not before', () => {
    expect(expiryState(plus(90), confirmed, now)).toBe('expiring');
    expect(expiryState(plus(30), confirmed, now)).toBe('expiring');
  });

  it('⚠️ a licence four months out is GREEN but ALREADY offers renewal', () => {
    // The whole reason the two numbers had to come apart. At 120 days the card
    // is calm — nothing is wrong yet — and the renewal is nonetheless on
    // screen, because in 30 days' time it will be too late to start.
    expect(expiryState(plus(120), confirmed, now)).toBe('valid');
    expect(withinRenewalWindow(plus(120), confirmed, now)).toBe(true);
  });

  it('offers renewal from six months out', () => {
    expect(withinRenewalWindow(plus(181), confirmed, now)).toBe(false);
    expect(withinRenewalWindow(plus(180), confirmed, now)).toBe(true);
  });

  it('offers nothing on a date nobody has confirmed', () => {
    // Same safety rail as expiryState: an unconfirmed date is not a date.
    expect(withinRenewalWindow(plus(30), null, now)).toBe(false);
    expect(withinRenewalWindow(null, confirmed, now)).toBe(false);
  });

  it('keeps offering renewal once the date has passed', () => {
    expect(withinRenewalWindow(plus(-10), confirmed, now)).toBe(true);
  });

  it('has the reminder schedule opening EARLIER than amber', () => {
    // T-180 exists so the first word about a renewal is not the amber card.
    expect(REMINDER_STAGES[0].days).toBeGreaterThan(EXPIRING_WITHIN_DAYS);
  });
});
