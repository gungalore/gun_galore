'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

type ResumeResponse = {
  paid?: boolean;
  redirectUrl?: string;
  message?: string | string[];
};

export default function ResumeCheckoutPage() {
  const params = useParams<{ transactionId: string }>();
  const transactionId = params.transactionId;
  const router = useRouter();
  const { getToken } = useAuth();
  const [status, setStatus] = useState<'working' | 'error'>('working');
  const [message, setMessage] = useState('Checking your payment…');
  const startedRef = useRef(false);

  useEffect(() => {
    if (!transactionId || startedRef.current) return;
    startedRef.current = true;

    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(
          `${API_URL}/transactions/${encodeURIComponent(transactionId)}/resume`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          },
        );
        const data = (await res.json().catch(() => ({}))) as ResumeResponse;
        if (!res.ok) {
          const raw = data.message;
          throw new Error(
            Array.isArray(raw)
              ? raw.join(', ')
              : raw || `Could not resume payment (${res.status})`,
          );
        }
        if (data.paid) {
          router.replace(`/transactions/${transactionId}`);
          return;
        }
        if (data.redirectUrl) {
          window.location.href = data.redirectUrl;
          return;
        }
        throw new Error('The payment gateway did not return a payment link.');
      } catch (err) {
        setStatus('error');
        setMessage(
          err instanceof Error
            ? err.message
            : 'Could not resume this payment.',
        );
      }
    })();
  }, [getToken, router, transactionId]);

  return (
    <main className="max-w-[480px] mx-auto px-4 py-20 text-center">
      {status === 'working' ? (
        <>
          <div
            className="w-10 h-10 rounded-full border-2 border-t-transparent mx-auto mb-4 animate-spin"
            style={{ borderColor: 'var(--red)', borderTopColor: 'transparent' }}
          />
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
            {message}
          </p>
          <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
            Do not pay again while we check the existing attempt.
          </p>
        </>
      ) : (
        <>
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 text-xl"
            style={{ background: 'rgba(227,6,19,0.10)', color: 'var(--red)' }}
          >
            !
          </div>
          <p className="text-base font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
            We could not resume payment
          </p>
          <p
            className="text-sm mb-5"
            style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
          >
            {message}
          </p>
          <div className="flex gap-2 justify-center">
            <Link
              href="/my/orders"
              className="px-5 py-2.5 rounded-[6px] text-sm"
              style={{ background: 'var(--red)', color: '#fff', textDecoration: 'none' }}
            >
              View my orders
            </Link>
            <Link
              href="/"
              className="px-5 py-2.5 rounded-[6px] text-sm"
              style={{
                background: 'var(--bg-inset)',
                color: 'var(--text-primary)',
                border: '0.5px solid var(--border)',
                textDecoration: 'none',
              }}
            >
              Back to marketplace
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
