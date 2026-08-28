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

// Pull a human reason out of a failed photo request. Nest sends
// { message: string | string[] } on 4xx/5xx, but a 413 is usually killed by
// the reverse proxy and comes back as HTML — so we special-case the size
// limit and otherwise fall back to the bare status, which at least gives the
// seller something concrete to quote at support.
async function failureReason(res: Response): Promise<string> {
  if (res.status === 413) return 'the file is too big (8 MB is the limit)';
  const body: unknown = await res.json().catch(() => null);
  const msg = (body as { message?: string | string[] } | null)?.message;
  if (Array.isArray(msg) && msg.length > 0) return msg.join(', ');
  if (typeof msg === 'string' && msg.trim()) {
    // Nest's ParseFilePipe reports the two validators on POST /listings/:id
    // /images as a regex dump ("expected type is image/(jpeg|png|webp)") —
    // meaningless to a seller, so translate them.
    if (msg.startsWith('Validation failed')) {
      return msg.includes('expected size')
        ? 'the file is too big (8 MB is the limit)'
        : "that file type isn't supported — use JPEG, PNG or WebP";
    }
    return msg;
  }
  return `error ${res.status}`;
}

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
  // Per-photo failure surfaces. Photo work runs AFTER the listing PATCH has
  // already committed, so a failure here can't be reported as "save failed" —
  // that would send the seller back to re-edit text that is safely stored.
  // Instead we name the photo that broke, keep only the outstanding work
  // queued, and stay on the form so Save retries exactly what's left.
  // Non-empty only ever after a submit whose PATCH succeeded (both are
  // cleared at the top of handleSubmit), which is what lets the banner below
  // state "your listing details were saved" with confidence.
  const [uploadFailures, setUploadFailures] = useState<
    { name: string; reason: string }[]
  >([]);
  const [deleteFailures, setDeleteFailures] = useState<
    { label: string; reason: string }[]
  >([]);
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
    // Clear last attempt's photo failures up front — the partial-save banner
    // reads them to decide whether the PATCH already landed, so stale entries
    // would claim a save that hasn't happened yet.
    setUploadFailures([]);
    setDeleteFailures([]);
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

      // Photo work runs once the listing itself is saved. Both loops used to
      // swallow their failures — deletes behind a bare .catch(), uploads with
      // no res.ok check at all — and we redirected regardless. A 413/415 or a
      // moderation reject therefore dropped the seller on a listing missing
      // the photos they'd just added, with no error and nothing to retry.

      // Delete photos that the seller removed in this session.
      const nextDeleteFailures: { label: string; reason: string }[] = [];
      const deletedIds: string[] = [];
      for (const imageId of removedImageIds) {
        // Number the photo the way the seller sees it in the strip above, so
        // "Photo 2" points at something they can actually identify (we only
        // hold ids here, never file names, for photos already on the listing).
        const position = listing
          ? listing.images.findIndex((im) => im.id === imageId) + 1
          : 0;
        const label = position > 0 ? `Photo ${position}` : 'A photo';
        try {
          // Fresh token per request — deleting several photos over a slow
          // mobile connection can outlive the token minted before the PATCH.
          const delToken = await getToken();
          const del = await fetch(
            `${API_URL}/listings/${id}/images/${imageId}`,
            {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${delToken}` },
            },
          );
          // 204 on success, no body. A 404 means the row is already gone —
          // count that as done, otherwise the seller gets a failure they can
          // never clear no matter how many times they press Save.
          if (del.ok || del.status === 404) {
            deletedIds.push(imageId);
          } else {
            nextDeleteFailures.push({
              label,
              reason: await failureReason(del),
            });
          }
        } catch {
          nextDeleteFailures.push({ label, reason: 'the connection dropped' });
        }
      }
      // Drop the ones that really went, so the thumbnail strip is honest and
      // a second Save doesn't re-DELETE them (a 404 would read as a fresh
      // failure). Only the failures stay queued for that retry.
      if (deletedIds.length > 0) {
        setListing((prev) =>
          prev
            ? {
                ...prev,
                images: prev.images.filter((im) => !deletedIds.includes(im.id)),
              }
            : prev,
        );
        setRemovedImageIds((prev) => {
          const next = new Set(prev);
          for (const done of deletedIds) next.delete(done);
          return next;
        });
      }
      setDeleteFailures(nextDeleteFailures);

      // Upload any new images. Unlike the create flow (which halts on the
      // first failure because it has to roll the whole listing back), we try
      // every file: these uploads are independent, so one rejected HEIC
      // shouldn't force the seller to re-pick the photos that were fine.
      const nextUploadFailures: { name: string; reason: string }[] = [];
      const stillQueued: File[] = [];
      for (const file of newImages) {
        const fd = new FormData();
        fd.append('image', file);
        try {
          const upToken = await getToken();
          const up = await fetch(`${API_URL}/listings/${id}/images`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${upToken}` },
            body: fd,
          });
          if (!up.ok) {
            nextUploadFailures.push({
              name: file.name,
              reason: await failureReason(up),
            });
            stillQueued.push(file);
          }
        } catch {
          nextUploadFailures.push({
            name: file.name,
            reason: 'the connection dropped',
          });
          stillQueued.push(file);
        }
      }
      // Keep only the files that didn't land staged, so pressing Save again
      // retries exactly those and can't upload the successful ones twice.
      setNewImages(stillQueued);
      setUploadFailures(nextUploadFailures);

      if (nextUploadFailures.length > 0 || nextDeleteFailures.length > 0) {
        // Never redirect on photo trouble — the listing page would show the
        // saved text and none of the photo changes, which reads as success.
        setSubmitting(false);
        return;
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

  // Summary line for the partial-save banner. Built from the two failure
  // lists so it always matches the detail blocks further down the form.
  const photoTrouble: string[] = [];
  if (uploadFailures.length > 0) {
    photoTrouble.push(
      `${uploadFailures.length} photo${uploadFailures.length === 1 ? " didn't" : "s didn't"} upload`,
    );
  }
  if (deleteFailures.length > 0) {
    photoTrouble.push(
      `${deleteFailures.length} photo${deleteFailures.length === 1 ? " couldn't" : "s couldn't"} be removed`,
    );
  }

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

      {/* Partial-save banner. The listing PATCH commits before any photo
          work, so when a photo fails the text changes ARE saved — a red
          "save failed" would be a lie and would push the seller into
          re-editing details that are safely stored. Amber, and it explains
          why they weren't redirected to their listing. */}
      {photoTrouble.length > 0 && (
        <div
          role="status"
          className="mb-4 px-4 py-3 rounded-[6px] text-sm"
          style={{
            background: 'rgba(245,158,11,0.08)',
            border: '0.5px solid #f59e0b',
            color: 'var(--text-secondary)',
            lineHeight: 1.55,
          }}
        >
          <strong style={{ color: 'var(--text-primary)' }}>
            Your listing details were saved
          </strong>{' '}
          — but {photoTrouble.join(' and ')}. See the notes below, then press{' '}
          <strong>Save changes</strong> again to retry just those.
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
                      border: '0.5px solid var(--bg)',
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
                onClick={() => {
                  // Un-queueing everything also retires last attempt's delete
                  // failures — nothing is marked for delete any more, so the
                  // "still marked for delete" note would be stale.
                  setRemovedImageIds(new Set());
                  setDeleteFailures([]);
                }}
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

          {/* Per-photo delete failures. These stay queued (they're still in
              removedImageIds), so the seller's next Save retries them —
              silently dropping them used to leave the photo live on a
              listing the seller believed they had cleaned up. */}
          {deleteFailures.length > 0 && (
            <div
              className="mt-2 px-3 py-2 rounded-[6px] text-xs"
              style={{
                background: 'rgba(200,16,46,0.08)',
                border: '0.5px solid var(--red)',
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
              }}
            >
              <p style={{ color: 'var(--red)' }}>
                Still on the listing — the delete didn&apos;t go through:
              </p>
              <ul className="mt-1" style={{ listStyle: 'disc', paddingLeft: 16 }}>
                {deleteFailures.map((f) => (
                  <li key={f.label}>
                    {f.label} — {f.reason}
                  </li>
                ))}
              </ul>
              <p className="mt-1">
                They&apos;re still marked for delete. Save again to retry, or
                Undo above to keep them.
              </p>
            </div>
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

        {/* (The optional compare-at / "was" price input stood here — removed
            2026-08-28 with the one on the sell form. It was a CPA s41 claim
            the seller carried for a strikethrough almost nobody set. The value
            is still LOADED and still SAVED, so a listing that already has one
            keeps it; only the way to set a new one is gone. Its whole
            `listingType === 'BUY_NOW'` wrapper went too — a conditional whose
            body is just a comment is `{}`, which is not a ReactNode.) */}

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
            onChange={(e) => {
              // Picking again replaces the queue, so last attempt's per-file
              // errors no longer describe what's staged — drop them.
              setNewImages(Array.from(e.target.files ?? []));
              setUploadFailures([]);
            }}
            style={{ ...inputStyle, padding: '6px 12px', cursor: 'pointer' }}
          />
          {newImages.length > 0 && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              {newImages.length} new file{newImages.length !== 1 ? 's' : ''} to upload
            </p>
          )}

          {/* Per-file upload failures. The files that failed are still staged
              in newImages (the ones that landed were dropped), so the seller
              can fix the offending photo or just press Save to retry —
              nothing gets uploaded twice. */}
          {uploadFailures.length > 0 && (
            <div
              className="mt-2 px-3 py-2 rounded-[6px] text-xs"
              style={{
                background: 'rgba(200,16,46,0.08)',
                border: '0.5px solid var(--red)',
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
              }}
            >
              <p style={{ color: 'var(--red)' }}>
                These photos weren&apos;t added:
              </p>
              <ul className="mt-1" style={{ listStyle: 'disc', paddingLeft: 16 }}>
                {uploadFailures.map((f, i) => (
                  <li key={`${f.name}-${i}`}>
                    {f.name} — {f.reason}
                  </li>
                ))}
              </ul>
              <p className="mt-1">
                They&apos;re still queued. Save again to retry, or pick
                different files (JPEG, PNG or WebP, up to 8 MB each).
              </p>
            </div>
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
