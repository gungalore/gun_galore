/**
 * Ballistics service spec — internal consistency only.
 *
 * Pins physical invariants (drop monotonic past zero, velocity
 * decreasing, mil↔MOA consistency, etc.) against regression. NOT a
 * cross-port parity test — that lives in
 * `backend/scripts/check-ballistics-parity.ts` which imports the
 * frontend file outside the nest build root, so the nest build
 * doesn't pull the frontend tree into `dist/`. Run that script when
 * you change either implementation.
 *
 * Run: `cd backend && npx jest ballistics.service.spec.ts`
 */

import { BallisticsService } from './ballistics.service';
import type { BallisticsInput } from './ballistics.service';

describe('BallisticsService.calculate (backend G1 solver)', () => {
  const svc = new BallisticsService();

  const FIXTURES: Array<{ name: string; input: BallisticsInput }> = [
    {
      name: '.308 Win — 175gr SMK @ 2650 fps, BC G1 0.505',
      input: {
        bulletWeightGr: 175,
        bcG1: 0.505,
        muzzleVelocityFps: 2650,
        zeroM: 100,
        ranges: [100, 200, 300, 500, 700, 1000],
      },
    },
    {
      name: '6.5 CM — 140gr ELDM @ 2700 fps, BC G1 0.610',
      input: {
        bulletWeightGr: 140,
        bcG1: 0.610,
        muzzleVelocityFps: 2700,
        zeroM: 100,
        ranges: [100, 200, 300, 500, 700, 1000],
      },
    },
    {
      name: '.300 WM — 215gr Berger @ 2900 fps, BC G1 0.696',
      input: {
        bulletWeightGr: 215,
        bcG1: 0.696,
        muzzleVelocityFps: 2900,
        zeroM: 100,
        ranges: [100, 200, 300, 500, 700, 1000],
      },
    },
  ];

  it.each(FIXTURES)('$name — sanity invariants hold', ({ input }) => {
    const result = svc.calculate(input);

    expect(result.rows).toHaveLength(input.ranges!.length);

    // Drop is ≈0 at the zero range.
    const zeroRow = result.rows.find((r) => r.rangeM === input.zeroM);
    expect(zeroRow).toBeDefined();
    expect(Math.abs(zeroRow!.dropCm)).toBeLessThanOrEqual(0.5);

    // Past zero, drop increases monotonically.
    const pastZero = result.rows.filter((r) => r.rangeM > input.zeroM);
    for (let i = 1; i < pastZero.length; i += 1) {
      expect(pastZero[i].dropCm).toBeGreaterThanOrEqual(
        pastZero[i - 1].dropCm,
      );
    }

    // Velocity, energy decrease; TOF increases.
    for (let i = 1; i < result.rows.length; i += 1) {
      expect(result.rows[i].velocityFps).toBeLessThanOrEqual(
        result.rows[i - 1].velocityFps,
      );
      expect(result.rows[i].energyJoules).toBeLessThanOrEqual(
        result.rows[i - 1].energyJoules,
      );
      expect(result.rows[i].timeOfFlightS).toBeGreaterThan(
        result.rows[i - 1].timeOfFlightS,
      );
    }

    // mil ↔ MOA agree within rounding (1 mil = 3.4377 MOA, ±5% slack).
    for (const row of result.rows) {
      if (Math.abs(row.dropMil) > 0.05) {
        const ratio = row.dropMoa / row.dropMil;
        expect(ratio).toBeGreaterThan(3.4377 * 0.95);
        expect(ratio).toBeLessThan(3.4377 * 1.05);
      }
    }
  });

  it('standardAtmosphere flag is true when atmosphere overrides omitted', () => {
    const result = svc.calculate(FIXTURES[0].input);
    expect(result.standardAtmosphere).toBe(true);
    expect(result.airDensityKgM3).toBeCloseTo(1.225, 2);
  });

  it('higher altitude → less drag → less drop at long range', () => {
    const seaLevel = svc.calculate(FIXTURES[0].input);
    const altitude = svc.calculate({
      ...FIXTURES[0].input,
      altitudeM: 1500,
    });
    expect(altitude.airDensityKgM3).toBeLessThan(seaLevel.airDensityKgM3);
    const slLong = seaLevel.rows[seaLevel.rows.length - 1];
    const altLong = altitude.rows[altitude.rows.length - 1];
    expect(altLong.dropCm).toBeLessThan(slLong.dropCm);
  });

  it('crosswind produces drift; no wind produces zero', () => {
    const noWind = svc.calculate(FIXTURES[0].input);
    const wind = svc.calculate({
      ...FIXTURES[0].input,
      windSpeedMps: 5,
      windDirectionDeg: 90,
    });
    const noWindLast = noWind.rows[noWind.rows.length - 1];
    const windLast = wind.rows[wind.rows.length - 1];
    expect(noWindLast.windageCm).toBeCloseTo(0, 1);
    expect(windLast.windageCm).toBeGreaterThan(20);
  });
});
