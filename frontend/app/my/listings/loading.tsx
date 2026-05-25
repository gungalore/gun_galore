import { Skel, SkeletonRow } from '@/components/skeleton';

export default function MyListingsLoading() {
  return (
    <main className="max-w-[1280px] mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <Skel className="h-7 w-32" />
        <Skel className="h-9 w-28 rounded-md" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </main>
  );
}
