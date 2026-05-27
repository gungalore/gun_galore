// frontend/app/ballistics/profile/page.tsx
//
// Profile editor — host for the AILookup card (the killer
// differentiator) + manual rifle/load form. BC-6 will round out the
// editor with truing UI, profile chip strip + duplicate/save buttons;
// this drop lands the AI lookup loop end-to-end so demo users can
// taste the magic before paying.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AILookup } from '../_components/AILookup';
import {
  useBallisticProfile,
  type ActiveProfile,
} from '@/lib/use-ballistic-profile';

export default function BallisticsProfilePage() {
  const [demoMode, setDemoMode] = useState(true);
  const [licenseLoaded, setLicenseLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/ballistics/license', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { purchased?: boolean } | null) => {
        if (data?.purchased) setDemoMode(false);
      })
      .catch(() => {})
      .finally(() => setLicenseLoaded(true));
  }, []);

  const { profile, update, locked } = useBallisticProfile({ locked: demoMode });

  return (
    <>
      <header className="bc-topbar">
        <Link href="/ballistics" className="bc-chip" style={{ textDecoration: 'none' }}>
          ← Back
        </Link>
        <div className="bc-brand">
          <span className="bc-brand-dot" />
          PROFILE
        </div>
        <div style={{ width: 60 }} />
      </header>

      <main className="bc-page">
        {licenseLoaded && demoMode && (
          <p
            style={{
              padding: 12,
              background: 'var(--bc-surface-2)',
              border: '1px solid var(--bc-red-line)',
              borderRadius: 'var(--bc-r-md)',
              fontSize: 12,
              color: 'var(--bc-text-2)',
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            Demo mode: profile is locked to .308 175 SMK. You get one
            free AI lookup to try below. Buy the lifetime license to
            save unlimited profiles, unlimited AI lookups, and unlock
            the full feature set.
          </p>
        )}

        <AILookup
          onApply={(patch) => {
            // In demo mode the underlying update is a no-op (the hook
            // returns early on locked), but we still want to show the
            // user that the data came through. The AILookup component
            // resets itself after onApply so they see the empty
            // input + the CTA upgrade prompt re-surface naturally.
            update(patch);
          }}
          disabled={locked}
        />

        <section className="bc-card">
          <div className="bc-card-h">
            <span className="ttl">Active load</span>
            {profile.aiSourced && <span className="bc-ai-pill">AI MATCH</span>}
          </div>
          <PropRow label="Bullet" value={profile.bulletName} />
          <PropRow label="Weight (gr)" value={String(profile.bulletWeightGr)} />
          <PropRow
            label={`BC ${profile.dragModel}`}
            value={
              profile.dragModel === 'G7' && profile.bcG7
                ? profile.bcG7.toFixed(3)
                : profile.bcG1.toFixed(3)
            }
          />
          <PropRow label="Muzzle vel (fps)" value={String(profile.muzzleVelocityFps)} />
          <PropRow label="Zero (m)" value={String(profile.zeroM)} />
          <PropRow label="Scope height (cm)" value={String(profile.sightHeightCm)} />
        </section>

        {locked && (
          <Link
            href="/ballistics/purchase"
            className="bc-tap primary"
            style={{ marginTop: 8 }}
          >
            Unlock — R299 lifetime
          </Link>
        )}
      </main>
    </>
  );
}

function PropRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: '8px 0',
        borderBottom: '1px solid var(--bc-line)',
      }}
    >
      <span className="bc-label-xs">{label}</span>
      <span
        style={{
          fontFamily: 'var(--font-bc-mono)',
          fontSize: 14,
          color: 'var(--bc-text)',
          fontWeight: 600,
        }}
      >
        {value}
      </span>
    </div>
  );
}
