import { Skel, SkeletonRow } from '@/components/skeleton';

export default function MyOrdersLoading() {
  return (
    <main className="max-w-[1280px] mx-auto px-4 py-6">
      <Skel className="h-7 w-36 mb-6" />
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </main>
  );
}
