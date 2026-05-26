/* eslint-disable no-console */
/**
 * Standalone parity check — runs the backend `BallisticsService` AND
 * the frontend `calculateBallistics` against three fixture loads and
 * asserts they agree within ±0.01 mil at every range.
 *
 * Why standalone instead of a Jest spec?
 *   - Jest is overkill for a single comparison job
 *   - Instant feedback when iterating on either implementation
 *   - The operator (non-coder) can run it via a single PowerShell
 *     command without a test runner stack to set up
 *
 * Run from the backend folder:
 *   cd backend
 *   npx ts-node --project tsconfig.json scripts\check-ballistics-parity.ts
 */

import { BallisticsService } from '../src/ballistics/ballistics.service';
import type { BallisticsInput as BackendInput } from '../src/ballistics/ballistics.service';
import {
  calculateBallistics as frontendCalculate,
  type BallisticsInput as FrontendInput,
} from '../../frontend/lib/ballistics-calc';

interface Fixture {
  name: string;
  backend: BackendInput;
  frontend: FrontendInput;
}

const FIXTURES: Fixture[] = [
  {
    name: '.308 Win — 175gr SMK @ 2650 fps, BC G1 0.505',
    backend: {
      bulletWeightGr: 175,
      bcG1: 0.505,
      muzzleVelocityFps: 2650,
      zeroM: 100,
      ranges: [100, 200, 300, 500, 700, 1000],
    },
    frontend: {
      bulletWeightGr: 175,
      bc: 0.505,
      dragModel: 'G1',
      muzzleVelocityFps: 2650,
      zeroM: 100,
      ranges: [100, 200, 300, 500, 700, 1000],
    },
  },
  {
    name: '6.5 Creedmoor — 140gr ELD-M @ 2700 fps, BC G1 0.610',
    backend: {
      bulletWeightGr: 140,
      bcG1: 0.610,
      muzzleVelocityFps: 2700,
      zeroM: 100,
      ranges: [100, 200, 300, 500, 700, 1000],
    },
    frontend: {
      bulletWeightGr: 140,
      bc: 0.610,
      dragModel: 'G1',
      muzzleVelocityFps: 2700,
      zeroM: 100,
      ranges: [100, 200, 300, 500, 700, 1000],
    },
  },
  {
    name: '.300 Win Mag — 215gr Berger Hybrid @ 2900 fps, BC G1 0.696',
    backend: {
      bulletWeightGr: 215,
      bcG1: 0.696,
      muzzleVelocityFps: 2900,
      zeroM: 100,
      ranges: [100, 200, 300, 500, 700, 1000],
    },
    frontend: {
      bulletWeightGr: 215,
      bc: 0.696,
      dragModel: 'G1',
      muzzleVelocityFps: 2900,
      zeroM: 100,
      ranges: [100, 200, 300, 500, 700, 1000],
    },
  },
];

const MIL_TOLERANCE = 0.01;
const MOA_TOLERANCE = 0.1;
const CM_TOLERANCE = 0.5;
const FPS_TOLERANCE = 2;
const J_TOLERANCE = 5;
const TOF_TOLERANCE = 0.005;
const ANGLE_TOLERANCE_MOA = 0.1;

const svc = new BallisticsService();
let failed = 0;

function fail(msg: string): void {
  console.error(`  ❌ ${msg}`);
  failed += 1;
}
function ok(msg: string): void {
  console.log(`  ✅ ${msg}`);
}

