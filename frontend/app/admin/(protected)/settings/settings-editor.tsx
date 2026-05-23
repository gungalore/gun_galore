'use client';

// Marketplace settings editor — one widget per flag, grouped by
// `group`. Each flag tracks its draft value locally; Save fires a
// PATCH with a required reason. Dirty rows get a red dot + a Save
// button; clean rows are quiet.
//
// Type-driven widget selection:
//   - boolean  → checkbox
//   - number   → number input
//   - percent  → number input with 0..1 hint
//   - text     → textarea

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-auth';

interface Flag {
  key: string;
  label: string;
  hint: string;
  group: string;
  type: 'boolean' | 'number' | 'text' | 'percent';
  default: string;
  currentValue: string;
}

export default function SettingsEditor({ flags }: { flags: Flag[] }) {
  // Group by `group` so the page renders sections (Moderation, Raffles, …).
  const groups = new Map<string, Flag[]>();
  for (const f of flags) {
    const list = groups.get(f.group) ?? [];
    list.push(f);
    groups.set(f.group, list);
  }

  if (flags.length === 0) {
    return (
      <div
        className="rounded-[8px] p-6 text-center"
        style={{ background: 'var(--bg-card)', border: '0.5px dashed var(--border)' }}
      >
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Could not load settings.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {Array.from(groups.entries()).map(([groupName, items]) => (
        <div key={groupName}>
          <p
            className="text-xs uppercase tracking-wider mb-2"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {groupName}
          </p>
          <div
            className="rounded-[8px] overflow-hidden"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
          >
            {items.map((f, i) => (
              <FlagRow
                key={f.key}
                flag={f}
                last={i === items.length - 1}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FlagRow({ flag, last }: { flag: Flag; last: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(flag.currentValue);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = value !== flag.currentValue;
  const canSave = dirty && reason.trim().length >= 3 && !busy;

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await adminFetch(`/admin/settings/${flag.key}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, reason: reason.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? `Error ${res.status}`);
      }
      setSaved(true);
      setReason('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg-inset)',
    border: '0.5px solid var(--border)',
    color: 'var(--text-primary)',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 13,
    outline: 'none',
  };

  return (
    <div
      className="px-4 py-3"
      style={
        last ? undefined : { borderBottom: '0.5px solid var(--border)' }
      }
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p
            className="text-sm font-medium flex items-center gap-2"
            style={{ color: 'var(--text-primary)' }}
          >
            {flag.label}
            {dirty && (
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: 'var(--red)' }}
                title="Unsaved changes"
              />
            )}
            {saved && !dirty && (
              <span
                className="text-xs"
                style={{ color: '#22c55e' }}
              >
                ✓ saved
              </span>
            )}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {flag.hint}
          </p>
          <p
            className="text-xs mt-1"
            style={{
              color: 'var(--text-tertiary)',
              fontFamily: 'monospace',
            }}
          >
            {flag.key} · default: {flag.default || '(empty)'}
          </p>
        </div>

        <div className="shrink-0" style={{ minWidth: 240, maxWidth: 320 }}>
          {flag.type === 'boolean' ? (
            <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={value === 'true'}
                onChange={(e) => setValue(e.target.checked ? 'true' : 'false')}
                style={{ accentColor: 'var(--red)' }}
              />
              <span>{value === 'true' ? 'Enabled' : 'Disabled'}</span>
            </label>
          ) : flag.type === 'number' || flag.type === 'percent' ? (
            <input
              type="number"
              step={flag.type === 'percent' ? 0.01 : 1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              style={inputStyle}
            />
          ) : (
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={2}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          )}
        </div>
      </div>

      {dirty && (
        <div className="mt-3 flex gap-2 items-end">
          <div className="flex-1">
            <label
              className="text-xs block mb-1"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Reason (≥3 chars, audit log)
            </label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this changing?"
              style={inputStyle}
            />
          </div>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="px-3 py-1.5 rounded text-sm font-medium"
            style={{
              background: canSave ? 'var(--red)' : 'var(--bg-inset)',
              color: canSave ? '#fff' : 'var(--text-tertiary)',
              border: 'none',
              cursor: canSave ? 'pointer' : 'not-allowed',
            }}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => {
              setValue(flag.currentValue);
              setReason('');
              setError(null);
            }}
            disabled={busy}
            className="px-3 py-1.5 rounded text-sm"
            style={{
              background: 'transparent',
              color: 'var(--text-tertiary)',
              border: '0.5px solid var(--border)',
              cursor: 'pointer',
            }}
          >
            Revert
          </button>
        </div>
      )}

      {error && (
        <p className="text-xs mt-2" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
