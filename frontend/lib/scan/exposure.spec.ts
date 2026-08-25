import { describe, expect, it } from 'vitest';
import {
  BRIGHT_AT,
  DARK_AT,
  GLARE_AT,
  exposureProblem,
} from './exposure';

describe('exposureProblem', () => {
  it('says nothing about an ordinary frame', () => {
    expect(exposureProblem(0, 128, false)).toBeNull();
    expect(exposureProblem(0.005, 90, false)).toBeNull();
  });

  it('⚠️ REPORTS GLARE EVEN WHEN THE MEAN IS PERFECT', () => {
    // The torch-on-a-laminated-card case, and the single most common way this
    // scanner fails. A bright patch over the licence number leaves the mean
    // brightness entirely respectable, so a check that led with brightness
    // would say nothing at all about the frame that matters most.
    const p = exposureProblem(0.2, 128, true);
    expect(p?.key).toBe('glare');
  });

  it('⚠️ TELLS YOU TO TURN THE LIGHT OFF ONLY WHEN IT IS ON', () => {
    expect(exposureProblem(0.2, 128, true)?.body).toContain('light off');
    expect(exposureProblem(0.2, 128, false)?.body).not.toContain('light off');
  });

  it('⚠️ NEVER TELLS YOU TO TURN ON A LIGHT THAT IS ALREADY ON', () => {
    // Advice the member can see is wrong is how a warning stops being read.
    const on = exposureProblem(0, 10, true);
    expect(on?.key).toBe('dark');
    expect(on?.body).not.toContain('Turn the light on');
    expect(exposureProblem(0, 10, false)?.body).toContain('Turn the light on');
  });

  it('reports bright and dark at the ends', () => {
    expect(exposureProblem(0, 250, false)?.key).toBe('bright');
    expect(exposureProblem(0, 5, false)?.key).toBe('dark');
  });

  it('⚠️ LEAVES A DARK DESK ALONE', () => {
    // A licence card on a dark surface photographs perfectly and sits well
    // below mid-grey. An alert here is an alert the member learns to ignore.
    expect(exposureProblem(0, 70, false)).toBeNull();
    expect(exposureProblem(0, 200, false)).toBeNull();
  });

  it('does not fire exactly at the thresholds', () => {
    // Strict comparisons both ways, so a frame sitting on the line does not
    // flicker the alert on and off while nothing is changing.
    expect(exposureProblem(GLARE_AT, 128, false)).toBeNull();
    expect(exposureProblem(0, BRIGHT_AT, false)).toBeNull();
    expect(exposureProblem(0, DARK_AT, false)).toBeNull();
  });
});
