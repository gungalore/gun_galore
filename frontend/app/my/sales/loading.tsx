import { Skel, SkeletonRow } from '@/components/skeleton';

export default function MySalesLoading() {
  return (
    <main className="max-w-[1280px] mx-auto px-4 py-6">
      <Skel className="h-7 w-32 mb-6" />
      <Skel className="h-3 w-20 mb-3" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </main>
  );
}
