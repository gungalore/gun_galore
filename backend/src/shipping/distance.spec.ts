import { distanceKm, formatDistanceKm } from './distance';

// Pretoria (Menlyn) → Johannesburg (Bryanston), the docs' example pair.
const PRETORIA = { lat: -25.785641, lng: 28.278871 };
const JOBURG = { lat: -26.04509, lng: 28.024281 };

describe('distance (straight-line, km)', () => {
  it('is zero for the same point', () => {
    expect(distanceKm(PRETORIA, PRETORIA)).toBe(0);
  });

  it('measures a known city pair to within a rounding kilometre', () => {
    const km = distanceKm(PRETORIA, JOBURG);
    expect(km).toBeGreaterThan(36);
    expect(km).toBeLessThan(41);
  });

  it('is symmetric', () => {
    expect(distanceKm(PRETORIA, JOBURG)).toBe(distanceKm(JOBURG, PRETORIA));
  });

  it('formats a coarse label', () => {
    expect(formatDistanceKm(560)).toContain('560');
    expect(formatDistanceKm(560)).toContain('km');
  });
});
