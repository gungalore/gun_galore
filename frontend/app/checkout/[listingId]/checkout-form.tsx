'use client';

import { useState, useEffect } from 'react';
import Script from 'next/script';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { Listing, FeeBreakdown, ShippingMethod } from '@/lib/types';
import { formatPrice } from '@/lib/utils';
import { LockerPicker, PudoLocker } from '@/components/locker-picker';
import { DealerPicker, Dealer } from '@/components/dealer-picker';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface CreateTxResponse {
  transactionId: string;
  peachCheckoutId: string;
  widgetScriptUrl: string;
  breakdown: FeeBreakdown;
}

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

function PriceRow({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="flex justify-between text-sm py-1">
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ color: highlight ? 'var(--red)' : 'var(--text-primary)', fontWeight: highlight ? 500 : 400 }}>
        {formatPrice(value)}
      </span>
    </div>
  );
}

export function CheckoutForm({ listing }: { listing: Listing }) {
  const { getToken } = useAuth();
  const router = useRouter();

  const [method, setMethod] = useState<ShippingMethod>(
    listing.isFirearm ? 'DEALER_TRANSFER' : 'PUDO',
  );
  const [selectedLocker, setSelectedLocker] = useState<PudoLocker | null>(null);
  const [selectedDealer, setSelectedDealer] = useState<Dealer | null>(null);
  const [tcgAddress, setTcgAddress] = useState({
    streetAddress: '',
    suburb: '',
    city: '',
    province: listing.province,
    postalCode: '',
    contactName: '',
    contactPhone: '',
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<CreateTxResponse | null>(null);

  // Lock method to DEALER_TRANSFER for firearms — enforced server-side too
  const allowedMethods: ShippingMethod[] = listing.isFirearm
    ? ['DEALER_TRANSFER']
    : ['PUDO', 'TCG'];

  function buildPayload() {
    const base = { listingId: listing.id, shippingMethod: method };
    if (method === 'PUDO') return { ...base, pudoPickupLockerId: selectedLocker?.lockerId };
    if (method === 'TCG') return { ...base, deliveryAddress: tcgAddress };
    if (method === 'DEALER_TRANSFER') return { ...base, dealerId: selectedDealer?.id };
    return base;
  }

  function isReady() {
    if (method === 'PUDO') return !!selectedLocker;
    if (method === 'TCG') {
      return !!(
        tcgAddress.streetAddress &&
        tcgAddress.suburb &&
        tcgAddress.city &&
        tcgAddress.postalCode &&
        tcgAddress.contactName &&
        tcgAddress.contactPhone
      );
    }
    if (method === 'DEALER_TRANSFER') return !!selectedDealer;
    return false;
  }

  async function handleProceed() {
    if (!isReady()) return;
    setSubmitting(true);
    setError(null);

    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(buildPayload()),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = Array.isArray(err.message) ? err.message.join(', ') : (err.message ?? `Error ${res.status}`);
        throw new Error(msg);
      }

      const data: CreateTxResponse = await res.json();
      setCheckout(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setSubmitting(false);
    }
  }

  // Once Peach widget script loads, it auto-renders into the form
  if (checkout) {
    const isMock = checkout.peachCheckoutId.startsWith('mock-');
    return (
      <div>
        <h2 className="text-base font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
          Complete payment
        </h2>

        {/* Price summary */}
        <div
          className="rounded-[6px] p-4 mb-6 text-sm"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        >
          <PriceRow label="Item price" value={checkout.breakdown.listingPrice} />
          {listing.passFeeToBuyer && (
            <PriceRow label="Processing fee" value={checkout.breakdown.processingFee} />
          )}
          <div
            className="my-2"
            style={{ borderTop: '0.5px solid var(--border-divider)' }}
          />
          <PriceRow label="Total charged" value={checkout.breakdown.buyerTotal} highlight />
        </div>

        {isMock ? (
          <div
            className="rounded-[8px] p-6 text-center text-sm"
            style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
          >
            <p className="mb-2" style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
              Test mode
            </p>
            <p>Peach Payments is not configured. Add credentials to your .env to enable live checkout.</p>
            <button
              onClick={() => router.push(`/transactions/${checkout.transactionId}`)}
              className="mt-4 px-4 py-2 rounded-[6px] text-sm"
              style={{ background: 'var(--red)', color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              View order (mock)
            </button>
          </div>
        ) : (
          <>
            <Script
              src={checkout.widgetScriptUrl}
              strategy="afterInteractive"
            />
            {/* Peach renders the card form into this element */}
            <form
              action={`${process.env.NEXT_PUBLIC_FRONTEND_URL ?? ''}/checkout/complete?transactionId=${checkout.transactionId}`}
              className="paymentWidgets"
              data-brands="VISA MASTER AMEX"
              style={{ marginTop: '8px' }}
            />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div
          className="px-4 py-3 rounded-[6px] text-sm"
          style={{ background: 'rgba(200,16,46,0.08)', border: '0.5px solid var(--red)', color: 'var(--red)' }}
        >
          {error}
        </div>
      )}

      {/* Shipping method */}
      {!listing.isFirearm && (
        <div>
          <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
            Delivery method
          </p>
          <div className="flex gap-2">
            {allowedMethods.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className="px-4 py-2 rounded-[6px] text-sm"
                style={{
                  background: method === m ? 'var(--red)' : 'var(--bg-inset)',
                  color: method === m ? '#fff' : 'var(--text-secondary)',
                  border: `0.5px solid ${method === m ? 'var(--red)' : 'var(--border)'}`,
                  cursor: 'pointer',
                }}
              >
                {m === 'PUDO' ? 'Pudo Locker' : 'Door Delivery (TCG)'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Pudo locker picker */}
      {method === 'PUDO' && (
        <div>
          <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
            Choose your collection locker
          </p>
          <LockerPicker
            onSelect={setSelectedLocker}
            selectedId={selectedLocker?.lockerId}
          />
        </div>
      )}

      {/* TCG door delivery address */}
      {method === 'TCG' && (
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Delivery address
          </p>
          <div className="grid grid-cols-1 gap-3">
            {(
              [
                ['streetAddress', 'Street address'],
                ['suburb', 'Suburb'],
                ['city', 'City'],
                ['postalCode', 'Postal code'],
                ['contactName', 'Full name'],
                ['contactPhone', 'Phone number'],
              ] as [keyof typeof tcgAddress, string][]
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  type="text"
                  required
                  value={tcgAddress[key]}
                  onChange={(e) => setTcgAddress((a) => ({ ...a, [key]: e.target.value }))}
                  style={inputStyle}
                />
              </Field>
            ))}
          </div>
        </div>
      )}

      {/* Dealer picker for firearms */}
      {method === 'DEALER_TRANSFER' && (
        <div>
          <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
            Select your receiving SAPS-licensed dealer
          </p>
          <DealerPicker
            province={listing.province}
            onSelect={setSelectedDealer}
            selectedId={selectedDealer?.id}
          />
        </div>
      )}

      {/* Proceed button */}
      <button
        type="button"
        onClick={handleProceed}
        disabled={submitting || !isReady()}
        className="w-full py-3 rounded-[6px] text-sm"
        style={{
          background: submitting || !isReady() ? 'var(--bg-inset)' : 'var(--red)',
          color: submitting || !isReady() ? 'var(--text-tertiary)' : '#fff',
          fontWeight: 500,
          cursor: submitting || !isReady() ? 'not-allowed' : 'pointer',
          border: 'none',
        }}
      >
        {submitting ? 'Setting up payment…' : `Pay ${formatPrice(listing.price)}`}
      </button>
    </div>
  );
}
