'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ScanResult,
  frameToGray,
  makeScratch,
  processCapture,
  verdicts,
} from '@/lib/scan/capture';
import { detectQuad } from '@/lib/scan/detect';
import { Pt, Quad, quadDrift, smoothQuad } from '@/lib/scan/geometry';

// ────────────────────────────────────────────────────────────────────
// THE SCANNER.
//
// A live camera view with the document's corners drawn on it, a shutter, and a
// review step where the corners can be dragged before the photo is used.
//
// ⚠️ THE VIDEO IS NEVER DRAWN TO A CANVAS. A real <video> element is painted
// by the compositor at whatever the hardware manages, for free. A transparent
// canvas sits on top and draws ONLY the markers. That one decision is why
// detection can never stutter the preview: the worst case is the markers
// lagging the paper by a frame, which reads as settling — which is what a good
// scanner looks like.
//
// ⚠️ DETECTION RUNS AT 10fps; THE MARKERS ARE DRAWN AT 60. The drawing
// interpolates towards the latest smoothed quad, so ten detections a second
// look identical to sixty at a sixth of the cost. On a phone that cannot keep
// up, the rate drops and then live detection switches off entirely — the
// capture-time detection still runs, so the feature degrades to "we straighten
// it afterwards" rather than to a frozen screen.
//
// ⚠️ Z-INDEX 130. Above the date picker at 121, above the admin modal shell at
// 100, above the tab bar at 55. This is full-screen and nothing may sit over
// it.
// ────────────────────────────────────────────────────────────────────

const Z = 130;

/** Detection interval, in ms, at each health level. */
const RATES = [100, 200] as const;

export interface DocumentScannerProps {
  /** 'card' for an ID-1 licence, 'page' for A4. Only changes the guide. */
  shape?: 'card' | 'page';
  title: string;
  onDone: (files: File[]) => void | Promise<void>;
  onClose: () => void;
}

type Phase = 'starting' | 'live' | 'working' | 'review' | 'denied' | 'nocamera';

