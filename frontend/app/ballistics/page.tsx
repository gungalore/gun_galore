// frontend/app/ballistics/page.tsx
//
// HUNT mode default — the "Elevation Tank" design from the locked
// mock. Big readout dominates the screen; everything else is
// supporting context the shooter glances at, not reads.
//
// Operator brief (verbatim, 2026-05-26):
//   "Hunting — where speed of data matters, so big buttons and few
//    things cluttering the screen. I need to have four extra smaller
//    given dials in increments of 50m. Two closer and two further."
//
// All math runs client-side via `solveSingleRange` from the shared
// port. No network on the critical path. Zero stepper jank.

'use client';

import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import {
  solveSingleRange,
  type BallisticsInput,
  type DragModel,
} from '@/lib/ballistics-calc';
import {
  useBallisticProfile,
  FACTORY_DEFAULT_PROFILE,
  type ActiveProfile,
} from '@/lib/use-ballistic-profile';

const DEMO_MAX_RANGE_M = 200;
const FULL_MAX_RANGE_M = 1500;
const RANGE_STEP_M = 25;
const INTERVAL_OFFSETS_M = [-100, -50, 0, 50, 100] as const;

function profileToInput(p: ActiveProfile): Omit<BallisticsInput, 'ranges'> {
  return {
    bulletWeightGr: p.bulletWeightGr,
    bc: p.dragModel === 'G7' && p.bcG7 ? p.bcG7 : p.bcG1,
    dragModel: (p.dragModel === 'G7' && p.bcG7 ? 'G7' : 'G1') as DragModel,
    muzzleVelocityFps: p.muzzleVelocityFps,
    zeroM: p.zeroM,
    sightHeightCm: p.sightHeightCm,
  };
}

function formatElev(
  mil: number,
  unit: 'mil' | 'moa' | 'clk',
  zeroAdjMil: number,
): { value: string; unit: string; direction: 'UP' | 'DOWN' | 'ZERO' } {
  const adjusted = mil + zeroAdjMil;
  const abs = Math.abs(adjusted);
  const direction = abs < 0.05 ? 'ZERO' : adjusted >= 0 ? 'UP' : 'DOWN';
  if (unit === 'moa') {
    return { value: (abs * 3.4377).toFixed(1), unit: 'MOA', direction };
  }
  if (unit === 'clk') {
    return { value: String(Math.round(abs / 0.1)), unit: 'CLK', direction };
  }
  return { value: abs.toFixed(1), unit: 'MIL', direction };
}

