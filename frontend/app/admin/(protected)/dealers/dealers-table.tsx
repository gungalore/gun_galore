'use client';

// Client-side dealer table with inline create / edit / deactivate.
// Search is form-driven (re-fetches the server-rendered page with
// ?search=). Per-row actions open a modal pre-filled with the dealer's
// current values; saving sends a PATCH with a reason.
//
// Soft-delete only — Dealer.isActive flips to false. Toggle button
// on the row card lets the operator deactivate / reactivate without
// opening the full edit modal.

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

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
  suburb: string;
  city: string;
  province: string;
  postalCode: string;
  phone: string | null;
  email: string | null;
  lat: number | null;
  lng: number | null;
  isActive: boolean;
  _count: { transactions: number };
}

function getToken() {
  return document.cookie.match(/admin_token=([^;]+)/)?.[1] ?? '';
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

export default function DealersTable({ initialDealers }: { initialDealers: Dealer[] }) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Dealer | null>(null);

  return (
    <>
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
            No dealers in the directory yet. Click "Add dealer" to create the first one.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {initialDealers.map((d) => (
            <div
              key={d.id}
              className="rounded-[8px] p-4"
              style={{
                background: 'var(--bg-card)',
                border: `0.5px solid ${d.isActive ? 'var(--border)' : 'var(--text-tertiary)'}`,
                opacity: d.isActive ? 1 : 0.65,
              }}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p
                    className="font-medium"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {d.name}
                  </p>
                  <p
                    className="text-xs"
                    style={{ color: 'var(--text-tertiary)', fontFamily: 'monospace' }}
                  >
                    Licence: {d.licenceNumber}
                  </p>
                </div>
                {!d.isActive && (
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{ background: 'var(--text-tertiary)18', color: 'var(--text-tertiary)' }}
                  >
                    INACTIVE
                  </span>
                )}
              </div>
              <p
                className="text-xs mb-3"
                style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
              >
                {d.address}
                <br />
                {d.suburb}, {d.city}, {d.province.replace(/_/g, ' ')} · {d.postalCode}
              </p>
              {(d.phone || d.email) && (
                <p
                  className="text-xs mb-3"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {d.phone && <span>{d.phone}</span>}
                  {d.phone && d.email && <span> · </span>}
                  {d.email && <span>{d.email}</span>}
                </p>
              )}
              <div className="flex justify-between items-center">
                <span
                  className="text-xs"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {d._count.transactions} transaction
                  {d._count.transactions === 1 ? '' : 's'}
                </span>
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
          ))}
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
    </>
  );
}

function DealerFormModal({
  mode,
  dealer,
  onClose,
  onDone,
}: {
  mode: 'create' | 'edit';
  dealer?: Dealer;
  onClose: () => void;
  onDone: () => void;
}) {
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
    isActive: dealer?.isActive ?? true,
  });
  const [reason, setReason] = useState('');
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
      if (mode === 'edit') {
        body.isActive = form.isActive;
        body.reason = reason.trim();
      }

      const url =
        mode === 'create'
          ? `${API_URL}/admin/dealers`
          : `${API_URL}/admin/dealers/${dealer!.id}`;
      const res = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
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
        <p
          className="text-base mb-4"
          style={{ color: 'var(--text-primary)', fontWeight: 500 }}
        >
          {mode === 'create' ? 'Add dealer' : `Edit ${dealer?.name}`}
        </p>

        <div className="grid grid-cols-1 gap-3">
          <Field label="Dealer name">
            <input
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              style={inputStyle}
            />
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
            <input
              required
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Suburb">
              <input
                required
                value={form.suburb}
                onChange={(e) => set('suburb', e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="City">
              <input
                required
                value={form.city}
                onChange={(e) => set('city', e.target.value)}
                style={inputStyle}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Province">
              <select
                value={form.province}
                onChange={(e) => set('province', e.target.value)}
                style={inputStyle}
              >
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
              <input
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                style={inputStyle}
                placeholder="+27..."
              />
            </Field>
            <Field label="Email (optional)">
              <input
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                style={inputStyle}
              />
            </Field>
          </div>

          {mode === 'edit' && (
            <>
              <label className="flex items-center gap-2 text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => set('isActive', e.target.checked)}
                  style={{ accentColor: 'var(--red)' }}
                />
                <span>
                  Active (uncheck to deactivate — buyers won't see this dealer at checkout)
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
              disabled={busy || (mode === 'edit' && reason.trim().length < 3)}
              className="flex-1 py-2 rounded text-sm font-medium"
              style={{
                background: busy ? 'var(--bg-inset)' : 'var(--red)',
                color: busy ? 'var(--text-tertiary)' : '#fff',
                border: 'none',
                cursor: busy ? 'not-allowed' : 'pointer',
              }}
            >
              {busy ? 'Saving…' : mode === 'create' ? 'Create dealer' : 'Save changes'}
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
      <label
        className="text-xs uppercase tracking-wider mb-1 block"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}
