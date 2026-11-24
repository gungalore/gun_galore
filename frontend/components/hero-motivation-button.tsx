'use client';

import Link from 'next/link';
import { useUser } from '@/lib/auth';

/**
 * The hero's second action — Motivation Creator.
 *
 * It is a CLIENT island only because the destination depends on the viewer:
 * a signed-in member goes straight to the application, a visitor goes to the
 * neutral public /motivation page first. Keeping the choice here means the
 * hero itself stays a server component.
 */
export function HeroMotivationButton() {
  const { isSignedIn } = useUser();
  const href = isSignedIn ? '/licence-centre/applications' : '/motivation';

  return (
    <Link
      href={href}
      className="hero-motivation gg-press inline-flex items-center justify-center text-sm"
      style={{
        // Secondary on the dark plate: a soft glass outline, never the accent
        // fill. Explore Gear stays the one primary CTA.
        height: 46,
        padding: '0 24px',
        borderRadius: 'var(--r-sm)',
        border: '1px solid rgba(255,255,255,0.34)',
        background: 'rgba(255,255,255,0.06)',
        color: '#fff',
        fontWeight: 600,
        textDecoration: 'none',
        letterSpacing: '0.01em',
        whiteSpace: 'nowrap',
      }}
    >
      Motivation Creator
    </Link>
  );
}
