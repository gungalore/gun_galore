/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web';
import { DCN_SIZE, decodeOutputs, toInputTensor } from './doccorner';

// ────────────────────────────────────────────────────────────────────
// DocCornerNet, on the phone, off the main thread.
//
// ⚠️ IN A WORKER BECAUSE THE PREVIEW IS 30fps AND THE MAIN THREAD DRAWS IT.
// Inference is ~12ms single-threaded, cheap enough that the temptation is to
// run it inline — resist it: the letterboxing, the getImageData and the
// tracker already share the main thread with the video and the overlay, and
// every millisecond spent there is a frame the box does not glide.
//
// ⚠️ SINGLE-THREADED, DELIBERATELY. Multi-threaded WASM needs SharedArrayBuffer,
// which needs COOP/COEP cross-origin isolation headers, which apply SITE-WIDE
// and would put Clerk and every embed at risk. The runtime's threaded build
// detects their absence and runs on one thread; SIMD stays on.
//
// The model is 1.9 MB (was 13.4 MB) and its runtime 11 MB; both are served
// from our own origin because the CSP blocks the CDN ORT would otherwise reach
// for, and a scanner that only works online is not the point.
// ────────────────────────────────────────────────────────────────────

// ⚠️ VERSIONED PATH, AND IT MUST CHANGE WHENEVER THESE FILES DO.
//
// The first release served these from /scan/ and the middleware matcher had no
// `wasm` exclusion, so Clerk 307'd them to sign-in and ORT was handed the HTML
// of the sign-in page. Fixing the middleware fixed the SERVER; every phone that
// had already tried kept failing, because the service worker had cached the
// bad response against those exact URLs. A query string is not enough — a
// cached entry can still match one. A new PATH cannot. v1 → v2 with this
// model; bump again rather than overwrite a file in place.
const ASSET_BASE = '/scan/v2/';
const MODEL_URL = ASSET_BASE + 'doccornernet_lean.ort';

/** One square of pixels for the model, and where in the frame it came from. */
export interface PassInput {
  /** DCN_SIZE x DCN_SIZE RGBA. Transferred. */
  rgba: ArrayBuffer;
  region: 'full' | 'aim';
}

export interface DetectRequest {
  id: number;
  passes: PassInput[];
}

export interface PassResult {
  region: 'full' | 'aim';
  /** Fractions of the PASS REGION, TL TR BR BL. The main thread maps them. */
  quad: Array<{ x: number; y: number }>;
  score: number;
}

export interface DetectReply {
  id: number;
  ok: boolean;
  results?: PassResult[];
  ms?: number;
  error?: string;
}

let session: ort.InferenceSession | null = null;
let loading: Promise<ort.InferenceSession | null> | null = null;
/** Reused across runs: the input is always the same shape. */
const scratch = new Float32Array(DCN_SIZE * DCN_SIZE * 3);

async function ensureSession(): Promise<ort.InferenceSession | null> {
  if (session) return session;
  if (loading) return loading;
  loading = (async () => {
    try {
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.simd = true;
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
  const { id, passes } = e.data;
  const s = await ensureSession();
  if (!s) {
    self.postMessage({ id, ok: false, error: 'no session' } as DetectReply);
    return;
  }
  try {
    const t0 = performance.now();
    const results: PassResult[] = [];
    for (const pass of passes) {
      const px = new Uint8ClampedArray(pass.rgba);
      toInputTensor(px, 4, scratch);
      const out = await s.run({
        [s.inputNames[0]]: new ort.Tensor('float32', scratch, [1, DCN_SIZE, DCN_SIZE, 3]),
      });
      // Named outputs on the shipped file are `coords` [1,8] and `score_logit`
      // [1,1]; told apart by size so a re-export that renames them still works.
      let coords: Float32Array | null = null;
      let logit = 0;
      for (const name of s.outputNames) {
        const d = out[name].data as Float32Array;
        if (d.length === 8) coords = d;
        else if (d.length === 1) logit = d[0];
      }
      if (!coords) throw new Error('model returned no coordinates');
      const r = decodeOutputs(coords, logit);
      results.push({ region: pass.region, quad: r.quad, score: r.score });
    }
    self.postMessage({
      id,
      ok: true,
      results,
      ms: Math.round(performance.now() - t0),
    } as DetectReply);
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err as Error).message } as DetectReply);
  }
};
