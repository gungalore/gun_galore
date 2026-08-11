'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';

// Root-level error boundary — catches anything an inner page or its
// data fetch throws that Next can't otherwise handle. Must be a
// client component because error boundaries are inherently runtime
// behaviour.
//
// Sentry would normally hook here in production; for now we just log
// to the console so a dev can see the stack. The `reset()` callback
// re-renders the failing tree — useful for transient network blips.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[error.tsx]', error);
  }, [error]);

  return (
    <main
      style={{
        minHeight: 'calc(100vh - 91px)',
        background: 'var(--bg-deep)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 480, textAlign: 'center' }}>
        <Image
          src="/logo.svg"
          alt="All Outdoor"
          width={200}
          height={40}
          priority
          style={{ height: 40, width: 'auto', margin: '0 auto 32px' }}
        />
        <p
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--red)',
            fontWeight: 600,
            marginBottom: 8,
          }}
        >
          Something broke
        </p>
        <h1
          style={{
            fontSize: 22,
            color: 'var(--text-primary)',
            fontWeight: 500,
            marginBottom: 12,
            letterSpacing: '-0.01em',
          }}
        >
          We hit an unexpected error
        </h1>
        <p
          style={{
            fontSize: 14,
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
            marginBottom: 24,
          }}
        >
          Something on our side went wrong. Try the action again — if
          it keeps failing, head back to the homepage and let us know
          via support.
        </p>
        {error.digest && (
          <p
            style={{
              fontSize: 11,
              color: 'var(--text-tertiary)',
              fontFamily: 'monospace',
              marginBottom: 24,
            }}
          >
            Error ID: {error.digest}
          </p>
        )}
        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={() => reset()}
            style={{
              background: 'var(--red)',
              color: '#fff',
              padding: '10px 20px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          <Link
            href="/"
            style={{
              background: 'var(--bg-card)',
              color: 'var(--text-secondary)',
              padding: '10px 20px',
              borderRadius: 6,
              fontSize: 13,
              border: '0.5px solid var(--border)',
              textDecoration: 'none',
            }}
          >
            Back home
          </Link>
        </div>
      </div>
    </main>
  );
}
