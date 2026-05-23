'use client';

import { useEffect, useState } from 'react';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import SettingsEditor from './settings-editor';

interface Flag {
  key: string;
  label: string;
  hint: string;
  group: string;
  type: 'boolean' | 'number' | 'text' | 'percent';
  default: string;
  currentValue: string;
}

export default function SettingsPage() {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!requireAdminToken()) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch('/admin/settings');
        if (cancelled) return;
        if (res.ok) setFlags(await res.json());
      } catch {
        // empty list will render
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="flex items-baseline justify-between flex-wrap gap-3 mb-3">
        <h1 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
          Marketplace settings
        </h1>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Live values · every change is recorded in the audit log
        </p>
      </div>

      <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
        Admin-tunable feature flags and thresholds. Changes apply
        immediately — runtime services read the Setting table on every
        check (or via a short cache). Use the reason field on each
        save so the audit log captures <em>why</em> the value moved.
      </p>

      {loaded && <SettingsEditor flags={flags} />}
    </div>
  );
}
