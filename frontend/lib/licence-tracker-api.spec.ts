import { describe, expect, it } from 'vitest';
import {
  daysSince,
  formatDay,
  formatDays,
  formatWhen,
  journey,
  kindLabel,
  observations,
  retryMessage,
  SAPS_STAGES,
  stageFor,
  statusTone,
  terminalFor,
  trackerLabel,
  type TrackerEventView,
} from './licence-tracker-api';

// ────────────────────────────────────────────────────────────────────
// THE PURE HALF OF THE TRACKER — the part a screenshot cannot check.
//
// Everything here has exactly one job: not to tell the member something
// SAPS did not say. A status we do not recognise keeps its own words, an
// empty status is not an empty string on screen, and a DATE SAPS PRINTED
// never moves to another day on the way to the screen.
// ────────────────────────────────────────────────────────────────────

describe('trackerLabel', () => {
  it('prefers the member’s own name for the application', () => {
    expect(
      trackerLabel({
        label: 'My first .308',
        applicationNumber: '10220741',
        reference: 'C10167347',
      }),
    ).toBe('My first .308');
  });

  it('⚠️ FALLS THROUGH IN ONE ORDER: label, application number, reference', () => {
    // The reference is LAST for a reason — it is the number the member typed
    // off a receipt, and a list of eight of them is the least readable
    // version of this screen. The application number is SAPS's own id for
    // the file and is what a DFO would recognise.
    expect(
      trackerLabel({
        label: null,
        applicationNumber: '10220741',
        reference: 'C10167347',
      }),
    ).toBe('10220741');
    expect(
      trackerLabel({
        label: '   ',
        applicationNumber: null,
        reference: 'C10167347',
      }),
    ).toBe('C10167347');
  });

  it('never renders blank when it has been given nothing', () => {
    expect(trackerLabel({})).toBe('Your application');
    expect(trackerLabel({ label: '', applicationNumber: '', reference: '' })).toBe(
      'Your application',
    );
  });
});

describe('kindLabel', () => {
  it('names the three kinds', () => {
    expect(kindLabel('COMPETENCY')).toBe('Competency');
    expect(kindLabel('FIREARM_LICENCE')).toBe('Firearm licence');
    expect(kindLabel('RENEWAL')).toBe('Renewal');
  });

  it('shows an unknown kind verbatim rather than guessing', () => {
    // A kind added to the enum after this bundle shipped. "Application" would
    // be a friendlier label and a wrong one; the raw value is at least true.
    expect(kindLabel('PERMIT')).toBe('PERMIT');
  });
});

describe('statusTone', () => {
  it('maps a status SAPS prints onto its own tone', () => {
    expect(statusTone('Approved').label).toBe('Approved');
    expect(statusTone('approved').label).toBe('Approved');
    expect(statusTone('Refused').colour).toBe('var(--red)');
    expect(statusTone('Card ready for collection').colour).toBe(
      'var(--success)',
    );
  });

  it('⚠️ KEEPS AN UNRECOGNISED STATUS IN ITS OWN WORDS', () => {
    // Inventing a friendlier label for a status nobody has seen is how a
    // wrong one gets read as ours. The raw string is the honest answer.
    const tone = statusTone('Referred back to the DFO for signature');
    expect(tone.label).toBe('Referred back to the DFO for signature');
    expect(tone.colour).toBe('var(--gold)');
  });

  it('treats no status at all as unread, not as a blank pill', () => {
    for (const empty of [null, undefined, '', '   ']) {
      expect(statusTone(empty).label).toBe('No status read yet');
      expect(statusTone(empty).wash).toBe('transparent');
    }
  });
});

