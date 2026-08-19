'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pt, Quad, orderQuad } from '@/lib/scan/geometry';
import {
  containFit,
  loupeCrosshair,
  loupeSource,
  magnifierSpot,
} from '@/lib/scan/magnifier';

// ────────────────────────────────────────────────────────────────────
// PUTTING THE CORNERS WHERE THEY BELONG.
//
// The whole photograph, a blue quad over it, and a draggable dot at each
// corner. Dragging one opens a magnifier so the corner can be landed on the
// actual edge of the document rather than near it.
//
// ⚠️ THE WHOLE PHOTOGRAPH, not the crop. The previous version showed the
// RECTIFIED output — which is to say, it showed the result of the corners
// being wrong, and offered no way to see what they should have been. If the
// crop caught a mousepad, the mousepad is all you could see.
//
// ⚠️ THE MAGNIFIER IS PLACED BY RULE, not by taste: away from the dot, and
// never in the bottom half, which belongs to the hand. Those rules live in
// lib/scan/magnifier.ts as pure functions with a test that sweeps every dot
// position on the screen, because "it looked fine on my phone" is not a
// guarantee about somebody else's grip.
// ────────────────────────────────────────────────────────────────────

const BLUE = '#4DA3FF';
const LOUPE = { width: 148, height: 148 };
const ZOOM = 3.5;
/** Finger-sized. The visible dot is smaller; this is what you can grab. */
const GRAB = 44;
/** Radius of the crosshair's clear centre window, in loupe pixels. */
const GAP = 9;

export interface CornerEditorProps {
  /** The uncropped capture. */
  src: string;
  /** Its natural size — `quad` is in these coordinates. */
  size: { width: number; height: number };
  quad: Quad;
  onCancel: () => void;
  onApply: (q: Quad) => void;
  busy?: boolean;
}

