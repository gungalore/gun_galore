'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminFetch, requireAdminToken } from '@/lib/admin-auth';
import { AdminPageHeader } from '@/components/admin/page-header';

// Alerts inbox — the working surface for AdminAlert rows. The command
// center counts unresolved alerts and deep-links here; before this page
// existed the count was visible but alerts could only be read or
// resolved with raw SQL.
//
// Triage tooling (type chips, urgent-only, multi-select bulk resolve,
// load-more) exists because a single cron sweep can raise 30 rows of the
// same type: on a flat 100-row list that meant 30 individual clicks with a
// full reload between each, and anything past row 100 was invisible with no
// hint that more existed.

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

// Distinct types + unresolved counts from GET /admin/alerts/types. Served
// separately from the list so the chip row stays complete while a filter is
// applied (chips derived only from a filtered page would collapse to one).
interface AlertTypeFacet {
  type: string;
  unresolved: number;
}

// What POST /admin/alerts/bulk-resolve reports back. The server resolves each
// alert individually (CAS-guarded + audited per row), so a batch can land
// partially — we render the real numbers rather than assuming success.
interface BulkResolveResult {
  resolved: number;
  skipped: number;
  skippedIds: string[];
  failed: { id: string; message: string }[];
}

// One page of alerts. Matches the backend default; a full page back is the
// signal that there is more behind the cursor.
const PAGE_SIZE = 100;

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

// Map an alert type to the admin surface where the referenced entity lives,
// so rows are actionable instead of text-only dead ends. Types map by PREFIX
// (backend types share families); unmapped types render no link.
function alertLink(type: string, referenceId: string | null): string | null {
  const t = type.toUpperCase();
  // System/infra alerts — no per-id target; land on the health dashboard
  // (which shows cron freshness, service probes, and SMS state). These
  // reference a source name or key, not an entity id, so they route here
  // regardless of referenceId.
  if (
    t.startsWith('WEBHOOK_SIGNATURE') ||
    t.startsWith('CRON_') ||
    t.startsWith('SMS_')
  ) {
    return '/admin/health';
  }
  // ── Types whose referenceId is NOT an entity id, so they must be routed
  // BEFORE the id-shaped branches below (each would otherwise produce a
  // confident link to a 404).
  //
  // PEACH_PAYOUT_PARTIAL carries the Peach payout requestId, not a
  // transaction — the payout run lives on Held Funds.
  if (t.startsWith('PEACH_PAYOUT')) return '/admin/manual-payments';
  // An unmatched chargeback carries a gateway payment id we could NOT tie to
  // an order, so there is no per-transaction page to open.
  if (t === 'CHARGEBACK_UNMATCHED') return '/admin/transactions';
  // Support tickets and complaints are both worked in flat queues.
  if (t.startsWith('SUPPORT_TICKET')) return '/admin/support';
  if (t.startsWith('COMPLAINT')) return '/admin/complaints';
  // A dealer auto-registered off an approved transfer is reviewed in the
  // dealer register (the referenceId is the new Dealer row, which has no
  // dedicated page). Checked with === so it cannot swallow
  // DEALER_AUTO_REGISTER_NO_LICENCE, which IS transaction-shaped.
  if (t === 'DEALER_AUTO_REGISTERED') return '/admin/dealers';

  if (!referenceId) return null;
  // Transaction-shaped references.
  if (
    t.startsWith('STUCK_HELD_FUNDS') ||
    t.startsWith('DEALER_TRANSFER') ||
    // DEALER_VERIFICATION_* and DEALER_VERIFY_UNPAID both key on the tx.
    t.startsWith('DEALER_VERIF') ||
    t.startsWith('DEALER_AUTO_REGISTER_NO_LICENCE') ||
    t.startsWith('DISPATCH_SLA') ||
    t.startsWith('SHIPMENT_') ||
    t.startsWith('PEACH_WEBHOOK') ||
    t.startsWith('CHARGEBACK_') ||
    t.startsWith('SALE_REJECT') ||
    t.startsWith('SALE_ACCEPT') ||
    t.startsWith('BUYER_CANCEL') ||
    t.startsWith('BUYER_DISPUTE') ||
    t.startsWith('EXPERIENCE_') ||
    t.startsWith('ADMIN_REFUND') ||
    t.startsWith('DELIVERY_')
  ) {
    return `/admin/transactions/${referenceId}`;
  }
  // User-shaped references.
  if (
    t.startsWith('KYC_') ||
    t.startsWith('BANK_VERIFY') ||
    t.startsWith('SELLER_REJECT') ||
    t.startsWith('SELLER_REPORTED') ||
    t.startsWith('SELLER_DISPATCH') ||
    t.startsWith('BIDDER_')
  ) {
    return `/admin/users/${referenceId}`;
  }
  // Listing-shaped references (LISTING_REPORTED carries the listing id).
  if (t.startsWith('LISTING_')) return `/admin/listings/${referenceId}`;
  return null;
}

