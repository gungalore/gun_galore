'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ────────────────────────────────────────────────────────────────────
// SIGNING WITH A FINGER.
//
// Operator, 2026-08-21: "physical signature" — drawn on screen, not typed.
//
// ⚠️ THE CANVAS IS BACKED AT DEVICE RESOLUTION, NOT CSS PIXELS. A signature
// captured at 1x on a phone with a 3x screen prints as a jagged 90 dpi line
// across 60 mm of a document going to the police. The element is sized in CSS
// and the bitmap in device pixels, with the context scaled to match.
//
// ⚠️ AND IT IS WHITE-ON-TRANSPARENT NOWHERE. The PNG carries an alpha channel
// only where the ink is not; pdfkit flattens alpha to BLACK, so a signature
// saved with a transparent ground would print as a black rectangle with the
// signature invisible inside it. The ground is painted white before export.
// ────────────────────────────────────────────────────────────────────

export default function WitnessSignaturePad({
  onChange,
}: {
  /** The PNG data URL, or null once cleared. */
  onChange: (dataUrl: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  const ctxOf = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return null;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    return ctx;
  }, []);

  /** Size the bitmap to the element, at device resolution. */
  const fit = useCallback(() => {
    const c = canvasRef.current;
    const ctx = ctxOf();
    if (!c || !ctx) return;
    const rect = c.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    c.width = Math.round(rect.width * dpr);
    c.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#16211d';
  }, [ctxOf]);

  useEffect(() => {
    fit();
    // ⚠️ RESIZING CLEARS IT, AND THAT IS THE HONEST BEHAVIOUR. Changing the
    // bitmap size discards the pixels; pretending otherwise by rescaling a
    // stale copy would print a stretched version of what they drew.
    const onResize = () => {
      fit();
      dirty.current = false;
      setHasInk(false);
      onChange(null);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fit, onChange]);

  const pos = (e: React.PointerEvent) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    const ctx = ctxOf();
    if (!ctx) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drawing.current = true;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    // A dot, so a full stop or a tittle is not lost.
    ctx.lineTo(p.x + 0.01, p.y);
    ctx.stroke();
    dirty.current = true;
    setHasInk(true);
  };

  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = ctxOf();
    if (!ctx) return;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const c = canvasRef.current;
    if (c && dirty.current) onChange(c.toDataURL('image/png'));
  };

  const clear = () => {
    fit();
    dirty.current = false;
    setHasInk(false);
    onChange(null);
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
        data-testid="signature-pad"
        className="h-40 w-full touch-none rounded border border-[var(--border)] bg-white"
        aria-label="Sign here"
      />
      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-[var(--text-secondary)]">
          Sign with your finger, or your mouse.
        </p>
        <button
          type="button"
          onClick={clear}
          disabled={!hasInk}
          className="text-xs text-[var(--text-secondary)] underline disabled:opacity-40"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
