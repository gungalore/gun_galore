'use client';

// ─── The delivery-address window ─────────────────────────────────────────
//
// 2026-11-26 member report (@ruanda): "I am unable to select a different
// delivery address to ship the product." She was on a normal BUY_NOW courier
// checkout and had exactly ONE saved address (her default). Clicking "Select a
// different address" swapped the summary row for an INLINE editor that was
// prefilled with the address she already had: the address book (`SavedAddressPicker`)
// hides itself below two saved addresses, so the only visible change was a
// form saying the same place, and there was no way to add another one. From
// the outside, nothing happened.
//
// This dialog is the answer, and it is ONE WINDOW rather than a bigger inline
// form: the saved book is listed even when it holds a single row (with the
// default marked), and "Add a new address" lives in the same dialog, so both
// meanings of "somewhere else" are on screen from the first frame on any
// screen size.
//
// ⚠️ PRESENTATION + ADDRESS-BOOK WRITE ONLY. Choosing an address calls the
// host's `onSelect`, which feeds the SAME capture state a picked/typed address
// always used — the checkout payload, the delivery re-quote and the
// "useDifferentAddress" pinning are unchanged. The host owns all order state;
// this component never touches it.
//
// ⚠️ THE ADDRESS BOOK IS SESSION-ONLY. GET/POST /users/me/addresses sit behind
// AuthGuard (see backend/src/users/users.controller.ts), so a signed-out
// SMS-link checkout cannot read or write the book. Those hosts pass
// `canSaveToBook={false}` and we render the typed address as a one-off for
// this order instead of pretending the write failed.

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
  /** Control that opened the dialog. Focus returns there on close. */
  returnFocusTo?: HTMLElement | null;
  /** Current/default address the "add a new address" form starts from. */
  initialAddress: ManualAddressValue;
  initialLat?: number | null;
  initialLng?: number | null;
  /**
   * Apply an address from the member's book to this order. The dialog closes
   * after this returns, so the host can re-price in the same commit.
   */
  onSelect: (address: Address) => void;
  /**
   * Apply a typed address to THIS ORDER ONLY, without writing the address
   * book. Omit to hide that secondary action.
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
  /** Any dismissal: X, Escape, backdrop, Cancel. */
  onClose: () => void;
  /** Distinguishes the field ids if a surface ever mounts two. */
  idPrefix?: string;
}

function addressOneLine(a: Address): string {
  return [
    [a.building, a.street].filter(Boolean).join(', '),
    a.address2,
  ]
    .filter(Boolean)
    .join(', ');
}

function addressLocality(a: Address): string {
  return [a.suburb, a.city, a.postalCode].filter(Boolean).join(', ');
}

