'use client';

import type { PublicVerification } from '@/lib/community-api';

/**
 * Compact, boolean-only trust ticks shown next to a public username. The API
 * never sends the underlying email, phone or KYC document - only these three
 * yes/no values.
 */
export function VerificationBadges({
  verification,
  size = 'sm',
}: {
  verification?: PublicVerification | null;
  size?: 'sm' | 'md';
}) {
  if (!verification) return null;

  const items = [
    {
      key: 'id',
      label: 'ID',
      title: 'ID verified',
      show: verification.idVerified,
      icon: (
        <>
          <rect x="1.5" y="3" width="11" height="8" rx="1.4" />
          <circle cx="4.8" cy="6.4" r="1.4" />
          <path d="M2.8 9.4c.5-1.2 1.3-1.8 2.2-1.8s1.7.6 2.2 1.8M8 6h3.2M8 8h2.2" />
        </>
      ),
    },
    {
      key: 'phone',
      label: 'Phone',
      title: 'Phone verified',
      show: verification.phoneVerified,
      icon: (
        <path d="M4.2 2.2h3.2l.8 2.7-1.7 1a7.4 7.4 0 0 0 2.4 2.4l1-1.7 2.7.8v3.2c0 .7-.6 1.2-1.3 1.2A10.8 10.8 0 0 1 3 3.5c0-.7.5-1.3 1.2-1.3Z" />
      ),
    },
    {
      key: 'email',
      label: 'Email',
      title: 'Email verified',
      show: verification.emailVerified,
      icon: (
        <>
          <rect x="1.5" y="3" width="11" height="8" rx="1.2" />
          <path d="m2.2 4 4.8 4 4.8-4" />
        </>
      ),
    },
  ].filter((item) => item.show);

  if (items.length === 0) return null;

  const md = size === 'md';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        marginLeft: 6,
        verticalAlign: 'middle',
        flexWrap: 'wrap',
      }}
    >
      {items.map((item) => (
        <span
          key={item.key}
          title={item.title}
          aria-label={item.title}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            padding: md ? '1px 5px' : '0 4px',
            borderRadius: 3,
            color: 'var(--success)',
            background: 'rgba(34,197,94,0.08)',
            border: '0.5px solid rgba(34,197,94,0.35)',
            fontSize: md ? 10.5 : 9,
            fontWeight: 600,
            lineHeight: 1.4,
            letterSpacing: '0.01em',
            whiteSpace: 'nowrap',
          }}
        >
          <svg
            width={md ? 11 : 10}
            height={md ? 11 : 10}
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            {item.icon}
          </svg>
          {item.label}
        </span>
      ))}
    </span>
  );
}
