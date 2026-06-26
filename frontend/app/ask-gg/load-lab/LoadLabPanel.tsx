'use client';

// LoadLabPanel — the rich, PRO-gated Load Lab surface. Renders the
// Hunter|Competition toggle, the three component pickers + numeric inputs,
// a Compute button that POSTs to /load-lab/compute, and the shared
// <LoadLabResultCard> with the result. A non-PRO user gets an upgrade
// nudge instead of a result. Mounts at the top of the Ask GG messages
// scroll region.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLoadLab } from '@/lib/use-load-lab';
import {
  isUpgradeRequired,
  type LoadLabBulletHit,
  type LoadLabCartridgeHit,
  type LoadLabComputeInput,
  type LoadLabMode,
  type LoadLabPowderHit,
  type LoadLabResult,
  type LoadLabUpgradeRequired,
} from '@/lib/load-lab-types';
import { NumberStepper } from '@/components/number-stepper';
import { ComponentPicker } from './ComponentPicker';
import { LoadLabResultCard } from './LoadLabResultCard';

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  color: 'var(--text-tertiary)',
  fontWeight: 600,
  display: 'block',
  marginBottom: 5,
};

export function LoadLabPanel() {
  const { mode, setMode, loading, error, compute } = useLoadLab();

  const [cartridge, setCartridge] = useState<LoadLabCartridgeHit | null>(null);
  const [bullet, setBullet] = useState<LoadLabBulletHit | null>(null);
  const [powder, setPowder] = useState<LoadLabPowderHit | null>(null);

  // Numeric inputs are held as strings (NumberStepper is string-controlled).
  const [chargeGr, setChargeGr] = useState('');
  const [barrelIn, setBarrelIn] = useState('24');
  const [coalIn, setCoalIn] = useState('');
  const [caseVol, setCaseVol] = useState('');
  const [zeroM, setZeroM] = useState('100');
  const [tempC, setTempC] = useState('15');
  const [altitudeM, setAltitudeM] = useState('0');

  const [result, setResult] = useState<LoadLabResult | null>(null);
  const [upgrade, setUpgrade] = useState<LoadLabUpgradeRequired | null>(null);

  const isComp = mode === 'competition';

  const canCompute = useMemo(
    () =>
      !!cartridge &&
      !!bullet &&
      !!powder &&
      chargeGr.trim() !== '' &&
      Number.parseFloat(chargeGr) > 0 &&
      barrelIn.trim() !== '' &&
      Number.parseFloat(barrelIn) > 0,
    [cartridge, bullet, powder, chargeGr, barrelIn],
  );

  async function handleCompute() {
    if (!canCompute || !cartridge || !bullet || !powder) return;
    const input: LoadLabComputeInput = {
      cartridge: cartridge.name,
      bulletId: bullet.id,
      powderName: powder.name,
      powderMaker: powder.maker || undefined,
      chargeGr: Number.parseFloat(chargeGr),
      barrelLengthIn: Number.parseFloat(barrelIn),
    };
    // COAL (cartridge overall length, inches → mm) sets the bullet seating
    // depth, hence how much case volume the bullet base displaces — drives the
    // effective case volume and the case fill %. Applies in both modes.
    if (coalIn.trim() !== '')
      input.coalMm = Number.parseFloat(coalIn) * 25.4;
    // Competition surfaces the advanced environmental + case inputs, plus a
    // charge ladder centred on the entered charge.
    if (isComp) {
      if (caseVol.trim() !== '') input.caseVolGrH2O = Number.parseFloat(caseVol);
      if (zeroM.trim() !== '') input.zeroM = Number.parseFloat(zeroM);
      if (tempC.trim() !== '') input.tempC = Number.parseFloat(tempC);
      if (altitudeM.trim() !== '')
        input.altitudeM = Number.parseFloat(altitudeM);
      input.ladder = { steps: 7, stepGr: 0.3 };
    } else if (zeroM.trim() !== '') {
      // Hunter keeps a zero so the downrange chart is meaningful.
      input.zeroM = Number.parseFloat(zeroM);
    }

    try {
      const res = await compute(input);
      if (isUpgradeRequired(res)) {
        setUpgrade(res);
        setResult(null);
      } else {
        setResult(res);
        setUpgrade(null);
      }
    } catch {
      // error is already surfaced by the hook's error state.
      setResult(null);
      setUpgrade(null);
    }
  }

  return (
    <section
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: 8,
        padding: 16,
        marginBottom: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
      aria-label="Load Lab"
    >
      {/* Header — title + Hunter|Competition segmented toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            Load Lab
          </h2>
          <p
            style={{
              margin: '2px 0 0',
              fontSize: 11,
              color: 'var(--text-tertiary)',
            }}
          >
            Advisory internal &amp; external ballistics estimate
          </p>
        </div>
        <ModeToggle mode={mode} onChange={setMode} />
      </div>

      {/* Pickers */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
        }}
      >
        <div>
          <label style={fieldLabelStyle}>Cartridge</label>
          <ComponentPicker<LoadLabCartridgeHit>
            kind="cartridge"
            value={cartridge}
            onSelect={setCartridge}
            placeholder="e.g. 308 Winchester"
          />
        </div>
        <div>
          <label style={fieldLabelStyle}>Bullet</label>
          <ComponentPicker<LoadLabBulletHit>
            kind="bullet"
            value={bullet}
            onSelect={setBullet}
            placeholder="Maker or name"
            grooveMm={cartridge?.grooveMm}
          />
        </div>
        <div>
          <label style={fieldLabelStyle}>Powder</label>
          <ComponentPicker<LoadLabPowderHit>
            kind="powder"
            value={powder}
            onSelect={setPowder}
            placeholder="Maker or name"
          />
        </div>
      </div>

      {/* Numeric inputs */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 12,
        }}
      >
        <div>
          <label style={fieldLabelStyle}>Charge (gr)</label>
          <NumberStepper
            value={chargeGr}
            onChange={setChargeGr}
            step={0.1}
            min={0}
            suffix="gr"
            placeholder="0.0"
            aria-label="Charge weight in grains"
          />
        </div>
        <div>
          <label style={fieldLabelStyle}>Barrel (in)</label>
          <NumberStepper
            value={barrelIn}
            onChange={setBarrelIn}
            step={0.5}
            min={1}
            max={50}
            suffix="in"
            aria-label="Barrel length in inches"
          />
        </div>
        <div>
          <label style={fieldLabelStyle}>Cartridge OAL (in)</label>
          <NumberStepper
            value={coalIn}
            onChange={setCoalIn}
            step={0.01}
            min={0}
            max={6}
            suffix="in"
            placeholder="auto (max)"
            aria-label="Cartridge overall length in inches"
          />
        </div>
        {/* Hunter shows zero only; Competition adds the advanced inputs. */}
        <div>
          <label style={fieldLabelStyle}>Zero (m)</label>
          <NumberStepper
            value={zeroM}
            onChange={setZeroM}
            step={5}
            min={0}
            max={1000}
            suffix="m"
            aria-label="Zero range in metres"
          />
        </div>
        {isComp && (
          <>
            <div>
              <label style={fieldLabelStyle}>Case volume (gr H₂O)</label>
              <NumberStepper
                value={caseVol}
                onChange={setCaseVol}
                step={0.1}
                min={0}
                suffix="gr"
                placeholder={
                  cartridge ? String(cartridge.caseVolGrH2O) : 'auto'
                }
                aria-label="Case volume in grains of water"
              />
            </div>
            <div>
              <label style={fieldLabelStyle}>Temperature (°C)</label>
              <NumberStepper
                value={tempC}
                onChange={setTempC}
                step={1}
                min={-40}
                max={60}
                suffix="°C"
                aria-label="Air temperature in Celsius"
              />
            </div>
            <div>
              <label style={fieldLabelStyle}>Altitude (m)</label>
              <NumberStepper
                value={altitudeM}
                onChange={setAltitudeM}
                step={50}
                min={0}
                max={5000}
                suffix="m"
                aria-label="Altitude in metres"
              />
            </div>
          </>
        )}
      </div>

      {/* Compute */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          onClick={() => void handleCompute()}
          disabled={!canCompute || loading}
          style={{
            padding: '10px 22px',
            borderRadius: 8,
            border: 'none',
            background: !canCompute || loading ? 'var(--bg-inset)' : 'var(--red)',
            color: !canCompute || loading ? 'var(--text-tertiary)' : '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: !canCompute || loading ? 'not-allowed' : 'pointer',
            transition: 'background 140ms',
          }}
        >
          {loading ? 'Computing…' : 'Compute'}
        </button>
        {!canCompute && (
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            Pick a cartridge, bullet, powder and charge to run.
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            background: 'rgba(200,16,46,0.10)',
            border: '0.5px solid var(--red)',
            color: 'var(--red)',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {/* Upgrade nudge (non-PRO) */}
      {upgrade && <UpgradeNudge reason={upgrade.reason} />}

      {/* Result */}
      {result && (
        <LoadLabResultCard
          result={result}
          mode={mode}
          onPickCharge={(gr) => setChargeGr(String(gr))}
        />
      )}
    </section>
  );
}

// ─── Segmented Hunter|Competition toggle (red active pill) ───────────

function ModeToggle({
  mode,
  onChange,
}: {
  mode: LoadLabMode;
  onChange: (m: LoadLabMode) => void;
}) {
  const opts: { key: LoadLabMode; label: string }[] = [
    { key: 'hunter', label: 'Hunter' },
    { key: 'competition', label: 'Competition' },
  ];
  return (
    <div
      role="tablist"
      aria-label="Load Lab mode"
      style={{
        display: 'inline-flex',
        background: 'var(--bg-inset)',
        border: '0.5px solid var(--border)',
        borderRadius: 999,
        padding: 3,
        gap: 2,
      }}
    >
      {opts.map((o) => {
        const active = mode === o.key;
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.key)}
            style={{
              padding: '5px 14px',
              borderRadius: 999,
              border: 'none',
              background: active ? 'var(--red)' : 'transparent',
              color: active ? '#fff' : 'var(--text-secondary)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background 140ms',
              fontFamily: 'inherit',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── PRO upgrade nudge ──────────────────────────────────────────────

function UpgradeNudge({ reason }: { reason: string }) {
  return (
    <div
      role="status"
      style={{
        padding: '14px 16px',
        borderRadius: 10,
        background: 'rgba(200,16,46,0.08)',
        border: '0.5px solid rgba(200,16,46,0.35)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <span
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          color: 'var(--red)',
          fontWeight: 600,
        }}
      >
        Pro feature
      </span>
      <span
        style={{
          fontSize: 13,
          color: 'var(--text-primary)',
          lineHeight: 1.45,
        }}
      >
        {reason ||
          'Load Lab is a Pro feature. Upgrade for full internal & external ballistics, charge ladders, and DOPE tables.'}
      </span>
      <Link
        href="/ask-gg"
        style={{
          alignSelf: 'flex-start',
          padding: '8px 14px',
          background: 'var(--bg-inset)',
          color: 'var(--text-secondary)',
          border: '0.5px solid var(--border-hover)',
          borderRadius: 8,
          fontSize: 12,
          textDecoration: 'none',
        }}
      >
        Subscription launching soon
      </Link>
    </div>
  );
}
