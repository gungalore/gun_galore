// frontend/lib/use-bullet-lookup.ts
//
// AI Bullet Lookup hook — the call-and-response loop for "type bullet
// name, Claude returns ballistic data". Mirrors the `useAskGg` send
// pattern: Clerk JWT in the Bearer header, decode 403/429 bodies to
// drive the upgrade card vs cool-off card UX.
//
// Result shape mirrors the backend's `BulletLookupResult`. Reused by
// both the AI Lookup card (BC-5) and the profile editor (BC-6).
//
// Offline fallback: when fetch throws, we drop down to the bundled
// `findBulletOffline` from `ballistics-data/bullets.ts`. The fallback
// result is tagged `source: 'offline-bundle'` so the UI shows a
// different pill ("cached" instead of "AI MATCH").

'use client';

import { useCallback, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { findBulletOffline, type BulletPreset } from './ballistics-data';
import type { DragModel } from './ballistics-calc';

export interface BulletLookupResult {
  name: string | null;
  manufacturer: string | null;
  weightGr: number | null;
  diameterIn: number | null;
  bcG1: number | null;
  bcG7: number | null;
  recommendedDragModel: DragModel;
  typicalMvFps: number | null;
  bulletType: string | null;
  confidence: 'high' | 'medium' | 'low';
  sources: string[];
  notes: string | null;
  /** Where the data came from — drives the UI pill colour/label. */
  source: 'ai' | 'offline-bundle';
  /** True only when the user just spent their one lifetime demo
   *  lookup. UI uses this to surface the "Buy R299" upgrade card. */
  wasDemo: boolean;
}

export type LookupStatus =
  | 'idle'
  | 'loading'
  | 'result'
  | 'error'
  | 'demo-exhausted'  // unpurchased user already used their free lookup
  | 'rate-limited'    // purchaser blew through fair-use cap
  | 'offline-fallback';

export interface LookupErrorBody {
  message: string;
  code?: string;
  priceCents?: number;
  retryAfterSec?: number;
}

function presetToResult(p: BulletPreset): BulletLookupResult {
  return {
    name: p.name,
    manufacturer: p.manufacturer,
    weightGr: p.weightGr,
    diameterIn: p.diameterIn,
    bcG1: p.bcG1 ?? null,
    bcG7: p.bcG7 ?? null,
    recommendedDragModel: p.bcG7 ? 'G7' : 'G1',
    typicalMvFps: p.typicalMvFps,
    bulletType: p.type,
    confidence: 'high', // bundled = manufacturer-published, treated as high
    sources: [p.source],
    notes: 'Offline cached entry — manufacturer-published data.',
    source: 'offline-bundle',
    wasDemo: false,
  };
}

export function useBulletLookup() {
  const { getToken } = useAuth();
  const [status, setStatus] = useState<LookupStatus>('idle');
  const [result, setResult] = useState<BulletLookupResult | null>(null);
  const [error, setError] = useState<LookupErrorBody | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setResult(null);
    setError(null);
  }, []);

  const lookup = useCallback(
    async (query: string) => {
      const cleaned = query.trim();
      if (!cleaned) return;

      setStatus('loading');
      setResult(null);
      setError(null);

      // Optimistic offline pass — if the bundled table has a clean
      // hit, surface it INSTANTLY while Claude is still thinking.
      // The AI result replaces it on arrival (the user sees the data
      // pop in, never sees a blank state).
      const offline = findBulletOffline(cleaned);
      if (offline) {
        setResult(presetToResult(offline));
        setStatus('result');
      }

      let token: string | null = null;
      try {
        token = await getToken();
      } catch {
        token = null;
      }

      try {
        const res = await fetch('/api/ballistics/lookup-bullet', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ query: cleaned }),
        });

        if (res.status === 403 || res.status === 429) {
          const body = (await res.json().catch(() => ({}))) as LookupErrorBody;
          setError(body);
          if (body.code === 'ballistics-demo-exhausted') {
            setStatus('demo-exhausted');
          } else if (body.code === 'ballistics-not-purchased') {
            setStatus('demo-exhausted');
          } else {
            setStatus('rate-limited');
          }
          return;
        }

        if (!res.ok) {
          throw new Error(`Lookup ${res.status}`);
        }

        const data = (await res.json()) as BulletLookupResult & {
          wasDemo?: boolean;
        };
        setResult({
          ...data,
          source: 'ai',
          wasDemo: !!data.wasDemo,
        });
        setStatus('result');
      } catch (err) {
        // Network-failed and we already showed offline data above —
        // upgrade UX label to "offline cached", don't surface error.
        if (offline) {
          setStatus('offline-fallback');
          return;
        }
        // No offline hit AND fetch failed = real error.
        setError({
          message:
            err instanceof Error
              ? `Lookup failed: ${err.message}`
              : 'Lookup failed.',
        });
        setStatus('error');
      }
    },
    [getToken],
  );

  return { status, result, error, lookup, reset };
}
