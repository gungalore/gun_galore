import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { resizeImageData } from '../pipeline/decode';
import { Icon } from './icons';

/** Zoom used by the button and a double tap. */
const STEP_ZOOM = 2.5;
const MAX_ZOOM = 6;
const DOUBLE_TAP_MS = 300;

interface View {
  scale: number;
  tx: number;
  ty: number;
}

interface Pt {
  x: number;
  y: number;
}

/**
 * A page shown to fit, that the member can pinch, drag and double-tap to
 * look at closely. At 1x it sits centred like a plain preview; zoomed, it
 * pans within the box and never drifts off it. A button in the corner
 * zooms for anyone who would rather tap than pinch.
 */
export function ZoomView({ image, maxEdge = 1400 }: { image: ImageData; maxEdge?: number }): ReactElement {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const small = useMemo(() => resizeImageData(image, maxEdge), [image, maxEdge]);
  const [box, setBox] = useState({ w: 1, h: 1 });
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, Pt>());
  const gesture = useRef<{ view: View; a: Pt; b: Pt | null; moved: boolean } | null>(null);
  const lastTap = useRef<{ at: number; p: Pt } | null>(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = small.width;
    c.height = small.height;
    c.getContext('2d')?.putImageData(small, 0, 0);
  }, [small]);

  // A new image starts at 1x.
  useEffect(() => setView({ scale: 1, tx: 0, ty: 0 }), [image]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const layout = (): void => setBox({ w: Math.max(1, el.clientWidth), h: Math.max(1, el.clientHeight) });
    layout();
    const ro = new ResizeObserver(layout);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The fitted (1x) size and position of the page inside the box.
  const PAD = 16;
  const fitScale = Math.min((box.w - 2 * PAD) / small.width, (box.h - 2 * PAD) / small.height);
  const fw = small.width * fitScale;
  const fh = small.height * fitScale;
  const fx = (box.w - fw) / 2;
  const fy = (box.h - fh) / 2;

  /** Keep the zoomed page over the box: no gap when it is bigger than the box, centred when smaller. */
  const clamp = useCallback(
    (v: View): View => {
      const scale = Math.min(MAX_ZOOM, Math.max(1, v.scale));
      const w = fw * scale;
      const h = fh * scale;
      // The page's top-left on screen is (fx + tx, fy + ty); it scales about that corner.
      let left = fx + v.tx;
      let top = fy + v.ty;
      left = w <= box.w ? (box.w - w) / 2 : Math.min(0, Math.max(box.w - w, left));
      top = h <= box.h ? (box.h - h) / 2 : Math.min(0, Math.max(box.h - h, top));
      return { scale, tx: left - fx, ty: top - fy };
    },
    [box, fw, fh, fx, fy],
  );

  /** Zoom by k about a screen point, from a given view. */
  const zoomAbout = useCallback(
    (from: View, k: number, at: Pt): View => {
      const scale = Math.min(MAX_ZOOM, Math.max(1, from.scale * k));
      const kk = scale / from.scale;
      // Page point under `at` stays put: p = (at - origin) where origin = (fx + tx, fy + ty).
      const ox = fx + from.tx;
      const oy = fy + from.ty;
      return clamp({ scale, tx: at.x - (at.x - ox) * kk - fx, ty: at.y - (at.y - oy) * kk - fy });
    },
    [clamp, fx, fy],
  );

  const local = (e: React.PointerEvent | React.WheelEvent): Pt => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    const p = local(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { view: viewRef.current, a, b, moved: true };
    } else if (pointers.current.size === 1) {
      gesture.current = { view: viewRef.current, a: p, b: null, moved: false };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    if (g.b && pointers.current.size >= 2) {
      const [p1, p2] = [...pointers.current.values()];
      const d0 = Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y) || 1;
      const d1 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const m0 = { x: (g.a.x + g.b.x) / 2, y: (g.a.y + g.b.y) / 2 };
      const m1 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const z = zoomAbout(g.view, d1 / d0, m0);
      setView(clamp({ ...z, tx: z.tx + (m1.x - m0.x), ty: z.ty + (m1.y - m0.y) }));
    } else if (!g.b) {
      const dx = p.x - g.a.x;
      const dy = p.y - g.a.y;
      if (Math.hypot(dx, dy) > 6) g.moved = true;
      if (g.view.scale > 1) setView(clamp({ ...g.view, tx: g.view.tx + dx, ty: g.view.ty + dy }));
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (pointers.current.has(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size === 1) {
      const [a] = [...pointers.current.values()];
      gesture.current = { view: viewRef.current, a, b: null, moved: true };
      return;
    }
    gesture.current = null;
    if (g && !g.b && !g.moved) {
      // A tap. Two quick ones toggle the zoom at that spot.
      const now = performance.now();
      const prev = lastTap.current;
      if (prev && now - prev.at < DOUBLE_TAP_MS && Math.hypot(prev.p.x - p.x, prev.p.y - p.y) < 30) {
        lastTap.current = null;
        const v = viewRef.current;
        setView(v.scale > 1 ? { scale: 1, tx: 0, ty: 0 } : zoomAbout(v, STEP_ZOOM, p));
      } else {
        lastTap.current = { at: now, p };
      }
    }
  };

  // The wheel zooms instead of scrolling the page; React's wheel prop is passive,
  // so the listener that prevents the scroll is attached by hand.
  const zoomAboutRef = useRef(zoomAbout);
  zoomAboutRef.current = zoomAbout;
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const k = Math.exp(-e.deltaY * 0.0015);
      setView(zoomAboutRef.current(viewRef.current, k, { x: e.clientX - r.left, y: e.clientY - r.top }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoomed = view.scale > 1.01;
  const toggle = (): void => {
    setView(zoomed ? { scale: 1, tx: 0, ty: 0 } : zoomAbout(viewRef.current, STEP_ZOOM, { x: box.w / 2, y: box.h / 2 }));
  };

  return (
    <div
      ref={boxRef}
      className={`aos-zoom ${zoomed ? 'aos-zoomed' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: fw,
          height: fh,
          left: fx,
          top: fy,
          transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
        }}
      />
      <button type="button" className="aos-zoom-btn" onClick={toggle} aria-label={zoomed ? 'Fit the page' : 'Zoom in'}>
        <Icon name={zoomed ? 'zoomOut' : 'zoomIn'} size={22} />
      </button>
    </div>
  );
}
