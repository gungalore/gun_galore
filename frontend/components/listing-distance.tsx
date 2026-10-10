'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Coarse "how far away is this item from me" line (W3). Device location
// primary, saved address as backup. The browser only ever receives a 5 km-
// snapped distance — the seller's coordinates are never sent to the client.
export default function ListingDistance({ listingId }: { listingId: string }) {
  const { getToken } = useAuth();
  const [km, setKm] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function lookUp(lat: number, lng: number) {
      try {
        const res = await fetch(
          `${API_URL}/listings/${listingId}/distance?lat=${lat}&lng=${lng}`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { distanceKm?: number | null };
        if (!cancelled && typeof data.distanceKm === 'number') {
          setKm(data.distanceKm);
        }
      } catch {
        /* offline / blocked — show nothing */
      }
    }

    function fromDevice(): Promise<{ lat: number; lng: number } | null> {
      return new Promise((resolve) => {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
          return resolve(null);
        }
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
          () => resolve(null),
          { maximumAge: 600_000, timeout: 8_000 },
        );
      });
    }

    async function fromSaved(): Promise<{ lat: number; lng: number } | null> {
      try {
        const token = await getToken();
        if (!token) return null;
        const res = await fetch(`${API_URL}/users/me`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!res.ok) return null;
        const u = (await res.json()) as {
          lat?: number | null;
          lng?: number | null;
          address?: { lat?: number | null; lng?: number | null };
        };
        const lat = u?.lat ?? u?.address?.lat;
        const lng = u?.lng ?? u?.address?.lng;
        return typeof lat === 'number' && typeof lng === 'number'
          ? { lat, lng }
          : null;
      } catch {
        return null;
      }
    }

    (async () => {
      const point = (await fromDevice()) ?? (await fromSaved());
      if (point) await lookUp(point.lat, point.lng);
    })();

    return () => {
      cancelled = true;
    };
  }, [listingId, getToken]);

  if (km == null) return null;

  return (
    <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
      {km <= 5 ? 'Within ~5 km of you' : `Approximately ${km} km from you`}
    </p>
  );
}
