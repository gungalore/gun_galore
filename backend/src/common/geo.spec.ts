import { haversineKm, roundKm } from './geo';

describe('haversineKm', () => {
  it('is ~0 for the same point', () => {
    expect(haversineKm({ lat: -33.9, lng: 18.4 }, { lat: -33.9, lng: 18.4 })).toBeCloseTo(0, 5);
  });

  it('measures Cape Town → Johannesburg at roughly 1,270 km', () => {
    const km = haversineKm({ lat: -33.9249, lng: 18.4241 }, { lat: -26.2041, lng: 28.0473 });
    expect(km).toBeGreaterThan(1200);
    expect(km).toBeLessThan(1320);
  });

  it('measures a short hop accurately', () => {
    // ~11 km across Cape Town's northern suburbs.
    const km = haversineKm({ lat: -33.9, lng: 18.4 }, { lat: -33.8, lng: 18.4 });
    expect(km).toBeGreaterThan(10);
    expect(km).toBeLessThan(12);
  });
});

describe('roundKm (privacy coarsening)', () => {
  it('snaps to the nearest 5 km by default', () => {
    expect(roundKm(2)).toBe(0);
    expect(roundKm(3)).toBe(5);
    expect(roundKm(52)).toBe(50);
    expect(roundKm(54)).toBe(55);
  });
  it('is safe for bad input', () => {
    expect(roundKm(Number.NaN)).toBe(0);
    expect(roundKm(-4)).toBe(0);
  });
});
