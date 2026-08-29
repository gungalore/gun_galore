import { Skel, SkeletonRow } from '@/components/skeleton';

// The two-column shape the pack screen settles into, so the layout does not
// jump when the data lands.
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-[var(--page-max)] px-4 py-6">
      <Skel className="h-4 w-40 mb-6" />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px] lg:items-start">
        <div className="space-y-5">
          <Skel className="h-4 w-24" />
          <Skel className="h-7 w-2/3" />
          <SkeletonRow />
          <Skel className="h-40 rounded-[8px]" />
          <Skel className="h-32 rounded-[8px]" />
        </div>
        <div className="space-y-3">
          <Skel className="h-4 w-28" />
          <Skel className="h-40 rounded-[8px]" />
        </div>
      </div>
    </main>
  );
}
