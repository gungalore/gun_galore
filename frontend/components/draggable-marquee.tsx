'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useMarquee } from '@/lib/use-marquee';

// DraggableMarquee — the shared shell for every featured-listing marquee
// (homepage row, desktop sidebar rail, mobile rail, PWA sticky strip).
// Auto-scrolls, pauses on hover, and can be click-dragged to pan. Give it
// a DOUBLED child list ([...items, ...items]) so the loop is seamless.
//
// `style` lands on the clipping container (mask gradients, height, margins).
// `innerStyle` lands on the moving track (gap, padding). Axis 'x' makes the
// track a max-content row; 'y' makes it a column.
export function DraggableMarquee({
  axis,
  speed = 55,
  className,
  style,
  innerStyle,
  children,
}: {
  axis: 'x' | 'y';
  speed?: number;
  className?: string;
  style?: CSSProperties;
  innerStyle?: CSSProperties;
  children: ReactNode;
}) {
  const { containerRef, innerRef } = useMarquee(axis, speed);
  return (
    <div
      ref={containerRef}
      className={className}
      style={{ overflow: 'hidden', ...style }}
    >
      <div
        ref={innerRef}
        style={{
          display: 'flex',
          flexDirection: axis === 'y' ? 'column' : 'row',
          ...(axis === 'x' ? { width: 'max-content' } : null),
          ...innerStyle,
        }}
      >
        {children}
      </div>
    </div>
  );
}
