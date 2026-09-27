import type { Detection, DetectMode, Detector } from './detector';
import type { WorkerIn, WorkerOut } from './detector.worker';

export interface WorkerDetectorOptions {
  /** URL of the DocAligner ONNX file. */
  modelUrl: string;
  /** Folder that serves ort-wasm-simd-threaded.mjs and .wasm, with trailing slash. */
  wasmPaths: string;
  channelOrder?: 'rgb' | 'bgr';
  threshold?: number;
  name?: string;
}

/**
 * The learned detector, running in a Web Worker so the camera preview never
 * stutters while the model thinks. One request in flight at a time; a frame
 * that arrives while the worker is busy is dropped (the tracker holds the
 * last outline), which is what keeps the overlay honest.
 */
export class WorkerDetector implements Detector {
  readonly name: string;
  readonly inputSize = 256;
  private worker: Worker | null = null;
  private readyPromise: Promise<void> | null = null;
  private pending = new Map<number, { resolve: (d: Detection | null) => void; reject: (e: Error) => void }>();
  private seq = 0;
  private busy = false;
  /** The in-flight request, so a still can wait for it instead of being dropped. */
  private inflight: Promise<unknown> | null = null;
  /** Set after a successful load, for diagnostics. */
  meta: { inputs: readonly string[]; outputs: readonly string[]; loadMs: number } | null = null;

  constructor(private readonly opts: WorkerDetectorOptions) {
    this.name = opts.name ?? 'docaligner';
  }

  ready(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      const worker = new Worker(new URL('./detector.worker.ts', import.meta.url));
      this.worker = worker;
      const timeout = setTimeout(() => reject(new Error('detector took too long to load')), 60_000);
      worker.onmessage = (e: MessageEvent<WorkerOut>) => {
        const m = e.data;
        if (m.type === 'ready') {
          clearTimeout(timeout);
          this.meta = { inputs: m.inputs, outputs: m.outputs, loadMs: m.loadMs };
          resolve();
          return;
        }
        if (m.type === 'result') {
          this.busy = false;
          const p = this.pending.get(m.id);
          this.pending.delete(m.id);
          p?.resolve(m.quad ? { quad: m.quad, confidence: m.confidence, ms: m.ms } : null);
          return;
        }
        if (m.type === 'error') {
          if (m.id === undefined) {
            clearTimeout(timeout);
            reject(new Error(m.message));
            return;
          }
          this.busy = false;
          const p = this.pending.get(m.id);
          this.pending.delete(m.id);
          p?.reject(new Error(m.message));
        }
      };
      worker.onerror = (ev) => {
        clearTimeout(timeout);
        reject(new Error(ev.message || 'detector worker failed'));
      };
      const init: WorkerIn = { type: 'init', modelUrl: this.opts.modelUrl, wasmPaths: this.opts.wasmPaths, channelOrder: this.opts.channelOrder, threshold: this.opts.threshold };
      worker.postMessage(init);
    });
    return this.readyPromise;
  }

  async detect(frame: ImageData, mode: DetectMode = 'live'): Promise<Detection | null> {
    if (!this.worker) await this.ready();
    if (this.busy) {
      if (mode === 'live') return null; // dropped frame; the smoother holds the last quad
      // A still is worth waiting for: let the live request finish first.
      while (this.busy && this.inflight) await this.inflight.catch(() => undefined);
    }
    this.busy = true;
    const id = ++this.seq;
    const data = frame.data.buffer.slice(0) as ArrayBuffer;
    const p = new Promise<Detection | null>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const msg: WorkerIn = { type: 'detect', id, width: frame.width, height: frame.height, data };
      this.worker!.postMessage(msg, [data]);
    });
    this.inflight = p;
    return p;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.readyPromise = null;
    this.pending.clear();
    this.busy = false;
  }
}
