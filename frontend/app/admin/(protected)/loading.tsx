// Admin section loading state — sits under the admin sidebar + global
// search header. Renders 4 stat cards + an activity-feed-shaped column
// so the Command Center swap doesn't flash.

import { Skel, SkeletonRow } from '@/components/skeleton';

export default function AdminLoading() {
  return (
    <div className="space-y-5">
      <Skel className="h-6 w-32" />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skel key={i} className="h-24 rounded-[8px]" />
        ))}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skel key={i} className="h-20 rounded-[8px]" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </div>
  );
}
