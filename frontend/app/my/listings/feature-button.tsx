'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import {
  featureListing,
  fetchFeatureStatus,
  unfeatureListing,
} from '@/lib/community-api';

/**
 * "Feature in feed" — a seller promotes one of their own ACTIVE listings as a
 * featured ad in the community feed. The ad is just a wrapper around the
 * listing (title, photo, price, link), so editing the listing updates the ad.
 *
 * Hides itself when the feed or ads flag is off, so it never appears as dead
 * chrome.
 */
export default function FeatureButton({ listingId }: { listingId: string }) {
  const { getToken } = useAuth();
  const [state, setState] = useState<'loading' | 'hidden' | 'off' | 'on'>(
    'loading',
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = await getToken();
      if (!token) return;
      try {
        const status = await fetchFeatureStatus(token, listingId);
        if (cancelled) return;
        if (!status.adsEnabled) {
          setState('hidden');
          return;
        }
        setState(status.featured ? 'on' : 'off');
      } catch {
        if (!cancelled) setState('hidden');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, listingId]);

  if (state === 'loading' || state === 'hidden') return null;

  async function toggle() {
    const token = await getToken();
    if (!token) return;
    setBusy(true);
    try {
      if (state === 'on') {
        await unfeatureListing(token, listingId);
        setState('off');
      } else {
        await featureListing(token, listingId);
        setState('on');
      }
    } catch {
      /* leave the state; a retry is one tap away */
    } finally {
      setBusy(false);
    }
  }

  const on = state === 'on';
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      title={
        on
          ? 'Remove from the community feed'
          : 'Promote this listing in the community feed'
      }
      className="text-xs px-2 py-1 rounded-[6px]"
      style={{
        background: on ? 'var(--red)' : 'var(--bg-inset)',
        color: on ? '#fff' : 'var(--red)',
        border: '0.5px solid var(--red)',
        fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      {busy ? '…' : on ? 'Featured ✓' : 'Feature in feed'}
    </button>
  );
}
