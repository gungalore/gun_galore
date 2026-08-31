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
const GREEN = '#2F9E44';
const STROKE = 5;

export default function AimFrame({
  /**
   * Stand down — the live detector has the document and is drawing its own box.
   *
   * A fixed rectangle to aim at AND a quad tracking the document are
   * contradictory instructions; the tracked one is the truthful one.
   */
  hidden = false,
  shape,
  /** Green once the detector agrees with the box — the only "good" signal. */
  locked = false,
  /**
   * Always green, whatever the detector thinks.
   *
   * ⚠️ FOR FLOWS WHERE THE BOX IS AN INSTRUCTION, NOT A VERDICT. Operator,
   * 2026-08-23, on the seller-consent capture: "the aim box that the license
   * needs to fit in, keep it static green. User must just point, fit in the
   * box and shoot."
   *
   * The red/green signal is worth a lot when a detector is genuinely tracking
   * a document and auto-capture depends on it. It is worth less than nothing
   * when the person holding the phone is a stranger who received an SMS: a box
   * that stays red while they are doing everything right reads as "this is not
   * working", and there is nobody to ask. A steady green box says "put it
   * here" and the corner editor afterwards is what actually guarantees the
   * crop.
   */
  alwaysGreen = false,
}: {
  hidden?: boolean;
  shape: DocShape;
  locked?: boolean;
  alwaysGreen?: boolean;
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

  if (hidden) return null;
  const box = view.width > 0 ? aimBox(shape, view) : null;
  // Arms long enough to read as a corner, short enough not to become a
  // rectangle. A sixth of the shorter side, with a floor for tiny screens.
  const arm = box ? Math.max(22, Math.min(box.width, box.height) / 6) : 0;
  const colour = alwaysGreen || locked ? GREEN : RED;
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

      {/* ⚠️ ON A PLATE, NOT ON A SHADOW. 85%-white at 12px sat directly over
          whatever the camera was pointed at — which, when the member has done
          exactly what was asked, is the document itself or the bright desk
          beside it. So the one instruction on the viewfinder vanished at the
          precise moment it was being followed. The brackets above get an
          explicit dark halo pass for this same reason; the words beside them
          got nothing.

          A solid fill, not a box-shadow: globals.css kills every box-shadow in
          the app, so a shadow here would be dead code. 70% black under white
          composites to roughly 7:1, clear of AA with headroom.

          +14 rather than +10: a hard-edged plate tucked right under the
          brackets reintroduces what this component's own header warns about —
          a straight line on a live camera IS an edge, and the member lines the
          document up against it. */}
      {hold && (
        <p
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: box ? box.y + box.height + 14 : '60%',
            margin: 0,
            textAlign: 'center',
            fontSize: 12,
          }}
        >
          <span
            style={{
              display: 'inline-block',
              padding: '4px 10px',
              borderRadius: 6,
              background: 'rgba(0,0,0,0.70)',
              color: '#fff',
            }}
          >
            Hold the phone {hold}
          </span>
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