function prettyType(t: string): string {
  return t.replace(/_/g, ' ').toLowerCase();
}

// Turn an ENUM_LIKE_VALUE into readable text without lowercasing a case
// number (CO000123) or a username.
function humanise(v: string): string {
  return /^[A-Z0-9_]+$/.test(v) && v.includes('_')
    ? v.replace(/_/g, ' ').toLowerCase()
    : v;
}

// Most alerts store a plain human sentence in `context`, but a handful
// (COMPLAINT_LODGED, LISTING_REPORTED, SELLER_REPORTED, SELLER_REJECT_*)
// JSON.stringify a payload — which used to render in the inbox as a raw
// {"referenceNumber":"CO000123",...} blob the operator had to mentally parse.
// Parse defensively and lay the known fields out as friendly text; anything
// that is not a JSON object (or has no field we recognise) falls back to the
// raw string, so a new alert type can never render as nothing.
function describeContext(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return trimmed;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return trimmed;
  }
  const o = parsed as Record<string, unknown>;

  const parts: string[] = [];
  const push = (value: unknown, transform: (s: string) => string = (s) => s) => {
    if (typeof value === 'string' && value.trim()) parts.push(transform(value.trim()));
  };

  // Ordered most-identifying first: case number, what it is about, then the
  // operator's own words.
  push(o.referenceNumber); // COMPLAINT_LODGED — e.g. CO000123
  push(o.category, humanise); // complaint category / report reason
  push(o.reason, humanise); // LISTING_REPORTED / SELLER_REPORTED / reject reason
  push(o.subject);
  push(o.note);
  push(o.source, humanise); // SELLER_REJECT_* — which flow raised it
  push(o.complainant, (v) => `by ${v}`);
  if (o.drovePayoutHold === true) parts.push('PAYOUT HELD');

  return parts.length > 0 ? parts.join(' · ') : trimmed;
}

