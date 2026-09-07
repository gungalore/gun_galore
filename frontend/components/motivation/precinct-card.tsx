'use client';

// ────────────────────────────────────────────────────────────────────
// THE PRECINCT CARD — what SAPS's own quarterly release says about the
// station the applicant just named.
//
// ⚠️ THIS IS INFORMATION, NOT A WARNING. A rising count is amber, never red —
// red is reserved for errors and CTAs across the app, and a SAPS-recorded
// fact going into a self-defence motivation is neither. See lib/crime-stats.ts
// (yoyChip) for the tone rule this card renders.
//
// Fetches `/motivations/:id/precinct`, which reads the station off whatever
// `police_station` the server already has saved — not off the value passed
// in here. So this waits a beat after the field stops changing (autosave's
// own AUTOSAVE_MS, plus a little slack) before asking, rather than racing the
// save that has to land first.
// ────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { Skel } from '@/components/skeleton';
import { groupThousands, pickHeadlineCategories, yoyChip } from '@/lib/crime-stats';
import { AUTOSAVE_MS } from '@/lib/motivation-draft';
import {
  motivationsApi,
  type PrecinctFigures,
  type TokenGetter,
} from '@/lib/motivations-api';

// Slack on top of the autosave debounce, so this fetch fires just after the
// save it depends on — not exactly on top of it.
const FETCH_DELAY_MS = AUTOSAVE_MS + 300;

type LoadState = 'idle' | 'loading' | 'ready' | 'empty';

export function PrecinctCard({
  motivationId,
  policeStation,
  getToken,
}: {
  motivationId: string;
  /** The current `police_station` answer — only its presence/change matters. */
  policeStation: string;
  getToken: TokenGetter;
}) {
  const [state, setState] = useState<LoadState>('idle');
  const [figures, setFigures] = useState<PrecinctFigures | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();

    const station = policeStation.trim();
    if (!station) {
      setFigures(null);
      setState('idle');
      return;
    }

    setState('loading');
    debounceRef.current = setTimeout(() => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      motivationsApi
        .precinct(getToken, motivationId, ctrl.signal)
        .then((data) => {
          setFigures(data);
          setState(data ? 'ready' : 'empty');
        })
        .catch((err) => {
          if ((err as Error).name === 'AbortError') return;
          // A failed fetch reads the same as "nothing on file" — never an
          // error banner for an informational side panel.
          setFigures(null);
          setState('empty');
        });
    }, FETCH_DELAY_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, [policeStation, motivationId, getToken]);

  if (state === 'idle') return null;

  if (state === 'loading') {
    return (
      <div
        className="gg-tile mt-3 rounded-[8px] p-4"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        aria-busy="true"
        aria-label="Loading precinct figures"
      >
        <Skel className="h-3 w-1/3" />
        <Skel className="mt-2 h-2.5 w-1/2" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skel key={i} className="h-9 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (state === 'empty' || !figures) {
    return (
      <div
        className="mt-3 rounded-[8px] p-4 text-sm text-[var(--text-tertiary-on-card)]"
        style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)' }}
      >
        No SAPS figures on file for this station yet.
      </div>
    );
  }

  const headline = pickHeadlineCategories(figures.categories, 4);

  return (
    <div
      className="gg-tile mt-3 rounded-[8px] p-4"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
    >
      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
        {figures.station.name}
        <span className="font-normal text-[var(--text-tertiary-on-card)]">
          {' '}
          · {figures.station.district}, {figures.station.province}
        </span>
      </p>
      <p className="mt-0.5 text-xs text-[var(--text-tertiary-on-card)]">
        SAPS quarterly release, {figures.release.periodLabel}
      </p>

      <ul className="mt-3 divide-y divide-[var(--border-divider)]">
        {headline.map((cat) => {
          const chip = yoyChip(cat.yearOnYearPct);
          return (
            <li
              key={cat.category}
              className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                {cat.category}
              </span>
              <span className="gg-nums flex items-center gap-2 text-sm">
                <span style={{ color: 'var(--text-primary)' }}>
                  {groupThousands(cat.latest.count)}
                </span>
                <span className="text-xs text-[var(--text-tertiary-on-card)]">
                  {cat.latest.label}
                </span>
                {chip && (
                  <span
                    className="rounded-full px-2 py-0.5 text-[10.5px] font-medium"
                    style={
                      chip.tone === 'amber'
                        ? {
                            background: 'var(--gold-wash)',
                            color: 'var(--gold-strong)',
                            border: '1px solid var(--gold-line)',
                          }
                        : {
                            background: 'var(--bg-inset)',
                            color: 'var(--text-tertiary)',
                            border: '1px solid transparent',
                          }
                    }
                  >
                    {chip.text} y/y
                  </span>
                )}
                <span className="text-xs text-[var(--text-tertiary-on-card)]">
                  {groupThousands(cat.lastTwelveMonths)} in the last 12 months
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-xs text-[var(--text-tertiary-on-card)]">
        These figures go into your motivation as SAPS-recorded facts for this
        precinct.
      </p>
    </div>
  );
}
