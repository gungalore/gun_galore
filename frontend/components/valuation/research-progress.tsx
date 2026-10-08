'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchValuation, type ValuationResult } from '../../lib/valuation-api';

const STEPS = [
  { key: 'identifying', label: 'Identifying the item' },
  { key: 'searching', label: 'Searching South African listings' },
  { key: 'opening_pages', label: 'Opening listing pages' },
  { key: 'calculating', label: 'Calculating the estimate' },
];

/**
 * Research progress. Polls the valuation state (the reliable path in dev and
 * cross-origin; the backend also exposes an SSE stream) and advances the
 * displayed step on a timer for feedback. On COMPLETED it hands the result
 * back; on FAILED it shows the error and a retry.
 */
export function ResearchProgress({
  valuationId,
  getToken,
  onDone,
  onFailed,
  onRetry,
}: {
  valuationId: string;
  getToken: () => Promise<string | null>;
  onDone: (result: ValuationResult, legalFlags: Array<{ flag: string; message: string }>) => void;
  onFailed: (message: string) => void;
  onRetry: () => void;
}) {
  const [active, setActive] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stopped = useRef(false);

  useEffect(() => {
    const stepTimer = setInterval(() => {
      setActive((a) => Math.min(a + 1, STEPS.length - 1));
    }, 5000);
    const clock = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => {
      clearInterval(stepTimer);
      clearInterval(clock);
    };
  }, []);

  useEffect(() => {
    stopped.current = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (stopped.current) return;
      try {
        const token = await getToken();
        if (!token) throw new Error('Please sign in again.');
        const state = await fetchValuation(token, valuationId);
        if (state.status === 'COMPLETED' && state.result) {
          stopped.current = true;
          setActive(STEPS.length);
          onDone(state.result as ValuationResult, state.legalFlags ?? []);
          return;
        }
        if (state.status === 'FAILED') {
          stopped.current = true;
          onFailed('We could not complete the research. Please try again.');
          return;
        }
      } catch (err) {
        // Transient network error: keep polling unless it is terminal.
        if (err instanceof Error && err.message.includes('401')) {
          stopped.current = true;
          setError('Please sign in again.');
          return;
        }
      }
      timer = setTimeout(poll, 3000);
    }
    void poll();
    return () => {
      stopped.current = true;
      clearTimeout(timer);
    };
  }, [valuationId, getToken, onDone, onFailed]);

  if (error) {
    return (
      <div className="max-w-xl mx-auto text-center py-10">
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-[8px] px-4 py-2 text-sm font-semibold"
          style={{ background: 'var(--red)', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto py-8">
      <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
        Researching your item
      </h2>
      <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
        This usually takes 1 to 3 minutes. Searches that cannot find a
        matching model finish sooner.
      </p>
      <ul className="flex flex-col gap-3" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {STEPS.map((step, i) => {
          const done = i < active;
          const current = i === active;
          return (
            <li key={step.key} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: done ? 'var(--red)' : 'var(--bg-inset)',
                  border: `0.5px solid ${done || current ? 'var(--red)' : 'var(--border)'}`,
                  flexShrink: 0,
                }}
              />
              <span
                className="text-sm"
                style={{
                  color: done || current ? 'var(--text-primary)' : 'var(--text-tertiary)',
                  fontWeight: current ? 600 : 400,
                }}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-6 text-xs" style={{ color: 'var(--text-tertiary)' }}>
        {elapsed}s elapsed
      </p>
    </div>
  );
}