export default function DocumentScanner({
  shape = 'page',
  title,
  onDone,
  onClose,
}: DocumentScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [phase, setPhase] = useState<Phase>('starting');
  const [err, setErr] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [shot, setShot] = useState<ScanResult | null>(null);
  const [pages, setPages] = useState<File[]>([]);
  const [editing, setEditing] = useState(false);
  const [said, setSaid] = useState('');

  // The live quad, and whether it has been steady long enough to trust.
  const quadRef = useRef<Quad | null>(null);
  const lockRef = useRef(0);
  const rawBlobRef = useRef<Blob | null>(null);
  const closedRef = useRef(false);

  const say = useCallback((m: string) => {
    setSaid('');
    window.setTimeout(() => setSaid(m), 30);
  }, []);

  // ── the camera ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPhase('nocamera');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        // Torch is Chrome-on-Android only. Never render a dead button.
        const caps = track.getCapabilities?.() as
          | (MediaTrackCapabilities & { torch?: boolean })
          | undefined;
        setHasTorch(caps?.torch === true);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setPhase('live');
        say('Camera ready. Line the document up inside the frame.');
      } catch (e) {
        const name = (e as DOMException)?.name;
        setPhase(name === 'NotAllowedError' ? 'denied' : 'nocamera');
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [say]);

  // ⚠️ iOS SAFARI TEARS THE STREAM DOWN when the tab goes to the background,
  // and hands back a black viewfinder with a working shutter that captures
  // nothing. The existing KYC camera in this repo has that bug; this does not.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      const track = streamRef.current?.getVideoTracks()[0];
      if (track && track.readyState === 'ended') {
        setErr('The camera stopped when you left. Close and open it again.');
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // ── detect, smooth, draw ──────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'live') return;
    let raf = 0;
    let timer = 0;
    let scratch: CanvasRenderingContext2D | null = null;
    let rate = 0;
    let rolling = 0;
    let alive = true;

    const detectOnce = () => {
      if (!alive) return;
      const video = videoRef.current;
      if (!video || !video.videoWidth) {
        timer = window.setTimeout(detectOnce, RATES[rate]);
        return;
      }
      if (!scratch) scratch = makeScratch(video.videoWidth, video.videoHeight);
      const t0 = performance.now();
      try {
        const gray = frameToGray(video, scratch);
        const found = gray ? detectQuad(gray) : null;
        if (found) {
          const k = video.videoWidth / scratch.canvas.width;
          const scaled = found.quad.map((p) => ({
            x: p.x * k,
            y: p.y * k,
          })) as Quad;
          // ⚠️ CONSISTENCY BEFORE CONFIDENCE. The first version counted ANY
          // detection towards the lock — so when successive frames found two
          // DIFFERENT rectangles (the card, then the table edge, then the
          // card again), the lock still climbed and the EMA dragged the
          // markers back and forth between them. That was the jitter the
          // operator saw. Now only a detection that AGREES with the current
          // quad — within 8% of the frame — counts; a different rectangle
          // starts over, snapped rather than glided to, because gliding
          // across the frame between two candidates IS the jitter.
          const prev = quadRef.current;
          if (prev && quadDrift(prev, scaled) <= video.videoWidth * 0.08) {
            quadRef.current = smoothQuad(prev, scaled, 0.35);
            lockRef.current = Math.min(3, lockRef.current + 1);
          } else {
            quadRef.current = scaled;
            lockRef.current = 1;
          }
        } else {
          // ⚠️ NEVER BLINK OFF. A single frame where a hand shadowed an edge
          // must not flash the markers away — it reads as a fault. Decay
          // instead, and only give up after several misses.
          lockRef.current = Math.max(0, lockRef.current - 1);
          if (lockRef.current === 0) quadRef.current = null;
        }
      } catch {
        quadRef.current = null;
      }
      const ms = performance.now() - t0;
      rolling = rolling * 0.8 + ms * 0.2;
      // A phone that cannot keep up slows down, then stops trying. The
      // capture-time detection still runs either way.
      if (rolling > 45 && rate < RATES.length - 1) rate++;
      if (rolling > 90) {
        alive = false;
        quadRef.current = null;
        return;
      }
      timer = window.setTimeout(detectOnce, RATES[rate]);
    };

    const draw = () => {
      const cv = overlayRef.current;
      const video = videoRef.current;
      if (cv && video && video.videoWidth) {
        const rect = video.getBoundingClientRect();
        if (cv.width !== Math.round(rect.width) || cv.height !== Math.round(rect.height)) {
          cv.width = Math.round(rect.width);
          cv.height = Math.round(rect.height);
        }
        const g = cv.getContext('2d');
        if (g) {
          g.clearRect(0, 0, cv.width, cv.height);
          const q = quadRef.current;
          // Drawn only once TWO consecutive detections have agreed. A single
          // unconfirmed candidate stays invisible — honest "still looking"
          // beats markers that flicker somewhere wrong for one frame.
          if (q && lockRef.current >= 2) {
            // The video is object-fit: cover, so map through the same crop.
            const sx = cv.width / video.videoWidth;
            const sy = cv.height / video.videoHeight;
            const s = Math.max(sx, sy);
            const ox = (cv.width - video.videoWidth * s) / 2;
            const oy = (cv.height - video.videoHeight * s) / 2;
            drawCorners(
              g,
              q.map((p) => ({ x: p.x * s + ox, y: p.y * s + oy })) as Quad,
              lockRef.current >= 3,
            );
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };

    detectOnce();
    raf = requestAnimationFrame(draw);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [phase]);

  // ── the shutter ───────────────────────────────────────────────────
  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    setPhase('working');
    say('Photo taken. Straightening it up.');
    try {
      const c = document.createElement('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext('2d')?.drawImage(video, 0, 0);
      const blob = await new Promise<Blob | null>((res) =>
        c.toBlob(res, 'image/jpeg', 0.95),
      );
      if (!blob) throw new Error('We could not take that photo.');
      rawBlobRef.current = blob;
      const res = await processCapture(blob);
      setShot(res);
      setPhase('review');
      say(
        res.source === 'detected'
          ? 'Ready to check. We found the edges.'
          : 'Ready to check. We could not find the edges, so we used the frame.',
      );
    } catch (e) {
      setErr((e as Error).message || 'That did not work. Try again.');
      setPhase('live');
    }
  }, [say]);

  /** Re-run with corners the member dragged. Detection is deliberately skipped. */
  const reprocess = useCallback(
    async (quad: Quad) => {
      const blob = rawBlobRef.current;
      if (!blob) return;
      setPhase('working');
      try {
        setShot(await processCapture(blob, { manualQuad: quad }));
      } catch (e) {
        setErr((e as Error).message);
      }
      setPhase('review');
      setEditing(false);
      say('Corners updated.');
    },
    [say],
  );

  const finish = useCallback(
    async (extra: File[]) => {
      if (closedRef.current) return;
      closedRef.current = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      await onDone(extra);
      onClose();
    },
    [onDone, onClose],
  );

  // Escape closes, in the capture phase so a modal underneath survives.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const body = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-blocking-overlay="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: Z,
        background: '#000',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Header title={title} onClose={onClose} pages={pages.length} />

      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        {(phase === 'starting' || phase === 'live' || phase === 'working') && (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                background: '#000',
              }}
            />
            <canvas
              ref={overlayRef}
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
              }}
            />
            <GuideFrame shape={shape} />
          </>
        )}

        {phase === 'working' && (
          <div style={overlayCentre}>
            <p style={{ fontSize: 15 }}>Straightening it up…</p>
          </div>
        )}

        {(phase === 'denied' || phase === 'nocamera') && (
          <div style={{ ...overlayCentre, padding: 24, textAlign: 'center' }}>
            <p style={{ fontSize: 16, fontWeight: 600 }}>
              {phase === 'denied'
                ? 'The camera is blocked'
                : 'No camera we can use'}
            </p>
            <p style={{ marginTop: 8, fontSize: 14, opacity: 0.85 }}>
              {phase === 'denied'
                ? 'Your browser is holding the camera back for this site. You can allow it in the address bar, or close this and choose a file instead — either works.'
                : 'Close this and choose a file instead. Everything after that is the same.'}
            </p>
            <button type="button" style={secondaryBtn} onClick={onClose}>
              Choose a file instead
            </button>
          </div>
        )}

        {phase === 'review' && shot && (
          <Review
            shot={shot}
            editing={editing}
            onEdit={() => setEditing(true)}
            onQuad={reprocess}
            onRetake={() => {
              setShot(null);
              setEditing(false);
              setPhase('live');
              say('Ready for another go.');
            }}
            onUse={async () => {
              const all = [...pages, shot.file];
              setPages(all);
              await finish(all);
            }}
            onAddAnother={() => {
              setPages((p) => [...p, shot.file]);
              setShot(null);
              setEditing(false);
              setPhase('live');
              say('Saved. Ready for the next page.');
            }}
          />
        )}
      </div>

      {phase === 'live' && (
        <Controls
          hasTorch={hasTorch}
          torchOn={torchOn}
          onTorch={async () => {
            const track = streamRef.current?.getVideoTracks()[0];
            if (!track) return;
            const next = !torchOn;
            try {
              await track.applyConstraints({
                advanced: [{ torch: next } as MediaTrackConstraintSet],
              });
              setTorchOn(next);
            } catch {
              setHasTorch(false);
            }
          }}
          onShutter={capture}
          onDone={pages.length ? () => void finish(pages) : undefined}
          pages={pages.length}
        />
      )}

      {err && (
        <p
          style={{
            padding: '10px 16px',
            background: 'rgba(200,16,46,0.9)',
            fontSize: 14,
          }}
        >
          {err}
        </p>
      )}

      <span
        role="status"
        aria-live="polite"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clipPath: 'inset(50%)',
        }}
      >
        {said}
      </span>
    </div>
  );

  return createPortal(body, document.body);
}

