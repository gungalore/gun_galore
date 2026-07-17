'use client';

// Client-side dealer table with inline create / edit / review-&-activate.
// Search is form-driven (re-fetches the server-rendered page with ?search=).
// Filter tabs (Active / Pending review / Auto-added / All) drive the same
// page with query params. Per-row actions open a modal pre-filled with the
// dealer's current values; saving sends a PATCH with a reason.
//
// Soft-delete only — Dealer.isActive flips to false. Auto-registered dealers
// (source=AUTO_VERIFICATION) land inactive + unverified and must be reviewed
// & activated before checkout will offer them.

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { adminFetch } from '@/lib/admin-auth';

const PROVINCES = [
  'EASTERN_CAPE',
  'FREE_STATE',
  'GAUTENG',
  'KWAZULU_NATAL',
  'LIMPOPO',
  'MPUMALANGA',
  'NORTHERN_CAPE',
  'NORTH_WEST',
  'WESTERN_CAPE',
];

interface Dealer {
  id: string;
  name: string;
  licenceNumber: string;
  address: string;
  suburb: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  phone: string | null;
  email: string | null;
  lat: number | null;
  lng: number | null;
  isActive: boolean;
  source: string;
  isVerified: boolean;
  rawAddress: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  _count: { transactions: number };
  transactions?: { id: string }[];
}

interface ActiveFilters {
  source: string | null;
  pending: boolean;
  includeInactive: boolean;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-primary)',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 13,
  outline: 'none',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

