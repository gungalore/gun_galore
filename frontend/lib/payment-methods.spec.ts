// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePaymentMethods } from './payment-methods';

// Phase A0 — the backend can now return Peach ONLY (or nothing at all). The
// hook must never invent an Ozow rail: starting state is empty + loading, and
// a failed read leaves it empty so the checkout says "card payments are
// temporarily unavailable" instead of walking the buyer to a dead gateway.

const PEACH_ONLY = {
  methods: [
    {
      provider: 'PEACH',
      label: 'Credit & Debit Card',
      description: 'Pay securely by card.',
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(impl: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

describe('usePaymentMethods', () => {
  it('selects PEACH from a Peach-only response and ends loading', async () => {
    stubFetch(async () => new Response(JSON.stringify(PEACH_ONLY), { status: 200 }));

    const { result } = renderHook(() => usePaymentMethods());

    // Resting state: no methods, no provider, loading.
    expect(result.current.methods).toEqual([]);
    expect(result.current.provider).toBeNull();
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.methods).toHaveLength(1);
    expect(result.current.provider).toBe('PEACH');
  });

  it('leaves NO methods and NO Ozow fallback when the fetch fails', async () => {
    stubFetch(async () => {
      throw new Error('network down');
    });

    const { result } = renderHook(() => usePaymentMethods());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.methods).toEqual([]);
    expect(result.current.provider).toBeNull();
    expect(
      result.current.methods.some((method) => method.provider === 'OZOW'),
    ).toBe(false);
  });

  it('treats a non-OK response exactly like a failure (no fallback rail)', async () => {
    stubFetch(async () => new Response('nope', { status: 503 }));

    const { result } = renderHook(() => usePaymentMethods());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.methods).toEqual([]);
    expect(result.current.provider).toBeNull();
  });
});
