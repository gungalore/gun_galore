'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

// ────────────────────────────────────────────────────────────────────
// THE TRIM TOOL — a fixed frame, with the photograph moving behind it.
//
// Operator, 2026-08-21: "we should have a fixed box. One that will fit the
// space available for a image so the user can trim and adjust their image to
// fit the box... So the image can be dragged and zoomed. But there where the
// fixed red box meets the image is where its going to be trimmed and the
// remainder of the image that is inside the box will be used so it will
// always fit perfectly."
//
// Which is the right way round, and it replaced a free-form box built first. A
// box the applicant could reshape meant the cover was a different shape for
// every pack, and it moved a decision about the DOCUMENT'S layout onto
// somebody who was only trying to point at their rifle. The frame is ours;
// what goes inside it is theirs.
//
// ⚠️ THE PHOTOGRAPH CAN NEVER BE SMALLER THAN THE FRAME. Zoom is clamped at the
// scale that just covers the box, and panning is clamped so an edge can never
// enter it. That clamp is the whole of "it will always fit perfectly" —
// everything else here is arithmetic in service of it.
//
// ⚠️ AND WHAT YOU SEE IS WHAT PRINTS. The box is locked to the cover frame's
// exact ratio, which the SERVER sends rather than this file assuming, and the
// crop maps straight back to source pixels. Nothing re-crops downstream.
// ────────────────────────────────────────────────────────────────────

export interface CropLimits {
  /** Width / height of the frame on the cover. The box locks to this. */
  aspect: number;
  /** Printed size, for the readout. */
  frameMm: { w: number; h: number };
  maxPx: { w: number; h: number };
}

/** How far past "just covers the frame" somebody may zoom in. */
const MAX_ZOOM = 6;

/**
 * Source pixels the crop must keep, and the point below which it looks soft.
 *
 * ⚠️ THE HARD FLOOR MATCHES THE SERVER'S. checkCoverPhoto rejects anything
 * under 400 px wide, and without this the tool would happily let somebody
 * frame a crop, press the button, and collect a rejection from an endpoint
 * they never saw — for a rule nothing on screen had mentioned. The button goes
 * dead instead, and says why.
 *
 * ⚠️ AND ZOOM IS WHAT BREACHES IT, which is not obvious. Zooming in does not
 * add pixels; it takes FEWER source pixels and prints them at the same width.
 * Zoomed to 2.5x, a 960 px stock photograph yields a 193 px crop — 57 dpi
 * across the frame, a visible blur on a document going to the police, and the
 * applicant's only clue would have been that it looked fine on a screen.
 */
const MIN_CROP_PX = 400;
const SOFT_CROP_PX = 900;

