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

export default async function AdminFeaturedSettingsPage() {
  // Public endpoint — no auth required to read. The settings form
  // POSTs back to the admin endpoint, which IS auth-gated.
  const res = await fetch(`${API_URL}/featured/config`, { cache: 'no-store' });
  const config: FeaturedConfig | null = res.ok ? await res.json() : null;

  return (
    <div>
      <h1
        className="text-xl mb-4"
        style={{ color: 'var(--text-primary)', fontWeight: 500 }}
      >
        Featured Slots
      </h1>
      <FeaturedTabs current="settings" />

      {!config ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Could not load current configuration.
        </p>
      ) : (
        <SettingsForm initial={config} />
      )}
    </div>
  );
}
