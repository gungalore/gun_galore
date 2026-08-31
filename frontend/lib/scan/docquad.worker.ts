/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web';
import { readCorners, maskCoverage } from './docquad-postprocess';
import { MODEL_SIZE, letterboxFor } from './letterbox';

// ────────────────────────────────────────────────────────────────────
// The document detector, on the phone, off the main thread.
//
// ⚠️ IN A WORKER BECAUSE INFERENCE IS ~100ms AND THE PREVIEW IS 30fps. Run
// this on the main thread and every inference drops thirty frames of camera —
// the preview visibly stutters, the overlay lags the scene, and the whole
// point of a live box is lost. The main thread's only job is to hand over
// pixels and draw what comes back.
//
// ⚠️ SINGLE-THREADED, DELIBERATELY. Multi-threaded WASM needs SharedArrayBuffer,
// which needs COOP/COEP cross-origin isolation headers, which apply SITE-WIDE
// and would put Clerk and every embed at risk. Measured: ort-wasm-simd.wasm
// declares no shared memory, so single-threaded avoids that entirely. It is
// slower per inference and it is the right trade — we are buying a live box,
// not a benchmark.
//
// SIMD stays on. Dropping it too would have saved 0.08 MB over the wire and
// cost the vectorisation that makes this viable at all.
//
// The model is bfloat16-rounded in place: same byte count, but the zeroed
// mantissa bits compress, taking it from 11.7 MB to 4.9 MB over the wire with
// corners PIXEL-IDENTICAL to fp32 on all fifteen fixtures. Going further
// (k14, k12) measurably blurs the confidence separation the accept gate
// depends on, and is out.
// ────────────────────────────────────────────────────────────────────

// ⚠️ VERSIONED PATH, AND IT MUST CHANGE WHENEVER THESE FILES DO.
//
// The first release served these from /scan/ and the middleware matcher had no
// `wasm` exclusion, so Clerk 307'd them to sign-in and ORT was handed the HTML
// of the sign-in page — "expected magic word 00 61 73 6d, found 3c 21 44 4f",
// which is `<!DO`. Fixing the middleware fixed the SERVER; every phone that had
// already tried kept failing, because the service worker had cached the bad
// response against those exact URLs.
//
// A query string is not enough — a cached entry can still match one. A new
// PATH cannot. Bump v1 -> v2 rather than overwriting a file in place.
const ASSET_BASE = '/scan/v1/';
const MODEL_URL = ASSET_BASE + 'docquad.ort';

/** Sent in: one letterboxed RGBA frame, plus the source size the quad maps back to. */
export interface DetectRequest {
  id: number;
  rgba: ArrayBuffer;
  srcWidth: number;
  srcHeight: number;
}

export interface DetectReply {
  id: number;
  ok: boolean;
  /** Corners as FRACTIONS of the source frame, TL TR BR BL. */
  quad?: Array<{ x: number; y: number }>;
  minConfidence?: number;
  minSigma?: number;
  maskCoverage?: number;
  /**
   * The raw 64x64 mask plane.
   *
   * ⚠️ RETURNED NOW BECAUSE THE CORNERS CANNOT DO THIS JOB. The four corner
   * heads always produce four peaks — there are four planes and each has a
   * maximum — so they can never say "nothing here" or "not a document shape".
   * mask-quad.ts fits four lines to this boundary and intersects them, which
   * is also what finds the corner of a ROUNDED document: the true corner is
   * where the straight edges would have met, and no peak sits there.
   *
   * Transferred, not copied — see the postMessage transfer list.
   */
  mask?: ArrayBuffer;
  ms?: number;
  error?: string;
}

let session: ort.InferenceSession | null = null;
let loading: Promise<ort.InferenceSession | null> | null = null;

async function ensureSession(): Promise<ort.InferenceSession | null> {
  if (session) return session;
  if (loading) return loading;
  loading = (async () => {
    try {
      // Both of these matter and neither is the default.
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.simd = true;
      // Served from our own origin: the CSP blocks the CDN ORT would otherwise
      // reach for, and a scanner that only works online is not the point.
      ort.env.wasm.wasmPaths = ASSET_BASE;
      const s = await ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      session = s;
      return s;
    } catch (err) {
      // A phone that cannot run this must still be able to scan. The caller
      // falls back to the server route, which falls back to the aim box.
      self.postMessage({ id: -1, ok: false, error: (err as Error).message } as DetectReply);
      return null;
    }
  })();
  return loading;
}

self.onmessage = async (e: MessageEvent<DetectRequest>) => {
  const { id, rgba, srcWidth, srcHeight } = e.data;
  const s = await ensureSession();
  if (!s) {
    self.postMessage({ id, ok: false, error: 'no session' } as DetectReply);
    return;
  }

  try {
    const t0 = performance.now();
    const px = new Uint8ClampedArray(rgba);
    const n = MODEL_SIZE * MODEL_SIZE;

    // RGBA interleaved to planar NCHW float, /255. No mean/std — this model
    // takes raw [0,1]. Alpha is dropped; the letterbox pad is opaque grey.
    const nchw = new Float32Array(3 * n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      nchw[i] = px[j] / 255;
      nchw[n + i] = px[j + 1] / 255;
      nchw[2 * n + i] = px[j + 2] / 255;
    }

    const out = await s.run({
      [s.inputNames[0]]: new ort.Tensor('float32', nchw, [1, 3, MODEL_SIZE, MODEL_SIZE]),
    });

    // ⚠️ THE QUAD COMES BACK IN SOURCE-FRAME FRACTIONS, NOT MODEL PIXELS.
    // readCorners undoes the letterbox; dividing by the source size here means
    // the main thread can multiply by whatever it is drawing on without ever
    // holding a coordinate in an intermediate space. Every bug this project
    // has had in this area came from mixing two of those.
    const lb = letterboxFor(srcWidth, srcHeight);
    const r = readCorners(out.corner_heatmaps.data as Float32Array, lb);
    // ⚠️ COPY BEFORE TRANSFERRING. The tensor's buffer belongs to the ORT
    // session and is reused on the next run; handing it to the main thread
    // would either detach memory the session still owns or ship a plane that
    // the following inference overwrites underneath the reader.
    const mask = out.mask_logits.data as Float32Array;
    const maskCopy = mask.slice().buffer;

    self.postMessage({
      id,
      ok: true,
      quad: r.quad.map((p) => ({ x: p.x / srcWidth, y: p.y / srcHeight })),
      minConfidence: r.minConfidence,
      minSigma: r.minSigma,
      maskCoverage: maskCoverage(mask),
      mask: maskCopy,
      ms: Math.round(performance.now() - t0),
    } as DetectReply, [maskCopy]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err as Error).message } as DetectReply);
  }
};
