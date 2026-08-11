// Shared layout for the legal pages (Terms, Privacy, AML Policy).
// Constrains width + applies consistent typography so the documents
// read like documents, not like marketing pages.
//
// The route group `(legal)` keeps these pages flat at /terms, /privacy,
// /aml-policy (no /legal/ prefix in the URL) but groups them under one
// layout so we don't repeat the wrapper styling.

import Link from 'next/link';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="max-w-[760px] mx-auto px-4 py-10">
      <Link
        href="/"
        className="text-xs inline-block mb-6"
        style={{ color: 'var(--text-tertiary)', textDecoration: 'none' }}
      >
        ← Back to All Outdoor
      </Link>
      <article
        className="prose prose-invert"
        style={{
          color: 'var(--text-primary)',
          lineHeight: 1.7,
        }}
      >
        {children}
      </article>
    </main>
  );
}
