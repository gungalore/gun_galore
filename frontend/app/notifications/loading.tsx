// /notifications — RSC loading skeleton. Three-tab inbox layout.

import { Skel, SkeletonRow } from '@/components/skeleton';

export default function NotificationsLoading() {
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '20px 14px 40px' }}>
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
        <Skel className="h-7 w-40" />
        <Skel className="h-7 w-28 rounded-md" />
      </div>
      {/* Tabs strip */}
      <div className="flex gap-2 mb-4">
        <Skel className="h-9 w-24 rounded-md" />
        <Skel className="h-9 w-24 rounded-md" />
        <Skel className="h-9 w-24 rounded-md" />
      </div>
      {/* Notification rows */}
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </main>
  );
}
