import type { Metadata } from 'next';
import { serverAuth } from '../../lib/auth-server';
import { BRAND_NAME } from '../../lib/brand';
import { CommunityGate } from '../../components/community/community-gate';
import { FeedClient } from '../../components/community/feed-client';
import { MyControlPanel } from '../../components/community/my-control-panel';

// Viewer-varying (signed-in vs gate) and never shared-cached.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Community',
  description: `Share, ask and discuss with the ${BRAND_NAME} community.`,
  robots: { index: false, follow: false },
};

export default async function CommunityPage() {
  const { userId } = await serverAuth();
  if (!userId) return <CommunityGate />;

  return (
    <main
      className="mx-auto px-4 py-6"
      style={{ maxWidth: 'var(--content-max)' }}
    >
      <h1
        className="text-xl font-medium mb-4"
        style={{ color: 'var(--text-primary)' }}
      >
        Community
      </h1>
      {/* Feed takes ~75% (3fr of 4) with the member's control panel in the
          remaining ~25%. On mobile the panel moves ABOVE the feed (order-1)
          because a sidebar stacked below the feed would never be found. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)] items-start">
        <div className="order-2 lg:order-1 min-w-0">
          <FeedClient />
        </div>
        <aside className="order-1 lg:order-2 lg:sticky lg:top-24 min-w-0">
          <MyControlPanel />
        </aside>
      </div>
    </main>
  );
}
