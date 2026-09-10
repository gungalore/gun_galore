#!/usr/bin/env node
/**
 * Final measurement report with all required metrics.
 * Outputs results in the structured format.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ort = require('onnxruntime-node');

const MODEL_SIZE = 256;
const HEATMAP_SIZE = 64;
const PAD_VALUE = 128;

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
    const sourcePt = toSourceSpace(lb, modelPt);
    pts.push(sourcePt);
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

async function measureImage(session, imageBuffer, filename) {
  const t0 = Date.now();

  const meta = await sharp(imageBuffer).metadata();
  const swapped = (meta.orientation ?? 1) >= 5;
  const width = (swapped ? meta.height : meta.width) ?? 0;
  const height = (swapped ? meta.width : meta.height) ?? 0;

  if (!width || !height) return null;

  const { data } = await sharp(imageBuffer)
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

  const n = MODEL_SIZE * MODEL_SIZE;
  const nchw = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    nchw[i] = data[i * 3] / 255;
    nchw[n + i] = data[i * 3 + 1] / 255;
    nchw[2 * n + i] = data[i * 3 + 2] / 255;
  }

  const feeds = {
    input: new ort.Tensor('float32', nchw, [1, 3, MODEL_SIZE, MODEL_SIZE]),
  };
  const out = await session.run(feeds);

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
  };
}

async function main() {
  const fixturesDir = 'C:\\dev\\gun-galore\\scan-fixtures\\iphone74\\iCloud Photos';
  const modelPath = path.join(process.cwd(), 'models', 'docquadnet256.ort');

  const files = fs
    .readdirSync(fixturesDir)
    .filter((f) => /\.JPEG$/i.test(f))
    .sort();

  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
  });

  const results = [];
  for (const file of files) {
    const imagePath = path.join(fixturesDir, file);
    const imageBuffer = fs.readFileSync(imagePath);
    const result = await measureImage(session, imageBuffer, file);
    if (result) {
      results.push(result);
    }
  }

  // Baseline expectations
  const failureBaseline = {
    IMG_5094: 0.059,
    IMG_5097: 0.121,
    IMG_5095: 0.411,
    IMG_5096: 0.427,
  };

  // Determine which are passes and failures
  const failureNames = new Set(Object.keys(failureBaseline));
  const passes = results.filter(
    (r) => r.minConfidence >= 0.80 && !r.corners.some((c) => c.onPadding)
  );
  const failures = results.filter((r) => !passes.includes(r));

  // Check separation
  const failuresSeparated = failures.every((r) => {
    const name = r.filename.replace('.JPEG', '');
    if (failureNames.has(name)) {
      return r.minConfidence < 0.80;
    }
    return true; // Additional failures are OK
  });

  const successNames = Array.from(failureNames);
  const knownFailuresFail = results
    .filter((r) => failureNames.has(r.filename.replace('.JPEG', '')))
    .every((r) => r.minConfidence < 0.80);

  const confidences = results.map((r) => r.minConfidence).sort((a, b) => a - b);
  const latencies = results.map((r) => r.ms);

  // Output JSON for structured parsing
  const output = {
    model: 'docquadnet256-fp32-control',
    usable: passes.length,
    total: results.length,
    separationHeld: knownFailuresFail,
    confidenceRange: {
      min: confidences[0],
      max: confidences[confidences.length - 1],
      median: confidences[Math.floor(confidences.length / 2)],
      all: confidences,
    },
    latency: {
      min: Math.min(...latencies),
      max: Math.max(...latencies),
      mean: latencies.reduce((a, b) => a + b, 0) / latencies.length,
    },
    modelSizeMB: fs.statSync(modelPath).size / 1024 / 1024,
    results: results.map((r) => ({
      filename: r.filename,
      confidence: r.minConfidence,
      pass: passes.includes(r),
      onPadding: r.corners.some((c) => c.onPadding),
      ms: r.ms,
    })),
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch(console.error);
