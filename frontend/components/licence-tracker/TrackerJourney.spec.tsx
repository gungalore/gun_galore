// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import TrackerJourney from './TrackerJourney';
import {
  SAPS_STAGES,
  type TrackerEventView,
  type TrackerView,
} from '@/lib/licence-tracker-api';

// ────────────────────────────────────────────────────────────────────
// THE THREE THINGS THIS SCREEN MAY NOT GET WRONG.
//
// 1. It must not print a number it cannot stand behind — no counter without
//    a lodge date, no elapsed figure without two dates.
// 2. It must not place an application on the ladder unless a status SAPS
//    printed puts it there. We are not SAPS and a position is a claim.
// 3. It must not attribute the member's own note to the Service. The
//    "In SAPS's own words" block is the one place on this page where the
//    words are quoted rather than paraphrased, so the filter on it matters
//    more than the wording.
// ────────────────────────────────────────────────────────────────────

function tracker(over: Partial<TrackerView> = {}): TrackerView {
  return {
    id: 't1',
    kind: 'FIREARM_LICENCE',
    label: 'My first .308',
    reference: 'C10167347',
    serial: null,
    submittedOn: null,
    applicationType: null,
    applicationNumber: null,
    calibre: null,
    make: null,
    serialSeen: null,
    status: null,
    statusDate: null,
    sapsUpdatedOn: null,
    lastCheckedAt: null,
    lastOutcome: 'unknown',
    lastError: null,
    createdAt: '2026-09-01T09:00:00.000Z',
    eventCount: 0,
    ...over,
  };
}

function event(over: Partial<TrackerEventView> = {}): TrackerEventView {
  return {
    id: 'e1',
    source: 'SAPS',
    observedAt: '2026-09-20T09:00:00.000Z',
    status: null,
    statusDate: null,
    applicationType: null,
    applicationNumber: null,
    calibre: null,
    make: null,
    serial: null,
    statusDescription: null,
    nextStep: null,
    ...over,
  };
}

/** Where a string sits in the rendered page — the only honest way to assert
 *  order on a list whose items carry no accessible index. */
function positionOf(text: string): number {
  const at = (document.body.textContent ?? '').indexOf(text);
  expect(at, `"${text}" was never rendered`).toBeGreaterThanOrEqual(0);
  return at;
}

describe('the days counter', () => {
  it('counts from the day the member lodged it', () => {
    render(
      <TrackerJourney
        tracker={tracker({ submittedOn: '2026-09-01' })}
        events={[]}
      />,
    );
    // ⚠️ THE DAY AND THE MONTH, NOT THEIR EXACT SPELLING OR PADDING. Node's
    // en-ZA writes this as "01 Sept 2026"; a browser's may write "1 Sep
    // 2026". Pinning either would fail on the ICU this was not written
    // against, while the thing under test — that the date reaches the
    // sentence at all — went unchecked.
    expect(
      screen.getByText(/since you lodged it on/).textContent,
    ).toMatch(/since you lodged it on \d{1,2} Sep\w* 2026/);
  });

  it('⚠️ SHOWS NO NUMBER WHEN THE MEMBER NEVER GAVE A DATE', () => {
    // The alternative — falling back to when we started tracking — prints
    // "1067 days since you lodged it" over a tracker made last week, which
    // answers a different question from the one the label asks.
    render(<TrackerJourney tracker={tracker({ submittedOn: null })} events={[]} />);
    expect(
      screen.getByText(/Add the date you lodged it and we will show how long/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/since you lodged it on/)).toBeNull();
    expect(screen.queryByText(/days/)).toBeNull();
  });
});

