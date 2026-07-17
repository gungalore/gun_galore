import Link from 'next/link';
import { Me } from '@/lib/types';

// Horizontal seller-setup progress bar — five segments matching the
// backend's seller completeness model (users.controller.ts
// computeCompleteness): contact, address, banking, identity, verification.
// Rendered on /profile (and above the KYC wizard). Server-safe: pure
// props, no hooks — pass `me` from a server component.
//
// UNDER_REVIEW renders the verification segment as done PLUS a "being
// reviewed" pill: nothing more is needed from the seller, but the state
// should be visible so the payout hold isn't a mystery.

const SECTIONS: {
  key: 'contact' | 'address' | 'banking' | 'identity' | 'verification';
  label: string;
  href: string;
  missingKeys: string[];
}[] = [
  { key: 'contact', label: 'Contact', href: '/profile/edit', missingKeys: ['name', 'phone'] },
  { key: 'address', label: 'Address', href: '/profile/edit', missingKeys: ['address'] },
  { key: 'banking', label: 'Banking', href: '/profile/edit', missingKeys: ['banking'] },
  { key: 'identity', label: 'ID details', href: '/kyc/verify', missingKeys: ['identity'] },
  { key: 'verification', label: 'Verification', href: '/kyc/verify', missingKeys: ['verification'] },
];

export function SellerVerificationProgress({ me }: { me: Me }) {
  const pc = me.profileCompleteness;
  // Only sellers get the 5-section shape; buyers keep the nav ring alone.
  if (!pc || pc.shape !== 'seller') return null;

  const underReview = me.kycStatus === 'UNDER_REVIEW';
  const allDone = pc.missing.length === 0;

  return (
    <section
      className="rounded-[8px] p-4 mb-6"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
      aria-label={`Seller setup ${pc.percent}% complete`}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <p
          className="text-xs uppercase"
          style={{
            color: 'var(--text-tertiary)',
            letterSpacing: '0.08em',
            fontWeight: 500,
            margin: 0,
          }}
        >
          Seller setup &mdash; {pc.percent}%
        </p>
        {underReview && (
          <span
            className="text-xs"
            style={{
              background: 'rgba(245,158,11,0.14)',
              color: '#f59e0b',
              border: '0.5px solid rgba(245,158,11,0.4)',
              borderRadius: 999,
              padding: '2px 10px',
              fontWeight: 500,
            }}
          >
            Verification being reviewed &mdash; nothing more needed from you
          </span>
        )}
        {allDone && !underReview && (
          <span className="text-xs" style={{ color: '#22c55e', fontWeight: 500 }}>
            All set &mdash; payouts enabled
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        {SECTIONS.map((s) => {
          const missing = s.missingKeys.some((k) =>
            (pc.missing as string[]).includes(k),
          );
          const done = !missing;
          return (
            <Link
              key={s.key}
              href={done ? '#' : s.href}
              aria-label={`${s.label}: ${done ? 'done' : 'to do'}`}
              style={{
                flex: 1,
                textDecoration: 'none',
                pointerEvents: done ? 'none' : undefined,
              }}
              tabIndex={done ? -1 : undefined}
            >
              <div
                style={{
                  height: 6,
                  borderRadius: 3,
                  background: done ? '#22c55e' : 'var(--bg-inset)',
                  border: done ? 'none' : '0.5px solid var(--border)',
                }}
              />
              <div
                className="text-xs mt-1"
                style={{
                  color: done ? 'var(--text-secondary)' : 'var(--red)',
                  fontWeight: done ? 400 : 500,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {s.label}
                {!done && ' →'}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
