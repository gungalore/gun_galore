import { Suspense } from 'react';
import Link from 'next/link';
import { av } from '@/lib/asset-version';
import { VerifyEmailForm } from './verify-email-form';

export const metadata = { title: 'Verify your email' };

export default function VerifyEmailPage() {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-6 px-4"
      style={{ background: 'var(--bg-deep)' }}
    >
      <Link href="/" aria-label="All Outdoor">
        <img
          src={av('/logo-nav-dark.svg')}
          alt="All Outdoor"
          style={{ height: 44, width: 'auto' }}
        />
      </Link>
      <Suspense fallback={null}>
        <VerifyEmailForm />
      </Suspense>
    </main>
  );
}
