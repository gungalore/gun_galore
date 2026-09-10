import { Suspense } from 'react';
import { av } from '@/lib/asset-version';
import Link from 'next/link';
import { SignInForm } from './sign-in-form';

export const metadata = { title: 'Sign in' };

export default function SignInPage() {
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
      {/* useSearchParams needs a Suspense boundary in the App Router. */}
      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
    </main>
  );
}
