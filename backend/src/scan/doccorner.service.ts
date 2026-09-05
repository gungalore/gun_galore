import { Injectable, Logger } from '@nestjs/common';
import { join } from 'node:path';
import sharp from 'sharp';
import type { InferenceSession } from 'onnxruntime-node';
import {
  DCN_SIZE,
  FULL_REGION,
  type Quad,
  type Region,
  decodeOutputs,
  mapFromRegion,
  regionForAim,
  toInputTensor,
} from './doccorner';

// ────────────────────────────────────────────────────────────────────
// DocCornerNet — finding a document's four corners, on the server.
//
// The phone runs the same model in a worker for the live box and for the
// capture itself (frontend/lib/scan/live-detector.ts). This route is the
// FALLBACK for a browser that could not load the runtime, and it must answer
// identically: same model file, same stretch-to-square preprocessing, same
// two passes. The choice between the passes is the client's — it knows the
// shape the member picked and where the aim box was — so this returns every
// candidate rather than one answer.
//
// Replaced DocQuadNet256 on 2026-09-05. Measured on the operator's 33 real
// photographs it found the document in 29 against the old model's 18, at a
// seventh of the size and a fifth of the latency, and unlike the old heatmap
// heads it can say "there is nothing here". See the frontend module's header
// for the numbers and the licence (MIT, models/NOTICE.doccornernet).
// ────────────────────────────────────────────────────────────────────

/** Where the model file lives, relative to the backend package root. */
const MODEL_PATH = join(process.cwd(), 'models', 'doccornernet_lean.ort');

/**
 * How many inferences may run at once.
 *
 * ⚠️ MEMORY, NOT CPU, IS THE LIMIT. A 24MP frame decoded to RGBA is 98 MB per
 * copy and the decode-plus-resize path holds several; measured peak was
 * 468 MB for a single image. Two at a time is slower and stays up.
 */
const MAX_CONCURRENT = 2;

export interface ServerCandidate {
  /** Fractions of the whole frame, TL TR BR BL. */
  quad: Quad;
  score: number;
  region: 'full' | 'aim';
}

export interface DetectResult {
  candidates: ServerCandidate[];
  /** Source frame dimensions, after EXIF rotation. */
  width: number;
  height: number;
  ms: number;
}

@Injectable()
export class DocCornerService {
  private readonly logger = new Logger(DocCornerService.name);
  private session: InferenceSession | null = null;
  private loading: Promise<InferenceSession | null> | null = null;
  private inFlight = 0;
  private queue: Array<() => void> = [];

  private async ensureSession(): Promise<InferenceSession | null> {
    if (this.session) return this.session;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const ort = await import('onnxruntime-node');
        const t0 = Date.now();
        const s = await ort.InferenceSession.create(MODEL_PATH, {
          executionProviders: ['cpu'],
        });
        this.logger.log(
          `DocCornerNet loaded in ${Date.now() - t0}ms — inputs ${s.inputNames.join(',')} outputs ${s.outputNames.join(',')}`,
        );
        this.session = s;
        return s;
      } catch (err) {
        this.logger.warn(
          `DocCornerNet unavailable, detection will fall back: ${(err as Error).message}`,
        );
        return null;
      }
    })();
    return this.loading;
  }

  async available(): Promise<boolean> {
    return (await this.ensureSession()) !== null;
  }

  private async acquire(): Promise<void> {
    if (this.inFlight < MAX_CONCURRENT) {
      this.inFlight++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.inFlight++;
  }

  private release(): void {
    this.inFlight--;
    const next = this.queue.shift();
    if (next) next();
  }

  /**
   * Run both passes over one photograph.
   *
   * `aim` is the aim box as fractions of the (EXIF-upright) frame. Without it
   * there is one pass.
   */
  async detect(
    image: Buffer,
    aim?: { x: number; y: number; width: number; height: number },
  ): Promise<DetectResult | null> {
    const session = await this.ensureSession();
    if (!session) return null;

    await this.acquire();
    try {
      const t0 = Date.now();
      // ⚠️ ROTATE ONCE, THEN MEASURE. A phone photograph carries its
      // orientation in EXIF; the pixels are landscape. Every fraction we
      // return is of the UPRIGHT frame, which is what the client drew the aim
      // box over, so the crop passes must be cut from the upright pixels.
      const upright = sharp(image).rotate();
      const meta = await upright.metadata();
      const width = meta.width ?? 0;
      const height = meta.height ?? 0;
      if (!width || !height) return null;
      const buf = await upright.toBuffer();

      const regions: Region[] = [FULL_REGION];
      if (aim) {
        const r = regionForAim(aim);
        if (r.w > 0.05 && r.h > 0.05) regions.push(r);
      }

      const ort = await import('onnxruntime-node');
      const candidates: ServerCandidate[] = [];
      for (let i = 0; i < regions.length; i++) {
        const r = regions[i];
        const { data } = await sharp(buf)
          .extract({
            left: Math.round(r.x * width),
            top: Math.round(r.y * height),
            width: Math.max(1, Math.round(r.w * width)),
            height: Math.max(1, Math.round(r.h * height)),
          })
          // Stretched to square, deliberately — see doccorner.ts.
          .resize(DCN_SIZE, DCN_SIZE, { fit: 'fill', kernel: 'lanczos3' })
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const tensor = toInputTensor(data, 3);
        const out = await session.run({
          [session.inputNames[0]]: new ort.Tensor('float32', tensor, [
            1,
            DCN_SIZE,
            DCN_SIZE,
            3,
          ]),
        });
        let coords: Float32Array | null = null;
        let logit = 0;
        for (const name of session.outputNames) {
          const d = out[name].data as Float32Array;
          if (d.length === 8) coords = d;
          else if (d.length === 1) logit = d[0];
        }
        if (!coords) throw new Error('model returned no coordinates');
        const decoded = decodeOutputs(coords, logit);
        candidates.push({
          quad: mapFromRegion(decoded.quad, r),
          score: decoded.score,
          region: i === 0 ? 'full' : 'aim',
        });
      }

      return { candidates, width, height, ms: Date.now() - t0 };
    } catch (err) {
      this.logger.warn(`Detection failed: ${(err as Error).message}`);
      return null;
    } finally {
      this.release();
    }
  }
}
