'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-auth';
import type { FeaturedConfig } from './page';

// All cents fields display + edit as Rand (whole-rand integers only,
// rounded up on submit). All seconds fields stay as seconds with a
// help text hint of the common conversion (24h, 3d, etc.).
type RandField = keyof Pick<
  FeaturedConfig,
  | 'bidFloorCents'
  | 't1AmountCents'
  | 't2AmountCents'
  | 't3AmountCents'
  | 't4AmountCents'
  | 't5AmountCents'
>;

type SecondsField = keyof Pick<
  FeaturedConfig,
  | 't1DurationSec'
  | 't2DurationSec'
  | 't3DurationSec'
  | 't4DurationSec'
  | 't5DurationSec'
  | 'scheduledAuctionSec'
  | 'adHocAuctionSec'
  | 'bindWindowSec'
>;

type IntField = keyof Pick<FeaturedConfig, 'slotCount'>;

const RAND_FIELDS: { key: RandField; label: string; hint?: string }[] = [
  { key: 'bidFloorCents', label: 'Bid floor', hint: 'Minimum bid amount' },
  { key: 't1AmountCents', label: 'T1 amount', hint: 'Tier 1 bid → T1 duration' },
  { key: 't2AmountCents', label: 'T2 amount' },
  { key: 't3AmountCents', label: 'T3 amount' },
  { key: 't4AmountCents', label: 'T4 amount' },
  { key: 't5AmountCents', label: 'T5 amount' },
];

const SECOND_FIELDS: { key: SecondsField; label: string; hint?: string }[] = [
  { key: 't1DurationSec', label: 'T1 duration', hint: '86400 = 24h' },
  { key: 't2DurationSec', label: 'T2 duration', hint: '259200 = 3d' },
  { key: 't3DurationSec', label: 'T3 duration', hint: '604800 = 7d' },
  { key: 't4DurationSec', label: 'T4 duration', hint: '1209600 = 14d' },
  { key: 't5DurationSec', label: 'T5 duration', hint: '2592000 = 30d' },
  {
    key: 'scheduledAuctionSec',
    label: 'Scheduled auction',
    hint: 'How long a scheduled auction stays open',
  },
  {
    key: 'adHocAuctionSec',
    label: 'Ad-hoc auction',
    hint: 'How long an ad-hoc auction stays open',
  },
  {
    key: 'bindWindowSec',
    label: 'Bind window',
    hint: 'Time the winner has to pick a listing',
  },
];

const INT_FIELDS: { key: IntField; label: string; hint?: string }[] = [
  { key: 'slotCount', label: 'Slot count', hint: 'Number of slots on the rail' },
];