// ── the markers ─────────────────────────────────────────────────────

/**
 * The blue corners.
 *
 * Corner brackets rather than a full outline, deliberately: an outline over a
 * live camera hides the edge of the document just as the member is trying to
 * line it up. Brackets say "we have these four points" and leave the paper
 * visible. Thin and translucent while we are still settling, solid once three
 * consecutive detections have agreed.
 */
const MARK = '#4DA3FF';

function drawCorners(g: CanvasRenderingContext2D, q: Quad, locked: boolean) {
  g.strokeStyle = MARK;
  g.lineWidth = locked ? 3 : 2;
  g.globalAlpha = locked ? 1 : 0.6;
  g.lineCap = 'round';
  g.lineJoin = 'round';

  const arm = Math.max(
    14,
    Math.min(38, Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y) * 0.18),
  );

  for (let i = 0; i < 4; i++) {
    const c = q[i];
    const prev = q[(i + 3) % 4];
    const next = q[(i + 1) % 4];
    const towards = (p: Pt) => {
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const len = Math.hypot(dx, dy) || 1;
      const d = Math.min(arm, len * 0.45);
      return { x: c.x + (dx / len) * d, y: c.y + (dy / len) * d };
    };
    const a = towards(prev);
    const b = towards(next);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(c.x, c.y);
    g.lineTo(b.x, b.y);
    g.stroke();
  }

  // A faint join between the brackets once locked, so it reads as one shape.
  if (locked) {
    g.globalAlpha = 0.22;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(q[0].x, q[0].y);
    for (let i = 1; i < 4; i++) g.lineTo(q[i].x, q[i].y);
    g.closePath();
    g.stroke();
  }
  g.globalAlpha = 1;
}

