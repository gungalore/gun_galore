import type { Metadata } from 'next';
import Link from 'next/link';
import { BRAND_NAME } from '../../../../lib/brand';
import { ProfileClient } from '../../../../components/community/profile-client';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  return {
    title: `${username} — Community`,
    description: `${username} on the ${BRAND_NAME} community.`,
    robots: { index: false, follow: false },
  };
}

/**
 * A public profile is CONTENT: behind the 18+ gate (applied by the middleware),
 * readable by a declared guest. Only following is a member action.
 */
export default async function CommunityProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;

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
      <ProfileClient username={username} />
    </main>
  );
}
