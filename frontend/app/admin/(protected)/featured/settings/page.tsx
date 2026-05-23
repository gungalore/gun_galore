'use client';

import { useEffect, useState } from 'react';
import { FeaturedTabs } from '../tabs';
import { SettingsForm } from './settings-form';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export interface FeaturedConfig {
  slotCount: number;
  bidFloorCents: number;
  t1AmountCents: number;
  t1DurationSec: number;
  t2AmountCents: number;
  t2DurationSec: number;
  t3AmountCents: number;
  t3DurationSec: number;
  t4AmountCents: number;
  t4DurationSec: number;
  t5AmountCents: number;
  t5DurationSec: number;
  scheduledAuctionSec: number;
  adHocAuctionSec: number;
  bindWindowSec: number;
}

export default function AdminFeaturedSettingsPage() {
  const [config, setConfig] = useState<FeaturedConfig | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Public endpoint — no auth required to read. The settings form
    // POSTs back to the admin endpoint, which IS auth-gated.
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/featured/config`, { cache: 'no-store' });
        if (cancelled) return;
        if (res.ok) setConfig(await res.json());
      } catch {
        // empty state will render
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1
        className="text-xl mb-4"
        style={{ color: 'var(--text-primary)', fontWeight: 500 }}
      >
        Featured Slots
      </h1>
      <FeaturedTabs current="settings" />

      {loaded && !config ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Could not load current configuration.
        </p>
      ) : config ? (
        <SettingsForm initial={config} />
      ) : null}
    </div>
  );
}