describe('observations', () => {
  function ev(id: string, observedAt: string, source: 'SAPS' | 'MEMBER') {
    return {
      id,
      source,
      observedAt,
      status: null,
      statusDate: null,
      applicationType: null,
      applicationNumber: null,
      calibre: null,
      make: null,
      serial: null,
      statusDescription: null,
      nextStep: null,
    } satisfies TrackerEventView;
  }

  it('⚠️ ORDERS BY THE INSTANT EACH ROW DESCRIBES, NOT BY WHEN IT ARRIVED', () => {
    // The bug this exists for. SAPS rows are written in poll order, which is
    // also newest-first, so insertion order happened to look right — until a
    // member backdated a milestone ("handed in at the DFO on the 3rd") and it
    // sat at the top of a list it belongs in the middle of.
    const rows = [
      ev('saps-new', '2026-09-20T09:00:00.000Z', 'SAPS'),
      ev('saps-old', '2026-09-10T09:00:00.000Z', 'SAPS'),
      ev('member-backdated', '2026-09-03T09:00:00.000Z', 'MEMBER'),
    ];
    expect(observations(rows).map((r) => r.id)).toEqual([
      'saps-new',
      'saps-old',
      'member-backdated',
    ]);
  });

  it('interleaves the two streams by instant', () => {
    const rows = [
      ev('a', '2026-09-01T09:00:00.000Z', 'SAPS'),
      ev('c', '2026-09-20T09:00:00.000Z', 'SAPS'),
      ev('b', '2026-09-10T09:00:00.000Z', 'MEMBER'),
    ];
    expect(observations(rows).map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('leaves the caller’s array alone', () => {
    // The page holds the response in state; a sort in place would reorder it
    // under React without a re-render.
    const rows = [
      ev('old', '2026-09-01T09:00:00.000Z', 'SAPS'),
      ev('new', '2026-09-20T09:00:00.000Z', 'SAPS'),
    ];
    observations(rows);
    expect(rows.map((r) => r.id)).toEqual(['old', 'new']);
  });

  it('handles an empty history', () => {
    expect(observations([])).toEqual([]);
  });
});

describe('formatDay', () => {
  it('⚠️ NEVER SHIFTS A DATE SAPS PRINTED INTO ANOTHER DAY', () => {
    // The server stores these as `Date.UTC(y, m-1, d)` — midnight UTC,
    // because the enquiry prints a calendar date and there is no time of day
    // to keep. Read back in the viewer's local zone, midnight UTC is the
    // PREVIOUS DAY anywhere west of Greenwich: a 12 September status line
    // read "11 Sep 2026" to a member in New York.
    //
    // ⚠️ THE DAY NUMBER IS THE ASSERTION; the month's spelling is not. Node's
    // en-ZA writes September as "Sept", a browser's may write "Sep", and a
    // test that pinned the abbreviation would fail on the ICU it was not
    // written against while the actual bug — the shifted day — went unnoticed.
    expect(formatDay('2026-09-12T00:00:00.000Z')).toMatch(/^12 Sep/);
    expect(formatDay('2026-09-12T00:00:00.000Z')).toMatch(/2026$/);
    expect(formatDay('2026-09-12T00:00:00.000Z')).not.toMatch(/^11 /);
    // The same date written without a time, which is what the parser yields
    // before it is stored.
    expect(formatDay('2026-09-12')).toMatch(/^12 Sep/);
  });

  it('shows a dash when there is no date, and the raw string when it is unreadable', () => {
    expect(formatDay(null)).toBe('—');
    expect(formatDay('not a date')).toBe('not a date');
  });
});

describe('formatWhen', () => {
  it('carries the time, because this is when we actually looked', () => {
    const out = formatWhen('2026-09-12T09:30:00.000Z');
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/:/);
  });

  it('shows a dash when we never looked', () => {
    expect(formatWhen(null)).toBe('—');
  });
});

describe('retryMessage', () => {
  it('⚠️ NAMES THE MOMENT RATHER THAN SAYING "LATER"', () => {
    // "Try again later" on a screen whose whole purpose is the wait is the
    // least useful sentence available, and the server already sends the
    // instant. Read at 09:00 and again at 15:00, "in 6 hours" would also
    // already be wrong.
    const out = retryMessage('2026-09-12T15:30:00.000Z');
    expect(out).toContain('2026');
    expect(out).toMatch(/ask again after/i);
    expect(out).not.toMatch(/later\.$/);
  });

  it('falls back to the plain sentence when the server sent no usable instant', () => {
    const fallback =
      'We checked SAPS for this application recently. Please try again later.';
    expect(retryMessage(null)).toBe(fallback);
    expect(retryMessage('')).toBe(fallback);
    expect(retryMessage('soon')).toBe(fallback);
  });
});

// ────────────────────────────────────────────────────────────────────
// THE JOURNEY — the days counter, the ladder, and the elapsed figure.
//
// ⚠️ EVERY TEST BELOW IS ABOUT A NUMBER OR A POSITION WE ARE PUTTING IN
// FRONT OF SOMEBODY AS A FACT ABOUT THEIR APPLICATION. A wrong one here is
// not a cosmetic bug: it is us telling a member their file moved when it did
// not, or how long a step took when we measured the wrong two dates.
// ────────────────────────────────────────────────────────────────────

describe('daysSince', () => {
  /** A local instant, because "today" is the member's own day. */
  const on = (y: number, m: number, d: number, h = 12, min = 0) =>
    new Date(y, m - 1, d, h, min, 0);

  it('counts whole days from the day the member lodged it', () => {
    expect(daysSince('2026-09-01', on(2026, 9, 11))).toBe(10);
    // The same date as the server stores it: midnight UTC standing for a
    // calendar date. Read in the viewer's zone that instant is the previous
    // day anywhere west of Greenwich, which would have made this 11.
    expect(daysSince('2026-09-01T00:00:00.000Z', on(2026, 9, 11))).toBe(10);
  });

  it('is zero on the day itself, not one', () => {
    expect(daysSince('2026-09-11', on(2026, 9, 11))).toBe(0);
  });

  it('⚠️ READS "TODAY" IN THE MEMBER’S OWN ZONE, NOT IN UTC', () => {
    // At 00:30 in Johannesburg it is still the 10th in London; counting to
    // London's day would lose a member one day every morning before 02:00.
    // Same local date, either end of the clock, must give the same answer.
    expect(daysSince('2026-09-01', on(2026, 9, 11, 0, 30))).toBe(
      daysSince('2026-09-01', on(2026, 9, 11, 23, 0)),
    );
  });

  it('⚠️ A DATE IN THE FUTURE IS ZERO, NEVER A NEGATIVE WAIT', () => {
    // A member who mistyped the year must not be shown "-1 460 days since
    // you lodged it". They can edit the date; until they do, the honest
    // figure is none at all.
    expect(daysSince('2030-06-30', on(2026, 9, 11))).toBe(0);
  });

  it('has no answer when there is no usable date', () => {
    // ⚠️ NULL, NOT ZERO. The card and the journey both branch on this: with
    // a number we cannot stand behind we say nothing rather than "0 days
    // since you lodged it".
    expect(daysSince(null, on(2026, 9, 11))).toBeNull();
    expect(daysSince('not a date', on(2026, 9, 11))).toBeNull();
  });
});

describe('formatDays', () => {
  it('says "1 day", because "1 days" is on the figure read first', () => {
    expect(formatDays(1)).toBe('1 day');
    expect(formatDays(0)).toBe('0 days');
    expect(formatDays(2)).toBe('2 days');
  });

  it('writes a long count without a thousands separator', () => {
    // `toLocaleString` puts a comma or a space or a full stop here depending
    // on the ICU build. A day count is not the place to find that out.
    expect(formatDays(1067)).toBe('1067 days');
  });
});

describe('stageFor', () => {
  it('places a status SAPS prints, whatever its casing and padding', () => {
    expect(stageFor('Approved')).toBe(stageFor('approved'));
    expect(stageFor('  SENT TO CFR  ')).toBe(stageFor('sent to cfr'));
    expect(stageFor('For consideration')).not.toBeNull();
  });

  it('follows the order the ladder declares', () => {
    // SAPS moves forwards through this list, so the index has to increase.
    expect(stageFor('payment received')!).toBeLessThan(stageFor('sent to cfr')!);
    expect(stageFor('sent to cfr')!).toBeLessThan(stageFor('approved')!);
    expect(stageFor('approved')!).toBeLessThan(
      stageFor('card ready for collection')!,
    );
  });

  it('⚠️ RETURNS NULL FOR A STATUS NOBODY HAS SEEN', () => {
    // A position on this ladder is itself a claim about where the
    // application is. A status we do not have a rung for gets its own
    // sentence naming the raw text, never a guessed position.
    expect(stageFor('Referred back to the DFO for signature')).toBeNull();
  });

  it('⚠️ DOES NOT PLACE A TERMINAL STATUS ON THE LADDER', () => {
    // A refusal is not a later stage of an approval, and drawing it beside
    // "Approved" would read as one.
    expect(stageFor('refused')).toBeNull();
    expect(stageFor('Cancelled')).toBeNull();
  });

  it('has no position for no status at all', () => {
    expect(stageFor(null)).toBeNull();
    expect(stageFor(undefined)).toBeNull();
    expect(stageFor('   ')).toBeNull();
  });

  it('keeps the ladder’s own keys unique and lower-cased', () => {
    // `stageFor` matches on the lower-cased string; two rungs sharing a key
    // would make the match silently pick the first and never mark the other.
    const keys = SAPS_STAGES.map((s) => s.status);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toBe(key.toLowerCase());
    for (const s of SAPS_STAGES) {
      expect(s.label.trim().length).toBeGreaterThan(0);
      expect(s.blurb.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('terminalFor', () => {
  it('names the two statuses that end the process', () => {
    expect(terminalFor('Refused')?.label).toBe('Refused');
    expect(terminalFor('cancelled')?.label).toBe('Cancelled');
  });

  it('is null for a status that is merely on the way', () => {
    expect(terminalFor('approved')).toBeNull();
    expect(terminalFor('in preparation')).toBeNull();
    expect(terminalFor(null)).toBeNull();
  });
});

describe('journey', () => {
  function ev(
    id: string,
    observedAt: string,
    source: 'SAPS' | 'MEMBER',
    statusDate: string | null = null,
    status: string | null = null,
  ): TrackerEventView {
    return {
      id,
      source,
      observedAt,
      status,
      statusDate,
      applicationType: null,
      applicationNumber: null,
      calibre: null,
      make: null,
      serial: null,
      statusDescription: null,
      nextStep: null,
    } satisfies TrackerEventView;
  }

  it('measures the oldest row against the day the member lodged it', () => {
    const steps = journey(
      [ev('a', '2026-09-05T09:00:00.000Z', 'SAPS', '2026-09-05')],
      '2026-09-01',
    );
    expect(steps).toHaveLength(1);
    expect(steps[0].elapsedDays).toBe(4);
    expect(steps[0].basis).toBe('lodged');
  });

  it('⚠️ SAYS NOTHING WHEN THE MEMBER NEVER GAVE A LODGE DATE', () => {
    // Falling back to when we started tracking would answer a different
    // question from the one the label asks.
    const steps = journey(
      [ev('a', '2026-09-05T09:00:00.000Z', 'SAPS', '2026-09-05')],
      null,
    );
    expect(steps[0].elapsedDays).toBeNull();
    expect(steps[0].basis).toBeNull();
  });

  it('⚠️ PREFERS SAPS’S OWN STATUS DATES OVER WHEN WE HAPPENED TO LOOK', () => {
    // The case the basis exists for. We observed these two rows a day apart,
    // but SAPS printed status dates nine days apart — with a weekly sweep,
    // measuring on our own stamps would report the step as taking one day
    // when the file actually sat for nine.
    const steps = journey(
      [
        ev('a', '2026-09-01T09:00:00.000Z', 'SAPS', '2026-09-01'),
        ev('b', '2026-09-02T09:00:00.000Z', 'SAPS', '2026-09-10'),
      ],
      '2026-08-25',
    );
    const b = steps.find((s) => s.event.id === 'b')!;
    expect(b.elapsedDays).toBe(9);
    expect(b.basis).toBe('saps');
  });

  it('falls back to our own stamps when a row carries no status date', () => {
    // A MEMBER milestone has no SAPS date at all, so the only measurable
    // span is between the two instants we recorded.
    const steps = journey(
      [
        ev('a', '2026-09-01T09:00:00.000Z', 'SAPS', '2026-09-01'),
        ev('b', '2026-09-04T09:00:00.000Z', 'MEMBER'),
      ],
      null,
    );
    const b = steps.find((s) => s.event.id === 'b')!;
    expect(b.elapsedDays).toBe(3);
    expect(b.basis).toBe('seen');
  });

  it('⚠️ NEVER PRINTS A NEGATIVE WAIT WHEN A STATUS DATE GOES BACKWARDS', () => {
    // A correction, a repeat, or a parser reading a date off the wrong row.
    // "-10 days after the previous status SAPS printed" is not a sentence
    // this screen may print; it falls back to what it can measure.
    const steps = journey(
      [
        ev('a', '2026-09-20T09:00:00.000Z', 'SAPS', '2026-09-20'),
        ev('b', '2026-09-25T09:00:00.000Z', 'SAPS', '2026-09-10'),
      ],
      null,
    );
    const b = steps.find((s) => s.event.id === 'b')!;
    expect(b.elapsedDays).toBe(5);
    expect(b.basis).toBe('seen');
    expect(b.elapsedDays).toBeGreaterThanOrEqual(0);
  });

  it('returns the same newest-first order the timeline prints', () => {
    const rows = [
      ev('old', '2026-09-01T09:00:00.000Z', 'SAPS', '2026-09-01'),
      ev('new', '2026-09-20T09:00:00.000Z', 'SAPS', '2026-09-20'),
      ev('mid', '2026-09-10T09:00:00.000Z', 'SAPS', '2026-09-10'),
    ];
    expect(journey(rows, null).map((s) => s.event.id)).toEqual([
      'new',
      'mid',
      'old',
    ]);
    // ⚠️ And it must agree with the timeline it is printed beside, which
    // sorts with `observations`.
    expect(journey(rows, null).map((s) => s.event.id)).toEqual(
      observations(rows).map((r) => r.id),
    );
  });

  it('⚠️ LEAVES THE CALLER’S ARRAY ALONE', () => {
    // The page holds the response in state, and `journey` reverses a copy.
    const rows = [
      ev('old', '2026-09-01T09:00:00.000Z', 'SAPS'),
      ev('new', '2026-09-20T09:00:00.000Z', 'SAPS'),
    ];
    journey(rows, null);
    expect(rows.map((r) => r.id)).toEqual(['old', 'new']);
  });

  it('handles an empty history', () => {
    expect(journey([], '2026-09-01')).toEqual([]);
  });
});
