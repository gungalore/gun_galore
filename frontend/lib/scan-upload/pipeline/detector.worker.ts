/// <reference lib="webworker" />
import { DocAlignerRunner, type OrtLike } from './docaligner';
import type { Quad } from './geometry';

// ⚠️ THE RUNTIME IS NOT BUNDLED. It is importScripts'd from our origin: webpack
// rewrites the runtime's own dynamic import() when it is bundled, which is how
// the previous scanner came to report "unavailable" on both phones. The classic
// build loaded from /scan/v3/ keeps its import() native, so it resolves the
// .mjs and .wasm beside it as designed. Same version as package.json.
declare function importScripts(...urls: string[]): void;
type OrtGlobal = OrtLike & { env: { wasm: { wasmPaths: unknown; numThreads: number; proxy?: boolean } } };
let ort: OrtGlobal;
function loadRuntime(wasmPaths: string): OrtGlobal {
  const base = wasmPaths.replace(/\/?$/, '/');
  importScripts(base + 'ort.wasm.min.js');
  const g = (self as unknown as { ort?: OrtGlobal }).ort;
  if (!g) throw new Error('ONNX runtime did not load from ' + base);
  g.env.wasm.wasmPaths = base;
  return g;
}

export type WorkerIn =
  | { type: 'init'; modelUrl: string; wasmPaths: string; channelOrder?: 'rgb' | 'bgr'; threshold?: number }
  | { type: 'detect'; id: number; width: number; height: number; data: ArrayBuffer };

export type WorkerOut =
  | { type: 'ready'; inputs: readonly string[]; outputs: readonly string[]; loadMs: number }
  | { type: 'error'; message: string; id?: number }
  | { type: 'result'; id: number; quad: Quad | null; confidence: number; ms: number };

let runner: DocAlignerRunner | null = null;
const post = (m: WorkerOut): void => self.postMessage(m);

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    try {
      // The bundle build of ORT carries its JS loader inline; only the .wasm is fetched.
      // A prefix string would make ORT dynamic-import the loader, which Vite and
      // webpack both mangle. Point at the file itself.
      ort = loadRuntime(msg.wasmPaths);
      // No cross-origin isolation on the site, so one thread. SIMD is on by default.
      ort.env.wasm.numThreads = 1;
      const t0 = performance.now();
      runner = new DocAlignerRunner(ort as unknown as OrtLike, msg.modelUrl, { channelOrder: msg.channelOrder, heatmapThreshold: msg.threshold });
      const meta = await runner.load();
      post({ type: 'ready', inputs: meta.inputs, outputs: meta.outputs, loadMs: performance.now() - t0 });
    } catch (err) {
      post({ type: 'error', message: (err as Error)?.message ?? String(err) });
    }
    return;
  }
  if (msg.type === 'detect') {
    if (!runner) {
      post({ type: 'error', id: msg.id, message: 'model not loaded' });
      return;
    }
    try {
      const r = await runner.run(new Uint8ClampedArray(msg.data), msg.width, msg.height);
      post({ type: 'result', id: msg.id, quad: r.quad, confidence: r.confidence, ms: r.ms });
    } catch (err) {
      post({ type: 'error', id: msg.id, message: (err as Error)?.message ?? String(err) });
    }
  }
};