export default function MotivationCoverCropper({
  file,
  limits,
  onCancel,
  onDone,
}: {
  file: File;
  limits: CropLimits;
  onCancel: () => void;
  onDone: (blob: Blob) => void;
}) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Scale as a MULTIPLE OF COVER — 1 exactly fills the frame. */
  const [zoom, setZoom] = useState(1);
  /** Centre of the frame, in source-image pixels. */
  const [centre, setCentre] = useState({ x: 0, y: 0 });

  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });

  // ── Load ──────────────────────────────────────────────────────────
  //
  // `imageOrientation: 'from-image'` is load-bearing: without it a photograph
  // taken in portrait on a phone arrives rotated 90°, because the rotation
  // lives in EXIF rather than in the pixels — and the crop somebody sets on a
  // sideways rifle is not the crop they meant. The <img> below applies EXIF
  // itself, so the two agree.
  useEffect(() => {
    let live = true;
    let made: ImageBitmap | null = null;
    // ⚠️ CLEARED FIRST. Choosing a SECOND photograph runs the previous
    // cleanup, which calls close() on the bitmap still sitting in state — and
    // a closed ImageBitmap reports 0 × 0. Every measurement below then divided
    // by zero and React was handed `left: Infinity` and `width: NaN`. Clearing
    // the state is half the fix; `ready` below is the half that does not
    // depend on getting the ordering right.
    setBitmap(null);
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    createImageBitmap(file, { imageOrientation: 'from-image' })
      .then((b) => {
        if (!live) {
          b.close();
          return;
        }
        made = b;
        setBitmap(b);
        setZoom(1);
        setCentre({ x: b.width / 2, y: b.height / 2 });
      })
      .catch(() =>
        setError(
          'We could not open that image. Please try a different photograph, or save it as a JPEG first.',
        ),
      );
    return () => {
      live = false;
      if (made) made.close();
      URL.revokeObjectURL(url);
    };
  }, [file]);

  // ── Stage ─────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [bitmap]);

  /**
   * A bitmap we can safely measure.
   *
   * ⚠️ A CLOSED ImageBitmap IS 0 x 0, NOT NULL. Nothing about it says it has
   * been released — it is a live object whose dimensions have silently become
   * zero — so every guard here tests the dimensions rather than the reference.
   */
  const ready = bitmap && bitmap.width > 0 && bitmap.height > 0 ? bitmap : null;

  /** The red box: fixed, centred, the cover frame's exact proportions. */
  const frame = (() => {
    if (!stage.w || !stage.h) return null;
    const pad = 24;
    const availW = stage.w - pad * 2;
    const availH = stage.h - pad * 2;
    let w = availW;
    let h = w / limits.aspect;
    if (h > availH) {
      h = availH;
      w = h * limits.aspect;
    }
    return { x: (stage.w - w) / 2, y: (stage.h - h) / 2, w, h };
  })();

  /**
   * Screen pixels per source pixel at zoom 1 — the "just covers" scale.
   *
   * ⚠️ max, NOT min. `min` would fit the whole picture inside the frame and
   * leave gaps at two edges; `max` fills it. Everything below is clamped
   * against this, which is what makes an under-filled frame unreachable rather
   * than merely discouraged.
   */
  const coverScale =
    ready && frame
      ? Math.max(frame.w / ready.width, frame.h / ready.height)
      : 1;
  const scale = coverScale * zoom;

  /** How much of the source the frame shows, in source pixels. */
  const viewW = frame ? frame.w / scale : 0;
  const viewH = frame ? frame.h / scale : 0;

  // What this crop would actually print at.
  const outPx = Math.min(limits.maxPx.w, Math.round(viewW));
  const dpi = outPx / (limits.frameMm.w / 25.4);
  const tooSmall = Boolean(ready) && outPx < MIN_CROP_PX;
  const soft = Boolean(ready) && !tooSmall && outPx < SOFT_CROP_PX;

  /** Keep the frame inside the picture, whatever the zoom. */
  const clampCentre = useCallback(
    (c: { x: number; y: number }, vw: number, vh: number) => {
      if (!ready) return c;
      const halfW = vw / 2;
      const halfH = vh / 2;
      return {
        // A hair of tolerance: at zoom 1 the covering dimension is exactly the
        // image, and floating-point drift there would otherwise pin the centre
        // one sub-pixel off and show a hairline of background.
        x:
          vw >= ready.width - 0.001
            ? ready.width / 2
            : Math.min(ready.width - halfW, Math.max(halfW, c.x)),
        y:
          vh >= ready.height - 0.001
            ? ready.height / 2
            : Math.min(ready.height - halfH, Math.max(halfH, c.y)),
      };
    },
    [ready],
  );

  useEffect(() => {
    if (!ready || !viewW || !viewH) return;
    setCentre((c) => clampCentre(c, viewW, viewH));
    // Re-clamped whenever the visible window changes size — zoom, or a resize.
  }, [ready, clampCentre, viewW, viewH]);

  // ── Dragging the photograph ───────────────────────────────────────
  const drag = useRef<{
    x: number;
    y: number;
    c: { x: number; y: number };
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!ready) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, c: centre };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !ready) return;
    // Dragging RIGHT moves the picture right, so the window moves LEFT.
    setCentre(
      clampCentre(
        {
          x: d.c.x - (e.clientX - d.x) / scale,
          y: d.c.y - (e.clientY - d.y) / scale,
        },
        viewW,
        viewH,
      ),
    );
  };

  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!ready) return;
    setZoom((z) =>
      Math.min(
        MAX_ZOOM,
        Math.max(1, +(z * (e.deltaY > 0 ? 0.9 : 1.1)).toFixed(3)),
      ),
    );
  };

  // ── Result ────────────────────────────────────────────────────────
  const apply = async () => {
    if (!ready || !frame) return;
    setBusy(true);
    setError(null);
    try {
      // The window, in source pixels — mapped straight back from the frame.
      const sw = Math.max(1, Math.round(viewW));
      const sh = Math.max(1, Math.round(viewH));
      const sx = Math.round(centre.x - viewW / 2);
      const sy = Math.round(centre.y - viewH / 2);

      // ⚠️ THE OUTPUT IS THE FRAME'S EXACT RATIO, always. Deriving the height
      // from the width rather than from the rounded source window means
      // rounding on sx/sy/sw/sh can never leave the stored file a pixel
      // off-shape — which is the one way `cover` on the server could still
      // trim something the applicant thought they had kept.
      const outW = Math.min(limits.maxPx.w, Math.max(1, sw));
      const outH = Math.max(1, Math.round(outW / limits.aspect));

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas unavailable');
      // A white ground, not transparent: a PNG with an alpha channel flattens
      // to black inside a PDF, which would put a black rectangle on the cover.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, outW, outH);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(ready, sx, sy, sw, sh, 0, 0, outW, outH);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('could not encode'))),
          'image/jpeg',
          0.85,
        );
      });
      onDone(blob);
    } catch {
      setError('We could not prepare that photograph. Please try another one.');
    } finally {
      setBusy(false);
    }
  };

  // Where the photograph sits on screen, given the window it is showing.
  const imgStyle =
    ready && frame
      ? {
          left: frame.x + frame.w / 2 - centre.x * scale,
          top: frame.y + frame.h / 2 - centre.y * scale,
          width: ready.width * scale,
          height: ready.height * scale,
        }
      : null;

  return (
    <div className="mt-3 rounded border border-[var(--border)] p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium">Set the trim</h4>
        <p className="text-xs text-[var(--text-secondary)]">
          Drag the photograph and zoom until the red box holds what you want.
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--red)]">
          {error}
        </p>
      )}

      <div
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
        data-testid="crop-stage"
        className="relative mt-3 h-[300px] w-full touch-none overflow-hidden rounded bg-[#1b1b1b]"
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
      >
        {imgStyle && objectUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={objectUrl}
            alt=""
            draggable={false}
            data-testid="crop-image"
            className="pointer-events-none absolute max-w-none select-none"
            style={imgStyle}
          />
        )}
        {frame && (
          <>
            {/* EVERYTHING OUTSIDE THE FRAME, DIMMED — IN FOUR PANELS.
                ⚠️ IT WAS A 9999px SPREAD box-shadow, AND IT COULD NEVER PAINT.
                globals.css opens with an unscoped
                `* { box-shadow: none !important }`, so every raw box-shadow in
                this app is dead unless the element carries .gg-tile — and a
                .gg-tile here would draw the house card elevation, not a
                blackout. The dimming has therefore never appeared, and the
                comment above it blamed an inset-0 that was removed to fix it.
                Four absolutely-positioned panels around the frame do the same
                job with plain backgrounds nothing can switch off. */}
            {(
              [
                { left: 0, top: 0, right: 0, height: frame.y },
                { left: 0, top: frame.y + frame.h, right: 0, bottom: 0 },
                { left: 0, top: frame.y, width: frame.x, height: frame.h },
                {
                  left: frame.x + frame.w,
                  top: frame.y,
                  right: 0,
                  height: frame.h,
                },
              ] as const
            ).map((box, i) => (
              <div
                key={`dim-${i}`}
                className="pointer-events-none absolute"
                style={{ ...box, background: 'rgba(0,0,0,0.55)' }}
              />
            ))}
            <div
              data-testid="crop-frame"
              className="pointer-events-none absolute"
              style={{
                left: frame.x,
                top: frame.y,
                width: frame.w,
                height: frame.h,
                // ⚠️ THE TOKEN, NOT A LOOKALIKE. #e01b24 is a different red
                // from the brand's #C8102E and sat one control away from
                // buttons drawn in the real one.
                border: '2px solid var(--red)',
              }}
            >
              {/* Thirds, faint — the ordinary cue for placing a subject. */}
              <div className="absolute inset-0 opacity-30">
                <div className="absolute left-1/3 top-0 h-full w-px bg-white" />
                <div className="absolute left-2/3 top-0 h-full w-px bg-white" />
                <div className="absolute left-0 top-1/3 h-px w-full bg-white" />
                <div className="absolute left-0 top-2/3 h-px w-full bg-white" />
              </div>
            </div>
          </>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => setZoom((z) => Math.max(1, +(z - 0.25).toFixed(2)))}
            className="h-8 w-8 rounded border border-[var(--border)] text-lg leading-none"
          >
            −
          </button>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.05}
            value={zoom}
            aria-label="Zoom"
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-36"
          />
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() =>
              setZoom((z) => Math.min(MAX_ZOOM, +(z + 0.25).toFixed(2)))
            }
            className="h-8 w-8 rounded border border-[var(--border)] text-lg leading-none"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              if (ready) setCentre({ x: ready.width / 2, y: ready.height / 2 });
            }}
            className="text-xs text-[var(--text-secondary)] underline"
          >
            Reset
          </button>
        </div>

        <p className="text-xs text-[var(--text-secondary)]">
          The box prints {limits.frameMm.w} × {limits.frameMm.h} mm on the cover
          {ready ? ` · about ${Math.round(dpi)} dpi` : ''}
        </p>
      </div>

      {(tooSmall || soft) && (
        <p
          role={tooSmall ? 'alert' : undefined}
          className={
            tooSmall
              ? 'mt-2 text-sm text-[var(--red)]'
              : 'mt-2 text-xs text-[var(--text-secondary)]'
          }
        >
          {tooSmall
            ? 'This crop is too small to print clearly. Zoom out, or start again with a larger photograph.'
            : 'This crop will look a little soft in print. Zooming out, or using a larger photograph, will sharpen it.'}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !ready || tooSmall}
          onClick={apply}
          className="rounded bg-[var(--red)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {busy ? 'Preparing…' : 'Use this crop'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
