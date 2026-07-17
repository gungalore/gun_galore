'use client';

// Flushes a pending OAUTH sign-up consent to the backend once the Clerk
// session is live. The Google sign-up path (which can't attach unsafeMetadata
// to the redirect) writes the consent to per-tab sessionStorage under
// `gg_pending_consent`; this component — mounted once, app-wide inside
// ClerkProvider — POSTs it to /users/me/consent as soon as the user is signed
// in, then clears it. The EMAIL path does NOT use this (it records consent via
// Clerk unsafeMetadata), so this is OAuth-only.
//
// Safety: sessionStorage is per-tab (not shared browser-wide) and we discard
// any record older than the TTL, so a leftover from an abandoned OAuth attempt
// can never attach to a different account. We only clear on a CONFIRMED record
// (recorded:true) so a transient failure retries on the next load.

import { useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
const KEY = 'gg_pending_consent';
const TTL_MS = 15 * 60 * 1000; // 15 minutes

export default function ConsentSync() {
  const { isSignedIn, getToken } = useAuth();

  useEffect(() => {
    if (!isSignedIn) return;

    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(KEY);
    } catch {
      return;
    }
    if (!raw) return;

    const clear = () => {
      try {
        sessionStorage.removeItem(KEY);
      } catch {
        /* ignore */
      }
    };

    let payload: { ts?: number; [k: string]: unknown };
    try {
      payload = JSON.parse(raw);
    } catch {
      clear();
      return;
    }
    // Discard stale records — a fresh OAuth signup flushes within seconds.
    if (typeof payload.ts !== 'number' || Date.now() - payload.ts > TTL_MS) {
      clear();
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const res = await fetch(`${API_URL}/users/me/consent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) return; // keep for retry on next load
        const data = (await res.json().catch(() => ({}))) as { recorded?: boolean };
        // Only clear once the record is durably written; if the User row
        // wasn't there yet (recorded:false), keep it and retry next load.
        if (data.recorded) clear();
      } catch {
        // Network/transient — keep the record for a later attempt.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, getToken]);

  return null;
}
