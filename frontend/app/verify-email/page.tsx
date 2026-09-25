import { Suspense } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { VerifyEmailForm } from './verify-email-form';

export const metadata = { title: 'Verify your email' };

export default function VerifyEmailPage() {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-6 px-4"
      style={{ background: 'var(--bg-deep)' }}
    >
      <Link href="/" aria-label="ALL Outdoor">
        <Logo height={44} priority />
      </Link>
      <Suspense fallback={null}>
        <VerifyEmailForm />
      </Suspense>
    </main>
  );
}
