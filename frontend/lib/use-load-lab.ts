'use client';

// useLoadLab — client hook for the PRO-gated Load Lab surface on /ask-gg.
//
// Two backend calls (both Clerk-authed — same auth pattern as useAskGg):
//   - search(kind, q, groove?) → GET /load-lab/search, typeahead for the
//     cartridge / bullet / powder pickers.
//   - compute(input) → POST /load-lab/compute, returns either a full
//     LoadLabResult or { upgradeRequired, reason } for non-PRO users.
//
// `mode` (hunter | competition) is persisted in localStorage so the
// operator's last choice survives a reload, defaulting to 'hunter'.

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import type {
  LoadLabComponentKind,
  LoadLabComputeInput,
  LoadLabComputeResponse,
  LoadLabMode,
  LoadLabSearchHit,
  RecommendedLoadsResponse,
} from '@/lib/load-lab-types';

// Same base + fallback as useAskGg — keep them in lockstep.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const MODE_KEY = 'loadlab:mode';

function readStoredMode(): LoadLabMode {
  if (typeof window === 'undefined') return 'hunter';
  try {
    const v = window.localStorage.getItem(MODE_KEY);
    return v === 'competition' ? 'competition' : 'hunter';
  } catch {
    return 'hunter';
  }
}

export interface UseLoadLab {
  /** Hunter | Competition. Persisted to localStorage. */
  mode: LoadLabMode;
  setMode: (m: LoadLabMode) => void;
  /** True while a /compute is in flight (Compute button spinner). */
  loading: boolean;
  /** Last error message, if any. Cleared on the next compute attempt. */
  error: string | null;
  /** Typeahead search. Aborted via the AbortSignal the picker passes in.
   *  Returns [] on error / abort so the picker never surfaces error UI. */
  search: (
    kind: LoadLabComponentKind,
    q: string,
    groove?: number,
    signal?: AbortSignal,
  ) => Promise<LoadLabSearchHit[]>;
  /** Run the ballistics computation. Resolves to a LoadLabResult OR
   *  { upgradeRequired } — narrow with isUpgradeRequired(). Throws on
   *  network / auth failure (caller catches → error state). */
  compute: (input: LoadLabComputeInput) => Promise<LoadLabComputeResponse>;
  /** Published manual loads for a cartridge + bullet weight (±tolerance).
   *  Resolves to a RecommendedLoadsResult OR { upgradeRequired }. Returns
   *  null on network/auth failure so the panel can stay quiet. */
  recommendedLoads: (
    cartridge: string,
    bulletWeightGr: number,
    toleranceGr?: number,
    signal?: AbortSignal,
  ) => Promise<RecommendedLoadsResponse | null>;
}

export function useLoadLab(): UseLoadLab {
  const { getToken } = useAuth();
  const [mode, setModeState] = useState<LoadLabMode>('hunter');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate the persisted mode once on mount (client-only, so SSR and the
  // first paint agree on 'hunter' before localStorage is read).
  useEffect(() => {
    setModeState(readStoredMode());
  }, []);

  const setMode = useCallback((m: LoadLabMode) => {
    setModeState(m);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(MODE_KEY, m);
      } catch {
        // private mode / storage disabled — degrade to no-persistence
      }
    }
  }, []);

  const search = useCallback(
    async (
      kind: LoadLabComponentKind,
      q: string,
      groove?: number,
      signal?: AbortSignal,
    ): Promise<LoadLabSearchHit[]> => {
      const trimmed = q.trim();
      if (!trimmed) return [];
      try {
        const token = await getToken();
        if (!token) return [];
        const params = new URLSearchParams({ kind, q: trimmed });
        if (groove != null && Number.isFinite(groove)) {
          params.set('groove', String(groove));
        }
        const r = await fetch(`${API_URL}/load-lab/search?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal,
        });
        if (!r.ok) return [];
        return (await r.json()) as LoadLabSearchHit[];
      } catch (err) {
        // Aborted by a newer keystroke — silent, same as live-search.
        if ((err as Error)?.name === 'AbortError') return [];
        return [];
      }
    },
    [getToken],
  );

  const compute = useCallback(
    async (input: LoadLabComputeInput): Promise<LoadLabComputeResponse> => {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        if (!token) {
          throw new Error('Sign in first.');
        }
        const r = await fetch(`${API_URL}/load-lab/compute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(input),
        });
        if (!r.ok) {
          const body = (await r.json().catch(() => null)) as {
            message?: string;
          } | null;
          throw new Error(body?.message ?? `Compute failed (${r.status}).`);
        }
        return (await r.json()) as LoadLabComputeResponse;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Network error';
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [getToken],
  );

  const recommendedLoads = useCallback(
    async (
      cartridge: string,
      bulletWeightGr: number,
      toleranceGr = 5,
      signal?: AbortSignal,
    ): Promise<RecommendedLoadsResponse | null> => {
      try {
        const token = await getToken();
        if (!token) return null;
        const params = new URLSearchParams({
          cartridge,
          bulletWeightGr: String(bulletWeightGr),
          toleranceGr: String(toleranceGr),
        });
        const r = await fetch(
          `${API_URL}/load-lab/recommended-loads?${params.toString()}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
            signal,
          },
        );
        if (!r.ok) return null;
        return (await r.json()) as RecommendedLoadsResponse;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return null;
        return null;
      }
    },
    [getToken],
  );

  return { mode, setMode, loading, error, search, compute, recommendedLoads };
}
