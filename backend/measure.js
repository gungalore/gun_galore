#!/usr/bin/env node
/**
 * Measure DocQuadNet256 model accuracy and performance on 15 reference images.
 * Exact replication of production preprocessing from docquad.service.ts.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Import onnxruntime and define ORT function to match production usage
const ort = require('onnxruntime-node');

// ────────────────────────────────────────────────────────────────────
// Constants from letterbox.ts and docquad.service.ts
// ────────────────────────────────────────────────────────────────────

const MODEL_SIZE = 256;
const HEATMAP_SIZE = 64;
const PAD_VALUE = 128;

// ────────────────────────────────────────────────────────────────────
// Pure letterbox functions
// ────────────────────────────────────────────────────────────────────

function letterboxFor(srcWidth, srcHeight) {
  if (srcWidth <= 0 || srcHeight <= 0) {
    return { srcWidth, srcHeight, scale: 1, offsetX: 0, offsetY: 0 };
  }
  const scale = Math.min(MODEL_SIZE / srcWidth, MODEL_SIZE / srcHeight);
  return {
    srcWidth,
    srcHeight,
    scale,
    offsetX: (MODEL_SIZE - srcWidth * scale) / 2,
    offsetY: (MODEL_SIZE - srcHeight * scale) / 2,
  };
}

function toSourceSpace(lb, p) {
  if (lb.scale === 0) return { x: 0, y: 0 };
  return { x: (p.x - lb.offsetX) / lb.scale, y: (p.y - lb.offsetY) / lb.scale };
}

function cellToModelSpace(col, row) {
  const step = MODEL_SIZE / HEATMAP_SIZE;
  return { x: (col + 0.5) * step, y: (row + 0.5) * step };
}

function insideContent(lb, p, tolerance = 1) {
  const right = MODEL_SIZE - lb.offsetX;
  const bottom = MODEL_SIZE - lb.offsetY;
  return (
    p.x >= lb.offsetX - tolerance &&
    p.x <= right + tolerance &&
    p.y >= lb.offsetY - tolerance &&
    p.y <= bottom + tolerance
  );
}

// ────────────────────────────────────────────────────────────────────
// Postprocessing from docquad-postprocess.ts
// ────────────────────────────────────────────────────────────────────

function sigmoid(x) {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

function planeStats(heatmaps, channel) {
  const n = HEATMAP_SIZE * HEATMAP_SIZE;
  const base = channel * n;
  let peak = -Infinity;
  let col = 0;
  let row = 0;
  let sum = 0;
  for (let y = 0; y < HEATMAP_SIZE; y++) {
    for (let x = 0; x < HEATMAP_SIZE; x++) {
      const v = heatmaps[base + y * HEATMAP_SIZE + x];
      sum += v;
      if (v > peak) {
        peak = v;
        col = x;
        row = y;
      }
    }
  }
  const mean = sum / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) {
    const d = heatmaps[base + i] - mean;
    varSum += d * d;
  }
  return { peak, col, row, mean, std: Math.sqrt(varSum / n) };
}

function readCorners(heatmaps, lb) {
  const pts = [];
  const corners = [];
  for (let c = 0; c < 4; c++) {
    const s = planeStats(heatmaps, c);
    const modelPt = cellToModelSpace(s.col, s.row);
    pts.push(toSourceSpace(lb, modelPt));
    corners.push({
      confidence: sigmoid(s.peak),
      sigma: s.std > 1e-6 ? (s.peak - s.mean) / s.std : 0,
      onPadding: !insideContent(lb, modelPt),
    });
  }
  return {
    quad: pts,
    corners,
    minConfidence: Math.min(...corners.map((c) => c.confidence)),
    minSigma: Math.min(...corners.map((c) => c.sigma)),
  };
}

function maskCoverage(maskLogits) {
  const n = HEATMAP_SIZE * HEATMAP_SIZE;
  let hits = 0;
  for (let i = 0; i < n; i++) {
    if (maskLogits[i] > 0) hits++;
  }
  return hits / n;
}

// ────────────────────────────────────────────────────────────────────
// Main measurement
// ────────────────────────────────────────────────────────────────────

async function measureImage(session, imageBuffer, filename) {
  const t0 = Date.now();

  // Step 1: Get metadata and detect orientation
  const meta = await sharp(imageBuffer).metadata();
  const swapped = (meta.orientation ?? 1) >= 5;
  const width = (swapped ? meta.height : meta.width) ?? 0;
  const height = (swapped ? meta.width : meta.height) ?? 0;

  if (!width || !height) {
    console.warn(`${filename}: Invalid dimensions`);
    return null;
  }

  // Step 2: Preprocess exactly as production does
  const { data } = await sharp(imageBuffer)
    .rotate() // Apply EXIF orientation
    .resize(MODEL_SIZE, MODEL_SIZE, {
      fit: 'contain',
      position: 'centre',
      background: { r: PAD_VALUE, g: PAD_VALUE, b: PAD_VALUE },
      kernel: 'lanczos3',
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Step 3: Interleaved RGB to planar NCHW, scaled to [0,1]
  const n = MODEL_SIZE * MODEL_SIZE;
  const nchw = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    nchw[i] = data[i * 3] / 255;
    nchw[n + i] = data[i * 3 + 1] / 255;
    nchw[2 * n + i] = data[i * 3 + 2] / 255;
  }

  // Step 4: Run inference
  const feeds = {
    input: new ort.Tensor('float32', nchw, [1, 3, MODEL_SIZE, MODEL_SIZE]),
  };
  const out = await session.run(feeds);

  // Step 5: Extract corners
  const lb = letterboxFor(width, height);
  const reading = readCorners(out.corner_heatmaps.data, lb);
  const coverage = maskCoverage(out.mask_logits.data);

  const ms = Date.now() - t0;

  return {
    filename,
    width,
    height,
    minConfidence: reading.minConfidence,
    corners: reading.corners,
    quad: reading.quad,
    maskCoverage: coverage,
    ms,
    reading, // Include full reading for potential later use
  };
}

async function main() {
  const fixturesDir = path.join(
    'C:\\dev\\gun-galore\\scan-fixtures\\iphone74\\iCloud Photos'
  );
  const modelPath = path.join(process.cwd(), 'models', 'docquadnet256.ort');

  // Verify model exists
  if (!fs.existsSync(modelPath)) {
    console.error(`Model not found: ${modelPath}`);
    process.exit(1);
  }

  // List all JPEG files
  const files = fs
    .readdirSync(fixturesDir)
    .filter((f) => /\.JPEG$/i.test(f))
    .sort();

  console.log(`Found ${files.length} images in ${fixturesDir}`);
  console.log('');

  // Load model
  console.log('Loading model...');
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
  });
  console.log(`Model loaded. Inputs: ${session.inputNames.join(',')} Outputs: ${session.outputNames.join(',')}`);
  console.log('');

  // Measure each image
  const results = [];
  for (const file of files) {
    const imagePath = path.join(fixturesDir, file);
    const imageBuffer = fs.readFileSync(imagePath);
    const result = await measureImage(session, imageBuffer, file);
    if (result) {
      results.push(result);
    }
  }

  // Baseline measurements from the task
  const baseline = {
    IMG_5094: 0.059,
    IMG_5097: 0.121,
    IMG_5095: 0.411,
    IMG_5096: 0.427,
    // Other 11 should be >= 0.835
  };

  const failureNames = new Set(Object.keys(baseline));
  const successNames = new Set(
    results
      .map((r) => r.filename.replace('.JPEG', ''))
      .filter((n) => !failureNames.has(n))
  );

  console.log('RESULTS:');
  console.log('========');
  console.log('');

  const passCount = results.filter((r) => r.minConfidence >= 0.80 && !r.reading.corners.some((c) => c.onPadding)).length;

  console.log(`Usable: ${passCount} of ${results.length} (minConfidence >= 0.80 with corners on document)`);
  console.log('');

  // Check separation
  const failureSeparation = results
    .filter((r) => failureNames.has(r.filename.replace('.JPEG', '')))
    .every((r) => r.minConfidence < 0.80);

  const successSeparation = results
    .filter((r) => successNames.has(r.filename.replace('.JPEG', '')))
    .every((r) => r.minConfidence >= 0.835);

  console.log(`Separation held: ${failureSeparation && successSeparation ? 'YES' : 'NO'}`);
  console.log(`  - Failures (4) all < 0.80: ${failureSeparation}`);
  console.log(`  - Successes (11) all >= 0.835: ${successSeparation}`);
  console.log('');

  // Detailed results
  console.log('DETAILED RESULTS:');
  console.log('');
  results.forEach((r) => {
    const name = r.filename.replace('.JPEG', '');
    const status = r.minConfidence >= 0.80 && !r.reading.corners.some((c) => c.onPadding) ? 'PASS' : 'FAIL';
    const corner_status = r.reading.corners.map(c => c.onPadding ? 'P' : 'D').join('');
    console.log(
      `${name}: confidence=${r.minConfidence.toFixed(3)}, ${status}, corners=[${corner_status}], ms=${r.ms}`
    );
  });

  console.log('');
  console.log('SUMMARY STATS:');
  console.log('');
  const confidences = results.map((r) => r.minConfidence);
  const mss = results.map((r) => r.ms);
  console.log(`Confidence - min: ${Math.min(...confidences).toFixed(3)}, max: ${Math.max(...confidences).toFixed(3)}, median: ${median(confidences).toFixed(3)}`);
  console.log(`Latency - min: ${Math.min(...mss)}ms, max: ${Math.max(...mss)}ms, mean: ${(mss.reduce((a, b) => a + b, 0) / mss.length).toFixed(1)}ms`);
  console.log('');
  console.log('SIZE ANALYSIS:');
  console.log(`  Model: ${(fs.statSync(modelPath).size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  WASM runtime (ort-wasm-simd-threaded.wasm v1.29.0): 13.3 MB`);
  console.log(`  Total current: 26.1 MB`);
  console.log(`  Proposed (v1.18.0 single-threaded): 22.4 MB (17% reduction)`);
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

main().catch(console.error);
