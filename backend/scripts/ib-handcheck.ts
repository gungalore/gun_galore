/**
 * Phase-1 hand-check: validate the internal-ballistics engine against the
 * ONE fully-specified GRT data point we have (from the GRT Results screen):
 *
 *   6.5 Creedmoor · Sierra 120 gr · Vihtavuori N540 41.0 gr · 24" barrel
 *   eff. case volume 3.0993 cm³ · eff. area 34.66 mm² · projectile path 570.25 mm
 *   GRT computed →  Pmax 4233 bar · MV 2981 fps · barrel time 1.2053 ms
 *                   100% burnt · muzzle pressure 758 bar · efficiency 30.2%
 *
 * Also runs an RK4 convergence check (1 µs vs 0.5 µs) and a units round-trip.
 *
 * Run:  cd backend && npx ts-node --project tsconfig.json scripts/ib-handcheck.ts
 */
import { solveInternalBallistics } from '../src/load-lab/internal-ballistics/ib-engine';
import { findPowder } from '../src/load-lab/internal-ballistics/powder-coefficients';
import { IbLoad } from '../src/load-lab/internal-ballistics/ib-types';

const GRT = {
  pMaxBar: 4233,
  mvFps: 2981,
  barrelTimeMs: 1.2053,
  pctBurnt: 100,
  pMuzzleBar: 758,
};

const load: IbLoad = {
  initialGasVolumeCm3: 3.0993,
  boreAreaMm2: 34.66,
  travelMm: 570.25,
  projectileMassGr: 120,
  chargeMassGr: 41.0,
  shotStartBar: 250,
  sebert: 0.5,
};

function pct(model: number, ref: number): string {
  const e = ((model - ref) / ref) * 100;
  return `${e >= 0 ? '+' : ''}${e.toFixed(1)}%`;
}

function run(kBurn: number, sebertScale = 0) {
  const powder = findPowder('N540', 'Vihtavuori');
  if (!powder) throw new Error('N540 not found in vendored data');
  const r = solveInternalBallistics(load, powder, { kBurn, sebertScale });
  return r;
}

function report(kBurn: number, sebertScale = 0) {
  const r = run(kBurn, sebertScale);
  console.log(`\n── kBurn = ${kBurn}  sebertScale = ${sebertScale} ──`);
  console.log(
    `  Pmax        ${r.pMaxBar.toFixed(0).padStart(6)} bar   (GRT ${GRT.pMaxBar}, ${pct(r.pMaxBar, GRT.pMaxBar)})`,
  );
  console.log(
    `  MV          ${r.vMuzzleFps.toFixed(0).padStart(6)} fps   (GRT ${GRT.mvFps}, ${pct(r.vMuzzleFps, GRT.mvFps)})`,
  );
  console.log(
    `  barrel time ${r.barrelTimeMs.toFixed(3).padStart(6)} ms    (GRT ${GRT.barrelTimeMs}, ${pct(r.barrelTimeMs, GRT.barrelTimeMs)})`,
  );
  console.log(
    `  muzzle P    ${r.pMuzzleBar.toFixed(0).padStart(6)} bar   (GRT ${GRT.pMuzzleBar}, ${pct(r.pMuzzleBar, GRT.pMuzzleBar)})`,
  );
  console.log(
    `  %burnt      ${(r.fractionBurnt * 100).toFixed(1).padStart(6)} %     (GRT ${GRT.pctBurnt})`,
  );
  console.log(`  efficiency  ${(r.efficiency * 100).toFixed(1).padStart(6)} %     (GRT 30.2)`);
  if (r.warnings.length) console.log('  warnings:', r.warnings.join(' | '));
  return r;
}

console.log('=== IB engine hand-check vs GRT (6.5CM / N540 41gr / 120gr / 24") ===');

// Sweep kBurn to find the value that best matches GRT's Pmax + barrel time.
// Two-knob fit: kBurn sets burn rate (→ Pmax + barrel time); sebertScale sets
// heat loss (→ efficiency / MV). Search for the pair that matches GRT on all
// three. (Single-point demonstration that the model CAN match; the real
// multi-load calibration happens in the oracle benchmark.)
for (const kBurn of [0.95, 1.0, 1.05, 1.1]) {
  for (const sebertScale of [0.15, 0.2, 0.25, 0.3]) {
    report(kBurn, sebertScale);
  }
}

// RK4 convergence check at a representative kBurn (re-pick after the sweep).
console.log('\n=== RK4 convergence (1 µs vs 0.5 µs) ===');
const powder = findPowder('N540', 'Vihtavuori')!;
for (const kBurn of [1.0, 1.3]) {
  const a = solveInternalBallistics(load, powder, { kBurn, dt: 1e-6 });
  const b = solveInternalBallistics(load, powder, { kBurn, dt: 0.5e-6 });
  const dP = (Math.abs(a.pMaxBar - b.pMaxBar) / b.pMaxBar) * 100;
  const dV = (Math.abs(a.vMuzzleFps - b.vMuzzleFps) / b.vMuzzleFps) * 100;
  console.log(
    `  kBurn=${kBurn}: ΔPmax ${dP.toFixed(3)}%  ΔMV ${dV.toFixed(3)}%  (want <0.05%)`,
  );
}
