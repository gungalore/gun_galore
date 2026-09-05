'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OVERLAY_WARNING } from '@/lib/scan/overlay';
import {
  Pt,
  Quad,
  isConvex,
  minInteriorAngle,
  orderQuad,
  quadArea,
  translateEdge,
} from '@/lib/scan/geometry';
import {
  containFit,
  loupeCrosshair,
  loupeSize,
  loupeSource,
  magnifierSpot,
} from '@/lib/scan/magnifier';
import {
  edgeLinesNear,
  fromLumaPt,
  magneticBand,
  snapCorner,
  snapEdge,
  toLumaQuad,
  type Luma,
} from '@/lib/scan/magnetic';

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

const ZOOM = 3.5;
/** Finger-sized. The visible dot is smaller; this is what you can grab. */
const GRAB = 44;
/**
 * The edge handles' grab pad. Smaller than a corner's on purpose: on a short
 * edge the midpoint sits within a thumb's width of both corners, and the
 * corner — the finer control — must stay the easier one to hit.
 */
const EDGE_GRAB = 36;
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
  /**
   * A downscaled luma copy of the SAME capture `src` shows, for magnetic
   * lines. Optional throughout: without it the editor behaves exactly as it
   * did before, which is the fallback for a capture we could not decode.
   *
   * Coordinates are the raster's own pixels — `quad` times `luma.scale`. The
   * conversion is never done by hand here; `toLumaQuad` and `fromLumaPt` own
   * it, so there is one place to be wrong.
   */
  luma?: Luma;
}