for (const fx of FIXTURES) {
  console.log(`\n──── ${fx.name}`);
  const be = svc.calculate(fx.backend);
  const fe = frontendCalculate(fx.frontend);

  if (be.rows.length !== fe.rows.length) {
    fail(`row count mismatch — backend ${be.rows.length} vs frontend ${fe.rows.length}`);
    continue;
  }

  const angleDiff = Math.abs(be.launchAngleMoa - fe.launchAngleMoa);
  if (angleDiff > ANGLE_TOLERANCE_MOA) {
    fail(
      `launch angle drift ${angleDiff.toFixed(3)} MOA > tolerance ${ANGLE_TOLERANCE_MOA}`,
    );
  } else {
    ok(`launch angle parity within ${ANGLE_TOLERANCE_MOA} MOA`);
  }

  const densityDiff = Math.abs(be.airDensityKgM3 - fe.airDensityKgM3);
  if (densityDiff > 0.001) {
    fail(`air density drift ${densityDiff.toFixed(5)} kg/m³`);
  }

  console.log(
    '  range   |   backend mil   |  frontend mil   | Δ mil  | Δ vel fps',
  );
  for (let i = 0; i < be.rows.length; i += 1) {
    const b = be.rows[i];
    const f = fe.rows[i];
    const dmil = Math.abs(b.dropMil - f.dropMil);
    const dvel = Math.abs(b.velocityFps - f.velocityFps);
    const symbol = dmil <= MIL_TOLERANCE ? '✓' : '✗';
    console.log(
      `  ${String(b.rangeM).padStart(5)}m  |  ${b.dropMil
        .toFixed(2)
        .padStart(14)} |  ${f.dropMil
        .toFixed(2)
        .padStart(14)} | ${dmil.toFixed(3).padStart(5)}  | ${String(dvel).padStart(8)}  ${symbol}`,
    );
    if (dmil > MIL_TOLERANCE)
      fail(`row ${b.rangeM}m: drop mil drift ${dmil.toFixed(4)} > ${MIL_TOLERANCE}`);
    if (Math.abs(b.dropMoa - f.dropMoa) > MOA_TOLERANCE)
      fail(`row ${b.rangeM}m: drop MOA drift`);
    if (Math.abs(b.dropCm - f.dropCm) > CM_TOLERANCE)
      fail(`row ${b.rangeM}m: drop cm drift`);
    if (dvel > FPS_TOLERANCE)
      fail(`row ${b.rangeM}m: velocity drift ${dvel} fps`);
    if (Math.abs(b.energyJoules - f.energyJoules) > J_TOLERANCE)
      fail(`row ${b.rangeM}m: energy drift`);
    if (Math.abs(b.timeOfFlightS - f.timeOfFlightS) > TOF_TOLERANCE)
      fail(`row ${b.rangeM}m: TOF drift`);
  }
}

// One non-standard atmosphere case (Highveld, hot day) — covers the
// airDensity branch that uses non-standard inputs.
console.log('\n──── Highveld atmosphere (.308 175 SMK @ 1500m alt, 30°C)');
const beAlt = svc.calculate({
  bulletWeightGr: 175,
  bcG1: 0.505,
  muzzleVelocityFps: 2650,
  zeroM: 100,
  tempC: 30,
  pressureHpa: 1010,
  altitudeM: 1500,
  ranges: [300, 500, 700],
});
const feAlt = frontendCalculate({
  bulletWeightGr: 175,
  bc: 0.505,
  dragModel: 'G1',
  muzzleVelocityFps: 2650,
  zeroM: 100,
  tempC: 30,
  pressureHpa: 1010,
  altitudeM: 1500,
  ranges: [300, 500, 700],
});
for (let i = 0; i < beAlt.rows.length; i += 1) {
  const d = Math.abs(beAlt.rows[i].dropMil - feAlt.rows[i].dropMil);
  if (d > MIL_TOLERANCE) fail(`Highveld row ${beAlt.rows[i].rangeM}m drift ${d.toFixed(4)}`);
  else ok(`Highveld ${beAlt.rows[i].rangeM}m parity (Δ ${d.toFixed(4)} mil)`);
}

// Crosswind drift parity.
console.log('\n──── Crosswind drift (6.5 CM 140 ELDM, 5 m/s full-value)');
const beW = svc.calculate({
  bulletWeightGr: 140,
  bcG1: 0.610,
  muzzleVelocityFps: 2700,
  zeroM: 100,
  windSpeedMps: 5,
  windDirectionDeg: 90,
  ranges: [300, 500, 700, 1000],
});
const feW = frontendCalculate({
  bulletWeightGr: 140,
  bc: 0.610,
  dragModel: 'G1',
  muzzleVelocityFps: 2700,
  zeroM: 100,
  windSpeedMps: 5,
  windDirectionDeg: 90,
  ranges: [300, 500, 700, 1000],
});
for (let i = 0; i < beW.rows.length; i += 1) {
  const d = Math.abs(beW.rows[i].windageMil - feW.rows[i].windageMil);
  if (d > MIL_TOLERANCE) fail(`Wind row ${beW.rows[i].rangeM}m windage drift ${d.toFixed(4)}`);
  else ok(`Wind ${beW.rows[i].rangeM}m windage parity (Δ ${d.toFixed(4)} mil)`);
}

console.log('');
if (failed === 0) {
  console.log('🎯  Parity check passed — backend and frontend agree.');
  process.exit(0);
} else {
  console.log(`💥  Parity check FAILED — ${failed} assertion(s) drifted.`);
  process.exit(1);
}
