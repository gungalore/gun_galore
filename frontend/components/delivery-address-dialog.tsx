'use client';

// ─── The delivery-address DRAWER ─────────────────────────────────────────
//
// Takealot parity (2026-11-26): a right-hand "Select Delivery Address" panel
// listing the member's saved addresses with Add / Edit / Delete and a Continue
// button. It is the same window the 2026-11-26 @ruanda regression introduced
// (`delivery-address-dialog.tsx` keeps its filename and imports), evolved from
// a centred dialog into a slide-over on desktop and a full-height bottom sheet
// on mobile, and given full address-book management.
//
// ⚠️ PRESENTATION + ADDRESS-BOOK WRITE ONLY. Choosing an address calls the
// host's `onSelect`, which feeds the SAME effective-address state a typed
// address always used — the checkout payload, the delivery re-quote and the
// "use a different address" wiring are unchanged. The host owns all order
// state; this component never touches it.
//
// ⚠️ THE ADDRESS BOOK IS SESSION-ONLY. GET/POST/PATCH/DELETE
// /users/me/addresses sit behind AuthGuard (backend/src/users/users.controller.ts),
// so a signed-out SMS-link checkout cannot read or write the book. Those hosts
// pass `canSaveToBook={false}` and we render the typed address as a one-off
// for this order instead of pretending the write failed.
//
// ⚠️ THE d04e9d73 RULES STILL HOLD: typed text ALWAYS replaces `street`
// (never "only when empty"), editing street/suburb/city/postal/province
// clears stale coordinates, and picking a suggestion repopulates the full
// parsed address + fresh coordinates.

import { useEffect, useId, useRef, useState } from 'react';
import { useFocusTrap } from '@/lib/use-focus-trap';
import {
  AddressAutocomplete,
  type ParsedAddressComponents,
} from './address-autocomplete';
import {
  ManualAddressFields,
  type ManualAddressValue,
} from './manual-address-fields';
import { PROVINCE_LABELS } from '@/lib/utils';
import type { Address } from '@/lib/types';

const API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001/api';

export interface DeliveryAddressDialogProps {
  /** Control that opened the drawer. Focus returns there on close. */
  returnFocusTo?: HTMLElement | null;
  /** Current effective address the add/edit form starts from. */
  initialAddress: ManualAddressValue;
  initialLat?: number | null;
  initialLng?: number | null;
  /** Address-book row currently in effect, pre-selected in the list. */
  selectedAddressId?: string | null;
  /**
   * Apply an address from the member's book to this order. The drawer closes
   * after Continue, so the host can re-price in the same commit.
   */
  onSelect: (address: Address) => void;
  /**
   * Apply a typed address to THIS ORDER ONLY, without writing the address
   * book. Used by the token checkout, where the book is unreachable.
   */
  onUseOnce?: (
    value: ManualAddressValue,
    lat: number | null,
    lng: number | null,
  ) => void;
  /** Clerk JWT getter for the session-only address-book endpoints. */
  getToken?: () => Promise<string | null>;
  /**
   * False for a signed-out SMS-link checkout, whose token cannot reach the
   * session-only address book: we skip the list and the save entirely and
   * offer the typed address as a one-off.
   */
  canSaveToBook?: boolean;
  /**
   * Whether a door quote is priced off coordinates on this surface. True for
   * the marketplace checkouts (their Pay gate needs lat/lng); false for the
   * cart / print-delivery flows, which never used coords.
   */
  requireCoords?: boolean;
  /**
   * The identity that will receive this delivery, shown under each saved row.
   * The checkout passes the buyer's name + phone; surfaces that do not have it
   * simply omit it.
   */
  recipient?: { name?: string | null; phone?: string | null } | null;
  /**
   * Called after a successful add / edit / delete with the refreshed book, so
   * a host whose selected row was edited or deleted can re-read it.
   */
  onAddressesChanged?: (addresses: Address[]) => void;
  /** Any dismissal: X, Escape, backdrop, Cancel. */
  onClose: () => void;
  /** Distinguishes the field ids if a surface ever mounts two. */
  idPrefix?: string;
}

