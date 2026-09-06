import type { Quad } from './geometry';
import { quadFromHeatmap } from './heatmap';

/**
 * Runs a DocAligner heatmap model (DocsaidLab, Apache-2.0) through ONNX
 * Runtime. Framework-agnostic: the caller passes the `ort` module so the same
 * code runs in a Worker (onnxruntime-web/wasm) and in node (for the bench).
 *
 * Model contract (from docaligner/heatmap_reg/infer.py):
 *   input  'img'      float32 (1, 3, 256, 256), image resized (stretched) to
 *                     256x256, channels-first, divided by 255
 *   output 'heatmap'  float32 (1, 4, H, W), one channel per corner
 */
export const DOCALIGNER_INPUT = 256;

export interface OrtLike {
  InferenceSession: {
    create(pathOrBuffer: string | ArrayBufferLike | Uint8Array, options?: unknown): Promise<SessionLike>;
  };
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => TensorLike;
}
export interface TensorLike {
  data: Float32Array | ArrayLike<number>;
  dims: readonly number[];
}
export interface SessionLike {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, TensorLike>): Promise<Record<string, TensorLike>>;
}

export interface DocAlignerOptions {
  /** Swap to BGR if the model was trained on OpenCV-ordered images. The bench decides. */
  channelOrder?: 'rgb' | 'bgr';
  heatmapThreshold?: number;
}

export interface DocAlignerRun {
  quad: Quad | null;
  confidence: number;
  /** Inference only, not counting preprocessing. */
  ms: number;
}

export class DocAlignerRunner {
  private session: SessionLike | null = null;
  private readonly input = new Float32Array(3 * DOCALIGNER_INPUT * DOCALIGNER_INPUT);

  constructor(
    private readonly ort: OrtLike,
    private readonly model: string | Uint8Array,
    private readonly opts: DocAlignerOptions = {},
    private readonly sessionOptions: unknown = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' },
  ) {}

  async load(): Promise<{ inputs: readonly string[]; outputs: readonly string[] }> {
    this.session = await this.ort.InferenceSession.create(this.model, this.sessionOptions);
    return { inputs: this.session.inputNames, outputs: this.session.outputNames };
  }

  /** `rgba` is a width x height RGBA frame. Returns the quad in frame pixels. */
  async run(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Promise<DocAlignerRun> {
    if (!this.session) throw new Error('model not loaded');
    preprocess(rgba, width, height, this.input, this.opts.channelOrder ?? 'rgb');
    const tensor = new this.ort.Tensor('float32', this.input, [1, 3, DOCALIGNER_INPUT, DOCALIGNER_INPUT]);
    const inputName = this.session.inputNames[0] ?? 'img';
    const t0 = performance.now();
    const out = await this.session.run({ [inputName]: tensor });
    const ms = performance.now() - t0;
    const hm = out['heatmap'] ?? out[this.session.outputNames[0]];
    const data = hm.data instanceof Float32Array ? hm.data : Float32Array.from(hm.data as ArrayLike<number>);
    const res = quadFromHeatmap(data, hm.dims, this.opts.heatmapThreshold ?? 0.3);
    if (!res) return { quad: null, confidence: 0, ms };
    return {
      quad: res.quad.map((p) => ({ x: p.x * width, y: p.y * height })) as Quad,
      confidence: res.confidence,
      ms,
    };
  }
}

/**
 * Stretch the RGBA frame to 256x256 (DocAligner stretches, it does not
 * letterbox), write channels-first floats in 0..1.
 */
export function preprocess(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, out: Float32Array, order: 'rgb' | 'bgr'): void {
  const S = DOCALIGNER_INPUT;
  const plane = S * S;
  const c0 = order === 'rgb' ? 0 : 2;
  const c2 = order === 'rgb' ? 2 : 0;
  const xs = new Float32Array(S);
  for (let x = 0; x < S; x++) xs[x] = ((x + 0.5) * width) / S - 0.5;
  for (let y = 0; y < S; y++) {
    const sy = Math.min(height - 1, Math.max(0, ((y + 0.5) * height) / S - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < S; x++) {
      const sx = Math.min(width - 1, Math.max(0, xs[x]));
      const x0 = Math.floor(sx);
      const x1 = Math.min(width - 1, x0 + 1);
      const fx = sx - x0;
      const i00 = (y0 * width + x0) * 4;
      const i10 = (y0 * width + x1) * 4;
      const i01 = (y1 * width + x0) * 4;
      const i11 = (y1 * width + x1) * 4;
      const o = y * S + x;
      for (let c = 0; c < 3; c++) {
        const top = rgba[i00 + c] * (1 - fx) + rgba[i10 + c] * fx;
        const bot = rgba[i01 + c] * (1 - fx) + rgba[i11 + c] * fx;
        const v = (top * (1 - fy) + bot * fy) / 255;
        const dst = c === 0 ? c0 : c === 2 ? c2 : 1;
        out[dst * plane + o] = v;
      }
    }
  }
}
