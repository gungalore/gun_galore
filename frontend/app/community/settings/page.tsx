import type { Metadata } from 'next';
import Link from 'next/link';
import { serverAuth } from '../../../lib/auth-server';
import { CommunityGate } from '../../../components/community/community-gate';
import { FeedPreferencesClient } from '../../../components/community/feed-preferences-client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Feed preferences',
  robots: { index: false, follow: false },
};

export default async function FeedPreferencesPage() {
  const { userId } = await serverAuth();
  if (!userId) return <CommunityGate />;

  return (
    <main
      className="mx-auto px-4 py-6"
      style={{ maxWidth: 'var(--content-max)' }}
    >
      <Link
        href="/community"
        className="gg-press inline-block text-[13px] mb-4"
        style={{ color: 'var(--text-tertiary)' }}
      >
        ← Back to the feed
      </Link>
      <h1
        className="text-xl font-medium mb-5"
        style={{ color: 'var(--text-primary)' }}
      >
        Feed preferences
      </h1>
      <FeedPreferencesClient />
    </main>
  );
}
