'use client';

// Daily Deals cockpit table (DD-1). Status-tab pipeline + deal builder +
// lifecycle actions + photo management. Mirrors the dealers-table.tsx
// pattern (client component, adminFetch, modal forms, router-free reload
// via an onChanged callback the page re-fetches on). INERT: lifecycle
// actions are pure status bookkeeping — no money path, no public surface.

import { useState, FormEvent, useRef } from 'react';
import { adminFetch } from '@/lib/admin-auth';
import { AdminStatusChip } from '@/components/admin/status-chip';

// ── Types (mirror the DealsService.shape() payload) ────────────────────
export interface DealImage {
  id: string;
  url: string;
  order: number;
  isPrimary: boolean;
}
export interface Deal {
  id: string;
  status: string;
  listingId: string;
  referenceNumber: string | null;
  title: string;
  description: string;
  categoryId: string;
  condition: string;
  province: string;
  make: string | null;
  model: string | null;
  calibre: string | null;
  shippingMethods: string[];
  weightGrams?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  listingStatus: string;
  images: DealImage[];
  dealPriceCents: number;
  wasPriceCents: number;
  costPriceCents: number;
  marginPct: number;
  savePct: number;
  initialStock: number;
  quantityAvailable: number;
  soldUnits: number;
  revenueCents: number;
  sellThroughPct: number;
  perCustomerCap: number;
  shipsInDaysMin: number;
  shipsInDaysMax: number;
  heroRank: number;
  // Legacy free-text supplier fields (kept for display / back-compat); the
  // builder now assigns a structured Supplier via supplierId instead.
  supplierName: string | null;
  supplierRef: string | null;
  supplierId: string | null;
  supplier?: { name: string } | null;
  // JIT-fulfilment purchase order (DD-F). Present once a PO has been cut for
  // the units sold; admin-only surface (never on publicShape).
  purchaseOrder?: {
    status: string;
    unitsOrdered: number;
    emailedAt: string | null;
    stockReadyAt: string | null;
  } | null;
  startsAt: string | null;
  endsAt: string | null;
  extendedUntil: string | null;
  dropDate: string | null;
}
export interface CategoryOption {
  id: string;
  name: string;
  licensed: boolean;
}
export interface SupplierOption {
  id: string;
  name: string;
  active: boolean;
}

const CONDITIONS = ['NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR'];
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
// Daily Deals are drop-shipped from a supplier warehouse and collected by The
// Courier Guy only — no Pudo, no in-person collection. Shipping is forced to
// TCG in the builder (and enforced server-side).

const TABS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'ALL', label: 'All', statuses: [] },
  { key: 'DRAFT', label: 'Draft', statuses: ['DRAFT'] },
  { key: 'SCHEDULED', label: 'Scheduled', statuses: ['SCHEDULED'] },
  { key: 'LIVE', label: 'Live', statuses: ['LIVE'] },
  { key: 'EXTENDED', label: 'Extra Time', statuses: ['EXTENDED'] },
  { key: 'ENDED', label: 'Ended', statuses: ['ENDED'] },
  { key: 'SOLD_OUT', label: 'Sold out', statuses: ['SOLD_OUT'] },
  { key: 'CANCELLED', label: 'Cancelled', statuses: ['CANCELLED'] },
];

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

