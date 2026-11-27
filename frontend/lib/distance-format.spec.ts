import { describe, expect, it } from 'vitest';
import {
  DISTANCE_TOOLTIP,
  formatDistanceKm,
  shouldShowDistance,
} from './distance-format';

// ⚠️ THE DISPLAY IS `150km` — no space, no decimal, snapped to 5 km, and never
// presented as a delivery estimate.
describe('formatDistanceKm', () => {
  it('renders exactly the snapped figure the catalogue uses', () => {
    expect(formatDistanceKm(150)).toBe('150km');
    expect(formatDistanceKm(12)).toBe('10km');
    expect(formatDistanceKm(13)).toBe('15km');
    expect(formatDistanceKm(1)).toBe('5km');
  });

  it('hides itself when there is no usable distance', () => {
    expect(formatDistanceKm(null)).toBeNull();
    expect(formatDistanceKm(undefined)).toBeNull();
    expect(formatDistanceKm(Number.NaN)).toBeNull();
    expect(formatDistanceKm(-4)).toBeNull();
  });

  it('only claims to be approximate and straight-line', () => {
    expect(DISTANCE_TOOLTIP).toMatch(/straight-line/i);
    expect(DISTANCE_TOOLTIP).toMatch(/rounded to 5 km/i);
    expect(DISTANCE_TOOLTIP).toMatch(/not a delivery estimate/i);
  });
});

describe('shouldShowDistance', () => {
  it('is true exactly when there is a figure', () => {
    expect(shouldShowDistance(150)).toBe(true);
    expect(shouldShowDistance(null)).toBe(false);
  });
});
