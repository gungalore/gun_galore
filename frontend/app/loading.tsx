// Root loading state — shown on initial /, /marketplace, /listings/...
// navigation while the RSC fetch resolves. Matches the homepage grid
// layout so the swap to real content doesn't shift everything.

import { SkeletonGrid } from '@/components/skeleton';

export default function Loading() {
  return (
    <main className="max-w-[1280px] mx-auto px-4 py-6">
      <div
        className="mb-6 rounded-[6px] h-10 animate-pulse"
        style={{ background: 'var(--bg-card)' }}
      />
      <SkeletonGrid count={8} />
    </main>
  );
}