export function SettingsForm({ initial }: { initial: FeaturedConfig }) {
  const router = useRouter();
  // Local state holds the editable VALUES — Rand fields as rand integers,
  // seconds fields as seconds, slot count as count. We convert back to
  // cents on submit. Keeping them as strings lets the operator clear
  // inputs without immediately falling back to NaN.
  const [randValues, setRandValues] = useState<Record<RandField, string>>({
    bidFloorCents: String(initial.bidFloorCents / 100),
    t1AmountCents: String(initial.t1AmountCents / 100),
    t2AmountCents: String(initial.t2AmountCents / 100),
    t3AmountCents: String(initial.t3AmountCents / 100),
    t4AmountCents: String(initial.t4AmountCents / 100),
    t5AmountCents: String(initial.t5AmountCents / 100),
  });
  const [secValues, setSecValues] = useState<Record<SecondsField, string>>({
    t1DurationSec: String(initial.t1DurationSec),
    t2DurationSec: String(initial.t2DurationSec),
    t3DurationSec: String(initial.t3DurationSec),
    t4DurationSec: String(initial.t4DurationSec),
    t5DurationSec: String(initial.t5DurationSec),
    scheduledAuctionSec: String(initial.scheduledAuctionSec),
    adHocAuctionSec: String(initial.adHocAuctionSec),
    bindWindowSec: String(initial.bindWindowSec),
  });
  const [intValues, setIntValues] = useState<Record<IntField, string>>({
    slotCount: String(initial.slotCount),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      // Build the payload — only include numeric fields that parse cleanly.
      // The backend accepts all-optional, so we don't need to send anything
      // we're unsure about.
      const payload: Partial<FeaturedConfig> = {};
      for (const f of RAND_FIELDS) {
        const n = parseFloat(randValues[f.key]);
        if (!Number.isFinite(n) || n < 0) {
          setError(`${f.label} must be a non-negative number`);
          setBusy(false);
          return;
        }
        payload[f.key] = Math.round(n * 100);
      }
      for (const f of SECOND_FIELDS) {
        const n = parseInt(secValues[f.key], 10);
        if (!Number.isFinite(n) || n <= 0) {
          setError(`${f.label} must be a positive integer of seconds`);
          setBusy(false);
          return;
        }
        payload[f.key] = n;
      }
      for (const f of INT_FIELDS) {
        const n = parseInt(intValues[f.key], 10);
        if (!Number.isFinite(n) || n <= 0) {
          setError(`${f.label} must be a positive integer`);
          setBusy(false);
          return;
        }
        payload[f.key] = n;
      }

      const res = await adminFetch(`/admin/featured/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="rounded-[8px] p-4"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
    >
      <p
        className="text-sm mb-4"
        style={{ color: 'var(--text-secondary)' }}
      >
        Updates take effect on the next auction tick. All fields are
        optional on the backend — leaving a value unchanged sends it
        back as-is.
      </p>

      <FieldGroup title="Bid floor & tier amounts (Rand)">
        {RAND_FIELDS.map((f) => (
          <RandInput
            key={f.key}
            label={f.label}
            hint={f.hint}
            value={randValues[f.key]}
            onChange={(v) =>
              setRandValues((s) => ({ ...s, [f.key]: v }))
            }
          />
        ))}
      </FieldGroup>

      <FieldGroup title="Tier durations & timers (seconds)">
        {SECOND_FIELDS.map((f) => (
          <SecondsInput
            key={f.key}
            label={f.label}
            hint={f.hint}
            value={secValues[f.key]}
            onChange={(v) =>
              setSecValues((s) => ({ ...s, [f.key]: v }))
            }
          />
        ))}
      </FieldGroup>

      <FieldGroup title="Slot rail">
        {INT_FIELDS.map((f) => (
          <SecondsInput
            key={f.key}
            label={f.label}
            hint={f.hint}
            value={intValues[f.key]}
            onChange={(v) =>
              setIntValues((s) => ({ ...s, [f.key]: v }))
            }
          />
        ))}
      </FieldGroup>

      {error && (
        <p className="text-xs mb-3" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}
      {success && (
        <p className="text-xs mb-3" style={{ color: '#22c55e' }}>
          Saved.
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="px-4 py-2.5 rounded-[6px] text-sm font-medium"
        style={{
          background: busy ? 'var(--bg-inset)' : 'var(--red)',
          color: busy ? 'var(--text-tertiary)' : '#fff',
          border: busy ? '0.5px solid var(--border)' : 'none',
          cursor: busy ? 'not-allowed' : 'pointer',
        }}
      >
        {busy ? 'Saving…' : 'Save settings'}
      </button>
    </div>
  );
}

function FieldGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <p
        className="text-xs uppercase mb-3"
        style={{
          color: 'var(--text-tertiary)',
          letterSpacing: '0.05em',
          fontWeight: 500,
        }}
      >
        {title}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {children}
      </div>
    </div>
  );
}

function RandInput({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label
        className="text-xs mb-1 block"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {label}
        {hint && (
          <span className="ml-1" style={{ color: 'var(--text-tertiary)' }}>
            — {hint}
          </span>
        )}
      </label>
      <div className="relative">
        <span
          className="absolute left-3 top-1/2 -translate-y-1/2 text-sm"
          style={{ color: 'var(--text-tertiary)' }}
        >
          R
        </span>
        <input
          type="number"
          min={0}
          step="1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full pl-7 pr-3 py-2 rounded-[6px] text-sm"
          style={{
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-primary)',
          }}
        />
      </div>
    </div>
  );
}

function SecondsInput({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label
        className="text-xs mb-1 block"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {label}
        {hint && (
          <span className="ml-1" style={{ color: 'var(--text-tertiary)' }}>
            — {hint}
          </span>
        )}
      </label>
      <input
        type="number"
        min={1}
        step="1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-[6px] text-sm"
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-primary)',
        }}
      />
    </div>
  );
}
