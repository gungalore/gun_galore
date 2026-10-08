import type { Metadata } from 'next';
import Link from 'next/link';
import { serverAuth } from '../../lib/auth-server';
import { BRAND_NAME } from '../../lib/brand';
import { ValuationFlow } from '../../components/valuation/valuation-flow';

// Viewer-varying (signed-in vs gate) and never shared-cached.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Value My Item',
  description: `Get an estimate of what your item is worth from live South African listings on ${BRAND_NAME}.`,
  robots: { index: false, follow: false },
};

export default async function ValuePage() {
  const { userId } = await serverAuth();

  return (
    <main className="mx-auto px-4 py-8" style={{ maxWidth: 'var(--content-max)' }}>
      {userId ? (
        <ValuationFlow />
      ) : (
        <div className="max-w-xl mx-auto text-center py-10">
          <span
            className="inline-block text-[12px] font-medium px-3 py-1 rounded-full mb-4"
            style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
          >
            Members only
          </span>
          <h1
            className="text-3xl"
            style={{ fontFamily: 'var(--font-display, inherit)', color: 'var(--text-primary)' }}
          >
            Value My Item
          </h1>
          <p className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Sign in to add photos and get an estimate of what your item is worth.
          </p>
          <Link
            href="/sign-in?redirect_url=/value"
            className="inline-block mt-5 rounded-[8px] px-5 py-2.5 text-sm font-semibold"
            style={{ background: 'var(--red)', color: '#fff', textDecoration: 'none' }}
          >
            Sign in
          </Link>
        </div>
      )}
    </main>
  );
}
