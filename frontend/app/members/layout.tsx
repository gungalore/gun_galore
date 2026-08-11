// Layout for the members-only document area (/members/*).
//
// Mirrors the (legal) layout's document typography so the Regulated Items
// Annex reads exactly like the public policies it is referenced from — it is
// the same class of document, it simply isn't public.
//
// `/members/` is sign-in gated in middleware (absent from isPublicRoute) and
// Disallow'd in robots.txt, so a signed-out visitor or crawler is redirected
// to /sign-in and never renders this.

import Link from 'next/link';
import type { Metadata } from 'next';
import { BRAND_NAME } from '@/lib/brand';

export const metadata: Metadata = {
  // Belt and braces alongside the middleware gate + robots Disallow: if a URL
  // in here is ever reached by something that indexes, say no explicitly.
  robots: { index: false, follow: false },
};

export default function MembersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="max-w-[760px] mx-auto px-4 py-10">
      <Link
        href="/"
        className="text-xs inline-block mb-6"
        style={{ color: 'var(--text-tertiary)', textDecoration: 'none' }}
      >
        ← Back to {BRAND_NAME}
      </Link>
      <p
        className="text-xs mb-6 px-3 py-2 rounded-[6px]"
        style={{
          color: 'var(--text-secondary)',
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
        }}
      >
        Members&rsquo; document. These terms apply to registered members
        dealing in regulated categories, and form part of the Terms of Service.
      </p>
      <article
        className="prose prose-invert"
        style={{ color: 'var(--text-primary)', lineHeight: 1.7 }}
      >
        {children}
      </article>
    </main>
  );
}
