import { Suspense } from 'react';
import Link from 'next/link';
import { av } from '@/lib/asset-version';
import { ResetForm } from './reset-form';

export const metadata = { title: 'Choose a new password' };

export default function ResetPasswordPage() {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-6 px-4"
      style={{ background: 'var(--bg-deep)' }}
    >
      <Link href="/" aria-label="ALL Outdoor">
        <img
          src="/brand/logo-horizontal-dark-transparent.svg"
          alt="ALL Outdoor"
          style={{ height: 44, width: 'auto' }}
        />
      </Link>
      <Suspense fallback={null}>
        <ResetForm />
      </Suspense>
    </main>
  );
}
