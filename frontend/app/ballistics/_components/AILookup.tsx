// frontend/app/ballistics/_components/AILookup.tsx
//
// AI Bullet Lookup card — the killer differentiator. User types a
// bullet description, Claude responds with weight + BC + typical MV
// + confidence pill. One tap on "USE THIS LOAD" applies the result
// to the active profile.
//
// Statuses driven by useBulletLookup:
//   - idle      → empty input + LOOKUP button enabled
//   - loading   → shimmer placeholder where the result will land
//   - result    → 3 mini-stat tiles + USE THIS LOAD CTA
//   - demo-exhausted → upgrade card with R299 CTA (replaces input)
//   - rate-limited   → cool-off card with retry-after countdown
//   - error          → small error chip + manual entry hint
//   - offline-fallback → cached badge instead of AI MATCH
//
// Visual design (locked):
//   - On "result", LOAD card gets `.bc-ai-load` (left red bar +
//     soft red background) and an "AI MATCH" pill above the title.
//   - 3-up grid: WEIGHT (gr) | BC (G1 or G7) | TYP MV (fps)

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useBulletLookup } from '@/lib/use-bullet-lookup';
import type { ActiveProfile } from '@/lib/use-ballistic-profile';

interface AILookupProps {
  onApply: (patch: Partial<ActiveProfile>) => void;
  disabled?: boolean; // demo-mode lock from license check
}

