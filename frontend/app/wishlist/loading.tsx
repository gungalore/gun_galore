// /wishlist — RSC loading skeleton. Mirrors the page layout: header
// + card grid. Renders instantly on navigation so the user doesn't
// see a blank screen while the server fetches their saved listings.

import { Skel, SkeletonGrid } from '@/components/skeleton';

export default function WishlistLoading() {
  return (
    <main className="max-w-[1280px] mx-auto px-4 py-6">
      <div className="mb-6">
        <Skel className="h-6 w-32 mb-2" />
        <Skel className="h-4 w-48" />
      </div>
      <SkeletonGrid count={6} />
    </main>
  );
}
