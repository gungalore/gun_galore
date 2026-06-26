'use client';

// LoadLabResultCard — the shared result surface. Both Hunter and
// Competition modes render this; Competition adds the internal-ballistics
// chart, charge ladder, DOPE table, and %-burnt / barrel-time tiles.
//
// Layout (top → bottom):
//   SafetyOverlay  (always)
//   metric tiles   (always: muzzle velocity, peak pressure w/ %-chip,
//                   supersonic-to range, energy @ ~300 m)
//   + competition tiles: % burnt, barrel time
//   DownrangeChart (always, when external present)
//   PressureVelocityChart + ChargeLadder + DopeTable (competition only)
//   warnings list  (when present)
//   plain-language summary line (always)

import type { LoadLabMode, LoadLabResult } from '@/lib/load-lab-types';
import {
  fmtBar,
  fmtFps,
  fmtJoules,
  fmtMach,
  fmtMetres,
  fmtMs,
  fmtPct,
  machFromFps,
  num,
} from '@/lib/load-lab-format';
import { MetricCard } from './MetricCard';
import { SafetyOverlay } from './SafetyOverlay';
import { DownrangeChart } from './DownrangeChart';
import { PressureVelocityChart } from './PressureVelocityChart';
import { ChargeLadder } from './ChargeLadder';
import { DopeTable } from './DopeTable';

/** Energy at the row nearest 300 m, or null when there's no trajectory. */
function energyNear300(result: LoadLabResult): {
  rangeM: number;
  energyJ: number;
} | null {
  const rows = result.external?.rows;
  if (!rows || rows.length === 0) return null;
  const target = 300;
  const best = rows.reduce((a, b) =>
    Math.abs(b.rangeM - target) < Math.abs(a.rangeM - target) ? b : a,
  );
  return { rangeM: best.rangeM, energyJ: best.energyJoules };
}

export function LoadLabResultCard({
  result,
  mode,
  onPickCharge,
}: {
  result: LoadLabResult;
  mode: LoadLabMode;
  /** Wire the charge-ladder rung clicks back to the panel form. */
  onPickCharge?: (chargeGr: number) => void;
}) {
  const isComp = mode === 'competition';
  const { internal, external, safety, ladder, warnings, load, geometry } =
    result;
  const e300 = energyNear300(result);

  const pressureTone: 'neutral' | 'warning' | 'danger' = safety.overPressure
    ? 'danger'
    : safety.nearMax
      ? 'warning'
      : 'neutral';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SafetyOverlay safety={safety} />

      {/* Metric tiles */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 10,
        }}
      >
        <MetricCard
          label="Muzzle velocity"
          value={fmtFps(internal.vMuzzleFps)}
          sub={`${num(internal.vMuzzleMps)} m/s · ${fmtMach(machFromFps(internal.vMuzzleFps))}`}
        />
        <MetricCard
          label="Peak pressure"
          value={fmtBar(internal.pMaxBar)}
          sub={`ceiling ${fmtBar(safety.pressureCeilingBar)}`}
          chip={{
            text: `${fmtPct(safety.pctOfCeiling)} of max`,
            tone: pressureTone,
          }}
        />
        <MetricCard
          label="Supersonic to"
          value={external ? fmtMetres(external.supersonicRangeM) : '—'}
          sub={
            external
              ? `transonic ${fmtMetres(external.transonicRangeM)}`
              : 'no trajectory'
          }
        />
        <MetricCard
          label={e300 ? `Energy @ ${num(e300.rangeM)} m` : 'Muzzle energy'}
          value={e300 ? fmtJoules(e300.energyJ) : fmtJoules(internal.muzzleEnergyJ)}
          sub={e300 ? `muzzle ${fmtJoules(internal.muzzleEnergyJ)}` : undefined}
        />
        <MetricCard
          label="Case fill"
          value={fmtPct(load.caseFillPct)}
          sub={`loading density ${load.loadingDensityGCm3} g/cm³`}
          chip={
            load.compressed
              ? { text: 'compressed', tone: 'warning' }
              : undefined
          }
        />
        <MetricCard
          label="Case capacity"
          value={`${num(load.caseWaterGrH2O)} gr H₂O`}
          sub={`eff. ${geometry.initialGasVolumeCm3} cm³ · bullet seated ${geometry.seatingDepthMm} mm`}
        />

        {/* Competition-only internal-ballistics tiles */}
        {isComp && (
          <>
            <MetricCard
              label="Powder burnt"
              value={fmtPct(internal.percentBurnt)}
              sub={`efficiency ${fmtPct(internal.efficiencyPct)}`}
            />
            <MetricCard
              label="Barrel time"
              value={fmtMs(internal.barrelTimeMs)}
              sub={`muzzle pressure ${fmtBar(internal.pMuzzleBar)}`}
            />
          </>
        )}
      </div>

      {/* Downrange chart — always (when there's a trajectory) */}
      {external && (
        <DownrangeChart
          rows={external.rows}
          supersonicRangeM={external.supersonicRangeM}
          transonicRangeM={external.transonicRangeM}
        />
      )}

      {/* Competition-only deep surface */}
      {isComp && (
        <>
          <PressureVelocityChart
            curve={internal.curve}
            pressureCeilingBar={safety.pressureCeilingBar}
          />
          {ladder.length > 0 && (
            <ChargeLadder
              ladder={ladder}
              onPick={(gr) => onPickCharge?.(gr)}
            />
          )}
          {external && external.rows.length > 0 && (
            <DopeTable rows={external.rows} />
          )}
        </>
      )}

      {/* Backend warnings */}
      {warnings.length > 0 && (
        <div
          style={{
            background: 'rgba(245,158,11,0.08)',
            border: '0.5px solid var(--warning)',
            borderRadius: 8,
            padding: '10px 14px',
          }}
        >
          <span
            style={{
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: 0.6,
              color: 'var(--warning)',
              fontWeight: 600,
              display: 'block',
              marginBottom: 6,
            }}
          >
            Warnings
          </span>
          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              fontSize: 12,
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
            }}
          >
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Plain-language summary */}
      <p
        style={{
          margin: 0,
          fontSize: 12,
          color: 'var(--text-tertiary)',
          lineHeight: 1.5,
          fontStyle: 'italic',
        }}
      >
        ≈{fmtFps(internal.vMuzzleFps)}, peak {fmtPct(safety.pctOfCeiling)} of max
        {external ? `, supersonic to ${fmtMetres(external.supersonicRangeM)}` : ''}.
      </p>
    </div>
  );
}
