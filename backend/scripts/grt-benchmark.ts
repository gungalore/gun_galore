/**
 * GRT benchmark: score the internal-ballistics engine against the GRT oracle
 * captured via Frida. Reads the seed (3 cross-cartridge loads) + the grid
 * (~90 powder×charge loads on the 6.5CM template). Feeds GRT's own geometry to
 * the engine, runs it, and compares Pmax / muzzle velocity.
 *
 * Grid-searches the single global (kBurn, sebertScale) pair on a CALIBRATE
 * split, then reports CALIBRATE vs frozen HOLDOUT error (mean/median/max), plus
 * residual-vs-covariate tables to isolate model bias (Ba / fill ratio / burn).
 *
 * Run:  cd backend && npx ts-node --project tsconfig.json scripts/grt-benchmark.ts
 */
import * as fs from 'fs';
import { solveInternalBallistics } from '../src/load-lab/internal-ballistics/ib-engine';
import { findPowder } from '../src/load-lab/internal-ballistics/powder-coefficients';
import { IbLoad, IbPowder } from '../src/load-lab/internal-ballistics/ib-types';

const SEED = 'C:/dev/grt-oracle/oracle_seed.jsonl';
const GRID = 'C:/dev/grt-oracle/oracle_grid.jsonl';

const FILE_POWDER: Record<string, { name: string; maker: string }> = {
  'POWDER-MEASURE-TEMPLATE.grtload': { name: 'N540', maker: 'Vihtavuori' },
  'N550 ELDX 178.grtload': { name: 'N550', maker: 'Vihtavuori' },
  'H4350 SCENAR 139.grtload': { name: 'H4350', maker: 'Hodgdon' },
};

interface Row {
  _file?: string;
  powderName?: string;
  powderMaker?: string;
  initialGasVolumeCm3: number;
  boreAreaMm2: number;
  travelMm: number;
  projectileMassGr: number;
  chargeMassGrEcho?: number;
  chargeMassGr?: number;
  intendedChargeGr?: number;
  shotStartBar?: number;
  sebert?: number;
  pMaxBar?: number;
  mvFps?: number;
  burntPct?: number;
  fillRatio?: number;
}

