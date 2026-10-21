'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';

type Box = { x: number; y: number; w: number; h: number };

const MAX_OUTPUT_EDGE = 2600;
const MAX_BYTES = 8 * 1024 * 1024;

function gaussianKernel(sigma: number): number[] {
  const radius = Math.max(1, Math.ceil(sigma * 2.5));
  const kernel: number[] = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(v);
    sum += v;
  }
  return kernel.map((v) => v / sum);
}

/** True Gaussian blur over a rectangular ImageData crop (Safari fallback). */
function blurImageData(data: ImageData, sigma: number): ImageData {
  const { width: w, height: h } = data;
  const kernel = gaussianKernel(sigma);
  const radius = (kernel.length - 1) / 2;
  const src = data.data;
  const tmp = new Uint8ClampedArray(src.length);
  const out = new Uint8ClampedArray(src.length);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        const i = (y * w + xx) * 4;
        const weight = kernel[k + radius];
        r += src[i] * weight;
        g += src[i + 1] * weight;
        b += src[i + 2] * weight;
        a += src[i + 3] * weight;
      }
      const o = (y * w + x) * 4;
      tmp[o] = r;
      tmp[o + 1] = g;
      tmp[o + 2] = b;
      tmp[o + 3] = a;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        const i = (yy * w + x) * 4;
        const weight = kernel[k + radius];
        r += tmp[i] * weight;
        g += tmp[i + 1] * weight;
        b += tmp[i + 2] * weight;
        a += tmp[i + 3] * weight;
      }
      const o = (y * w + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  return new ImageData(out, w, h);
}

async function canvasToFile(
  canvas: HTMLCanvasElement,
  name: string,
  type: string,
): Promise<File> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), type, 0.92),
  );
  if (!blob) throw new Error('Could not prepare the edited photo.');
  if (blob.size <= MAX_BYTES) {
    return new File([blob], name, { type: blob.type || type });
  }
  const jpeg = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.82),
  );
  if (!jpeg) throw new Error('Could not prepare the edited photo.');
  return new File([jpeg], `${name.replace(/\.\w+$/, '')}-blurred.jpg`, {
    type: 'image/jpeg',
  });
}