// ── chrome ──────────────────────────────────────────────────────────

const overlayCentre: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  background: 'rgba(0,0,0,0.55)',
};

const secondaryBtn: React.CSSProperties = {
  marginTop: 16,
  minHeight: 44,
  padding: '0 18px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.35)',
  background: 'transparent',
  color: '#fff',
  fontSize: 15,
};

function Header({
  title,
  onClose,
  pages,
}: {
  title: string;
  onClose: () => void;
  pages: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: 'max(10px, env(safe-area-inset-top)) 12px 10px',
      }}
    >
      <p style={{ flex: 1, margin: 0, fontSize: 15, fontWeight: 600 }}>
        {title}
        {pages > 0 && (
          <span style={{ marginLeft: 8, opacity: 0.7, fontWeight: 400 }}>
            {pages} saved
          </span>
        )}
      </p>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close the camera"
        style={{
          width: 44,
          height: 44,
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.3)',
          background: 'transparent',
          color: '#fff',
          fontSize: 20,
        }}
      >
        ×
      </button>
    </div>
  );
}

/** A static frame to line the document up inside, in the site's gold. */
function GuideFrame({ shape }: { shape: 'card' | 'page' }) {
  const ratio = shape === 'card' ? 85.6 / 53.98 : 1 / Math.SQRT2;
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          width: '84%',
          aspectRatio: String(ratio),
          border: '1px dashed rgba(232,181,58,0.55)',
          borderRadius: 6,
        }}
      />
    </div>
  );
}

function Controls({
  hasTorch,
  torchOn,
  onTorch,
  onShutter,
  onDone,
  pages,
}: {
  hasTorch: boolean;
  torchOn: boolean;
  onTorch: () => void;
  onShutter: () => void;
  onDone?: () => void;
  pages: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '14px 20px max(18px, env(safe-area-inset-bottom))',
      }}
    >
      <div style={{ width: 88 }}>
        {hasTorch && (
          <button
            type="button"
            onClick={onTorch}
            aria-pressed={torchOn}
            // ⚠️ "For dark rooms" is not decoration. A torch at close range on
            // a laminated licence card produces exactly the blown highlight
            // that cannot be recovered from.
            aria-label={torchOn ? 'Turn the light off' : 'Light, for dark rooms'}
            style={{
              minHeight: 44,
              padding: '0 12px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.3)',
              background: torchOn ? 'rgba(232,181,58,0.25)' : 'transparent',
              color: '#fff',
              fontSize: 13,
            }}
          >
            {torchOn ? 'Light on' : 'Light'}
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={onShutter}
        aria-label="Take the photo"
        style={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          border: '4px solid #fff',
          background: 'rgba(255,255,255,0.18)',
        }}
      />

      <div style={{ width: 88, textAlign: 'right' }}>
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            style={{
              minHeight: 44,
              padding: '0 12px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--red)',
              color: '#fff',
              fontSize: 14,
            }}
          >
            Use {pages}
          </button>
        )}
      </div>
    </div>
  );
}

// ── review ──────────────────────────────────────────────────────────

