import type { Quad, Rect } from './geometry';
import {
  type Candidate,
  DCN_SIZE,
  FULL_REGION,
  type Pick,
  type Region,
  mapFromRegion,
  pickCandidate,
  regionForAim,
} from './doccorner';

// ────────────────────────────────────────────────────────────────────
// Driving DocCornerNet from the live preview, and from a captured still.
//
// ⚠️ ONE INFERENCE IN FLIGHT, EVER. DROP FRAMES, NEVER QUEUE. A request is
// two passes (~25ms) and the camera produces a frame every 33ms. Queue them
// and the overlay lags the scene by however deep the queue got — the box
// drifts behind the document and looks broken in exactly the way a tracking
// box must not. Dropping is correct: a frame we skipped is a frame the
// smoothing already covers.
// ────────────────────────────────────────────────────────────────────

export interface LiveReading {
  /** The chosen quad as FRACTIONS of the source frame, TL TR BR BL. */
  quad: Quad;
  /** P(document present) of the chosen pass. */
  score: number;
  /** Which pass won, and why — for the diagnostics panel. */
  region: 'full' | 'aim';
  why: string;
  /** Every pass's answer, chosen or not. */
  candidates: Candidate[];
  /** Inference time on this device, milliseconds, both passes. */
  ms: number;
}

/**
 * The worker RAN and found no acceptable document.
 *
 * ⚠️ DISTINCT FROM `null`, WHICH MEANS THE FRAME WAS DROPPED. Silence keeps
 * the last quad on screen; a miss must decay it. A tracker that cannot hear
 * misses never lets go of a document that has left the frame.
 */
export interface LiveMiss {
  miss: true;
  candidates: Candidate[];
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
 * document unattended. This decides whether to draw a box on a preview, which
 * commits to nothing and which the member overrules by moving the phone.
 * DocCornerNet's presence head is decisive — it answered 1.00 or 0.00 on 31
 * of 33 fixtures — so where this sits between the two hardly matters.
 */
export const LIVE_DRAW_ACCEPT = 0.5;

/** How many slow inferences before we give up on this device. */
const SLOW_STRIKES = 3;

/**
 * The fastest the tracked quad is allowed to refresh, on any device.
 *
 * ⚠️ A CEILING, NOT A TARGET. The lock needs two agreeing detections, so a
 * phone running at 30fps locks in 66ms and one at 10fps takes 200ms — the
 * same code with a visibly different feel, which is the divergence the
 * parity rule exists to prevent. The cap makes the fast one wait. At ~25ms
 * for both passes most phones now reach it.
 */
export const LIVE_FPS = 15;
export const LIVE_MIN_INTERVAL_MS = 1000 / LIVE_FPS;

export type LiveStatus =
  | { state: 'loading' }
  | { state: 'running'; medianMs: number }
  | { state: 'unavailable'; why: string }
  | { state: 'too-slow'; medianMs: number };

/** What a detect() call needs to know to choose between the passes. */
export interface DetectPriors {
  /** The aim box as fractions of the source region. Enables the second pass. */
  aim?: Rect;
  /** The document's long/short ratio when the shape is known. */
  expectAspect?: number;
  /** Presence score a candidate must clear. */
  minScore: number;
}

type Resolver = (r: LiveReading | LiveMiss | null) => void;

export class LiveDetector {
  private worker: Worker | null = null;
  private busy = false;
  private lastStart = 0;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: Resolver; regions: Region[]; priors: DetectPriors; w: number; h: number }
  >();
  private times: number[] = [];
  private slow = 0;
  private canvases: Array<OffscreenCanvas | HTMLCanvasElement> = [];
  status: LiveStatus = { state: 'loading' };

  constructor(private readonly onStatus?: (s: LiveStatus) => void) {}

