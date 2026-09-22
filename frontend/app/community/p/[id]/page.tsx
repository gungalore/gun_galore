import type { Metadata } from 'next';
import Link from 'next/link';
import { serverAuth } from '../../../../lib/auth-server';
import { BRAND_NAME } from '../../../../lib/brand';
import { CommunityGate } from '../../../../components/community/community-gate';
import { PostDetailClient } from '../../../../components/community/post-detail-client';

export const dynamic = 'force-dynamic';

// ⚠️ Anonymous metadata is a GENERIC brand card, never the post's photo or
// body. The shareable URL resolves to the same gate for every anonymous
// visitor (human or crawler); the content is only behind a session.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  await params;
  return {
    title: 'Community post',
    description: `A post on ${BRAND_NAME}. Sign in to view what members are sharing.`,
    robots: { index: false, follow: false },
    openGraph: {
      title: `A post on ${BRAND_NAME}`,
      description: 'Members share hunts, catches, camps and builds.',
      images: ['/og-default.jpg'],
    },
  };
}

export default async function CommunityPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
      <PostDetailClient id={id} />
    </main>
  );
}
