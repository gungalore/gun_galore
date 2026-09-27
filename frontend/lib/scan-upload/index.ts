// ────────────────────────────────────────────────────────────────────
// THE UPLOAD'S OWN CROP/ENHANCE PIPELINE.
//
// This is a frozen copy of the tuned machinery in lib/scan-v3, taken at
// fork time and free to diverge (see the plan): the upload crops a file
// the member already picked — no camera, no tracker, no start screen.
// The vendored scanner under lib/scan-v3 and components/scan-v3 is a
// read-only upstream sync and is never edited; this tree exists so the
// upload stops mounting it.
//
// Excluded from the copy: the camera folder, the live tracker, and the
// camera-only screens (their exports are gone from this seam).
// ────────────────────────────────────────────────────────────────────

export type { DocumentScannerProps, DocShape, EnhanceMode, QualityVerdict, QualityLevel } from './types';
export { type Detector, type Detection, NullDetector, MIN_CONFIDENCE } from './pipeline/detector';
export type { Quad, Point } from './pipeline/geometry';
export { processStill, renderVariant, recropPage, type ScanPage } from './pipeline/process';
export { decodeFile } from './pipeline/decode';
export { imageDataToJpeg, nameFiles, safeName, OUTPUT_MAX_EDGE, JPEG_QUALITY } from './pipeline/output';
export { estimateAspect, classifyShape, SHAPE_RATIOS } from './pipeline/aspect';
export { DEFAULT_GATES, HINT_TEXT, type GateThresholds, type Hint } from './pipeline/gates';
export { WorkerDetector, type WorkerDetectorOptions } from './pipeline/worker-detector';
export { DocAlignerRunner, DOCALIGNER_INPUT } from './pipeline/docaligner';
export { quadFromHeatmap, findPeak } from './pipeline/heatmap';
export { refineQuad, type RefineResult, type RefineOptions } from './pipeline/refine';
export { chooseRotation, chooseRotationPage, rotateImageData, uprightScore, type Rotation } from './pipeline/orientation';
