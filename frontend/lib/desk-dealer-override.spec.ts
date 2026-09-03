import { afterEach, describe, expect, it, vi } from 'vitest';
import { overrideDealerVerification, retryZohoPost, zohoNeedsAttention } from './desk-order';

// ────────────────────────────────────────────────────────────────────
// THE TWO LEVERS THAT HAD A LIVE ENDPOINT AND NO CALLER.
//
// 🚨 A FIREARM PAYOUT CANNOT BE RELEASED WITHOUT THE FIRST ONE.
// releaseTransaction refuses any isFirearm + DEALER_TRANSFER sale whose
// dealerVerificationStatus is not APPROVED, and that verdict is a model
// reading three uploaded photos. When it says no and it is wrong, the
// override is the only path to paying the seller — and nothing in this
// frontend called it, so the money simply stopped with no control on any
// screen to explain why.
//
// The second is quieter and worse in its own way: a failed Zoho Books
// commission post rendered nowhere at all, so money leaving the platform
// without an invoice behind it looked exactly like a healthy sale.
// ────────────────────────────────────────────────────────────────────

function stub() {
  const spy = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => '{}',
  }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

describe('the dealer stock-in override', () => {
  it('posts the decision and the reason the server records', async () => {
    const spy = stub();
    await overrideDealerVerification('tx_1', 'APPROVE', 'Serial matches the 534 by eye');

    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toMatch(/\/admin\/transactions\/tx_1\/dealer-verification\/override$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      decision: 'APPROVE',
      reason: 'Serial matches the 534 by eye',
    });
  });

  it('sends REJECT down the same route rather than a second endpoint', async () => {
    const spy = stub();
    await overrideDealerVerification('tx_1', 'REJECT', 'Register page is for another firearm');
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body)).decision).toBe('REJECT');
  });

  it('encodes the id rather than pasting it into the path', async () => {
    const spy = stub();
    await overrideDealerVerification('tx/../1', 'APPROVE', 'reason enough');
    expect(String(spy.mock.calls[0][0])).toContain('tx%2F..%2F1');
  });
});

describe('the Zoho Books retry', () => {
  it('posts with no body — the server needs only the id', async () => {
    const spy = stub();
    await retryZohoPost('tx_1');

    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toMatch(/\/admin\/transactions\/tx_1\/zoho-retry$/);
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeUndefined();
  });
});

describe('🚨 which Books states are a human problem', () => {
  it('FAILED needs attention', () => {
    expect(zohoNeedsAttention('FAILED')).toBe(true);
    expect(zohoNeedsAttention('failed')).toBe(true);
  });

  it('null is NOT a failure', () => {
    // The trap. A sale that never needed a commission invoice — not yet
    // released, or refunded before release — has no sync status at all.
    // Treating absence as failure would put a red flag on most of the ledger
    // and teach the operator to ignore the flag on the sales that matter.
    expect(zohoNeedsAttention(null)).toBe(false);
  });

  it('a healthy or in-progress state is not a failure', () => {
    for (const ok of ['SYNCED', 'PENDING', 'PAID', '']) {
      expect(zohoNeedsAttention(ok), `${ok} should not alarm`).toBe(false);
    }
  });

  it('an unrecognised state is not guessed into a failure', () => {
    // If Books grows a status we have not seen, the honest move is to render
    // it as itself rather than decide it is broken.
    expect(zohoNeedsAttention('SOME_NEW_STATE')).toBe(false);
  });
});