export function ImageBlurModal({
  file,
  reason,
  onApply,
  onReplace,
  onCancel,
}: {
  file: File;
  reason: string;
  onApply: (file: File) => void;
  onReplace: () => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [selection, setSelection] = useState<Box | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const selectionRef = useRef<Box | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let revoked: string | null = null;
    const url = URL.createObjectURL(file);
    revoked = url;
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const scale = Math.min(
        1,
        MAX_OUTPUT_EDGE / Math.max(img.naturalWidth, img.naturalHeight),
      );
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      draw();
    };
    img.src = url;
    return () => {
      imageRef.current = null;
      if (revoked) URL.revokeObjectURL(revoked);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxes, selection]);

  function draw() {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const all = selection ? [...boxes, selection] : boxes;
    for (const box of all) {
      ctx.fillStyle = 'rgba(227, 6, 19, 0.22)';
      ctx.strokeStyle = 'rgba(227, 6, 19, 0.95)';
      ctx.lineWidth = Math.max(2, canvas.width / 500);
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.strokeRect(box.x, box.y, box.w, box.h);
    }
  }

  function point(e: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function down(e: PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    dragStartRef.current = p;
    const next = { x: p.x, y: p.y, w: 0, h: 0 };
    selectionRef.current = next;
    setSelection(next);
  }

  function move(e: PointerEvent<HTMLCanvasElement>) {
    const start = dragStartRef.current;
    if (!start) return;
    const p = point(e);
    const next = {
      x: Math.min(start.x, p.x),
      y: Math.min(start.y, p.y),
      w: Math.abs(p.x - start.x),
      h: Math.abs(p.y - start.y),
    };
    selectionRef.current = next;
    setSelection(next);
  }

  function up(e?: PointerEvent<HTMLCanvasElement>) {
    const done = selectionRef.current;
    if (done && done.w > 6 && done.h > 6) {
      setBoxes((prev) => [...prev, done]);
    }
    dragStartRef.current = null;
    selectionRef.current = null;
    setSelection(null);
    if (e && e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  async function apply() {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || boxes.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const out = document.createElement('canvas');
      out.width = canvas.width;
      out.height = canvas.height;
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('Your browser could not prepare this image.');
      ctx.drawImage(img, 0, 0, out.width, out.height);

      const sigma = Math.max(
        12,
        Math.round(Math.min(out.width, out.height) * 0.018),
      );
      const pad = Math.ceil(sigma * 2.2);
      const supportsFilter =
        typeof ctx.filter === 'string' && 'filter' in ctx;
      for (const box of boxes) {
        const x = Math.max(0, Math.floor(box.x - pad));
        const y = Math.max(0, Math.floor(box.y - pad));
        const w = Math.min(out.width - x, Math.ceil(box.w + pad * 2));
        const h = Math.min(out.height - y, Math.ceil(box.h + pad * 2));
        if (w <= 0 || h <= 0) continue;
        if (supportsFilter) {
          const tmp = document.createElement('canvas');
          tmp.width = w;
          tmp.height = h;
          const tctx = tmp.getContext('2d');
          if (!tctx) continue;
          tctx.filter = `blur(${sigma}px)`;
          tctx.drawImage(out, x, y, w, h, 0, 0, w, h);
          ctx.drawImage(tmp, x, y);
        } else {
          const region = ctx.getImageData(x, y, w, h);
          ctx.putImageData(blurImageData(region, sigma), x, y);
        }
      }

      const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const name = `${file.name.replace(/\.\w+$/, '')}-hidden.${type === 'image/png' ? 'png' : 'jpg'}`;
      const next = await canvasToFile(out, name, type);
      onApply(next);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not blur this photo.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Hide details in photo"
    >
      <div
        style={{
          width: '100%',
          maxWidth: 760,
          maxHeight: '94vh',
          overflow: 'auto',
          background: 'var(--bg)',
          border: '0.5px solid var(--border)',
          borderRadius: 10,
        }}
      >
        <div style={{ padding: '18px 20px', borderBottom: '0.5px solid var(--border)' }}>
          <h2 className="text-lg" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
            Hide the details
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {reason} Drag a box over the address, number or website. We will blur
            it and check the photo again.
          </p>
        </div>

        <div
          style={{
            padding: 16,
            background: 'var(--bg-inset)',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <canvas
            ref={canvasRef}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            style={{
              display: 'block',
              width: 'auto',
              height: 'auto',
              maxWidth: '100%',
              maxHeight: '56vh',
              touchAction: 'none',
              cursor: 'crosshair',
              background: '#000',
              borderRadius: 6,
            }}
          />
        </div>

        {error && (
          <p className="text-xs px-5 py-2" style={{ color: 'var(--red)' }}>
            {error}
          </p>
        )}

        <div
          style={{
            padding: '14px 20px',
            borderTop: '0.5px solid var(--border)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-2 rounded-[6px] text-sm"
            style={{ background: 'transparent', color: 'var(--text-secondary)', border: '0.5px solid var(--border)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              setBoxes([]);
              setSelection(null);
            }}
            disabled={busy || boxes.length === 0}
            className="px-3 py-2 rounded-[6px] text-sm"
            style={{ background: 'transparent', color: 'var(--text-secondary)', border: '0.5px solid var(--border)', opacity: boxes.length ? 1 : 0.5 }}
          >
            Undo
          </button>
          <button
            type="button"
            onClick={onReplace}
            disabled={busy}
            className="px-3 py-2 rounded-[6px] text-sm"
            style={{ background: 'transparent', color: 'var(--text-secondary)', border: '0.5px solid var(--border)' }}
          >
            Replace photo
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={busy || boxes.length === 0}
            className="px-4 py-2 rounded-[6px] text-sm"
            style={{
              background: 'var(--red)',
              color: '#fff',
              border: 'none',
              fontWeight: 500,
              opacity: busy || boxes.length === 0 ? 0.5 : 1,
            }}
          >
            {busy ? 'Blurring…' : 'Blur and re-check'}
          </button>
        </div>
      </div>
    </div>
  );
}
