'use client';

// LoadLabPanel — the Load Lab surface on the /ask-gg page. Two sub-views,
// toggled by the segmented control at the top:
//
//   • Load data  — a PRO-gated browser over PUBLISHED reloading-manual load
//                  data, organised by calibre (<LoadDataBrowser>). Leads.
//   • Powder chart — the relative burn-rate reference chart (<PowderBurnChart>).
//
// The old internal/external ballistics CALCULATOR (compute engine, component
// pickers, charge ladder, DOPE, recommended-loads column) has been retired —
// Load Lab is now a browser over the published manual data, not a predictor.

import { useState } from 'react';
import { LoadDataBrowser } from './LoadDataBrowser';
import { PowderBurnChart } from './PowderBurnChart';

type SubView = 'loaddata' | 'chart';

export function LoadLabPanel() {
  // Load data leads — the published-manual browser is the headline surface;
  // the powder chart is reference material one tap away.
  const [subView, setSubView] = useState<SubView>('loaddata');

  return (
    <div style={{ marginBottom: 12 }}>
      {/* Panel header */}
      <div style={{ marginBottom: 12 }}>
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
          Browse published reloading-manual load data by calibre, plus a
          relative powder burn-rate chart
        </p>
      </div>

      {/* Load data | Powder chart */}
      <SubViewToggle value={subView} onChange={setSubView} />

      {subView === 'loaddata' ? (
        <LoadDataBrowser />
      ) : (
        <section
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            borderRadius: 8,
            padding: 16,
          }}
          aria-label="Powder burn-rate chart"
        >
          <PowderBurnChart />
        </section>
      )}
    </div>
  );
}

/** Load data | Powder chart segmented toggle at the top of the Load Lab. */
function SubViewToggle({
  value,
  onChange,
}: {
  value: SubView;
  onChange: (v: SubView) => void;
}) {
  const opts: { v: SubView; label: string }[] = [
    { v: 'loaddata', label: 'Load data' },
    { v: 'chart', label: 'Powder chart' },
  ];
  return (
    <div
      role="tablist"
      aria-label="Load Lab view"
      style={{
        display: 'inline-flex',
        background: 'var(--bg-inset)',
        border: '0.5px solid var(--border)',
        borderRadius: 999,
        padding: 3,
        gap: 3,
        marginBottom: 12,
      }}
    >
      {opts.map((o) => {
        const active = value === o.v;
        return (
          <button
            key={o.v}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.v)}
            style={{
              padding: '6px 16px',
              borderRadius: 999,
              border: 'none',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: active ? 600 : 500,
              background: active ? 'var(--red)' : 'transparent',
              color: active ? '#fff' : 'var(--text-secondary)',
              transition: 'background 120ms',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
