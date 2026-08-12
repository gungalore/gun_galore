import { Skel, SkeletonRow } from '@/components/skeleton';

export default function Loading() {
  return (
    <main className="max-w-[var(--page-max)] mx-auto px-4 py-6">
      <Skel className="h-4 w-16 mb-6" />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8 items-start">
        <div className="space-y-5">
          <Skel className="h-6 w-1/2 mb-2" />
          <Skel className="h-8 w-3/4" />
          <SkeletonRow />
          <Skel className="h-40 rounded-[8px]" />
          <Skel className="h-32 rounded-[8px]" />
        </div>
        <div className="space-y-3">
          <Skel className="h-32 rounded-[8px]" />
          <Skel className="h-32 rounded-[8px]" />
        </div>
      </div>
    </main>
  );
}