export default function AdminAlertsPage() {
  const [alerts, setAlerts] = useState<AdminAlertRow[] | null>(null);
  const [facets, setFacets] = useState<AlertTypeFacet[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Filters — server-side so a filtered view pages through ALL matching
  // alerts, not just the ones that happened to be on the first page.
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [urgentOnly, setUrgentOnly] = useState(false);

  // Cursor paging state. `hasMore` is inferred from a full page coming back.
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Bulk selection.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingBulk, setConfirmingBulk] = useState(false);
  const [bulkReason, setBulkReason] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  const queryFor = useCallback(
    (cursor?: string) => {
      const p = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (typeFilter) p.set('type', typeFilter);
      if (urgentOnly) p.set('urgent', 'true');
      if (cursor) p.set('cursor', cursor);
      return `/admin/alerts?${p.toString()}`;
    },
    [typeFilter, urgentOnly],
  );

  const load = useCallback(async () => {
    const res = await adminFetch(queryFor());
    if (res.ok) {
      const rows = (await res.json()) as AdminAlertRow[];
      setAlerts(rows);
      setHasMore(rows.length === PAGE_SIZE);
      setError(null);
    } else {
      setError(`Could not load alerts (HTTP ${res.status}).`);
    }
    // Chip counts, refreshed alongside the list so resolving a burst visibly
    // drains its chip. Failure here is not worth an error banner — the chips
    // fall back to the types present in the loaded rows.
    const facetRes = await adminFetch('/admin/alerts/types');
    if (facetRes.ok) setFacets((await facetRes.json()) as AlertTypeFacet[]);
  }, [queryFor]);

  useEffect(() => {
    if (!requireAdminToken()) return;
    void load();
  }, [load]);

  async function loadMore() {
    const last = alerts?.[alerts.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const res = await adminFetch(queryFor(last.id));
      if (!res.ok) {
        setError(`Could not load more alerts (HTTP ${res.status}).`);
        return;
      }
      const rows = (await res.json()) as AdminAlertRow[];
      setAlerts((prev) => [...(prev ?? []), ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
      setError(null);
    } finally {
      setLoadingMore(false);
    }
  }

  // Changing a filter restarts paging and drops the selection — the selected
  // ids may not be in the new view, and a "Resolve selected (12)" bar over a
  // list showing 3 rows is how an operator resolves something by accident.
  function applyFilters(next: { type?: string | null; urgent?: boolean }) {
    if (next.type !== undefined) setTypeFilter(next.type);
    if (next.urgent !== undefined) setUrgentOnly(next.urgent);
    setSelected(new Set<string>());
    setConfirmingBulk(false);
    setBulkResult(null);
    setHasMore(false);
  }

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
      setSelected((prev) => {
        const nextSel = new Set(prev);
        nextSel.delete(id);
        return nextSel;
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function bulkResolve() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkBusy(true);
    setError(null);
    setBulkResult(null);
    try {
      const res = await adminFetch('/admin/alerts/bulk-resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alertIds: ids,
          reason: bulkReason.trim() || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<
        BulkResolveResult
      > & { message?: string };
      if (!res.ok) {
        setError(body.message ?? `Bulk resolve failed (HTTP ${res.status}).`);
        return;
      }
      // Report what the server actually did. A batch can land partially (a
      // second admin resolving the same burst trips the per-alert CAS), and
      // saying "resolved 12" when 3 were skipped hides a real race.
      const bits = [`Resolved ${body.resolved ?? 0} of ${ids.length}`];
      if (body.skipped) bits.push(`${body.skipped} already resolved`);
      if (body.failed?.length) bits.push(`${body.failed.length} failed`);
      setBulkResult(bits.join(' · '));
      if (body.failed?.length) {
        setError(
          `Some alerts did not resolve: ${body.failed
            .map((f) => f.message)
            .join('; ')}`,
        );
      }
      setConfirmingBulk(false);
      setBulkReason('');
      setSelected(new Set<string>());
      await load();
    } finally {
      setBulkBusy(false);
    }
  }

  const unresolved = useMemo(
    () => (alerts ?? []).filter((a) => !a.resolved),
    [alerts],
  );
  const resolved = useMemo(
    () => (alerts ?? []).filter((a) => a.resolved),
    [alerts],
  );

  // Chip row = the facet endpoint's types (complete, with unresolved counts)
  // unioned with any type present in the loaded rows. The union keeps chips
  // working if the facet call fails, and surfaces types that only appear in
  // the resolved history (count 0).
  const chipTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of facets) counts.set(f.type, f.unresolved);
    for (const a of alerts ?? []) if (!counts.has(a.type)) counts.set(a.type, 0);
    if (typeFilter && !counts.has(typeFilter)) counts.set(typeFilter, 0);
    return Array.from(counts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  }, [facets, alerts, typeFilter]);

  const allVisibleSelected =
    unresolved.length > 0 && unresolved.every((a) => selected.has(a.id));

  function toggleSelected(id: string) {
    setBulkResult(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setBulkResult(null);
    setSelected(
      allVisibleSelected
        ? new Set<string>()
        : new Set<string>(unresolved.map((a) => a.id)),
    );
  }

  const chipStyle = (active: boolean) => ({
    background: active ? 'var(--red)' : 'var(--bg-card)',
    color: active ? '#fff' : 'var(--text-secondary)',
    border: `0.5px solid ${active ? 'transparent' : 'var(--border)'}`,
    cursor: 'pointer',
  });

  return (
    <div>
      <AdminPageHeader
        title="Alerts"
        meta="System-raised flags — resolve each once it's been handled"
      />

      {/* ── Filters ─────────────────────────────────────────────────
          Chips narrow to one alert family; the urgent toggle cuts across
          all of them. Both are server-side filters, so paging below stays
          correct inside the filtered set. */}
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <button
          type="button"
          onClick={() => applyFilters({ type: null })}
          className="px-3 py-1 rounded-full text-xs font-medium"
          style={chipStyle(typeFilter === null)}
        >
          All types
        </button>
        {chipTypes.map(({ type, count }) => (
          <button
            key={type}
            type="button"
            onClick={() =>
              applyFilters({ type: typeFilter === type ? null : type })
            }
            className="px-3 py-1 rounded-full text-xs font-medium"
            style={chipStyle(typeFilter === type)}
          >
            {prettyType(type)}
            {count > 0 && (
              <span style={{ opacity: 0.7 }}> ({count})</span>
            )}
          </button>
        ))}
        <button
          type="button"
          onClick={() => applyFilters({ urgent: !urgentOnly })}
          className="px-3 py-1 rounded-full text-xs font-medium ml-auto"
          style={chipStyle(urgentOnly)}
        >
          {urgentOnly ? '✓ Urgent only' : 'Urgent only'}
        </button>
      </div>

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

      {bulkResult && (
        <div
          className="rounded-[8px] px-4 py-3 mb-4 text-sm"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-secondary)',
          }}
        >
          {bulkResult}
        </div>
      )}

      {alerts === null ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Loading…
        </p>
      ) : (
        <>
          {/* ── Unresolved ─────────────────────────────────────────── */}
          <div className="flex items-center justify-between mb-2 gap-3">
            <p
              className="text-xs uppercase tracking-wider"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Needs attention ({unresolved.length})
            </p>
            {unresolved.length > 0 && (
              <button
                type="button"
                onClick={toggleSelectAll}
                className="text-xs"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-tertiary)',
                  cursor: 'pointer',
                }}
              >
                {allVisibleSelected ? 'Clear selection' : 'Select all shown'}
              </button>
            )}
          </div>
          {unresolved.length === 0 ? (
            <div
              className="rounded-[8px] p-6 text-center mb-8"
              style={{
                background: 'var(--bg-card)',
                border: '0.5px dashed var(--border)',
              }}
            >
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                {typeFilter || urgentOnly
                  ? 'No unresolved alerts match this filter.'
                  : 'All clear — no unresolved alerts.'}
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
              {unresolved.map((a, i) => {
                const detail = describeContext(a.context);
                return (
                  <div
                    key={a.id}
                    className="flex items-start gap-3 px-4 py-3"
                    style={
                      i < unresolved.length - 1
                        ? { borderBottom: '0.5px solid var(--border)' }
                        : undefined
                    }
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(a.id)}
                      onChange={() => toggleSelected(a.id)}
                      aria-label={`Select ${prettyType(a.type)} alert`}
                      className="shrink-0 mt-1"
                      style={{
                        width: 15,
                        height: 15,
                        accentColor: 'var(--red)',
                        cursor: 'pointer',
                      }}
                    />
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
                      {detail && (
                        <p
                          className="text-xs mt-1"
                          style={{
                            color: 'var(--text-secondary)',
                            lineHeight: 1.5,
                          }}
                        >
                          {detail}
                        </p>
                      )}
                      <p
                        className="text-xs mt-1"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        {timeAgo(a.createdAt)}
                      </p>
                    </div>
                    {/* Deep-link to the referenced entity so the admin can
                        act, then come back and Resolve. */}
                    {(() => {
                      const href = alertLink(a.type, a.referenceId);
                      return href ? (
                        <a
                          href={href}
                          className="shrink-0 px-3 py-1.5 rounded-[6px] text-xs font-medium"
                          style={{
                            background: 'var(--bg-inset)',
                            color: 'var(--text-secondary)',
                            border: '0.5px solid var(--border)',
                            textDecoration: 'none',
                          }}
                        >
                          Open
                        </a>
                      ) : null;
                    })()}
                    <button
                      type="button"
                      onClick={() => resolve(a.id)}
                      disabled={busyId === a.id}
                      className="shrink-0 px-3 py-1.5 rounded-[6px] text-xs font-medium"
                      style={{
                        background:
                          busyId === a.id ? 'var(--bg-inset)' : 'var(--red)',
                        color: busyId === a.id ? 'var(--text-tertiary)' : '#fff',
                        border: 'none',
                        cursor: busyId === a.id ? 'wait' : 'pointer',
                      }}
                    >
                      {busyId === a.id ? 'Resolving…' : 'Resolve'}
                    </button>
                  </div>
                );
              })}
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
                          {describeContext(a.context)}
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

          {/* ── Load more ──────────────────────────────────────────────
              Paging is a cursor on the last row already rendered, so newly
              raised alerts landing at the top of the list can't duplicate or
              skip rows mid-triage. */}
          {alerts.length > 0 && (
            <div className="mt-4 flex items-center gap-3">
              {hasMore ? (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="px-4 py-2 rounded-[8px] text-xs font-medium"
                  style={{
                    background: 'var(--bg-card)',
                    color: 'var(--text-secondary)',
                    border: '0.5px solid var(--border)',
                    cursor: loadingMore ? 'wait' : 'pointer',
                  }}
                >
                  {loadingMore
                    ? 'Loading…'
                    : `Showing ${alerts.length} — load ${PAGE_SIZE} more`}
                </button>
              ) : (
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Showing all {alerts.length}
                  {typeFilter || urgentOnly ? ' matching' : ''} alert
                  {alerts.length === 1 ? '' : 's'}.
                </span>
              )}
            </div>
          )}

          {/* ── Bulk bar ───────────────────────────────────────────────
              Sticky so it stays reachable while scrolling a long burst.
              Confirm-gated: resolving in bulk is the one action here that
              silently clears rows nobody has read yet. */}
          {selected.size > 0 && (
            <div
              style={{
                position: 'sticky',
                bottom: 16,
                marginTop: 16,
                zIndex: 60,
                background: 'var(--bg-card)',
                border: '0.5px solid var(--border)',
                borderRadius: 10,
                padding: '12px 16px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
              }}
            >
              <div className="flex items-center gap-3 flex-wrap">
                <span
                  style={{
                    color: 'var(--text-primary)',
                    fontWeight: 500,
                    fontSize: 13,
                  }}
                >
                  {selected.size} alert{selected.size === 1 ? '' : 's'} selected
                </span>
                {!confirmingBulk && (
                  <button
                    type="button"
                    onClick={() => setConfirmingBulk(true)}
                    className="px-3 py-1.5 rounded text-xs font-medium"
                    style={{
                      background: 'var(--red)',
                      color: '#fff',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    Resolve selected ({selected.size})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSelected(new Set<string>());
                    setConfirmingBulk(false);
                  }}
                  className="ml-auto text-xs"
                  style={{
                    background: 'transparent',
                    color: 'var(--text-tertiary)',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  Clear
                </button>
              </div>

              {confirmingBulk && (
                <div className="mt-3">
                  <p
                    className="text-xs mb-2"
                    style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}
                  >
                    Mark {selected.size} alert
                    {selected.size === 1 ? '' : 's'} handled? Each is resolved
                    individually and written to the audit log under your admin
                    account. This does not change any order, payout or user —
                    it only clears the flags.
                  </p>
                  <input
                    type="text"
                    value={bulkReason}
                    onChange={(e) => setBulkReason(e.target.value)}
                    placeholder="Reason for the audit log (optional)"
                    className="w-full px-3 py-2 rounded text-sm outline-none mb-2"
                    style={{
                      background: 'var(--bg-inset)',
                      border: '0.5px solid var(--border)',
                      color: 'var(--text-primary)',
                    }}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmingBulk(false)}
                      disabled={bulkBusy}
                      className="px-3 py-1.5 rounded text-xs"
                      style={{
                        background: 'var(--bg-inset)',
                        color: 'var(--text-secondary)',
                        border: '0.5px solid var(--border)',
                        cursor: bulkBusy ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={bulkResolve}
                      disabled={bulkBusy}
                      className="px-3 py-1.5 rounded text-xs font-medium"
                      style={{
                        background: bulkBusy ? 'var(--bg-inset)' : 'var(--red)',
                        color: bulkBusy ? 'var(--text-tertiary)' : '#fff',
                        border: 'none',
                        cursor: bulkBusy ? 'wait' : 'pointer',
                      }}
                    >
                      {bulkBusy
                        ? 'Resolving…'
                        : `Yes, resolve ${selected.size}`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