function addressOneLine(a: Address): string {
  return [[a.building, a.street].filter(Boolean).join(', '), a.address2]
    .filter(Boolean)
    .join(', ');
}

function addressLocality(a: Address): string {
  return [a.suburb, a.city, a.postalCode].filter(Boolean).join(', ');
}

function toManualAddress(a: Address): ManualAddressValue {
  return {
    building: a.building ?? '',
    street: a.street,
    address2: a.address2 ?? '',
    suburb: a.suburb ?? '',
    city: a.city,
    postalCode: a.postalCode,
    province: a.province,
  };
}

export function DeliveryAddressDialog({
  returnFocusTo,
  initialAddress,
  initialLat = null,
  initialLng = null,
  selectedAddressId = null,
  onSelect,
  onUseOnce,
  getToken,
  canSaveToBook = true,
  requireCoords = true,
  recipient = null,
  onAddressesChanged,
  onClose,
  idPrefix = 'delivery-address-dialog',
}: DeliveryAddressDialogProps) {
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  // LIST = saved addresses; FORM = add / edit. Token checkouts have no list.
  const [view, setView] = useState<'list' | 'form'>(
    canSaveToBook ? 'list' : 'form',
  );
  const [editing, setEditing] = useState<Address | null>(null);
  // null = still reading the book.
  const [addresses, setAddresses] = useState<Address[] | null>(
    canSaveToBook ? null : [],
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(
    selectedAddressId,
  );
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [form, setForm] = useState<ManualAddressValue>(initialAddress);
  const [lat, setLat] = useState<number | null>(initialLat);
  const [lng, setLng] = useState<number | null>(initialLng);
  const [label, setLabel] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  // Slide-in / slide-out, reduced-motion aware (see the aside's classes).
  const [entered, setEntered] = useState(false);
  const closingRef = useRef(false);

  // Two frames so the off-screen → on-screen transform actually animates,
  // exactly like components/added-to-cart-drawer.tsx.
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => setEntered(true)),
    );
    return () => cancelAnimationFrame(frame);
  }, []);

  async function readBook(): Promise<Address[]> {
    const token = await getTokenRef.current?.();
    const res = await fetch(`${API_URL}/users/me/addresses`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) throw new Error('unexpected address-book shape');
    return rows as Address[];
  }

  // Read the address book once per open. A failure is not fatal: the member
  // can still add an address, which is the reported blocker.
  useEffect(() => {
    if (!canSaveToBook) {
      setAddresses([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const rows = await readBook();
        if (cancelled) return;
        setAddresses(rows);
        setLoadError(null);
      } catch {
        if (cancelled) return;
        setAddresses([]);
        setLoadError(
          'We couldn’t load your saved addresses. You can still add a new one.',
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // `reloadKey` powers the inline "Try again" without remounting the drawer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSaveToBook, reloadKey]);

  // ⚠️ ESCAPE/BACKDROP ARE REFUSED WHILE A BOOK WRITE IS IN FLIGHT: closing
  // the drawer would tell the member the address was not saved when it may
  // have been. The trap's onClose runs through a ref, so this stays current.
  function requestClose() {
    if (saving || deleting || closingRef.current) return;
    closingRef.current = true;
    setEntered(false);
    const reduce =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      onClose();
      return;
    }
    window.setTimeout(onClose, 200);
  }

  const panelRef = useFocusTrap<HTMLDivElement>({
    onClose: requestClose,
    returnFocusTo: returnFocusTo ?? null,
  });

  function openAddForm() {
    setEditing(null);
    setForm(initialAddress);
    setLat(initialLat);
    setLng(initialLng);
    setLabel('');
    setIsDefault(false);
    setSaveError(null);
    setView('form');
  }

  function openEditForm(a: Address) {
    setEditing(a);
    setForm(toManualAddress(a));
    setLat(a.lat ?? null);
    setLng(a.lng ?? null);
    setLabel(a.label ?? '');
    setIsDefault(a.isDefault);
    setSaveError(null);
    setView('form');
  }

  function backToList() {
    if (saving) return;
    setSaveError(null);
    setView('list');
  }

  // A manually changed street/suburb/city/postal/province no longer belongs to
  // the coordinates we started with. Keep the pair honest: editing any of those
  // five clears it, and the marketplace checkouts then require a fresh
  // suggestion pick (which writes the new coordinates). Editing only the
  // building/unit does not move the parcel, so the coordinates stay.
  function changeManualAddress(next: ManualAddressValue) {
    const moved =
      next.street !== form.street ||
      next.suburb !== form.suburb ||
      next.city !== form.city ||
      next.postalCode !== form.postalCode ||
      next.province !== form.province;
    setForm(next);
    if (moved) {
      setLat(null);
      setLng(null);
    }
  }

  function handleComponents(c: ParsedAddressComponents) {
    setForm((prev) => ({
      ...prev,
      street: c.street ?? prev.street,
      suburb: c.suburb ?? prev.suburb,
      city: c.city ?? prev.city,
      postalCode: c.postalCode ?? prev.postalCode,
      province: c.province
        ? (c.province
            .toUpperCase()
            .replace(/[\s-]+/g, '_') as ManualAddressValue['province'])
        : prev.province,
    }));
    setLat(c.lat ?? null);
    setLng(c.lng ?? null);
  }

  // Validation, mirrored inline so a disabled primary button never has to
  // explain itself. The five fields decide where a parcel lands; on the
  // courier checkouts the two coordinates are what the rate is priced and
  // routed on, so they are required there (the cart / print flows never
  // needed them).
  const missing = [
    !form.street.trim() && 'street address',
    !form.suburb.trim() && 'suburb',
    !form.city.trim() && 'city',
    !form.postalCode.trim() && 'postal code',
    !form.province && 'province',
  ].filter((v): v is string => Boolean(v));
  const missingCoords = requireCoords && (lat == null || lng == null);
  const canSave = !saving && missing.length === 0 && !missingCoords;

  function savedPayload() {
    return {
      label: label.trim() || null,
      building: form.building.trim() || null,
      street: form.street.trim(),
      address2: form.address2.trim() || null,
      suburb: form.suburb.trim() || null,
      city: form.city.trim(),
      postalCode: form.postalCode.trim(),
      province: form.province,
      lat: lat ?? null,
      lng: lng ?? null,
      isDefault,
    };
  }

  async function saveAddress() {
    if (!canSave || !canSaveToBook) return;
    setSaving(true);
    setSaveError(null);
    try {
      const token = await getTokenRef.current?.();
      const res = await fetch(
        editing
          ? `${API_URL}/users/me/addresses/${encodeURIComponent(editing.id)}`
          : `${API_URL}/users/me/addresses`,
        {
          method: editing ? 'PATCH' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(savedPayload()),
        },
      );
      const data = (await res.json().catch(() => null)) as
        | (Address & { message?: string | string[] })
        | null;
      if (!res.ok) {
        const message = Array.isArray(data?.message)
          ? data?.message.join(', ')
          : data?.message;
        throw new Error(
          message || `We couldn’t save that address (${res.status}).`,
        );
      }
      // Refresh the book so the list is the server's truth, then select the
      // saved row and return to the list. Continue applies it to the order.
      let rows: Address[] | null = null;
      try {
        rows = await readBook();
      } catch {
        rows = null;
      }
      const saved = data && 'id' in data && data.id ? data : null;
      if (rows) {
        setAddresses(rows);
        setSelectedId(saved?.id ?? editing?.id ?? selectedId);
        onAddressesChanged?.(rows);
      } else if (addresses) {
        const merged = saved
          ? [...addresses.filter((a) => a.id !== saved.id), saved]
          : addresses;
        setAddresses(merged);
        setSelectedId(saved?.id ?? editing?.id ?? selectedId);
        onAddressesChanged?.(merged);
      }
      setView('list');
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? err.message
          : 'We couldn’t save that address. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteAddress(a: Address) {
    if (a.id === 'profile' || deleting) return;
    setDeleting(true);
    setActionError(null);
    try {
      const token = await getTokenRef.current?.();
      const res = await fetch(
        `${API_URL}/users/me/addresses/${encodeURIComponent(a.id)}`,
        {
          method: 'DELETE',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          message?: string | string[];
        } | null;
        const message = Array.isArray(data?.message)
          ? data.message.join(', ')
          : data?.message;
        throw new Error(message || `We couldn’t delete that address (${res.status}).`);
      }
      const rows = await readBook();
      setAddresses(rows);
      if (selectedId === a.id) {
        setSelectedId(
          rows.find((row) => row.isDefault)?.id ?? rows[0]?.id ?? null,
        );
      }
      setConfirmDeleteId(null);
      onAddressesChanged?.(rows);
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : 'We couldn’t delete that address. Please try again.',
      );
    } finally {
      setDeleting(false);
    }
  }

  function useForThisOrderOnly() {
    if (!canSave || !onUseOnce) return;
    onUseOnce(form, lat, lng);
    requestClose();
  }

  function continueWithSelected() {
    if (!addresses || !selectedId) return;
    const chosen = addresses.find((a) => a.id === selectedId);
    if (!chosen) return;
    onSelect(chosen);
    requestClose();
  }

  function retryLoad() {
    setLoadError(null);
    setAddresses(null);
    setReloadKey((k) => k + 1);
  }

  const selectedAddress =
    addresses?.find((a) => a.id === selectedId) ?? null;
  const canContinue =
    !saving && !deleting && selectedAddress != null;

  return (
    <div
      // data-blocking-overlay is read by the listing page's sticky mobile buy
      // bar; the same contract every blocking overlay uses.
      data-blocking-overlay="true"
      className="fixed inset-0 z-[80] bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Select Delivery Address"
        tabIndex={-1}
        className={[
          'fixed z-[81] inset-0 flex flex-col bg-[var(--bg-card)] outline-none',
          'md:left-auto md:right-0 md:w-[430px]',
          'transition-transform duration-200 ease-out motion-reduce:transition-none',
          entered
            ? 'translate-y-0 md:translate-x-0'
            : 'translate-y-full md:translate-y-0 md:translate-x-full',
        ].join(' ')}
        style={{ borderLeft: '0.5px solid var(--border)' }}
      >
        {/* Header */}
        <div
          className="flex-shrink-0 px-4 py-3"
          style={{ borderBottom: '0.5px solid var(--border)' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2
                className="m-0 text-[18px] leading-[1.25]"
                style={{ color: 'var(--text-primary)', fontWeight: 600 }}
              >
                {view === 'list'
                  ? 'Select Delivery Address'
                  : editing
                    ? 'Edit Address'
                    : 'Add Address'}
              </h2>
              {view === 'list' ? (
                <p
                  className="m-0 mt-1 text-xs"
                  style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}
                >
                  Choose where this order should be delivered.
                </p>
              ) : (
                canSaveToBook && (
                  <button
                    type="button"
                    onClick={backToList}
                    disabled={saving}
                    className="m-0 mt-1 text-xs underline"
                    style={{
                      color: 'var(--text-secondary)',
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      cursor: saving ? 'not-allowed' : 'pointer',
                      fontSize: 'inherit',
                    }}
                  >
                    ‹ Back
                  </button>
                )
              )}
            </div>
            <button
              type="button"
              onClick={requestClose}
              disabled={saving || deleting}
              aria-label="Close"
              className="shrink-0 rounded-[6px] px-2 py-1 text-lg leading-none"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-tertiary)',
                cursor: saving || deleting ? 'not-allowed' : 'pointer',
              }}
            >
              ✕
            </button>
          </div>

          {view === 'list' && canSaveToBook && (
            <div className="mt-3 flex items-center justify-between gap-3">
              <p
                className="m-0 text-xs uppercase"
                style={{
                  color: 'var(--text-tertiary)',
                  letterSpacing: '0.08em',
                  fontWeight: 600,
                }}
              >
                Delivery Addresses
              </p>
              <button
                type="button"
                onClick={openAddForm}
                disabled={saving || deleting}
                aria-label="Add a new address"
                className="rounded-[6px] px-3 py-1.5 text-xs"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border-visible)',
                  color: 'var(--text-primary)',
                  fontWeight: 500,
                  cursor: saving || deleting ? 'not-allowed' : 'pointer',
                }}
              >
                + Add
              </button>
            </div>
          )}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {view === 'list' ? (
            <>
              {!canSaveToBook ? (
                <p
                  className="m-0 text-xs"
                  style={{ color: 'var(--text-tertiary)', lineHeight: 1.55 }}
                >
                  Saved addresses aren’t available on this secure checkout
                  link. Enter the address for this delivery below.
                </p>
              ) : addresses === null ? (
                <p className="m-0 text-sm" style={{ color: 'var(--text-tertiary)' }}>
                  Loading your saved addresses…
                </p>
              ) : loadError ? (
                <p
                  role="alert"
                  className="m-0 text-xs"
                  style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
                >
                  {loadError}{' '}
                  <button
                    type="button"
                    onClick={retryLoad}
                    className="underline"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      color: 'var(--red)',
                      cursor: 'pointer',
                      fontSize: 'inherit',
                    }}
                  >
                    Try again
                  </button>
                </p>
              ) : addresses.length === 0 ? (
                <p className="m-0 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  You don’t have any saved addresses yet.
                </p>
              ) : (
                <div
                  role="radiogroup"
                  aria-label="Saved addresses"
                  className="space-y-2"
                >
                  {addresses.map((a) => {
                    const active = selectedId === a.id;
                    const isProfile = a.id === 'profile';
                    return (
                      <div
                        key={a.id}
                        className="rounded-[8px] p-3"
                        style={{
                          background: active
                            ? 'var(--action-option-selected-bg)'
                            : 'transparent',
                          border: `1.5px solid ${
                            active
                              ? 'var(--action-option-selected-edge)'
                              : 'var(--action-option-edge)'
                          }`,
                        }}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="radio"
                            name="saved-delivery-address"
                            checked={active}
                            onChange={() => setSelectedId(a.id)}
                            aria-label={a.label ?? addressOneLine(a)}
                            style={{ marginTop: 3, accentColor: 'var(--red)' }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              {a.label && (
                                <span
                                  className="rounded-[3px] px-1.5 py-0.5 text-xs"
                                  style={{
                                    background: 'var(--bg-card)',
                                    color: 'var(--text-secondary)',
                                    border: '0.5px solid var(--border)',
                                  }}
                                >
                                  {a.label}
                                </span>
                              )}
                              {a.isDefault && (
                                <span
                                  className="text-xs"
                                  style={{ color: 'var(--text-tertiary)' }}
                                >
                                  Default
                                </span>
                              )}
                            </div>
                            <p
                              className="m-0 mt-1 text-sm"
                              style={{
                                color: 'var(--text-primary)',
                                lineHeight: 1.45,
                                wordBreak: 'break-word',
                              }}
                            >
                              {addressOneLine(a)}
                            </p>
                            <p
                              className="m-0 mt-0.5 text-xs"
                              style={{ color: 'var(--text-tertiary)' }}
                            >
                              {addressLocality(a)}
                              {a.province
                                ? ` · ${PROVINCE_LABELS[a.province] ?? a.province}`
                                : ''}
                            </p>
                            {recipient &&
                              (recipient.name || recipient.phone) && (
                                <p
                                  className="m-0 mt-1 text-xs"
                                  style={{ color: 'var(--text-secondary)' }}
                                >
                                  {[recipient.name, recipient.phone]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </p>
                              )}
                          </div>
                        </div>

                        {/* Per-row Edit / Delete. The profile row is a
                            read-through of User.addr*: editing routes to the
                            profile PATCH, deletion is refused by the backend. */}
                        <div className="mt-2 flex flex-wrap items-center justify-end gap-3">
                          {isProfile && (
                            <span
                              className="text-[11px]"
                              style={{ color: 'var(--text-tertiary)' }}
                            >
                              Edit from your profile
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => openEditForm(a)}
                            disabled={saving || deleting}
                            aria-label={`Edit ${a.label ?? addressOneLine(a)}`}
                            className="text-xs"
                            style={{
                              background: 'transparent',
                              border: 'none',
                              padding: 0,
                              color: 'var(--text-primary)',
                              fontWeight: 500,
                              cursor: saving || deleting ? 'not-allowed' : 'pointer',
                              textDecoration: 'underline',
                            }}
                          >
                            Edit
                          </button>
                          {!isProfile &&
                            (confirmDeleteId === a.id ? (
                              <>
                                <span
                                  className="text-[11px]"
                                  style={{ color: 'var(--text-secondary)' }}
                                >
                                  Delete this address?
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void deleteAddress(a)}
                                  disabled={deleting}
                                  className="text-xs"
                                  style={{
                                    background: 'transparent',
                                    border: 'none',
                                    padding: 0,
                                    color: 'var(--red)',
                                    fontWeight: 600,
                                    cursor: deleting ? 'wait' : 'pointer',
                                    textDecoration: 'underline',
                                  }}
                                >
                                  {deleting ? 'Deleting…' : 'Delete'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  disabled={deleting}
                                  className="text-xs"
                                  style={{
                                    background: 'transparent',
                                    border: 'none',
                                    padding: 0,
                                    color: 'var(--text-secondary)',
                                    cursor: deleting ? 'not-allowed' : 'pointer',
                                  }}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(a.id)}
                                disabled={saving || deleting}
                                aria-label={`Delete ${a.label ?? addressOneLine(a)}`}
                                className="text-xs"
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  padding: 0,
                                  color: 'var(--text-secondary)',
                                  cursor: saving || deleting ? 'not-allowed' : 'pointer',
                                }}
                              >
                                Delete
                              </button>
                            ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {actionError && (
                <p
                  role="alert"
                  className="m-0 mt-3 text-xs"
                  style={{ color: 'var(--red)', lineHeight: 1.5 }}
                >
                  {actionError}
                </p>
              )}

              {!loadError && addresses !== null && (
                <p
                  className="m-0 mt-3 text-xs"
                  style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}
                >
                  Need somewhere else? Use <strong>+ Add</strong> to save a new
                  delivery address.
                </p>
              )}
            </>
          ) : (
            <>
              {!canSaveToBook && (
                <p
                  className="m-0 mb-3 text-xs"
                  style={{ color: 'var(--text-tertiary)', lineHeight: 1.55 }}
                >
                  Saved addresses aren’t available on this secure checkout
                  link. Enter the address for this delivery below.
                </p>
              )}

              <AddressAutocomplete
                value={
                  form.street
                    ? `${form.street}${form.suburb ? `, ${form.suburb}` : ''}`
                    : ''
                }
                onChange={(v) => {
                  // ⚠️ ALWAYS mirror typed text into street — never "only when
                  // empty". The field is prefilled from the saved address, so
                  // an emptiness guard silently discarded every keystroke (the
                  // 2026-11-26 @ruanda regression). Picking a suggestion still
                  // calls onComponents with the full parsed address + coords.
                  setForm((p) => ({ ...p, street: v }));
                  // The typed street is not the address the starting
                  // coordinates belong to; a suggestion pick below writes the
                  // fresh pair.
                  setLat(null);
                  setLng(null);
                }}
                onComponents={handleComponents}
              />

              <div className="mt-3">
                <ManualAddressFields
                  value={form}
                  onChange={changeManualAddress}
                  idPrefix={idPrefix}
                />
              </div>

              {canSaveToBook && (
                <label
                  className="mt-3 block text-xs"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Label (optional)
                  <input
                    type="text"
                    value={label}
                    maxLength={40}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g. Home, Work"
                    className="mt-1 block w-full rounded-[6px] px-3 py-2 text-sm"
                    style={{
                      background: 'var(--field-bg)',
                      border: '0.5px solid var(--border)',
                      color: 'var(--text-primary)',
                    }}
                  />
                </label>
              )}

              {canSaveToBook && (
                <label
                  className="mt-3 flex items-start gap-2 text-xs"
                  style={{ color: 'var(--text-secondary)', cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={isDefault}
                    onChange={(e) => setIsDefault(e.target.checked)}
                    style={{ marginTop: 2 }}
                  />
                  <span>Set as default delivery address</span>
                </label>
              )}

              {missing.length > 0 && (
                <p
                  className="m-0 mt-3 text-xs"
                  style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}
                >
                  Still needed: {missing.join(', ')}.
                </p>
              )}
              {missingCoords && (
                <p
                  className="m-0 mt-2 text-xs"
                  style={{ color: 'var(--warning)', lineHeight: 1.5 }}
                >
                  Pick your address from the suggestions so we can capture
                  coordinates — door delivery needs them to price and route the
                  parcel.
                </p>
              )}

              {saveError && (
                <p
                  role="alert"
                  className="m-0 mt-2 text-xs"
                  style={{ color: 'var(--red)', lineHeight: 1.5 }}
                >
                  {saveError}
                </p>
              )}
            </>
          )}
        </div>

        {/* Sticky footer */}
        <div
          className="flex-shrink-0 px-4 py-3"
          style={{
            borderTop: '0.5px solid var(--border)',
            background: 'var(--bg-card)',
            paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
          }}
        >
          {view === 'list' ? (
            <button
              type="button"
              onClick={continueWithSelected}
              disabled={!canContinue}
              className="w-full rounded-[6px] px-4 py-3 text-sm"
              style={{
                background: canContinue
                  ? 'var(--action-primary-bg)'
                  : 'var(--bg-inset)',
                color: canContinue ? '#fff' : 'var(--text-tertiary)',
                border: 'none',
                fontWeight: 500,
                cursor: canContinue ? 'pointer' : 'not-allowed',
              }}
            >
              Continue
            </button>
          ) : canSaveToBook ? (
            <button
              type="button"
              onClick={() => void saveAddress()}
              disabled={!canSave}
              className="w-full rounded-[6px] px-4 py-3 text-sm"
              style={{
                background: canSave
                  ? 'var(--action-primary-bg)'
                  : 'var(--bg-inset)',
                color: canSave ? '#fff' : 'var(--text-tertiary)',
                border: 'none',
                fontWeight: 500,
                cursor: canSave ? 'pointer' : 'not-allowed',
              }}
            >
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Save address'}
            </button>
          ) : (
            <button
              type="button"
              onClick={useForThisOrderOnly}
              disabled={!canSave}
              className="w-full rounded-[6px] px-4 py-3 text-sm"
              style={{
                background: canSave
                  ? 'var(--action-primary-bg)'
                  : 'var(--bg-inset)',
                color: canSave ? '#fff' : 'var(--text-tertiary)',
                border: 'none',
                fontWeight: 500,
                cursor: canSave ? 'pointer' : 'not-allowed',
              }}
            >
              Use this address
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