  start(): void {
    if (this.worker) return;
    try {
      this.worker = new Worker(new URL('./doccorner.worker.ts', import.meta.url));
      this.worker.onmessage = (e: MessageEvent) => this.receive(e.data);
      this.worker.onerror = () => this.fail('worker failed to start');
    } catch (err) {
      this.fail((err as Error).message);
    }
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.resolve(null);
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
    results?: Array<{ region: 'full' | 'aim'; quad: Quad; score: number }>;
    ms?: number;
    error?: string;
  }): void {
    if (r.id === -1) {
      this.fail(r.error ?? 'model unavailable');
      return;
    }
    const job = this.pending.get(r.id);
    this.pending.delete(r.id);
    this.busy = false;
    if (!job) return;

    if (!r.ok || !r.results) {
      job.resolve({ miss: true, candidates: [], ms: r.ms ?? 0 });
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
        job.resolve(null);
        return;
      }
    } else {
      this.slow = 0;
    }

    if (this.status.state !== 'running') {
      this.status = { state: 'running', medianMs };
      this.onStatus?.(this.status);
    }

    const candidates: Candidate[] = r.results.map((res, i) => ({
      quad: mapFromRegion(res.quad, job.regions[i] ?? FULL_REGION),
      score: res.score,
      region: res.region,
    }));
    const pick = pickCandidate(candidates, {
      minScore: job.priors.minScore,
      frameW: job.w,
      frameH: job.h,
      expectAspect: job.priors.expectAspect,
      aim: job.priors.aim,
    });
    job.resolve(
      pick
        ? {
            quad: pick.quad,
            score: pick.score,
            region: pick.region,
            why: pick.why,
            candidates,
            ms: r.ms ?? 0,
          }
        : { miss: true, candidates, ms: r.ms ?? 0 },
    );
  }

  private canvas(i: number): CanvasRenderingContext2D | null {
    if (!this.canvases[i]) {
      this.canvases[i] =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(DCN_SIZE, DCN_SIZE)
          : Object.assign(document.createElement('canvas'), {
              width: DCN_SIZE,
              height: DCN_SIZE,
            });
    }
    return (this.canvases[i] as HTMLCanvasElement).getContext('2d', {
      willReadFrequently: true,
    }) as CanvasRenderingContext2D | null;
  }

  /**
   * Draw one region of the source, stretched to the model square, and read it back.
   *
   * ⚠️ STRETCHED, NOT LETTERBOXED — see doccorner.ts toInputTensor.
   */
  private grab(
    i: number,
    source: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
  ): ArrayBuffer | null {
    const g = this.canvas(i);
    if (!g) return null;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(source, sx, sy, sw, sh, 0, 0, DCN_SIZE, DCN_SIZE);
    return (g.getImageData(0, 0, DCN_SIZE, DCN_SIZE).data.buffer as ArrayBuffer).slice(0);
  }

  private post(
    source: CanvasImageSource,
    src: { sx: number; sy: number; sw: number; sh: number },
    priors: DetectPriors,
  ): Promise<LiveReading | LiveMiss | null> {
    const regions: Region[] = [FULL_REGION];
    if (priors.aim) {
      const r = regionForAim(priors.aim);
      if (r.w > 0.05 && r.h > 0.05) regions.push(r);
    }
    const passes: Array<{ rgba: ArrayBuffer; region: 'full' | 'aim' }> = [];
    const buffers: ArrayBuffer[] = [];
    for (let i = 0; i < regions.length; i++) {
      const r = regions[i];
      const buf = this.grab(
        i,
        source,
        src.sx + r.x * src.sw,
        src.sy + r.y * src.sh,
        r.w * src.sw,
        r.h * src.sh,
      );
      if (!buf) return Promise.resolve(null);
      passes.push({ rgba: buf, region: i === 0 ? 'full' : 'aim' });
      buffers.push(buf);
    }
    const id = this.nextId++;
    this.busy = true;
    return new Promise((resolve) => {
      this.pending.set(id, { resolve, regions, priors, w: src.sw, h: src.sh });
      this.worker?.postMessage({ id, passes }, buffers);
    });
  }

  /**
   * Detect in one live video frame.
   *
   * Returns null immediately if an inference is already running or the
   * frame-rate ceiling says wait — that is the drop, and it is the point. Also
   * null when the worker is gone.
   *
   * `src` is the region of the frame the member can actually SEE when the
   * preview is object-fit: cover. ⚠️ PASS IT. Without it the model reads the
   * whole sensor frame and answers in fractions of that, while the overlay
   * draws in visible-frame pixels — two coordinate spaces, silently offset.
   */
  detect(
    video: HTMLVideoElement,
    src: { sx: number; sy: number; sw: number; sh: number } | undefined,
    priors: DetectPriors,
  ): Promise<LiveReading | LiveMiss | null> {
    if (!this.worker || this.busy) return Promise.resolve(null);
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (now && now - this.lastStart < LIVE_MIN_INTERVAL_MS) return Promise.resolve(null);
    const region = src ?? { sx: 0, sy: 0, sw: video.videoWidth, sh: video.videoHeight };
    if (!region.sw || !region.sh) return Promise.resolve(null);
    this.lastStart = now;
    return this.post(video, region, priors);
  }

  /**
   * Prove the detector can run on this device, with no camera.
   *
   * Draws a white rectangle on grey, runs both passes on it and reports what
   * happened — the runtime's own error text when it could not start. This is
   * what /scan/selftest shows, and it exists because "unavailable" on two
   * phones with no reason attached cost a build cycle of guessing.
   */
  async selfTest(): Promise<{
    status: LiveStatus;
    ms?: number;
    score?: number;
    quad?: Quad;
    region?: string;
    error?: string;
  }> {
    this.start();
    const w = 480;
    const h = 640;
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(w, h)
        : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const g = (canvas as HTMLCanvasElement).getContext('2d');
    if (!g) return { status: this.status, error: 'no 2d canvas' };
    g.fillStyle = '#6f6f6f';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#f4f4f4';
    g.fillRect(w * 0.2, h * 0.28, w * 0.6, h * 0.44);
    g.fillStyle = '#222';
    for (let i = 0; i < 6; i++) g.fillRect(w * 0.26, h * (0.34 + i * 0.05), w * 0.42, h * 0.012);
    const blob: Blob | null =
      'convertToBlob' in canvas
        ? await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality: 0.9 })
        : await new Promise<Blob | null>((r) =>
            (canvas as HTMLCanvasElement).toBlob(r, 'image/jpeg', 0.9),
          );
    if (!blob) return { status: this.status, error: 'could not encode the test image' };
    // Give the worker its first message and up to 20s for the runtime and
    // model to arrive over mobile data.
    const started = Date.now();
    let r: LiveReading | LiveMiss | null = null;
    while (Date.now() - started < 20_000) {
      r = await this.detectStill(blob, {
        minScore: 0.3,
        expectAspect: 1.36,
        aim: { x: 0.2, y: 0.28, width: 0.6, height: 0.44 },
      });
      if (r !== null || this.status.state === 'unavailable' || this.status.state === 'too-slow') break;
      await new Promise((res) => setTimeout(res, 250));
    }
    if (this.status.state === 'unavailable') return { status: this.status, error: this.status.why };
    if (!r) return { status: this.status, error: 'no answer within 20s' };
    if ('miss' in r) return { status: this.status, ms: r.ms, error: 'ran, but found no document in the test image' };
    return { status: this.status, ms: r.ms, score: r.score, quad: r.quad, region: r.region };
  }

  /**
   * Detect in a captured still — the same model the live box used, on the
   * photograph itself, so the crop and the preview never disagree about
   * where the document was.
   *
   * ⚠️ WAITS FOR THE WORKER RATHER THAN DROPPING. A still is one shot; there
   * is nothing to drop it for. Resolves null only when the worker is gone.
   */
  async detectStill(blob: Blob, priors: DetectPriors): Promise<LiveReading | LiveMiss | null> {
    if (!this.worker) return null;
    let bmp: ImageBitmap;
    try {
      bmp = await createImageBitmap(blob);
    } catch {
      return null;
    }
    try {
      // Let a live frame in flight finish first.
      for (let i = 0; i < 40 && this.busy; i++) {
        await new Promise((r) => setTimeout(r, 25));
      }
      if (!this.worker) return null;
      this.busy = true;
      return await this.post(bmp, { sx: 0, sy: 0, sw: bmp.width, sh: bmp.height }, priors);
    } finally {
      bmp.close?.();
    }
  }
}

export type { Candidate, Pick };