function readJsonl(path: string): Row[] {
  if (!fs.existsSync(path)) return [];
  return fs
    .readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function resolvePowder(row: Row): IbPowder | undefined {
  if (row.powderName) return findPowder(row.powderName, row.powderMaker);
  if (row._file && FILE_POWDER[row._file])
    return findPowder(FILE_POWDER[row._file].name, FILE_POWDER[row._file].maker);
  return undefined;
}

function chargeOf(row: Row): number {
  return row.chargeMassGr ?? row.chargeMassGrEcho ?? row.intendedChargeGr ?? 0;
}

function loadAll(): { row: Row; powder: IbPowder; load: IbLoad }[] {
  const raw = [...readJsonl(SEED), ...readJsonl(GRID)];
  const out: { row: Row; powder: IbPowder; load: IbLoad }[] = [];
  let skipped = 0;
  for (const row of raw) {
    const powder = resolvePowder(row);
    const charge = chargeOf(row);
    if (
      !powder ||
      !row.mvFps ||
      !row.pMaxBar ||
      !row.initialGasVolumeCm3 ||
      !row.boreAreaMm2 ||
      !row.travelMm ||
      !charge
    ) {
      skipped += 1;
      continue;
    }
    out.push({
      row,
      powder,
      load: {
        initialGasVolumeCm3: row.initialGasVolumeCm3,
        boreAreaMm2: row.boreAreaMm2,
        travelMm: row.travelMm,
        projectileMassGr: row.projectileMassGr,
        chargeMassGr: charge,
        shotStartBar: row.shotStartBar ?? 250,
        sebert: row.sebert ?? 0.5,
      },
    });
  }
  if (skipped) console.log(`(skipped ${skipped} rows missing data/powder)\n`);
  return out;
}

const pe = (m: number, r: number) => ((m - r) / r) * 100;

// Powder → GRT model fit-quality (Qlty), from the vendored data. Low Qlty =
// GRT's OWN model for that powder is rough, so our match to GRT is bounded.
const QLTY: Record<string, number> = (() => {
  const data = JSON.parse(
    fs.readFileSync(
      'C:/dev/gun-galore/backend/src/load-lab/internal-ballistics/grt-data/grt_reloading_data.json',
      'utf8',
    ),
  );
  const m: Record<string, number> = {};
  for (const p of data.propellant)
    m[`${p.mname}|${p.pname}`.toLowerCase()] = p.Qlty ?? 0;
  return m;
})();
function qltyOf(row: Row): number {
  const fp = row._file ? FILE_POWDER[row._file] : undefined;
  const maker = row.powderMaker ?? fp?.maker ?? '';
  const name = row.powderName ?? fp?.name ?? '';
  return QLTY[`${maker}|${name}`.toLowerCase()] ?? 0;
}

function errs(
  set: { powder: IbPowder; load: IbLoad; row: Row }[],
  kBurn: number,
  sebertScale: number,
  burnExp: number,
) {
  return set.map((s) => {
    const r = solveInternalBallistics(s.load, s.powder, {
      kBurn,
      sebertScale,
      burnExp,
    });
    return {
      v: pe(r.vMuzzleFps, s.row.mvFps!),
      p: pe(r.pMaxBar, s.row.pMaxBar!),
      row: s.row,
    };
  });
}

function stats(xs: number[]) {
  const a = xs.map(Math.abs).sort((x, y) => x - y);
  const mean = a.reduce((s, x) => s + x, 0) / (a.length || 1);
  const median = a[Math.floor(a.length / 2)] ?? 0;
  const max = a[a.length - 1] ?? 0;
  return { mean, median, max };
}

function main() {
  const everything = loadAll();
  // REALISTIC REGIME: loads anyone would actually fire — excludes fast-powder
  // kabooms (Pmax>5800) and squibs/incomplete burns. This is the product-
  // relevant accuracy; fast-powder-in-a-rifle-case mismatches are out of scope.
  const all = everything.filter(
    (s) => s.row.pMaxBar! >= 1500 && s.row.pMaxBar! <= 5800 && (s.row.burntPct ?? 100) >= 80,
  );
  const extreme = everything.length - all.length;
  console.log(
    `=== GRT benchmark: ${all.length} realistic loads (${extreme} extreme/out-of-regime excluded) ===\n`,
  );

  // 60/40 calibrate/holdout, deterministic by index.
  const calib = all.filter((_, i) => i % 5 < 3);
  const hold = all.filter((_, i) => i % 5 >= 3);

  let best = { kBurn: 1.075, sebertScale: 0.25, burnExp: 1.0, cost: Infinity };
  for (let kB = 0.9; kB <= 1.4; kB += 0.025) {
    for (let sS = 0.1; sS <= 0.45; sS += 0.025) {
      for (let bE = 0.78; bE <= 1.0; bE += 0.02) {
        const e = errs(calib, kB, sS, bE);
        const cost = e.reduce(
          (s, x) => s + 2 * Math.abs(x.v) + Math.abs(x.p),
          0,
        );
        if (cost < best.cost)
          best = { kBurn: kB, sebertScale: sS, burnExp: bE, cost };
      }
    }
  }
  console.log(
    `Best global knobs (calibrated): kBurn=${best.kBurn.toFixed(3)} sebertScale=${best.sebertScale.toFixed(3)} burnExp=${best.burnExp.toFixed(2)}\n`,
  );

  for (const [name, set] of [
    ['CALIBRATE', calib],
    ['HOLDOUT', hold],
    ['ALL', all],
  ] as const) {
    if (!set.length) continue;
    const e = errs(set, best.kBurn, best.sebertScale, best.burnExp);
    const v = stats(e.map((x) => x.v));
    const p = stats(e.map((x) => x.p));
    console.log(
      `${name.padEnd(10)} (n=${set.length})  ` +
        `MV: mean ${v.mean.toFixed(2)}% / median ${v.median.toFixed(2)}% / max ${v.max.toFixed(1)}%   ` +
        `Pmax: mean ${p.mean.toFixed(2)}% / median ${p.median.toFixed(2)}% / max ${p.max.toFixed(1)}%`,
    );
  }

  // Residual vs covariates (bias direction) — find systematic model error.
  console.log('\n=== Pmax residual vs covariates (signed mean %) ===');
  const e = errs(all, best.kBurn, best.sebertScale, best.burnExp);
  const buckets: Record<string, number[]> = {};
  for (const x of e) {
    const ba = x.row && resolvePowder(x.row);
    const bav = ba?.Ba ?? 0;
    const key =
      bav < 0.4 ? 'Ba<0.4' : bav < 0.6 ? 'Ba 0.4-0.6' : bav < 0.8 ? 'Ba 0.6-0.8' : 'Ba>0.8';
    (buckets[key] ??= []).push(x.p);
  }
  for (const k of Object.keys(buckets).sort()) {
    const arr = buckets[k];
    const mean = arr.reduce((s, y) => s + y, 0) / arr.length;
    console.log(`  ${k.padEnd(12)} n=${String(arr.length).padStart(3)}  mean Pmax err ${mean >= 0 ? '+' : ''}${mean.toFixed(1)}%`);
  }

  // High-Qlty subset: GRT's confident models — the powders a product would use.
  console.log('\n=== high-Qlty subset (GRT Qlty ≥ 0.95) ===');
  const hq = all.filter((s) => qltyOf(s.row) >= 0.95);
  if (hq.length) {
    const he = errs(hq, best.kBurn, best.sebertScale, best.burnExp);
    const v = stats(he.map((x) => x.v));
    const p = stats(he.map((x) => x.p));
    console.log(
      `  n=${hq.length}  MV: mean ${v.mean.toFixed(2)}% / median ${v.median.toFixed(2)}% / max ${v.max.toFixed(1)}%   ` +
        `Pmax: mean ${p.mean.toFixed(2)}% / median ${p.median.toFixed(2)}% / max ${p.max.toFixed(1)}%`,
    );
  }

  // Worst 8 loads by |Pmax err| (with each powder's GRT Qlty).
  console.log('\n=== worst 8 by |Pmax err| (with GRT Qlty) ===');
  const worst = [...e].sort((a, b) => Math.abs(b.p) - Math.abs(a.p)).slice(0, 8);
  for (const x of worst) {
    const nm = x.row.powderName ?? x.row._file ?? '?';
    console.log(
      `  ${String(nm).padEnd(20)} Qlty ${qltyOf(x.row).toFixed(2)}  charge ${String(chargeOf(x.row)).padStart(6)}gr  ` +
        `MV ${x.v >= 0 ? '+' : ''}${x.v.toFixed(1)}%  Pmax ${x.p >= 0 ? '+' : ''}${x.p.toFixed(1)}%`,
    );
  }

  console.log('\nGATE: velocity median |%err| ≲ 1-2%, Pmax ≲ low single digits.');
}

main();
