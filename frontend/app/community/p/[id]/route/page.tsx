import type { Metadata } from 'next';
import Link from 'next/link';
import { serverAuth } from '../../../../../lib/auth-server';
import { BRAND_NAME } from '../../../../../lib/brand';
import { CommunityGate } from '../../../../../components/community/community-gate';
import { RoutePageClient } from '../../../../../components/community/route-page-client';

export const dynamic = 'force-dynamic';

// ⚠️ GENERIC METADATA ONLY. A route carries a title and a shape that belong to
// the member who posted it; putting either in the document head would leak it
// to every anonymous visitor and every crawler that follows a forwarded link.
// Like the post page, this URL is the same noindex gate for everyone until a
// session exists.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  await params;
  return {
    title: 'Community route',
    description: `A GPX route shared on ${BRAND_NAME}. Sign in to view it.`,
    robots: { index: false, follow: false },
    openGraph: {
      title: `A GPX route on ${BRAND_NAME}`,
      description: 'Members share the routes behind their hunts, hikes and trips.',
      images: ['/og-default.jpg'],
    },
  };
}

export default async function CommunityRoutePage({
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
        href={`/community/p/${id}`}
        className="gg-press inline-block text-[13px] mb-4"
        style={{ color: 'var(--text-tertiary)' }}
      >
        ← Back to the post
      </Link>
      <RoutePageClient postId={id} />
    </main>
  );
}
