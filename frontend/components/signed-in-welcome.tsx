'use client';

import { useUser } from '@clerk/nextjs';
import Link from 'next/link';

// Rendered above the Featured grid on the bare landing page only.
// Signed-out users see the public Hero unchanged. Signed-in users
// get a small "Welcome back" strip with quick-links to their own
// surfaces — so they don't have to dig through the Account dropdown
// for the things they came back to do.
//
// Time-sensitive prompts (payment due, sale needs dispatch, etc.)
// live in the persistent Urgent Notifications strip below the nav —
// this component is just navigation shortcuts, not a feed.

export function SignedInWelcome() {
  const { user, isLoaded, isSignedIn } = useUser();
  if (!isLoaded || !isSignedIn) return null;

  const handle =
    user?.username ??
    (user?.firstName && user?.firstName.length > 0 ? user.firstName : null);

  return (
    <div
      style={{
        maxWidth: 1280,
        margin: '24px auto 0',
        padding: '14px 18px',
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
      }}
    >
      <p
        style={{
          color: 'var(--text-secondary)',
          fontSize: 14,
          margin: 0,
        }}
      >
        Welcome back
        {handle ? (
          <>
            ,{' '}
            <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
              {handle}
            </strong>
          </>
        ) : (
          ''
        )}
      </p>
      {/* xl:pr-24 keeps the last chip clear of the floating GG mascot dock
          (bottom-right) on short viewports where the strip sits behind it. */}
      <div className="xl:pr-24" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[
          { href: '/my/orders', label: 'My orders' },
          { href: '/my/sales', label: 'My sales' },
          { href: '/my/bids', label: 'My bids' },
          { href: '/my/offers', label: 'My offers' },
          { href: '/dashboard', label: 'Dashboard' },
        ].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            style={{
              fontSize: 12,
              padding: '5px 10px',
              borderRadius: 5,
              background: 'var(--bg-inset)',
              color: 'var(--text-secondary)',
              border: '0.5px solid var(--border)',
              textDecoration: 'none',
            }}
          >
            {l.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
