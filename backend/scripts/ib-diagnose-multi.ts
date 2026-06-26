/**
 * Cross-cartridge IB diagnostic against the DEEP oracle (oracle_multi.jsonl:
 * .223 / 6.5CM / .30-06 / .50 BMG × ~24 powders × 3 fills). Feeds GRT's own
 * captured geometry to the engine and scores Pmax + MV per cartridge and per
 * Ba bucket, with explicit never-under-predict (safety) accounting.
 *
 * Run: cd backend && npx ts-node --project tsconfig.json scripts/ib-diagnose-multi.ts
 */
import * as fs from 'fs';
import { solveInternalBallistics } from '../src/load-lab/internal-ballistics/ib-engine';
import { findPowder } from '../src/load-lab/internal-ballistics/powder-coefficients';
import { IbCalib, IbLoad, IbPowder } from '../src/load-lab/internal-ballistics/ib-types';

const MULTI = 'C:/dev/grt-oracle/oracle_multi.jsonl';

interface Row {
  cartridge?: string;
  powderName?: string;
  powderMaker?: string;
  initialGasVolumeCm3: number;
  boreAreaMm2: number;
  travelMm: number;
  projectileMassGr: number;
  chargeMassGrEcho?: number;
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
  return fs.readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
const chargeOf = (r: Row) => r.chargeMassGrEcho ?? r.intendedChargeGr ?? 0;
const pe = (m: number, r: number) => ((m - r) / r) * 100;
const shortCart = (c?: string) =>
  !c ? '?' : c.includes('.223') ? '.223' : c.includes('30-06') ? '.30-06' : c.includes('50 Brown') || c.includes('.50') ? '.50BMG' : c.includes('Creedmoor') ? '6.5CM' : c.slice(0, 8);

function stats(xs: number[]) {
  const a = xs.map(Math.abs).sort((x, y) => x - y);
  return {
    mean: a.reduce((s, x) => s + x, 0) / (a.length || 1),
    median: a[Math.floor(a.length / 2)] ?? 0,
    max: a[a.length - 1] ?? 0,
  };
}
const signed = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);

