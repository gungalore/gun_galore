'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AddressAutocomplete,
  type ParsedAddressComponents,
} from '@/components/address-autocomplete';
import { DeliveryAddressSummary } from '@/components/delivery-address-summary';
import {
  ManualAddressFields,
  emptyManualAddress,
  type ManualAddressValue,
} from '@/components/manual-address-fields';
import { SavedAddressPicker } from '@/components/saved-address-picker';
import { formatPrice } from '@/lib/utils';
import {
  motivationsApi,
  type MotivationFulfilmentMode,
  type MotivationPrintAddress,
  type MotivationPrintQuote,
} from '@/lib/motivations-api';

/**
 * THE SECOND CHOICE, AT THE POINT OF PAYMENT.
 *
 * ⚠️ ONE PAYMENT. "Print and Deliver" adds the R75 print fee and a live Bob Go
 * quote to the SAME Yoco amount as the document; this component only prices the
 * add-on and hands the address back to the pack page. Nothing here charges.
 *
 * ⚠️ THE QUOTE IS THE SERVER'S. Every address change re-asks
 * `POST /motivations/:id/print/quote`; the pack page passes the same address to
 * `POST /payment`, which re-quotes again before creating the checkout, so the
 * preview can never become the charge by accident.
 */
export interface PrintSelection {
  mode: MotivationFulfilmentMode;
  address: MotivationPrintAddress | null;
  quote: MotivationPrintQuote | null;
  totalCents: number;
}

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

async function authHeaders(
  token: () => Promise<string | null>,
): Promise<Record<string, string>> {
  const value = await token();
  return value ? { Authorization: `Bearer ${value}` } : {};
}

interface Props {
  motivationId: string;
  token: () => Promise<string | null>;
  baseCents: number;
  feeCents: number;
  mode: MotivationFulfilmentMode;
  locked: boolean;
  onModeChange: (mode: MotivationFulfilmentMode) => void;
  onSelection: (selection: PrintSelection) => void;
}

function toApiAddress(v: ManualAddressValue): MotivationPrintAddress | null {
  if (
    !v.street.trim() ||
    !v.suburb.trim() ||
    !v.city.trim() ||
    !v.postalCode.trim() ||
    !v.province
  ) {
    return null;
  }
  return {
    streetAddress: [v.building.trim(), v.street.trim()]
      .filter(Boolean)
      .join(', '),
    ...(v.address2.trim() ? { address2: v.address2.trim() } : {}),
    suburb: v.suburb.trim(),
    city: v.city.trim(),
    postalCode: v.postalCode.trim(),
    province: v.province,
  };
}

/**
 * True when every address part matches the prefilled profile address.
 *
 * Used only to keep the summary label honest — "Deliver to my default address"
 * while the current address still IS that default, "Deliver to" once the
 * seller has chosen/typed an alternative. The quote payload is built from the
 * address itself either way, so nothing about pricing depends on this.
 */
function sameAddress(a: ManualAddressValue, b: ManualAddressValue): boolean {
  const parts: Array<keyof ManualAddressValue> = [
    'building',
    'street',
    'address2',
    'suburb',
    'city',
    'postalCode',
    'province',
  ];
  return parts.every((p) => (a[p] ?? '').trim() === (b[p] ?? '').trim());
}

