'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

function CheckoutCompleteInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'verifying' | 'ok' | 'failed'>('verifying');

  useEffect(() => {
    const transactionId = searchParams.get('transactionId');
    const resourcePath = searchParams.get('resourcePath');

    if (!transactionId) {
      router.replace('/');
      return;
    }

    async function verify() {
      try {
        const res = await fetch(`${API_URL}/transactions/${transactionId}/verify-result`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resourcePath }),
        });

        if (res.ok) {
          setStatus('ok');
          setTimeout(() => router.replace(`/transactions/${transactionId}`), 1500);
        } else {
          setStatus('failed');
        }
      } catch {
        setStatus('failed');
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

      {status === 'failed' && (
        <>
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 text-xl"
            style={{ background: 'rgba(200,16,46,0.10)', color: 'var(--red)' }}
          >
            ✕
          </div>
          <p className="text-base font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
            Payment could not be verified
          </p>
          <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
            Your card was not charged. Please try again or contact support.
          </p>
          <button
            onClick={() => router.back()}
            className="px-5 py-2.5 rounded-[6px] text-sm"
            style={{ background: 'var(--red)', color: '#fff', border: 'none', cursor: 'pointer' }}
          >
            Try again
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
