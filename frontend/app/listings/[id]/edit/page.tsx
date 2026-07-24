'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { Listing, CategoryAttributeDef } from '@/lib/types';
import { CONDITION_LABELS, PROVINCE_LABELS } from '@/lib/utils';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-primary)',
  borderRadius: '6px',
  padding: '8px 12px',
  fontSize: '14px',
  outline: 'none',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm mb-1.5" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

export default function EditListingPage() {
  const { id } = useParams<{ id: string }>();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const router = useRouter();

  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newImages, setNewImages] = useState<File[]>([]);
  // Lock state — fetched in parallel with the listing. When canEdit
  // is false, render the friendly "listing locked" card below
  // instead of the form. Backend GET /listings/:id/edit-lock
  // returns the unified shape covering AUCTION-bid + TAKE_A_SHOT
  // -offer locks.
  const [editLock, setEditLock] = useState<{
    canEdit: boolean;
    reason: string | null;
    code: string | null;
  } | null>(null);

  const [form, setForm] = useState({
    title: '',
    description: '',
    price: '',
    // UX-7 — optional compare-at / "was" price (Rands; BUY_NOW only).
    compareAtPriceZarCents: '',
    condition: 'GOOD',
    province: 'GAUTENG',
    make: '',
    model: '',
    calibre: '',
    // Phase M dealer-lock — mandatory firearm-only planned dealer-stock
    // (dealer name + province + area).
    plannedDealerName: '',
    plannedDealerProvince: '',
    plannedDealerArea: '',
    // Auction-specific
    reservePrice: '',
    buyNowPrice: '',
    // Take-a-Shot-specific
    autoAcceptThreshold: '',
    autoDeclineThreshold: '',
    // Swop-specific
    declaredValue: '',
  });
  // Existing images that have been queued for delete. We hide them
  // from the visible thumbnail strip but only call DELETE on save —
  // gives the user a chance to back out before clicking Save.
  const [removedImageIds, setRemovedImageIds] = useState<Set<string>>(new Set());

  // Per-category attributes (P4.2). The edit page keeps the listing's
  // category fixed (there's no category picker), so we fetch the defs once
  // for listing.category.id and pre-fill the values from listing.attributes.
  // Values held as string (NUMBER/SELECT/TEXT) or boolean (BOOLEAN).
  const [attrDefs, setAttrDefs] = useState<CategoryAttributeDef[]>([]);
  const [attrValues, setAttrValues] = useState<
    Record<string, string | boolean>
  >({});

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) { router.push('/sign-in'); return; }

    async function load() {
      try {
        const token = await getToken();
        // Fire both requests in parallel — listing detail (auth'd)
        // and the public edit-lock probe.
        const [res, lockRes] = await Promise.all([
          fetch(`${API_URL}/listings/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API_URL}/listings/${id}/edit-lock`, { cache: 'no-store' }),
        ]);
        if (!res.ok) { router.push('/my/listings'); return; }
        const l: Listing = await res.json();
        setListing(l);
        // Fetch the per-category attribute defs and pre-fill from the
        // listing's existing attributes (P4.2). Category is fixed on edit,
        // so this runs once. Non-fatal on failure — the rest of the form
        // still works.
        try {
          const attrRes = await fetch(
            `${API_URL}/categories/${l.category.id}/attributes`,
            { cache: 'no-store' },
          );
          if (attrRes.ok) {
            const defsRaw: unknown = await attrRes.json();
            if (Array.isArray(defsRaw)) {
              const defs = (defsRaw as CategoryAttributeDef[]).filter(
                (d) => d.isActive,
              );
              setAttrDefs(defs);
              const existing = l.attributes ?? {};
              const prefilled: Record<string, string | boolean> = {};
              for (const def of defs) {
                const raw = existing[def.key];
                if (def.type === 'BOOLEAN') {
                  prefilled[def.key] = raw === true;
                } else if (raw !== undefined && raw !== null) {
                  prefilled[def.key] = String(raw);
                }
              }
              setAttrValues(prefilled);
            }
          }
        } catch {
          // Non-fatal — skip the specifications section.
        }
        if (lockRes.ok) {
          setEditLock(
            (await lockRes.json()) as {
              canEdit: boolean;
              reason: string | null;
              code: string | null;
            },
          );
        }
        setForm({
          title: l.title,
          description: l.description,
          price: l.price ? String(l.price / 100) : '',
          compareAtPriceZarCents: l.compareAtPriceZarCents
            ? String(l.compareAtPriceZarCents / 100)
            : '',
          condition: l.condition,
          province: l.province,
          make: l.make ?? '',
          model: l.model ?? '',
          calibre: l.calibre ?? '',
          plannedDealerName: l.plannedDealerName ?? '',
          plannedDealerProvince: l.plannedDealerProvince ?? '',
          plannedDealerArea: l.plannedDealerArea ?? '',
          reservePrice: l.reservePrice ? String(l.reservePrice / 100) : '',
          buyNowPrice: l.buyNowPrice ? String(l.buyNowPrice / 100) : '',
          autoAcceptThreshold: l.autoAcceptThreshold
            ? String(l.autoAcceptThreshold / 100)
            : '',
          autoDeclineThreshold: l.autoDeclineThreshold
            ? String(l.autoDeclineThreshold / 100)
            : '',
          declaredValue: l.declaredValueCents
            ? String(l.declaredValueCents / 100)
            : '',
        });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id, isLoaded, isSignedIn, getToken, router]);

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    // Firearm planned dealer-stock guard — dealer name + province + area
    // are all mandatory. Abort with a clear message before the API 400.
    if (
      listing?.category.isFirearm &&
      (!form.plannedDealerName.trim() ||
        !form.plannedDealerProvince ||
        !form.plannedDealerArea.trim())
    ) {
      setError(
        'Firearm listings need the planned dealer-stock location — a dealer name, province, and area.',
      );
      setSubmitting(false);
      return;
    }
    try {
      const token = await getToken();
      const body: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description.trim(),
        condition: form.condition,
        province: form.province,
      };
      // Price only exists on priced types — TAKE_A_SHOT and SWOP listings
      // are price-less (buyer names a price / declared value instead), so
      // never send `price` for them (the backend rejects it anyway).
      if (
        listing?.listingType === 'BUY_NOW' ||
        listing?.listingType === 'AUCTION'
      ) {
        body.price = Math.round(parseFloat(form.price) * 100);
      }
      // UX-7 — compare-at ("was") price, BUY_NOW only. Send the value when set,
      // or null to clear it (display-only; the backend re-validates).
      if (listing?.listingType === 'BUY_NOW') {
        body.compareAtPriceZarCents = form.compareAtPriceZarCents.trim()
          ? Math.round(parseFloat(form.compareAtPriceZarCents) * 100)
          : null;
      }
      if (form.make.trim()) body.make = form.make.trim();
      if (form.model.trim()) body.model = form.model.trim();
      if (form.calibre.trim()) body.calibre = form.calibre.trim();
      // Phase M dealer-lock — mandatory structured location for firearms
      // (dealer name + province + area). The backend composes + validates.
      if (listing?.category.isFirearm) {
        body.plannedDealerName = form.plannedDealerName.trim();
        body.plannedDealerProvince = form.plannedDealerProvince;
        body.plannedDealerArea = form.plannedDealerArea.trim();
      }
      // Auction + Take-a-Shot type-specific fields. We send them
      // regardless of listingType — backend ignores irrelevant ones.
      if (form.reservePrice.trim()) {
        body.reservePrice = Math.round(parseFloat(form.reservePrice) * 100);
      }
      if (form.buyNowPrice.trim()) {
        body.buyNowPrice = Math.round(parseFloat(form.buyNowPrice) * 100);
      }
      if (form.autoAcceptThreshold.trim()) {
        body.autoAcceptThreshold = Math.round(
          parseFloat(form.autoAcceptThreshold) * 100,
        );
      }
      if (form.autoDeclineThreshold.trim()) {
        body.autoDeclineThreshold = Math.round(
          parseFloat(form.autoDeclineThreshold) * 100,
        );
      }
      if (form.declaredValue.trim()) {
        body.declaredValueCents = Math.round(
          parseFloat(form.declaredValue) * 100,
        );
      }

      // Per-category attributes (P4.2) — coerce inputs to the payload shape
      // and gate on required attrs before sending. Only attach `attributes`
      // when the category actually has defs, so categories without any are
      // unaffected.
      if (attrDefs.length > 0) {
        const collected: Record<string, string | number | boolean> = {};
        const missing: string[] = [];
        for (const def of attrDefs) {
          const raw = attrValues[def.key];
          if (def.type === 'BOOLEAN') {
            const on = raw === true;
            collected[def.key] = on;
            if (def.required && !on) missing.push(def.label);
            continue;
          }
          const trimmed = typeof raw === 'string' ? raw.trim() : '';
          if (!trimmed) {
            if (def.required) missing.push(def.label);
            continue;
          }
          if (def.type === 'NUMBER') {
            const n = Number(trimmed);
            if (Number.isFinite(n)) collected[def.key] = n;
            else if (def.required) missing.push(def.label);
            continue;
          }
          collected[def.key] = trimmed;
        }
        if (missing.length > 0) {
          throw new Error(
            `Fill in the required specification${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`,
          );
        }
        body.attributes = collected;
      }

      const res = await fetch(`${API_URL}/listings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `Error ${res.status}`);
      }

      // Delete photos that the seller removed in this session.
      for (const imageId of removedImageIds) {
        await fetch(`${API_URL}/listings/${id}/images/${imageId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {
          // Best-effort — if a delete fails, the listing edit still
          // succeeds; the seller can retry the photo deletion from
          // the listing detail page.
        });
      }

      // Upload any new images
      for (const file of newImages) {
        const fd = new FormData();
        fd.append('image', file);
        await fetch(`${API_URL}/listings/${id}/images`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
      }

      router.push(`/listings/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  }

  if (!isLoaded || loading) {
    return (
      <main className="max-w-[640px] mx-auto px-4 py-8">
        <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--red)', borderTopColor: 'transparent' }} />
      </main>
    );
  }

  if (!listing) return null;

  // Marketplace-integrity gate: AUCTION listings with bids + TAKE_A_SHOT
  // listings with active offers can't be edited. Backend throws 409 on
  // any PATCH attempt — this client-side card just avoids letting the
  // seller fill out the whole form for nothing. editLock state is
  // fetched in the same useEffect that loads the listing (below).
  if (editLock && !editLock.canEdit) {
    const detail =
      editLock.code === 'listing-locked-by-bids'
        ? 'Bidders committed on the listing as it stands; changing the item now would be unfair to them. If the listing is genuinely wrong, head back to the listing page and cancel it (all bids will be refunded), then create a new one with the correct details.'
        : editLock.code === 'listing-locked-by-offer'
          ? "There's an offer in negotiation. Once you change the item, the offer would no longer be on what the buyer agreed to. Reject the offer (or wait for it to expire), then edit."
          : (editLock.reason ?? 'This listing is locked.');
    return (
      <main className="max-w-[640px] mx-auto px-4 py-12">
        <h1
          className="text-xl mb-3"
          style={{ color: 'var(--text-primary)', fontWeight: 500 }}
        >
          Listing locked
        </h1>
        <p
          className="text-sm mb-4"
          style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
        >
          {editLock.reason}
        </p>
        <p
          className="text-sm mb-6"
          style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
        >
          {detail}
        </p>
        <a
          href={`/listings/${listing.id}`}
          className="inline-block px-4 py-2 rounded-[6px] text-sm"
          style={{
            background: 'var(--red)',
            color: '#fff',
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          Back to listing
        </a>
      </main>
    );
  }

  const isFirearm = listing.category.isFirearm;

  return (
    <main className="max-w-[640px] mx-auto px-4 py-8">
      <h1 className="text-xl mb-2" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
        Edit listing
      </h1>

      {/* Re-audit callout — saving any change re-runs Claude
          moderation, which can push the listing back into
          PENDING_REVIEW briefly. Set expectations up front so a
          seller doesn't panic when their ACTIVE listing disappears
          from search for an hour. */}
      <div
        className="mb-5 px-3 py-2 rounded-[6px] text-xs flex items-center gap-2"
        style={{
          background: 'rgba(245,158,11,0.08)',
          border: '0.5px solid #f59e0b',
          color: 'var(--text-secondary)',
        }}
      >
        <span style={{ color: '#f59e0b' }}>⚠</span>
        <span>
          Saving any change re-runs automated moderation. Your listing
          may briefly return to <strong>Pending review</strong> while
          Claude re-checks it.
        </span>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-[6px] text-sm" style={{ background: 'rgba(200,16,46,0.08)', border: '0.5px solid var(--red)', color: 'var(--red)' }}>
          {error}
        </div>
      )}

      {/* Existing images — each removable with an X button. Removals
          are queued and committed on Save so the seller can undo
          (refresh the page) until they hit Save. */}
      {listing.images.length > 0 && (
        <div className="mb-5">
          <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
            Current photos · click × to remove
          </p>
          <div className="flex gap-2 flex-wrap">
            {listing.images
              .filter((img) => !removedImageIds.has(img.id))
              .map((img) => (
                <div key={img.id} style={{ position: 'relative' }}>
                  <img src={img.url} alt="" className="w-20 h-20 rounded-[4px] object-cover" />
                  <button
                    type="button"
                    onClick={() =>
                      setRemovedImageIds((s) => {
                        const next = new Set(s);
                        next.add(img.id);
                        return next;
                      })
                    }
                    aria-label="Remove this photo"
                    style={{
                      position: 'absolute',
                      top: -6,
                      right: -6,
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: 'var(--red)',
                      color: '#fff',
                      border: '0.5px solid var(--bg-page)',
                      fontSize: 12,
                      lineHeight: '18px',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
          </div>
          {removedImageIds.size > 0 && (
            <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
              {removedImageIds.size} photo{removedImageIds.size === 1 ? '' : 's'} marked for delete on save.{' '}
              <button
                type="button"
                onClick={() => setRemovedImageIds(new Set())}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--red)',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: 0,
                  font: 'inherit',
                }}
              >
                Undo
              </button>
            </p>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Title">
          <input type="text" required minLength={5} maxLength={200} value={form.title} onChange={(e) => set('title', e.target.value)} style={inputStyle} />
        </Field>

        <Field label="Description">
          <textarea required minLength={10} maxLength={5000} rows={5} value={form.description} onChange={(e) => set('description', e.target.value)} style={{ ...inputStyle, resize: 'vertical' }} />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          {/* Price only exists on priced types — TAKE_A_SHOT and SWOP are
              price-less; rendering a required input for them made the form
              unsaveable (native validation blocked Save on an empty field
              the listing legitimately doesn't have). */}
          {(listing.listingType === 'BUY_NOW' ||
            listing.listingType === 'AUCTION') && (
            <Field label="Price (R)">
              <input type="number" required min={1} step="0.01" value={form.price} onChange={(e) => set('price', e.target.value)} style={inputStyle} />
            </Field>
          )}
          <Field label="Condition">
            <select value={form.condition} onChange={(e) => set('condition', e.target.value)} style={inputStyle}>
              {Object.entries(CONDITION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Field>
        </div>

        {/* UX-7 — optional compare-at / "was" price (BUY_NOW only). Display
            only; accountable to the seller (CPA s41). Must exceed the price. */}
        {listing?.listingType === 'BUY_NOW' && (
          <Field label="Original / retail price (R) — optional">
            <input
              type="number"
              min={1}
              step="0.01"
              value={form.compareAtPriceZarCents}
              onChange={(e) => set('compareAtPriceZarCents', e.target.value)}
              style={inputStyle}
              placeholder="Shown as a strikethrough discount — must exceed your price"
            />
          </Field>
        )}

        <Field label="Province">
          <select value={form.province} onChange={(e) => set('province', e.target.value)} style={inputStyle}>
            {Object.entries(PROVINCE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>

        {isFirearm && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Make">
                <input type="text" value={form.make} onChange={(e) => set('make', e.target.value)} style={inputStyle} placeholder="e.g. Glock" />
              </Field>
              <Field label="Model">
                <input type="text" value={form.model} onChange={(e) => set('model', e.target.value)} style={inputStyle} placeholder="e.g. 17 Gen 5" />
              </Field>
            </div>
            <Field label="Calibre">
              <input type="text" value={form.calibre} onChange={(e) => set('calibre', e.target.value)} style={inputStyle} placeholder="e.g. 9mm" />
            </Field>
            <Field label="Planned dealer-stock location (required)">
              <div className="space-y-2">
                <input
                  type="text"
                  maxLength={120}
                  value={form.plannedDealerName}
                  onChange={(e) => set('plannedDealerName', e.target.value)}
                  style={inputStyle}
                  placeholder="Dealer name — e.g. Pretoria Arms"
                  aria-label="Dealer name"
                />
                <select
                  value={form.plannedDealerProvince}
                  onChange={(e) => set('plannedDealerProvince', e.target.value)}
                  style={inputStyle}
                  aria-label="Dealer province"
                >
                  <option value="">Select province…</option>
                  {[
                    'Eastern Cape',
                    'Free State',
                    'Gauteng',
                    'KwaZulu-Natal',
                    'Limpopo',
                    'Mpumalanga',
                    'North West',
                    'Northern Cape',
                    'Western Cape',
                  ].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  maxLength={120}
                  value={form.plannedDealerArea}
                  onChange={(e) => set('plannedDealerArea', e.target.value)}
                  style={inputStyle}
                  placeholder="Area / town — e.g. Centurion"
                  aria-label="Dealer area or town"
                />
              </div>
              <p
                className="text-xs mt-1"
                style={{ color: 'var(--text-tertiary)', lineHeight: 1.4 }}
              >
                Required for firearms — buyers use this to gauge their
                collection drive. You&apos;re not locked in; the actual
                dealer is captured later when you upload the stock-in proof.
              </p>
            </Field>
          </>
        )}

        {/* Auction-specific edit surface. Reserve + buyNow are
            editable while the auction has no bids; the backend
            rejects updates that would invalidate existing bids. */}
        {listing.listingType === 'AUCTION' && (
          <div
            className="rounded-[6px] p-3 space-y-3"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
          >
            <p className="text-xs uppercase" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>
              Auction options
            </p>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Reserve price (R)">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.reservePrice}
                  onChange={(e) => set('reservePrice', e.target.value)}
                  style={inputStyle}
                  placeholder="Optional"
                />
              </Field>
              <Field label="Buy Now price (R)">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.buyNowPrice}
                  onChange={(e) => set('buyNowPrice', e.target.value)}
                  style={inputStyle}
                  placeholder="Optional"
                />
              </Field>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Auction duration + listing type are locked once published. To
              change those, cancel and relist.
            </p>
          </div>
        )}

        {/* Take-a-Shot threshold — only honoured for TAKE_A_SHOT
            listings. Setting it auto-accepts any offer at-or-above. */}
        {listing.listingType === 'TAKE_A_SHOT' && (
          <Field label="Auto-accept offers at or above (R)">
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.autoAcceptThreshold}
              onChange={(e) => set('autoAcceptThreshold', e.target.value)}
              style={inputStyle}
              placeholder="Leave blank to review every offer manually"
            />
            {form.autoAcceptThreshold.trim() && (
              <p className="text-xs mt-1" style={{ color: '#f59e0b' }}>
                ⚠ Offers at or above R{form.autoAcceptThreshold} will be auto-accepted with no further review.
              </p>
            )}
          </Field>
        )}
        {listing.listingType === 'TAKE_A_SHOT' && (
          <Field label="Auto-decline offers at or below (R)">
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.autoDeclineThreshold}
              onChange={(e) => set('autoDeclineThreshold', e.target.value)}
              style={inputStyle}
              placeholder="Leave blank to see every offer"
            />
            {form.autoDeclineThreshold.trim() && (
              <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                Offers at or below R{form.autoDeclineThreshold} are declined instantly — you won&apos;t be notified.
              </p>
            )}
            {form.autoDeclineThreshold.trim() &&
              form.autoAcceptThreshold.trim() &&
              parseFloat(form.autoDeclineThreshold) >=
                parseFloat(form.autoAcceptThreshold) && (
                <p className="text-xs mt-1" style={{ color: 'var(--red)' }}>
                  Must be below the auto-accept threshold (R{form.autoAcceptThreshold}).
                </p>
              )}
          </Field>
        )}

        {/* Swop declared value — the honest-value anchor: sets the swap
            service fee (1.5%, min R50, cap R750), is shown to the
            counterparty in negotiation, and caps dispute compensation. */}
        {listing.listingType === 'SWOP' && (
          <Field label="Declared value (R)">
            <input
              type="number"
              min={1}
              step="0.01"
              value={form.declaredValue}
              onChange={(e) => set('declaredValue', e.target.value)}
              style={inputStyle}
              placeholder="What the item is honestly worth"
            />
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Shown to the other party while negotiating. Sets your swap
              service fee (1.5%, min R50, max R750) and caps what you can
              claim if the swap goes wrong — honest is best.
            </p>
          </Field>
        )}

        {/* Specifications (P4.2) — per-category attributes, pre-filled from
            the listing. Only shown when the category has attribute defs. */}
        {attrDefs.length > 0 && (
          <div
            className="rounded-[6px] p-3 space-y-3"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
          >
            <p className="text-xs uppercase" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>
              Specifications
            </p>
            {attrDefs.map((def) =>
              def.type === 'BOOLEAN' ? (
                <label
                  key={def.id}
                  className="flex items-center gap-2 cursor-pointer text-sm"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <input
                    type="checkbox"
                    checked={attrValues[def.key] === true}
                    onChange={(e) =>
                      setAttrValues((prev) => ({ ...prev, [def.key]: e.target.checked }))
                    }
                    style={{ accentColor: 'var(--red)' }}
                  />
                  <span>
                    {def.label}
                    {def.required && <span style={{ color: 'var(--red)', marginLeft: 4 }}>*</span>}
                  </span>
                </label>
              ) : (
                <Field
                  key={def.id}
                  label={`${def.label}${def.required ? ' *' : ''}${def.unit ? ` (${def.unit})` : ''}`}
                >
                  {def.type === 'SELECT' ? (
                    <select
                      value={typeof attrValues[def.key] === 'string' ? (attrValues[def.key] as string) : ''}
                      onChange={(e) =>
                        setAttrValues((prev) => ({ ...prev, [def.key]: e.target.value }))
                      }
                      style={inputStyle}
                    >
                      <option value="">Select…</option>
                      {def.options.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      inputMode={def.type === 'NUMBER' ? 'decimal' : undefined}
                      maxLength={def.type === 'TEXT' ? 200 : undefined}
                      value={typeof attrValues[def.key] === 'string' ? (attrValues[def.key] as string) : ''}
                      onChange={(e) => {
                        const v =
                          def.type === 'NUMBER'
                            ? e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
                            : e.target.value;
                        setAttrValues((prev) => ({ ...prev, [def.key]: v }));
                      }}
                      style={inputStyle}
                    />
                  )}
                </Field>
              ),
            )}
          </div>
        )}

        <Field label="Add more photos (optional)">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(e) => setNewImages(Array.from(e.target.files ?? []))}
            style={{ ...inputStyle, padding: '6px 12px', cursor: 'pointer' }}
          />
          {newImages.length > 0 && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              {newImages.length} new file{newImages.length !== 1 ? 's' : ''} to upload
            </p>
          )}
        </Field>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 py-3 rounded-[6px] text-sm font-medium"
            style={{ background: submitting ? 'var(--bg-inset)' : 'var(--red)', color: submitting ? 'var(--text-tertiary)' : '#fff' }}
          >
            {submitting ? 'Saving…' : 'Save changes'}
          </button>
          <a
            href={`/listings/${id}`}
            className="px-4 py-3 rounded-[6px] text-sm"
            style={{ border: '0.5px solid var(--border)', color: 'var(--text-secondary)', textDecoration: 'none' }}
          >
            Cancel
          </a>
        </div>
      </form>
    </main>
  );
}
