import type { Metadata } from 'next';
import Link from 'next/link';
import { serverAuth } from '../../../../lib/auth-server';
import { CommunityGate } from '../../../../components/community/community-gate';
import { GroupClient } from '../../../../components/community/group-client';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: `${slug} — Community`,
    robots: { index: false, follow: false },
  };
}

export default async function GroupPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await serverAuth();
  if (!userId) return <CommunityGate />;

  return (
    <main className="mx-auto px-4 py-6" style={{ maxWidth: 'var(--content-max)' }}>
      <Link
        href="/community/groups"
        className="gg-press inline-block text-[13px] mb-4"
        style={{ color: 'var(--text-tertiary)' }}
      >
        ← All groups
      </Link>
      <GroupClient slug={slug} />
    </main>
  );
}