function load(): { row: Row; powder: IbPowder; load: IbLoad }[] {
  const out: { row: Row; powder: IbPowder; load: IbLoad }[] = [];
  for (const row of readJsonl(MULTI)) {
    const powder = row.powderName ? findPowder(row.powderName, row.powderMaker) : undefined;
    const charge = chargeOf(row);
    if (!powder || !row.mvFps || !row.pMaxBar || !row.initialGasVolumeCm3 || !row.boreAreaMm2 || !row.travelMm || !charge) continue;
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

function evalSet(set: { row: Row; powder: IbPowder; load: IbLoad }[], calib?: Partial<IbCalib>) {
  return set.map((s) => {
    const r = solveInternalBallistics(s.load, s.powder, calib);
    return {
      v: pe(r.vMuzzleFps, s.row.mvFps!),
      p: pe(r.pMaxBar, s.row.pMaxBar!),
      ba: s.powder.Ba,
      cart: shortCart(s.row.cartridge),
      name: s.row.powderName ?? '?',
      charge: chargeOf(s.row),
      fill: s.row.fillRatio ?? 0,
    };
  });
}

function bucketSigned(rows: ReturnType<typeof evalSet>, keyOf: (x: ReturnType<typeof evalSet>[number]) => string, order?: string[]) {
  const b: Record<string, number[]> = {};
  for (const x of rows) (b[keyOf(x)] ??= []).push(x.p);
  const keys = order ?? Object.keys(b).sort();
  for (const k of keys) if (b[k]) console.log(`  ${k.padEnd(12)} n=${String(b[k].length).padStart(3)}  signed Pmax ${signed(b[k]) >= 0 ? '+' : ''}${signed(b[k]).toFixed(1)}%`);
}

function report(label: string, rows: ReturnType<typeof evalSet>) {
  const v = stats(rows.map((x) => x.v));
  const p = stats(rows.map((x) => x.p));
  const under = rows.filter((x) => x.p < -2);
  const worst = [...rows].sort((a, b) => a.p - b.p).slice(0, 6);
  console.log(`\n### ${label}  (n=${rows.length})`);
  console.log(`  MV   |%|: mean ${v.mean.toFixed(2)} med ${v.median.toFixed(2)} max ${v.max.toFixed(1)}   signed ${signed(rows.map((x) => x.v)).toFixed(2)}`);
  console.log(`  Pmax |%|: mean ${p.mean.toFixed(2)} med ${p.median.toFixed(2)} max ${p.max.toFixed(1)}   signed ${signed(rows.map((x) => x.p)).toFixed(2)}`);
  console.log(`  UNDER-predict >2% low: ${under.length}/${rows.length}   worst: ${worst.map((w) => `${w.name}/${w.cart} ${w.p.toFixed(0)}%`).join(', ')}`);
}

function main() {
  const all = load();
  // Realistic regime: a load someone would actually fire. Upper Pmax cap drops
  // the auto-fill kabooms (esp. .50 BMG: medium powders at 90% fill = fictional
  // 7000-17000 bar loads past proof pressure — GRT extrapolating, not a load).
  const real = all.filter(
    (s) => s.row.pMaxBar! >= 1000 && s.row.pMaxBar! <= 4600 && (s.row.burntPct ?? 100) >= 85,
  );
  console.log(`=== DEEP oracle: ${all.length} resolved loads, ${real.length} realistic (burnt≥85%, 1000≤Pmax≤4600) ===`);
  const byCart: Record<string, number> = {};
  for (const s of real) byCart[shortCart(s.row.cartridge)] = (byCart[shortCart(s.row.cartridge)] ?? 0) + 1;
  console.log('  realistic by cartridge:', JSON.stringify(byCart));

  const CUR: Partial<IbCalib> = { kBurn: 1.025, sebertScale: 0.225, burnExp: 0.86 };
  console.log('\n========== CURRENT ENGINE (1.025 / 0.225 / exp0.86) ==========');
  const e = evalSet(real, CUR);
  report('ALL realistic', e);
  for (const c of ['.223', '6.5CM', '.30-06', '.50BMG']) {
    report(c, e.filter((x) => x.cart === c));
  }
  // Ba-bucket signed Pmax (cross-cartridge).
  console.log('\n--- signed Pmax by Ba bucket (cross-cartridge) ---');
  const buckets: Record<string, number[]> = {};
  for (const x of e) {
    const k = x.ba < 0.4 ? 'Ba<0.4' : x.ba < 0.6 ? 'Ba0.4-0.6' : x.ba < 0.8 ? 'Ba0.6-0.8' : x.ba < 1.5 ? 'Ba0.8-1.5' : 'Ba>1.5';
    (buckets[k] ??= []).push(x.p);
  }
  for (const k of Object.keys(buckets).sort())
    console.log(`  ${k.padEnd(10)} n=${String(buckets[k].length).padStart(3)}  signed Pmax ${signed(buckets[k]) >= 0 ? '+' : ''}${signed(buckets[k]).toFixed(1)}%`);

  // ===== Cross-cartridge re-fit of the 3 globals (balanced per-cartridge) =====
  const carts = ['.223', '6.5CM', '.30-06', '.50BMG'];
  const cost = (rows: ReturnType<typeof evalSet>) => {
    // average per-cartridge so .223 (small n) isn't drowned by 6.5CM
    let total = 0, nc = 0;
    for (const c of carts) {
      const cr = rows.filter((x) => x.cart === c);
      if (!cr.length) continue;
      nc++;
      const mv = cr.reduce((s, x) => s + Math.abs(x.v), 0) / cr.length;
      const pm = cr.reduce((s, x) => s + Math.abs(x.p), 0) / cr.length;
      const under = cr.reduce((s, x) => s + Math.max(0, -x.p - 2), 0) / cr.length;
      total += 2 * mv + pm + 1.5 * under;
    }
    return total / (nc || 1);
  };
  // burnExp LOCKED at the physical 0.86 (the empirical Vieille exponent); let
  // the physically-motivated LD term + heat-loss/gain carry the cross-cartridge
  // correction rather than overfitting the exponent.
  let best = { kBurn: 1.05, sebertScale: 0.225, burnExp: 0.86, ldSlope: 0, cost: Infinity };
  const bE = 0.86;
  for (let kB = 1.0; kB <= 1.12; kB += 0.02)
    for (let sS = 0.05; sS <= 0.32; sS += 0.02)
      for (let ld = 0.0; ld <= 2.4; ld += 0.15) {
        const c = cost(evalSet(real, { kBurn: kB, sebertScale: sS, burnExp: bE, ldSlope: ld }));
        if (c < best.cost) best = { kBurn: kB, sebertScale: sS, burnExp: bE, ldSlope: ld, cost: c };
      }
  console.log(`\n========== RE-FIT (+LD term): kBurn=${best.kBurn.toFixed(3)} sebertScale=${best.sebertScale.toFixed(3)} burnExp=${best.burnExp.toFixed(2)} ldSlope=${best.ldSlope.toFixed(2)} ==========`);
  const e2 = evalSet(real, best);
  report('ALL realistic', e2);
  for (const c of carts) report(c, e2.filter((x) => x.cart === c));
  console.log('\n--- refit signed Pmax by fill ratio ---');
  bucketSigned(e2, (x) => `fill ${Math.round(x.fill * 100)}%`);
  console.log('--- refit signed Pmax by Ba bucket ---');
  bucketSigned(
    e2,
    (x) => (x.ba < 0.4 ? 'Ba<0.4' : x.ba < 0.6 ? 'Ba0.4-0.6' : x.ba < 0.8 ? 'Ba0.6-0.8' : 'Ba>0.8'),
    ['Ba<0.4', 'Ba0.4-0.6', 'Ba0.6-0.8', 'Ba>0.8'],
  );
}
main();
