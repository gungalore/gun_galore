import { Suspense } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { SignInForm } from './sign-in-form';

export const metadata = { title: 'Sign in' };

export default function SignInPage() {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-6 px-4"
      style={{ background: 'var(--bg-deep)' }}
    >
      <Link href="/" aria-label="ALL Outdoor">
        <Logo height={44} priority />
      </Link>
      {/* useSearchParams needs a Suspense boundary in the App Router. */}
      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
    </main>
  );
}
