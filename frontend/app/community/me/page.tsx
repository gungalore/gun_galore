import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { serverAuth } from '../../../lib/auth-server';
import { CommunityGate } from '../../../components/community/community-gate';
import { MyPostsClient } from '../../../components/community/my-posts-client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'My posts',
  robots: { index: false, follow: false },
};

export default async function MyCommunityPage() {
  const { userId } = await serverAuth();
  if (!userId) return <CommunityGate />;

  return (
    <main className="mx-auto px-4 py-6" style={{ maxWidth: 'var(--content-max)' }}>
      <Link
        href="/community"
        className="gg-press inline-block text-[13px] mb-4"
        style={{ color: 'var(--text-tertiary)' }}
      >
        ← Back to the feed
      </Link>
      <h1
        className="text-xl font-medium mb-1"
        style={{ color: 'var(--text-primary)' }}
      >
        My posts
      </h1>
      <p className="text-[13px] mb-5" style={{ color: 'var(--text-tertiary)' }}>
        Everything you&apos;ve posted — edit or delete anything here.
      </p>
      {/* useSearchParams (the ?edit= deep link) needs a Suspense boundary. */}
      <Suspense fallback={<p className="text-[14px]">Loading…</p>}>
        <MyPostsClient />
      </Suspense>
    </main>
  );
}
