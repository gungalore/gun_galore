import Image from 'next/image';
import Link from 'next/link';

// Offline fallback — the service worker serves this page in place of a
// network error when the user is offline and the requested URL isn't
// already in the cache. Kept intentionally simple: no API calls, no
// Clerk, no dynamic content — just the brand + a try-again button.
//
// This page is also precached at install time so it's always
// available, even on the very first offline visit after install.

export const metadata = {
  title: 'Offline — Gun Galore',
};

export default function OfflinePage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--bg-deep)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 400, textAlign: 'center' }}>
        <Image
          src="/logo.svg"
          alt="Gun Galore"
          width={200}
          height={40}
          priority
          style={{ height: 40, width: 'auto', margin: '0 auto 32px' }}
        />
        <h1
          style={{
            fontSize: 22,
            color: 'var(--text-primary)',
            fontWeight: 500,
            marginBottom: 12,
            letterSpacing: '-0.01em',
          }}
        >
          You&apos;re offline
        </h1>
        <p
          style={{
            fontSize: 14,
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
            marginBottom: 28,
          }}
        >
          Gun Galore needs a network connection to show fresh listings,
          bids and prices. Check your Wi-Fi or mobile data and try
          again.
        </p>
        <Link
          href="/"
          style={{
            display: 'inline-block',
            background: 'var(--red)',
            color: '#fff',
            padding: '12px 28px',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
            textDecoration: 'none',
          }}
        >
          Try again →
        </Link>
        <p
          style={{
            fontSize: 11,
            color: 'var(--text-tertiary)',
            marginTop: 28,
            lineHeight: 1.5,
          }}
        >
          Tip: install Gun Galore to your home screen and core
          interface assets will be cached for faster repeat visits.
        </p>
      </div>
    </main>
  );
}
