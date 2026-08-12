'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SUPPORT_EMAIL } from '@/lib/brand';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// A single verify-result call that comes back { success: false } is NOT proof
// the buyer wasn't charged — capture can land on the webhook seconds after the
// browser redirect returns. So we poll a few times before painting a failure
// screen: a buyer who sees "not completed" on a card that DID go through is a
// buyer who pays twice.
const MAX_AUTO_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;

type VerifyResult = 'ok' | 'declined' | 'error';

function CheckoutCompleteInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 'declined' = gateway said the payment did not succeed (card not charged).
  // 'error'    = we couldn't verify (network / unexpected) — unknown state,
  //              so we must NOT claim the card wasn't charged.
  const [status, setStatus] = useState<
    'verifying' | 'ok' | 'declined' | 'error'
  >('verifying');
  // Which auto-poll pass we're on. Drives the "still confirming" sub-copy so a
  // 10-15s wait reads as work-in-progress rather than a hung spinner.
  const [attempt, setAttempt] = useState(1);
  // Manual "Check again" in flight (separate from the auto-poll so the button
  // can show its own busy label without re-rendering the whole spinner state).
  const [rechecking, setRechecking] = useState(false);
  // When a manual re-check comes back unchanged the screen looks identical to
  // before the tap, which reads as a broken button. Stamp the time so we can
  // say "we did look".
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);

  // Stitch returns the buyer to the registered base complete URL with
  // no id of its own, so we read the txId from the query param if
  // present (legacy / explicit) and otherwise from the marker the
  // checkout form stashed in localStorage before the redirect.
  const txId = useMemo(() => {
    const fromQuery = searchParams.get('transactionId');
    if (fromQuery) return fromQuery;
    if (typeof window === 'undefined') return null;
    try {
      return localStorage.getItem('gg:pendingTx');
    } catch {
      return null;
    }
  }, [searchParams]);

  // One verify round-trip. Kept side-effect-light (only the settled-marker
  // clear) so both the auto-poll and the manual re-check can share it.
  const verifyOnce = useCallback(async (id: string): Promise<VerifyResult> => {
    try {
      const res = await fetch(`${API_URL}/transactions/${id}/verify-result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      // The endpoint returns 200 for BOTH success and a not-completed
      // payment ({ success: false }). Gate on the BODY flag, never on
      // res.ok — otherwise an unpaid order shows "Payment successful".
      const body = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        alreadyProcessed?: boolean;
      };
      if (res.ok && body.success === true) {
        // Clear the pending marker — this order is settled.
        try { localStorage.removeItem('gg:pendingTx'); } catch {}
        return 'ok';
      }
      // Not captured. Leave the marker so a refresh (or the button below)
      // re-checks — an async payment may still be settling.
      if (res.ok && body.success === false) return 'declined';
      return 'error';
    } catch {
      return 'error';
    }
  }, []);

  const settle = useCallback(
    (result: VerifyResult, id: string) => {
      setStatus(result);
      if (result === 'ok') {
        setTimeout(() => router.replace(`/transactions/${id}`), 1500);
      }
    },
    [router],
  );

  // Manual re-check from the not-confirmed screen. Same call the auto-poll
  // makes — a webhook that lands while the buyer is reading the copy turns
  // this into a success without them paying again.
  const recheck = useCallback(async () => {
    if (!txId || rechecking) return;
    setRechecking(true);
    const result = await verifyOnce(txId);
    setRechecking(false);
    setLastCheckedAt(
      new Date().toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }),
    );
    settle(result, txId);
  }, [txId, rechecking, verifyOnce, settle]);

  useEffect(() => {
    if (!txId) {
      // AUDIT M21 — DON'T bounce to "/" silently. A buyer who paid via
      // Stitch but came back with no txId (Safari private / partitioned
      // localStorage, or storage wiped between submit and return)
      // would land on the homepage with no way to find their order.
      // Surface the error state instead — the order is being settled
      // by the (deferred) reconcile cron, and the buyer can find it
      // under My Orders once it reconciles.
      setStatus('error');
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function run(pass: number) {
      if (cancelled || !txId) return;
      setAttempt(pass);
      const result = await verifyOnce(txId);
      if (cancelled) return;
      // Only "declined" is worth waiting on — an unsettled async payment is
      // exactly the case that flips to success a few seconds later. A hard
      // error is an unknown state we surface immediately (its copy already
      // tells the buyer not to pay again).
      if (result === 'declined' && pass < MAX_AUTO_ATTEMPTS) {
        timer = setTimeout(() => void run(pass + 1), RETRY_DELAY_MS);
        return;
      }
      settle(result, txId);
    }

    void run(1);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [txId, verifyOnce, settle]);

  return (
    <>
      {status === 'verifying' && (
        <>
          <div
            className="w-10 h-10 rounded-full border-2 border-t-transparent mx-auto mb-4 animate-spin"
            style={{ borderColor: 'var(--red)', borderTopColor: 'transparent' }}
          />
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
            {attempt > 1 ? 'Still confirming your payment…' : 'Verifying payment…'}
          </p>
          {attempt > 1 && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Some payments take a few seconds to settle. Don&apos;t close this
              page or pay again — we&apos;re checking with the bank.
            </p>
          )}
        </>
      )}

      {status === 'ok' && (
        <>
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 text-xl"
            style={{ background: 'rgba(0,160,60,0.12)', color: '#00a03c' }}
          >
            ✓
          </div>
          <p className="text-base font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
            Payment successful
          </p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Redirecting to your order…
          </p>
        </>
      )}

      {status === 'declined' && (
        <>
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 text-xl"
            style={{ background: 'rgba(200,16,46,0.10)', color: 'var(--red)' }}
          >
            ✕
          </div>
          {/* "not COMPLETED" asserted more than the endpoint knows: it only
              told us the payment isn't confirmed *yet*. The headline now
              matches that uncertainty, and the button below lets the buyer
              re-ask instead of leaving them on a terminal screen. */}
          <p className="text-base font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
            Payment not confirmed
          </p>
          <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
            Your payment isn&apos;t confirmed yet, so your order isn&apos;t
            complete. If you cancelled, you can start the checkout again from
            the listing. If you completed payment, it may take a moment to
            reflect — check again below before paying a second time.
          </p>
          <div className="flex gap-2 justify-center">
            <button
              onClick={recheck}
              disabled={rechecking || !txId}
              aria-busy={rechecking}
              className="px-5 py-2.5 rounded-[6px] text-sm"
              style={{
                background: rechecking ? 'var(--bg-inset)' : 'var(--red)',
                color: rechecking ? 'var(--text-tertiary)' : '#fff',
                border: 'none',
                fontWeight: 500,
                cursor: rechecking ? 'not-allowed' : 'pointer',
              }}
            >
              {rechecking ? 'Checking…' : 'Check again'}
            </button>
            <button
              onClick={() => router.replace('/my/orders')}
              className="px-5 py-2.5 rounded-[6px] text-sm"
              style={{
                background: 'var(--bg-inset)',
                color: 'var(--text-primary)',
                border: '0.5px solid var(--border)',
                cursor: 'pointer',
              }}
            >
              View my orders
            </button>
          </div>
          {lastCheckedAt && (
            <p
              className="text-xs mt-3"
              style={{ color: 'var(--text-tertiary)' }}
              aria-live="polite"
            >
              Checked at {lastCheckedAt} — still not confirmed. If your bank
              shows a charge, email {SUPPORT_EMAIL} before paying again.
            </p>
          )}
        </>
      )}

      {status === 'error' && (
        <>
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 text-xl"
            style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}
          >
            !
          </div>
          <p className="text-base font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
            We couldn&apos;t confirm your payment
          </p>
          <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
            We weren&apos;t able to verify the result. Check your order page
            in a minute to see its status — if it hasn&apos;t updated, contact
            {SUPPORT_EMAIL} before paying again so you aren&apos;t
            charged twice.
          </p>
          <button
            onClick={() => router.replace('/my/orders')}
            className="px-5 py-2.5 rounded-[6px] text-sm"
            style={{ background: 'var(--red)', color: '#fff', border: 'none', cursor: 'pointer' }}
          >
            View my orders
          </button>
        </>
      )}
    </>
  );
}

export default function CheckoutCompletePage() {
  return (
    <main className="max-w-[400px] mx-auto px-4 py-20 text-center">
      <Suspense
        fallback={
          <div
            className="w-10 h-10 rounded-full border-2 border-t-transparent mx-auto animate-spin"
            style={{ borderColor: 'var(--red)', borderTopColor: 'transparent' }}
          />
        }
      >
        <CheckoutCompleteInner />
      </Suspense>
    </main>
  );
}
