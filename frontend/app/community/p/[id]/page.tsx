import type { Metadata } from 'next';
import Link from 'next/link';
import { BRAND_NAME } from '../../../../lib/brand';
import { PostDetailClient } from '../../../../components/community/post-detail-client';

export const dynamic = 'force-dynamic';

// ⚠️ Anonymous metadata is a GENERIC brand card, never the post's photo or
// body. The content is behind the 18+ gate, not a login: a declared visitor
// reads the same published post as a member, so nothing is keyed off a session
// here.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  await params;
  return {
    title: 'Community post',
    description: `A post on ${BRAND_NAME}.`,
    robots: { index: false, follow: false },
    openGraph: {
      title: `A post on ${BRAND_NAME}`,
      description: 'Members share hunts, catches, camps, hikes and builds.',
      images: ['/og-default.jpg'],
    },
  };
}

/**
 * A post is CONTENT: the middleware has already applied the 18+ gate, so the
 * page renders for a declared guest and a member alike. The client asks the
 * API with no token for a guest; a non-published post still 404s there.
 */
export default async function CommunityPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

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
