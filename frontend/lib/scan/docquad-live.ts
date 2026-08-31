import type { Quad } from './geometry';
import { MODEL_SIZE, PAD_VALUE } from './letterbox';

// ────────────────────────────────────────────────────────────────────
// Driving the on-device detector from the live preview.
//
// ⚠️ ONE INFERENCE IN FLIGHT, EVER. DROP FRAMES, NEVER QUEUE. Inference is
// ~100ms single-threaded and the camera produces a frame every 33ms. Queue
// them and the overlay lags the scene by however deep the queue got — the box
// drifts behind the document and looks broken in exactly the way a tracking
// box must not. Dropping is correct: a frame we skipped is a frame the
// smoothing already covers.
// ────────────────────────────────────────────────────────────────────

export interface LiveReading {
  /** Corners as FRACTIONS of the source frame, TL TR BR BL. */
  quad: Quad;
  minConfidence: number;
  minSigma: number;
  maskCoverage: number;
  /** Inference time on this device, milliseconds. */
  ms: number;
}

/**
 * How slow is too slow to be worth running.
 *
 * A phone that takes half a second an inference gives a box that lags the
 * scene badly enough to mislead — it points at where the document WAS. Better
 * to stop, say so, and let the capture-time server call do the work.
 */
export const LIVE_TOO_SLOW_MS = 500;

/**
 * How sure the model must be before its quad is DRAWN.
 *
 * ⚠️ DELIBERATELY LOWER THAN THE CAPTURE GATE, BECAUSE THEY DECIDE DIFFERENT
 * THINGS. DETECT_ACCEPT (0.80) decides whether a quad may CROP a statutory
 * document unattended — a commitment, and the four fixtures it wrongly
 * accepted would each have been a destroyed serial number. This decides
 * whether to draw a box on a preview, which commits to nothing and which the
 * member overrules simply by moving the phone.
 *
 * Sharing the capture threshold is what made the live box invisible: a preview
 * frame is smaller, noisier and more motion-blurred than a still, so live
 * confidence sits well under a bar tuned on stills. Every frame fell through
 * to the classical detector — jumpy on the iPhone, dropped outright on the
 * Samsung — which is exactly what the operator saw on each.
 */
export const LIVE_DRAW_ACCEPT = 0.5;

/** How many slow inferences before we give up on this device. */
const SLOW_STRIKES = 3;

export type LiveStatus =
  | { state: 'loading' }
  | { state: 'running'; medianMs: number }
  | { state: 'unavailable'; why: string }
  | { state: 'too-slow'; medianMs: number };

export class LiveDetector {
  private worker: Worker | null = null;
  private busy = false;
  private nextId = 1;
  private pending = new Map<number, (r: LiveReading | null) => void>();
  private times: number[] = [];
  private slow = 0;
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  status: LiveStatus = { state: 'loading' };

  constructor(private readonly onStatus?: (s: LiveStatus) => void) {}

  start(): void {
    if (this.worker) return;
    try {
      this.worker = new Worker(new URL('./docquad.worker.ts', import.meta.url));
      this.worker.onmessage = (e: MessageEvent) => this.receive(e.data);
      this.worker.onerror = () => this.fail('worker failed to start');
    } catch (err) {
      this.fail((err as Error).message);
    }
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
    this.busy = false;
  }

  private fail(why: string): void {
    this.status = { state: 'unavailable', why };
    this.onStatus?.(this.status);
    this.stop();
  }

