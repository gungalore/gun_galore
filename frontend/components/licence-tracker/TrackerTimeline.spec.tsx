// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import TrackerTimeline, { elapsedWord } from './TrackerTimeline';
import type { TrackerEventView } from '@/lib/licence-tracker-api';

// ────────────────────────────────────────────────────────────────────
// THE ORDER OF THE HISTORY IS THE WHOLE POINT OF THE HISTORY.
//
// SAPS rows arrive newest-first only because that is the order we polled
// them in. The moment a member backdates a milestone — "handed in at the DFO
// on the 3rd" — insertion order stops being chronological, and a timeline in
// the wrong order is a member reading a decision backwards.
// ────────────────────────────────────────────────────────────────────

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

describe('Ordering', () => {
  it('prints the newest observation first', () => {
    render(
      <TrackerTimeline
        submittedOn={null}
        events={[
          event({ id: 'a', observedAt: '2026-09-01T09:00:00.000Z', status: 'In preparation' }),
          event({ id: 'b', observedAt: '2026-09-20T09:00:00.000Z', status: 'Card printed' }),
        ]}
      />,
    );
    expect(positionOf('Card printed')).toBeLessThan(positionOf('In preparation'));
  });

  it('⚠️ PLACES A BACKDATED MILESTONE BY ITS DATE, NOT BY WHEN IT WAS TYPED', () => {
    // The row below was the LAST one written and describes the EARLIEST
    // event. Sorted by arrival it would sit at the top, above the status it
    // preceded.
    render(
      <TrackerTimeline
        submittedOn={null}
        events={[
          event({ id: 'new', observedAt: '2026-09-20T09:00:00.000Z', status: 'Card printed' }),
          event({ id: 'old', observedAt: '2026-09-10T09:00:00.000Z', status: 'In preparation' }),
          event({
            id: 'member',
            source: 'MEMBER',
            observedAt: '2026-09-03T09:00:00.000Z',
            statusDescription: 'Handed in at the DFO',
          }),
        ]}
      />,
    );
    expect(positionOf('Card printed')).toBeLessThan(positionOf('In preparation'));
    expect(positionOf('In preparation')).toBeLessThan(
      positionOf('Handed in at the DFO'),
    );
  });

  it('⚠️ PRINTS THE SUBMISSION ROW LAST, AS THE OLDEST ENTRY', () => {
    // It seeds the history. It is also the only row that is the member's
    // claim rather than something we read, which is why it is worded "You".
    render(
      <TrackerTimeline
        submittedOn="2026-08-01"
        events={[
          event({ id: 'a', observedAt: '2026-09-01T09:00:00.000Z', status: 'In preparation' }),
        ]}
      />,
    );
    expect(positionOf('In preparation')).toBeLessThan(
      positionOf('You lodged this application.'),
    );
  });
});

describe('the two sources are named, and never confused', () => {
  it('attributes a SAPS row to the enquiry', () => {
    render(
      <TrackerTimeline
        submittedOn={null}
        events={[event({ status: 'Approved', statusDescription: 'Approved' })]}
      />,
    );
    expect(screen.getByText('SAPS enquiry')).toBeInTheDocument();
    expect(screen.queryByText('You noted')).toBeNull();
  });

  it('attributes a milestone to the member, never to SAPS', () => {
    render(
      <TrackerTimeline
        submittedOn={null}
        events={[
          event({
            source: 'MEMBER',
            statusDescription: 'Booked my competency interview',
          }),
        ]}
      />,
    );
    expect(screen.getByText('You noted')).toBeInTheDocument();
    // A member's own note read as a SAPS statement is the one mis-attribution
    // this screen cannot make.
    expect(screen.queryByText('SAPS enquiry')).toBeNull();
  });

  it('carries the next step and the status date when SAPS gives them', () => {
    render(
      <TrackerTimeline
        submittedOn={null}
        events={[
          event({
            status: 'Sent to CFR',
            nextStep: 'Wait for the CFR decision.',
            statusDate: '2026-09-12T00:00:00.000Z',
          }),
        ]}
      />,
    );
    expect(screen.getByText(/Wait for the CFR decision\./)).toBeInTheDocument();
    // ⚠️ THE DAY, NOT THE PREVIOUS DAY. Midnight UTC rendered locally is the
    // 11th west of Greenwich; the SAPS date is a calendar date.
    expect(screen.getByText(/Status date 12 Sep/)).toBeInTheDocument();
  });
});

