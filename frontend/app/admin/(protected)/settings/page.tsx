import { cookies } from 'next/headers';
import SettingsEditor from './settings-editor';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface Flag {
  key: string;
  label: string;
  hint: string;
  group: string;
  type: 'boolean' | 'number' | 'text' | 'percent';
  default: string;
  currentValue: string;
}

export default async function SettingsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value ?? '';
  let flags: Flag[] = [];
  try {
    const res = await fetch(`${API_URL}/admin/settings`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (res.ok) flags = await res.json();
  } catch {
    // empty list will render
  }

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

      <SettingsEditor flags={flags} />
    </div>
  );
}
