// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import TrackerStatusBadge, { badgeState } from './TrackerStatusBadge';

// ────────────────────────────────────────────────────────────────────
// TWO AXES, FOUR STATES, AND THEY MUST NOT COLLAPSE INTO EACH OTHER.
//
// A member reads this pill and decides what to do next. "SAPS has no record
// yet" and "we could not read it" are the difference between waiting and
// phoning the DFO — a pill that shows the same grey words for both sends half
// of them to the wrong place.
// ────────────────────────────────────────────────────────────────────

describe('badgeState', () => {
  it('shows a status SAPS printed, in SAPS’s own words', () => {
    expect(badgeState('Approved', 'row').label).toBe('Approved');
    expect(badgeState('Card printed', 'row').colour).toBe('var(--success)');
  });

  it('⚠️ KEEPS A STATUS IT DOES NOT RECOGNISE, RATHER THAN REWORDING IT', () => {
    // A friendlier label for a status nobody here has seen is how a wrong one
    // gets read as ours.
    const tone = badgeState('Awaiting DFO signature', 'row');
    expect(tone.label).toBe('Awaiting DFO signature');
  });

  it('⚠️ "NO RECORD YET" IS NOT AN ERROR AND MUST NOT BE COLOURED LIKE ONE', () => {
    // It is the normal state of an application lodged last week. Red here
    // would have members phoning about a process that is simply still short.
    const tone = badgeState(null, 'no_records');
    expect(tone.label).toBe('SAPS has no record yet');
    expect(tone.colour).not.toBe('var(--red)');
  });

  it('⚠️ AND "WE COULD NOT READ IT" IS NOT THE SAME FACT', () => {
    const noRecords = badgeState(null, 'no_records');
    const blind = badgeState(null, 'error');
    expect(blind.label).not.toBe(noRecords.label);
    expect(blind.label).toBe('We could not read it');
  });

  it('treats never-asked as its own thing again', () => {
    expect(badgeState(null, 'unknown').label).toBe('No status read yet');
    expect(badgeState(undefined, null).label).toBe('No status read yet');
  });

  it('lets a known status outlive a failed last check', () => {
    // The tracker holds last week's status and this morning's failure. The
    // member's question is still "where is my application", so the answer is
    // last week's status — the card carries the blindness, in words.
    expect(badgeState('In preparation', 'error').label).toBe('In preparation');
    expect(badgeState('In preparation', 'error').colour).toBe('var(--gold)');
  });

  it('⚠️ AN ENQUIRY IN FLIGHT IS NOT AN ANSWER OF "NOTHING FOUND"', () => {
    // Every tracker is read the moment it is added. If the pill said "No
    // status read yet" over that enquiry, the member reads a finished verdict
    // we have not been given — and reaches for Check now to fix a problem
    // that does not exist.
    expect(badgeState(null, 'unknown', true).label).toBe('Asking SAPS…');
    expect(badgeState(null, 'unknown', true).label).not.toBe(
      badgeState(null, 'unknown').label,
    );
  });

  it('⚠️ AND RE-ASKING DOES NOT ERASE AN ANSWER WE ALREADY HOLD', () => {
    // "Still asking" outranks nothing: a status SAPS printed, and our own
    // record of not being able to read one, both survive a fresh enquiry.
    expect(badgeState('Approved', 'row', true).label).toBe('Approved');
    expect(badgeState(null, 'no_records', true).label).toBe(
      'SAPS has no record yet',
    );
    expect(badgeState(null, 'error', true).label).toBe('We could not read it');
  });
});

describe('the rendered pill', () => {
  it('puts the meaning in words, not only in colour', () => {
    render(<TrackerStatusBadge status={null} outcome="no_records" />);
    expect(screen.getByText('SAPS has no record yet')).toBeInTheDocument();
  });

  it('renders a status it has never seen without a fallback label', () => {
    render(<TrackerStatusBadge status="Referred back" outcome="row" />);
    expect(screen.getByText('Referred back')).toBeInTheDocument();
    expect(screen.queryByText('No status read yet')).toBeNull();
  });

  it('says it is asking, on the card of a tracker it has just been given', () => {
    render(<TrackerStatusBadge status={null} outcome="unknown" asking />);
    expect(screen.getByText('Asking SAPS…')).toBeInTheDocument();
    expect(screen.queryByText('No status read yet')).toBeNull();
  });
});