export default function PrintDelivery({
  motivationId,
  token,
  baseCents,
  feeCents,
  mode,
  locked,
  onModeChange,
  onSelection,
}: Props) {
  const [address, setAddress] = useState<ManualAddressValue>(emptyManualAddress);
  const [quote, setQuote] = useState<MotivationPrintQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [prefilled, setPrefilled] = useState(false);
  // The default-address pattern (2026-11-25 operator: every delivery surface
  // shows the default address + one control to change it). `profileAddress` is
  // the address exactly as it was prefilled from the profile — the "default"
  // the summary label and the reset button refer to; `addressEditing` opens
  // the editor (address book + manual fields).
  const [profileAddress, setProfileAddress] = useState<ManualAddressValue | null>(
    null,
  );
  const [addressEditing, setAddressEditing] = useState(false);
  const seq = useRef(0);

  // The member's saved address is the starting point, but every field stays
  // editable — a delivered envelope is a one-off, not a profile change.
  useEffect(() => {
    if (prefilled) return;
    let live = true;
    void (async () => {
      try {
        const headers = await authHeaders(token);
        const res = await fetch(`${API_URL}/users/me`, {
          headers,
          cache: 'no-store',
        });
        if (!res.ok) return;
        const me = (await res.json()) as {
          addrStreet?: string | null;
          addrAddress2?: string | null;
          addrSuburb?: string | null;
          addrCity?: string | null;
          addrPostalCode?: string | null;
          addrProvince?: string | null;
        };
        if (!live) return;
        if (me.addrStreet || me.addrCity) {
          const saved: ManualAddressValue = {
            building: '',
            street: me.addrStreet ?? '',
            address2: me.addrAddress2 ?? '',
            suburb: me.addrSuburb ?? '',
            city: me.addrCity ?? '',
            postalCode: me.addrPostalCode ?? '',
            province: (me.addrProvince as ManualAddressValue['province']) ?? '',
          };
          setAddress(saved);
          setProfileAddress(saved);
        }
        setPrefilled(true);
      } catch {
        // Not fatal: the fields are open for typing.
      }
    })();
    return () => {
      live = false;
    };
  }, [prefilled]);

  const apiAddress = useMemo(() => toApiAddress(address), [address]);

  // ── Collapsed default-address summary ────────────────────────────────
  // The prefilled profile address is what the summary shows; an alternative
  // (picked from the book or typed) keeps the same label but drops the
  // "my default address" wording once it no longer equals the profile one.
  const hasSavedAddress = profileAddress !== null;
  // Single display line: building, street, address2, suburb, city, postal.
  // Province is required for the quote payload but is not part of the line.
  const addressLine = [
    address.building,
    address.street,
    address.address2,
    address.suburb,
    address.city,
    address.postalCode,
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
  const addressIncomplete =
    !address.street.trim() ||
    !address.suburb.trim() ||
    !address.city.trim() ||
    !address.postalCode.trim();
  const addressIsDefault =
    profileAddress !== null && sameAddress(address, profileAddress);

  // Quote whenever the complete address changes. A stale answer is discarded by
  // the sequence number, not by hoping the requests finish in order.
  useEffect(() => {
    if (mode !== 'DELIVER' || !apiAddress) {
      setQuote(null);
      setQuoting(false);
      return;
    }
    const mine = ++seq.current;
    setQuoting(true);
    setError(null);
    const timer = window.setTimeout(() => {
      void motivationsApi
        .printQuote(token, motivationId, apiAddress)
        .then((next) => {
          if (mine !== seq.current) return;
          setQuote(next);
        })
        .catch((err) => {
          if (mine !== seq.current) return;
          setQuote(null);
          setError((err as Error).message);
        })
        .finally(() => {
          if (mine === seq.current) setQuoting(false);
        });
    }, 550);
    return () => window.clearTimeout(timer);
  }, [apiAddress, mode, motivationId, token]);

  useEffect(() => {
    onSelection({
      mode,
      address: mode === 'DELIVER' ? apiAddress : null,
      quote: mode === 'DELIVER' ? quote : null,
      totalCents:
        baseCents +
        (mode === 'DELIVER' ? feeCents + (quote?.shippingCents ?? 0) : 0),
    });
  }, [apiAddress, baseCents, feeCents, mode, onSelection, quote]);

  function handleComponents(c: ParsedAddressComponents) {
    setAddress((prev) => ({
      ...prev,
      street: c.street || prev.street,
      suburb: c.suburb || prev.suburb,
      city: c.city || prev.city,
      postalCode: c.postalCode || prev.postalCode,
      province:
        (c.province as ManualAddressValue['province']) || prev.province,
    }));
    setPrefilled(true);
  }

  async function pickSaved(a: {
    building?: string | null;
    street: string;
    address2?: string | null;
    suburb?: string | null;
    city: string;
    postalCode: string;
    province: string;
  }) {
    setAddress({
      building: a.building ?? '',
      street: a.street,
      address2: a.address2 ?? '',
      suburb: a.suburb ?? '',
      city: a.city,
      postalCode: a.postalCode,
      province: a.province as ManualAddressValue['province'],
    });
    setPrefilled(true);
    // Picking from the book is a choice, not an edit session: close the editor
    // so the chosen address collapses straight back into the summary row.
    setAddressEditing(false);
  }

  /** Reset to the prefilled profile address and collapse the editor. */
  function useDefaultAddress() {
    if (profileAddress) setAddress({ ...profileAddress });
    setAddressEditing(false);
  }

  async function saveToBook() {
    if (!apiAddress) return;
    setSaving(true);
    setError(null);
    try {
      const headers = await authHeaders(token);
      const res = await fetch(`${API_URL}/users/me/addresses`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          street: apiAddress.streetAddress,
          address2: apiAddress.address2 ?? null,
          suburb: apiAddress.suburb,
          city: apiAddress.city,
          postalCode: apiAddress.postalCode,
          province: apiAddress.province,
          isDefault: false,
        }),
      });
      if (!res.ok) throw new Error('Could not save that address.');
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="mt-4 rounded-xl border px-4 py-4"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}
    >
      <h2 className="m-0 font-[family-name:var(--font-head)] text-[18px] font-medium leading-[1.25] text-[var(--text-primary)]">
        How would you like it?
      </h2>
      <p className="m-0 mt-1 text-[12.5px] leading-5 text-[var(--text-secondary)]">
        Your PDF is always included. Print and Deliver adds printing and binding
        (R75) plus courier delivery, all in the same payment.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={locked}
          aria-pressed={mode === 'DIGITAL'}
          onClick={() => onModeChange('DIGITAL')}
          className="rounded-lg border px-3 py-3 text-left disabled:opacity-60"
          style={{
            borderColor:
              mode === 'DIGITAL' ? 'var(--red)' : 'var(--border)',
            background:
              mode === 'DIGITAL' ? 'var(--red-wash)' : 'var(--bg-inset)',
          }}
        >
          <span className="block text-[13.5px] font-medium text-[var(--text-primary)]">
            Print / Download
          </span>
          <span className="mt-0.5 block text-[12px] leading-4 text-[var(--text-secondary)]">
            Included — print it yourself.
          </span>
        </button>
        <button
          type="button"
          disabled={locked}
          aria-pressed={mode === 'DELIVER'}
          onClick={() => onModeChange('DELIVER')}
          className="rounded-lg border px-3 py-3 text-left disabled:opacity-60"
          style={{
            borderColor:
              mode === 'DELIVER' ? 'var(--red)' : 'var(--border)',
            background:
              mode === 'DELIVER' ? 'var(--red-wash)' : 'var(--bg-inset)',
          }}
        >
          <span className="block text-[13.5px] font-medium text-[var(--text-primary)]">
            Print and Deliver ({formatPrice(feeCents)})
          </span>
          <span className="mt-0.5 block text-[12px] leading-4 text-[var(--text-secondary)]">
            We print, bind and courier it.
          </span>
        </button>
      </div>

      {mode === 'DELIVER' ? (
        <div className="mt-4">
          {hasSavedAddress && !addressEditing ? (
            <DeliveryAddressSummary
              label={
                addressIsDefault ? 'Deliver to my default address' : 'Deliver to'
              }
              address={addressLine}
              incomplete={addressIncomplete}
              onChange={() => setAddressEditing(true)}
            />
          ) : (
            <div className="mt-2 rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-start justify-between gap-3">
                <p className="m-0 mb-2 text-[12px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                  Delivery address
                </p>
                {hasSavedAddress ? (
                  <button
                    type="button"
                    onClick={useDefaultAddress}
                    className="text-[12px]"
                    style={{
                      color: 'var(--text-tertiary)',
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                  >
                    Use my default address
                  </button>
                ) : null}
              </div>
              <SavedAddressPicker onSelect={(a) => void pickSaved(a)} />
              <AddressAutocomplete
                value={
                  address.street
                    ? `${address.street}${address.suburb ? `, ${address.suburb}` : ''}`
                    : ''
                }
                onChange={(v) => {
                  setAddress((p) => ({ ...p, street: v }));
                }}
                onComponents={handleComponents}
              />
              <div className="mt-2">
                <ManualAddressFields
                  value={address}
                  onChange={setAddress}
                  idPrefix="print"
                />
              </div>
              {apiAddress ? (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void saveToBook()}
                    disabled={saving || saved}
                    className="text-[12px] font-medium text-[var(--red)] underline disabled:opacity-60"
                  >
                    {saved
                      ? 'Saved to your address book'
                      : saving
                        ? 'Saving…'
                        : 'Save this address to my address book'}
                  </button>
                </div>
              ) : null}
              {hasSavedAddress ? (
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setAddressEditing(false)}
                    disabled={!apiAddress}
                    className="px-4 py-2 rounded-[6px] text-sm"
                    style={{
                      background: 'var(--action-primary-bg)',
                      color: '#fff',
                      border: 'none',
                      fontWeight: 500,
                      cursor: apiAddress ? 'pointer' : 'not-allowed',
                      opacity: apiAddress ? 1 : 0.5,
                    }}
                  >
                    Use this address
                  </button>
                </div>
              ) : null}
            </div>
          )}

          {quoting ? (
            <p className="m-0 mt-2 text-[12px] text-[var(--text-tertiary)]">
              Pricing delivery…
            </p>
          ) : quote ? (
            <div className="mt-3 space-y-1 rounded-lg border px-3 py-3 text-[12.5px]" style={{ borderColor: 'var(--border)' }}>
              <div className="flex justify-between gap-3">
                <span className="text-[var(--text-secondary)]">Motivation</span>
                <span>{formatPrice(baseCents)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[var(--text-secondary)]">
                  Printing &amp; binding
                </span>
                <span>{formatPrice(feeCents)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[var(--text-secondary)]">
                  Delivery{quote.serviceName ? ` · ${quote.serviceName}` : ''}
                </span>
                <span>{formatPrice(quote.shippingCents)}</span>
              </div>
              <div className="mt-1 flex justify-between gap-3 border-t pt-2 text-[13.5px] font-medium" style={{ borderColor: 'var(--border-divider)' }}>
                <span>Total</span>
                <span>{formatPrice(quote.totalCents)}</span>
              </div>
            </div>
          ) : null}
          {error ? (
            <p className="m-0 mt-2 text-[12.5px] leading-5 text-[var(--red)]">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