describe('what we cannot show', () => {
  it('says so plainly when SAPS has told us nothing yet', () => {
    render(<TrackerTimeline submittedOn={null} events={[]} />);
    expect(
      screen.getByText(/We have not read SAPS for this application yet/),
    ).toBeInTheDocument();
  });

  it('⚠️ ADMITS THAT NOTHING BEFORE THE FIRST CHECK CAN BE RECOVERED', () => {
    // Without this line the three rows on screen read as the whole life of an
    // application that may have been lodged months earlier.
    render(
      <TrackerTimeline
        submittedOn="2026-03-01"
        events={[event({ status: 'Approved' })]}
      />,
    );
    expect(
      screen.getByText(/we cannot[\s\S]*show you anything from before the first/),
    ).toBeInTheDocument();
  });
});

describe('how long each step took', () => {
  it('⚠️ NAMES THE BASIS IN THE SENTENCE, NOT IN A FOOTNOTE', () => {
    // "447 days after the previous status SAPS printed" and "447 days after
    // the previous one we saw" are different claims, and the member is
    // entitled to know which one they are reading — especially on the row
    // where a slow poll makes ours the bigger number.
    expect(elapsedWord(447, 'saps')).toBe(
      '447 days after the previous status SAPS printed',
    );
    expect(elapsedWord(447, 'seen')).toBe(
      '447 days after the previous one we saw',
    );
    expect(elapsedWord(447, 'lodged')).toBe('447 days after you lodged it');
  });

  it('writes "1 day" rather than "1 days"', () => {
    expect(elapsedWord(1, 'saps')).toBe(
      '1 day after the previous status SAPS printed',
    );
  });

  it('⚠️ MEASURES ON SAPS’S OWN DATES, NOT ON WHEN WE LOOKED', () => {
    // Polled a day apart, moved nine days apart. The weekly sweep makes this
    // the normal case, not an edge one.
    render(
      <TrackerTimeline
        submittedOn={null}
        events={[
          event({
            id: 'a',
            observedAt: '2026-09-01T09:00:00.000Z',
            statusDate: '2026-09-01T00:00:00.000Z',
            status: 'Sent to CFR',
          }),
          event({
            id: 'b',
            observedAt: '2026-09-02T09:00:00.000Z',
            statusDate: '2026-09-10T00:00:00.000Z',
            status: 'In preparation',
          }),
        ]}
      />,
    );
    const line = screen.getByText(
      '9 days after the previous status SAPS printed',
    );
    expect(line.closest('li')?.textContent).toContain('In preparation');
  });

  it('falls back to our own stamps, and says that is what it did', () => {
    render(
      <TrackerTimeline
        submittedOn={null}
        events={[
          event({
            id: 'a',
            observedAt: '2026-09-01T09:00:00.000Z',
            statusDate: '2026-09-01T00:00:00.000Z',
            status: 'Sent to CFR',
          }),
          event({
            id: 'b',
            source: 'MEMBER',
            observedAt: '2026-09-04T09:00:00.000Z',
            statusDescription: 'Phoned the DFO',
          }),
        ]}
      />,
    );
    expect(
      screen.getByText('3 days after the previous one we saw'),
    ).toBeInTheDocument();
  });

  it('anchors the oldest row to the day the member lodged it', () => {
    render(
      <TrackerTimeline
        submittedOn="2026-09-01"
        events={[
          event({
            statusDate: '2026-09-05T00:00:00.000Z',
            status: 'Sent to CFR',
          }),
        ]}
      />,
    );
    expect(
      screen.getByText('4 days after you lodged it'),
    ).toBeInTheDocument();
    // ⚠️ ONCE. The submission row that seeds the history has nothing before
    // it, so it carries no span of its own.
    expect(screen.getAllByText(/after you lodged it/)).toHaveLength(1);
  });

  it('⚠️ PRINTS NOTHING WHERE NOTHING CAN BE MEASURED', () => {
    // An em dash here would read as a step that took no time, which is a
    // different and wrong statement.
    render(
      <TrackerTimeline
        submittedOn={null}
        events={[event({ statusDate: '2026-09-05T00:00:00.000Z', status: 'Sent to CFR' })]}
      />,
    );
    expect(screen.queryByText(/after the previous/)).toBeNull();
    expect(screen.queryByText(/after you lodged it/)).toBeNull();
  });
});
