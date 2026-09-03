import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ZOHO_ARMS,
  ZOHO_ARM_CAP,
  describeRadarTotal,
  fetchHeldFunds,
  fetchZohoFailed,
  fundsBuckets,
  missingSwapLegs,
  radarIsCapped,
  refundsBucketApplies,
  type HeldFunds,
  type ZohoFailed,
  type ZohoFailedSwap,
} from './desk-books';

// ────────────────────────────────────────────────────────────────────
// BOOKS — the client-money position and the failed-sync radar.
//
// Two endpoints on the manual-payments controller that had no caller. The
// Ledger could pay sellers and could not say what was owed in total, and a
// commission invoice that never reached Books was invisible unless somebody
// happened to open that exact sale.
//
// 🚨 EVERYTHING TESTED HERE IS A PLACE THE SCREEN WOULD OTHERWISE LIE:
// a bucket that was never measured rendering as R0.00, a floor rendering as a
// total, and three lists presented as if all three could be worked.
// ────────────────────────────────────────────────────────────────────

function bucket(count = 0, cents = 0) {
  return { count, cents };
}

function funds(over: Partial<HeldFunds> = {}): HeldFunds {
  return {
    asOf: '2026-09-03T19:00:00.000Z',
    paymentMode: 'manual',
    heldAwaitingRelease: bucket(4, 100_00),
    owedToSellers: bucket(2, 80_00),
    owedToBuyerRefunds: bucket(1, 20_00),
    swapCashHeld: bucket(0, 0),
    swapFundingInFlight: bucket(0, 0),
    totalClientFundsCents: 200_00,
    ...over,
  };
}

function radar(over: Partial<ZohoFailed> = {}): ZohoFailed {
  return { transactions: [], subscriptionCharges: [], swaps: [], totalFailed: 0, ...over };
}

describe('🚨 a bucket that was never measured is not a zero', () => {
  it('the refunds bucket applies only in manual mode', () => {
    // The service SKIPS the query entirely otherwise — a card gateway reverses
    // on the card, so nothing is owed out of our account. A zero here would be
    // a measured-looking figure that was never measured.
    expect(refundsBucketApplies('manual')).toBe(true);
    expect(refundsBucketApplies('paygate')).toBe(false);
    expect(refundsBucketApplies('')).toBe(false);
  });

  it('says WHY it does not apply, naming the mode', () => {
    const note = fundsBuckets(funds({ paymentMode: 'paygate' })).find((b) => b.key === 'refunds')
      ?.note;
    expect(note).toContain('paygate');
    expect(note).toContain('Not applicable');
  });

  it('describes it as a real figure when it does apply', () => {
    const note = fundsBuckets(funds({ paymentMode: 'manual' })).find((b) => b.key === 'refunds')
      ?.note;
    expect(note).not.toContain('Not applicable');
  });

  it('offers all five buckets, in reading order', () => {
    expect(fundsBuckets(funds()).map((b) => b.key)).toEqual([
      'held',
      'sellers',
      'refunds',
      'swapCash',
      'swapFunding',
    ]);
  });
});

describe('🚨 the radar total is a floor, not a total', () => {
  it('each arm is capped at 50 server-side', () => {
    expect(ZOHO_ARM_CAP).toBe(50);
  });

  it('detects a capped arm', () => {
    const full = Array.from({ length: 50 }, (_, i) => ({
      id: `t${i}`,
      orderReference: null,
      zohoSyncError: null,
      zohoSyncLastAttemptAt: null,
    }));
    expect(radarIsCapped(radar({ transactions: full, totalFailed: 50 }))).toBe(true);
    expect(radarIsCapped(radar({ transactions: full.slice(0, 49), totalFailed: 49 }))).toBe(false);
  });

  it('says "at least" when capped — 50 failures and 500 both report 50', () => {
    const full = Array.from({ length: 50 }, (_, i) => ({
      id: `t${i}`,
      orderReference: null,
      zohoSyncError: null,
      zohoSyncLastAttemptAt: null,
    }));
    const text = describeRadarTotal(radar({ transactions: full, totalFailed: 50 }));
    expect(text).toContain('At least');
    expect(text).toContain('higher');
  });

  it('states a plain number when nothing is capped', () => {
    const text = describeRadarTotal(radar({ totalFailed: 3 }));
    expect(text).toContain('3 records');
    expect(text).not.toContain('At least');
  });

  it('says nothing has failed rather than printing a zero', () => {
    expect(describeRadarTotal(radar())).toContain('Nothing has failed');
  });
});