export default function BallisticsHuntPage() {
  const [demoMode, setDemoMode] = useState(true);
  const [licenseLoaded, setLicenseLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/ballistics/license', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { purchased?: boolean } | null) => {
        if (data?.purchased) setDemoMode(false);
      })
      .catch(() => {})
      .finally(() => setLicenseLoaded(true));
  }, []);

  const { profile, update, locked } = useBallisticProfile({ locked: demoMode });
  const [rangeM, setRangeM] = useState(profile.zeroM);

  useEffect(() => {
    if (rangeM === FACTORY_DEFAULT_PROFILE.zeroM && profile.zeroM !== rangeM) {
      setRangeM(profile.zeroM);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.zeroM]);

  const cap = demoMode ? DEMO_MAX_RANGE_M : FULL_MAX_RANGE_M;
  const baseInput = useMemo(() => profileToInput(profile), [profile]);

  const intervalRows = useMemo(() => {
    return INTERVAL_OFFSETS_M.map((delta) => {
      const r = Math.max(25, rangeM + delta);
      if (r > cap) return { rangeM: r, dropMil: null };
      try {
        const row = solveSingleRange(baseInput, r);
        return { rangeM: r, dropMil: row.dropMil };
      } catch {
        return { rangeM: r, dropMil: null };
      }
    });
  }, [baseInput, rangeM, cap]);

  const windRows = useMemo(() => {
    return [0, 10, 20].map((kmh) => {
      const mps = kmh / 3.6;
      try {
        const row = solveSingleRange(
          { ...baseInput, windSpeedMps: mps, windDirectionDeg: 90 },
          rangeM,
        );
        return { kmh, windMil: row.windageMil };
      } catch {
        return { kmh, windMil: null };
      }
    });
  }, [baseInput, rangeM]);

  const currentRow = intervalRows[2];
  const elev =
    currentRow.dropMil !== null
      ? formatElev(currentRow.dropMil, profile.preferredUnitElev, profile.zeroAdjMil)
      : { value: '—', unit: profile.preferredUnitElev.toUpperCase(), direction: 'ZERO' as const };

  const stepRange = (delta: number) => {
    setRangeM((r) => Math.max(25, Math.min(cap, r + delta)));
  };

  const cycleUnit = () => {
    if (locked) return;
    const order: Array<'mil' | 'moa' | 'clk'> = ['mil', 'moa', 'clk'];
    const idx = order.indexOf(profile.preferredUnitElev);
    update({ preferredUnitElev: order[(idx + 1) % order.length] });
  };

  return (
    <>
      <header className="bc-topbar">
        <div className="bc-brand">
          <span className="bc-brand-dot" />
          GUN&nbsp;GALORE&nbsp;BC
        </div>
        <div className="bc-mode-toggle" role="tablist">
          <button type="button" className="is-active">HUNT</button>
          <Link href="/ballistics/precision" style={{ all: 'unset', cursor: 'pointer' }}>
            <button type="button">PRO</button>
          </Link>
        </div>
      </header>

      <main className="bc-page">
        <section aria-label="Active profile" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className="bc-chip">
            <span className="lbl">Rifle</span>
            <span className="val">{profile.rifleName ?? '—'}</span>
          </span>
          <span className="bc-chip">
            <span className="lbl">Bullet</span>
            <span className="val">{profile.bulletName}</span>
          </span>
          <span className="bc-chip">
            <span className="lbl">Zero</span>
            <span className="val">{profile.zeroM}m</span>
          </span>
        </section>

        <section className="bc-readout" aria-live="polite">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span className="bc-label-xs">Hold</span>
            <button type="button" onClick={cycleUnit} className="bc-chip" style={{ cursor: 'pointer' }}>
              <span className="val">{elev.unit}</span>
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 14 }}>
            <span className="bc-num" style={{ fontSize: 84, fontWeight: 600 }}>{elev.value}</span>
            <span
              className="bc-label-xs"
              style={{
                fontSize: 24,
                letterSpacing: '0.16em',
                color:
                  elev.direction === 'UP' ? 'var(--bc-red)'
                  : elev.direction === 'DOWN' ? 'var(--bc-good)'
                  : 'var(--bc-text-mute)',
              }}
            >
              {elev.direction}
            </span>
          </div>
          <div style={{ textAlign: 'center', marginTop: 6 }}>
            <span className="bc-label-xs">
              At {rangeM}m · {profile.bulletWeightGr}gr · {profile.muzzleVelocityFps} fps
            </span>
          </div>
        </section>

        <section aria-label="Range intervals" className="bc-interval-strip">
          {intervalRows.map((row, i) => {
            const isCurrent = INTERVAL_OFFSETS_M[i] === 0;
            const tooFar = row.rangeM > cap;
            return (
              <div key={row.rangeM + '-' + i} className={`bc-interval ${isCurrent ? 'is-current' : ''}`}>
                <div className="ri">{tooFar ? '—' : row.rangeM + 'm'}</div>
                <div className="hi">
                  {row.dropMil === null ? '—' : formatElev(row.dropMil, profile.preferredUnitElev, profile.zeroAdjMil).value}
                </div>
              </div>
            );
          })}
        </section>

        <section aria-label="Wind call" className="bc-card">
          <div className="bc-card-h">
            <span className="ttl">Wind · full value</span>
            <span className="bc-label-xs">{profile.preferredUnitElev.toUpperCase()}</span>
          </div>
          <div className="bc-wind-grid">
            {windRows.map((w) => (
              <div key={w.kmh} className="bc-wind-cell">
                <div className="speed">{w.kmh} km/h</div>
                <div className="drift">
                  {w.windMil === null ? '—' : formatElev(w.windMil, profile.preferredUnitElev, 0).value}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section aria-label="Range stepper" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
          <button type="button" className="bc-step" aria-label={`Decrease range by ${RANGE_STEP_M} metres`} onClick={() => stepRange(-RANGE_STEP_M)}>−</button>
          <div className="bc-range-pill">
            <span className="v">{rangeM}</span>
            <span className="u">M</span>
          </div>
          <button type="button" className="bc-step" aria-label={`Increase range by ${RANGE_STEP_M} metres`} onClick={() => stepRange(RANGE_STEP_M)}>+</button>
        </section>

        <section aria-label="Zero adjustment" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span className="bc-label-xs">Truing offset</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" className="bc-chip" style={{ cursor: 'pointer' }} onClick={() => update({ zeroAdjMil: profile.zeroAdjMil - 0.1 })} disabled={locked}>−0.1</button>
            <span className="bc-chip">
              <span className="lbl">Adj</span>
              <span className="val">{profile.zeroAdjMil >= 0 ? '+' : ''}{profile.zeroAdjMil.toFixed(1)} mil</span>
            </span>
            <button type="button" className="bc-chip" style={{ cursor: 'pointer' }} onClick={() => update({ zeroAdjMil: profile.zeroAdjMil + 0.1 })} disabled={locked}>+0.1</button>
          </div>
        </section>

        {!demoMode && (
          <section style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 4 }}>
            <Link href="/ballistics/profile" className="bc-tap ghost" style={{ flex: 1 }}>Profile</Link>
            <Link href="/ballistics/precision" className="bc-tap ghost" style={{ flex: 1 }}>Precision</Link>
            <Link href="/ballistics/dope" className="bc-tap ghost" style={{ flex: 1 }}>DOPE</Link>
          </section>
        )}

        {demoMode && (
          <section style={{ marginTop: 4 }}>
            <Link href="/ballistics/profile" className="bc-tap ghost" style={{ width: '100%' }}>Try AI Bullet Lookup →</Link>
          </section>
        )}
      </main>

      {licenseLoaded && demoMode && (
        <div className="bc-demo-cta">
          <div className="copy">
            Demo mode
            <small>Default load · 200m max · 1 free AI lookup</small>
          </div>
          <Link href="/ballistics/purchase" className="bc-tap primary">
            Unlock — R299
          </Link>
        </div>
      )}
    </>
  );
}
