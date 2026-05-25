// Public seller profile skeleton — profile card + listings grid +
// reviews sidebar. Same layout as the real page so nothing jumps.

import { Skel, SkeletonGrid } from '@/components/skeleton';

export default function SellerProfileLoading() {
  return (
    <main className="max-w-[1280px] mx-auto px-4 py-6">
      {/* Header card */}
      <div
        className="rounded-[10px] p-6 mb-6 space-y-3"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <Skel className="h-6 w-40" />
        <Skel className="h-4 w-32" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div>
          <Skel className="h-3 w-32 mb-3" />
          <SkeletonGrid count={6} />
        </div>
        <div
          className="rounded-[8px] p-5 space-y-3"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
          }}
        >
          <Skel className="h-3 w-24" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skel className="h-3 w-full" />
              <Skel className="h-3 w-3/4" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
