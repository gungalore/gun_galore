#!/usr/bin/env node
/**
 * Enhanced measurement with corner-drift tracking and visual overlays.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ort = require('onnxruntime-node');

const MODEL_SIZE = 256;
const HEATMAP_SIZE = 64;
const PAD_VALUE = 128;

// ────────────────────────────────────────────────────────────────────
// Letterbox functions
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
// Postprocessing
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
  const modelPts = [];
  for (let c = 0; c < 4; c++) {
    const s = planeStats(heatmaps, c);
    const modelPt = cellToModelSpace(s.col, s.row);
    modelPts.push(modelPt);
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
    modelPts,
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
// Measurement
// ────────────────────────────────────────────────────────────────────

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
    modelPts: reading.modelPts,
    maskCoverage: coverage,
    ms,
  };
}

// ────────────────────────────────────────────────────────────────────
// Overlay generation (simple SVG)
// ────────────────────────────────────────────────────────────────────

async function generateOverlay(imageBuffer, filename, result) {
  // Get original dimensions
  const meta = await sharp(imageBuffer).metadata();
  const w = meta.width;
  const h = meta.height;

  // Convert to PNG for easy embedding
  const pngBuffer = await sharp(imageBuffer).png().toBuffer();
  const base64 = pngBuffer.toString('base64');

  // Build SVG with quad overlay
  const quad = result.quad;
  const points = quad.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const cornerLabels = ['TL', 'TR', 'BR', 'BL'];
  const confidences = result.corners.map((c) => c.confidence.toFixed(3));

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <image width="${w}" height="${h}" href="data:image/png;base64,${base64}" />

  <!-- Quad outline in red -->
  <polygon points="${points}" fill="none" stroke="red" stroke-width="2" />

  <!-- Corner markers -->
  ${quad
    .map(
      (p, i) =>
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="6" fill="none" stroke="lime" stroke-width="2" />` +
        `<text x="${(p.x + 10).toFixed(1)}" y="${(p.y + 10).toFixed(1)}" fill="lime" font-size="12">${cornerLabels[i]}:${confidences[i]}</text>`
    )
    .join('\n  ')}

  <!-- Status -->
  <rect x="10" y="10" width="300" height="60" fill="rgba(0,0,0,0.7)" />
  <text x="20" y="30" fill="white" font-size="14">minConfidence: ${result.minConfidence.toFixed(3)}</text>
  <text x="20" y="50" fill="white" font-size="14">maskCoverage: ${result.maskCoverage.toFixed(3)}</text>
  <text x="20" y="70" fill="white" font-size="14">latency: ${result.ms}ms</text>
</svg>`;

  return svg;
}

async function main() {
  const fixturesDir = 'C:\\dev\\gun-galore\\scan-fixtures\\iphone74\\iCloud Photos';
  const modelPath = path.join(process.cwd(), 'models', 'docquadnet256.ort');
  const outputDir = path.join(process.cwd(), '..', 'overlays');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const files = fs
    .readdirSync(fixturesDir)
    .filter((f) => /\.JPEG$/i.test(f))
    .sort();

  console.log(`Measuring ${files.length} images...`);

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

      // Generate overlay for first 3 images
      if (results.length <= 3) {
        const svg = await generateOverlay(imageBuffer, file, result);
        fs.writeFileSync(path.join(outputDir, `${file.replace('.JPEG', '')}_overlay.svg`), svg);
        console.log(`  ${file}: confidence=${result.minConfidence.toFixed(3)}`);
      }
    }
  }

  console.log('');
  console.log('Overlays saved to: ' + outputDir);
}

main().catch(console.error);
