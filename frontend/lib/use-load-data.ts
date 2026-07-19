'use client';

// useLoadData — client hook for the PRO-gated Load Data browser on /ask-gg.
//
// Two backend calls (both Clerk-authed — same auth pattern as useLoadLab):
//   - listCartridges() → GET /load-lab/manual-cartridges, the calibre
//     hierarchy (families → cartridges) with load counts.
//   - loadsFor(cartridgeKey) → GET /load-lab/manual-loads, every published
//     manual load for one cartridge, grouped by bullet weight.
//
// Both are PRO-gated: a non-PRO user gets { upgradeRequired, reason } from
// either endpoint — narrow with isUpgradeRequired() before touching the
// success fields. Network/auth failures resolve to null so the browser can
// stay quiet.

import { useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';

// Same base + fallback as useLoadLab / useAskGg — keep them in lockstep.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// ─── Response shapes ────────────────────────────────────────────────

/** Returned when a non-PRO user hits either endpoint. The browser swaps in
 *  an upgrade nudge instead of the data. */
export interface LoadDataUpgradeRequired {
  upgradeRequired: true;
  reason: string;
}

/** One cartridge within a calibre family (GET /manual-cartridges). Identified
 *  by its canonical cartridgeKey (the selector for /manual-loads); `name` is the
 *  cleanest printed spelling to show. */
export interface ManualCartridgeSummary {
  cartridgeKey: string;
  name: string;
  loadCount: number;
}

/** One calibre family — pre-sorted by diameter; cartridges alphabetical. */
export interface ManualCartridgeFamily {
  id: string;
  label: string;
  cartridgeCount: number;
  loadCount: number;
  cartridges: ManualCartridgeSummary[];
}

export interface ManualCartridgesResponse {
  families: ManualCartridgeFamily[];
  totalCartridges: number;
  totalLoads: number;
}

/** One published load quoted from a manual (GET /manual-loads). */
export interface ManualLoadRow {
  /** The exact printed cartridge label this row came from — set only when the
   *  cartridge merges more than one label (e.g. a pressure tier); else null. */
  variant: string | null;
  powderMaker: string;
  powderName: string;
  bulletMaker: string | null;
  bulletName: string | null;
  startGr: number;
  maxGr: number;
  startVelFps: number | null;
  maxVelFps: number | null;
  fillPctStart: number | null;
  fillPctMax: number | null;
  compressed: boolean;
  coalMm: number | null;
  primer: string | null;
  barrelLenIn: number | null;
  notes: string | null;
  manualLabel: string;
  pageNumber: number;
  incrementGr: number;
  ladderSteps: number;
}

/** All loads for a single bullet weight, sorted by powder. */
export interface ManualLoadGroup {
  bulletWeightGr: number;
  bullets: string[];
  loadCount: number;
  loads: ManualLoadRow[];
}

export interface CartridgeLoadsResponse {
  found: boolean;
  cartridge: string;
  totalLoads: number;
  bulletWeights: number[];
  groups: ManualLoadGroup[];
  manuals: string[];
  /** All printed labels this canonical cartridge merges (usually one). */
  variants: string[];
  /** FREE demo (2026-07-19): true when the server capped the response to a
   *  3-load preview; upgradeReason carries the upsell copy. */
  demo?: boolean;
  upgradeReason?: string;
}

/** The discriminated unions each call resolves to. Narrow on the
 *  `upgradeRequired` key with isUpgradeRequired() before reading data. */
export type ManualCartridgesResult =
  | ManualCartridgesResponse
  | LoadDataUpgradeRequired;
export type CartridgeLoadsResult =
  | CartridgeLoadsResponse
  | LoadDataUpgradeRequired;

export function isUpgradeRequired(
  r: ManualCartridgesResult | CartridgeLoadsResult,
): r is LoadDataUpgradeRequired {
  return (r as LoadDataUpgradeRequired).upgradeRequired === true;
}

// ─── Hook ───────────────────────────────────────────────────────────

export interface UseLoadData {
  /** The full calibre hierarchy. Resolves to the tree, an upgrade nudge, or
   *  null on network/auth failure. */
  listCartridges: () => Promise<ManualCartridgesResult | null>;
  /** Every published load for one cartridge (by canonical cartridgeKey). Aborted
   *  via the passed signal. Resolves to the load data, an upgrade nudge, or null
   *  on failure/abort. */
  loadsFor: (
    cartridgeKey: string,
    signal?: AbortSignal,
  ) => Promise<CartridgeLoadsResult | null>;
}

export function useLoadData(): UseLoadData {
  const { getToken } = useAuth();

  const listCartridges =
    useCallback(async (): Promise<ManualCartridgesResult | null> => {
      try {
        const token = await getToken();
        if (!token) return null;
        const r = await fetch(`${API_URL}/load-lab/manual-cartridges`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!r.ok) return null;
        return (await r.json()) as ManualCartridgesResult;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return null;
        return null;
      }
    }, [getToken]);

  const loadsFor = useCallback(
    async (
      cartridgeKey: string,
      signal?: AbortSignal,
    ): Promise<CartridgeLoadsResult | null> => {
      try {
        const token = await getToken();
        if (!token) return null;
        const params = new URLSearchParams({ cartridgeKey });
        const r = await fetch(
          `${API_URL}/load-lab/manual-loads?${params.toString()}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
            signal,
          },
        );
        if (!r.ok) return null;
        return (await r.json()) as CartridgeLoadsResult;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return null;
        return null;
      }
    },
    [getToken],
  );

  return { listCartridges, loadsFor };
}
