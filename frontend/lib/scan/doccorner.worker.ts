/// <reference lib="webworker" />
import type * as OrtNs from 'onnxruntime-web';
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
// ⚠️ THE RUNTIME IS NOT BUNDLED. IT IS importScripts'D FROM OUR ORIGIN.
// onnxruntime-web 1.19+ loads its WebAssembly through a dynamic `import()`
// of `ort-wasm-simd-threaded.mjs`. When webpack bundles the runtime into
// this worker it rewrites that import into its own chunk loader, which can
// never resolve a URL under /scan/, and the runtime reports "no available
// backend found" on EVERY phone — which is exactly what both of the
// operator's phones reported on 2026-09-05: live detector `unavailable`,
// tracking falling back to the classical detector, auto-capture never
// firing. Loading the runtime's own classic build with importScripts keeps
// its `import()` native, so it resolves against wasmPaths as designed.
// Dynamic import inside a dedicated worker is supported by Chrome 80+ and
// Safari 15+, which covers every phone this scanner has met.
//
// ⚠️ SINGLE-THREADED, DELIBERATELY. Multi-threaded WASM needs SharedArrayBuffer,
// which needs COOP/COEP cross-origin isolation headers, which apply SITE-WIDE
// and would put Clerk and every embed at risk. The runtime's threaded build
// detects their absence and runs on one thread; SIMD stays on.
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
//
// ⚠️ THE FOUR FILES UNDER THIS PATH MUST COME FROM THE SAME onnxruntime-web
// VERSION AS package.json: ort.wasm.min.js, ort-wasm-simd-threaded.mjs and
// .wasm are copied out of node_modules/onnxruntime-web/dist and the runtime
// refuses a glue file from another build.
const ASSET_BASE = '/scan/v2/';
const RUNTIME_URL = ASSET_BASE + 'ort.wasm.min.js';
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

type Ort = typeof OrtNs;

let session: OrtNs.InferenceSession | null = null;
let loading: Promise<OrtNs.InferenceSession | null> | null = null;
let ort: Ort | null = null;
/** Reused across runs: the input is always the same shape. */
const scratch = new Float32Array(DCN_SIZE * DCN_SIZE * 3);

/** Load the runtime as a classic script, once. Throws with the real reason. */
function loadRuntime(): Ort {
  if (ort) return ort;
  const g = self as unknown as { ort?: Ort; importScripts: (u: string) => void };
  g.importScripts(RUNTIME_URL);
  if (!g.ort) throw new Error(`runtime script loaded but defined no 'ort' (${RUNTIME_URL})`);
  ort = g.ort;
  return ort;
}

async function ensureSession(): Promise<OrtNs.InferenceSession | null> {
  if (session) return session;
  if (loading) return loading;
  loading = (async () => {
    try {
      const o = loadRuntime();
      o.env.wasm.numThreads = 1;
      o.env.wasm.simd = true;
      o.env.wasm.wasmPaths = ASSET_BASE;
      const s = await o.InferenceSession.create(MODEL_URL, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      session = s;
      return s;
    } catch (err) {
      // A phone that cannot run this must still be able to scan. The caller
      // falls back to the server route, which falls back to the aim box —
      // and the reason travels with it, into the diagnostics report.
      self.postMessage({
        id: -1,
        ok: false,
        error: `${(err as Error)?.name ?? 'Error'}: ${(err as Error)?.message ?? String(err)}`,
      } as DetectReply);
      return null;
    }
  })();
  return loading;
}

self.onmessage = async (e: MessageEvent<DetectRequest>) => {
  const { id, passes } = e.data;
  const s = await ensureSession();
  if (!s || !ort) {
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