export default function DealersTable({
  initialDealers,
  pendingCount,
  activeFilters,
}: {
  initialDealers: Dealer[];
  pendingCount: number;
  activeFilters: ActiveFilters;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Dealer | null>(null);
  const [reviewing, setReviewing] = useState<Dealer | null>(null);

  // Which tab is highlighted, derived from the URL-driven filters.
  const currentTab: 'active' | 'pending' | 'auto' | 'all' = activeFilters.pending
    ? 'pending'
    : activeFilters.source === 'AUTO_VERIFICATION'
      ? 'auto'
      : activeFilters.includeInactive
        ? 'all'
        : 'active';

  const TABS: { key: typeof currentTab; label: string; href: string; badge?: number }[] = [
    { key: 'active', label: 'Active', href: '/admin/dealers' },
    {
      key: 'pending',
      label: 'Pending review',
      href: '/admin/dealers?pending=true',
      badge: pendingCount,
    },
    {
      key: 'auto',
      label: 'Auto-added',
      href: '/admin/dealers?source=AUTO_VERIFICATION&includeInactive=true',
    },
    { key: 'all', label: 'All', href: '/admin/dealers?includeInactive=true' },
  ];

  return (
    <>
      {/* Filter tabs */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        {TABS.map((t) => {
          const active = t.key === currentTab;
          return (
            <button
              key={t.key}
              onClick={() => router.push(t.href)}
              className="px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5"
              style={{
                background: active ? 'var(--red)' : 'var(--bg-card)',
                color: active ? '#fff' : 'var(--text-secondary)',
                border: `0.5px solid ${active ? 'var(--red)' : 'var(--border)'}`,
                cursor: 'pointer',
              }}
            >
              {t.label}
              {t.badge != null && t.badge > 0 && (
                <span
                  className="px-1.5 rounded-full text-[10px] font-semibold"
                  style={{
                    background: active ? 'rgba(255,255,255,0.25)' : 'var(--red)',
                    color: '#fff',
                    minWidth: 16,
                    textAlign: 'center',
                  }}
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setCreateOpen(true)}
          className="px-3 py-1.5 rounded text-sm font-medium"
          style={{ background: 'var(--red)', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          + Add dealer
        </button>
        <form method="GET" className="flex gap-2 flex-1 max-w-md">
          <input
            name="search"
            placeholder="Search by name / licence / city…"
            className="flex-1 px-3 py-1.5 rounded text-sm outline-none"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          />
          <button
            type="submit"
            className="px-3 py-1.5 rounded text-sm"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-secondary)',
            }}
          >
            Search
          </button>
        </form>
      </div>

      {initialDealers.length === 0 ? (
        <div
          className="rounded-[8px] p-6 text-center"
          style={{ background: 'var(--bg-card)', border: '0.5px dashed var(--border)' }}
        >
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {currentTab === 'pending'
              ? 'No dealers awaiting review. Auto-added dealers appear here after a firearm transfer is verified.'
              : 'No dealers to show. Click "Add dealer" to create one.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {initialDealers.map((d) => {
            const isAuto = d.source === 'AUTO_VERIFICATION';
            const isPending = !d.isVerified;
            const locationBits = [d.suburb, d.city, d.province?.replace(/_/g, ' '), d.postalCode].filter(
              Boolean,
            );
            const sourceTxId = d.transactions?.[0]?.id;
            return (
              <div
                key={d.id}
                className="rounded-[8px] p-4"
                style={{
                  background: 'var(--bg-card)',
                  border: `0.5px solid ${
                    isPending
                      ? 'var(--amber, #d97706)'
                      : d.isActive
                        ? 'var(--border)'
                        : 'var(--text-tertiary)'
                  }`,
                  opacity: d.isActive || isPending ? 1 : 0.65,
                }}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                      {d.name}
                    </p>
                    <p
                      className="text-xs"
                      style={{ color: 'var(--text-tertiary)', fontFamily: 'monospace' }}
                    >
                      Licence: {d.licenceNumber}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {isPending && (
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                        style={{ background: 'rgba(217,119,6,0.15)', color: '#d97706' }}
                      >
                        PENDING REVIEW
                      </span>
                    )}
                    {isAuto && (
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-full"
                        style={{ background: 'rgba(59,130,246,0.12)', color: '#3b82f6' }}
                      >
                        AUTO-ADDED
                      </span>
                    )}
                    {!d.isActive && !isPending && (
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-full"
                        style={{ background: 'var(--bg-inset)', color: 'var(--text-tertiary)' }}
                      >
                        INACTIVE
                      </span>
                    )}
                  </div>
                </div>

                <p
                  className="text-xs mb-2"
                  style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
                >
                  {d.address || <em style={{ color: 'var(--text-tertiary)' }}>No address on file</em>}
                  {locationBits.length > 0 && (
                    <>
                      <br />
                      {locationBits.join(', ')}
                    </>
                  )}
                </p>

                {isAuto && d.rawAddress && d.rawAddress !== d.address && (
                  <p className="text-[11px] mb-2" style={{ color: 'var(--text-tertiary)' }}>
                    OCR read: “{d.rawAddress}”
                  </p>
                )}

                {(d.phone || d.email) && (
                  <p className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>
                    {d.phone && <span>{d.phone}</span>}
                    {d.phone && d.email && <span> · </span>}
                    {d.email && <span>{d.email}</span>}
                  </p>
                )}

                {isAuto && (
                  <p className="text-[11px] mb-3" style={{ color: 'var(--text-tertiary)' }}>
                    First seen {fmtDate(d.firstSeenAt)} · Last seen {fmtDate(d.lastSeenAt)}
                    {sourceTxId && (
                      <>
                        {' · '}
                        <Link
                          href={`/admin/transactions/${sourceTxId}`}
                          style={{ color: 'var(--red)', textDecoration: 'underline' }}
                        >
                          View source transfer
                        </Link>
                      </>
                    )}
                  </p>
                )}

                <div className="flex justify-between items-center gap-2">
                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    {d._count.transactions} transaction
                    {d._count.transactions === 1 ? '' : 's'}
                  </span>
                  <div className="flex gap-1.5">
                    {isPending && (
                      <button
                        onClick={() => setReviewing(d)}
                        className="text-xs px-2.5 py-1 rounded font-medium"
                        style={{
                          background: 'var(--red)',
                          border: 'none',
                          color: '#fff',
                          cursor: 'pointer',
                        }}
                      >
                        Review &amp; activate
                      </button>
                    )}
                    <button
                      onClick={() => setEditing(d)}
                      className="text-xs px-2 py-1 rounded"
                      style={{
                        background: 'transparent',
                        border: '0.5px solid var(--border)',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                      }}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {createOpen && (
        <DealerFormModal
          mode="create"
          onClose={() => setCreateOpen(false)}
          onDone={() => {
            setCreateOpen(false);
            router.refresh();
          }}
        />
      )}
      {editing && (
        <DealerFormModal
          mode="edit"
          dealer={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
      {reviewing && (
        <DealerFormModal
          mode="review"
          dealer={reviewing}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function DealerFormModal({
  mode,
  dealer,
  onClose,
  onDone,
}: {
  mode: 'create' | 'edit' | 'review';
  dealer?: Dealer;
  onClose: () => void;
  onDone: () => void;
}) {
  const isReview = mode === 'review';
  const [form, setForm] = useState({
    name: dealer?.name ?? '',
    licenceNumber: dealer?.licenceNumber ?? '',
    address: dealer?.address ?? '',
    suburb: dealer?.suburb ?? '',
    city: dealer?.city ?? '',
    province: dealer?.province ?? 'GAUTENG',
    postalCode: dealer?.postalCode ?? '',
    phone: dealer?.phone ?? '',
    email: dealer?.email ?? '',
    // Reviewing an auto entry activates it by default; the admin can uncheck.
    isActive: isReview ? true : (dealer?.isActive ?? true),
  });
  const [reason, setReason] = useState(isReview ? 'Reviewed auto-registered dealer' : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(key: keyof typeof form, value: string | boolean) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        licenceNumber: form.licenceNumber.trim(),
        address: form.address.trim(),
        suburb: form.suburb.trim(),
        city: form.city.trim(),
        province: form.province,
        postalCode: form.postalCode.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
      };
      if (mode === 'edit' || mode === 'review') {
        body.isActive = form.isActive;
        body.reason = reason.trim();
      }
      if (mode === 'review') {
        // Reviewing an auto-registered dealer marks it verified. Activation is
        // whatever the isActive checkbox says (defaulted on).
        body.isVerified = true;
      }

      const url =
        mode === 'create' ? `/admin/dealers` : `/admin/dealers/${dealer!.id}`;
      const res = await adminFetch(url, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? `Error ${res.status}`);
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setBusy(false);
    }
  }

  return (
    <div
      onClick={() => !busy && onClose()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          maxWidth: 560,
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: 24,
          borderRadius: 10,
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <p className="text-base mb-1" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
          {mode === 'create'
            ? 'Add dealer'
            : mode === 'review'
              ? `Review & activate ${dealer?.name}`
              : `Edit ${dealer?.name}`}
        </p>
        {isReview && (
          <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
            This dealer was auto-added from a verified firearm transfer. Confirm the
            licence and complete the address, then activate — buyers will then be
            offered it at DEALER_TRANSFER checkout.
            {dealer?.rawAddress && (
              <>
                <br />
                OCR read: <strong>“{dealer.rawAddress}”</strong>
              </>
            )}
          </p>
        )}

        <div className="grid grid-cols-1 gap-3">
          <Field label="Dealer name">
            <input required value={form.name} onChange={(e) => set('name', e.target.value)} style={inputStyle} />
          </Field>
          <Field label="SAPS licence number">
            <input
              required
              value={form.licenceNumber}
              onChange={(e) => set('licenceNumber', e.target.value)}
              style={inputStyle}
              placeholder="e.g. 1234567"
            />
          </Field>
          <Field label="Street address">
            <input required value={form.address} onChange={(e) => set('address', e.target.value)} style={inputStyle} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Suburb">
              <input required value={form.suburb} onChange={(e) => set('suburb', e.target.value)} style={inputStyle} />
            </Field>
            <Field label="City">
              <input required value={form.city} onChange={(e) => set('city', e.target.value)} style={inputStyle} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Province">
              <select value={form.province} onChange={(e) => set('province', e.target.value)} style={inputStyle}>
                {PROVINCES.map((p) => (
                  <option key={p} value={p}>
                    {p.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Postal code">
              <input
                required
                value={form.postalCode}
                onChange={(e) => set('postalCode', e.target.value)}
                style={inputStyle}
                pattern="\d{4}"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone (optional)">
              <input value={form.phone} onChange={(e) => set('phone', e.target.value)} style={inputStyle} placeholder="+27..." />
            </Field>
            <Field label="Email (optional)">
              <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} style={inputStyle} />
            </Field>
          </div>

          {(mode === 'edit' || mode === 'review') && (
            <>
              <label className="flex items-center gap-2 text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => set('isActive', e.target.checked)}
                  style={{ accentColor: 'var(--red)' }}
                />
                <span>
                  Active (uncheck to keep it out of checkout — buyers won&apos;t see this dealer)
                </span>
              </label>
              <Field label="Reason for change (≥3 chars, audit log)">
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </Field>
            </>
          )}

          {error && (
            <p className="text-xs" style={{ color: 'var(--red)' }}>
              {error}
            </p>
          )}

          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex-1 py-2 rounded text-sm"
              style={{
                background: 'var(--bg-inset)',
                color: 'var(--text-secondary)',
                border: '0.5px solid var(--border)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || ((mode === 'edit' || mode === 'review') && reason.trim().length < 3)}
              className="flex-1 py-2 rounded text-sm font-medium"
              style={{
                background: busy ? 'var(--bg-inset)' : 'var(--red)',
                color: busy ? 'var(--text-tertiary)' : '#fff',
                border: 'none',
                cursor: busy ? 'not-allowed' : 'pointer',
              }}
            >
              {busy
                ? 'Saving…'
                : mode === 'create'
                  ? 'Create dealer'
                  : mode === 'review'
                    ? 'Verify & save'
                    : 'Save changes'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </label>
      {children}
    </div>
  );
}
