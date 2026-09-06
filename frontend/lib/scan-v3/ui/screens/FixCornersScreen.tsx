import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { Point, Quad } from '../../pipeline/geometry';
import { orderQuad } from '../../pipeline/geometry';
import { Icon } from '../icons';
import { TopBar } from './TopBar';

export interface FixCornersScreenProps {
  /** The photo the outline refers to. */
  source: ImageData;
  /** The current outline in `source` pixels, or none (start from a generous rectangle). */
  quad: Quad | null;
  onDone: (quad: Quad) => void;
  onCancel: () => void;
}

type Grab = { kind: 'corner'; i: number } | { kind: 'edge'; i: number };

/** Screen-space view of the photo: screen = source * scale + (tx, ty). */
interface View {
  scale: number;
  tx: number;
  ty: number;
}

const HANDLE_R = 17;
const EDGE_R = 9;
const GRAB_RADIUS = 34;
const LOUPE = 120;
/** The loupe magnifies this much beyond the current view. */
const LOUPE_GAIN = 2.5;
/** Room around the outline when the view zooms to it, as a share of its size. */
const ZOOM_MARGIN = 0.06;
/** Extra screen pixels so the handles never sit under the edge of the stage. */
const HANDLE_PAD = 28;

function isConvex(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const s = Math.sign(cross);
    if (s === 0) continue;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}

