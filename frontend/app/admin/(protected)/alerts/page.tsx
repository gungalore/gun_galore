'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import { AdminPageHeader } from '@/components/admin/page-header';

// Alerts inbox — the working surface for AdminAlert rows. The command
// center counts unresolved alerts and deep-links here; before this page
// existed the count was visible but alerts could only be read or
// resolved with raw SQL.

interface AdminAlertRow {
  id: string;
  type: string;
  context: string | null;
  referenceId: string | null;
  urgent: boolean;
  resolved: boolean;
  resolvedAt: string | null;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
  });
}

function prettyType(t: string): string {
  return t.replace(/_/g, ' ').toLowerCase();
}

export default function AdminAlertsPage() {
  const [alerts, setAlerts] = useState<AdminAlertRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await adminFetch('/admin/alerts?limit=100');
    if (res.ok) {
      setAlerts((await res.json()) as AdminAlertRow[]);
      setError(null);
    } else {
      setError(`Could not load alerts (HTTP ${res.status}).`);
    }
  }, []);

  useEffect(() => {
    if (!requireAdminToken()) return;
    void load();
  }, [load]);

  async function resolve(id: string) {
    setBusyId(id);
    try {
      const res = await adminFetch(`/admin/alerts/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        setError(body.message ?? `Resolve failed (HTTP ${res.status}).`);
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const unresolved = (alerts ?? []).filter((a) => !a.resolved);
  const resolved = (alerts ?? []).filter((a) => a.resolved);

  return (
    <div>
      <AdminPageHeader
        title="Alerts"
        meta="System-raised flags — resolve each once it's been handled"
      />

      {error && (
        <div
          className="rounded-[8px] px-4 py-3 mb-4 text-sm"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--red)',
            color: 'var(--red)',
          }}
        >
          {error}
        </div>
      )}

      {alerts === null ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Loading…
        </p>
      ) : (
        <>
          {/* ── Unresolved ─────────────────────────────────────────── */}
          <p
            className="text-xs uppercase tracking-wider mb-2"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Needs attention ({unresolved.length})
          </p>
          {unresolved.length === 0 ? (
            <div
              className="rounded-[8px] p-6 text-center mb-8"
              style={{
                background: 'var(--bg-card)',
                border: '0.5px dashed var(--border)',
              }}
            >
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                All clear — no unresolved alerts.
              </p>
            </div>
          ) : (
            <div
              className="rounded-[8px] overflow-hidden mb-8"
              style={{
                background: 'var(--bg-card)',
                border: '0.5px solid var(--border)',
              }}
            >
              {unresolved.map((a, i) => (
                <div
                  key={a.id}
                  className="flex items-start gap-3 px-4 py-3"
                  style={
                    i < unresolved.length - 1
                      ? { borderBottom: '0.5px solid var(--border)' }
                      : undefined
                  }
                >
                  <span
                    className="shrink-0 mt-0.5 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium"
                    style={{
                      background: a.urgent
                        ? 'rgba(200,16,46,0.15)'
                        : 'rgba(245,158,11,0.15)',
                      color: a.urgent ? 'var(--red)' : '#f59e0b',
                    }}
                  >
                    !
                  </span>
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-sm"
                      style={{
                        color: a.urgent ? 'var(--red)' : 'var(--text-primary)',
                        fontWeight: 500,
                      }}
                    >
                      {prettyType(a.type)}
                      {a.urgent && (
                        <span
                          className="ml-2 text-[10px] uppercase px-1.5 py-0.5 rounded-full"
                          style={{
                            background: 'rgba(200,16,46,0.15)',
                            color: 'var(--red)',
                            letterSpacing: '0.05em',
                          }}
                        >
                          urgent
                        </span>
                      )}
                    </p>
                    {a.context && (
                      <p
                        className="text-xs mt-1"
                        style={{
                          color: 'var(--text-secondary)',
                          lineHeight: 1.5,
                        }}
                      >
                        {a.context}
                      </p>
                    )}
                    <p
                      className="text-xs mt-1"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {timeAgo(a.createdAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => resolve(a.id)}
                    disabled={busyId === a.id}
                    className="shrink-0 px-3 py-1.5 rounded-[6px] text-xs font-medium"
                    style={{
                      background: busyId === a.id ? 'var(--bg-inset)' : 'var(--red)',
                      color: busyId === a.id ? 'var(--text-tertiary)' : '#fff',
                      border: 'none',
                      cursor: busyId === a.id ? 'wait' : 'pointer',
                    }}
                  >
                    {busyId === a.id ? 'Resolving…' : 'Resolve'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ── Resolved history ───────────────────────────────────── */}
          {resolved.length > 0 && (
            <>
              <p
                className="text-xs uppercase tracking-wider mb-2"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Resolved ({resolved.length})
              </p>
              <div
                className="rounded-[8px] overflow-hidden"
                style={{
                  background: 'var(--bg-card)',
                  border: '0.5px solid var(--border)',
                  opacity: 0.75,
                }}
              >
                {resolved.map((a, i) => (
                  <div
                    key={a.id}
                    className="flex items-start gap-3 px-4 py-2.5"
                    style={
                      i < resolved.length - 1
                        ? { borderBottom: '0.5px solid var(--border)' }
                        : undefined
                    }
                  >
                    <span
                      className="shrink-0 mt-0.5 w-6 h-6 rounded-full flex items-center justify-center text-xs"
                      style={{
                        background: 'rgba(34,197,94,0.12)',
                        color: '#22c55e',
                      }}
                    >
                      ✓
                    </span>
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm truncate"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {prettyType(a.type)}
                      </p>
                      {a.context && (
                        <p
                          className="text-xs mt-0.5 truncate"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          {a.context}
                        </p>
                      )}
                    </div>
                    <span
                      className="text-xs shrink-0"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      resolved {a.resolvedAt ? timeAgo(a.resolvedAt) : ''}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
