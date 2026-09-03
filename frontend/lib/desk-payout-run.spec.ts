import { afterEach, describe, expect, it, vi } from 'vitest';
import { describePayoutRun, runDuePayouts, type PayoutRunResult } from './desk-ledger';

// ────────────────────────────────────────────────────────────────────
// THE ONE CALL THE DESK NEVER MADE.
//
// 🚨 The run preview, the segments, the hold and lift levers and the confirm
// dialog were all built and correct. The confirm's own handler closed itself
// and reported "not wired from the Desk yet", pointing at a handover note — so
// the Ledger could show an operator exactly what was owed, to whom, and why a
// row was held back, and could not pay any of it.
// ────────────────────────────────────────────────────────────────────

function result(over: Partial<PayoutRunResult> = {}): PayoutRunResult {
  return { attempted: 3, accepted: 3, failed: 0, totalCents: 1500_00, skipped: [], ...over };
}

describe('the disbursement call', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('POSTs to the payout run route with no body', async () => {
    const spy = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify(result()),
    }));
    vi.stubGlobal('fetch', spy);
    await runDuePayouts();
    expect(String(spy.mock.calls[0][0])).toMatch(/\/admin\/manual-payments\/run-payouts$/);
    expect(spy.mock.calls[0][1]?.method).toBe('POST');
  });
});

describe('🚨 what the operator is told afterwards', () => {
  it('says ACCEPTED, never "paid"', () => {
    // Peach accepts a batch and settles it asynchronously; the payout webhook
    // reconciles. "12 sellers paid" is a claim the platform cannot yet make,
    // and it is exactly the sentence an operator would repeat to a seller.
    const text = describePayoutRun(result());
    expect(text).toContain('accepted');
    expect(text).not.toMatch(/\bpaid\b/i);
    expect(text).toContain('not settled');
  });

  it('names the failures and says they stay due', () => {
    const text = describePayoutRun(result({ accepted: 2, failed: 1 }));
    expect(text).toContain('1 were refused');
    expect(text).toContain('stay due');
  });

  it('does not claim a run happened when nothing was due', () => {
    expect(describePayoutRun(result({ attempted: 0, accepted: 0, totalCents: 0 }))).toContain(
      'Nothing was due',
    );
  });

  it('reports skipped rows rather than silently dropping them', () => {
    const text = describePayoutRun(result({ skipped: [{ id: 't1', reason: 'no bank' }] }));
    expect(text).toContain('1 skipped');
  });

  it('states the money that actually moved', () => {
    expect(describePayoutRun(result({ totalCents: 1500_00 })).replace(/\s/g, ' ')).toContain('1 500');
  });
});
