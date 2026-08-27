import { SignIn } from '@clerk/nextjs';
import { av } from '@/lib/asset-version';
import Link from 'next/link';

export default function SignInPage() {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-6 px-4"
      style={{ background: 'var(--bg-deep)' }}
    >
      <Link href="/" aria-label="All Outdoor">
        <img src={av('/logo-nav-dark.svg')} alt="All Outdoor" style={{ height: 44, width: 'auto' }} />
      </Link>
      <SignIn
        signUpUrl="/sign-up"
        appearance={{ variables: { colorPrimary: '#C8102E', borderRadius: '6px' } }}
      />
    </main>
  );
}