function bounds(q: Quad): { x0: number; y0: number; x1: number; y1: number } {
  const xs = q.map((p) => p.x);
  const ys = q.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/**
 * Drag the four corners (or a whole edge) onto the page edges. The view opens
 * zoomed onto the outline, since that is where the work is, with everything
 * outside it dimmed; pinch to zoom, drag the photo to pan, and a loupe shows
 * the pixels under the finger. Coordinates live in source pixels.
 */
export function FixCornersScreen({ source, quad, onDone, onCancel }: FixCornersScreenProps): ReactElement {
  const stageRef = useRef<HTMLDivElement>(null);
  const photoRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const sourceCanvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = source.width;
    c.height = source.height;
    c.getContext('2d')?.putImageData(source, 0, 0);
    return c;
  }, [source]);

  const initial = useMemo<Quad>(() => {
    if (quad) return quad.map((p) => ({ ...p })) as Quad;
    const mx = source.width * 0.08;
    const my = source.height * 0.08;
    return [
      { x: mx, y: my },
      { x: source.width - mx, y: my },
      { x: source.width - mx, y: source.height - my },
      { x: mx, y: source.height - my },
    ];
  }, [quad, source.width, source.height]);

  const [pts, setPts] = useState<Quad>(initial);
  const [stageSize, setStageSize] = useState({ w: 1, h: 1 });
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const [zoomed, setZoomed] = useState(true);
  const [grab, setGrab] = useState<Grab | null>(null);
  const [loupeAt, setLoupeAt] = useState<{ x: number; y: number; src: Point } | null>(null);
  const grabRef = useRef<{ grab: Grab; start: Point; startPts: Quad } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const ptsRef = useRef(pts);
  ptsRef.current = pts;
  /** Active touches for pan and pinch, in stage pixels. */
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ view: View; a: Point; b: Point | null } | null>(null);

  // Track the stage size.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const layout = (): void => setStageSize({ w: Math.max(1, stage.clientWidth), h: Math.max(1, stage.clientHeight) });
    layout();
    const ro = new ResizeObserver(layout);
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  /** The view that shows the whole photo. */
  const wholeView = useCallback((): View => {
    const scale = Math.min(stageSize.w / source.width, stageSize.h / source.height);
    return { scale, tx: (stageSize.w - source.width * scale) / 2, ty: (stageSize.h - source.height * scale) / 2 };
  }, [stageSize, source.width, source.height]);

  /** The view that fills the stage with the outline and a little room around it. */
  const outlineView = useCallback(
    (q: Quad): View => {
      const b = bounds(q);
      const bw = Math.max(1, b.x1 - b.x0);
      const bh = Math.max(1, b.y1 - b.y0);
      const x0 = b.x0 - bw * ZOOM_MARGIN;
      const y0 = b.y0 - bh * ZOOM_MARGIN;
      const w = bw * (1 + 2 * ZOOM_MARGIN);
      const h = bh * (1 + 2 * ZOOM_MARGIN);
      const scale = Math.min((stageSize.w - 2 * HANDLE_PAD) / w, (stageSize.h - 2 * HANDLE_PAD) / h);
      return { scale, tx: (stageSize.w - w * scale) / 2 - x0 * scale, ty: (stageSize.h - h * scale) / 2 - y0 * scale };
    },
    [stageSize],
  );

  /** Keep the photo on the stage and the zoom within reason. */
  const clampView = useCallback(
    (v: View): View => {
      const whole = wholeView();
      const minScale = whole.scale * 0.9;
      const maxScale = Math.max(whole.scale * 10, 2);
      const scale = Math.min(maxScale, Math.max(minScale, v.scale));
      const w = source.width * scale;
      const h = source.height * scale;
      // At least a third of the stage must still show photo.
      const slackX = stageSize.w / 3;
      const slackY = stageSize.h / 3;
      const tx = w <= stageSize.w ? (stageSize.w - w) / 2 : Math.min(slackX, Math.max(stageSize.w - w - slackX, v.tx));
      const ty = h <= stageSize.h ? (stageSize.h - h) / 2 : Math.min(slackY, Math.max(stageSize.h - h - slackY, v.ty));
      return { scale, tx, ty };
    },
    [wholeView, source.width, source.height, stageSize],
  );

  // Open on the outline; refit when the stage changes size.
  const fitted = useRef(false);
  useEffect(() => {
    if (stageSize.w <= 1) return;
    setView(clampView(zoomed || !fitted.current ? outlineView(initial) : wholeView()));
    fitted.current = true;
    // Only on size changes: the toggle below sets the view itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageSize]);

  const toggleZoom = (): void => {
    const next = !zoomed;
    setZoomed(next);
    setView(clampView(next ? outlineView(pts) : wholeView()));
  };

  // Draw the visible part of the photo.
  useEffect(() => {
    const c = photoRef.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(stageSize.w * dpr);
    const H = Math.round(stageSize.h * dpr);
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.tx, dpr * view.ty);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sourceCanvas, 0, 0);
  }, [view, stageSize, sourceCanvas]);

  const toScreen = useCallback((p: Point): Point => ({ x: p.x * view.scale + view.tx, y: p.y * view.scale + view.ty }), [view]);

  const edgeMid = (i: number, q: Quad): Point => ({ x: (q[i].x + q[(i + 1) % 4].x) / 2, y: (q[i].y + q[(i + 1) % 4].y) / 2 });

  const drawLoupe = useCallback(
    (src: Point): void => {
      const c = loupeRef.current;
      if (!c) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = LOUPE * dpr;
      c.height = LOUPE * dpr;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const r = LOUPE / 2 / (LOUPE_GAIN * viewRef.current.scale); // source pixels shown either side
      ctx.imageSmoothingEnabled = true;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(sourceCanvas, src.x - r, src.y - r, 2 * r, 2 * r, 0, 0, c.width, c.height);
    },
    [sourceCanvas],
  );

  const stagePoint = (e: React.PointerEvent<SVGSVGElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const findHandle = (s: Point): Grab | null => {
    let best: Grab | null = null;
    let bestD = GRAB_RADIUS;
    const q = ptsRef.current;
    for (let i = 0; i < 4; i++) {
      const c = toScreen(q[i]);
      const d = Math.hypot(c.x - s.x, c.y - s.y);
      if (d < bestD) {
        bestD = d;
        best = { kind: 'corner', i };
      }
    }
    if (best) return best;
    for (let i = 0; i < 4; i++) {
      const c = toScreen(edgeMid(i, q));
      const d = Math.hypot(c.x - s.x, c.y - s.y);
      if (d < bestD) {
        bestD = d;
        best = { kind: 'edge', i };
      }
    }
    return best;
  };

  const endGrab = (): void => {
    grabRef.current = null;
    setGrab(null);
    setLoupeAt(null);
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    const s = stagePoint(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, s);
    if (pointers.current.size === 2) {
      // Second finger: this is a pinch, whatever the first finger was doing.
      endGrab();
      const [a, b] = [...pointers.current.values()];
      gesture.current = { view: viewRef.current, a, b };
      return;
    }
    if (pointers.current.size > 2) return;
    const g = findHandle(s);
    if (g) {
      grabRef.current = { grab: g, start: s, startPts: ptsRef.current.map((p) => ({ ...p })) as Quad };
      setGrab(g);
      const focus = g.kind === 'corner' ? ptsRef.current[g.i] : edgeMid(g.i, ptsRef.current);
      setLoupeAt({ x: s.x, y: s.y, src: focus });
      return;
    }
    gesture.current = { view: viewRef.current, a: s, b: null };
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (!pointers.current.has(e.pointerId)) return;
    const s = stagePoint(e);
    pointers.current.set(e.pointerId, s);
    const g = grabRef.current;
    if (g) {
      const d = { x: (s.x - g.start.x) / view.scale, y: (s.y - g.start.y) / view.scale };
      const next = g.startPts.map((p) => ({ ...p })) as Quad;
      const clamp = (p: Point): Point => ({ x: Math.min(source.width, Math.max(0, p.x)), y: Math.min(source.height, Math.max(0, p.y)) });
      if (g.grab.kind === 'corner') {
        next[g.grab.i] = clamp({ x: g.startPts[g.grab.i].x + d.x, y: g.startPts[g.grab.i].y + d.y });
      } else {
        const a = g.grab.i;
        const b = (a + 1) % 4;
        next[a] = clamp({ x: g.startPts[a].x + d.x, y: g.startPts[a].y + d.y });
        next[b] = clamp({ x: g.startPts[b].x + d.x, y: g.startPts[b].y + d.y });
      }
      setPts(next);
      const focus = g.grab.kind === 'corner' ? next[g.grab.i] : edgeMid(g.grab.i, next);
      setLoupeAt({ x: s.x, y: s.y, src: focus });
      return;
    }
    const ges = gesture.current;
    if (!ges) return;
    if (ges.b && pointers.current.size >= 2) {
      // Pinch: scale about the midpoint, and follow it.
      const [p, q] = [...pointers.current.values()];
      const d0 = Math.hypot(ges.b.x - ges.a.x, ges.b.y - ges.a.y) || 1;
      const d1 = Math.hypot(q.x - p.x, q.y - p.y);
      const k = d1 / d0;
      const m0 = { x: (ges.a.x + ges.b.x) / 2, y: (ges.a.y + ges.b.y) / 2 };
      const m1 = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      const scale = ges.view.scale * k;
      setView(clampView({ scale, tx: m1.x - (m0.x - ges.view.tx) * k, ty: m1.y - (m0.y - ges.view.ty) * k }));
      setZoomed(true);
    } else if (!ges.b) {
      setView(clampView({ ...ges.view, tx: ges.view.tx + (s.x - ges.a.x), ty: ges.view.ty + (s.y - ges.a.y) }));
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (pointers.current.has(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (grabRef.current) endGrab();
    if (pointers.current.size === 1) {
      // One finger of a pinch lifted: carry on as a pan from where it is.
      const [a] = [...pointers.current.values()];
      gesture.current = { view: viewRef.current, a, b: null };
    } else if (pointers.current.size === 0) {
      gesture.current = null;
    }
  };

  // The loupe canvas only exists while dragging; draw it once it is mounted.
  useEffect(() => {
    if (loupeAt) drawLoupe(loupeAt.src);
  }, [loupeAt, drawLoupe]);

  const valid = isConvex(pts);
  const screenPts = pts.map(toScreen);
  const poly = screenPts.map((p) => `${p.x},${p.y}`).join(' ');
  // Everything outside the outline is dimmed: a frame around the stage with the outline cut out.
  const mask = `M0 0H${stageSize.w}V${stageSize.h}H0Z M${screenPts.map((p) => `${p.x} ${p.y}`).join('L')}Z`;

  // Loupe sits above-left of the finger, flipped when near the top or the left edge.
  const loupeStyle = loupeAt
    ? {
        left: loupeAt.x < LOUPE + 40 ? loupeAt.x + 24 : loupeAt.x - LOUPE - 24,
        top: loupeAt.y < LOUPE + 40 ? loupeAt.y + 24 : loupeAt.y - LOUPE - 24,
      }
    : undefined;

  return (
    <>
      <TopBar left={{ icon: 'close', label: 'Cancel', onClick: onCancel, aria: 'Cancel' }} title="Fix the corners" />
      <div className="aos-fix-stage" ref={stageRef}>
        <canvas ref={photoRef} className="aos-fix-photo" style={{ width: stageSize.w, height: stageSize.h }} />
        <svg
          className="aos-fix-overlay"
          style={{ width: stageSize.w, height: stageSize.h }}
          viewBox={`0 0 ${stageSize.w} ${stageSize.h}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <path d={mask} fill="rgba(0,0,0,0.72)" fillRule="evenodd" />
          <polygon points={poly} fill={valid ? 'transparent' : 'rgba(227,6,19,0.25)'} stroke={valid ? '#FFFFFF' : '#E30613'} strokeWidth={2} />
          {[0, 1, 2, 3].map((i) => {
            const m = toScreen(edgeMid(i, pts));
            return <circle key={`e${i}`} className="aos-fix-handle" cx={m.x} cy={m.y} r={EDGE_R} fill="#FFFFFF" opacity={0.9} />;
          })}
          {screenPts.map((p, i) => (
            <circle key={`c${i}`} className="aos-fix-handle" cx={p.x} cy={p.y} r={grab?.kind === 'corner' && grab.i === i ? HANDLE_R + 4 : HANDLE_R} fill="#FFFFFF" stroke="#E30613" strokeWidth={4} />
          ))}
        </svg>
        {loupeAt ? (
          <div className="aos-fix-loupe" style={loupeStyle}>
            <canvas ref={loupeRef} />
          </div>
        ) : null}
        <button type="button" className="aos-fix-zoom" onClick={toggleZoom} aria-label={zoomed ? 'Show the whole photo' : 'Zoom in on the outline'}>
          <Icon name={zoomed ? 'zoomOut' : 'zoomIn'} size={22} />
          <span>{zoomed ? 'Whole photo' : 'Zoom in'}</span>
        </button>
        <div className="aos-stage-ui">
          <div className={`aos-hint ${valid ? '' : 'aos-warn'}`} role="status">
            <Icon name={valid ? 'move' : 'alert'} size={22} />
            <span>{valid ? 'Drag the corners onto the edges' : 'Corners must not cross'}</span>
          </div>
        </div>
      </div>
      <div className="aos-actions">
        <button type="button" className="aos-btn aos-primary" disabled={!valid} onClick={() => onDone(orderQuad(pts.map((p) => ({ ...p }))))}>
          <Icon name="check" size={22} />
          <span>Done</span>
        </button>
        <button
          type="button"
          className="aos-btn aos-ghost"
          onClick={() => {
            const q = initial.map((p) => ({ ...p })) as Quad;
            setPts(q);
            if (zoomed) setView(clampView(outlineView(q)));
          }}
        >
          Reset
        </button>
      </div>
    </>
  );
}
