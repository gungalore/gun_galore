'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from './auth';
import { getGrantedPosition } from './geolocation';

// ────────────────────────────────────────────────────────────────────
// ONE LOCATION READ, ONE BATCH REQUEST, MANY CARDS.
//
// ⚠️ NEVER PROMPT AND NEVER ONE REQUEST PER CARD. The member's location is read
// passively — an ALREADY-GRANTED browser permission, else their saved address —
// and the whole page's listing ids go to the backend in ONE batch. A card that
// asks the browser for permission (or fires its own request) is what made the
// old per-listing distance line feel like surveillance and what would turn a
// 24-card grid into 24 round-trips.
//
// ⚠️ FAIL SOFT: the endpoint is landing in parallel. A 404 (or any failure)
// leaves every badge hidden rather than showing an error on a catalogue.
// ────────────────────────────────────────────────────────────────────

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

type Distances = Record<string, number | null>;

const DistanceContext = createContext<Distances | null>(null);

/**
 * The stable, de-duplicated id list the batch request is keyed on.
 *
 * ⚠️ ONE REQUEST PER PAGE, NOT PER CARD. Sorting + de-duplicating means a page
 * that re-renders with the same cards never refires, and an empty grid produces
 * an empty key so NO location read and NO request happen at all.
 */
export function distanceBatchKey(ids: string[] | null | undefined): string {
  return [...new Set((ids ?? []).filter(Boolean))].sort().join(',');
}

interface Point {
  lat: number;
  lng: number;
}

async function grantedDevicePoint(): Promise<Point | null> {
  const position = await getGrantedPosition({
    maximumAge: 600_000,
    timeout: 8_000,
  });
  return position
    ? { lat: position.coords.latitude, lng: position.coords.longitude }
    : null;
}

async function savedAddressPoint(
  getToken: () => Promise<string | null>,
): Promise<Point | null> {
  try {
    const token = await getToken();
    if (!token) return null;
    const res = await fetch(`${API_URL}/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const user = (await res.json()) as {
      lat?: number | null;
      lng?: number | null;
      address?: { lat?: number | null; lng?: number | null };
    };
    const lat = user.lat ?? user.address?.lat;
    const lng = user.lng ?? user.address?.lng;
    return typeof lat === 'number' && typeof lng === 'number'
      ? { lat, lng }
      : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the member's location once for a page of listings and batch-fetch
 * the coarse distances. Children read them through `useDistanceKm`.
 */
export function DistanceProvider({
  ids,
  children,
}: {
  /** Every listing id rendered on this page. Duplicates are collapsed. */
  ids: string[];
  children: ReactNode;
}) {
  const { getToken } = useAuth();
  const [distances, setDistances] = useState<Distances>({});
  /**
   * The token getter is kept in a ref so an unstable callback identity from the
   * auth provider cannot refire the one location read for this page.
   */
  const tokenRef = useRef(getToken);
  tokenRef.current = getToken;
  /**
   * A stable string key: an inline `ids` array literal (the normal call site) is
   * a new array every render, so keying the effect on the array would fire the
   * location read and the batch again on every render.
   */
  const key = distanceBatchKey(ids);

  useEffect(() => {
    let cancelled = false;
    if (!key) return;
    void (async () => {
      const point =
        (await grantedDevicePoint()) ??
        (await savedAddressPoint(tokenRef.current));
      if (!point || cancelled) return;
      try {
        const token = await tokenRef.current();
        const res = await fetch(`${API_URL}/listings/distances`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            ids: key.split(','),
            lat: point.lat,
            lng: point.lng,
          }),
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          distances?: Distances | null;
        };
        if (!cancelled && data?.distances) setDistances(data.distances);
      } catch {
        /* endpoint missing / offline — show no distances */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return (
    <DistanceContext.Provider value={distances}>
      {children}
    </DistanceContext.Provider>
  );
}

/** This listing's distance in km, or null (not resolved / no location). */
export function useDistanceKm(listingId: string): number | null {
  const distances = useContext(DistanceContext);
  if (!distances) return null;
  const value = distances[listingId];
  return typeof value === 'number' ? value : null;
}

/** True inside a DistanceProvider — used to hide the badge entirely elsewhere. */
export function useHasDistanceProvider(): boolean {
  return useContext(DistanceContext) !== null;
}