function Review({
  shot,
  editing,
  onEdit,
  onQuad,
  onRetake,
  onUse,
  onAddAnother,
}: {
  shot: ScanResult;
  editing: boolean;
  onEdit: () => void;
  onQuad: (q: Quad) => void;
  onRetake: () => void;
  onUse: () => void;
  onAddAnother: () => void;
}) {
  const notes = verdicts(shot);
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#000',
      }}
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 12,
          minHeight: 0,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={shot.preview}
          alt="The document as it will be saved"
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
        />
      </div>

      {notes.length > 0 && (
        <ul
          style={{
            margin: 0,
            padding: '0 18px 6px',
            fontSize: 13,
            opacity: 0.9,
            listStyle: 'none',
          }}
        >
          {notes.map((n) => (
            <li key={n} style={{ marginBottom: 4 }}>
              {n}
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <CornerEditor
          preview={shot.preview}
          quad={shot.quad}
          onCancel={onRetake}
          onApply={onQuad}
        />
      ) : (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            padding: '10px 16px max(16px, env(safe-area-inset-bottom))',
          }}
        >
          <button type="button" onClick={onRetake} style={secondaryBtn}>
            Take it again
          </button>
          <button type="button" onClick={onEdit} style={secondaryBtn}>
            Fix the corners
          </button>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onAddAnother} style={secondaryBtn}>
            Add another
          </button>
          <button
            type="button"
            onClick={onUse}
            style={{
              ...secondaryBtn,
              background: 'var(--red)',
              border: 'none',
            }}
          >
            Use it
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Drag the corners.
 *
 * The primary correction path, not a fallback: detection on a real desk gets
 * it wrong often enough that "drag it" has to be a first-class action rather
 * than something buried. Keyboard-operable too, because the same code path
 * then serves switch access.
 */
function CornerEditor({
  preview,
  quad,
  onCancel,
  onApply,
}: {
  preview: string;
  quad: Quad;
  onCancel: () => void;
  onApply: (q: Quad) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [pts, setPts] = useState<Quad>(quad);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [active, setActive] = useState(0);

  // The preview is a scaled copy of the source, so the corners have to be
  // shown in the preview's own coordinates and handed back in the source's.
  const scale = size.w > 1 ? size.w / Math.max(1, extent(quad).w) : 1;

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const move = (i: number, dx: number, dy: number) => {
    setPts((cur) => {
      const next = [...cur] as Quad;
      next[i] = { x: next[i].x + dx, y: next[i].y + dy };
      return next;
    });
  };

  return (
    <div style={{ padding: '8px 16px max(16px, env(safe-area-inset-bottom))' }}>
      <div
        ref={boxRef}
        style={{ position: 'relative', width: '100%', maxHeight: 240 }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={preview}
          alt=""
          style={{ width: '100%', display: 'block', opacity: 0.75 }}
        />
      </div>
      <p style={{ margin: '10px 0 6px', fontSize: 13, opacity: 0.85 }}>
        Nudge whichever corner is in the wrong place, then apply.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {(['Top left', 'Top right', 'Bottom right', 'Bottom left'] as const).map(
          (label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => setActive(i)}
              aria-pressed={active === i}
              style={{
                ...secondaryBtn,
                marginTop: 0,
                fontSize: 13,
                padding: '0 10px',
                background: active === i ? 'rgba(77,163,255,0.28)' : 'transparent',
              }}
            >
              {label}
            </button>
          ),
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        {(
          [
            ['←', -12, 0],
            ['→', 12, 0],
            ['↑', 0, -12],
            ['↓', 0, 12],
          ] as const
        ).map(([g, dx, dy]) => (
          <button
            key={g}
            type="button"
            aria-label={`Move ${['top left', 'top right', 'bottom right', 'bottom left'][active]} ${g === '←' ? 'left' : g === '→' ? 'right' : g === '↑' ? 'up' : 'down'}`}
            onClick={() => move(active, dx / scale, dy / scale)}
            style={{ ...secondaryBtn, marginTop: 0, width: 52, padding: 0 }}
          >
            {g}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onCancel} style={{ ...secondaryBtn, marginTop: 0 }}>
          Start over
        </button>
        <button
          type="button"
          onClick={() => onApply(pts)}
          style={{
            ...secondaryBtn,
            marginTop: 0,
            background: 'var(--red)',
            border: 'none',
          }}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

function extent(q: Quad) {
  const xs = q.map((p) => p.x);
  const ys = q.map((p) => p.y);
  return {
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}
