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

export const DEFAULT_PAYMENT_METHODS: PaymentMethodOption[] = [
  {
    provider: 'OZOW',
    label: 'Instant EFT',
    description: 'Pay securely from your bank account via Ozow.',
  },
];

/**
 * Fetch the enabled pay-in rails once per checkout page. Ozow is always
 * available; Peach appears only when the backend has it configured AND the
 * admin pay-in flag is on. The default is Ozow so a failed fetch never hides
 * the rail that is already live.
 */
export function usePaymentMethods() {
  const [methods, setMethods] =
    useState<PaymentMethodOption[]>(DEFAULT_PAYMENT_METHODS);
  const [provider, setProvider] = useState<PaymentProvider>('OZOW');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/transactions/payment-methods`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { methods?: PaymentMethodOption[] } | null) => {
        if (cancelled || !data?.methods?.length) return;
        setMethods(data.methods);
        // Keep the current selection if it is still offered; otherwise fall
        // back to the first enabled method.
        if (!data.methods.some((m) => m.provider === provider)) {
          setProvider(data.methods[0].provider);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // The selection is intentionally read once; changing it must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { methods, provider, setProvider, loading };
}