export function AILookup({ onApply, disabled }: AILookupProps) {
  const [query, setQuery] = useState('');
  const { status, result, error, lookup, reset } = useBulletLookup();

  const handleApply = () => {
    if (!result) return;
    onApply({
      bulletName: result.name ?? query,
      bulletWeightGr: result.weightGr ?? undefined,
      bcG1: result.bcG1 ?? undefined,
      bcG7: result.bcG7 ?? undefined,
      dragModel: result.recommendedDragModel,
      muzzleVelocityFps: result.typicalMvFps ?? undefined,
      aiSourced: result.source === 'ai',
    } as Partial<ActiveProfile>);
    setQuery('');
    reset();
  };

  return (
    <section className="bc-card">
      <div className="bc-card-h">
        <span className="ttl">AI Bullet Lookup</span>
        <span className="bc-label-xs">Claude · Haiku 4.5</span>
      </div>

      {status === 'demo-exhausted' ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          <p style={{ fontSize: 13, color: 'var(--bc-text-2)', margin: 0 }}>
            You've used your free demo lookup. Buy the lifetime license to
            keep going — unlimited AI lookups, no recurring fee.
          </p>
          <Link href="/ballistics/purchase" className="bc-tap primary">
            Unlock — R299
          </Link>
        </div>
      ) : status === 'rate-limited' ? (
        <div>
          <p style={{ fontSize: 13, color: 'var(--bc-text-2)', margin: '0 0 8px' }}>
            Quick break — fair-use cap reached.
            {error?.retryAfterSec
              ? ` Back in ${Math.ceil(error.retryAfterSec / 60)} min.`
              : ' Try again shortly.'}
          </p>
          <button type="button" className="bc-tap ghost" onClick={reset}>
            OK
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='e.g. "175gr Sierra MatchKing"'
              disabled={disabled || status === 'loading'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && query.trim() && status !== 'loading') {
                  lookup(query);
                }
              }}
              style={{
                flex: 1,
                background: 'var(--bc-surface-2)',
                border: '1px solid var(--bc-line)',
                borderRadius: 'var(--bc-r-md)',
                padding: '12px 14px',
                color: 'var(--bc-text)',
                fontFamily: 'var(--font-bc-ui)',
                fontSize: 14,
                minHeight: 44,
                outline: 'none',
              }}
            />
            <button
              type="button"
              className="bc-tap primary"
              onClick={() => lookup(query)}
              disabled={
                disabled || !query.trim() || status === 'loading'
              }
              style={{ minWidth: 96 }}
            >
              {status === 'loading' ? 'Looking…' : 'LOOKUP'}
            </button>
          </div>

          {status === 'loading' && (
            <div
              style={{
                marginTop: 14,
                padding: 14,
                borderRadius: 'var(--bc-r-md)',
                background:
                  'linear-gradient(90deg, var(--bc-surface-2) 0%, var(--bc-surface-3) 50%, var(--bc-surface-2) 100%)',
                backgroundSize: '200% 100%',
                animation: 'bc-shimmer 1.4s ease infinite',
                height: 92,
              }}
              aria-busy
              aria-live="polite"
            />
          )}

          {result && (
            <div
              className={`bc-card ${result.source === 'ai' ? 'bc-ai-load' : ''}`}
              style={{ marginTop: 14 }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                {result.source === 'ai' ? (
                  <span className="bc-ai-pill">AI MATCH</span>
                ) : (
                  <span
                    className="bc-ai-pill"
                    style={{ background: 'var(--bc-surface-4)' }}
                  >
                    CACHED
                  </span>
                )}
                <span
                  className="bc-chip"
                  style={{
                    background:
                      result.confidence === 'high'
                        ? 'var(--bc-red-soft)'
                        : 'var(--bc-surface-2)',
                  }}
                >
                  <span className="lbl">conf</span>
                  <span className="val">{result.confidence}</span>
                </span>
              </div>

              <div
                style={{
                  fontFamily: 'var(--font-bc-mono)',
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--bc-text)',
                  marginBottom: 12,
                }}
              >
                {result.name ?? query}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 10,
                  marginBottom: 14,
                }}
              >
                <MiniStat
                  label="Weight"
                  value={result.weightGr != null ? String(result.weightGr) : '—'}
                  unit="gr"
                />
                <MiniStat
                  label={`BC ${result.recommendedDragModel}`}
                  value={
                    result.recommendedDragModel === 'G7' && result.bcG7
                      ? result.bcG7.toFixed(3)
                      : result.bcG1
                        ? result.bcG1.toFixed(3)
                        : '—'
                  }
                />
                <MiniStat
                  label="Typ MV"
                  value={
                    result.typicalMvFps
                      ? String(result.typicalMvFps)
                      : '—'
                  }
                  unit="fps"
                />
              </div>

              {result.notes && (
                <p
                  style={{
                    fontSize: 11,
                    color: 'var(--bc-text-dim)',
                    margin: '0 0 12px',
                    lineHeight: 1.4,
                  }}
                >
                  {result.notes}
                </p>
              )}

              {result.sources.length > 0 && (
                <p
                  style={{
                    fontSize: 10,
                    color: 'var(--bc-text-mute)',
                    margin: '0 0 12px',
                    fontFamily: 'var(--font-bc-mono)',
                    letterSpacing: '0.04em',
                  }}
                >
                  Source: {result.sources.join(' · ')}
                </p>
              )}

              <button
                type="button"
                className="bc-tap primary"
                onClick={handleApply}
                disabled={disabled}
                style={{ width: '100%' }}
              >
                USE THIS LOAD ↓
              </button>
            </div>
          )}

          {status === 'error' && error && (
            <div
              style={{
                marginTop: 12,
                padding: 10,
                background: 'var(--bc-surface-2)',
                border: '1px solid var(--bc-line)',
                borderRadius: 'var(--bc-r-sm)',
                fontSize: 12,
                color: 'var(--bc-text-dim)',
              }}
            >
              {error.message}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function MiniStat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div
      style={{
        background: 'var(--bc-surface-2)',
        border: '1px solid var(--bc-line)',
        borderRadius: 'var(--bc-r-sm)',
        padding: '8px 10px',
        textAlign: 'center',
      }}
    >
      <div className="bc-label-xs" style={{ fontSize: 9 }}>
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-bc-mono)',
          fontSize: 18,
          fontWeight: 600,
          color: 'var(--bc-text)',
          marginTop: 4,
        }}
      >
        {value}
        {unit && (
          <span
            className="bc-num-unit"
            style={{ fontSize: 9, marginLeft: 4 }}
          >
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}