  private receive(r: {
    id: number;
    ok: boolean;
    quad?: Array<{ x: number; y: number }>;
    minConfidence?: number;
    minSigma?: number;
    maskCoverage?: number;
    ms?: number;
    error?: string;
  }): void {
    if (r.id === -1) {
      this.fail(r.error ?? 'model unavailable');
      return;
    }
    const resolve = this.pending.get(r.id);
    this.pending.delete(r.id);
    this.busy = false;

    if (!r.ok || !r.quad) {
      resolve?.(null);
      return;
    }

    // Rolling median, kept short so a device that warms up is not judged on
    // its first inference — ORT's first run includes graph setup.
    this.times.push(r.ms ?? 0);
    if (this.times.length > 9) this.times.shift();
    const sorted = [...this.times].sort((a, b) => a - b);
    const medianMs = sorted[sorted.length >> 1] ?? 0;

    if (this.times.length >= 3 && medianMs > LIVE_TOO_SLOW_MS) {
      this.slow++;
      if (this.slow >= SLOW_STRIKES) {
        this.status = { state: 'too-slow', medianMs };
        this.onStatus?.(this.status);
        this.stop();
        resolve?.(null);
        return;
      }
    } else {
      this.slow = 0;
    }

    if (this.status.state !== 'running') {
      this.status = { state: 'running', medianMs };
      this.onStatus?.(this.status);
    }

    resolve?.({
      quad: r.quad as unknown as Quad,
      minConfidence: r.minConfidence ?? 0,
      minSigma: r.minSigma ?? 0,
      maskCoverage: r.maskCoverage ?? 0,
      ms: r.ms ?? 0,
    });
  }

  /**
   * Letterbox one video frame into the model's square input and detect.
   *
   * Returns null immediately if an inference is already running — that is the
   * drop, and it is the point. Also null when the worker is gone.
   *
   * ⚠️ THE PAD IS MID-GREY, MATCHING THE SERVER EXACTLY. Black padding
   * manufactures a hard rectangular edge precisely where a corner detector is
   * looking, and the model latches onto it. The two paths must preprocess
   * identically or their confidences are not comparable, and the accept gate
   * is shared.
   */
  async detect(
    video: HTMLVideoElement,
    /**
     * The region of the frame the member can actually SEE, when the preview
     * is object-fit: cover.
     *
     * ⚠️ PASS IT. Without it the model reads the whole sensor frame and
     * answers in fractions of that, while the overlay draws in visible-frame
     * pixels — two coordinate spaces, silently offset by the crop, and every
     * corner lands wrong by however much is off-screen. Feeding it the
     * visible region means the fractions come back in the space we draw in,
     * which is also the space the capture uses.
     */
    src?: { sx: number; sy: number; sw: number; sh: number },
  ): Promise<LiveReading | null> {
    if (!this.worker || this.busy) return null;
    const w = src ? src.sw : video.videoWidth;
    const h = src ? src.sh : video.videoHeight;
    if (!w || !h) return null;

    if (!this.canvas) {
      this.canvas =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(MODEL_SIZE, MODEL_SIZE)
          : Object.assign(document.createElement('canvas'), {
              width: MODEL_SIZE,
              height: MODEL_SIZE,
            });
    }
    const g = (this.canvas as HTMLCanvasElement).getContext('2d', {
      willReadFrequently: true,
    }) as CanvasRenderingContext2D | null;
    if (!g) return null;

    const scale = Math.min(MODEL_SIZE / w, MODEL_SIZE / h);
    const dw = w * scale;
    const dh = h * scale;
    g.fillStyle = `rgb(${PAD_VALUE},${PAD_VALUE},${PAD_VALUE})`;
    g.fillRect(0, 0, MODEL_SIZE, MODEL_SIZE);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    if (src) {
      g.drawImage(video, src.sx, src.sy, src.sw, src.sh,
        (MODEL_SIZE - dw) / 2, (MODEL_SIZE - dh) / 2, dw, dh);
    } else {
      g.drawImage(video, (MODEL_SIZE - dw) / 2, (MODEL_SIZE - dh) / 2, dw, dh);
    }

    const rgba = g.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data;
    const id = this.nextId++;
    this.busy = true;
    const buf = rgba.buffer.slice(0) as ArrayBuffer;
    return new Promise<LiveReading | null>((resolve) => {
      this.pending.set(id, resolve);
      this.worker?.postMessage({ id, rgba: buf, srcWidth: w, srcHeight: h }, [buf]);
    });
  }
}
