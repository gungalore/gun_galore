// frontend/lib/use-ballistic-profile.ts
//
// Active-profile state hook for the standalone ballistic calculator.
//
// Resolution order on cold-start:
//   1. URL params (?bw=...&bc=...&mv=...&zero=...) — shareable URLs
//      from Ask GG or peers always win
//   2. localStorage `bc:active:v1` — last profile the user touched
//   3. Default `.308 175 SMK` factory profile (demo + first-load)
//
// Server-sync deliberately deferred: a cold offline launch must
// render the readout before we even know if the user is signed in.
// Once the page is interactive a separate effect (added in BC-6's
// profile editor) reconciles localStorage ↔ server.
//
// Demo gating: the page reads `license` from /api/ballistics/license
// (or the `?demo=1` shortcut) to decide whether to show the locked
// default profile or allow editing. This hook stays profile-only —
// licensing lives next door so swapping the gate later is one
// component, not a refactor here.

'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DragModel } from './ballistics-calc';

export interface ActiveProfile {
  id?: string;
  name: string;
  rifleName?: string;
  bulletName: string;
  bulletWeightGr: number;
  bcG1: number;
  bcG7?: number;
  dragModel: DragModel;
  muzzleVelocityFps: number;
  zeroM: number;
  sightHeightCm: number;
  preferredUnitElev: 'mil' | 'moa' | 'clk';
  preferredUnitRange: 'm' | 'yd';
  zeroAdjMil: number;
  aiSourced: boolean;
}

export const FACTORY_DEFAULT_PROFILE: ActiveProfile = {
  name: '.308 Win — 175gr SMK',
  rifleName: 'Bolt action 24" — default',
  bulletName: 'Sierra MatchKing 175gr HPBT',
  bulletWeightGr: 175,
  bcG1: 0.505,
  bcG7: 0.243,
  dragModel: 'G1',
  muzzleVelocityFps: 2650,
  zeroM: 100,
  sightHeightCm: 4,
  preferredUnitElev: 'mil',
  preferredUnitRange: 'm',
  zeroAdjMil: 0,
  aiSourced: false,
};

const STORAGE_KEY = 'bc:active:v1';

function readSearchParamProfile(): Partial<ActiveProfile> | null {
  if (typeof window === 'undefined') return null;
  const sp = new URLSearchParams(window.location.search);
  const bw = Number(sp.get('bw'));
  const bc = Number(sp.get('bc'));
  const mv = Number(sp.get('mv'));
  const zero = Number(sp.get('zero'));
  if (!bw || !bc || !mv) return null;
  return {
    name: 'Shared profile',
    bulletName: sp.get('bullet') ?? 'Shared profile',
    bulletWeightGr: bw,
    bcG1: bc,
    muzzleVelocityFps: mv,
    zeroM: zero || 100,
    dragModel: (sp.get('dm') as DragModel) === 'G7' ? 'G7' : 'G1',
  };
}

function readStoredProfile(): ActiveProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ActiveProfile;
  } catch {
    return null;
  }
}

export function useBallisticProfile(opts?: { locked?: boolean }) {
  // Lock = demo mode forces the factory default. Locking can't be
  // toggled mid-session — it's a deliberate gate, not a setting.
  const locked = opts?.locked ?? false;

  const [profile, setProfile] = useState<ActiveProfile>(FACTORY_DEFAULT_PROFILE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // SSR-safe — these reads only run client-side.
    if (locked) {
      setProfile(FACTORY_DEFAULT_PROFILE);
      setHydrated(true);
      return;
    }
    const fromUrl = readSearchParamProfile();
    const fromStorage = readStoredProfile();
    if (fromUrl) {
      const merged: ActiveProfile = {
        ...FACTORY_DEFAULT_PROFILE,
        ...(fromStorage ?? {}),
        ...fromUrl,
        aiSourced: false,
      };
      setProfile(merged);
    } else if (fromStorage) {
      setProfile(fromStorage);
    }
    setHydrated(true);
  }, [locked]);

  // Debounced write-through to localStorage. Avoids hammering disk on
  // a fast slider; 400ms is the sweet spot between "felt instant" and
  // "doesn't block the main thread".
  useEffect(() => {
    if (!hydrated || locked) return;
    const t = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
      } catch {
        // Quota exceeded / private mode — ignore silently. The chip
        // strip still shows the right profile in-memory.
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [profile, hydrated, locked]);

  const update = useCallback(
    (patch: Partial<ActiveProfile>) => {
      if (locked) return;
      setProfile((p) => ({ ...p, ...patch }));
    },
    [locked],
  );

  const resetToFactory = useCallback(() => {
    setProfile(FACTORY_DEFAULT_PROFILE);
  }, []);

  return { profile, update, resetToFactory, hydrated, locked };
}