export default function CornerEditor({
  src,
  size,
  quad,
  onCancel,
  onApply,
  busy = false,
}: CornerEditorProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [pts, setPts] = useState<Quad>(quad);
  const [dragging, setDragging] = useState<number | null>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  // Which corner the keyboard is on, so this works without a touchscreen.
  const [focused, setFocused] = useState(0);

  // ⚠️ CONTAIN FITS BY WHICHEVER AXIS RUNS OUT FIRST, and then centres what
  // is left over. A portrait phone showing a landscape photograph letterboxes
  // top and bottom; hold the phone the other way and it letterboxes left and
  // right instead. Mapping through width alone is right exactly half the
  // time, and the half it is wrong in puts every corner in the wrong place.
  const { scale: fit, ox, oy } = containFit(size, {
    width: view.w,
    height: view.h,
  });

  const toView = useCallback(
    (p: Pt) => ({ x: p.x * fit + ox, y: p.y * fit + oy }),
    [fit, ox, oy],
  );
  const toImage = useCallback(
    (x: number, y: number): Pt => ({
      // Clamped: a corner outside the photograph is not a corner of anything,
      // and the warp would sample clamped edge pixels for a whole side.
      x: Math.max(0, Math.min(size.width, (x - ox) / fit)),
      y: Math.max(0, Math.min(size.height, (y - oy) / fit)),
    }),
    [fit, ox, oy, size.width, size.height],
  );

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setView({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const moveTo = useCallback(
    (i: number, clientX: number, clientY: number) => {
      const el = boxRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const p = toImage(clientX - r.left, clientY - r.top);
      setPts((cur) => {
        const next = [...cur] as Quad;
        next[i] = p;
        return next;
      });
    },
    [toImage],
  );

  // Pointer events on the WINDOW while dragging, so a finger that slides off
  // the image — which is exactly what happens at a corner — keeps dragging.
  useEffect(() => {
    if (dragging === null) return;
    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      moveTo(dragging, e.clientX, e.clientY);
    };
    const onUp = () => setDragging(null);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, moveTo]);

  const viewPts = pts.map(toView);
  const active = dragging ?? -1;
  const loupeAt =
    active >= 0 && view.w > 0
      ? magnifierSpot(viewPts[active], { width: view.w, height: view.h }, LOUPE)
      : null;
  // Image pixels to loupe pixels. ZOOM is relative to what is ON SCREEN, so
  // "3.5x" means three and a half times the size the member is already
  // looking at — not some ratio of the raw file they have no feel for.
  const mag = ZOOM * fit;
  const loupeSrc = active >= 0 ? loupeSource(pts[active], size, LOUPE, mag) : null;
  const cross =
    active >= 0 ? loupeCrosshair(pts[active], size, LOUPE, mag) : null;

  const CORNER_NAMES = ['top left', 'top right', 'bottom right', 'bottom left'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        ref={boxRef}
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          // touch-action none, or the browser pans the page instead of
          // giving us the drag.
          touchAction: 'none',
          overflow: 'hidden',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="The photograph you took, with the document's corners marked"
          draggable={false}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            userSelect: 'none',
          }}
        />

        {view.w > 0 && (
          <svg
            width={view.w}
            height={view.h}
            style={{ position: 'absolute', inset: 0 }}
            aria-hidden="true"
          >
            {/* Everything outside the quad, dimmed — so the crop reads at a
                glance without hiding what is being excluded. */}
            <defs>
              <mask id="gg-quad-mask">
                <rect width={view.w} height={view.h} fill="white" />
                <polygon
                  points={viewPts.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="black"
                />
              </mask>
            </defs>
            <rect
              width={view.w}
              height={view.h}
              fill="rgba(0,0,0,0.55)"
              mask="url(#gg-quad-mask)"
            />
            <polygon
              points={viewPts.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={BLUE}
              strokeWidth={2}
            />
            {viewPts.map((p, i) => (
              <g key={i}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={active === i ? 13 : 10}
                  fill={BLUE}
                  fillOpacity={active === i ? 1 : 0.85}
                  stroke="#fff"
                  strokeWidth={2}
                />
                {focused === i && active < 0 && (
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={18}
                    fill="none"
                    stroke="#fff"
                    strokeWidth={1.5}
                  />
                )}
              </g>
            ))}
          </svg>
        )}

        {/* The grab targets. Separate from the drawn dots because a 10px
            circle is not something a thumb can reliably hit, and enlarging
            the drawn dot to 44px would cover the very edge being placed. */}
        {view.w > 0 &&
          viewPts.map((p, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Move the ${CORNER_NAMES[i]} corner`}
              onFocus={() => setFocused(i)}
              onPointerDown={(e) => {
                e.preventDefault();
                (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
                setFocused(i);
                setDragging(i);
              }}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 10 : 1;
                const d: Record<string, [number, number]> = {
                  ArrowLeft: [-step, 0],
                  ArrowRight: [step, 0],
                  ArrowUp: [0, -step],
                  ArrowDown: [0, step],
                };
                const move = d[e.key];
                if (!move) return;
                e.preventDefault();
                setPts((cur) => {
                  const next = [...cur] as Quad;
                  next[i] = {
                    x: Math.max(0, Math.min(size.width, next[i].x + move[0] / fit)),
                    y: Math.max(0, Math.min(size.height, next[i].y + move[1] / fit)),
                  };
                  return next;
                });
              }}
              style={{
                position: 'absolute',
                left: p.x - GRAB / 2,
                top: p.y - GRAB / 2,
                width: GRAB,
                height: GRAB,
                borderRadius: '50%',
                border: 'none',
                background: 'transparent',
                padding: 0,
                touchAction: 'none',
                cursor: 'grab',
              }}
            />
          ))}

        {/* THE MAGNIFIER. Parked by rule — see lib/scan/magnifier.ts. */}
        {loupeAt && loupeSrc && cross && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: loupeAt.x,
              top: loupeAt.y,
              width: LOUPE.width,
              height: LOUPE.height,
              borderRadius: 12,
              overflow: 'hidden',
              border: `2px solid ${BLUE}`,
              background: '#000',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                backgroundImage: `url(${src})`,
                backgroundRepeat: 'no-repeat',
                // Scale the whole image up, then offset so the window lands
                // on the dot. Cheaper than a canvas and pixel-identical.
                backgroundSize: `${size.width * mag}px ${size.height * mag}px`,
                backgroundPosition: `${-loupeSrc.sx * mag}px ${
                  -loupeSrc.sy * mag
                }px`,
                imageRendering: 'auto',
              }}
            />
            {/* THE CROSSHAIR. Follows the dot rather than sitting at the
                middle, because the window clamps at the edges of the photo —
                and edges are where corners are.

                ⚠️ EVERY STROKE HAS A DARK HALO UNDER IT, the same trick the
                red aim corners use, and for the same reason: this draws over
                a magnified photograph, which is by definition a busy, high-
                contrast, unpredictable background. The first version was two
                half-opacity hairlines and, in the operator's words, hard to
                spot — a hairline over 3.5x-magnified paper grain simply
                disappears. The lines also stop short of the centre so the
                exact pixel being placed stays VISIBLE: a crosshair that
                covers the corner it is pointing at defeats the loupe. */}
            <svg
              width={LOUPE.width}
              height={LOUPE.height}
              style={{ position: 'absolute', inset: 0 }}
            >
              {[
                { c: 'rgba(0,0,0,0.7)', w: 4.5 },
                { c: '#fff', w: 2 },
              ].map((pass, pi) => (
                <g
                  key={pi}
                  stroke={pass.c}
                  strokeWidth={pass.w}
                  strokeLinecap="round"
                >
                  {/* Four arms with a clear window around the centre. */}
                  <line x1={cross.x} y1={0} x2={cross.x} y2={cross.y - GAP} />
                  <line
                    x1={cross.x}
                    y1={cross.y + GAP}
                    x2={cross.x}
                    y2={LOUPE.height}
                  />
                  <line x1={0} y1={cross.y} x2={cross.x - GAP} y2={cross.y} />
                  <line
                    x1={cross.x + GAP}
                    y1={cross.y}
                    x2={LOUPE.width}
                    y2={cross.y}
                  />
                </g>
              ))}
              <circle
                cx={cross.x}
                cy={cross.y}
                r={GAP}
                fill="none"
                stroke="rgba(0,0,0,0.7)"
                strokeWidth={4.5}
              />
              <circle
                cx={cross.x}
                cy={cross.y}
                r={GAP}
                fill="none"
                stroke={BLUE}
                strokeWidth={2}
              />
              <circle
                cx={cross.x}
                cy={cross.y}
                r={2.2}
                fill="#fff"
                stroke="rgba(0,0,0,0.7)"
                strokeWidth={1}
              />
            </svg>
          </div>
        )}
      </div>

      <p
        style={{
          margin: 0,
          padding: '8px 16px 0',
          fontSize: 13,
          color: 'rgba(255,255,255,0.8)',
        }}
      >
        Drag the blue dots onto the corners of the document. A magnifier opens
        while you drag.
      </p>

      <div
        style={{
          display: 'flex',
          gap: 10,
          padding: '10px 16px max(16px, env(safe-area-inset-bottom))',
        }}
      >
        <button type="button" onClick={onCancel} style={btn}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => setPts(quad)}
          style={btn}
          aria-label="Put the corners back where we found them"
        >
          Reset
        </button>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          disabled={busy}
          onClick={() => onApply(orderQuad([...pts]))}
          style={{ ...btn, background: 'var(--red)', border: 'none' }}
        >
          {busy ? 'Working…' : 'Apply'}
        </button>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  minHeight: 44,
  padding: '0 16px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.35)',
  background: 'transparent',
  color: '#fff',
  fontSize: 15,
};
