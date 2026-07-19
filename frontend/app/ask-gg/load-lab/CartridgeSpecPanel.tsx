'use client';

// Cartridge reference spec panel — standardised chamber/pressure data from
// our GRT extraction, shown above the load data for the selected cartridge.
// Free to any signed-in reloader. Renders nothing until a spec loads; shows a
// short "no standardised spec" note for wildcats we don't hold data for.
//
// SAFETY: these are REFERENCE dimensions (max pressure, case/overall length,
// capacity) from the SAAMI/CIP standard — NOT a load recipe. The panel says
// so explicitly so a Pmax ceiling is never mistaken for a charge weight.

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface CartridgeSpec {
  cartridgeKey: string;
  displayName: string;
  grtName: string;
  standard: string;
  origin: string | null;
  cartridgeType: string | null;
  year: number | null;
  caseLengthMm: number | null;
  maxCartridgeLengthMm: number | null;
  maxPressureBar: number | null;
  maxPressurePsi: number | null;
  caseCapacityGrH2O: number | null;
  officialPdfUrl: string | null;
}

const STANDARD_LABEL: Record<string, string> = {
  CIP: 'CIP standardised',
  SAAMI: 'SAAMI standardised',
  WILDCAT: 'Wildcat',
  OTHER: 'Reference',
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p
        className="text-[10px] uppercase m-0"
        style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}
      >
        {label}
      </p>
      <p className="text-sm m-0 mt-0.5" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
        {value}
      </p>
    </div>
  );
}

export function CartridgeSpecPanel({ cartridgeKey }: { cartridgeKey: string }) {
  const { getToken } = useAuth();
  const [spec, setSpec] = useState<CartridgeSpec | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setSpec(null);
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const r = await fetch(
          `${API_URL}/load-lab/cartridge-spec?cartridgeKey=${encodeURIComponent(cartridgeKey)}`,
          { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
        );
        if (!r.ok) return;
        const data = (await r.json()) as { spec: CartridgeSpec | null };
        if (!cancelled) setSpec(data.spec);
      } catch {
        /* reference panel is non-critical — stay silent on failure */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cartridgeKey, getToken]);

  if (!loaded) return null;
  if (!spec) return null;

  const isWildcat = spec.standard === 'WILDCAT';
  const pressure =
    spec.maxPressurePsi && spec.maxPressureBar
      ? `${spec.maxPressurePsi.toLocaleString('en-ZA')} psi · ${spec.maxPressureBar.toLocaleString('en-ZA')} bar`
      : null;

  return (
    <div
      className="rounded-[10px] p-4 mb-4"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
    >
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <p className="text-sm font-semibold m-0" style={{ color: 'var(--text-primary)' }}>
          Cartridge spec
        </p>
        <span
          className="text-[10px] uppercase px-2 py-0.5 rounded-[4px] font-semibold"
          style={{
            letterSpacing: '0.05em',
            color: isWildcat ? 'var(--text-tertiary)' : 'var(--red)',
            background: isWildcat ? 'var(--bg-inset)' : 'rgba(200,16,46,0.12)',
          }}
        >
          {STANDARD_LABEL[spec.standard] ?? 'Reference'}
          {spec.origin ? ` · ${spec.origin}` : ''}
          {spec.year ? ` · ${spec.year}` : ''}
        </span>
      </div>

      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}
      >
        {pressure && <Stat label="Max pressure" value={pressure} />}
        {spec.caseLengthMm != null && (
          <Stat label="Case length" value={`${spec.caseLengthMm.toFixed(2)} mm`} />
        )}
        {spec.maxCartridgeLengthMm != null && (
          <Stat label="Max overall length" value={`${spec.maxCartridgeLengthMm.toFixed(2)} mm`} />
        )}
        {spec.caseCapacityGrH2O != null && (
          <Stat label="Case capacity" value={`${spec.caseCapacityGrH2O.toFixed(1)} gr H₂O`} />
        )}
      </div>

      <p
        className="text-xs mt-3 mb-0"
        style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}
      >
        Reference dimensions from the{' '}
        {isWildcat ? 'cartridge design' : `${spec.standard} standard`} — <strong>not a load recipe</strong>.
        The max pressure is the ceiling the cartridge is proofed to, never a charge weight. Always work
        up from a published start load.
        {spec.officialPdfUrl && (
          <>
            {' '}
            <a
              href={spec.officialPdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--red)' }}
            >
              Official datasheet →
            </a>
          </>
        )}
      </p>
    </div>
  );
}
