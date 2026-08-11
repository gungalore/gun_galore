import { Skel, SkeletonRow } from '@/components/skeleton';

// Every neighbouring deal surface (my/offers, my/bids, wishlist) has a
// skeleton; without one this route rendered a blank page for the whole
// server fetch on a slow connection. Mirrors app/my/offers/loading.tsx —
// title, section label, three rows.
export default function ReceivedOffersLoading() {
  return (
    <main className="max-w-[760px] mx-auto px-4 py-8">
      <Skel className="h-7 w-44 mb-6" />
      <Skel className="h-3 w-40 mb-3" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </main>
  );
}
