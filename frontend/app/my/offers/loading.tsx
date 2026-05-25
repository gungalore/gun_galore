import { Skel, SkeletonRow } from '@/components/skeleton';

export default function MyOffersLoading() {
  return (
    <main className="max-w-[760px] mx-auto px-4 py-8">
      <Skel className="h-7 w-32 mb-6" />
      <Skel className="h-3 w-16 mb-3" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </main>
  );
}
