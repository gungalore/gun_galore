// UX-1d / UX-1e — point-of-decision trust bullets.
//
// Reused under the PDP CTA (UX-1d) and under the cart summary CTA (UX-1e) so
// the reassurance copy lives in exactly one place. Copy is verbatim from the
// parity report and house-rule-safe: NEVER the word "escrow" — always
// "payment held" (regulated SA term; see feedback memory no-escrow-term).
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
    'Payment held until you confirm delivery',
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
              href="/firearms-compliance"
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
