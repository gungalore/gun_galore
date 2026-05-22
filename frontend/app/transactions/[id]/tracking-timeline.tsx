'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';

// Mirrors backend/src/shipping/tracking.service.ts:getTimeline() response.
interface TimelineEvent {
  id: string;
  status: string;
  rawStatus: string | null;
  source: 'INTERNAL' | 'PUDO' | 'TCG' | string;
  message: string | null;
  occurredAt: string;
  recordedAt: string;
  label: string;
}

interface TimelineResponse {
  transactionId: string;
  shippingMethod: string | null;
  shippingStatus: string | null;
  trackingReference: string | null;
  milestones: {
    paidAt: string | null;
    dispatchedAt: string | null;
    deliveredAt: string | null;
    releasedAt: string | null;
  };
  events: TimelineEvent[];
}

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const SOURCE_LABEL: Record<string, string> = {
  INTERNAL: 'Gun Galore',
  PUDO: 'Pudo',
  TCG: 'The Courier Guy',
};

const SOURCE_COLOR: Record<string, string> = {
  INTERNAL: '#6366f1',
  PUDO: '#00a03c',
  TCG: '#f59e0b',
};

// Sub-set of collapsed statuses that mark the "active" branch of the
// timeline so the dot for the latest event renders solid; older ones
// fade. Keeps the eye drawn to the current state.
function isLatestActive(idx: number, total: number): boolean {
  return idx === total - 1;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString('en-ZA', {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (sameDay) return `Today, ${time}`;
  const date = d.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
  });
  return `${date}, ${time}`;
}

export function TrackingTimeline({ transactionId }: { transactionId: string }) {
  const { getToken } = useAuth();
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = await getToken();
        const res = await fetch(
          `${API_URL}/transactions/${transactionId}/tracking`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            cache: 'no-store',
          },
        );
        if (!res.ok) {
          if (!cancelled) {
            setError('Tracking unavailable');
            setLoading(false);
          }
          return;
        }
        const json = (await res.json()) as TimelineResponse;
        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError('Tracking unavailable');
          setLoading(false);
        }
      }
    }
    load();
    // Soft-refresh every 60s while the page is open so the buyer sees
    // updates without reloading. The cron behind the API polls Pudo at
    // 10-min granularity, so a 60s page refresh keeps the timeline in
    // sync within a minute of new server-side data.
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [getToken, transactionId]);

  if (loading) {
    return (
      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        Loading tracking…
      </p>
    );
  }
  if (error || !data) {
    return (
      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        {error ?? 'No tracking events yet.'}
      </p>
    );
  }
  if (data.events.length === 0) {
    return (
      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        Tracking events will appear here as the parcel moves.
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {data.events.map((e, idx) => {
        const active = isLatestActive(idx, data.events.length);
        const color = SOURCE_COLOR[e.source] ?? 'var(--text-tertiary)';
        return (
          <li
            key={e.id}
            className="flex gap-3"
            style={{ opacity: active ? 1 : 0.75 }}
          >
            <div className="flex flex-col items-center pt-1.5">
              <span
                className="rounded-full"
                style={{
                  width: 8,
                  height: 8,
                  background: active ? color : 'var(--text-tertiary)',
                  boxShadow: active ? `0 0 0 3px ${color}22` : 'none',
                }}
              />
              {idx < data.events.length - 1 && (
                <span
                  style={{
                    width: 1,
                    flex: 1,
                    minHeight: 16,
                    background: 'var(--border-divider)',
                    marginTop: 4,
                  }}
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p
                className="text-sm leading-5"
                style={{
                  color: active
                    ? 'var(--text-primary)'
                    : 'var(--text-secondary)',
                }}
              >
                {e.label}
              </p>
              <p
                className="text-xs mt-0.5"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {formatWhen(e.occurredAt)}
                <span style={{ margin: '0 6px' }}>·</span>
                <span style={{ color }}>{SOURCE_LABEL[e.source] ?? e.source}</span>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
