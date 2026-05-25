import { Skel, SkeletonRow } from '@/components/skeleton';

export default function MyTicketsLoading() {
  return (
    <main className="max-w-[760px] mx-auto px-4 py-8">
      <Skel className="h-7 w-56 mb-6" />
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </main>
  );
}
