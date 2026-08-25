// Shared loading-skeleton primitives. Use these inside route-level
// loading.tsx files so a slow RSC fetch (which we use everywhere with
// cache: 'no-store') doesn't paint a blank <main> on slow networks.
//
// Two building blocks:
//   <Skel/>          — a pulsing rectangle (specify w/h via Tailwind)
//   <SkeletonCard/>  — pre-composed card with title + stat lines
// Plus a few route-shaped wrappers for the surfaces we hit most.

import type { CSSProperties } from 'react';
import { CARD_PHOTO_ASPECT } from './listing-card';

export function Skel({
  className = '',
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`rounded-[4px] animate-pulse ${className}`}
      style={{
        background: 'var(--bg-inset)',
        ...style,
      }}
    />
  );
}

// One "row" with a title + 1-2 sub lines + a chip on the right.
// Looks identical to most of our list-item / dossier-summary cards.
export function SkeletonRow() {
  return (
    <div
      className="rounded-[6px] p-3 flex items-center gap-3"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
    >
      <Skel className="w-12 h-12 rounded-[6px] shrink-0" />
      <div className="flex-1 space-y-1.5">
        <Skel className="h-3 w-1/2" />
        <Skel className="h-2 w-1/3" />
      </div>
      <Skel className="w-16 h-5 rounded-full" />
    </div>
  );
}

export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-[6px] overflow-hidden"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
          }}
        >
          <Skel style={{ paddingBottom: CARD_PHOTO_ASPECT, width: '100%' }} className="rounded-none" />
          <div className="p-3 space-y-2">
            <Skel className="h-3 w-3/4" />
            <Skel className="h-4 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonDossier() {
  return (
    <div className="space-y-4">
      <Skel className="h-24 w-full rounded-[8px]" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skel key={i} className="h-20 rounded-[8px]" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </div>
  );
}