describe('the ladder', () => {
  it('renders every rung in the order the ladder declares', () => {
    render(<TrackerJourney tracker={tracker()} events={[]} />);
    for (const stage of SAPS_STAGES) {
      expect(
        screen.getByText(stage.label),
        `${stage.label} is missing from the ladder`,
      ).toBeInTheDocument();
    }
    // A rung out of order is a member reading the path backwards.
    expect(positionOf('Payment received')).toBeLessThan(
      positionOf('Sent to CFR'),
    );
    expect(positionOf('Sent to CFR')).toBeLessThan(
      positionOf('For consideration'),
    );
    expect(positionOf('For consideration')).toBeLessThan(
      positionOf('Card ready for collection'),
    );
  });

  it('marks exactly one "you are here", on the member’s own rung', () => {
    render(
      <TrackerJourney
        tracker={tracker({ status: 'In preparation' })}
        events={[]}
      />,
    );
    expect(screen.getAllByText('you are here')).toHaveLength(1);
    expect(positionOf('you are here')).toBeGreaterThan(
      positionOf('Received at CFR'),
    );
    expect(positionOf('you are here')).toBeLessThan(
      positionOf('In circulation'),
    );
  });

  it('⚠️ MARKS A RUNG "SEEN BEFORE" ONLY ON A STATUS WE ACTUALLY RECORDED', () => {
    // Nothing is inferred from position. Marking every rung below the current
    // one as done would be us deciding the application passed through CFR,
    // which a status line cannot tell us.
    render(
      <TrackerJourney
        tracker={tracker({ status: 'In preparation' })}
        events={[
          event({ id: 'a', status: 'Sent to CFR', statusDate: '2026-09-05' }),
          event({ id: 'b', status: 'In preparation', statusDate: '2026-09-20' }),
        ]}
      />,
    );
    expect(screen.getAllByText('seen before')).toHaveLength(1);
    // ⚠️ ASSERTED ON THE RUNG IT SITS IN, NOT ON A TEXT OFFSET. The current
    // status is also printed by the badge above the ladder, so "where is the
    // word 'In preparation'" finds the badge and reads the ladder backwards.
    const tagged = screen.getByText('seen before').closest('li');
    expect(tagged?.textContent).toContain('Sent to CFR');
    expect(tagged?.textContent).not.toContain('Received at CFR');
  });

  it('⚠️ NEVER PLACES A STATUS IT DOES NOT RECOGNISE', () => {
    render(
      <TrackerJourney
        tracker={tracker({ status: 'Referred back to the DFO for signature' })}
        events={[]}
      />,
    );
    expect(
      screen.getByText(/not on this path/),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Referred back to the DFO for signature', {
        selector: 'strong',
      }),
    ).toBeInTheDocument();
    // A guessed rung would be us saying where the file is.
    expect(screen.queryByText('you are here')).toBeNull();
  });

  it('⚠️ LIFTS A TERMINAL STATUS OUT OF THE LADDER', () => {
    // Drawing a refusal beside "Approved" reads as a later stage of one.
    render(
      <TrackerJourney tracker={tracker({ status: 'Refused' })} events={[]} />,
    );
    expect(screen.getByText(/SAPS refused the application/)).toBeInTheDocument();
    expect(screen.queryByText('you are here')).toBeNull();
  });

  it('says the path is the usual order and not a decision', () => {
    render(<TrackerJourney tracker={tracker()} events={[]} />);
    expect(screen.getByText(/usually follow/)).toBeInTheDocument();
    expect(screen.getByText(/we are not SAPS/)).toBeInTheDocument();
  });
});

describe('SAPS in its own words', () => {
  const SAID = /In SAPS.s own words/;

  it('quotes the status description and the next step verbatim', () => {
    render(
      <TrackerJourney
        tracker={tracker({ status: 'Sent to CFR' })}
        events={[
          event({
            status: 'Sent to CFR',
            statusDescription: 'Application sent to CFR for consideration.',
            nextStep: 'You will be notified by the CFR.',
          }),
        ]}
      />,
    );
    expect(screen.getByText(SAID)).toBeInTheDocument();
    // The quote block and the timeline row both carry these, which is the
    // summary-then-detail shape the page is meant to have — so getAllByText
    // rather than an exact single match.
    expect(
      screen.getAllByText('Application sent to CFR for consideration.')
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText('You will be notified by the CFR.').length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/Next step:/)).toBeInTheDocument();
  });

  it('⚠️ NEVER PRINTS THE MEMBER’S OWN NOTE UNDER SAPS’S NAME', () => {
    // The milestone form has a "what happens next" box, so a MEMBER row can
    // carry a nextStep. Searching every row for the newest one would quote
    // the member back to themselves as though the Service had said it.
    render(
      <TrackerJourney
        tracker={tracker()}
        events={[
          event({
            id: 'member',
            source: 'MEMBER',
            observedAt: '2026-09-25T09:00:00.000Z',
            nextStep: 'I must phone the DFO on Monday.',
            statusDescription: 'Handed in at the DFO',
          }),
        ]}
      />,
    );
    expect(screen.queryByText(SAID)).toBeNull();
    // The note itself still appears — on the member's own row, under "You
    // noted". It is the attribution that must not move.
    expect(screen.getByText('You noted')).toBeInTheDocument();
    expect(
      screen.queryByText(/Next step: I must phone the DFO on Monday\./),
    ).toBeNull();
  });

  it('shows nothing at all rather than an empty quotation', () => {
    render(
      <TrackerJourney
        tracker={tracker()}
        events={[event({ status: 'Approved' })]}
      />,
    );
    expect(screen.queryByText(SAID)).toBeNull();
  });
});

describe('the history below it', () => {
  it('renders the timeline, so the journey is one screen and not two', () => {
    render(
      <TrackerJourney
        tracker={tracker({ submittedOn: '2026-09-01' })}
        events={[event({ status: 'Approved' })]}
      />,
    );
    expect(screen.getByText('History')).toBeInTheDocument();
    expect(screen.getByText('SAPS enquiry')).toBeInTheDocument();
  });
});