export default function CornerEditor({
  src,
  size,
  quad,
  onCancel,
  onApply,
  busy = false,
  luma,
}: CornerEditorProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [pts, setPts] = useState<Quad>(quad);
  const [dragging, setDragging] = useState<number | null>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  /**
   * Which corner the keyboard is on, so this works without a touchscreen.
   *
   * ⚠️ null, NOT 0. It started at 0, so the editor opened with a selection
   * ring drawn around the top-left corner when nothing was focused and the
   * arrow keys would have moved nothing — the one thing on screen telling the
   * member which corner they were about to move was wrong from first paint.
   */
  const [focused, setFocused] = useState<number | null>(null);

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

  /**
   * Where inside the grab pad the finger landed, in VIEW pixels.
   *
   * ⚠️ WITHOUT THIS THE CORNER JUMPS TO THE FINGERTIP. The 44px pad exists so
   * a thumb can grab a small dot without covering it — but the drag assigned
   * the pointer's ABSOLUTE position, so the first pixel of movement threw the
   * corner up to 22 view pixels out from under the dot, before the magnifier
   * had shown anything. The member then dragged it back blind with their thumb
   * over the destination. Touching a corner to look at it must not move it.
   *
   * ⚠️ VIEW SPACE, NOT IMAGE SPACE. `toImage` clamps to the photograph's
   * bounds, so an offset recorded after that conversion is truncated at
   * exactly the edge corners that matter most. A ref, not state, so the drag
   * effect's deps do not re-subscribe mid-drag.
   */
  const grab = useRef({ dx: 0, dy: 0 });

  /**
   * Which EDGE is being dragged, 0-3 for top, right, bottom, left.
   *
   * ⚠️ EIGHT HANDLES, NOT FOUR. Straightening one skewed side of an A4 page
   * cost two separate corner drags, each re-aimed through the loupe; every
   * scanner this one is measured against ships a handle on each edge as well.
   * An edge drag moves both of its corners by the finger's MOTION from where
   * it landed — the same rule as `grab` above, for the same reason — so
   * touching a handle to look at it moves nothing.
   */
  const [draggingEdge, setDraggingEdge] = useState<number | null>(null);
  const edgeStart = useRef<{ x: number; y: number; pts: Quad } | null>(null);

  // ────────────────────────────────────────────────────────────────
  // MAGNETIC LINES.
  //
  // Let go of a handle within a few pixels of a real document edge and it
  // lands ON the edge. While the handle is down, the lines it would land on
  // are drawn faintly, so the jump is something the member watched coming
  // rather than something that happened to them. The maths is all in
  // lib/scan/magnetic.ts and is tested there against synthetic pages.
  //
  // ⚠️ THE SNAP IS A TOGGLE, DEFAULT ON, AND THAT IS THE UNDO. A snap that
  // cannot be refused is a corner the member cannot place: they drop it where
  // they mean it, we move it, and their only recourse is to fight it drag
  // after drag. The alternative considered was a hold-still gesture — pause
  // 250ms before lifting to suppress the snap for that release — and it was
  // rejected because it is invisible: nothing on screen could tell them the
  // gesture exists, and a member holding still is exactly what a careful
  // member does anyway. A labelled button says what it does and stays said.
  //
  // ⚠️ THE KEYBOARD PATH NEVER SNAPS. An arrow key is a one-pixel deliberate
  // nudge; a member who has chosen to place a corner a pixel at a time has
  // already said they do not want it moved for them.
  // ────────────────────────────────────────────────────────────────
  const [snapOn, setSnapOn] = useState(true);
  const band = useMemo(() => (luma ? magneticBand(luma) : 0), [luma]);
  /** The current corners, readable from a rAF loop that does not re-subscribe. */
  const ptsRef = useRef<Quad>(pts);
  ptsRef.current = pts;
  /** Candidate lines under the finger, already in IMAGE coordinates. */
  const [hints, setHints] = useState<{ a: Pt; b: Pt; alpha: number }[]>([]);
  /** Where a snap just landed, so the ring can flash there. */
  const [flash, setFlash] = useState<{ at: Pt[]; n: number } | null>(null);
  const flashN = useRef(0);

  const tween = useRef<number | null>(null);
  const cancelTween = useCallback(() => {
    if (tween.current !== null) {
      cancelAnimationFrame(tween.current);
      tween.current = null;
    }
  }, []);

  /**
   * Slide the corners to `target` over 130ms.
   *
   * ⚠️ ANIMATED RATHER THAN SET. A corner that teleports on release reads as a
   * misplaced touch — the member sees the dot somewhere they did not put it
   * and has no way to know whether that was them or us. 130ms is long enough
   * to see the direction of travel and short enough that nobody waits for it.
   */
  const glideTo = useCallback(
    (target: Quad) => {
      cancelTween();
      const from = ptsRef.current;
      const t0 =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      const DUR = 130;
      const step = () => {
        const now =
          typeof performance !== 'undefined' ? performance.now() : Date.now();
        const k = Math.min(1, (now - t0) / DUR);
        const e = 1 - (1 - k) ** 3;
        setPts(
          from.map((p, i) => ({
            x: p.x + (target[i].x - p.x) * e,
            y: p.y + (target[i].y - p.y) * e,
          })) as Quad,
        );
        tween.current = k < 1 ? requestAnimationFrame(step) : null;
      };
      tween.current = requestAnimationFrame(step);
    },
    [cancelTween],
  );

  const clampPt = useCallback(
    (p: Pt): Pt => ({
      x: Math.max(0, Math.min(size.width, p.x)),
      y: Math.max(0, Math.min(size.height, p.y)),
    }),
    [size.width, size.height],
  );

  /**
   * The handle has been released. Snap it, if there is anything to snap to.
   *
   * Silent when there is not — magnetic.ts returns null rather than a
   * best-effort guess, and a snap that fires on bare desk would be worse than
   * none because the member would stop trusting the ones that are right.
   */
  const settle = useCallback(
    (kind: 'corner' | 'edge', index: number) => {
      if (!luma || !snapOn) return;
      const cur = ptsRef.current;
      const lq = toLumaQuad(cur, luma.scale);
      const next = [...cur] as Quad;
      const landed: Pt[] = [];
      if (kind === 'corner') {
        const p = snapCorner(luma, lq, index, band);
        if (!p) return;
        next[index] = clampPt(fromLumaPt(p, luma.scale));
        landed.push(next[index]);
      } else {
        const r = snapEdge(luma, lq, index, band);
        if (!r) return;
        const ia = index;
        const ib = (index + 1) % 4;
        next[ia] = clampPt(fromLumaPt(r.a, luma.scale));
        next[ib] = clampPt(fromLumaPt(r.b, luma.scale));
        landed.push(next[ia], next[ib]);
      }
      // ⚠️ THE SAME VALIDATION APPLY USES. A snap is bounded by the band, so
      // in principle it cannot fold the quad — but "in principle" is how the
      // bow-tie got in last time, and refusing costs one comparison.
      if (!isConvex(next) || minInteriorAngle(next) < 15) return;
      // Below half a view pixel nobody can see it move, and flashing a ring
      // for a correction that is not visible just looks like a glitch.
      if (!landed.some((p, i) => {
        const was = kind === 'corner' ? cur[index] : cur[(index + i) % 4];
        return Math.hypot(p.x - was.x, p.y - was.y) * fit > 0.5;
      })) {
        return;
      }
      glideTo(next);
      flashN.current += 1;
      setFlash({ at: landed, n: flashN.current });
    },
    [luma, snapOn, band, clampPt, glideTo, fit],
  );

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 500);
    return () => window.clearTimeout(t);
  }, [flash]);

  useEffect(() => cancelTween, [cancelTween]);

  /**
   * The lines the member is about to land on, redrawn while a handle is down.
   *
   * ⚠️ ON A rAF LOOP READING A REF, NOT ON EVERY pts CHANGE. Measured on a
   * 900x1200 raster with band 27 — what a portrait A4 photograph actually
   * decodes to — the two edges of a corner drag cost 2.1ms. Fine once a frame;
   * not fine on every pointermove, which on a 120Hz phone arrives more often
   * than a frame and would compete with the drag itself on the one thread that
   * has to keep up with the finger. Skipping the fit while the quad has not
   * moved a whole raster pixel takes most of the rest — a finger resting still
   * then costs nothing at all.
   */
  useEffect(() => {
    if (!luma || !snapOn) {
      setHints([]);
      return;
    }
    const which =
      dragging !== null
        ? [(dragging + 3) % 4, dragging]
        : draggingEdge !== null
          ? [draggingEdge]
          : null;
    if (!which) {
      setHints([]);
      return;
    }
    let raf = 0;
    let last: Quad | null = null;
    const run = () => {
      const q = ptsRef.current;
      const moved =
        !last ||
        last.some(
          (p, i) => Math.hypot(p.x - q[i].x, p.y - q[i].y) * luma.scale > 1,
        );
      if (moved) {
        last = q;
        const lq = toLumaQuad(q, luma.scale);
        const out: { a: Pt; b: Pt; alpha: number }[] = [];
        for (const e of which) {
          const lines = edgeLinesNear(luma, lq, e, band);
          lines.forEach((l, rank) => {
            out.push({
              a: fromLumaPt(l.a, luma.scale),
              b: fromLumaPt(l.b, luma.scale),
              // The runner-up is drawn fainter rather than hidden: when the
              // winner is the wrong one, seeing the other candidate is what
              // tells the member to turn Snap off instead of wondering.
              alpha: rank === 0 ? 0.45 : 0.22,
            });
          });
        }
        setHints(out);
      }
      raf = requestAnimationFrame(run);
    };
    raf = requestAnimationFrame(run);
    return () => {
      cancelAnimationFrame(raf);
      setHints([]);
    };
  }, [luma, snapOn, band, dragging, draggingEdge]);

  const moveTo = useCallback(
    (i: number, clientX: number, clientY: number) => {
      const el = boxRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // Subtract the grab offset BEFORE converting, so the clamp inside
      // toImage stays the last operation and the corner still cannot leave
      // the photograph.
      const p = toImage(
        clientX - r.left - grab.current.dx,
        clientY - r.top - grab.current.dy,
      );
      setPts((cur) => {
        const next = [...cur] as Quad;
        next[i] = p;
        return next;
      });
    },
    [toImage],
  );

  /**
   * Which corner the magnifier is currently showing — NOT the same thing as
   * which corner is selected.
   *
   * ⚠️ IT USED TO BE THE SAME THING, AND THE LOUPE THEN STAYED ON SCREEN AFTER
   * THE FINGER LEFT. The loupe was derived from `dragging ?? focused`, so that
   * a keyboard member nudging a corner with arrow keys could see where it
   * landed — they had no magnifier at all before that. But a TOUCH also leaves
   * the corner focused, so lifting the finger ended the drag and left the
   * magnifier sitting there over the photograph until something else was
   * touched. Operator, 2026-08-25: "when I set a corner the magnifier stays
   * behind when I lift my finger."
   *
   * So the two are separated: `active` still drives the dot's own styling, and
   * this drives the loupe. It lingers 500ms after the finger lifts — long
   * enough to see where the corner actually landed, which is the whole reason
   * to look — and then goes. The keyboard path keeps its magnifier for as long
   * as the corner is focused, because there is no "lift" to hide it on.
   */
  const [loupeOn, setLoupeOn] = useState<number | null>(null);
  const hideTimer = useRef<number | null>(null);

  const showLoupe = useCallback((i: number) => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setLoupeOn(i);
  }, []);

  const fadeLoupe = useCallback((delay: number) => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null;
      setLoupeOn(null);
    }, delay);
  }, []);

  // A pending timer outliving the editor would setState on an unmounted tree.
  useEffect(
    () => () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    },
    [],
  );

  // Pointer events on the WINDOW while dragging, so a finger that slides off
  // the image — which is exactly what happens at a corner — keeps dragging.
  useEffect(() => {
    if (dragging === null) return;
    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      moveTo(dragging, e.clientX, e.clientY);
    };
    const onUp = () => {
      setDragging(null);
      // Snap FIRST, so the magnifier is still up while the corner glides the
      // last few pixels — the loupe is the only place the member can see
      // whether it landed on the edge or beside it.
      settle('corner', dragging);
      // The corner has just landed. Hold the magnifier for half a second so
      // the member can see WHERE it landed, then let it go.
      fadeLoupe(500);
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, moveTo, fadeLoupe, settle]);

  // The same, for an edge. Its own effect so the corner path above stays
  // exactly as it was.
  const sizeW = size.width;
  const sizeH = size.height;
  useEffect(() => {
    if (draggingEdge === null) return;
    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      const start = edgeStart.current;
      if (!start || !(fit > 0)) return;
      setPts(
        translateEdge(
          start.pts,
          draggingEdge,
          (e.clientX - start.x) / fit,
          (e.clientY - start.y) / fit,
          { width: sizeW, height: sizeH },
        ),
      );
    };
    const onUp = () => {
      setDraggingEdge(null);
      edgeStart.current = null;
      settle('edge', draggingEdge);
      fadeLoupe(500);
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [draggingEdge, fit, sizeW, sizeH, fadeLoupe, settle]);

  const viewPts = pts.map(toView);
  /** Midpoint of edge i (corner i to corner i+1), in view pixels. */
  const edgeMids = viewPts.map((p, i) => {
    const q = viewPts[(i + 1) % 4];
    return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  });
  // ⚠️ FOCUS COUNTS AS ACTIVE, so the keyboard path gets a magnifier too. It
  // had none: the loupe existed only while a finger was down, which meant the
  // one member who cannot see where the dot landed — the one nudging it with
  // arrow keys — was the one placing corners blind. magnifierSpot, loupeSource
  // and loupeCrosshair are pure and take any point, so this costs nothing.
  const active = dragging ?? focused ?? -1;
  // ⚠️ SIZED TO THE FRAME, NOT FIXED AT 148. A fixed loupe leaves 2px of
  // clearance on a 320px-wide phone and touches the dot at 280 — parking the
  // magnifier under the finger it exists to see past. See loupeSize.
  const LOUPE = loupeSize({ width: view.w, height: view.h });
  // The LOUPE follows `loupeOn`, not `active` — see the note on loupeOn. A
  // corner stays selected after the finger lifts; the magnifier does not.
  const lens = loupeOn ?? -1;
  // 0-3 is a corner; 4-7 is an edge, magnified at its midpoint — which is
  // where a whole side either sits on the printed edge or does not.
  const lensImg: Pt | null =
    lens < 0
      ? null
      : lens < 4
        ? pts[lens]
        : {
            x: (pts[lens - 4].x + pts[(lens - 3) % 4].x) / 2,
            y: (pts[lens - 4].y + pts[(lens - 3) % 4].y) / 2,
          };
  const loupeAt =
    lensImg && view.w > 0
      ? magnifierSpot(toView(lensImg), { width: view.w, height: view.h }, LOUPE)
      : null;
  // Image pixels to loupe pixels. ZOOM is relative to what is ON SCREEN, so
  // "3.5x" means three and a half times the size the member is already
  // looking at — not some ratio of the raw file they have no feel for.
  const mag = ZOOM * fit;
  const loupeSrc = lensImg ? loupeSource(lensImg, size, LOUPE, mag) : null;
  const cross = lensImg ? loupeCrosshair(lensImg, size, LOUPE, mag) : null;

  const CORNER_NAMES = ['top left', 'top right', 'bottom right', 'bottom left'];
  const EDGE_NAMES = ['top', 'right', 'bottom', 'left'];

  /**
   * Is the shape on screen something we can actually cut a document out of?
   *
   * ⚠️ NOTHING VALIDATED THIS. Dragging the top-left corner past the top-right
   * draws a bow-tie, and Apply took it: `orderQuad` silently re-sorted the four
   * points, so the rectangle produced was NOT the shape the member drew, and
   * nothing said so. I checked the arithmetic rather than guessing — neither a
   * triangle nor a one-pixel sliver throws; both solve to a valid homography
   * and both produce garbage.
   *
   * The three tests are the ones the detector already applies to its own quads
   * (detect.ts), minus the strictness a machine guess deserves and a member's
   * deliberate placement does not: 15° rather than 50°, because a document
   * photographed at a genuinely oblique angle is a real thing somebody may be
   * correcting, and refusing it would be refusing the honest case.
   *
   * ⚠️ THE DRAWN ORDER, NOT THE SORTED ONE. Validating orderQuad(pts) would let
   * a bow-tie through by silently repairing it — which is the behaviour being
   * fixed.
   */
  const tooSmall = Math.abs(quadArea(pts)) < size.width * size.height * 0.01;
  const crossed = !isConvex(pts) || minInteriorAngle(pts) < 15;
  const invalid = crossed || tooSmall;

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
          // ⚠️ NO TEXT SELECTION. A press that lands slightly OFF a corner
          // misses the grab pad, so nothing calls preventDefault, and the drag
          // that follows is read by the browser as "select from here" — the
          // whole editor floods translucent blue and the member's next tap
          // just moves the selection instead of the corner. Operator,
          // 2026-08-25: "sometimes when I press just a little off the corner
          // aligner it selects the whole page and makes it that transparent
          // blue."
          //
          // touchAction and the buttons' own preventDefault do not cover it:
          // the first is about scrolling, the second only fires when the press
          // actually hits a button. Nothing in here is text a member would
          // want to select, so the whole surface opts out.
          userSelect: 'none',
          WebkitUserSelect: 'none',
          // iOS long-press otherwise raises the copy/share sheet over the
          // photograph mid-drag.
          WebkitTouchCallout: 'none',
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
                {/* ⚠️ evenodd. With SVG's default nonzero winding rule, a
                    bow-tie's two lobes BOTH read as "inside the crop" — so the
                    dimming showed the member a selection that could never be
                    cut. evenodd draws the self-intersection honestly. */}
                <polygon
                  points={viewPts.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="black"
                  fillRule="evenodd"
                />
              </mask>
            </defs>
            <rect
              width={view.w}
              height={view.h}
              // ⚠️ NEARLY SOLID, NOT FULLY. Operator asked for everything
              // outside the crop blacked out, and at 0.9 it reads as black on
              // a phone. Not 1.0 on purpose: a member whose quad came back
              // SMALLER than the document has to see the real edge in order to
              // drag out to it, and a solid mask hides exactly the thing they
              // are reaching for. Ten per cent is enough to make an edge
              // findable and not enough to look like a preview.
              fill="rgba(0,0,0,0.9)"
              mask="url(#gg-quad-mask)"
            />
            {/* THE MAGNETIC LINES. Drawn UNDER the quad outline and the
                handles, thin and semi-transparent, so they read as "this is
                what is there" rather than as another thing to drag. Dashed
                as well as faint: a solid blue line beside a solid blue quad
                edge is two of the same object. */}
            {hints.map((h, i) => {
              const p = toView(h.a);
              const q = toView(h.b);
              return (
                <line
                  key={`hint-${i}`}
                  x1={p.x}
                  y1={p.y}
                  x2={q.x}
                  y2={q.y}
                  stroke={`rgba(77,163,255,${h.alpha})`}
                  strokeWidth={1.5}
                  strokeDasharray="6 5"
                />
              );
            })}
            <polygon
              points={viewPts.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={BLUE}
              strokeWidth={2}
            />
            {/* The side being dragged, picked out so the eye follows the
                whole edge and not just the handle in the middle of it. */}
            {draggingEdge !== null && (
              <line
                x1={viewPts[draggingEdge].x}
                y1={viewPts[draggingEdge].y}
                x2={viewPts[(draggingEdge + 1) % 4].x}
                y2={viewPts[(draggingEdge + 1) % 4].y}
                stroke="#fff"
                strokeWidth={3}
              />
            )}
            {/* Edge handles: a small filled dot at each midpoint. Smaller
                than the corner rings so the two read as different controls,
                and filled because there is no edge pixel under it to keep
                visible — the edge runs THROUGH it. */}
            {edgeMids.map((m, i) => (
              <g key={`e${i}`}>
                <circle
                  cx={m.x}
                  cy={m.y}
                  r={draggingEdge === i ? 9 : 7}
                  fill="none"
                  stroke="rgba(0,0,0,0.55)"
                  strokeWidth={5}
                />
                <circle
                  cx={m.x}
                  cy={m.y}
                  r={draggingEdge === i ? 9 : 7}
                  fill={draggingEdge === i ? BLUE : '#fff'}
                  stroke={draggingEdge === i ? '#fff' : BLUE}
                  strokeWidth={2}
                />
              </g>
            ))}
            {viewPts.map((p, i) => (
              <g key={i}>
                {/* ⚠️ A RING AT REST, NOT A CAP. A filled 20px dot sits exactly
                    over the pixel the member is trying to judge — this file
                    already makes that argument about its own crosshair ("a
                    crosshair that covers the corner it is pointing at defeats
                    the loupe") and then covered the corner anyway. Open in the
                    middle, the corner stays visible without being touched.
                    Solid only while active, where the loupe is showing the
                    true pixel a few centimetres away.
                    The dark halo is the same trick AimFrame uses: blue on a
                    blue-grey desk is otherwise invisible. */}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={active === i ? 13 : 10}
                  fill="none"
                  stroke="rgba(0,0,0,0.55)"
                  strokeWidth={active === i ? 7 : 6}
                />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={active === i ? 13 : 10}
                  fill={active === i ? BLUE : 'none'}
                  stroke={active === i ? '#fff' : BLUE}
                  strokeWidth={active === i ? 2 : 3}
                />
                {focused === i && dragging === null && (
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
            {/* THE SNAP FLASH. A ring that expands and fades once, wherever
                a corner just landed.

                ⚠️ SMIL, NOT A CSS KEYFRAME. This file carries no stylesheet
                — every rule in it is an inline style — and globals.css is
                not reachable from a component that portals over the camera.
                Keyed on the flash count so each snap remounts the element
                and the animation runs again; without the key React reuses
                the node and the second snap flashes nothing. */}
            {flash?.at.map((p, i) => {
              const v = toView(p);
              // Two passes, dark under light — the same halo trick the
              // crosshair and the aim corners use. A white ring on white
              // paper, which is where a snap most often lands, is otherwise
              // invisible at exactly the moment it has something to say.
              return [
                { c: 'rgba(0,0,0,0.6)', w: 5 },
                { c: '#fff', w: 2.5 },
              ].map((pass, pi) => (
                <circle
                  key={`flash-${flash.n}-${i}-${pi}`}
                  cx={v.x}
                  cy={v.y}
                  r={13}
                  fill="none"
                  stroke={pass.c}
                  strokeWidth={pass.w}
                >
                  <animate
                    attributeName="r"
                    from="13"
                    to="30"
                    dur="0.45s"
                    fill="freeze"
                  />
                  <animate
                    attributeName="opacity"
                    from="0.95"
                    to="0"
                    dur="0.45s"
                    fill="freeze"
                  />
                </circle>
              ));
            })}
          </svg>
        )}

        {/* The edge grab targets. Rendered BEFORE the corners: later siblings
            sit on top, so where a very short edge puts its midpoint pad under
            a corner pad, the corner — the finer control — wins the hit test.
            The pad is smaller than a corner's for the same reason. */}
        {view.w > 0 &&
          edgeMids.map((m, i) => (
            <button
              key={`edge-${i}`}
              type="button"
              aria-label={`Move the ${EDGE_NAMES[i]} edge`}
              onBlur={() => fadeLoupe(0)}
              onPointerDown={(e) => {
                e.preventDefault();
                (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
                // A glide still running from the last snap would fight this
                // drag for `pts` and the handle would stutter under the
                // finger.
                cancelTween();
                edgeStart.current = { x: e.clientX, y: e.clientY, pts };
                e.currentTarget.focus({ preventScroll: true });
                setFocused(null);
                setDraggingEdge(i);
                showLoupe(4 + i);
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
                if (!move || !(fit > 0)) return;
                e.preventDefault();
                showLoupe(4 + i);
                setPts((cur) =>
                  translateEdge(cur, i, move[0] / fit, move[1] / fit, size),
                );
              }}
              style={{
                position: 'absolute',
                left: m.x - EDGE_GRAB / 2,
                top: m.y - EDGE_GRAB / 2,
                width: EDGE_GRAB,
                height: EDGE_GRAB,
                borderRadius: '50%',
                border: 'none',
                background: 'transparent',
                padding: 0,
                touchAction: 'none',
                cursor: 'grab',
              }}
            />
          ))}

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
              onBlur={() => {
                setFocused((f) => (f === i ? null : f));
                // Nothing is being placed any more.
                fadeLoupe(0);
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
                // How far the finger is from the corner itself. Held for the
                // life of the drag so the corner tracks the finger's MOTION
                // rather than snapping to its position — see `grab` above.
                cancelTween();
                const box = boxRef.current?.getBoundingClientRect();
                grab.current = box
                  ? { dx: e.clientX - box.left - p.x, dy: e.clientY - box.top - p.y }
                  : { dx: 0, dy: 0 };
                // ⚠️ preventDefault() ABOVE SUPPRESSES THE BUTTON'S OWN FOCUS,
                // which left `focused` permanently decoupled from the real
                // activeElement. preventScroll is load-bearing: these buttons
                // are absolutely positioned inside an overflow:hidden box and a
                // corner at x=0 sits at left:-22, so a focus-induced scroll
                // would slide the quad off the photograph.
                e.currentTarget.focus({ preventScroll: true });
                setFocused(i);
                setDragging(i);
                showLoupe(i);
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
                // The keyboard path has no "lift" to hide on, so its magnifier
                // stays up for as long as the corner is focused.
                showLoupe(i);
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

      {invalid && (
        <p
          id="gg-corner-invalid"
          role="status"
          style={{
            margin: '8px 16px 0',
            padding: '8px 10px',
            fontSize: 13,
            borderRadius: 6,
            background: 'rgba(212,154,58,0.14)',
            // Constant, not var(--warning): this sits on the viewfinder's black.
            borderLeft: `3px solid ${OVERLAY_WARNING}`,
            color: '#fff',
          }}
        >
          {crossed
            ? 'Those corners cross over each other, so we cannot cut a document out of them. Drag them back into the four corners of the page.'
            : 'That area is too small to read. Drag the corners out to the edges of the document.'}
        </p>
      )}

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
        {luma && snapOn
          ? ' Let go near an edge and the corner jumps onto it — turn Snap off to place it exactly.'
          : ''}
      </p>

      <div
        style={{
          display: 'flex',
          gap: 10,
          padding: '10px 16px max(16px, env(safe-area-inset-bottom))',
        }}
      >
        {/* ⚠️ ALL THREE GO QUIET TOGETHER. Cancel used to stay live during a
            re-cut, and pressing it unmounted the editor mid-flight — which put
            the live camera back over the member's photograph, the exact flash
            the busy state exists to prevent. */}
        <button type="button" onClick={onCancel} disabled={busy} style={btn}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            cancelTween();
            setPts(quad);
          }}
          disabled={busy}
          style={btn}
          // ⚠️ NOT aria-label. An accessible name that replaces the visible
          // one leaves a speech-control user saying "Reset" at a button whose
          // only name is a sentence. The description sits beside it instead.
          title="Put the corners back where we found them"
        >
          Reset
        </button>
        {luma && (
          <button
            type="button"
            onClick={() => setSnapOn((v) => !v)}
            disabled={busy}
            // aria-pressed, not a checkbox: this is a mode the button is in,
            // and a screen reader should say "Snap, pressed" rather than
            // making the member hunt for a control's label.
            aria-pressed={snapOn}
            title={
              snapOn
                ? 'Corners jump onto the edge of the document when you let go. Turn this off to place them exactly where you drop them.'
                : 'Corners stay exactly where you drop them.'
            }
            style={{
              ...btn,
              padding: '0 12px',
              borderColor: snapOn ? BLUE : 'rgba(255,255,255,0.35)',
              color: snapOn ? BLUE : '#fff',
            }}
          >
            {snapOn ? 'Snap ✓' : 'Snap'}
          </button>
        )}
        <div style={{ flex: 1 }} />
        {/* ⚠️ aria-disabled, NOT disabled. A plain disabled button cannot take
            focus, so a screen-reader member tabbing to the end of this editor
            would find nothing there and no explanation of why. This one is
            reachable and describes its own refusal. */}
        <button
          type="button"
          disabled={busy}
          aria-disabled={invalid || undefined}
          aria-describedby={invalid ? 'gg-corner-invalid' : undefined}
          onClick={() => {
            if (invalid || busy) return;
            onApply(orderQuad([...pts]));
          }}
          style={{
            ...btn,
            background: 'var(--red)',
            border: 'none',
            opacity: invalid ? 0.5 : 1,
          }}
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