const rands = (cents: number) =>
  'R' + (cents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function DealsTable({
  initialDeals,
  categories,
  suppliers,
  onChanged,
}: {
  initialDeals: Deal[];
  categories: CategoryOption[];
  suppliers: SupplierOption[];
  onChanged: () => void;
}) {
  const [tab, setTab] = useState('ALL');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Deal | null>(null);
  const [photosFor, setPhotosFor] = useState<Deal | null>(null);
  const [scheduling, setScheduling] = useState<Deal | null>(null);
  const [extending, setExtending] = useState<Deal | null>(null);

  const activeTab = TABS.find((t) => t.key === tab) ?? TABS[0];
  const visible =
    activeTab.statuses.length === 0
      ? initialDeals
      : initialDeals.filter((d) => activeTab.statuses.includes(d.status));

  function countFor(t: (typeof TABS)[number]) {
    return t.statuses.length === 0
      ? initialDeals.length
      : initialDeals.filter((d) => t.statuses.includes(d.status)).length;
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="px-2.5 py-1 rounded text-xs"
              style={{
                background: tab === t.key ? 'var(--bg-inset)' : 'transparent',
                border: `0.5px solid ${tab === t.key ? 'var(--border)' : 'transparent'}`,
                color: tab === t.key ? 'var(--text-primary)' : 'var(--text-tertiary)',
                cursor: 'pointer',
                fontWeight: tab === t.key ? 500 : 400,
              }}
            >
              {t.label} ({countFor(t)})
            </button>
          ))}
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="px-3 py-1.5 rounded text-sm font-medium"
          style={{ background: 'var(--red)', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          + New deal
        </button>
      </div>

      {visible.length === 0 ? (
        <div
          className="rounded-[8px] p-6 text-center"
          style={{ background: 'var(--bg-card)', border: '0.5px dashed var(--border)' }}
        >
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            No deals here yet. Click &quot;New deal&quot; to build the first one.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {visible.map((d) => (
            <DealRow
              key={d.id}
              deal={d}
              onEdit={() => setEditing(d)}
              onPhotos={() => setPhotosFor(d)}
              onSchedule={() => setScheduling(d)}
              onExtend={() => setExtending(d)}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}

      {createOpen && (
        <DealFormModal
          mode="create"
          categories={categories}
          suppliers={suppliers}
          onClose={() => setCreateOpen(false)}
          onDone={() => {
            setCreateOpen(false);
            onChanged();
          }}
        />
      )}
      {editing && (
        <DealFormModal
          mode="edit"
          deal={editing}
          categories={categories}
          suppliers={suppliers}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
      {photosFor && (
        <PhotosModal
          deal={photosFor}
          onClose={() => setPhotosFor(null)}
          onDone={() => {
            setPhotosFor(null);
            onChanged();
          }}
        />
      )}
      {scheduling && (
        <ScheduleModal
          deal={scheduling}
          onClose={() => setScheduling(null)}
          onDone={() => {
            setScheduling(null);
            onChanged();
          }}
        />
      )}
      {extending && (
        <ExtendModal
          deal={extending}
          onClose={() => setExtending(null)}
          onDone={() => {
            setExtending(null);
            onChanged();
          }}
        />
      )}
    </>
  );
}

// ── One deal row (P&L line + actions) ──────────────────────────────────
function DealRow({
  deal,
  onEdit,
  onPhotos,
  onSchedule,
  onExtend,
  onChanged,
}: {
  deal: Deal;
  onEdit: () => void;
  onPhotos: () => void;
  onSchedule: () => void;
  onExtend: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function action(path: string, confirmMsg: string) {
    if (!window.confirm(confirmMsg)) return;
    setBusy(true);
    try {
      const res = await adminFetch(`/admin/deals/${deal.id}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        alert(data.message ?? `Error ${res.status}`);
      } else {
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!window.confirm('Delete this deal permanently? This removes the listing and its photos.')) return;
    setBusy(true);
    try {
      const res = await adminFetch(`/admin/deals/${deal.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        alert(data.message ?? `Error ${res.status}`);
      } else {
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  const primary = deal.images.find((i) => i.isPrimary) ?? deal.images[0];
  const editable = deal.status === 'DRAFT' || deal.status === 'SCHEDULED';

  return (
    <div
      className="rounded-[8px] p-4"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', opacity: busy ? 0.6 : 1 }}
    >
      <div className="flex items-start gap-3">
        <div
          className="shrink-0 rounded overflow-hidden"
          style={{ width: 56, height: 56, background: 'var(--bg-inset)', border: '0.5px solid var(--border)' }}
        >
          {primary ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={primary.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div className="flex items-center justify-center h-full text-xs" style={{ color: 'var(--text-tertiary)' }}>
              no photo
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                {deal.title}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
                {deal.referenceNumber ?? '—'}
                {deal.dropDate && ` · drop ${new Date(deal.dropDate).toLocaleDateString('en-ZA')}`}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <AdminStatusChip status={deal.status} />
              {deal.purchaseOrder && <PoChip status={deal.purchaseOrder.status} />}
            </div>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span>
              <span style={{ textDecoration: 'line-through', color: 'var(--text-tertiary)' }}>
                {rands(deal.wasPriceCents)}
              </span>{' '}
              → <strong style={{ color: 'var(--text-primary)' }}>{rands(deal.dealPriceCents)}</strong>
            </span>
            <span>cost {rands(deal.costPriceCents)}</span>
            <span style={{ color: deal.marginPct < 0 ? 'var(--red)' : 'var(--text-secondary)' }}>
              {deal.marginPct}% margin
            </span>
            <span>SAVE {deal.savePct}%</span>
            <span>
              {deal.soldUnits}/{deal.initialStock} sold
            </span>
          </div>

          {/* supplier + purchase-order fulfilment line (admin-only) */}
          {(deal.supplier?.name || deal.purchaseOrder) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {deal.supplier?.name && <span>supplier {deal.supplier.name}</span>}
              {deal.purchaseOrder && (
                <span>
                  PO {deal.purchaseOrder.unitsOrdered} unit{deal.purchaseOrder.unitsOrdered === 1 ? '' : 's'} ·{' '}
                  {deal.purchaseOrder.status}
                </span>
              )}
              {deal.purchaseOrder?.emailedAt && (
                <span>emailed {new Date(deal.purchaseOrder.emailedAt).toLocaleDateString('en-ZA')}</span>
              )}
              {deal.purchaseOrder?.stockReadyAt && (
                <span>stock ready {new Date(deal.purchaseOrder.stockReadyAt).toLocaleDateString('en-ZA')}</span>
              )}
            </div>
          )}

          {/* sell-through bar */}
          <div className="mt-2" style={{ height: 4, background: 'var(--bg-inset)', borderRadius: 2, overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.min(100, deal.sellThroughPct)}%`,
                height: '100%',
                background: 'var(--red)',
              }}
            />
          </div>

          {/* actions */}
          <div className="flex flex-wrap gap-1.5 mt-3">
            {editable && <ActionBtn label="Edit" onClick={onEdit} />}
            <ActionBtn label="Photos" onClick={onPhotos} />
            {deal.status === 'DRAFT' && <ActionBtn label="Schedule" onClick={onSchedule} />}
            {(deal.status === 'DRAFT' || deal.status === 'SCHEDULED') && (
              <ActionBtn label="Go live" onClick={() => action('go-live', 'Set this deal LIVE now?')} />
            )}
            {(deal.status === 'LIVE' || deal.status === 'ENDED') && (
              <ActionBtn label="Extra Time" onClick={onExtend} />
            )}
            {(deal.status === 'LIVE' || deal.status === 'EXTENDED') && (
              <ActionBtn label="End now" onClick={() => action('end', 'End this deal now?')} />
            )}
            {(deal.status === 'ENDED' || deal.status === 'SOLD_OUT') && !deal.purchaseOrder && (
              <ActionBtn
                label="Place PO"
                onClick={() =>
                  action(
                    'place-po',
                    'Cut a purchase order to the supplier for the units sold? Nothing is emailed until PO emailing is switched on.',
                  )
                }
              />
            )}
            {deal.purchaseOrder &&
              (deal.purchaseOrder.status === 'PLACED' || deal.purchaseOrder.status === 'EMAILED') &&
              !deal.purchaseOrder.stockReadyAt && (
                <ActionBtn
                  label="Stock ready"
                  onClick={() =>
                    action(
                      'stock-ready',
                      "Mark the supplier's stock ready and book The Courier Guy to collect for every paid order?",
                    )
                  }
                />
              )}
            <ActionBtn label="Duplicate" onClick={() => action('duplicate', 'Duplicate this deal into a new draft?')} />
            {deal.status !== 'CANCELLED' && (
              <ActionBtn label="Cancel" danger onClick={() => action('cancel', 'Cancel this deal?')} />
            )}
            {(deal.status === 'DRAFT' || deal.status === 'CANCELLED') && (
              <ActionBtn label="Delete" danger onClick={del} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionBtn({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="text-xs px-2 py-1 rounded"
      style={{
        background: 'transparent',
        border: '0.5px solid var(--border)',
        color: danger ? 'var(--red)' : 'var(--text-secondary)',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

// Purchase-order status pill, shown beside the deal status chip. Distinct
// colour ramp from the deal lifecycle so the two chips never read as one:
// DRAFT muted, PLACED blue, EMAILED green, CANCELLED red.
const PO_COLOR: Record<string, string> = {
  DRAFT: 'var(--text-tertiary)',
  PLACED: '#3b82f6',
  EMAILED: '#22c55e',
  CANCELLED: 'var(--red)',
};
function PoChip({ status }: { status: string }) {
  const c = PO_COLOR[status] ?? 'var(--text-tertiary)';
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full inline-block whitespace-nowrap"
      style={{ color: c, background: `${c}18` }}
    >
      PO {status.replace(/_/g, ' ')}
    </span>
  );
}

// ── Deal builder (create / edit) ───────────────────────────────────────
function DealFormModal({
  mode,
  deal,
  categories,
  suppliers,
  onClose,
  onDone,
}: {
  mode: 'create' | 'edit';
  deal?: Deal;
  categories: CategoryOption[];
  suppliers: SupplierOption[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    title: deal?.title ?? '',
    categoryId: deal?.categoryId ?? '',
    description: deal?.description ?? '',
    condition: deal?.condition ?? 'NEW',
    province: deal?.province ?? 'GAUTENG',
    make: deal?.make ?? '',
    model: deal?.model ?? '',
    calibre: deal?.calibre ?? '',
    dealPriceRand: deal ? String(deal.dealPriceCents / 100) : '',
    wasPriceRand: deal ? String(deal.wasPriceCents / 100) : '',
    costPriceRand: deal ? String(deal.costPriceCents / 100) : '',
    initialStock: deal ? String(deal.initialStock) : '1',
    perCustomerCap: deal ? String(deal.perCustomerCap) : '10',
    shipsInDaysMin: deal ? String(deal.shipsInDaysMin) : '3',
    shipsInDaysMax: deal ? String(deal.shipsInDaysMax) : '7',
    heroRank: deal ? String(deal.heroRank) : '0',
    supplierId: deal?.supplierId ?? '',
    dropDate: deal?.dropDate ? deal.dropDate.slice(0, 10) : '',
    weightGrams: deal ? String(deal.weightGrams ?? 1000) : '1000',
    lengthCm: deal ? String(deal.lengthCm ?? 20) : '20',
    widthCm: deal ? String(deal.widthCm ?? 20) : '20',
    heightCm: deal ? String(deal.heightCm ?? 15) : '15',
  });
  // Deals are TCG-only (drop-shipped from the supplier warehouse, collected by
  // The Courier Guy). Shipping is locked, not operator-editable, and enforced
  // server-side too.
  const shipping = ['TCG'];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const dealCents = Math.round(parseFloat(form.dealPriceRand || '0') * 100);
  const wasCents = Math.round(parseFloat(form.wasPriceRand || '0') * 100);
  const costCents = Math.round(parseFloat(form.costPriceRand || '0') * 100);
  const marginPct = dealCents > 0 ? Math.round(((dealCents - costCents) / dealCents) * 100) : 0;
  const savePct = wasCents > 0 ? Math.round(((wasCents - dealCents) / wasCents) * 100) : 0;
  const moneyOk = wasCents > dealCents && dealCents > 0 && costCents >= 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        title: form.title.trim(),
        categoryId: form.categoryId,
        description: form.description.trim(),
        condition: form.condition,
        province: form.province,
        make: form.make.trim() || undefined,
        model: form.model.trim() || undefined,
        calibre: form.calibre.trim() || undefined,
        shippingMethods: shipping,
        weightGrams: parseInt(form.weightGrams, 10) || 1000,
        lengthCm: parseInt(form.lengthCm, 10) || 20,
        widthCm: parseInt(form.widthCm, 10) || 20,
        heightCm: parseInt(form.heightCm, 10) || 15,
        dealPriceCents: dealCents,
        wasPriceCents: wasCents,
        costPriceCents: costCents,
        initialStock: parseInt(form.initialStock, 10) || 1,
        perCustomerCap: parseInt(form.perCustomerCap, 10) || 10,
        shipsInDaysMin: parseInt(form.shipsInDaysMin, 10),
        shipsInDaysMax: parseInt(form.shipsInDaysMax, 10),
        heroRank: parseInt(form.heroRank, 10) || 0,
        supplierId: form.supplierId || undefined,
        dropDate: form.dropDate ? new Date(form.dropDate).toISOString() : undefined,
      };
      const url = mode === 'create' ? '/admin/deals' : `/admin/deals/${deal!.id}`;
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
    <ModalShell onClose={() => !busy && onClose()} title={mode === 'create' ? 'New deal' : `Edit ${deal?.title}`}>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3">
        <SectionLabel>Product</SectionLabel>
        <Field label="Title">
          <input required value={form.title} onChange={(e) => set('title', e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Category (licensed / firearm categories are not selectable)">
          <select
            required
            value={form.categoryId}
            onChange={(e) => set('categoryId', e.target.value)}
            style={inputStyle}
          >
            <option value="" disabled>
              Select a category…
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id} disabled={c.licensed}>
                {c.name}
                {c.licensed ? ' — licensed (unavailable)' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Description">
          <textarea
            required
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Condition">
            <select value={form.condition} onChange={(e) => set('condition', e.target.value)} style={inputStyle}>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Warehouse province">
            <select value={form.province} onChange={(e) => set('province', e.target.value)} style={inputStyle}>
              {PROVINCES.map((p) => (
                <option key={p} value={p}>
                  {p.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Brand (opt)">
            <input value={form.make} onChange={(e) => set('make', e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Model (opt)">
            <input value={form.model} onChange={(e) => set('model', e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Calibre (opt)">
            <input value={form.calibre} onChange={(e) => set('calibre', e.target.value)} style={inputStyle} />
          </Field>
        </div>
        <Field label="Shipping method">
          <div className="flex flex-col gap-1.5 mt-1">
            <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked disabled style={{ accentColor: 'var(--red)' }} />
              <span>The Courier Guy door-to-door</span>
            </label>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Daily Deals ship via The Courier Guy only — collected from the supplier&apos;s warehouse.
            </p>
          </div>
        </Field>
        <Field label="Parcel size (for courier quotes)">
          <div className="grid grid-cols-4 gap-2">
            <input
              type="number"
              min="1"
              value={form.weightGrams}
              onChange={(e) => set('weightGrams', e.target.value)}
              style={inputStyle}
              placeholder="grams"
              aria-label="Weight (grams)"
            />
            <input
              type="number"
              min="1"
              value={form.lengthCm}
              onChange={(e) => set('lengthCm', e.target.value)}
              style={inputStyle}
              placeholder="L cm"
              aria-label="Length (cm)"
            />
            <input
              type="number"
              min="1"
              value={form.widthCm}
              onChange={(e) => set('widthCm', e.target.value)}
              style={inputStyle}
              placeholder="W cm"
              aria-label="Width (cm)"
            />
            <input
              type="number"
              min="1"
              value={form.heightCm}
              onChange={(e) => set('heightCm', e.target.value)}
              style={inputStyle}
              placeholder="H cm"
              aria-label="Height (cm)"
            />
          </div>
        </Field>

        <SectionLabel>Deal economics</SectionLabel>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Cost price (R)">
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.costPriceRand}
              onChange={(e) => set('costPriceRand', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Deal price (R)">
            <input
              type="number"
              step="0.01"
              min="0"
              required
              value={form.dealPriceRand}
              onChange={(e) => set('dealPriceRand', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Was price (R)">
            <input
              type="number"
              step="0.01"
              min="0"
              required
              value={form.wasPriceRand}
              onChange={(e) => set('wasPriceRand', e.target.value)}
              style={inputStyle}
            />
          </Field>
        </div>

        {/* live margin + save preview */}
        <div
          className="rounded p-2.5 text-xs flex flex-wrap gap-x-4 gap-y-1"
          style={{
            background: 'var(--bg-inset)',
            border: `0.5px solid ${moneyOk ? 'var(--border)' : 'var(--red)'}`,
            color: 'var(--text-secondary)',
          }}
        >
          {moneyOk ? (
            <>
              <span>
                Margin: <strong style={{ color: marginPct < 0 ? 'var(--red)' : 'var(--text-primary)' }}>{marginPct}%</strong>
              </span>
              <span>
                Shows: <strong style={{ color: 'var(--text-primary)' }}>SAVE {savePct}%</strong>
              </span>
              <span>Profit/unit: {rands(dealCents - costCents)}</span>
            </>
          ) : (
            <span style={{ color: 'var(--red)' }}>
              Was price must be higher than the deal price, and both above zero.
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Stock">
            <input
              type="number"
              min="1"
              value={form.initialStock}
              onChange={(e) => set('initialStock', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Per-customer cap">
            <input
              type="number"
              min="1"
              value={form.perCustomerCap}
              onChange={(e) => set('perCustomerCap', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Hero rank">
            <input
              type="number"
              value={form.heroRank}
              onChange={(e) => set('heroRank', e.target.value)}
              style={inputStyle}
            />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Ships in (min days)">
            <input
              type="number"
              min="0"
              value={form.shipsInDaysMin}
              onChange={(e) => set('shipsInDaysMin', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Ships in (max days)">
            <input
              type="number"
              min="0"
              value={form.shipsInDaysMax}
              onChange={(e) => set('shipsInDaysMax', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Drop date (opt)">
            <input type="date" value={form.dropDate} onChange={(e) => set('dropDate', e.target.value)} style={inputStyle} />
          </Field>
        </div>
        <SectionLabel>Supplier &amp; fulfilment</SectionLabel>
        <Field label="Supplier (drop-ship warehouse — a purchase order is cut here on sell-out)">
          <select value={form.supplierId} onChange={(e) => set('supplierId', e.target.value)} style={inputStyle}>
            <option value="">No supplier assigned</option>
            {suppliers.map((s) => (
              <option
                key={s.id}
                value={s.id}
                // Inactive suppliers stay pickable only if this deal is already
                // pointed at them (so an edit doesn't silently drop the link).
                disabled={!s.active && s.id !== deal?.supplierId}
              >
                {s.name}
                {!s.active ? ' — inactive' : ''}
              </option>
            ))}
          </select>
        </Field>
        {suppliers.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            No suppliers yet — add one under Marketplace → Suppliers to enable purchase-order fulfilment.
          </p>
        )}

        {error && (
          <p className="text-xs" style={{ color: 'var(--red)' }}>
            {error}
          </p>
        )}
        {mode === 'create' && (
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Add photos after creating the deal (they attach to the draft).
          </p>
        )}

        <div className="flex gap-2 mt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 py-2 rounded text-sm"
            style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)', border: '0.5px solid var(--border)', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !moneyOk || !form.categoryId}
            className="flex-1 py-2 rounded text-sm font-medium"
            style={{
              background: busy || !moneyOk || !form.categoryId ? 'var(--bg-inset)' : 'var(--red)',
              color: busy || !moneyOk || !form.categoryId ? 'var(--text-tertiary)' : '#fff',
              border: 'none',
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Saving…' : mode === 'create' ? 'Create deal' : 'Save changes'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ── Photos modal ───────────────────────────────────────────────────────
function PhotosModal({ deal, onClose, onDone }: { deal: Deal; onClose: () => void; onDone: () => void }) {
  const [images, setImages] = useState<DealImage[]>(deal.images);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await adminFetch(`/admin/deals/${deal.id}/images`, { method: 'POST', body: fd });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? `Error ${res.status}`);
      }
      const img = (await res.json()) as DealImage;
      setImages((prev) => [...prev, img]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function remove(imageId: string) {
    setBusy(true);
    try {
      const res = await adminFetch(`/admin/deals/${deal.id}/images/${imageId}`, { method: 'DELETE' });
      if (res.ok) setImages((prev) => prev.filter((i) => i.id !== imageId));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      onClose={() => {
        onDone();
      }}
      title={`Photos — ${deal.title}`}
    >
      <div className="grid grid-cols-3 gap-2 mb-3">
        {images.map((img) => (
          <div key={img.id} className="relative rounded overflow-hidden" style={{ border: '0.5px solid var(--border)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url} alt="" style={{ width: '100%', height: 90, objectFit: 'cover' }} />
            <button
              onClick={() => remove(img.id)}
              disabled={busy}
              className="absolute top-1 right-1 text-xs px-1.5 rounded"
              style={{ background: 'rgba(0,0,0,0.7)', color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              ✕
            </button>
            {img.isPrimary && (
              <span
                className="absolute bottom-1 left-1 text-[10px] px-1 rounded"
                style={{ background: 'var(--red)', color: '#fff' }}
              >
                primary
              </span>
            )}
          </div>
        ))}
      </div>
      {images.length < 10 && (
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
          className="text-sm"
          style={{ color: 'var(--text-secondary)' }}
        />
      )}
      {error && (
        <p className="text-xs mt-2" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}
      <div className="flex justify-end mt-4">
        <button
          onClick={onDone}
          className="px-4 py-2 rounded text-sm font-medium"
          style={{ background: 'var(--red)', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          Done
        </button>
      </div>
    </ModalShell>
  );
}

// ── Schedule + Extend modals ───────────────────────────────────────────
function ScheduleModal({ deal, onClose, onDone }: { deal: Deal; onClose: () => void; onDone: () => void }) {
  const [startsAt, setStartsAt] = useState(deal.startsAt ? deal.startsAt.slice(0, 16) : '');
  const [endsAt, setEndsAt] = useState(deal.endsAt ? deal.endsAt.slice(0, 16) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await adminFetch(`/admin/deals/${deal.id}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? `Error ${res.status}`);
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setBusy(false);
    }
  }

  return (
    <ModalShell onClose={() => !busy && onClose()} title={`Schedule — ${deal.title}`}>
      <form onSubmit={submit} className="grid grid-cols-1 gap-3">
        <Field label="Starts at">
          <input type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Ends at">
          <input type="datetime-local" required value={endsAt} onChange={(e) => setEndsAt(e.target.value)} style={inputStyle} />
        </Field>
        {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="flex-1 py-2 rounded text-sm" style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)', border: '0.5px solid var(--border)', cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className="flex-1 py-2 rounded text-sm font-medium" style={{ background: 'var(--red)', color: '#fff', border: 'none', cursor: 'pointer' }}>
            {busy ? 'Saving…' : 'Schedule'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ExtendModal({ deal, onClose, onDone }: { deal: Deal; onClose: () => void; onDone: () => void }) {
  const [until, setUntil] = useState(deal.extendedUntil ? deal.extendedUntil.slice(0, 16) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await adminFetch(`/admin/deals/${deal.id}/extend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extendedUntil: new Date(until).toISOString() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? `Error ${res.status}`);
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setBusy(false);
    }
  }

  return (
    <ModalShell onClose={() => !busy && onClose()} title={`Extra Time — ${deal.title}`}>
      <form onSubmit={submit} className="grid grid-cols-1 gap-3">
        <Field label="Extend until">
          <input type="datetime-local" required value={until} onChange={(e) => setUntil(e.target.value)} style={inputStyle} />
        </Field>
        {error && <p className="text-xs" style={{ color: 'var(--red)' }}>{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="flex-1 py-2 rounded text-sm" style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)', border: '0.5px solid var(--border)', cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className="flex-1 py-2 rounded text-sm font-medium" style={{ background: 'var(--red)', color: '#fff', border: 'none', cursor: 'pointer' }}>
            {busy ? 'Saving…' : 'Extend'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ── Shared modal shell + small bits ────────────────────────────────────
function ModalShell({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
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
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 620,
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
          {title}
        </p>
        {children}
      </div>
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
