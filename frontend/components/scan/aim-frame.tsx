'use client';

import { useEffect, useRef, useState } from 'react';
import { aimBox } from '@/lib/scan/aim';
import { DocShape, holdHint } from '@/lib/scan/shapes';

// ────────────────────────────────────────────────────────────────────
// FOUR CORNERS, THICK, RED.
//
// It replaces a 1px dashed gold rectangle that the operator could barely see
// on his own phone — and he was looking for it. A viewfinder guide competes
// with whatever the camera happens to be pointed at, which on a desk is
// usually a bright patterned surface, so it has to win on contrast rather
// than on taste.
//
// CORNERS RATHER THAN A FULL RECTANGLE, for a reason that outlives the
// styling: a continuous rectangle drawn over a live camera IS an edge, and
// the member lines the document's edge up against it, sees two parallel
// lines, and cannot tell which is which. Corner brackets mark the target
// without drawing anything that can be mistaken for the document.
// ────────────────────────────────────────────────────────────────────

const RED = '#E03131';
const STROKE = 5;

export default function AimFrame({
  shape,
  /** Green once the detector agrees with the box — the only "good" signal. */
  locked = false,
}: {
  shape: DocShape;
  locked?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setView({ width: r.width, height: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const box = view.width > 0 ? aimBox(shape, view) : null;
  // Arms long enough to read as a corner, short enough not to become a
  // rectangle. A sixth of the shorter side, with a floor for tiny screens.
  const arm = box ? Math.max(22, Math.min(box.width, box.height) / 6) : 0;
  const colour = locked ? '#2F9E44' : RED;
  const hold = holdHint(shape);

  return (
    <div ref={ref} aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {box && (
        <svg width={view.width} height={view.height} style={{ position: 'absolute', inset: 0 }}>
          {/* A dark halo under every stroke. Red on a red-brown desk, or on
              a SAPS licence's own printing, is otherwise invisible — and the
              one place this has to work is on top of a document. */}
          {[
            { c: 'rgba(0,0,0,0.55)', w: STROKE + 4 },
            { c: colour, w: STROKE },
          ].map((pass, i) => (
            <g
              key={i}
              stroke={pass.c}
              strokeWidth={pass.w}
              strokeLinecap="round"
              fill="none"
            >
              {corners(box, arm).map((d, j) => (
                <path key={j} d={d} />
              ))}
            </g>
          ))}
        </svg>
      )}

      {hold && (
        <p
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: box ? box.y + box.height + 10 : '60%',
            margin: 0,
            textAlign: 'center',
            fontSize: 12,
            color: 'rgba(255,255,255,0.85)',
            textShadow: '0 1px 3px rgba(0,0,0,0.9)',
          }}
        >
          Hold the phone {hold}
        </p>
      )}
    </div>
  );
}

/** The four L-shaped brackets, as SVG paths. */
function corners(
  b: { x: number; y: number; width: number; height: number },
  arm: number,
): string[] {
  const { x, y, width: w, height: h } = b;
  const r = x + w;
  const bt = y + h;
  return [
    `M ${x} ${y + arm} L ${x} ${y} L ${x + arm} ${y}`,
    `M ${r - arm} ${y} L ${r} ${y} L ${r} ${y + arm}`,
    `M ${r} ${bt - arm} L ${r} ${bt} L ${r - arm} ${bt}`,
    `M ${x + arm} ${bt} L ${x} ${bt} L ${x} ${bt - arm}`,
  ];
}
