/**
 * IB diagnostic — compare burn-law formulations against the GRT oracle, with a
 * focus on the SAFETY direction (never under-predict pressure).
 *
 * Tests the hypothesis from the per-powder audit: GRT's law is pressure-LINEAR
 * (dz/dt = L(z)·P, L01..L09 already = Ba·φ(z)), so the global kBurn/burnExp
 * fudges should be dropped. We can test pure-linear WITHOUT editing the engine
 * by passing the calib override {kBurn:1, burnExp:1} and sweeping sebertScale.
 *
 * Run: cd backend && npx ts-node --project tsconfig.json scripts/ib-diagnose.ts
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
    )
      continue;
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
  return out;
}

const pe = (m: number, r: number) => ((m - r) / r) * 100;
function stats(xs: number[]) {
  const a = xs.map(Math.abs).sort((x, y) => x - y);
  const mean = a.reduce((s, x) => s + x, 0) / (a.length || 1);
  const median = a[Math.floor(a.length / 2)] ?? 0;
  const max = a[a.length - 1] ?? 0;
  return { mean, median, max };
}
function signedMean(xs: number[]) {
  return xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
}

type Cfg = { label: string; kBurn: number; sebertScale: number; burnExp: number };

function evalCfg(set: { powder: IbPowder; load: IbLoad; row: Row }[], cfg: Cfg) {
  const rows = set.map((s) => {
    const r = solveInternalBallistics(s.load, s.powder, {
      kBurn: cfg.kBurn,
      sebertScale: cfg.sebertScale,
      burnExp: cfg.burnExp,
    });
    return {
      v: pe(r.vMuzzleFps, s.row.mvFps!),
      p: pe(r.pMaxBar, s.row.pMaxBar!),
      ba: s.powder.Ba,
      name: s.row.powderName ?? s.row._file ?? '?',
      charge: chargeOf(s.row),
    };
  });
  const v = stats(rows.map((x) => x.v));
  const p = stats(rows.map((x) => x.p));
  // Never-under gate: engine Pmax must be >= oracle * 0.98 (2% noise tol).
  const under = rows.filter((x) => x.p < -2);
  const worstUnder = rows.reduce((a, b) => (b.p < a.p ? b : a), rows[0]);
  // Ba-bucket signed pressure bias.
  const buckets: Record<string, number[]> = {};
  for (const x of rows) {
    const key =
      x.ba < 0.4 ? 'Ba<0.4' : x.ba < 0.6 ? 'Ba0.4-0.6' : x.ba < 0.8 ? 'Ba0.6-0.8' : 'Ba>0.8';
    (buckets[key] ??= []).push(x.p);
  }
  return { rows, v, p, under, worstUnder, buckets };
}

function main() {
  const everything = loadAll();
  const all = everything.filter(
    (s) => s.row.pMaxBar! >= 1500 && s.row.pMaxBar! <= 5800 && (s.row.burntPct ?? 100) >= 80,
  );
  console.log(
    `=== IB diagnostic: ${all.length} realistic loads (of ${everything.length} total) ===\n`,
  );

  const cfgs: Cfg[] = [
    { label: 'CURRENT  (1.025/0.225/exp0.86)', kBurn: 1.025, sebertScale: 0.225, burnExp: 0.86 },
    { label: 'PURE-LIN (1.0/0.225/exp1.0)   ', kBurn: 1.0, sebertScale: 0.225, burnExp: 1.0 },
    { label: 'PURE-LIN (1.0/0.15/exp1.0)    ', kBurn: 1.0, sebertScale: 0.15, burnExp: 1.0 },
    { label: 'PURE-LIN (1.0/0.10/exp1.0)    ', kBurn: 1.0, sebertScale: 0.1, burnExp: 1.0 },
    { label: 'PURE-LIN (1.0/0.05/exp1.0)    ', kBurn: 1.0, sebertScale: 0.05, burnExp: 1.0 },
    { label: 'PURE-LIN (1.0/0.00/exp1.0)    ', kBurn: 1.0, sebertScale: 0.0, burnExp: 1.0 },
  ];

  for (const cfg of cfgs) {
    const e = evalCfg(all, cfg);
    const bkeys = Object.keys(e.buckets).sort();
    const bstr = bkeys
      .map((k) => `${k}:${signedMean(e.buckets[k]) >= 0 ? '+' : ''}${signedMean(e.buckets[k]).toFixed(1)}%`)
      .join('  ');
    console.log(
      `${cfg.label}\n` +
        `   MV   |%|: mean ${e.v.mean.toFixed(2)} med ${e.v.median.toFixed(2)} max ${e.v.max.toFixed(1)}\n` +
        `   Pmax |%|: mean ${e.p.mean.toFixed(2)} med ${e.p.median.toFixed(2)} max ${e.p.max.toFixed(1)}\n` +
        `   UNDER-predict (>2% low): ${e.under.length}/${all.length} loads   worst: ${e.worstUnder.name} ${e.worstUnder.p.toFixed(1)}% @${e.worstUnder.charge}gr\n` +
        `   signed Pmax by Ba: ${bstr}\n`,
    );
  }

  // Fine sweep of sebertScale under pure-linear: find the level that (a) zeroes
  // velocity bias, then report its under-predict exposure.
  console.log('=== pure-linear sebertScale sweep (signed MV/Pmax bias) ===');
  for (let sS = 0.0; sS <= 0.3001; sS += 0.025) {
    const cfg = { label: '', kBurn: 1.0, sebertScale: sS, burnExp: 1.0 };
    const e = evalCfg(all, cfg);
    const sv = signedMean(e.rows.map((x) => x.v));
    const sp = signedMean(e.rows.map((x) => x.p));
    console.log(
      `  sebertScale ${sS.toFixed(3)}  signed MV ${sv >= 0 ? '+' : ''}${sv.toFixed(2)}%  signed Pmax ${sp >= 0 ? '+' : ''}${sp.toFixed(2)}%  |MV|med ${stats(e.rows.map((x) => x.v)).median.toFixed(2)}  |Pmax|med ${stats(e.rows.map((x) => x.p)).median.toFixed(2)}  under>2%:${e.under.length}`,
    );
  }
}
main();
