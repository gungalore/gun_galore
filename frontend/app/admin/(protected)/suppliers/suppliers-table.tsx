'use client';

// Supplier directory table with inline create / edit / deactivate. Mirrors
// the dealers-table.tsx idiom (client component, adminFetch, modal form)
// but reloads via the page's onChanged callback (deals-page pattern) rather
// than router.refresh, since the page fetches its own data client-side.
//
// Suppliers are the JIT-fulfilment warehouses a Daily Deal is drop-shipped
// from: on sale a Zoho Purchase Order is cut against the supplier and The
// Courier Guy collects from this warehouse address. Soft-delete only —
// Supplier.active flips to false (no hard delete).

import { useState, FormEvent } from 'react';
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

export interface Supplier {
  id: string;
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  vatNumber: string | null;
  regNumber: string | null;
  warehouseStreet: string;
  warehouseSuburb: string;
  warehouseCity: string;
  warehouseProvince: string;
  warehousePostalCode: string;
  notes: string | null;
  active: boolean;
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

export default function SuppliersTable({
  initialSuppliers,
  onChanged,
}: {
  initialSuppliers: Supplier[];
  onChanged: () => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);

  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setCreateOpen(true)}
          className="px-3 py-1.5 rounded text-sm font-medium"
          style={{ background: 'var(--red)', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          + Add supplier
        </button>
      </div>

      {initialSuppliers.length === 0 ? (
        <div
          className="rounded-[8px] p-6 text-center"
          style={{ background: 'var(--bg-card)', border: '0.5px dashed var(--border)' }}
        >
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            No suppliers yet. Click &quot;Add supplier&quot; to register the first warehouse a Daily Deal can be fulfilled from.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {initialSuppliers.map((s) => (
            <div
              key={s.id}
              className="rounded-[8px] p-4"
              style={{
                background: 'var(--bg-card)',
                border: `0.5px solid ${s.active ? 'var(--border)' : 'var(--text-tertiary)'}`,
                opacity: s.active ? 1 : 0.65,
              }}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                    {s.name}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    {s.contactPerson}
                  </p>
                </div>
                {!s.active && (
                  // Fill and ink are a PAIR here, and deliberately not the same
                  // token. --text-tertiary is documented at exactly 4.5:1 on
                  // white, so once this chip got its intended tint back (the
                  // fill used to be a broken var()+alpha concatenation, i.e.
                  // transparent) the label dropped to 4.24:1 — the tint ate the
                  // entire contrast margin. The ink steps down to
                  // --text-secondary, which clears it at 8.6:1.
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{ background: 'color-mix(in srgb, var(--text-tertiary) 9%, transparent)', color: 'var(--text-secondary)' }}
                  >
                    INACTIVE
                  </span>
                )}
              </div>
              <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                {s.warehouseStreet}
                <br />
                {s.warehouseSuburb}, {s.warehouseCity}, {s.warehouseProvince.replace(/_/g, ' ')} · {s.warehousePostalCode}
              </p>
              <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
                {s.phone}
                {s.phone && s.email && <span> · </span>}
                {s.email}
                {(s.vatNumber || s.regNumber) && (
                  <>
                    <br />
                    {s.vatNumber && <span>VAT {s.vatNumber}</span>}
                    {s.vatNumber && s.regNumber && <span> · </span>}
                    {s.regNumber && <span>Reg {s.regNumber}</span>}
                  </>
                )}
              </p>
              <div className="flex justify-end items-center">
                <button
                  onClick={() => setEditing(s)}
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
        <SupplierFormModal
          mode="create"
          onClose={() => setCreateOpen(false)}
          onDone={() => {
            setCreateOpen(false);
            onChanged();
          }}
        />
      )}
      {editing && (
        <SupplierFormModal
          mode="edit"
          supplier={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </>
  );
}

function SupplierFormModal({
  mode,
  supplier,
  onClose,
  onDone,
}: {
  mode: 'create' | 'edit';
  supplier?: Supplier;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    name: supplier?.name ?? '',
    contactPerson: supplier?.contactPerson ?? '',
    email: supplier?.email ?? '',
    phone: supplier?.phone ?? '',
    vatNumber: supplier?.vatNumber ?? '',
    regNumber: supplier?.regNumber ?? '',
    warehouseStreet: supplier?.warehouseStreet ?? '',
    warehouseSuburb: supplier?.warehouseSuburb ?? '',
    warehouseCity: supplier?.warehouseCity ?? '',
    warehouseProvince: supplier?.warehouseProvince ?? 'GAUTENG',
    warehousePostalCode: supplier?.warehousePostalCode ?? '',
    notes: supplier?.notes ?? '',
    active: supplier?.active ?? true,
  });
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
        contactPerson: form.contactPerson.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        vatNumber: form.vatNumber.trim() || null,
        regNumber: form.regNumber.trim() || null,
        warehouseStreet: form.warehouseStreet.trim(),
        warehouseSuburb: form.warehouseSuburb.trim(),
        warehouseCity: form.warehouseCity.trim(),
        warehouseProvince: form.warehouseProvince,
        warehousePostalCode: form.warehousePostalCode.trim(),
        notes: form.notes.trim() || null,
      };
      if (mode === 'edit') {
        body.active = form.active;
      }

      const url = mode === 'create' ? `/admin/suppliers` : `/admin/suppliers/${supplier!.id}`;
      const res = await adminFetch(url, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string | string[] };
        throw new Error(
          Array.isArray(data.message) ? data.message.join(', ') : data.message ?? `Error ${res.status}`,
        );
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
        <p className="text-base mb-4" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
          {mode === 'create' ? 'Add supplier' : `Edit ${supplier?.name}`}
        </p>

        <div className="grid grid-cols-1 gap-3">
          <SectionLabel>Company</SectionLabel>
          <Field label="Supplier name">
            <input required value={form.name} onChange={(e) => set('name', e.target.value)} style={inputStyle} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact person">
              <input
                required
                value={form.contactPerson}
                onChange={(e) => set('contactPerson', e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="Phone">
              <input
                required
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                style={inputStyle}
                placeholder="+27..."
              />
            </Field>
          </div>
          <Field label="Email (Zoho purchase orders are sent here)">
            <input
              required
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="VAT number (optional)">
              <input value={form.vatNumber} onChange={(e) => set('vatNumber', e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Reg number (optional)">
              <input value={form.regNumber} onChange={(e) => set('regNumber', e.target.value)} style={inputStyle} />
            </Field>
          </div>

          <SectionLabel>Warehouse (courier collection address)</SectionLabel>
          <Field label="Street address">
            <input
              required
              value={form.warehouseStreet}
              onChange={(e) => set('warehouseStreet', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Suburb">
              <input
                required
                value={form.warehouseSuburb}
                onChange={(e) => set('warehouseSuburb', e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="City">
              <input
                required
                value={form.warehouseCity}
                onChange={(e) => set('warehouseCity', e.target.value)}
                style={inputStyle}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Province">
              <select
                value={form.warehouseProvince}
                onChange={(e) => set('warehouseProvince', e.target.value)}
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
                value={form.warehousePostalCode}
                onChange={(e) => set('warehousePostalCode', e.target.value)}
                style={inputStyle}
                pattern="\d{4}"
              />
            </Field>
          </div>

          <SectionLabel>Notes</SectionLabel>
          <Field label="Internal notes (optional)">
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={2}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </Field>

          {mode === 'edit' && (
            <label className="flex items-center gap-2 text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => set('active', e.target.checked)}
                style={{ accentColor: 'var(--red)' }}
              />
              <span>Active (uncheck to deactivate — this supplier won&apos;t be selectable on new deals)</span>
            </label>
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
              disabled={busy}
              className="flex-1 py-2 rounded text-sm font-medium"
              style={{
                background: busy ? 'var(--bg-inset)' : 'var(--red)',
                color: busy ? 'var(--text-tertiary)' : '#fff',
                border: 'none',
                cursor: busy ? 'not-allowed' : 'pointer',
              }}
            >
              {busy ? 'Saving…' : mode === 'create' ? 'Create supplier' : 'Save changes'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs uppercase tracking-wider mt-2" style={{ color: 'var(--text-tertiary)', fontWeight: 600 }}>
      {children}
    </p>
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
