/**
 * Smoke test the Load Lab backend chain end-to-end (no Nest DI):
 * component lookup → computed geometry → internal engine → downrange.
 * Run: cd backend && npx ts-node --project tsconfig.json scripts/load-lab-smoke.ts
 */
import { BallisticsService } from '../src/ballistics/ballistics.service';
import { ComponentDataService } from '../src/load-lab/component-data.service';
import { LoadLabService } from '../src/load-lab/load-lab.service';

const comp = new ComponentDataService();
const bal = new BallisticsService();
const lab = new LoadLabService(comp, bal);

// Find a Sierra ~120gr 6.5mm (.264) bullet for the 6.5 Creedmoor.
const bullets = comp.searchBullets('Sierra', 50, 6.71);
const b120 = bullets.find((b) => Math.abs(b.weightGr - 120) < 5) ?? bullets[0];
console.log(
  `bullet: ${b120?.maker} ${b120?.name} ${b120?.weightGr}gr (id ${b120?.id}, G1 ${b120?.g1bc})`,
);

const r = lab.compute({
  cartridge: '6.5 Creedmoor',
  bulletId: b120.id,
  powderName: 'N540',
  powderMaker: 'Vihtavuori',
  chargeGr: 41,
  barrelLengthIn: 24,
  zeroM: 100,
  ladder: { steps: 5, stepGr: 1 },
});

console.log('\n=== geometry (computed, vs GRT eff vol 3.10 / area 34.66 / travel 570) ===');
console.log(r.geometry);
console.log('\n=== load (case fill) ===');
console.log(r.load);
console.log('\n=== COAL effect on case fill (deeper seating → less volume → higher fill) ===');
for (const coalIn of [2.95, 2.80, 2.70, 2.60]) {
  const rc = lab.compute({
    cartridge: '6.5 Creedmoor',
    bulletId: b120.id,
    powderName: 'N540',
    powderMaker: 'Vihtavuori',
    chargeGr: 41,
    barrelLengthIn: 24,
    coalMm: coalIn * 25.4,
  });
  console.log(
    `  COAL ${coalIn}" -> seated ${rc.geometry.seatingDepthMm}mm, eff ${rc.geometry.initialGasVolumeCm3}cm³, fill ${rc.load.caseFillPct}%`,
  );
}
console.log('\n=== internal (vs GRT: MV 2981 fps, Pmax 4233 bar) ===');
console.log({
  pMaxBar: r.internal.pMaxBar,
  vMuzzleFps: r.internal.vMuzzleFps,
  barrelTimeMs: r.internal.barrelTimeMs,
  percentBurnt: r.internal.percentBurnt,
  efficiencyPct: r.internal.efficiencyPct,
  curvePts: r.internal.curve.length,
});
console.log('\n=== safety ===');
console.log(r.safety);
console.log('\n=== external (downrange) ===');
if (r.external) {
  console.log(
    `supersonic to ${r.external.supersonicRangeM} m, transonic to ${r.external.transonicRangeM} m`,
  );
  for (const row of r.external.rows.filter((x) =>
    [100, 300, 500, 1000].includes(x.rangeM),
  )) {
    console.log(
      `  ${row.rangeM}m: drop ${row.dropCm}cm (${row.dropMil}mil), ${row.velocityFps}fps, ${row.energyJoules}J`,
    );
  }
}
console.log('\n=== ladder ===');
for (const l of r.ladder)
  console.log(`  ${l.chargeGr}gr -> ${l.vMuzzleFps}fps, ${l.pMaxBar}bar (${l.pctOfMax}% of max)`);
