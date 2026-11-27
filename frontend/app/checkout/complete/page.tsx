'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SUPPORT_EMAIL } from '@/lib/brand';
import { removeFromCart } from '@/lib/cart-store';
import { useAuth } from '@/lib/auth';
import { getPendingOrder, clearPendingOrder } from '@/lib/pending-order';
import {
  destinationFor,
  orderCartListingIds,
  resolveVerifyTarget,
  verifyPaymentResult,
  type VerifyResult,
  type VerifyTarget,
} from '@/lib/order-verify';
import { CheckoutProgress } from '@/components/checkout-progress';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
const PENDING_BUY_NOW_KEY = 'gg:buyNowListing';
const PENDING_TX_KEY = 'gg:pendingTx';

// A single verify-result call that comes back { success: false } is NOT proof
// the buyer wasn't charged — capture can land on the webhook seconds after the
// browser redirect returns. So we poll a few times before painting a failure
// screen: a buyer who sees "not completed" on a card that DID go through is a
// buyer who pays twice.
const MAX_AUTO_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;

function CheckoutCompleteInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { getToken } = useAuth();
  // 'declined' = gateway said the payment did not succeed (card not charged).
  // 'error'    = we couldn't verify (network / unexpected) — unknown state,
  //              so we must NOT claim the card wasn't charged.
  const [status, setStatus] = useState<
    'verifying' | 'ok' | 'declined' | 'error'
  >('verifying');
  // Which auto-poll pass we're on. Drives the "still confirming" sub-copy so a
  // 10-15s wait reads as work-in-progress rather than a hung spinner.
  const [attempt, setAttempt] = useState(1);
  // Manual "Check again" in flight.
  const [rechecking, setRechecking] = useState(false);
  // When a manual re-check comes back unchanged the screen looks identical to
  // before the tap, which reads as a broken button. Stamp the time so we can
  // say "we did look".
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const settledRef = useRef(false);

  // The cart hand-off marker may be the only place the order id survives a
  // gateway round-trip. The transaction marker stays for the single-item rail.
  const target = useMemo<VerifyTarget | null>(() => {
    const fromQuery = {
      orderId: searchParams.get('orderId'),
      transactionId: searchParams.get('transactionId'),
    };
    if (typeof window === 'undefined') return resolveVerifyTarget(fromQuery);
    try {
      const marker = getPendingOrder();
      return resolveVerifyTarget({
        ...fromQuery,
        pendingOrderId: marker?.orderId ?? null,
        pendingTransactionId: localStorage.getItem(PENDING_TX_KEY),
      });
    } catch {
      return resolveVerifyTarget(fromQuery);
    }
  }, [searchParams]);

  /**
   * Remove the cart lines this order bought, then drop the marker.
   *
   * The marker carries the listing ids captured at checkout; if it is missing
   * them (an older tab), the order itself is read — authenticated, but a
   * failure here must not block the success screen, so it is best-effort.
   */
  const clearOrderCartLines = useCallback(
    async (orderId: string) => {
      const marker = getPendingOrder();
      let order: { lineItems?: Array<{ listingId?: string; listing?: { id?: string } | null }> } | null = null;
      if (!marker?.listingIds?.length) {
        try {
          const token = await getToken().catch(() => null);
          const res = await fetch(
            `${API_URL}/orders/${encodeURIComponent(orderId)}`,
            {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
              cache: 'no-store',
            },
          );
          if (res.ok) {
            order = (await res.json()) as {
              lineItems?: Array<{
                listingId?: string;
                listing?: { id?: string } | null;
              }>;
            };
          }
        } catch {
          /* best effort — the order page still shows the purchase */
        }
      }
      const listingIds = orderCartListingIds(order, marker?.listingIds);
      for (const listingId of listingIds) {
        try {
          removeFromCart(listingId);
        } catch {
          /* storage unavailable — the cart is best-effort */
        }
      }
      clearPendingOrder();
    },
    [getToken],
  );

  // One verify round-trip. Kept side-effect-light so both the auto-poll and the
  // manual re-check can share it.
  const verifyOnce = useCallback(
    async (what: VerifyTarget): Promise<VerifyResult> => {
      const result = await verifyPaymentResult(what, (path, init) =>
        fetch(`${API_URL}${path}`, init),
      );
      if (result === 'ok') {
        if (what.kind === 'order') {
          await clearOrderCartLines(what.id);
        } else {
          // Clear the pending marker — this transaction is settled.
          try {
            localStorage.removeItem(PENDING_TX_KEY);
          } catch {
            /* best effort */
          }
        }
      }
      return result;
    },
    [clearOrderCartLines],
  );

  const settle = useCallback(
    (result: VerifyResult, what: VerifyTarget) => {
      setStatus(result);
      if (result === 'ok') {
        if (what.kind === 'transaction') {
          // Buy Now remembered its line in /cart while the buyer was checking
          // out. The order is paid now, so drop that trace — leaving checkout
          // without paying keeps it.
          try {
            const paidListingId = localStorage.getItem(PENDING_BUY_NOW_KEY);
            if (paidListingId) {
              removeFromCart(paidListingId);
              localStorage.removeItem(PENDING_BUY_NOW_KEY);
            }
          } catch {
            /* storage unavailable — the cart is best-effort */
          }
        }
        if (settledRef.current) return;
        settledRef.current = true;
        const destination = destinationFor(what);
        setTimeout(() => router.replace(destination), 1500);
      }
    },
    [router],
  );

  // Manual re-check from the not-confirmed screen. Same call the auto-poll
  // makes — a webhook that lands while the buyer is reading the copy turns
  // this into a success without them paying again.
  const recheck = useCallback(async () => {
    if (!target || rechecking) return;
    setRechecking(true);
    const result = await verifyOnce(target);
    setRechecking(false);
    setLastCheckedAt(
      new Date().toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }),
    );
    settle(result, target);
  }, [target, rechecking, verifyOnce, settle]);

  useEffect(() => {
    if (!target) {
      // AUDIT M21 — DON'T bounce to "/" silently. A buyer who paid but came
      // back with no id (Safari private / partitioned localStorage, or storage
      // wiped between submit and return) would land on the homepage with no
      // way to find their order. Surface the error state instead — the order
      // is being settled by the reconcile cron and appears under My Orders.
      setStatus('error');
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function run(pass: number) {
      if (cancelled || !target) return;
      setAttempt(pass);
      const result = await verifyOnce(target);
      if (cancelled) return;
      // Only "declined" is worth waiting on — an unsettled async payment is
      // exactly the case that flips to success a few seconds later. A hard
      // error is an unknown state we surface immediately.
      if (result === 'declined' && pass < MAX_AUTO_ATTEMPTS) {
        timer = setTimeout(() => void run(pass + 1), RETRY_DELAY_MS);
        return;
      }
      settle(result, target);
    }

    void run(1);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [target, verifyOnce, settle]);

  const viewHref =
    target?.kind === 'order' ? destinationFor(target) : '/my/orders';
  const viewLabel = target?.kind === 'order' ? 'View order' : 'View my orders';

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
            style={{ background: 'rgba(0,160,60,0.12)', color: 'var(--success)' }}
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
            style={{ background: 'var(--red-wash)', color: 'var(--action-secondary-ink)' }}
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
            the cart. If you completed payment, it may take a moment to
            reflect — check again below before paying a second time.
          </p>
          <div className="flex gap-2 justify-center">
            <button
              onClick={recheck}
              disabled={rechecking || !target}
              aria-busy={rechecking}
              className="px-5 py-2.5 rounded-[6px] text-sm"
              style={{
                background: rechecking ? 'var(--bg-inset)' : 'var(--action-primary-bg)',
                color: rechecking ? 'var(--text-tertiary)' : '#fff',
                border: 'none',
                fontWeight: 500,
                cursor: rechecking ? 'not-allowed' : 'pointer',
              }}
            >
              {rechecking ? 'Checking…' : 'Check again'}
            </button>
            <button
              onClick={() => router.replace(viewHref)}
              className="px-5 py-2.5 rounded-[6px] text-sm"
              style={{
                background: 'var(--bg-inset)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-visible)',
                cursor: 'pointer',
              }}
            >
              {viewLabel}
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
            style={{ background: 'var(--warning-wash)', color: 'var(--warning)' }}
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
            onClick={() => router.replace(viewHref)}
            className="px-5 py-2.5 rounded-[6px] text-sm"
            style={{ background: 'var(--action-primary-bg)', color: '#fff', border: 'none', cursor: 'pointer' }}
          >
            {viewLabel}
          </button>
        </>
      )}
    </>
  );
}

export default function CheckoutCompletePage() {
  return (
    <main className="max-w-[400px] mx-auto px-4 py-20 text-center">
      {/* Step 2 of 2. The gateway's hosted payment page sits BETWEEN these two
          steps and is not ours to render — so the progress rail never invents
          a local payment step. */}
      <CheckoutProgress current={2} />
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
