// UX-1d / UX-1e — point-of-decision trust bullets.
//
// Reused under the PDP CTA (UX-1d) and under the cart summary CTA (UX-1e) so
// the reassurance copy lives in exactly one place. House rules: NEVER the
// word "escrow", and never "we hold your payment" — we present as a store,
// so trust copy describes WHEN THE SELLER IS PAID, not where the buyer's
// money sits (see feedback memory no-escrow-term).
//
// Pure presentational component (no hooks / no client-only APIs) so it works
// inside both a server component (PDP) and a client component (cart).

import Link from 'next/link';

export function TrustBullets({
  isFirearm = false,
  className,
}: {
  /** Adds the firearm-specific dealer-transfer bullet (PDP firearm / carts
   *  that contain a firearm). */
  isFirearm?: boolean;
  className?: string;
}) {
  const bullets = [
    'Sellers are only paid once you confirm delivery',
    'Auto-refunded if the seller does not ship in time',
    "Sellers ID-verified before they're paid",
    'Dispute protection on every order',
  ];

  return (
    <div className={className}>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
        {bullets.map((text) => (
          <li key={text} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span aria-hidden style={{ color: 'var(--red)', flexShrink: 0, marginTop: 1 }}>
              ✓
            </span>
            <span style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5 }}>
              {text}
            </span>
          </li>
        ))}
        {isFirearm && (
          <li style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span aria-hidden style={{ color: 'var(--red)', flexShrink: 0, marginTop: 1 }}>
              ✓
            </span>
            <Link
              href="/members/regulated-items"
              style={{
                color: 'var(--text-secondary)',
                fontSize: 13,
                lineHeight: 1.5,
                textDecoration: 'none',
              }}
            >
              Legal dealer transfer handled on-platform
            </Link>
          </li>
        )}
      </ul>
      <Link
        href="/faq"
        style={{
          display: 'inline-block',
          marginTop: 8,
          color: 'var(--text-tertiary)',
          fontSize: 12,
          textDecoration: 'underline',
        }}
      >
        How payment protection works
      </Link>
    </div>
  );
}
