// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import CoalGauge from './CoalGauge';

/**
 * THE BENCH — the sentence that says whether a round will chamber.
 *
 * 🚨 THIS IS THE SURFACE THAT TELLS A RELOADER A ROUND IS OVER THE MAXIMUM, and
 * until this file existed nothing tested it. The audit found it printing
 * "0.00 mm under the maximum · check" for a round that is OVER: the check
 * rounded the difference to two places and then tested its sign, and a COAL a
 * hair past the ceiling rounds to `-0`, which is not less than zero.
 *
 * The boundaries below are the real ones for 6,5 Creedmoor — L6 71.76 mm — and
 * the half-millimetre warning band that goes with it.
 */

/** 6,5 Creedmoor's maximum cartridge length, in millimetres. */
const L6 = 71.76;

function gauge(coalMm: number) {
  render(<CoalGauge units="metric" coalMm={coalMm} maxLengthMm={L6} />);
}

describe('the verdict at the boundaries', () => {
  it('is quiet with 0.56 mm of clearance', () => {
    gauge(71.2);
    expect(screen.getByText('0.56 mm under the maximum')).toBeInTheDocument();
  });

  it('says check inside the half-millimetre band', () => {
    gauge(71.3);
    expect(screen.getByText('0.46 mm under the maximum · check')).toBeInTheDocument();
  });

  it('says check at exactly the maximum', () => {
    gauge(L6);
    expect(screen.getByText('0.00 mm under the maximum · check')).toBeInTheDocument();
  });

  it('says over for a round past the maximum', () => {
    gauge(71.9);
    expect(screen.getByText('0.14 mm over the maximum')).toBeInTheDocument();
  });

  /**
   * 🚨 THE `-0` CASE, WHICH IS THE WHOLE REASON THIS FILE EXISTS. A tenth of a
   * hundredth over the maximum rounds to `-0`; `-0 < 0` is false, so the sign
   * test called it under and printed a reassuring "0.00 mm under the maximum"
   * over a round that will not chamber.
   */
  it('says OVER, not under, for a round a hair past the maximum', () => {
    gauge(71.7601);
    expect(screen.getByText('0.00 mm over the maximum')).toBeInTheDocument();
    expect(screen.queryByText(/under the maximum/)).toBeNull();
  });
});

describe('what the gauge is measured against', () => {
  it('says once that the cartridge maximum is not the member’s rifle', () => {
    gauge(71.2);
    expect(
      screen.getByText(
        'Measured against the cartridge maximum. Your chamber and magazine decide the usable length.',
      ),
    ).toBeInTheDocument();
  });

  it('draws no scale, and no verdict, without a maximum', () => {
    render(<CoalGauge units="metric" coalMm={71.2} maxLengthMm={null} />);
    expect(screen.getByText('The maximum is not available for this cartridge.')).toBeInTheDocument();
    expect(screen.queryByText(/mm (under|over) the maximum/)).toBeNull();
  });

  /** The top of a band is what has to clear the ceiling, not the middle. */
  it('judges a banded load on its longest round', () => {
    render(
      <CoalGauge units="metric" coalMm={71.12} maxLengthMm={L6} coalLoMm={71.12} coalHiMm={71.9} />,
    );
    expect(screen.getByText('0.14 mm over the maximum')).toBeInTheDocument();
    expect(screen.getByText('COAL 71.12–71.90 mm')).toBeInTheDocument();
  });
});