export function DeliveryAddressDialog({
  returnFocusTo,
  initialAddress,
  initialLat = null,
  initialLng = null,
  onSelect,
  onUseOnce,
  getToken,
  canSaveToBook = true,
  requireCoords = true,
  onClose,
  idPrefix = 'delivery-address-dialog',
}: DeliveryAddressDialogProps) {
  const titleId = useId();
  const radioName = useId();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  // null = still reading the book.
  const [addresses, setAddresses] = useState<Address[] | null>(
    canSaveToBook ? null : [],
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // The add-new form opens straight away when there is nothing to pick.
  const [adding, setAdding] = useState(!canSaveToBook);
  const [form, setForm] = useState<ManualAddressValue>(initialAddress);
  const [lat, setLat] = useState<number | null>(initialLat);
  const [lng, setLng] = useState<number | null>(initialLng);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  // Read the address book once per open. A failure is not fatal: the member
  // can still add an address, which is the reported blocker.
  useEffect(() => {
    if (!canSaveToBook) {
      setAddresses([]);
      setAdding(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const token = await getTokenRef.current?.();
        const res = await fetch(`${API_URL}/users/me/addresses`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = (await res.json()) as unknown;
        if (!Array.isArray(rows)) throw new Error('unexpected address-book shape');
        if (cancelled) return;
        setAddresses(rows as Address[]);
        // No saved address at all: the form is the only useful thing to show.
        if (rows.length === 0) setAdding(true);
      } catch {
        if (cancelled) return;
        setAddresses([]);
        setLoadError(
          'We couldn’t load your saved addresses. You can still add a new one below.',
        );
        setAdding(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `reloadKey` powers the inline "Try again" without remounting the dialog.
  }, [canSaveToBook, reloadKey]);

  // ⚠️ ESCAPE/BACKDROP ARE REFUSED WHILE THE BOOK WRITE IS IN FLIGHT: closing
  // the dialog would tell the member the address was not saved when it may
  // have been. The trap's onClose runs through a ref, so this stays current.
  function handleClose() {
    if (saving) return;
    onClose();
  }

  const panelRef = useFocusTrap<HTMLDivElement>({
    onClose: handleClose,
    returnFocusTo: returnFocusTo ?? null,
  });

  function pickSaved(a: Address) {
    onSelect(a);
    onClose();
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
  const canUse = !saving && missing.length === 0 && !missingCoords;

  async function saveAndUse() {
    if (!canUse || !canSaveToBook) return;
    setSaving(true);
    setSaveError(null);
    try {
      const token = await getTokenRef.current?.();
      const res = await fetch(`${API_URL}/users/me/addresses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          building: form.building.trim() || null,
          street: form.street.trim(),
          address2: form.address2.trim() || null,
          suburb: form.suburb.trim() || null,
          city: form.city.trim(),
          postalCode: form.postalCode.trim(),
          province: form.province,
          lat: lat ?? null,
          lng: lng ?? null,
          // Defaulting is an explicit answer elsewhere (profile edit / the
          // checkout's own prompt); a new delivery address must not silently
          // take over the member's default.
          isDefault: false,
        }),
      });
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
      if (!data) throw new Error('We couldn’t save that address.');
      onSelect(data);
      onClose();
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

  function useForThisOrderOnly() {
    if (!canUse || !onUseOnce) return;
    onUseOnce(form, lat, lng);
    onClose();
  }

  function retryLoad() {
    setLoadError(null);
    setAddresses(null);
    setReloadKey((k) => k + 1);
  }

  return (
    <div
      // data-blocking-overlay is read by the listing page's sticky mobile buy
      // bar; harmless here, and the same contract every blocking dialog uses.
      data-blocking-overlay="true"
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-[10px] p-5 outline-none sm:rounded-[10px]"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="m-0 text-[18px] leading-[1.25]"
              style={{ color: 'var(--text-primary)', fontWeight: 600 }}
            >
              Delivery address
            </h2>
            <p
              className="m-0 mt-1 text-xs"
              style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}
            >
              {canSaveToBook
                ? 'Choose a saved address, or add a new one.'
                : 'Enter the address this order should be delivered to.'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            aria-label="Close"
            className="shrink-0 rounded-[6px] px-2 py-1 text-lg leading-none"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-tertiary)',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {/* ── Saved addresses ─────────────────────────────────────────── */}
        <div className="mt-4">
          {addresses === null ? (
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              Loading your saved addresses…
            </p>
          ) : (
            <>
              {!canSaveToBook ? (
                <p
                  className="text-xs"
                  style={{ color: 'var(--text-tertiary)', lineHeight: 1.55 }}
                >
                  Saved addresses aren’t available on this secure checkout
                  link. Enter the address for this delivery below.
                </p>
              ) : addresses.length > 0 ? (
                <div
                  role="radiogroup"
                  aria-label="Saved addresses"
                  className="space-y-2"
                >
                  {addresses.map((a) => (
                    <label
                      key={a.id}
                      className="flex cursor-pointer items-start gap-3 rounded-[6px] p-3"
                      style={{
                        background: 'transparent',
                        border: '1.5px solid var(--action-option-edge)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <input
                        type="radio"
                        name={radioName}
                        onChange={() => pickSaved(a)}
                        style={{ marginTop: 2, accentColor: 'var(--red)' }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
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
                        </span>
                        <span
                          className="mt-1 block text-sm"
                          style={{
                            color: 'var(--text-primary)',
                            lineHeight: 1.45,
                            wordBreak: 'break-word',
                          }}
                        >
                          {addressOneLine(a)}
                        </span>
                        <span
                          className="mt-0.5 block text-xs"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          {addressLocality(a)}
                          {a.province
                            ? ` · ${PROVINCE_LABELS[a.province] ?? a.province}`
                            : ''}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : loadError ? null : (
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  You don’t have any saved addresses yet.
                </p>
              )}

              {loadError && (
                <p
                  role="alert"
                  className="mt-2 text-xs"
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
              )}
            </>
          )}
        </div>

        {/* ── Add a new address ───────────────────────────────────────── */}
        {canSaveToBook && addresses !== null && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-3 w-full rounded-[6px] px-4 py-2.5 text-sm"
            style={{
              background: 'transparent',
              border: '1px solid var(--border-visible)',
              color: 'var(--text-primary)',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            + Add a new address
          </button>
        )}

        {adding && (
          <div
            className="mt-4 rounded-[6px] p-3"
            style={{
              background: 'var(--bg-inset)',
              border: '1px solid var(--border-visible)',
            }}
          >
            <p
              className="m-0 mb-2 text-xs uppercase"
              style={{
                color: 'var(--text-tertiary)',
                letterSpacing: '0.08em',
                fontWeight: 600,
              }}
            >
              {canSaveToBook ? 'Add a new address' : 'Delivery address'}
            </p>

            <AddressAutocomplete
              value={
                form.street
                  ? `${form.street}${form.suburb ? `, ${form.suburb}` : ''}`
                  : ''
              }
              onChange={(v) => {
                // ⚠️ ALWAYS mirror typed text into street — never "only when
                // empty". The field is prefilled from the saved address, so an
                // emptiness guard silently discarded every keystroke (the
                // 2026-11-26 @ruanda regression). Picking a suggestion still
                // calls onComponents with the full parsed address + coords.
                setForm((p) => ({ ...p, street: v }));
                // The typed street is not the address the starting coordinates
                // belong to; a suggestion pick below writes the fresh pair.
                setLat(null);
                setLng(null);
              }}
              onComponents={handleComponents}
            />

            <div className="mt-2.5">
              <ManualAddressFields
                value={form}
                onChange={changeManualAddress}
                idPrefix={idPrefix}
              />
            </div>

            {missing.length > 0 && (
              <p
                className="m-0 mt-2 text-xs"
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

            <div className="mt-3 flex flex-col gap-2">
              {canSaveToBook ? (
                <button
                  type="button"
                  onClick={() => void saveAndUse()}
                  disabled={!canUse}
                  className="w-full rounded-[6px] px-4 py-2.5 text-sm"
                  style={{
                    background: canUse
                      ? 'var(--action-primary-bg)'
                      : 'var(--bg-inset)',
                    color: canUse ? '#fff' : 'var(--text-tertiary)',
                    border: 'none',
                    fontWeight: 500,
                    cursor: canUse ? 'pointer' : 'not-allowed',
                  }}
                >
                  {saving ? 'Saving…' : 'Save and use this address'}
                </button>
              ) : null}
              {onUseOnce ? (
                <button
                  type="button"
                  onClick={useForThisOrderOnly}
                  disabled={!canUse}
                  className="w-full rounded-[6px] px-4 py-2.5 text-sm"
                  style={{
                    background: 'transparent',
                    color: canUse
                      ? 'var(--text-primary)'
                      : 'var(--text-tertiary)',
                    border: '1px solid var(--border-visible)',
                    fontWeight: 500,
                    cursor: canUse ? 'pointer' : 'not-allowed',
                  }}
                >
                  {canSaveToBook
                    ? 'Use this address for this order only'
                    : 'Use this address'}
                </button>
              ) : null}
            </div>
          </div>
        )}

        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="rounded-[6px] px-4 py-2 text-sm"
            style={{
              background: 'transparent',
              border: 'none',
              color: saving ? 'var(--text-tertiary)' : 'var(--text-secondary)',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
