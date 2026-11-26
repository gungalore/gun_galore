'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DeliveryAddressSummary } from '@/components/delivery-address-summary';
import { DeliveryAddressDialog } from '@/components/delivery-address-dialog';
import {
  emptyManualAddress,
  type ManualAddressValue,
} from '@/components/manual-address-fields';
import { formatPrice } from '@/lib/utils';
import type { Address } from '@/lib/types';
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

/** Map an address-book row onto the editable field shape. */
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
  const [prefilled, setPrefilled] = useState(false);
  // The default-address pattern (2026-11-25 operator: every delivery surface
  // shows the address that will be used + one control to change it). The
  // address DRAWER (2026-11-26) owns every saved-address write; this component
  // owns only the effective address it quotes.
  const [addressId, setAddressId] = useState<string | null>(null);
  const [addressBookLoaded, setAddressBookLoaded] = useState(false);
  const addressChosenRef = useRef(false);
  const [addressDialogOpen, setAddressDialogOpen] = useState(false);
  // Focus returns here on close (Safari does not focus a button on click).
  const addressTriggerRef = useRef<HTMLButtonElement | null>(null);
  const seq = useRef(0);

  // The member's saved default address is the starting point: the address book
  // is the source of truth (its default row includes the synthetic `profile`
  // row), with GET /users/me as the fallback when the book read fails.
  useEffect(() => {
    if (prefilled) return;
    let live = true;
    void (async () => {
      try {
        const headers = await authHeaders(token);
        const bookRes = await fetch(`${API_URL}/users/me/addresses`, {
          headers,
          cache: 'no-store',
        });
        if (bookRes.ok) {
          const rows = (await bookRes.json()) as Address[];
          if (live && Array.isArray(rows) && !addressChosenRef.current) {
            const preferred =
              rows.find((a) => a.isDefault) ??
              rows.find((a) => a.id === 'profile') ??
              rows[0];
            if (preferred) {
              setAddress(toManualAddress(preferred));
              setAddressId(preferred.id);
              setPrefilled(true);
              setAddressBookLoaded(true);
              return;
            }
          }
        }
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
        if (!live || addressChosenRef.current) return;
        if (me.addrStreet || me.addrCity) {
          setAddress({
            building: '',
            street: me.addrStreet ?? '',
            address2: me.addrAddress2 ?? '',
            suburb: me.addrSuburb ?? '',
            city: me.addrCity ?? '',
            postalCode: me.addrPostalCode ?? '',
            province: (me.addrProvince as ManualAddressValue['province']) ?? '',
          });
        }
        setPrefilled(true);
      } catch {
        // Not fatal: the drawer can add an address.
      } finally {
        if (live) setAddressBookLoaded(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [prefilled]);

  const apiAddress = useMemo(() => toApiAddress(address), [address]);

  // ── Collapsed effective-address summary ──────────────────────────────
  // Single display line: building, street, address2, suburb, city, postal.
  // Province is required for the quote payload but is not part of the line.
  const hasDeliveryAddress = Boolean(address.street.trim() || address.city.trim());
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

  /** Apply an address-book row (or the drawer's pick) to this delivery. */
  function applySavedAddress(a: Address) {
    addressChosenRef.current = true;
    setAddress(toManualAddress(a));
    setAddressId(a.id);
    setPrefilled(true);
  }

  /** The drawer's secondary action: typed address for this envelope only. */
  function applyTypedAddress(value: ManualAddressValue) {
    addressChosenRef.current = true;
    setAddress(value);
    setAddressId(null);
    setPrefilled(true);
  }

  /**
   * The drawer saved/edited/deleted a book row. An edit refreshes the address
   * being quoted; deleting it falls back default → next → none.
   */
  function handleAddressesChanged(rows: Address[]) {
    if (!addressId) return;
    const current = rows.find((a) => a.id === addressId);
    const next = current ?? rows.find((a) => a.isDefault) ?? rows[0] ?? null;
    if (next) {
      setAddress(toManualAddress(next));
      setAddressId(next.id);
    } else {
      setAddress(emptyManualAddress);
      setAddressId(null);
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
          {!addressBookLoaded && !hasDeliveryAddress ? (
            <p className="m-0 text-[12px] text-[var(--text-tertiary)]">
              Loading your address…
            </p>
          ) : (
            <DeliveryAddressSummary
              label={
                hasDeliveryAddress ? 'Delivery to' : 'Select Delivery Address'
              }
              address={hasDeliveryAddress ? addressLine : ''}
              incomplete={hasDeliveryAddress && addressIncomplete}
              changeLabel={hasDeliveryAddress ? 'Change' : 'Select'}
              buttonRef={addressTriggerRef}
              onChange={() => setAddressDialogOpen(true)}
            />
          )}

          {/* The address DRAWER. Every pick/add/edit/delete writes the same
              `address` state the debounced print quote below re-prices from. */}
          {addressDialogOpen && (
            <DeliveryAddressDialog
              returnFocusTo={addressTriggerRef.current}
              initialAddress={address}
              selectedAddressId={addressId}
              // The print quote never carried coordinates.
              requireCoords={false}
              getToken={token}
              onClose={() => setAddressDialogOpen(false)}
              onSelect={applySavedAddress}
              onUseOnce={applyTypedAddress}
              onAddressesChanged={handleAddressesChanged}
            />
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