describe('🚨 the three arms are not the same kind of thing', () => {
  it('only the sales arm can be retried', () => {
    // zoho-books.service.ts actively writes zohoSyncStatus OK/PENDING/FAILED/
    // SKIPPED, and POST /admin/transactions/:id/zoho-retry is idempotent and
    // wired into the Order drawer.
    expect(ZOHO_ARMS.transactions.kind).toBe('actionable');
    expect(ZOHO_ARMS.transactions.guidance).toMatch(/retry/i);
  });

  it('the subscription arm needs Zoho by hand, and says so', () => {
    // It keys on `zohoReceiptId IS NULL`, and NOTHING in the backend writes
    // zohoReceiptId — so a row cannot clear by any code path that exists.
    expect(ZOHO_ARMS.subscriptionCharges.kind).toBe('manual-only');
    expect(ZOHO_ARMS.subscriptionCharges.guidance).toMatch(/zohoReceiptId/);
  });

  it('the swap arm says the cron its own service comment promises does not exist', () => {
    // ⚠️ THE FIND THAT MATTERS MOST HERE. The service comment says these are
    // "re-fired by the hourly retryMissingSwapFeeReceipts cron". Grep finds
    // that name in that one comment and nowhere else in the repo, and nothing
    // writes the two receipt-id columns either — so a row here is permanent,
    // and the comment would have an operator wait for a repair that never runs.
    expect(ZOHO_ARMS.swaps.kind).toBe('stuck');
    expect(ZOHO_ARMS.swaps.guidance).toMatch(/does not exist/);
    expect(ZOHO_ARMS.swaps.guidance).toMatch(/will not clear|not clear on its own/);
  });

  it('every arm says what to do about a row in it', () => {
    for (const meta of Object.values(ZOHO_ARMS)) {
      expect(meta.guidance.length).toBeGreaterThan(30);
    }
  });
});

describe('which swap leg is missing its receipt', () => {
  function swap(over: Partial<ZohoFailedSwap> = {}): ZohoFailedSwap {
    return {
      id: 's1',
      initiatorFundingRef: null,
      swapFeeInitiator: 0,
      zohoInitiatorFeeReceiptId: null,
      swapFeeOwner: 0,
      zohoOwnerFeeReceiptId: null,
      completedAt: null,
      ...over,
    };
  }

  it('a zero fee is not a missing receipt', () => {
    // The query's own condition is fee > 0 AND receipt IS NULL. A leg that was
    // never charged has nothing to receipt, and naming it would send an
    // operator looking for a document that should not exist.
    expect(missingSwapLegs(swap())).toEqual([]);
  });

  it('names only the legs that were charged and have no receipt', () => {
    expect(missingSwapLegs(swap({ swapFeeInitiator: 500 }))).toEqual(['initiator']);
    expect(missingSwapLegs(swap({ swapFeeOwner: 500 }))).toEqual(['owner']);
    expect(missingSwapLegs(swap({ swapFeeInitiator: 500, swapFeeOwner: 500 }))).toEqual([
      'initiator',
      'owner',
    ]);
  });

  it('a leg with a receipt is not listed', () => {
    expect(
      missingSwapLegs(swap({ swapFeeInitiator: 500, zohoInitiatorFeeReceiptId: 'rec_1' })),
    ).toEqual([]);
  });
});

describe('the requests', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub(payload: unknown) {
    const spy = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify(payload),
    }));
    vi.stubGlobal('fetch', spy);
    return spy;
  }

  it('reads held funds from the manual-payments controller', async () => {
    const spy = stub(funds());
    await fetchHeldFunds();
    expect(String(spy.mock.calls[0][0])).toMatch(/\/admin\/manual-payments\/held-funds$/);
  });

  it('reads the radar from the manual-payments controller', async () => {
    const spy = stub(radar());
    await fetchZohoFailed();
    expect(String(spy.mock.calls[0][0])).toMatch(/\/admin\/manual-payments\/zoho-failed$/);
  });
});
