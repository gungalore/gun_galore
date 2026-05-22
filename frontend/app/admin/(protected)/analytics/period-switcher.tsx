'use client';

import { useRouter, useSearchParams } from 'next/navigation';

// Tiny client-side switcher. Pushing query-param changes triggers a
// server re-render of the parent page which re-fetches the analytics
// endpoints — no client-side state-management needed.

const PERIODS = [
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: '365d', label: 'Last 12 months' },
  { key: 'all', label: 'All time' },
];

const BUCKETS = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

export default function PeriodSwitcher({
  currentPeriod,
  currentBucket,
}: {
  currentPeriod: string;
  currentBucket: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function update(key: 'period' | 'bucket', value: string) {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    router.push(`/admin/analytics?${next.toString()}`);
  }

  return (
    <div className="flex gap-3 flex-wrap items-center mb-6">
      <div
        className="inline-flex rounded-[6px] overflow-hidden"
        style={{ border: '0.5px solid var(--border)' }}
      >
        {PERIODS.map((p) => {
          const active = p.key === currentPeriod;
          return (
            <button
              key={p.key}
              onClick={() => update('period', p.key)}
              className="px-3 py-1.5 text-xs"
              style={{
                background: active ? 'var(--red)' : 'var(--bg-card)',
                color: active ? '#fff' : 'var(--text-secondary)',
                fontWeight: active ? 500 : 400,
                borderRight: '0.5px solid var(--border)',
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div
        className="inline-flex rounded-[6px] overflow-hidden"
        style={{ border: '0.5px solid var(--border)' }}
      >
        <span
          className="px-3 py-1.5 text-xs"
          style={{
            background: 'var(--bg-inset)',
            color: 'var(--text-tertiary)',
            borderRight: '0.5px solid var(--border)',
          }}
        >
          Bucket
        </span>
        {BUCKETS.map((b) => {
          const active = b.key === currentBucket;
          return (
            <button
              key={b.key}
              onClick={() => update('bucket', b.key)}
              className="px-3 py-1.5 text-xs"
              style={{
                background: active ? 'var(--red)' : 'var(--bg-card)',
                color: active ? '#fff' : 'var(--text-secondary)',
                fontWeight: active ? 500 : 400,
                borderRight: '0.5px solid var(--border)',
              }}
            >
              {b.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
