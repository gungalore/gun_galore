'use client';

import { useEffect, useState } from 'react';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export type PaymentProvider = 'OZOW' | 'PEACH';

export interface PaymentMethodOption {
  provider: PaymentProvider;
  label: string;
  description: string;
}

/**
 * The pay-in rails the backend has actually enabled, read once per checkout.
 *
 * ⚠️ THERE IS NO LOCAL FALLBACK RAIL. This used to start on a hardcoded Ozow
 * option so "a failed fetch never hides the rail that is already live". That
 * promise is now wrong: the server can return Peach ONLY (or nothing at all
 * while a rail is being switched), and painting an EFT row the backend cannot
 * actually open would walk the buyer into a gateway failure after Pay. So the
 * resting state is empty + loading, and a failed fetch leaves it empty — the
 * checkout then says card payments are unavailable instead of inventing a
 * rail.
 *
 * After a successful fetch the current choice is kept while the server still
 * offers it; otherwise the first enabled method is selected. `provider` is
 * null while loading and whenever the server returns no method.
 */
export function usePaymentMethods() {
  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  const [provider, setProvider] = useState<PaymentProvider | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/transactions/payment-methods`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { methods?: PaymentMethodOption[] } | null) => {
        if (cancelled) return;
        const rows = Array.isArray(data?.methods) ? data.methods : [];
        setMethods(rows);
        setProvider((current) => {
          if (rows.length === 0) return null;
          if (
            current &&
            rows.some((method) => method.provider === current)
          ) {
            return current;
          }
          return rows[0].provider;
        });
      })
      // A failed read must not fall back to a fabricated rail. The host shows
      // the "temporarily unavailable" message and Pay stays disabled.
      .catch(() => {
        if (cancelled) return;
        setMethods([]);
        setProvider(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { methods, provider, setProvider, loading };
}
