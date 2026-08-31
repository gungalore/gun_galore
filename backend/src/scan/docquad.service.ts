import { Injectable, Logger } from '@nestjs/common';
import { join } from 'node:path';
import sharp from 'sharp';
import type { InferenceSession } from 'onnxruntime-node';
import { type DocQuadReading, maskCoverage, readCorners } from './docquad-postprocess';
import { MODEL_SIZE, PAD_VALUE, letterboxFor } from './letterbox';

// ────────────────────────────────────────────────────────────────────
// DocQuadNet256 — finding a document's four corners.
//
// ⚠️ WHY THIS RUNS ON THE SERVER AND NOT IN THE BROWSER. It was built for the
// browser first and the payload killed it: onnxruntime-web's smallest usable
// WASM runtime is 13.3 MB and the model is another 12.8 MB — 26.1 MB before a
// member scans anything, on South African mobile data. Threaded WASM also
// needs COOP/COEP cross-origin isolation headers, which would apply site-wide
// and put Clerk and every embed at risk. Here the same model loads once per
// process and costs a member nothing.
//
// WHAT THIS REPLACES. The hand-written classical detector — gradient edges,
// Hough lines, quad assembly, weighted-sum scoring — measured on fifteen real
// photographs of the operator's own licence card:
//
//               classical   this model
//   woven blanket    0/4         4/4
//   patterned mat    0/4         4/4
//   overall usable   3/15       11/15   (median IoU 0.936)
//
// The classical pipeline cannot separate a card's edge from a blanket seam,
// because to a gradient they are the same thing. This model has a notion of
// what a document IS. That is the whole difference and no amount of threshold
// tuning substitutes for it.
//
// Licence: the model is Apache 2.0 from the MakeACopy project; its training
// data is UVDoc (MIT) and SmartDoc 2015 (CC BY 4.0). Attribution is in
// models/NOTICE.makeacopy. All three permit commercial use.
// ────────────────────────────────────────────────────────────────────

/** Where the model file lives, relative to the backend package root. */
const MODEL_PATH = join(process.cwd(), 'models', 'docquadnet256.ort');

/**
 * How many inferences may run at once.
 *
 * ⚠️ MEMORY, NOT CPU, IS THE LIMIT. A 24MP frame decoded to RGBA is 98 MB per
 * copy and the decode-plus-resize path holds several; measured peak was
 * 468 MB for a single image. Four concurrent uploads would be about 1.9 GB on
 * a box that also runs Postgres and the frontend. Two at a time is slower and
 * stays up.
 */
const MAX_CONCURRENT = 2;

export interface DetectResult extends DocQuadReading {
  /** Fraction of the frame the model's mask calls document. */
  maskCoverage: number;
  /**
   * The raw 64x64 mask plane, base64 Float32.
   *
   * ⚠️ RETURNED BECAUSE THE CORNER HEADS CANNOT DO THIS JOB. They always emit
   * four peaks — four planes, each with a maximum — so they can never say
   * "nothing here" or "not a document shape". Fitting four lines to this
   * boundary and intersecting them says both, and is also what finds the
   * corner of a ROUNDED document: the true corner is where the straight edges
   * would have met, and no peak ever sits there.
   *
   * 64*64*4 bytes is 16 KiB, ~22 KiB base64 — trivial beside the JPEG that
   * came the other way.
   */
  mask: string;
  /** Source frame dimensions the quad is expressed in. */
  width: number;
  height: number;
  ms: number;
}

@Injectable()
export class DocQuadService {
  private readonly logger = new Logger(DocQuadService.name);
  private session: InferenceSession | null = null;
  private loading: Promise<InferenceSession | null> | null = null;
  private inFlight = 0;
  private queue: Array<() => void> = [];

  /**
   * Load the model on first use, never at boot.
   *
   * A 13 MB model read and an ORT session build is not something to do while
   * the app is trying to come up — a slow or missing model must degrade this
   * one feature, not crash-loop the whole API. Every failure path here returns
   * null and the caller falls back.
   */
  private async ensureSession(): Promise<InferenceSession | null> {
    if (this.session) return this.session;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        // Required lazily so a broken native binding cannot take the process
        // down at import time — onnxruntime-node ships platform binaries and
        // a mismatched one throws on require, not on use.
        const ort = await import('onnxruntime-node');
        const t0 = Date.now();
        const s = await ort.InferenceSession.create(MODEL_PATH, {
          executionProviders: ['cpu'],
        });
        this.logger.log(
          `DocQuadNet256 loaded in ${Date.now() - t0}ms — inputs ${s.inputNames.join(',')} outputs ${s.outputNames.join(',')}`,
        );
        this.session = s;
        return s;
      } catch (err) {
        this.logger.warn(
          `DocQuadNet256 unavailable, detection will fall back: ${(err as Error).message}`,
        );
        return null;
      }
    })();
    return this.loading;
  }

  /** Is the model actually usable? For the health surface. */
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
   * Find the document in one image.
   *
   * Returns null when the model could not run at all — never a guessed quad.
   * A caller that gets null shows the member the manual corner editor, which
   * is a working outcome; a caller that gets a fabricated quad crops a
   * statutory document wrongly, which is not.
   */
  async detect(image: Buffer): Promise<DetectResult | null> {
    const session = await this.ensureSession();
    if (!session) return null;

    await this.acquire();
    try {
      const t0 = Date.now();

      // ⚠️ .rotate() WITH NO ARGUMENT. It applies EXIF orientation; libvips
      // has already applied the HEIF irot box on load. Never branch on
      // width > height to decide whether to rotate — ten of fourteen test
      // files are genuinely landscape photographs, and "correcting" them
      // turns correct images sideways.
      const meta = await sharp(image).metadata();
      const swapped = (meta.orientation ?? 1) >= 5;
      const width = (swapped ? meta.height : meta.width) ?? 0;
      const height = (swapped ? meta.width : meta.height) ?? 0;
      if (!width || !height) return null;

      // fit:'contain' IS the letterbox: aspect preserved, centred, padded.
      // The pad colour is mid-grey on purpose — see PAD_VALUE.
      const { data } = await sharp(image)
        .rotate()
        .resize(MODEL_SIZE, MODEL_SIZE, {
          fit: 'contain',
          position: 'centre',
          background: { r: PAD_VALUE, g: PAD_VALUE, b: PAD_VALUE },
          kernel: 'lanczos3',
        })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      // Interleaved RGB to planar NCHW, scaled to [0,1]. No mean/std.
      const n = MODEL_SIZE * MODEL_SIZE;
      const nchw = new Float32Array(3 * n);
      for (let i = 0; i < n; i++) {
        nchw[i] = data[i * 3] / 255;
        nchw[n + i] = data[i * 3 + 1] / 255;
        nchw[2 * n + i] = data[i * 3 + 2] / 255;
      }

      const ort = await import('onnxruntime-node');
      const feeds = {
        [session.inputNames[0]]: new ort.Tensor('float32', nchw, [1, 3, MODEL_SIZE, MODEL_SIZE]),
      };
      const out = await session.run(feeds);

      const lb = letterboxFor(width, height);
      const reading = readCorners(out.corner_heatmaps.data as Float32Array, lb);
      return {
        ...reading,
        maskCoverage: maskCoverage(out.mask_logits.data as Float32Array),
        mask: Buffer.from(
          (out.mask_logits.data as Float32Array).slice().buffer,
        ).toString('base64'),
        width,
        height,
        ms: Date.now() - t0,
      };
    } catch (err) {
      this.logger.warn(`Detection failed: ${(err as Error).message}`);
      return null;
    } finally {
      this.release();
    }
  }
}
