'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

function CheckoutCompleteInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 'declined' = gateway said the payment did not succeed (card not charged).
  // 'error'    = we couldn't verify (network / unexpected) — unknown state,
  //              so we must NOT claim the card wasn't charged.
  const [status, setStatus] = useState<
    'verifying' | 'ok' | 'declined' | 'error'
  >('verifying');

  useEffect(() => {
    // Stitch returns the buyer to the registered base complete URL with
    // no id of its own, so we read the txId from the query param if
    // present (legacy / explicit) and otherwise from the marker the
    // checkout form stashed in localStorage before the redirect.
    let transactionId = searchParams.get('transactionId');
    if (!transactionId && typeof window !== 'undefined') {
      try {
        transactionId = localStorage.getItem('gg:pendingTx');
      } catch {
        transactionId = null;
      }
    }

    if (!transactionId) {
      router.replace('/');
      return;
    }
    const txId = transactionId;

    async function verify() {
      try {
        const res = await fetch(`${API_URL}/transactions/${txId}/verify-result`, {
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
          setStatus('ok');
          setTimeout(() => router.replace(`/transactions/${txId}`), 1500);
        } else if (res.ok && body.success === false) {
          // Not captured. Leave the marker so a refresh re-checks (an
          // async EFT may still be settling). Show the not-completed state.
          setStatus('declined');
        } else {
          setStatus('error');
        }
      } catch {
        setStatus('error');
      }
    }

    verify();
  }, [searchParams, router]);

  return (
    <>
      {status === 'verifying' && (
        <>
          <div
            className="w-10 h-10 rounded-full border-2 border-t-transparent mx-auto mb-4 animate-spin"
            style={{ borderColor: 'var(--red)', borderTopColor: 'transparent' }}
          />
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Verifying payment…
          </p>
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
          <p className="text-base font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
            Payment not completed
          </p>
          <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
            Your payment isn&apos;t confirmed yet, so your order isn&apos;t
            complete. If you cancelled, you can start the checkout again from
            the listing. If you just paid by instant EFT, it may take a
            moment — check your orders shortly.
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
            support@gungalore.co.za before paying again so you aren&apos;t
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
