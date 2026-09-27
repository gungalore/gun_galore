import type { Quad } from './geometry';

export interface Detection {
  quad: Quad;
  /** 0..1. Below `MIN_CONFIDENCE` the caller treats it as "nothing here". */
  confidence: number;
  /** Time the detector took, for the diagnostics panel. */
  ms?: number;
}

/**
 * The one interface every detector implements, so the model can be swapped
 * without touching the tracker, the gates or the screens.
 *
 * `detect` receives a small RGBA frame (the sampler downsizes to about
 * 256 px on the long edge for the live view, larger for a captured still)
 * and answers in that frame's pixel coordinates. `null` means "no document".
 */
export interface Detector {
  readonly name: string;
  /** Preferred input size on the long edge. The sampler honours it. */
  readonly inputSize: number;
  ready(): Promise<void>;
  /**
   * `mode` 'live' (default) may drop the frame when the detector is busy, so the
   * preview never queues up. 'still' always runs, waiting for the detector.
   */
  detect(frame: ImageData, mode?: DetectMode): Promise<Detection | null>;
  dispose?(): void;
}

export type DetectMode = 'live' | 'still';

export const MIN_CONFIDENCE = 0.5;

/**
 * Placeholder until the learned detector lands. Never finds anything, so the
 * camera shows "Point your phone at the page" and the shutter is manual.
 */
export class NullDetector implements Detector {
  readonly name = 'none';
  readonly inputSize = 256;
  async ready(): Promise<void> {}
  async detect(): Promise<Detection | null> {
    return null;
  }
}
